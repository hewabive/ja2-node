# Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
# Modified for ja2-node: opcode numbers and names reimplemented in Python, 2026-10-15. See LICENSE (SFI-SCLA).
# @src Tactical/Soldier_Ani.cc, Tactical/Animation_Control.cc
import json, re, struct, sys

if len(sys.argv) < 3:
    sys.exit("usage: python3 -I tools/spikes/ja2bin-timelines.py <Ja2bin.dat> <reference/stracciatella/src/game> [out.json]")

dat, src = sys.argv[1], sys.argv[2]
out = sys.argv[3] if len(sys.argv) > 3 else None

hdr = open(f"{src}/Tactical/Animation_Control.h", encoding="latin-1").read()
body = hdr[hdr.index("enum AnimationStates"):]
body = body[body.index("{") + 1: body.index("NUMANIMATIONSTATES")]
body = re.sub(r"//[^\n]*", "", body)
states = [t.split("=")[0].strip() for t in body.split(",") if t.strip()]

cc = open(f"{src}/Tactical/Animation_Control.cc", encoding="latin-1").read()
tbl = cc[cc.index("gAnimControl[NUMANIMATIONSTATES]"):]
tbl = tbl[tbl.index("{") + 1:]
rows = re.findall(r'\{\s*"([^"]*)",\s*([-0-9.]+)f?,\s*([^,]*?),\s*(-?\d+|USESTATS),\s*(\w+),\s*(\w+)\s*\}', tbl)
ctrl = [dict(name=r[0], move=float(r[1]), flags=[f.strip() for f in r[2].split("|")],
             speed=0 if r[3] == "USESTATS" else int(r[3]), h=r[4], endh=r[5]) for r in rows]

raw = open(dat, "rb").read()
assert len(raw) == 320 * 100 * 2, len(raw)
inst = [list(struct.unpack_from("<100H", raw, s * 200)) for s in range(320)]

GAMEPLAY = {430: "FIRE", 448: "BURST_CTRL", 449: "BURST_END", 470: "JAM_CHECK", 460: "THROW_RELEASE",
            461: "THROW_RELEASE", 433: "INCAP_CHECK", 440: "DEATH_COMMIT", 465: "LIFE_0", 497: "DEATH_OR_RELEASE",
            447: "FALL_DIR", 721: "FALL_SND+FRAGILE", 722: "FALL_SND+FRAGILE", 408: "ROOF_COMMIT", 475: "ROOF_COMMIT",
            444: "FENCE_COMMIT", 450: "FENCE_FORECAST", 493: "PICKUP", 494: "OPEN_STRUCT", 495: "OPEN_DOOR",
            499: "END_DISPATCH", 442: "END_NONINT", 772: "END_NONINT_RT", 480: "RELEASE_ATTACKER", 492: "DODGE",
            402: "PAUSE_MOVE_1F", 446: "PAUSE_MOVE_ON", 471: "PAUSE_MOVE_OFF", 485: "STEAL", 486: "GIVE",
            487: "DROP", 763: "DROP_AT", 753: "BUSY_DOWN", 757: "BUSY_UP", 755: "QUEEN_SWIPE", 761: "BLADE_DMG",
            468: "PUNCH_END", 469: "MARTIAL_FOLLOWUP", 491: "RANDOM_IDLE", 458: "HAND_SWITCH", 459: "HAND_SWITCH"}
for c in (403, 404, 411, 412, 413, 443, 445, 453, 455, 463):
    GAMEPLAY[c] = "SUBTILE_MOVE"
for c in (406, 409, 410, 454, 456, 462, 466):
    GAMEPLAY[c] = "SET_HEIGHT"


def walk(s):
    seq, seen, pc = [], set(), 0
    while pc < 100 and pc not in seen:
        seen.add(pc)
        v = inst[s][pc]
        if v == 0:
            seq.append(("END0", None)); break
        if v < 399:
            seq.append(("F", v - 1)); pc += 1
        elif 499 < v < 599:
            tgt = v - 501
            seq.append(("LOOP" if tgt in seen else "JMP", tgt))
            if tgt in seen: break
            pc = tgt
        elif 599 < v <= 699 or 799 < v <= 999:
            ns = v - 600 if v <= 699 else v - 700
            seq.append(("GOTO", states[ns] if ns < len(states) else ns)); break
        else:
            seq.append(("OP", v)); pc += 1
            if v == 499:
                break
    return seq


res = {}
for s, name in enumerate(states):
    if s >= 320:
        break
    seq = walk(s)
    nframes = sum(1 for k, _ in seq if k == "F")
    marks, f = [], 0
    for k, v in seq:
        if k == "F":
            f += 1
        elif k == "OP" and v in GAMEPLAY:
            marks.append((f, v, GAMEPLAY[v]))
    end = next((f"{k}:{v}" for k, v in reversed(seq) if k in ("LOOP", "GOTO", "END0")), "OP499" if seq and seq[-1] == ("OP", 499) else "?")
    c = ctrl[s] if s < len(ctrl) else {}
    res[name] = dict(idx=s, frames=nframes, speed=c.get("speed"), move=c.get("move"), end=end,
                     marks=marks, ops=sorted({v for k, v in seq if k == "OP"}))

if out:
    json.dump(res, open(out, "w"), indent=1)

used = sum(1 for s in range(len(states)) if any(inst[s]))
allops = {}
for s in range(len(states)):
    for v in inst[s]:
        if 399 <= v < 500 or 699 < v < 800:
            allops[v] = allops.get(v, 0) + 1
print(f"states in enum: {len(states)}, gAnimControl rows: {len(ctrl)}, non-empty scripts: {used}")
print(f"distinct opcodes used: {len(allops)}; gameplay-class used: {len([o for o in allops if o in GAMEPLAY])}")
show = ["WALKING", "RUNNING", "SWATTING", "CRAWLING", "STANDING", "KNEEL_DOWN", "PRONE_DOWN",
        "READY_RIFLE_STAND", "AIM_RIFLE_STAND", "SHOOT_RIFLE_STAND", "END_RIFLE_STAND",
        "STANDING_BURST", "THROW_ITEM", "OPEN_DOOR", "CLIMBUPROOF", "JUMP_OVER_BLOCKING_PERSON",
        "GENERIC_HIT_STAND", "FLYBACK_HIT", "FALLBACK_HIT_STAND", "FALLFORWARD_FROMHIT_STAND",
        "STAB", "PUNCH", "PICKUP_ITEM", "HOPFENCE"]
for n in show:
    if n not in res:
        print(f"{n:28s} (no such state)"); continue
    r = res[n]
    mk = ", ".join(f"f{f}:{op}" for f, _, op in r["marks"])
    print(f"{n:28s} frames={r['frames']:3d} speed={r['speed']!s:>4} move={r['move']} end={r['end']}  {mk}")

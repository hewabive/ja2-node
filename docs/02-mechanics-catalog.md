<!-- JA2 mechanics catalog. 2026-10-15, analysis of Stracciatella (ae6bf01) cross-checked against vanilla.
Paths are relative to reference/stracciatella/src/game/ (V = vanilla). This is a working reference for sim/rules and
sim/tactical, not a specification: re-read the formula in the source before implementing a mechanic. -->

# JA2 gameplay mechanics catalog: Stracciatella reference vs vanilla, for the TypeScript simulation core

Six parallel research passes plus my own cross-checks. Nothing was modified, built or run.

**Conventions.**
- Paths are relative to `reference/stracciatella/src/game/` unless marked V (vanilla `reference/vanilla/ja2/Build/`).
- **Pur**: P = pure function of state, M = mostly pure (reads world/global arrays, no UI), E = entangled with UI, animation or flow.
- **RNG**: PR = PreRandom/PreChance (save-scum resistant), R = Random/Chance, – = deterministic.
- **Dev** = Stracciatella behaviour that differs from vanilla.
- **JSON** = `assets/externalized/*.json`.

## 0. Cross-cutting facts

| Topic | Finding |
|---|---|
| **PreRandom** | `src/sgp/Random.cc:78`. A table of 256 pregenerated numbers plus an index, both saved in the savegame (`SaveLoadGame.cc:2110/2120`). After a reload the next ≤256 PreRandom draws repeat exactly. V `SGP/Random.c:61-65` never refills the table (the refill line is commented out), so its 256 numbers recycle forever. Strac refills each slot from mt19937 after use. V also maps numbers with `n*range/RAND_MAX%range`; Strac uses a uniform distribution. **The TS core needs two RNG streams, with the PreRandom table and index serialized.** |
| What uses PR | Gun, melee and throw hit rolls; jamming; weapon wear; the AI hit-location roll; miss deviation; structure hits; damage fluke; armour; critical hits; all skill checks (lockpick, disarm, trap detection); stat gains (`Campaign.cc:261,336`); stealth noise; most AI decisions (`DecideAction.cc`, about 40 sites); autoresolve; ambushes and bloodcat ambushes; creature town attacks; SAM shots at Skyrider; unhired-merc deaths; explosion and gas damage; grenade duds; item damage; whether a map item exists (`World_Items.cc:244`). |
| What uses plain R | Enemy stats and gear generation, Queen evaluation timers and detection rolls, enemy sleep delays while travelling, militia kill promotion, dealer and Bobby Ray restock, Pablo's theft, contracts and hiring, IMP tie-breaks, civilian-murder blame, weapon drop on hit, realtime AI delays, NPC schedules. |
| Policy objects | `gamepolicy()` reads `externalized/policy/GamePolicy.h` from game.json. `saipolicy_by_diff()` reads strategic-ai-policy.json; its values were verified equal to the V `#define`s. Lua hooks exist (`externalized/scripting/ScriptingExtensionsLua.cc:429-444`), but only `enums.lua` ships, so they can be ignored. |
| Binary data still required | `prof.dat` (profiles, opinions, approach values, salaries; JSON overrides in mercs-profile-info.json). Map `.dat` files (terrain movement costs, placements, doors, schedules, lights). Structure DB `.jsd` (LOS and cover). `binarydata/Locks.bin`. `NPCData/*.npc` (only the Meanwhile scripts 160–187 and `000`; everything else is in script-records-NPCs.json). Civilian quote `.edt` files. |
| Coupling | Include counts: Tactical→Strategic 268 vs Strategic→Tactical 282; TileEngine→Tactical 148. The original is cyclic everywhere, and cross-layer effects are direct calls. An event bus is required (see §(a)). |

## 1. Tactical: turns, action points (AP), breath, movement

| Mechanic | Source | Rule | Data | Pur | LOC | Policy / Dev | RNG |
|---|---|---|---|---|---|---|---|
| AP pool | `Tactical/Soldier_Control.cc:322` CalcActionPoints | 5+(10·Exp+3·Agi+2·LifeMax+2·Dex+20)/40. Injury up to −⅔, low breath up to −½, ×100/load% when load >100%. Clamp 10..25 (monster 40, vehicle 50). Phobias, drugs, frenzy and boxing modify it. | prof.dat, `Points.h:8-19` | P | 100 | = V | – |
| Carry-over / AP debt | Soldier_Control.cc:420; `Points.cc:488` DeductPoints | Keep at most 5 unused AP (boxing 2). Debt allowed down to −100. AP costs are 0 out of combat. | – | P | 110 | **Dev:** V floors AP at 0 (V Points.c:465), so suppression debt was refunded | – |
| Move cost per tile | Points.cc:34,244,1244,1273 | Flat 3, grass 4, bush 5, rubble 6, shore 7, knee-deep water 9, swim 8, fence 6. Diagonal ×1.4 (truncated). Walk −1, swat +0, crawl +1, run ÷1.8. +2 sneaking, +1 reverse, +1 to start running. | per-tile costs from map .dat | P | 350 | = V | – |
| Fixed action costs | `Points.h:22-159`; Points.cc:1432,1526,1566,1612,1648 | Crouch/prone 2, stand↔prone 4. Turn 1/2/6 (stand/crouch/prone). Ready = weapon `ubReadyTime`. Reload 5 (wrong magazine 10). Pickup 3. Door 3. Picklock 10. Roof up 10 / down 6. First aid 5. Explosive charge 10. | weapons.json | P | 300 | `diagonally_interactable_doors` adds diagonal door costs | – |
| AP to shoot | Points.cc:1006,990,843,866 | round(100·fullAP/((50+skill/2)·ShotsPer4Turns/4)). Skill = Mrk for guns, (Dex+Agi)/2 for blades. Plus ready or turn cost, +1 for a new target, +0..4 aim clicks. Burst max(3, ⌈5·fullAP/25⌉); G11 costs 1. Grenades are a flat 5. | weapons.json | P | 250 | `fixed_cost_to_shoot` (:1011) removes V's "more AP means a dearer shot" | – |
| Breath | Points.cc:154,117,585,641,764; Soldier_Control.cc:7565 | Breath points per tile 5..100 by terrain, ×(run 3 / walk 1 / swat 2 / crawl 4), +3% per load % over 100. Scaled by a factor of 100+(100−breath)+wound%−(Str−80)/2. Unused AP above 5 regenerate breath. 0 breath = collapse. Realtime ×1.25. | anim flags | M | 300 | – | – |
| Effective stats / fatigue | `Tactical/SkillCheck.cc:14-118` | EffStr scales with life. EffAgi ÷ load%. Drunk penalties. Fatigue penalty by BreathMax: 0/10/25/50/75/90%. | – | P | 130 | = V | – |
| Carried weight | `Tactical/Items.cc:843` | load% = 100·g/(Str′·500), where Str′ adds EffStr−80 for strength above 80 | items.json | P | 25 | minor Dev (V halves Str with integer division) | – |
| Turn loop | `Tactical/TeamTurns.cc:182,298`; Soldier_Control.cc:4000 | Team order: OUR→ENEMY→CREATURE→MILITIA→CIV. Merc turn start: bleeding, drug decay, shock halved, noise decay, new APs. | – | E | 500 | Dead-is-Dead save hook :154/:188 | – |
| Realtime↔turn-based | `OppList.cc:257,372`; `Overhead.cc:3984` (enter), 4237 (exit) | Sightings ranked by interrupt points decide who starts. Combat exits after >1 turn without sightings. One realtime "turn" every 5 s (`Strategic_Turns.cc:30`). | – | M | 450 | `can_enter_turnbased` | – |
| Climb / jump / window | Soldier_Control.cc:1553-1587,5188-6202 | Roof 10 AP / 500 breath points, down 6/250, fence 6/200. **AP is deducted on animation events.** | structures | E | 250 | Window climb is Strac-only | – |
| Vehicles | `Tactical/Vehicles.cc` (1047 LOC) :597; fuel `Strategic/Strategic_Movement.cc:1168` | +35 AP. Gunfire damage ÷3; HTH and gas do nothing. Fuel 0..10000, spent at traverse-min×6; a gas can adds status×50. | vehicles.json | M | 1100 | – | R |
| Pathing | `Tactical/PathAI.cc:530` | A* on travel-cost units (flat 10, grass 12…), not on AP | map | M | 2700 | `avoid_light_tiles_at_night` (:176) | – |

## 2. Tactical: vision, noise, interrupts

| Mechanic | Source | Rule | Data | Pur | LOC | Policy / Dev | RNG |
|---|---|---|---|---|---|---|---|
| Sight range | `OppList.cc:881` DistanceVisible, :143 | Tiles = 2×{straight 13, angle 11, side 7, behind 0}; a known target is visible from any direction. +2 between levels. × light%. Goggles: sun +1/+2, NV +2, UV +4. Night Ops +1. In gas ≤2. Running ×0.8. | goggle item IDs hardcoded | P | 190 | **Dev:** V applied the light penalty inconsistently | – |
| Light→sight table | OppList.cc:164 | % by light level 0..15: 80,86,93,**100** (day=3),…,**43** (night=12),30,17,9 | – | P | 20 | – | – |
| Day/night light | `TileEngine/Environment.cc:229,369` | Dawn 06:47 and dusk 20:57, stepped every 2 min. Desert sectors light 2. Weather code is dead. | light-templates.json, map lights | M | 150 | = V | – |
| LOS ray | `Tactical/LOS.cc:575,1519` | 3D cube stepping. Vegetation cuts sight by stance (×(100+camo)). Camo (decays as the target moves) hides crouched/prone targets on grass. 3 smoke tiles block sight. Returns the cover distance that CTH uses. | .jsd structure DB, smoke-effects.json | P (given world) | 850 | data-driven smoke | – |
| OppList states | `Overhead_Types.h:194-206`; OppList.cc:4265,4471 | Per merc and per team: seen = 1, seen 1..3 turns ago = 2..5, heard = −1..−4. Forgotten after 3 turns. Last-known gridno kept. Decays every 20 s in realtime. | – | M | 1500 | – | – |
| Radio sightings | OppList.cc:713,749 | Medium/hard: alerted enemies share sightings with the whole team | difficulty | P | 40 | – | – |
| Watched locations | OppList.cc:4805-5066 | Up to 3 per soldier, worth 1..4 points; feed the interrupt duel | – | P | 260 | – | – |
| Movement noise | OppList.cc:3230 | Stealth = 20+4·Exp+0.4·Dex, +25 per STEALTHY trait. Max volume 9−stealth/16 (run +3, crawl −2). Sneaking: d100 vs stealth, success = silent. | – | P | 120 | **Fix:** V's UINT8 wraparound and an unreachable water branch | **PR** |
| Hearing | OppList.cc:3773,1093,3428 | Effective volume = base + hearing − oppCnt − (dist−1). Listener running −5, floor change −5. Hearing bonuses: exp, Night Ops, extended ear, darkness. Walkman = deaf. | OppList.h:13-21 | P | 900 | **Dev:** V's sleeping-listener −5 is disabled (:3848) | – |
| Interrupt eligibility | TeamTurns.cc:917 | ≥4 AP; conscious and OK; a *new* sighting required. Facing away only if dist ≤ Exp. A hearing interrupt needs the opponent to see us. | – | P | 220 | `multiple_interrupts` (:1130), `interrupt_after_being_under_fire` (:999) | – |
| Interrupt duel | TeamTurns.cc:1139,1298 | Points = Exp + watched points − crowding − shock − dist/10 …. Unseen attacker wins automatically; otherwise must be strictly higher (ties go to the mover). | – | P | 160 | = V (diffed) | **– (deterministic)** |
| Timed turns | `Tactical/Interface.cc:1686-1979` | 15 s per OK merc, 5 s per not-OK merc. UI removed in JA2 Gold (`GameInitOptionsScreen.cc:303 #if 0`). | – | E | 300 | dead feature | – |

## 3. Tactical: combat resolution

| Mechanic | Source | Rule | Data | Pur | LOC | Policy / Dev | RNG |
|---|---|---|---|---|---|---|---|
| Gun CTH | `Tactical/Weapons.cc:1979` CalcChanceToHitGun | Base = Mrk + morale − fatigue, averaged with gun condition if lower. +10 per aim AP (none in burst). Crouch/prone range bonus. Range term 3·(90−sight)/10, modified by scope and laser. Head −30%. Target crouched −20, prone up to −40, moved −1.5/tile. Wounds ⅔ scaled. Burst −penalty·(shot−1). Clamp 1..99. | weapons.json, `Weapons.h:10-130` | M | 570 | `chance_to_hit_min/max`, `aim_bonus_*`, `range_*`. **Dev:** bandaging now *helps* (V bug made it worse); barrel-extender wear only on real shots. V bug kept: the agility dodge only applies vs QUEENMONSTER. | barrel wear R |
| Enemy CTH modifier | Weapons.cc:~2170-2190 | Easy −5, else min(0, `gbDiff` to-hit) | `TacticalAI/AIMain.cc:53` | P | 10 | = V | – |
| Melee CTH | Weapons.cc:3215 CalcChanceHTH | 67+(att−def)/3. att = (3·Dex+Agi+Str+10·Exp)/6; def mirrors it with Agi. Steal = 50·att/def. | – | P | 275 | = V | – |
| Throw range / CTH | Weapons.cc:3525,3585 | Range 2+((2·Str+100)/3)/min(3+wt/3,4). CTH (Dex+Mrk)/2 + aim·10 + range term. | weights | P | 210 | – | – |
| Hit roll | Weapons.cc:670-672 | `PreRandom(100) <= CTH`, so effective = CTH+1% (99 means 100%) | – | P | – | = V | **PR** |
| AI hit location | Weapons.cc:432-490 | Legs 15% / torso 80% / head 5%; switches to head if head chance-to-get-through >2× body | – | P | 60 | `ai_better_aiming_choice`, `threshold_cth_head/legs` | **PR** |
| Bullet flight | LOS.cc:3045,3196,3446,3680 | Miss deviation scaled by miss margin. Structure-hit table (:116, cap 90%). Body part decided by bullet Z vs stance. Can hit bystanders. Each passing bullet gives a nearby soldier +1 suppression point. | .jsd | E | 1500 | velocity drop disabled (:1797) | **PR** |
| Damage | Weapons.cc:2743 BulletImpact | impact·(100+fluke(±25)+hitBy/2)%. HP ammo ×1.7 after armour; HE ×4/3. Floor impact/10. Head ×1.5, legs ×0.5. | `Weapons.h:85-105` (ammo factors hardcoded) | M | 375 | `tactical_head/legs_damage_multiplier` | **PR** |
| Armour | Weapons.cc:2588,2671 | Protection −max(0, d100−status). Armour-piercing ×¾, SAP ×½. Degrade%. Ceramic plates first. | armours.json | M | 150 | – | **PR** |
| Critical hits | Weapons.cc:2830-3110 | Within 7 tiles: head >55 kills, >45 head explosion; legs >20 knockdown; torso >55. Stat loss if PR(impact/2+5·aim)+1 > 30 (Wis/Dex/Str/Agi by location). | `Weapons.h:19-29` | M | 280 | – | **PR** |
| Melee damage | Weapons.cc:3119 | Exp/2 + Str/20 (blade) or /5 (punch) + impact; fluke; martial-arts multipliers | weapons.json | P | 50 | – | **PR** |
| Jam / wear / dud | Weapons.cc:245,870,3870 | Jam if PR(100) < 80−status−PR(100), PCs only. Unjam skill check. Wear −1 with chance 1/(15+3·reliability). | reliability | P | 90 | – | **PR** |
| Blast | `TileEngine/Explosion_Control.cc:888,865` | Wound dmg+dmg·roll%, falling off linearly. Armour absorbs min(w,35)·explosive-armour%. Stun 100·(bd+roll·bd/2). | explosives.json, explosion-animations.json | M | 2400 | = V | **PR** |
| Gas / smoke | Explosion_Control.cc:747; `TileEngine/SmokeEffects.cc` | dmg+PR(dmg); gas mask blocks | smoke-effects.json | M | 500 | data-driven | **PR** |
| Throw physics | `TileEngine/Physics.cc:1717,2040` | Miss radius 2–4 tiles. Dud if roll ≥ status+PR(50); re-arm after 1–2 turns. | – | E | 2500 | – | **PR** |

## 4. Tactical: wounds, medical, suppression, morale, progression

| Mechanic | Source | Rule | Data | Pur | LOC | Policy / Dev | RNG |
|---|---|---|---|---|---|---|---|
| Take damage | Soldier_Control.cc:5432 SoldierTakeDamage | AP loss dmg/4. Shock dmg/10. Unprofiled enemies just below OKLIFE (15) die. Weapon-drop chance 2·dmg−Str. | – | E | 260 | – | drop R |
| Bleeding / dying | Soldier_Control.cc:7804,8056 | Bleeds when bleeding >12 or life < OKLIFE. Next bleed in 1+life/(10+tilesMoved) turns. **Permanent LifeMax loss while dying.** | – | M | 130 | **Dev:** float vs V integer division | – |
| First aid | Soldier_Control.cc:6995 | Skill = (3·Med+2·kit+10·Exp+Dex)/7. Points = AP·skill/50 (+50% with medikit). Below OKLIFE each point costs double. | – | P | 135 | – | – |
| Auto-bandage | `Tactical/Auto_Bandage.cc`; `TacticalAI/Medical.cc:199` | Assigns medics to patients after combat | – | E | 830 | – | – |
| Suppression | Overhead.cc:5103,5167 | Tolerance = 2·Exp ± morale/attitude. AP lost = points·6/(tol+6), max 8. Stance drop if points ≥130/(6+tol) and nearest enemy >8 tiles. | – | M | 130 | `suppression_fire_modifier` (6), `_reaction_threshold` (130) | – |
| Morale | `Tactical/Morale.cc:27-64,70,664,818` | 37 events (kill +4, buddy died −15, …). Personality and attitude modify them. CTH effect (m−45)/10 above 50, (m−50)·2/5 below. Hourly team-opinion pull. | prof.dat opinions (mercs-relations.json ships `[]`) | P | 860 | – | – |
| Stat gain | `Tactical/Campaign.cc:48,102` | Chance per point (100−stat)%, Wisdom-scaled. Subpoints per stat point: 50 (attributes), 25 (skills), 350·level (exp). Training cap 85. | prof.dat | P | 270 | – | **PR** (= V) |
| Level-up salary | Campaign.cc:669-735 | ×1.25 per level (daily, weekly, two-week rates and medical deposit). Speck email. | Campaign.h:50 | P | 70 | – | – |
| Unhired mercs | Campaign.cc:1041,1095 | Off-team stat growth (R). Daily death chance (10−exp±traits)‰, capped. | – | P | 100 | `unhired_merc_deaths_*` | growth R / death **PR** |
| Drugs / alcohol | `Tactical/Drugs_And_Alcohol.cc:18-22,60,221` | Adrenaline effect 15 / side effect 20. Overdose −5 Wis/Dex/Str. Drunk levels reduce stats. | hardcoded | P | 440 | – | regen **PR** |

## 5. Tactical: items, locks, traps

| Mechanic | Source | Rule | Data | Pur | LOC | Notes | RNG |
|---|---|---|---|---|---|---|---|
| Attachments / merges | Items.cc:66,139,211 | Validity tables. **Hardcoded C++ tables, not JSON.** | Items.cc | P | 600 | `extra_attachments` | – |
| Reload | Items.cc:1082 | Calibre and magazine must match. 5/10 AP. | magazines.json, calibres.json | M | 330 | – | – |
| Item damage / water | Items.cc:956,3044,3315 | Damage reduced by protection%. Explosives chain-react by volatility. Deep water: 10% per item. | explosives.json | P | 260 | – | **PR** |
| Skill checks | SkillCheck.cc:146,426 | Lockpick Mech·(Wis+100)/200·(Dex+100)/200+3·Exp+trait, × kit status. Disarm (7·Expl+2·Dex+10·Exp)/10−(100−Wis)/5. Crowbar Str+20. Chance <30 becomes 0. Clamp 0..99. | – | P | 460 | – | **PR** (:342) |
| Locks / doors | `Tactical/Keys.cc:183-593`; `Handle_Doors.cc:582` | Pick, crowbar, smash, blow, key. A near miss adds lock damage. | `binarydata/Locks.bin`, door table in map | P rules / E flow | 600 | `diagonally_interactable_doors` | **PR** |
| Door traps / mines | Keys.cc:435-590; `Handle_Items.cc:3051,2829` | Detect level = Exp+Expl/40−(100−Wis)/20. Electric trap 10–19 damage, super-electric 20–39. Metal detector finds trap level ≤10. | map data | P/E | 680 | – | **PR** |

## 6. Tactical AI and enemy generation (`TacticalAI/`)

| Mechanic | Source | Rule | Data | Pur | LOC | Policy / Dev | RNG |
|---|---|---|---|---|---|---|---|
| Alert states | DecideAction.cc:3721 | Sees enemy → BLACK; lost sight → RED; **RED never drops**. Noise → YELLOW. Team awareness → RED. | – | M | 145 | – | – |
| Orders escalation | AIMain.cc:1831,1899 | On RED: ONGUARD→CLOSE→FAR patrol. Militia become SEEKENEMY. | – | P | 90 | – | – |
| Decision trees | DecideAction.cc:641 Green, 1075 Yellow, 1448 Red, 2457 Black | Patrol chance 25± by orders/attitude. Seek-noise 95+noise/3. Radio gbDiff 50/65/80/90/95 ×morale. Red: seek/help/hide/watch scoring, keeps 5 AP reserve. | – | E | 3870 | `corpse_warning_*` (dead in V, default off), `go_prone_more_often`, `avoid_light_tiles_at_night` | **PR** (~40 sites) |
| Attack vs cover | DecideAction.cc:3064-3164 | Real CTH vs cover% better, weighted by morale, wisdom, orders, attitude. Low-CTH skip: PR(40) > CTH (militia PR(20)). | – | P | 75 | = V | **PR** |
| Burst choice | DecideAction.cc:3245-3300 | 25/(aim+1) + attitude + (10−dist)·(1+diff) | – | P | 60 | **Dev:** adds re-raise APs to the affordability check | **PR** |
| Best shot / throw / stab | `Attacks.cc:91,357,928` | Value = dmg·hitRate·realCTH·threat. Switch target only if ≥50% better. Grenades need CTH ≥70 (easy/medium) and 2+ targets. | weapons.json ubDeadliness | M/E | 1100 | `ai_better_aiming_choice` | some **PR** |
| AI morale / threat | AIUtils.cc:1606,1828 | Friend vs foe threat ratio sets HOPELESS…FEARLESS bands, ± breath/life/attitude | – | P | 335 | – | – |
| Cover / flee | `FindLocations.cc:500,243,985,1351` | Search radius gbDiff 4..13, capped at Wis/8. Must be ≥5% better. Hopeless → maximise distance from enemies. | – | E | 750 | – | – |
| Per-soldier difficulty | AIUtils.cc:2068; `AIMain.cc:53` gbDiff | Level 0..4 from `CalcDifficultyModifier`. Admin −1, elite +1. Militia 2/3/4. | – | P | 65 | gbDiff interrupt modifier is commented out (`TeamTurns.cc:1165`) | – |
| Movement mode / AP reserve | AIUtils.cc:36-44,314; `Movement.cc:291` | Lookup table by urgency. Swat chance 1/(5−diff). Reserve 5 AP. | – | P | 65 | – | **PR** |
| Turn order / realtime cadence | `AIList.cc:147-192`; `Realtime.cc:65` | Idle civilians act 1 turn in 10. Realtime enemy delay 10 s+R(1 s). | – | P | 250 | – | **PR** / R |
| Creatures / panic / surrender | `CreatureDecideAction.cc`; `PanicButtons.cc`; DecideAction.cc:2640 | Same tree structure. Surrender offer if enemies ≥3×PCs, fewer than 4 PCs and no militia. | – | E | 2100 | – | **PR** |
| Enemy difficulty modifier | `Tactical/Soldier_Create.cc:1035` | 0..100 from difficulty (+10/+20) + progress/2 + palace distance (≤30) ± income | – | P | 75 | – | – |
| Enemy level / stats | Soldier_Create.cc:1131,2152 | Base level admin 2 / army 4 / elite 6, + diff/20−2. Cap 6/7/8 by difficulty. Stats 49+4·lvl+R. | map placements | P | 265 | **Dev:** elites clamped to `enemy_elite_min/max_level` (6..10) and exempt from the cap, so elites are stronger than V | R |
| Enemy gear | `Tactical/Inventory_Choosing.cc:108,645,1524,1925` | Rating by class+diff. Gun table with 11 levels. Condition 50–100% (elite 85+). Drop rates 50/25/15/5% (militia 5/3/2). | army-gun-choice-{normal,extended}.json | P | 650 | `enemy_weapon_minimal_status`, `drop_everything` | R |
| In-battle reinforcements | `Strategic/Strategic_Movement.cc:2253`; `Strategic/Queen_Command.cc:912` | Arrive at the edge they travel from. Fill free enemy slots troops→elites→admins. 20 enemies max at map load (`StrategicMap.h:11`). | groups | M | 120 | – | – |

## 7. NPCs, dialogue, quests

| Mechanic | Source | Rule | Data | Pur | LOC | RNG |
|---|---|---|---|---|---|---|
| Script records | `externalized/DefaultContentManager.cc:1380-1428` | 256 records per NPC. A binary .npc wins only if it comes from a mod layer. | script-records-NPCs.json, -control.json | P | 50 | – |
| Desire to talk | `TacticalAI/NPC.cc:470,521` | (50+opinion)/2 + loyalty×attachment/2, × approach value (leadership-scaled; threaten uses deadliness) | prof.dat | P | 70 | – |
| Record eligibility | NPC.cc:1049 | Quest state, fact, approach, day window, opinion threshold | records | P | 190 | – |
| NPC actions | `Tactical/Interface_Dialogue.cc:1571` | 258 action cases (facts, hostility, payments). Hospital cost :4065. | tactical-npc-action-params.json | E | 2500 | hospital freebie **PR** |
| Facts / quests | `Strategic/Quests.cc:484,1105-1182` | About 600 lines of computed facts. Quest status drives the history log. | strategic-fact-params.json | M | 735 | R |
| Schedules / civilian quotes | `Strategic/Scheduling.cc`; `Tactical/Civ_Quotes.cc:388` | NPC schedules with jitter; civilian quotes chosen by loyalty and hints | map .dat, .edt | M | 1950 | R |

## 8. Strategic: clock, movement, Queen, encounters, autoresolve (`Strategic/`)

| Mechanic | Source | Rule | Data | Pur | LOC | Policy / Dev | RNG |
|---|---|---|---|---|---|---|---|
| Clock | Game_Clock.cc:79,433 | Day 1 01:00; arrivals 07:00. Compression 1/300/1800/3600×. Frozen in combat. | – | M | 250 | – | – |
| Event queue | Game_Events.cc:59; Game_Event_Hook.cc:58 | Time-ordered queue, about 60 kinds. Meanwhile pushed back 180–300 min if enemies are present. | – | M | 700 | – | R |
| Periodic ticks | StrategicMap.cc:2239; Hourly_Update.cc:35-73 | ¼h: morale decay. Hourly: assignments, buddy/hate counters, progress, quests. 00:00 merc daily update. 04:00 NPC shuffles. 09:00 restock. 09/12/15/18: mine income. 22:00 creatures. | StrategicMap.cc:122 | M | 400 | – | R |
| Compression allowed | Map_Screen_Interface_Bottom.cc:732 | Blocked by battle, enemies, bombs, dialogue, Meanwhile | – | E | 90 | – | – |
| Travel time | Strategic_Movement.cc:2073 | min = base×100/terrain%. Base: foot 89, car 30, truck 32, tracked 46, air 10. Foot road/plains/sparse/dense/hills/swamp/water 100/85/70/60/50/35/25. Town edge 5. **Foot × highest encumbrance%.** | strategic-map-movement-costs.json, traversibility-ratings.json | **P** | 120 | = V | – |
| Pathing | Strategic_Pathing.cc:188 | A* on travel time; helicopter on cost (safe 100 / unsafe 1000) | – | P | 400 | – | – |
| Group departure | Strategic_Movement.cc:1643 | Enemies sleep 21:00–04:00 with 67% chance (+6–8 h). Encounters are forced on crossing paths. | – | M | 170 | – | R |
| Queen init | Strategic_AI.cc:316 | Pool, garrison %, alert level/decay, grace period. Easy drops L2+L3 garrisons, medium drops L3. Garrisons ±25%. | strategic-ai-policy.json, army-compositions / -garrison-groups / -patrol-groups.json | M | 250 | `refill_defeated_patrol_groups` (new, default V) | R |
| Queen loop | Strategic_AI.cc:1930,2494,927,208 | Each eval (480/360/180 min ±var): one weighted reinforcement. Priority phase = progress/10. Approval compares defence (green 1 / reg 2 / elite 3 / merc 4) vs offence. | same | M/P | 330 | = V | R |
| Detection / wake | Strategic_AI.cc:790,1139,2841 | Adjacent detection Chance(alert), ÷3 at night; success costs decay. Wakes after 5−diff victories. | – | M | 330 | – | R |
| Scripted attacks | Strategic_AI.cc:2676-2802 | Omerta 6·diff troops; Drassen 6/9/12; SAM 3+diff+progress/15 | – | M | 170 | – | R |
| Ambush | PreBattle_Interface.cc:355-400 | Retreating group 90% (R). Else if progress ≥30−5·diff: chance 4−bestExp+2·diff+progress/10 (+20 roadblock, +20 no retreat). | – | M | 120 | = V | **PR** |
| Autoresolve | Auto_Resolve.cc:2469,2458,2697,2848,3359 | Atk = Str+Dex+Wis+Mrk+morale (mercs +(1000−atk)/4). Def = Agi+Wis+BreathMax+Med+morale; +21% for player on an encounter. Roll atk+PR(1000−atk) vs def. Hit split 15/15/70 head/legs/torso, then tactical BulletImpact. Capture before day 4. | – | **P** | 800 | **Dev:** stale-damage fix (:2918); V replay helper restored the PR index, Strac saves but never restores it | **PR** |

## 9. Strategic: creatures, airspace, progress, Meanwhile

| Mechanic | Source | Rule | Data | Pur | LOC | Policy / Dev | RNG |
|---|---|---|---|---|---|---|---|
| Creatures | Creature_Spreading.cc:396,884,898 | Sci-fi only. Start at ≥3 mines held. Spread every 510/450/390 min. Town attack at 22:00 if n·10 > PR(100). | strategic-map-creature-lairs.json | M | 400 | lairs JSON | R / **PR** |
| Bloodcats | Strategic_Movement.cc:3263; Game_Init.cc:118 | First ambush PreChance(5·diff). Count min(R4+2·diff+3, progress/(7−diff)). Lair 14/19/26. | strategic-bloodcat-*.json | P | 100 | – | **PR** + R |
| Airspace / SAM | SAM_Sites.cc:69,154 | Enemy airspace if its SAM is enemy-held and condition ≥80 | strategic-map-sam-sites*.json | **P** | 30 | – | – |
| Skyrider | Map_Screen_Helicopter.cc:255,502,1090 | $100 per safe sector, $1000 per hostile. SAM hit min(cond,33)%: 1st hit minor damage, 2nd forced landing. | – | M/E | 400 | – | **PR** |
| Progress | `Tactical/Campaign.cc:1189,1289` | income%·50 + min(kills/kpp, 25) (kpp 7/10/15) + control (≤25). Triggers at 35 (Madlab), 50 (Mike), 70 (Iggy). | – | **P** | 120 | `progress_*`, `kills_per_point_*` | – |
| Enrico / inactivity | Strategic_Status.cc:231,246 | Mails at 20/55/80%. Tolerance 6−diff+best/42 days, then loyalty loss | – | P | 150 | – | – |
| Meanwhile | Meanwhile.cc:170,651 | 17 one-shot cutscenes; hard: Queen wakes after the first battle (:446) | – | E | 820 | – | – |
| Start / end | Game_Init.cc:200; `Tactical/End_Game.cc:139` | Starting cash 45/35/30k. MERC online day 1–2. Win = Queen killed; **no hard-loss rule found**. | game.json | M | 150 | `starting_cash_*`, `start_sector`, `merc_online_*` | R |

## 10. Strategic economy: militia, loyalty, mines, assignments, dealers

| Mechanic | Source | Rule | Data | Pur | LOC | Policy / Dev | RNG |
|---|---|---|---|---|---|---|---|
| Militia eligibility / fee | Assignments.cc:625; Town_Militia.cc:422,870 | Leadership >0, town allows militia or SAM site, loyalty ≥20, ≤2 trainers. **$750 per session.** | strategic-map-towns.json | P | 190 | = V | – |
| Militia training | Assignments.cc:2663; Town_Militia.cc:61 | Points/hour (Wis+Ldr+10·Exp)·4, +30% per TEACHING trait, − fatigue. 100% = 10 greens. Cap 20 per sector, overflow promotes. | – | P | 250 | – | – |
| Militia promotion / defection | `Tactical/Militia_Control.cc:62`; Town_Militia.cc:253,289 | Kill = 2 pts, assist = 1. Green→regular Chance(25·pts) at ≥2; regular→elite Chance(10·pts) at ≥5. | – | P | 120 | **Dev:** falls back to the next rank | R |
| Loyalty accumulator | Strategic_Town_Loyalty.cc:204-277,96 | 0..100; 500 hundredths = 1 point. Gains ×5·sentiment/100, losses ×100/(5·sentiment). | **hardcoded** sentiment table :96 (Omerta 90, Drassen 30, …) | P | 140 | = V | – |
| Loyalty events | Strategic_Town_Loyalty.cc:850,926,351 | Battle won +5, lost −7.5. Town sector gained +5 / lost −10. Mine +10 / −15. Distance falloff. Civilian murder by body type (5–20%) and witness-based blame. | hardcoded | M | 425 | robbery is a stub (V too) | R |
| Mine income | Strategic_Mines.cc:61,462,516,291 | Max rate × loyalty% × town share, 4× daily. Nothing until the head miner is met. One random mine depletes after 10 days (20 for Drassen). | strategic-mines.json | P | 320 | JSON flags (= V logic) | R |
| Doctoring | Assignments.cc:1074,1264,1426,1381 | Points/hour Med·(Dex+Wis)/2·(100+5·Exp)/2400, capped by kit points. Below OKLIFE each HP costs double. | – | P | 440 | `enable_stat_healing` (Strac-only) | – |
| Natural healing / hospital | Assignments.cc:2842,1634 | life%/divisor (1 resting, 4 working, 12 squad/POW). Hospital: 5 HP/h, $10 per HP, $25 per HP below 15, $2 per bleeding point. | – | P | 200 | – | – |
| Repair | Assignments.cc:1116,1782 | Points Mech·Dex·(100+5·Exp)/60000 × kit factor. Cost per point (100−10·ease)%; ×2 for electronics. Order: jammed guns → own items → others. | items.json repairEase | P | 380 | – | toolkit wear R |
| Training | Assignments.cc:2471,2510,2321 | Self: Wis·(85−stat)/1000. Instructor: skill gap × Wis…/3000, + TEACHING, + opinion. Gun range +25%. | – | P | 230 | – | (StatChange **PR**) |
| Fatigue / sleep | Assignments.cc:2073,6903,5677 | Max-breath loss max(50/(24−need),2)/h. Sleep need 4..12. Auto-sleep below 50, collapse at ≤10. | Assignments.h:16-21 | P | 290 | **Dev:** V integer bug always added +4 to sleep need | – |
| Dealer value / price | `Tactical/Arms_Dealer_Init.cc:2194`; `Tactical/ShopKeeper_Interface.cc:2451,2603` | Price = value×condition×multiplier. Repairable items: condition 0.5+status/200. Price-class ÷3 rule. Tony ÷2. Flo discount ±10%. | dealers.json (= V values), items.json | P | 270 | **Dev:** Flo modifier also applies to blades and launchers | – |
| Dealer cash / stock | Arms_Dealer_Init.cc:239,337 | Cash resets daily to initial cash. Restock rolls; Tony/Devin/Bobby Ray coolness window = progress/10. | dealer-inventory-*.json | M | 440 | V quirks kept | R |
| Dealer repair | Arms_Dealer_Init.cc:2037,1979; ShopKeeper_Interface.cc:5987 | Cost price·rate·(100−cond)%. Time cost·speed minutes. "Delay excuse" PreChance(50). | dealers.json | P | 190 | – | **PR** + R |
| Facilities | `Strategic/Player_Command.cc:33` | Display flags only (a JA2 1.13 feature, not in vanilla) | – | – | – | – | – |

## 11. Laptop: hiring, contracts, economy

| Mechanic | Source | Rule | Data | Pur | LOC | Policy / Dev | RNG |
|---|---|---|---|---|---|---|---|
| AIM price / deposit | `Laptop/AIMMembers.cc:1170,1370`; `Tactical/Soldier_Profile.cc:527,560` | Daily, weekly or two-week rate + gear + deposit (5×competence, rounded to $100). Refund prorated by life. | prof.dat, mercs-profile-info.json | P | 180 | – | – |
| Arrival | `Tactical/Merc_Hiring.cc:424` | Flights 07:30/13:30/19:30 with 6 h prep. Team cap 18. | – | P | 30 | – | – |
| Refusals | AIMMembers.cc:1769; Merc_Contract.cc:343,396 | Order: hangover → hated (a buddy overrides) → death rate > tolerance → reputation. Renewal adds learn-to-hate and morale checks. | prof.dat | M | 210 | – | – |
| Offers elsewhere / departure | Merc_Contract.cc:522,994; Strategic_Merc_Handler.cc:135 | Chance((3−days)·exp) of a rival contract. Warnings 05:30/11:30/17:30. Low-morale departure → hangover days. | – | E | 330 | `start_sector` | R |
| MERC billing / unlock | `Laptop/Mercs.cc:513,1579`; Mercs_Account.cc:263 | Unpaid >7 days warning, >9 suspended, >12 invalid (all quit). Unlock by total paid + days. | mercs-MERC-listings.json | P | 270 | **Dev:** JSON unlocks (V had 4 hardcoded stages) | R |
| Hate / like counters | Strategic_Merc_Handler.cc:526 | Hourly countdown; complaints, then quit or refuse | prof.dat | M | 200 | – | – |
| Insurance | `Laptop/Insurance_Contract.cc:709,835` | Daily premium = salary×5%×risk (product of ratios, clamp 0.1–10). Payout = remaining days × cheapest daily rate. Fraud if killed <60 min after buying. | – | P | 340 | – | R |
| Bobby Ray | `Laptop/BobbyR.cc:514`; BobbyRGuns.cc:1311; BobbyRMailOrder.cc:1472,1550 | Used price ×(0.5+q/200). Shipping max(wt,2 kg)·rate/kg. 1/2/3 days (+1–5 if Sal is dead). | bobby-ray-inventory-*.json, shipping-destinations.json | P | 360 | non-Drassen destinations are a JSON extension | R |
| Airport / Pablo | Strategic_Event_Handler.cc:60-260 | Theft chance 12+R(4·shipments since bribe), rolled per item. Lost if loyalty <20. | facts | M | 200 | `pablo_wont_steal` | R |
| IMP | `Laptop/IMP_Attribute_Selection.cc:34`; `Laptop/IMP_Compile_Character.cc:240-433` | $3000. 40-point pool, attributes 35..85, zeroing a skill refunds 15. Quiz → attitude; 2 skills from a filtered list. | imp.json | P | 400 | `imp_*` | R |
| Finances / RPC pay | `Laptop/Finances.cc:159`; Strategic_Merc_Handler.cc:198 | Single ledger. RPCs quit after 3 days unpaid. | – | E | 125 | – | – |

## 12. Difficulty, options, policy flags

- **Difficulty (1–3; V enum has unused 0 and 4)** changes:
  - enemy radio (`OppList.cc:713`) and the enemy difficulty modifier, which feeds gbDiff equipment ±20, to-hit ±10, radio 50–95 and cover range 4–13 (`Soldier_Create.cc:1035`)
  - enemy level cap 6/7/8 (:2155), enemy CTH −5 on easy (`Weapons.cc:2170`), easy-mode throw targeting (`Attacks.cc:754`)
  - mine bonus bumps 25/20 (`Strategic_Mines.cc:86`)
  - all Queen saipolicy values; garrison drops; extra reinforcements /(6−diff); elite +5·diff%; counterattack sizes; wake at 5−diff (`Strategic_AI.cc:162-2861`); hard-mode Queen wake after the first battle (`Meanwhile.cc:446`)
  - bloodcat and enemy ambush formulas, creature rates (`Creature_Spreading.cc:196-403`)
  - terrorist toughness ×1/1.3/1.6 (`Soldier_Profile.cc:253-425`)
  - starting cash, kills per point, unhired-death caps, inactivity tolerance
- **Iron Man**: no saving in combat or with enemies present (`GameSettings.cc:233`). **Dead is Dead** is a Strac addition: single autosave slot at turn boundaries (`TeamTurns.cc:154`), load blocked (`SaveLoadGame.cc:647`).
- **Sci-fi**: creatures (`Creature_Spreading.cc:901`), extra NPCs (`Game_Init.cc:78`), item sets (`World_Items.cc:249`), enemy regen boosters (`Inventory_Choosing.cc:1361`), quest counts (`Quests.cc:1165`).
- **Gun nut**: `ItemIsLegal` filter (`Items.cc:221`), standard replacements (`Soldier_Profile.cc:161`, `World_Items.cc:272`, `Soldier_Create.cc:1535`), extended army gun table.
- **Timed turns**: dead in Gold.
- **gamepolicy flags that change rules** (everything else in game.json is UI):
  - Combat: CTH min/max, aim/scope/barrel-extender/silencer bonuses, head/leg multipliers, `fixed_cost_to_shoot`, suppression ×2, interrupts ×2
  - Enemies and items: `enemy_weapon_minimal_status`, `enemy_elite_*`, `drop_everything`, `all_drops_visible`, `extra_attachments`
  - Squad and doors: `squad_size`, `diagonally_interactable_doors`
  - AI: five flags
  - Strategic and laptop: `starting_cash_*`, `merc_online_*`, `unhired_merc_deaths_*`, `progress_*`, `kills_per_point_*`, `enable_stat_healing`, `start_sector`, `pablo_wont_steal`, `imp_*`
  - **All defaults equal vanilla** except `extra_hotkeys`, `extra_mousewheel_actions` and `gui_extras`, which are UI.

## (a) Proposed module partition (arrows show "depends on")

```
core/        rng(Pre+Std, serializable) · clock+eventQueue · config(options, gamepolicy, saipolicy) · eventBus
data/        loaders: JSON (items/weapons/armour/army/dealers/...) + binary (prof.dat, map .dat, .jsd, Locks.bin, .npc, .edt)
rules/       stats (effective stats, fatigue, SkillCheck, StatChange, morale value) · items (weight, attach/merge tables,
             condition, reload, value)                                ← core, data          [all pure: test first]
tactical/world     grid, terrain costs, structures, lighting/time-of-day, smoke/gas    ← data, core/clock
tactical/perception LOS ray, DistanceVisible, noise/hearing, OppList, watched locs     ← world, rules
tactical/actions   AP pool & costs, breath, pathing, doors/locks/traps, climb, vehicles ← world, rules
tactical/combat    CTH, shot resolution, damage/armour/crits, explosions, wounds/bleeding, suppression ← perception, actions, rules
tactical/turns     turn loop, RT↔TB, interrupts, combat start/exit                      ← perception, combat, actions
tactical/ai        alert FSM, decision trees, attack/cover/flee (read-only queries → commands) ← all tactical
narrative/   facts, quests, NPC records & actions, schedules, Meanwhile                 ← core, data (emits effects on bus)
strategic/map      sectors, travel time, A*, airspace/SAM, control                      ← data, core
strategic/forces   groups, Queen AI, garrisons/patrols, encounters/ambush, autoresolve (reuses combat.damage pure fns),
                   creatures, bloodcats, in-battle reinforcement hand-off            ← strategic/map, rules, combat(pure part)
strategic/economy  loyalty, mines, militia, assignments (doctor/repair/train/rest), dealers, Pablo ← map, rules, items
campaign/    personnel (profiles, morale/relations, contracts, departures) · laptop (AIM, MERC, insurance, Bobby Ray,
             IMP, finances, email, history) · progress                           ← economy, rules, narrative
presentation (UI/animation/audio) subscribes to the simulation; never owns rules.
```

Two design rules follow from the original code:
1. **Cross-layer side effects go over `eventBus`.** For example, an enemy kill triggers morale, loyalty, militia kill points, progress and quests through direct calls today; these become typed events.
2. **Animation-timed rules move to command commit.** Today climb AP/breath (`Soldier_Control.cc:1553-1587`) and damage feedback are charged on animation frames; animation should become a view of the committed command.

## (b) The ~15 mechanics that make it "feel like JA2", in priority order

1. AP system: pool formula, carry-over of 5, per-terrain, stance and diagonal movement costs, action costs.
2. Gun CTH plus aim clicks plus AP-to-shoot (including the "roll ≤ CTH" +1%).
3. Damage chain: fluke, armour, hit location, criticals, bleeding/OKLIFE/dying, permanent LifeMax loss.
4. Vision: 26-tile day / ~11-tile night, look cones, light table, camo and prone hiding, seen/heard markers.
5. Interrupts (deterministic duel) and turn order, including how realtime becomes turn-based.
6. Tactical AI: alert ladder, radio, seek/hide/flank scoring, burst and grenade habits.
7. Stealth noise and hearing.
8. Breath/energy, suppression AP loss and stance drop, morale effects.
9. Stat gain by use (PreRandom) and level-ups with salary raises.
10. Strategic travel times, ETA display, encounters and ambushes.
11. Queen AI rhythm (evaluation timers, counterattacks, wake-up) and enemy quality growing with progress.
12. Loyalty → militia → mine income loop.
13. Merc personalities: hiring refusals, hate/like counters, contract renewals, departures.
14. Item economy: weight/encumbrance, jamming/condition, repair, dealer and Bobby Ray prices and shipping.
15. Autoresolve odds and the ×1.25 per-level salary growth.

## (c) Exact numbers vs approximate behaviour

**Players would notice if these are wrong (keep bit-exact, verify with golden tests against the C++):**
- AP pool and every AP cost, including truncation on diagonals and running.
- CTH formula, clamp and aim bonuses. Vanilla shows no CTH number; it is visible only with `show_hit_chance`, but hit frequency is felt.
- Sight distances, light table, goggle bonuses.
- Damage, armour and critical thresholds; jam formula; bleeding speed; OKLIFE 15.
- Stat-gain subpoints (25/50/350·level) and training cap 85.
- All prices:
  - AIM rates and deposit, IMP $3000, militia $750
  - dealer multipliers and the condition formula, repair cost/time
  - Bobby Ray prices, shipping/kg with the 2 kg minimum, delivery 1/2/3 days
  - hospital $10/$25/$2, Skyrider $100/$1000, insurance premium and payout
  - MERC 7/9/12-day thresholds, salary ×1.25 per level
- Starting cash, flight times, team cap 18, squad 6.
- Strategic travel minutes.
- Training, doctoring and repair rates shown in the UI.
- Militia 10 per session and cap 20; loyalty event values and sentiment table; mine base rates and income formula.
- Progress thresholds 35/50/70.
- NPC/quest gating, which is data-driven and therefore must match exactly.
- Interrupt outcomes.
- **Which rolls are PreRandom.** Save-reload reproducibility is player-visible.

**Approximate behaviour is acceptable for:**
- bullet micro-trajectory and grenade spread
- dud and re-arm odds, weapon-drop chance
- AI scoring internals, as long as the habits hold
- realtime AI cadence, combat-exit counter
- breath recovery fine detail, blood and smell
- restock quantities, simulated customers, Pablo's roll, repair-delay excuse
- unhired-merc growth, schedule jitter, civilian quotes, Meanwhile timing
- light-template shapes (keep the light *levels* exact)

## Verified vs inferred

**Verified** by reading code, with line numbers taken from grep:
- all formulas, constants and file:line references above
- the PreRandom implementations (Strac and V)
- the game.json and strategic-ai-policy.json values against the V `#define`s
- these vanilla diffs: Points.h constants, CalcNewActionPoints, DeductPoints, interrupt duel, MovementNoise, DistanceVisible, carried weight, CTH (wound term, barrel extender), next-bleed division, the explosion formula, stat-gain RNG, elite level / ReduceHighExpLevels, corpse warning, burst re-raise, dealer table, Flo discount, militia promotion, loyalty values, mine logic, sleep need, Pablo's theft, MERC unlocks, starting cash, unhired-death caps, Iron Man

**Inferred** (not traced end to end):
- LOC figures (function-span estimates)
- `StandardInterruptConditionsMet` matching V line by line
- the SAM third-hit outcome and creature habitat numbers
- the absence of a game-loss rule
- `CalcNewSalary` internals
- the 258 NPC actions and ~600-line CheckFact, which were counted, not read case by case
- `Lighting.cc` internals and the timed-turn flow
- V parity for the parts of Assignments.cc that were not spot-checked

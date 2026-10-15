# JA2 → Web: early groundwork and scope assessment

*2026-10-15. The state of the sources is recorded in `reference/README.md`.*

Project goal: a web clone of Jagged Alliance 2, rewritten in JS/TS from the open sources.
The game runs in the browser; Node is needed for tools, tests and headless simulation.
Non-commercial use only. The game must start without the original resources,
on its own simple stubs, while the original data, if available, is plugged in optionally.

---

## TL;DR

1. **The sources exist in three forms.**
   - The original 2004 C code (vanilla), ~376k lines.
   - JA2 Stracciatella: a living fork in C++ and Rust, ~290k lines, content externalized to JSON.
   - A little-known **complete translation of vanilla to TypeScript** (`alexbatalov/ja2`),
     ~315k lines. It passes `tsc --strict` with zero errors, but was abandoned in 2021.
2. **The SFI-SCLA license permits what we have in mind**, i.e. non-commercial use,
   modification and distribution. But a derivative work must stay under SFI-SCLA:
   MIT or GPL are not allowed. The original game data is not covered by the license and
   may not be distributed.
3. **Porting volume.** After dropping the map editor, debug code, Lua/mods and
   variable resolution, ~225k lines of C++ remain. The "tactics + tile engine +
   tactical AI" core forms a single tangle of mutual dependencies; it cannot be ported piecemeal.
4. **Stubs are a separate large project, not a trifle.** Part of the *game logic* exists
   only in the commercial binary data and is absent from the sources:
   - animation scripts (`ja2bin.dat`);
   - merc profiles (`prof.dat`);
   - NPC dialogue and quest records (`*.npc`);
   - object collision, line of sight and armor (`*.jsd`);
   - all maps.

   Without them the game is not "ugly" but non-functional. A minimal playable stub set
   is estimated at ~3–4 months of pure work.
5. **Recommendation:** a new modern TS repository. The main source of logic is
   Stracciatella, with alexbatalov's translation as a "Rosetta stone" and accelerator.
   Data is stored in layers: our own stub pack at the bottom, the original optionally on top.
   Work proceeds in vertical slices, from a format viewer to the campaign (M0…M7, §7).

---

## 1. Sources

| Repository | What it is | Size | Activity | License |
|---|---|---|---|---|
| [ja2-stracciatella/ja2-stracciatella](https://github.com/ja2-stracciatella/ja2-stracciatella) | Cross-platform port of the original: C++ (`src/game`, `src/sgp`) + Rust (VFS, config, JSON loading, mods). Many bug fixes, content externalized to `assets/externalized/*.json` | 260k C++ + 14k Rust + ~10k externalized | Active, v0.23.0, daily commits | SFI-SCLA; changes after `8287b98` are public domain |
| [gtrafimenkov/ja2-vanilla](https://github.com/gtrafimenkov/ja2-vanilla) | The original C code, minimally patched to build in VS2022 | 342k C + 34k h | Maintained | SFI-SCLA |
| [gtrafimenkov/ja2-vanilla-cp](https://github.com/gtrafimenkov/ja2-vanilla-cp) | "Vanilla" based on the Stracciatella code, without new features | — | 2024–2025 | SFI-SCLA |
| [dariusk/ja2](https://github.com/dariusk/ja2) | Mirror of the original 2004 release; alexbatalov's work is based on it | — | 2014 | SFI-SCLA |
| [alexbatalov/ja2](https://github.com/alexbatalov/ja2) | **Complete translation of vanilla to TypeScript** (by the author of fallout2-ce). Electron + Node `fs`, Canvas2D, Web Audio | 315k TS, 555 files | 2019-10 … 2021-04 | SFI-SCLA |
| [Virtastic/ja2-web](https://github.com/Virtastic/ja2-web) | Stracciatella compiled to WASM with Emscripten. Runs at [ja2.virtastic.app](https://ja2.virtastic.app) with the user's data | — | 2026 | Claims GPLv3 (questionable, see §2) |
| [1dot13/source](https://github.com/1dot13/source) | JA2 v1.13, a huge mod with many new systems | 1.7 GB | Active | SFI-SCLA |

The 1.13 mod is not our target: in terms of the scope of its mechanics it is a different game.

**Primary sources:** Stracciatella for the logic and vanilla for checking the original intent.
- The Stracciatella code is noticeably cleaner. It lacks the 104 inline-asm blocks found in vanilla
  (95 in the blitters, 8 in rendering, 1 in LOS).
- Stracciatella's platform layer is a third of the size: SGP is 12k lines versus 41k.
- The item, weapon, strategic map, army and string data in Stracciatella already lives in JSON.

---

## 2. License: what is allowed and what is not

> This is not legal advice, just my reading of the text of `SFI Source Code license agreement.txt`.

**Allowed:**
- using the code for any non-commercial purpose: learning, research, public demos, experiments;
- modifying it and distributing the modifications for non-commercial purposes.

**Required:**
- (clause 3) distribute a derivative work **only with a verbatim copy of SFI-SCLA** and grant no
  broader rights. Hence the project repository as a whole is licensed under SFI-SCLA, and the MIT, GPL
  and Apache licenses cannot be applied to it;
- (clause 4) mark modified files with a prominent notice that the file has been changed, including the date of the changes;
- (clause 1) do not remove copyright and other notices;
- (clause 5) Strategy First automatically receives a royalty-free right to our modifications;
- pass on the disclaimer of warranty (clause 7) and the limitation of liability (clause 8).

**Not allowed:**
- any commercial use: sales, donations for access, advertising and the like;
- distributing the **original game data** (graphics, sound, speech, video, maps,
  `prof.dat`, `.npc`, `.jsd`, `ja2bin.dat`). This is commercial content; SFI-SCLA
  does not cover it.

**What this means for the project:**
- **The stubs must be our own.** They may not be traced over, converted or "extracted"
  from the original. Only then can they be put in the repository.
- Original data is plugged in only locally, from the user's copy:
  File System Access API or drag-and-drop.
- **Do not copy ja2-web code.** The GPLv3 it claims on top of SFI-SCLA contradicts clause 3,
  so the licensing status of that code is murky. Reading it as a source of ideas is fine; porting it is not.
- Changes to Stracciatella after commit `8287b98` have been released into the public domain. Changes
  by Tron, the project's founder, have unknown status. In any case, all of the code grows out of
  SFI-SCLA, so there is a single resulting license: SFI-SCLA.
- The alexbatalov/ja2 code is also under SFI-SCLA; it can be borrowed as long as the notices are kept.
- Stracciatella contains the map `assets/mods/from-russia-with-love/data/maps/A9.dat`,
  declared public domain. Most likely it is a reworked Omerta map, so its
  provenance is dubious. It is fine for local parser tests, but not as
  part of our pack.

---

## 3. Code scale

Lines of code excluding blank lines and comments (cloc):

| Subsystem | vanilla (C) | Stracciatella (C++) | alexbatalov (TS, raw lines) | Comment |
|---|---:|---:|---:|---|
| Tactical | 111k | 100k | 144k | Soldiers, animations, tactical UI, LOS, weapons, items. The largest and most tangled block |
| Strategic | 64k | 50k | 84k | Country map, time, group movement, strategic AI, autoresolve |
| Laptop | 40k | 27k | 53k | AIM, MERC, IMP, email, finances, Bobby Ray |
| TileEngine | 33k | 27k | 44k | Isometric rendering, structures, lighting, radar |
| SGP (platform) | 41k | 12k | 32k | 565 video, blitters, fonts, mouse, buttons, sound, files |
| Utils | 36k* | 9k | 42k | *in vanilla this includes the texts for all languages |
| TacticalAI | 14k | 14k | 19k | Enemy AI. Compact |
| Editor | 23k | 21k | 26k | Map editor, **can be deferred** |
| Root (screens, save/load, init) | 14k | 11k | — | |
| externalized (Stracciatella) | — | 14k | — | JSON content manager, localization, Lua |
| **Total** | **376k** | **~290k + 14k Rust** | **~315k** | |

**What can be dropped or deferred:**

| What | Savings |
|---|---|
| Editor | 21k |
| Debug screens | 3k |
| Lua, mods, Rust config and launcher | ~6k; the Rust VFS is replaced by ~500 lines of TS |
| Smacker videos | ~0.5k + 2.5k of library |
| Variable resolution | We fix it at 640×480 |
| All languages but one | — |

**Remainder ≈ 225k lines of C++.**

Largest files (vanilla):
- `VObjectBlitters.c` (11k, almost all of it asm and its unrolled variants);
- `MapScreen.c` (7k);
- `SoldierControl.c` (6k);
- `Assignments.c` (6k);
- `AnimationControl.c` (5k).

---

## 4. Original resources and stubs

### 4.1. What is in the data

The original consists of 22 SLF archives totaling ~900 MB (the GOG version manifest is in
`stracciatella/assets/externalized/resource_packs/`). About 590 MB of that is
speech, music and video, all of it optional.

| Archive | MB | Contents | Needed to start? |
|---|---:|---|---|
| Speech / Npc_speech | 232 / 182 | Merc and NPC voice-over | No, absence is handled gracefully |
| Music / Intro | 104 / 72 | Music, SMK videos | No |
| Maps | 79 | Sector maps `.dat` | **Yes** |
| Tilesets | 72 | Tiles for 50 tilesets (STI + JSD) | **Yes** |
| Anims | 59 | Animations for all bodies (389 STI) | **Yes** |
| Loadscreens | 27 | Loading screens | No |
| Sounds / BattleSNDS | 19 / 16 | Effects | No |
| Interface / Laptop | 9 / 9 | UI panels, laptop pages | **Yes** |
| Faces / Mercedt / Npcdata | 6 / 4 / 2 | Portraits, texts, NPC scripts | **Yes** (partially) |
| Binarydata | 2 | `prof.dat`, `ja2bin.dat`, `ja2set.dat`, `ja2pal.dat`, EDT texts | **Yes** |
| Fonts / Cursors / Radarmaps / Bigitems / Data / Ambient | ≤2 | Fonts, cursors, minimaps, items | **Yes** (except Ambient) |

### 4.2. Content vs. logic: the main trap

| Category | Formats | Consequence if missing |
|---|---|---|
| **Pure content** | STI/PCX graphics, fonts, cursors, portraits, WAV, SMK, most EDT texts | Ugly, but works |
| **Mixed** | `.dat` maps (level design), JSD (collision, LOS, armor, destruction), JA2SET (tile binding) | No levels, walls are passable |
| **Logic and balance absent from the sources** | **`ja2bin.dat`**: animation scripts, u16[320][100] opcodes interpreted by `Soldier_Ani.cc`. **`prof.dat`**: 170 profiles × 716 bytes, stats, skills, inventory. **`.npc`**: quest and dialogue records. `Locks.bin` | **The mechanic does not exist at all** |
| **Logic already open in JSON** | Items, weapons, army, strategic map, dealers, UI strings (`assets/externalized`, 70 files + 66 string files) | Available, can be used |

This leads to an architectural decision. **The port's canonical data model is JSON**
(profiles, animation scripts, tilesets, structures, NPCs), extending the Stracciatella approach.
The original binary formats are just one more source, for which a
converter is written. Stubs are written by hand or generated directly into JSON.

### 4.3. What is fatal at startup (Stracciatella)

| Stage | What is needed | Behavior when missing |
|---|---|---|
| Startup itself | At least one `.slf` (`rust/stracciatella/src/vfs/mod.rs:259`) and `prof.dat` (`DefaultContentManager.cc:892`) | Both requirements must be removed in our port |
| Main menu | All 70 JSON files; 35 `.npc`; 16 fonts; `b_map.pcx`; `ja2bin.dat`, `ja2prof.dat`, `ja2pal.dat`, `Locks.bin`; `ja2set.dat`; menu STI | Fatal |
| Laptop and AIM | Laptop STI, `email.edt` | Fatal |
| Laptop and AIM | Biographies, item names | Graceful |
| Strategic map | ~43 map STI; radar maps of visited sectors | Fatal |
| Tactical | `.dat` map; all 151 tileset surfaces (even if the map uses 49); animations; portraits | Fatal |
| Tactical | JSD | Optional, but without them there are no mechanics |
| Tactical | Sound, music, loading screens, video | Graceful |

### 4.4. Stub strategy

- **Layered VFS**, as in Stracciatella: our stub pack at the bottom (generated in Node at
  build time and kept in the repository or in CI), optionally the user's original `Data/*.slf` on top.
  The index is built as `Map<lowercase path, {blob, offset, len}>`,
  reads are lazy via `Blob.slice`, archives are never loaded whole.
- **Graphics.** The generator writes real STI files with ETRLE compression and a palette, so the engine
  cannot tell them apart from the original.
  - Tileset: 151 isometric surfaces, colored by category (floor, walls by
    orientation, roofs, debris).
  - JSD are generated from per-category rules: a wall blocks movement and LOS.
  - Soldier: a procedural "capsule" in 8 directions.
  - UI: labeled rectangles of the required sizes. The manifest of sizes and sub-images
    is captured by instrumenting the port: we log every request (file, frame, x, y).
  - Fonts: rasterizing a free (CC0 or OFL) pixel font in glyph-table order.
- **Maps.** Our own small text or JSON map format and a converter to `.dat`.
  The converter also yields test fixtures for the parser.
- **Animation scripts.** We will have to *write them ourselves*: ~40 states for one body type
  (stand, walk, run, aim, shoot, crouch, go prone, die). This is the main risk
  of the stub pack, because the opcode format has to be worked out from `Soldier_Ani.cc`.
- **Nuance:** enemies, militia and our team use `BODY_RANDOM`, i.e. one of
  4 bodies (`Soldier_Create.cc:1145`). For "a single enemy type" these bodies need to be aliased to
  one sprite set.
- **Sound and video.** Nothing, or generated beeps.

### 4.5. Stub pack estimate

These are person-weeks of focused work, not counting the engine.

| Scope | Composition | Estimate |
|---|---|---|
| **Minimal playable slice** | 1 sector, 3–5 mercs, army on a single sprite set | **~11–15 weeks** |
| ↳ | Format writers (STI/ETRLE, PCX, JSD, DAT, EDT, NPC) | ~2 wk |
| ↳ | Fonts, cursors, ~200 interface STI | 3–4 wk |
| ↳ | Tileset, JSD, JA2SET, radar, map converter | 2–3 wk |
| ↳ | Animations, corpses, `ja2bin` scripts (risk!), palettes | 3–4 wk |
| ↳ | Profiles, empty `.npc`, EDT, portraits | 1–2 wk |
| **Full coverage** | All screens, all 389 animation surfaces, all laptop sites, procedural maps for all sectors | **+25–40 weeks** |

Quests and story dialogue will still remain empty. Writing replacements for them is
game design, not stubs.

---

## 5. Engine architecture and porting risks

### 5.1. Platform (SGP)

**How output works:**
- Everything is drawn **in software** into 16-bit RGB565 buffers.
- Art is stored as 8-bit palettized STI with up to 48 shade tables.
- There is a screen-sized `UINT16` z-buffer, dirty-rectangle rendering and background
  save buffers.

**How this maps onto the browser:**
- We keep the blitters in software: `Uint16Array` plus `putImageData` via a LUT, or
  a `UNSIGNED_SHORT_5_6_5` WebGL texture. Judging by ja2-web's experience, the blitters are the hottest spot.
  For 640×480, the speed of JS typed arrays is more than sufficient.
- There are ~46 blitter variants (`VObject_Blitters.cc`) plus z-blitters in `RenderWorld.cc`.
  The port is mechanical but requires bit-exact accuracy.

**Complexity estimate for the rest:**
- Easy: fonts (bitmap STI), mouse regions, buttons, cursors (drawn in software),
  input (mapping DOM keys to SDLK), timers.
- Separate: sound. It is easier to rewrite it on Web Audio (16 channels) than to translate it.
- SGP includes game headers: `MouseSystem` pulls in `Font_Control` and `UILayout`.
  Shims are needed.

### 5.2. Main loop: good news

`GameLoop()` (`GameLoop.cc:109`) is **already single-step**: process input, call the
current screen's `HandleScreen()`, update the screen and the clock. It maps directly
onto `requestAnimationFrame`. Message boxes are a separate screen with callbacks, not a modal
loop (187 call sites).

There are only **five** busy-wait loops that need to be reworked into per-frame state machines.
All of them are zoom animations:
- `StrategicMap.cc:212`;
- `PreBattle_Interface.cc:585`;
- `Auto_Resolve.cc:392`;
- `Laptop.cc:1013`;
- `Laptop.cc:1391`.

About 15 more places force a screen redraw mid-frame (progress bars during
loading). In the browser this is purely cosmetic.

### 5.3. Hazards in translation

- **Global state.** ~2600 mutable global variables, ~830 of them shared
  through headers. The key ones:
  - `Menptr[]` — all soldiers;
  - `gTacticalStatus`;
  - `gMercProfiles[200]`;
  - `gpWorldLevelData[25600]`;
  - `SectorInfo[256]`;
  - `GCM` — the content manager, ~970 references.

  Imported ES module bindings cannot be reassigned, so shared
  mutable module state is kept in an object. Tests need a reset for every module.
- **Integer semantics.** This means ~2160 explicit narrowing casts and reliance on overflow.
  - `Overhead.cc:5182`: a `UINT8` overflows *before* the clamp.
  - `Game_Clock.cc:634`: a `UINT32` underflows inside `max`.
  - Flags using bit 31 require `>>>0`.
  - Division must go through `Math.trunc`, multiplication through `Math.imul`.
- **Unions and struct copying.**
  - `OBJECTTYPE` is a 12-byte union with aliased status fields. It is best kept on a `DataView`.
  - A by-value struct copy in C becomes a reference copy in JS.
  - The order of linked lists (`LEVELNODE`, `STRUCTURE`, `GROUP`) affects rendering and logic.
- **Saves.**
  - ~3000 `INJ_*`/`EXTR_*` macros for explicit serialization.
  - 70 places where a struct is dumped to disk as is (`sizeof`).
  - Record sizes: `SOLDIERTYPE` is 2328 bytes, a profile is 716 bytes.
  - Compatibility with original saves is achievable, and the saves themselves are the best state oracle.
- **Determinism.**
  - In vanilla the random number generator is MSVC's `rand()`; in Stracciatella it is `mt19937` with
    `std::uniform_int_distribution`, whose algorithm depends on the standard library.
  - Cosmetics (face blinking, ambient) draw from the same generator based on real time.
  - In 44 expressions, several `Random` calls sit in unsequenced positions.
  - Thrown-item physics and LOS angles use float and double.
  - Comparing against a reference build will require a small determinism patch to native
    Stracciatella: seed, virtual clock, etc.
- **Dependency graph.**
  - Tactical ↔ TileEngine ↔ TacticalAI ↔ Strategic depend on each other cyclically.
  - The following can be ported and tested in isolation: file formats, SGP, serialization, RNG,
    LOS/PathAI/structures (on a loaded map), strategic movement (with stubs).
  - The tactical core can only be ported as a single block.

---

## 6. Prior art: what others have already done

### alexbatalov/ja2: translating vanilla to TypeScript

The methodology is visible from the commit history, and it is valuable in itself. The translation was done
mechanically, one syntactic step per commit:
1. formatting;
2. renaming files to `.ts`;
3. removing `#include`;
4. replacing `#define` with constants;
5. replacing enums, structs and functions;
6. replacing `->` and `&`, then asm and goto.

This was followed by per-subsystem "Jsify" passes and bug fixing: save
serialization, pathfinding, rendering, sound.

**Pros:**
- All the code is covered, including the editor.
- Strict-mode type checking passes with 0 errors (verified with `tsc 3.7.2`).
- The latest commits fix saves and sound, so the code actually ran on the original data.

**Cons:**
- Outdated TS: namespaces, `outFile`, TypeScript 3.7.
- Electron with `nodeIntegration` and synchronous `fs`.
- Anonymous enum names (`Enum225.ROCKET_LAUNCHER`).
- `Random()` = `Math.random()`, i.e. non-deterministic.
- Based on vanilla, with all its bugs.
- What remains: 26 stub `asm(...)` calls in place of the inline asm (shading, some of the
  blitters), the busy-wait zoom loops and 1816 occurrences of `any`.
- Does not start without the original data.

### Virtastic/ja2-web: Stracciatella in WASM

A ready-made way to play in the browser with the original data. Valuable as a **list of pitfalls**
of the browser environment (`WASM_ADAPTATIONS.md`):
- the main loop;
- busy-wait loops;
- AudioWorklet and the sample rate;
- background tab throttling;
- stack size during map loading;
- scaling of the 640×480 screens.

We do not borrow the code (see §2).

---

## 7. Recommended strategy

### 7.1. Foundation

I recommend a **new modern TypeScript repository**: ESM, Vite for the browser,
Vitest and Node for headless tests.
- **The primary source of logic is Stracciatella.** The bug fixes, the data externalized to JSON and
  the absence of asm matter more than the fact that alexbatalov's translation already exists.
- **We use alexbatalov/ja2 as a Rosetta stone.** In difficult places (blitters,
  serialization, UI screens) we cross-check against the ready-made TS translation of vanilla or use it as a
  draft, keeping the SFI-SCLA notices.

**Alternative, the fastest way to "see it alive":** fork alexbatalov/ja2, replace
Electron and `fs` with a browser VFS and Vite, and run it on the original data. That takes weeks,
not months. But the result is C-style code that would have to be rewritten later anyway,
and without the original data it is useless. This path makes sense as a one-off **spike**
if you have a legal copy of the game: it gives a reference for comparison right in the browser.

### 7.2. Principles

1. **One TS module per `.cc`, the same function and variable names.** Each function
   is tagged `// @src Tactical/LOS.cc:3110`. A script compares the list of C++ functions with
   the list of ported ones and shows coverage.
2. **Helpers for integers and fixed-width fields.** The functions
   `u8/i8/u16/i16/u32/i32/idiv/f32` plus struct fields backed by typed arrays, so that
   assignment to an `INT8` overflows as in C.
3. **World data as struct-of-arrays.** Per-cell scalars live in `Uint16Array(25600)`
   and the like; level lists are stored as objects.
4. **An exact, saveable RNG.** Cosmetic randomness comes from a separate stream.
5. **Headless build in Node:** fake video, fake sound with durations taken from
   WAV headers, scripted input.
6. **Layered VFS + JSON as the canonical data model + a stub generator in Node** (§4.4).
7. **Oracles in increasing order:**
   - byte-for-byte save round-trip (samples are in `stracciatella/assets/unittests/saves`);
   - porting ~160 gtest cases;
   - scenarios with byte-for-byte `.sav` comparison against the native build;
   - comparison of 565 frames.

### 7.3. Milestones (vertical slices)

| Milestone | Contents | Source size | Complexity |
|---|---|---:|---|
| **M0** Formats and viewer | SLF/VFS, STI/ETRLE, PCX, JSD, `.dat` (reading); STI stub generator; a viewer page for sprites, tiles and maps | ~4k | S |
| **M1** Platform and main menu | SGP on canvas: video, blitters, fonts, mouse, buttons, cursors, sound. GameLoop, the menu, options and message box screens. All on stubs | ~16k | M |
| **M2a** Static tactical rendering | TileEngine: world, rendering, structures, lighting, radar, z-blitters | ~14k | L |
| **M2b** One merc walks | Soldiers, animations, pathfinding, Overhead, tactical UI, cursors, panels | ~42k | XL |
| **M3** Turn-based combat and AI | LOS, weapons, bullets, AP, OppList, turns, items, explosions, physics, morale, all of TacticalAI | ~52k | XL |
| **M4** Strategy | Country map, clock and events, group movement, strategic AI, militia, loyalty, autoresolve | ~50k | XL |
| **M5** Laptop | AIM, MERC, email, finances, history, personnel, then Bobby Ray, IMP and the rest | ~25k | L |
| **M6** Saves | Compatible with the original. Done alongside all milestones | ~7k | M |
| **M7** Story | NPCs, dialogue, quests, meanwhile scenes, merchants, ending | ~20k | L |

The first "wow moment" is the end of M2b: a capsule merc walks across a generated map.

---

## 8. Effort estimate (order of magnitude)

| Work | Manual, full-time | Comment |
|---|---|---|
| Translating ~225k lines + debugging | ~3–4 person-years (at 250–400 lines/day including debugging) | At a hobby pace that is more than 10 years, so it is **infeasible without leverage** |
| Translation with an LLM assistant | Mechanical translation is many times faster; the bottleneck becomes **verification and debugging** | Realistically ~1–1.5 years at a hobby pace to playable tactics (M3) |
| Platform and browser layer | ~2–3 mo. | Almost independent of the choice of foundation |
| Stub pack: minimal | ~3–4 mo. | §4.5 |
| Stub pack: full coverage | +6–10 mo. | §4.5 |
| Story content for the stubs | Open question | Game design, not porting |

Conclusion: the project is **feasible only with strict slicing into vertical slices**, with
LLM-assisted translation and automated cross-checking against a reference. A full campaign on
stubs is a horizon of years. Playable tactics on a single map is a horizon of months.

---

## 9. Decisions to be made

> **Update 2026-10-15.**
> - We have a copy of the game.
> - Decided to port **the logic, not the code text**: our own architecture, behavior as in the
>   original. This removes the "new port or alexbatalov fork" choice; his code remains
>   only a reference.
> - Language: TypeScript.
>
> Details are in [`01-architecture.md`](01-architecture.md). The estimates in §3 and §8 applied
> to a literal port. When porting the logic, the volume of "translation" is smaller, but the UI and rendering
> are written from scratch.
>
> **Update 2026-10-15, later.**
> - Data: Steam version 1.12 in `/home/daniel/Jagged Alliance 2 Gold/Data`.
> - Game state lives on the server (Node); the browser is a client. Agents play through an API (MCP).
> - An instant mode and speed-up are needed. See [`04-time-and-server.md`](04-time-and-server.md).

1. **Is there a legal copy of JA2** (GOG or Steam)? Without it there is no reference to cross-check against,
   and native Stracciatella cannot be run. Stubs are needed in any case.
2. **Foundation:** a new port from Stracciatella (recommended) or a fork of alexbatalov/ja2.
3. **TypeScript or plain JS.** I recommend TS (strict): with 2000+ narrowing casts
   and 400 fields in `SOLDIERTYPE`, types pay for themselves.
4. **Localization.** I recommend one, English. Stracciatella's strings already live in JSON
   in 8 languages, including Russian, so Russian can be enabled later almost for free.
5. **Git:** the project is not a repository yet. `reference/` has already been added to `.gitignore`.

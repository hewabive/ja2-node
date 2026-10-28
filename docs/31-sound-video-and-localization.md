# 31 — Sound, music, video and localization

**Scope.** Sound and music (`src/content/audio/`, `src/audio/`, `src/protocol/music*.ts`), video and credits
(`src/content/formats/smk.ts`, `credits.ts`, `src/app/video/`), localization. Siblings: `27` §1–§2 (saves, options),
`32` §1–2 (stubs, performance). UI sound and the canvas credits, faces and lip-sync: `30` §8, `30` §1.8, `30` §2.5.

**Conventions.** Paths without a prefix are relative to `reference/stracciatella/src/game/`; `src/sgp/…`,
`src/externalized/…`, `rust/…`, `assets/…` and `dependencies/…` to `reference/stracciatella/`. ja2-node paths start
with `src/`, `data/`, `stubs/` or `tools/`. "(inferred)" marks conclusions not traced end to end.

---

## 1. Sound and music

### 1.1 The original's sound system

**Mixer** (`src/sgp/SoundMan.cc`): miniaudio decoding (WAV, OGG through stb_vorbis, `:33-46`); 16-bit stereo output at
the device rate (`:85-88`); **16 channels**, a new sound dropped when all are busy, none stolen (`:82`, `:243-244`); a
128-entry sample cache with least-hits eviction (`:81`, `:809-831`); files over 1 MB streamed (`:91`). Volume 0–127
(`src/sgp/SoundMan.h:9`); pan 0 (left) – 127 (right), a **linear balance** `vol_l = vol·(127−pan)/127`
(`src/sgp/SoundMan.cc:928-946`). The end callback fires for stopped sounds too (`:571-589`); `loop = 0` plays once in
Stracciatella (`:533-538`). No master volume; categories effects, speech and music, each 0–127, default 63
(`GameSettings.cc:138-141`).

**Effects** (`Utils/Sound_Control.cc/.h`): 291 sound ids (`Utils/Sound_Control.h:28-324`) → 237 paths under `sounds/`
(`Utils/Sound_Control.cc:17-310`); 14 ambient ids (`Utils/Sound_Control.h:334-352`). `PlayJA2Sample` scales by
`CalculateSoundEffectsVolume(v) = (v·vol + 63)/127` (`Utils/Sound_Control.cc:336-352`, `:456-459`);
`PlaySoldierJA2Sample` skips unseen soldiers on request and scales twice (`:409-420`, a quirk). **Positional rules**:
`SoundVolume(base, grid)` = `base` on screen, `max(25, base − 25)` off screen, no falloff (`:555-592`); `SoundDir(grid)`
= 64 within ±64 px of the screen centre, 48 or 80 within half the view, 1 or 126 beyond (`:499-552`). Looping positional
sounds (10 slots, linear falloff over 1.5 views, `:601-844`) serve only the creature queen's ambient noise
(`Tactical/Soldier_Control.cc:574`). Constants: pans 0/48/64/80/127, volumes 25/40/65/127
(`Utils/Sound_Control.h:10-21`).

**What plays what:**

| Source | Rule | Where |
|---|---|---|
| Animation opcodes 700–798 | fall, footsteps, splats, lock-and-load (weapon's `sLocknLoadSound`), throwing knife, creature steps and attacks, falls to ground (721/722, beside the fragile-item damage the simulation ports), swooshes, death battle sound (732), stance changes 773–776 (not in stealth), pick-up 777, deep water, cows, crows, mortar, fence | `Tactical/Soldier_Ani.cc:1963-2540`; random idle sounds `:1492-1498` |
| Footsteps | by terrain under the soldier (`WALK_LEFT_OUT`, `_IN`, `_ROAD`, water, swim, crawl); a variant other than the last (`ubLastFootPrintSound`, saved); LOW volume in real time unless selected | `Tactical/Soldier_Control.cc:8820-8887` |
| Gunfire | `silencedSound` with a silencer, else `sound`; a burst plays one file, `burstSound` formatted with the rounds left, falling back to the single shot or `bursttype1`; a jam stops it and plays the dry fire | `Tactical/Weapons.cc:543-644`; per-calibre defaults in `calibres.json`; `Tactical/Soldier_Ani.cc:669-676` |
| Reload | per weapon class | `Tactical/Items.cc:1291-1294`, `src/externalized/WeaponModels.cc:770-1206` |
| Impacts and misses | bullet or knife impact, then `BATTLE_SOUND_HIT1`; misses by kind; glass; per-material structure hits | `Tactical/Soldier_Control.cc:2846-2873`, `Tactical/Weapons.cc:1709-1755`, `:1942`, `TileEngine/Structure.cc:68-96` |
| Battle sounds | 17 kinds with variants; 2 s repeat filter; critical ones cut speech; `battlesnds/<voice>_<name>.wav`, generic `bad`/`kid`/`m_`/`f_` sets for soldiers without a profile; option `MUTE_CONFIRMATIONS` drops OK; morale < 35 → low-morale variants | `Tactical/Soldier_Control.cc:138-157`, `:5866-6115` |
| Explosions | one of the animation's candidate files | `TileEngine/Explosion_Control.cc:231-233`, `explosion-animations.json` |
| Doors and openables | open by door kind (wood, cloth, garage, metal) when the opener makes door noise; close delayed to the animation key frame; locks: unlock, key failure, broken lock, electricity | `Tactical/Handle_Doors.cc:936-1032`, `TileEngine/Structure.cc:1868-1883`, `Tactical/Keys.cc:176-576` |
| Items | drop, attach, canteen, throw impacts, mortar whistle, vehicles | `Tactical/Soldier_Ani.cc:2338`, `Tactical/Items.cc:1570-1577`, `TileEngine/Physics.cc:432-1974`, `vehicles.json` |
| UI | button clicks by screen scheme at volume 15; A.I.M. static; I.M.P. voice preview | `src/sgp/Button_Sound_Control.cc:11-111`, `Laptop/AIMMembers.cc:1951-2054`, `Laptop/IMP_Voices.cc:249-250` |

**Ambient** (`TileEngine/Ambient_Control.cc`): the tileset's ambient id (from `ja2set.dat`) selects `ambient/<id>.bad`:
a count and up to 100 entries `{minTime, maxTime, timeCategory, file, volume}` (`TileEngine/Ambient_Types.h:7-22`),
scheduled as ranged strategic events per time of day (dawn 6:47–7:05, day –20:57, dusk –21:15, night –6:47;
`TileEngine/Environment.cc:26-34`, `:289-316`), played by `SoundPlayRandom` with real-time gaps
(`src/sgp/SoundMan.cc:289-443`). None in basements and caves (`TileEngine/Ambient_Control.cc:41-60`). Rain and thunder
are dead code (`TileEngine/Environment.cc:160-183`).

**Music** (`Utils/Music_Control.cc`; modes `src/externalized/content/ContentMusic.h:3-17`; tracks `music.json`, in
`data/externalized`): `NONE`, `RESTORE`, `MAIN_MENU`, `TACTICAL_NOTHING`, `TACTICAL_ENEMYPRESENT`, `TACTICAL_BATTLE`,
`TACTICAL_VICTORY`, `TACTICAL_DEFEAT`, `LAPTOP` and three creature variants replacing nothing/enemy-present/battle while
`gfUseCreatureMusic` is set (`Utils/Music_Control.cc:268-286`; set by `PrepareCreaturesForBattle`,
`Strategic/Creature_Spreading.cc:808-828`).

- Track: `Random(count)` on the gameplay generator (`src/externalized/DefaultContentManager.cc:1097-1105`).
- No fade-in (`Utils/Music_Control.cc:314-316`); fade-out one volume step per 10 ms (`:147-178`), five times faster on
  sector entry and exit (`Strategic/StrategicMap.cc:529`, `:1842`).
- Track end (`Utils/Music_Control.cc:182-210`): the next random track of the mode; after the victory track the mode
  becomes `TACTICAL_NOTHING`; after the defeat track the sector is unloaded and nothing starts.
- Starting a victory track above ground clears `gfUseCreatureMusic` (`:289-295`).
- `SetMusicMode` remembers the replaced mode; `RESTORE` returns to it. The mode is saved (`SaveLoadGame.cc:1827`,
  `:1964`); the previous mode is a process static.
- Where modes are set (the map screen never sets one: whatever played continues):

| Mode | Set when |
|---|---|
| `NONE` | splash, intro, leaving the game init screen, restart |
| `MAIN_MENU` | main menu, loading a save (until the sector's mode applies), meanwhile scenes |
| `LAPTOP` | entering the laptop; leaving restores the previous mode (`Laptop/Laptop.cc:446`, `:551-561`) |
| `TACTICAL_NOTHING` | sector entry without hostiles, a battle ending without a fight, retreat, boxing exit, creature town attack (`Strategic/StrategicMap.cc:524-531`, `Tactical/Overhead.cc:4636`) |
| `TACTICAL_ENEMYPRESENT` | an enemy placed in an untouched sector without known enemies, outside the game start and meanwhile scenes (`SetEnemyPresence`, called by `AddSoldierToSectorGridNo` and `EnterCombatMode`, not by a sighting); leaving combat with enemies left; the first helicopter drop; the PBI; the end of a meanwhile (`Tactical/Overhead.cc:4080`, `:4124`, `:4369`, `Tactical/Soldier_Add.cc:928`) |
| `TACTICAL_BATTLE` | entering combat (`Tactical/Overhead.cc:3974-3979`); a sighting in combat while no music plays (`Tactical/OppList.cc` `OurTeamSeesSomeone`) |
| `TACTICAL_VICTORY` | a won tactical battle unless the last kill was a monster, an autoresolve win, the Queen's death (`Tactical/Overhead.cc:4598-4603`, `Strategic/Auto_Resolve.cc:1298`, `Tactical/End_Game.cc:163`) |
| `TACTICAL_DEFEAT` | a lost tactical battle, autoresolve loss or surrender (`Tactical/Overhead.cc:4478`, `Strategic/Auto_Resolve.cc:1319-1330`) |

**Speech** (`src/externalized/content/Dialogs.cc:52-109`): mercs `speech/<voice>_<quote>.wav`; NPCs and unhired
R.P.C.s `npc_speech/<id>_<quote>.wav`; alternate dialogue `npc_speech/d_…`; Russian R.P.C.s `speech/r_…` (§3.1).
Played at speech volume with a lip-sync list from the matching `.gap` file (`{start, end}` ms pairs,
`Tactical/Gap.cc:13-120`); the mouth frame is `Random(6)` every 120 ms (`Tactical/Faces.cc:1057-1067`).

### 1.2 The data

The user's data (formats only; nothing copied): `Sounds.slf` 370 WAV (PCM, mono and a few stereo, 8 and 16 bit,
11.025/22.05/44.1 kHz, up to 17 s); `BattleSNDS.slf` 1,581 WAV, almost all **IMA ADPCM** (format tag 0x11, 4-bit,
22.05 kHz mono); `Speech.slf` 5,774 and `Npc_speech.slf` 2,794 WAV, all IMA ADPCM, nearly each with a `.gap` file (8,353
in all); `Music.slf` 14 WAV, PCM 16-bit stereo 22.05 kHz, up to about two minutes; `Ambient.slf` 9 WAV and one `.bad`
table (`ambient/0.bad`, ten entries); `Laptop.slf` the laptop sounds; two loose `stsounds/*.wav`. Speech and music
(about 500 MB) are fetched lazily per file through `/vfs`, never bundled. Browsers decode PCM WAV natively, but
`decodeAudioData` does not reliably support IMA ADPCM WAV (inferred from the Chrome and Firefox codec lists), so
ja2-node decodes WAV itself; every WAV of `sounds.slf`, `battlesnds.slf` and `music.slf` and every `.gap` file decodes.

### 1.3 Presentation rules

**Nothing in `sim` plays, waits for or draws on behalf of sound** (D2, D13, D14). The client derives every sound from
what it already receives: view frames, the event log (`29` §9), the animation timelines it plays (`01` §3.4).
Headless sessions and agents produce no audio; the outcome is the same with sound on, off or absent. The one audio fact
the simulation reads is data: each voice sample's length, measured from the WAV headers into the rule pack
(`@rules/speech/lengths.json`, `src/content/audio/speech-lengths.ts`), which times conversation lines (`24` §10.2).

**Cosmetic choices** (variants, ambient gaps, footstep alternation, music tracks, the miss curse's `Random(40)`) draw on
a client PRNG (`ClientRandom`, `src/audio/client-random.ts`, seeded from the session id by `seedFromText`), never on a
simulation stream; per-soldier presentation memory is the client's (§1.4, `director.ts`).

**Where the original's gameplay depends on sound:**

| Original coupling | ja2-node |
|---|---|
| A quote ends when its sample stops (`Tactical/Faces.cc:627-629`), plus 300 ms | the longer of the voice length and the text timer, then 300 ms; the viewer that finished first ends it through `skipLine` (deviations "Speech", `24` §10.2) |
| A quote waits for the speaker's battle sound (`Tactical/Dialogue_Control.cc:632-637`); critical battle sounds cut speech (`Tactical/Soldier_Control.cc:5973-5980`) | the simulation never waits and is never cut ("Speech"); the client still stops the playing voice on a critical battle sound ("Speech playback") |
| The defeat track's end unloads the sector (`Utils/Music_Control.cc:188-193`), in parallel with a 10 s timer (`Tactical/Overhead.cc:4378-4381`) | the 10 s timer only (`src/sim/campaign/battle-flow.ts`) |
| Skyrider's destruction runs in a sound's end callback (`Strategic/Map_Screen_Helicopter.cc:1041-1044`) | at once (deviations "Helicopter destruction") |
| `EVENT_AMBIENT` events carry sound-cache slots in the saved queue (`Strategic/Game_Event_Hook.cc:101`) | not queued, dropped on import ("Ambient sound events") |
| Sound picks draw on the gameplay generator: `SoundRange`, footstep variants, battle-sound variants, explosion sounds, door sounds, the music track, ambient timing, mouth frames, cows, crows, bloodcat growls | not drawn, or drawn from the client PRNG ("Cosmetic draws …", "Footstep variants", "Music track choice") |
| The first helicopter drop waits for the engine sound to fade before unlocking and calling in enemies (`Tactical/Merc_Entering.cc:529-562`) | the drop sequence is not ported: `INSERTION_CODE_CHOPPER` places the mercs at the north entry point at once (gaps "Helicopter entrance"); once ported, its end must follow the script's ticks, never a fade |

**Event facts for sound**: optional event fields, never state, never read back by the simulation (catalogue: `29` §9):
`shotFired {item, silenced, burst, rounds}` (`rounds` = the burst size on a burst's first bullet, 0 on the others, 1
for a single shot), `bulletStopped {material, caveWall}`, `explosion {animation}` (the water variant when shown),
`doorChanged {kind: wood | cloth | garage | metal, noisy}` (`noisy` = the opener's door noise at code 495),
`reloaded {soldier, item}`. Soldier views carry `voice` (the profile's voice id as three digits, I.M.P. voices included,
or the generic `badN`/`kidN` set) and `bodyType` (the `m_`/`f_` fallback). Sessions attach the events drained during an
advance to the view frame of their tick (`ViewFrame.events`). Terrain under a soldier comes from the client's own world
model. A source the squad does not see plays from where the squad hears it (`heard`, `src/content/audio/heard-place.ts`;
deviations "Sounds out of sight").

### 1.4 Sound in ja2-node

**Data**, transcribed by `tools/transcribe/sound-effects.ts`; each file's `format` field describes its fields:

- `data/tables/sound-effects.json`: `sounds` in `SoundID` order with a VFS path (null where the original has none);
  `ambient` in `AmbientSoundID` order; `files`, the paths the game code names literally; the pan and volume constants.
- `battle-sounds.json`: `kinds` in `BattleSound` order with `randomVariants` = `ubRandomVal`, `badGuy`,
  `dontAllowTwoInRow`, `stopDialogue` (0 never, 1 cuts speech, 2 skipped while talking); the 2000 ms repeat filter; the
  low-morale threshold 35.
- Weapon, explosion and vehicle sounds: `weapons.json`, `calibres.json`, `explosion-animations.json`, `vehicles.json`
  in `data/externalized`.

**Content** (`src/content/`, DOM-free, unit-tested):

| Module | Content |
|---|---|
| `formats/wav.ts` | RIFF/WAVE: PCM 8/16-bit and IMA ADPCM (0x11) → `Float32Array` per channel; `readWavInfo`, `wavDurationMs` from the header; other tags fail with a clear error |
| `formats/gap.ts`, `formats/ambient.ts` | `.gap` `{start, end}` pairs (8 bytes each); `.bad` tables (an `INT16` count and 116-byte entries `{minTime, maxTime, timeCategory, file[100], volume}`, at most 100) |
| `audio/sound-position.ts` | `soundVolume`, `soundDir`, `positionSoundVolume`, `scaleVolume` = `trunc((v·setting + 63)/127)`, the mixer's linear balance `trunc(vol·(127−pan)/127)/128` per side |
| `audio/cue.ts` | a cue `{file, baseVolume, mix, bus, gridNo, pan, loops}`; `mix` encodes how the original computes channel volume and pan: `location` (`PlayLocationJA2Sample`), `soldier` (`PlaySoldierJA2Sample`, effects scaling twice), `fixed`, `panned` (misses: fixed volume, `SoundDir` pan), `voiceOwn`/`voiceOther` (battle sounds at speech volume, `SoundVolume` for other teams), `creatureVoice`, `speech`, `ambient`, `music`, `positionLoop`; buses effects, speech, music, ambient |
| `audio/sound-table.ts`, `audio/cue-book.ts` | the two tables; sound ids, battle sounds, weapon sounds with calibre defaults and reload/lock-and-load per weapon class, explosion candidates |
| `audio/cues.ts` | footsteps by terrain, gunfire with burst names and the single-shot and `bursttype1` fallbacks, dry fire, reload, lock and load, impacts, misses, material hits, explosions, doors by kind, lock outcomes, door traps, drops, codes 700–798, laptop power |
| `audio/battle-sound.ts` | substitutes for creatures, animals and the robot, the 2 s filter, the still-playing and talking rules, mute confirmations, low-morale variants, variants, the `_dying` and `m_`/`f_` fallbacks |
| `audio/speech.ts` | the speech file of a spoken line (the Russian `r_` prefix) |
| `audio/ambient-schedule.ts` | time windows; gaps `min + Random(max − min)` ms on the client PRNG; silence in basements and caves |
| `audio/idle-sounds.ts`, `audio/creature-call.ts`, `audio/heard-place.ts` | code 491 idle sounds counted from the passes of the loop that holds it (the server sends no frames of a predictable loop); creature cry codes 707 and 717; the tile an unseen sound plays from |
| `audio/speech-lengths.ts`, `audio/music-table.ts` | voice lengths for the rule pack (§1.3); `music.json` |
| `anim/timeline-follower.ts` | the script codes passed between two view snapshots of a soldier: within a state, across loops and into the next state, keeping the old tail only when it ends or jumps there within two frames |

**Audio layer** (`src/audio`, browser; imports `content` and `protocol` only):

- `engine.ts` (`AudioEngine`): buses effects, speech, music and ambient into a master gain; `MAX_VOICES` 16, a new voice
  dropped when all are busy; two gains per voice for the linear balance (not `StereoPannerNode`, whose equal-power law
  differs), a splitter for stereo files; an LRU of 128 decoded buffers (`buffer-cache.ts`, like the original's cache);
  the own WAV decoder; lazy `/vfs` loads, missing and undecodable files counted and never refetched; nothing starts at
  master or channel volume 0; unlock on the first gesture; sample rate from the device; `playBuffer` for one-shot
  decoded audio (video sound, §2.4).
- `director.ts` (`SoundDirector`): frames, events and replayed animation codes → cues; per-soldier presentation memory
  (timeline position, last footstep variant, battle-sound memory and voice, death cry played, last weapon and attack
  kind); a speech queue (developer pages; on `/play` the speech presenter `src/ui/speech.ts` owns voice and subtitle,
  `30` §2.8); ambient scheduling from the tileset's table and the view's world clock (noon for a session without one,
  the sandbox); frames more than 100 ticks behind the newest applied one (`CATCH_UP_TICKS`) update the memory silently,
  so a skip or a manual advance does not replay its sounds.
- `positional.ts`: the listener from the client camera and view size; the creature queen's positional loop while she is
  in view (deviations "Queen's positional sound").
- Wiring: `src/app/sound/tactical-sound.ts` (`TacticalSound`, for the tactical host of `/play` and the devtools
  tactical page; `window.__ja2Audio` exposes the engine counters, the director's statistics and the last files);
  `src/app/sound/strategic-sound.ts` (laptop power sounds, `window.__ja2Music`); `src/app/game/ui-audio.ts` (the
  engine of `/play`).

### 1.5 Music in ja2-node

**The music mode is player-visible state, so the server computes it** (deviations "Music mode on the server"); the
client only chooses tracks and fades.

- **Modes** (`src/protocol/music-modes.ts`): the twelve `MusicMode` values in the native byte order (`ContentMusic.h`;
  `musicModeOfNativeByte`); the `music.json` key of each playable mode (`MUSIC_TRACK_KEYS`); the creature variants of
  nothing, enemy present and battle (`CREATURE_VARIANTS`); the end rules (`nextTrack`; victory track `thenNothing`;
  defeat track `thenSilence`); the 10 ms poll step (`MUSIC_OVERHEAD_MS`); the fade steps 1 and 5.
- **`musicMode(prev, events, facts)`** (`src/protocol/music.ts`, pure). `setMusicMode` reproduces `SetMusicMode`: any
  set remembers the replaced mode as `previous`; `RESTORE` returns to it, but to the nothing mode after the victory or
  defeat track. Events apply in order; the facts are read from the session after the events (`MusicFacts`: the creature
  flag, combat, whether a sector is loaded, the loaded sector's hostiles (`NumHostilesInSector`), the game start):

| Event | Mode set |
|---|---|
| `sectorLoaded {hostiles, enemyPresence?, firstArrival?}` | enemy present if `SetEnemyPresence` fired while loading; then the entry rule: if `mode == ENEMYPRESENT ? hostiles == 0 : mode != BATTLE` → nothing with a fast fade; then enemy present for the first helicopter drop |
| `enemyPresence` | enemy present (later presence, such as reinforcements arriving in an untouched sector) |
| `combatStarted`; `enemySighted` in combat while no music plays | battle |
| `combatEnded` | `lull`: enemy present; `lost`: enemy present after a battle, then defeat; `won`: enemy present after a battle, then nothing without a fight, victory if the last kill of a merc was no monster (`fought`, `monsterKill`); `boxing`: enemy present after a battle, then nothing |
| `preBattle` | enemy present, twice (`PrepareForPreBattleInterface` and `InitPreBattleInterface` both set it; once for an automatic creature attack) |
| `retreated` from the prebattle screen | nothing |
| `arBattleOver` | victory; defeat for defeat, surrender and capture |
| `laptopOpened`, `laptopClosed` | laptop; restore, or the laptop again before the first landing |
| `meanwhile` (a resolved scene) | menu, then with a loaded sector enemy present if hostiles and the entry rule |
| `meanwhileStarted`; `meanwhileEnded` of the interrogation | menu, then with a loaded sector the entry rule (N7); enemy present |
| `queenKilled`, `creatureQueenKilled` | victory |
| `squadMovedUpstairs` | enemy present, victory, victory |
| `creatureAttack` | nothing |
| `mercsLeftSector {mapScreen}` | nothing with a fast fade |

- **Simulation facts.** The sector flow records through `SectorHooks.enemyPresence` whether `SetEnemyPresence` fired
  while loading, outside the game start and meanwhile scenes. `turn.lastMercKill` ports `gLastMercTalkedAboutKilling`
  (the enemy killed by a merc's attack; deviations "Last kill talked about"). The creature battle setup sets
  `useCreatureMusic` as `PrepareCreaturesForBattle` does (the map's light colour has blue, creatures in the level, a
  town attack); the simulation clears it when the victory mode is set above ground (a fought tactical battle won
  without a monster as last kill, an autoresolve victory, the queens' deaths, the move upstairs), so native saves and
  ours carry the same flag (deviations "Creature music clear").
- **Session state.** `Session` keeps `music {mode, previous}` beside the simulation, starting at: none for a new
  campaign, then the events of its creation (the new game's laptop, the landing; held for the next report); enemy
  present or nothing for a sandbox (as entering a sector); the saved byte for a native import (`SaveLoadGame.cc:1827`),
  the menu as previous (the load sets the menu first); the file's `presentation.music` for a ja2-node load. The drained
  events update it after every captured frame. `welcome` carries `music {mode, creature}`; frames carry it when the
  mode or the flag changes (`fastFade: true` on the frame of a fast change); `observe` and the simulation's own view
  carry none. A command's change shows with the next advanced frame.
- **Client player** (`src/audio/music.ts`, `MusicPlayer`; built by `src/app/net/music.ts` with a `ClientRandom` seeded
  from the session id): a new mode fades the playing track out one volume step per `poll()` (pages poll every 10 ms;
  five steps after a sector entry or exit), then at once starts a track of the new mode, chosen with the client PRNG, at
  the music volume. A track's end starts the next random track of the mode; the victory track switches the player (not
  the server) to the nothing mode; the defeat track ends in silence. The creature flag picks the creature tracks when a
  track starts. Music volume 0 (or mute) stops the music, raising it starts it again, as `MusicSetVolume` does.

### 1.6 Speech

On a quote event with a text key (`mercQuote`, `npcQuote`, conversation lines, `civQuote`) the client resolves the file
by the `Dialogs.cc` rules (`src/content/audio/speech.ts`) and plays it on the speech bus; the next line waits for the
sample, a simulation-side line end never cuts it, a critical battle sound of the same speaker still stops it
(deviations "Speech playback"). Subtitles are a client setting; the text comes from the event's resolved text or
`/api/text` (§3.2). Lip-sync from the `.gap` files and the mouth frames belong to the canvas faces (`30` §2.5).

### 1.7 Stubs

The stub sounds, music and speech blips (`32` §1.7) are synthesized originals named like the original paths (`32` §1.4),
so the cue tables and `music.json` resolve unchanged; one synthesized file serves many names through the stub alias
manifest. `stubs/ambient.ts` writes `ambient/0.bad` for the stub tileset with own entries (birdsong, owl, crickets)
aliasing the synthesized ambient classes. The stub walking, running, swatting and crawling scripts carry 703/704, the
stance transitions 773–776, the pick-up scripts 777 (the simulation ignores these codes). Missing files are skipped
silently, as the original skips failed plays.

### 1.8 Quirks kept, deviations and limitations

**Quirks kept** (§1.1): 16 voices, a new sound dropped when all are busy; linear balance panning; off-screen sounds 25
quieter, floor 25, no distance falloff; no footstep variant twice in a row; the 2 s battle-sound repeat filter; soldier
sounds scaled twice (`mix: 'soldier'`; audible only as quieter soldier sounds); no music fade-in; the map screen keeps
whatever plays; victory falls back to the nothing mode, defeat to silence; the laptop restores the previous mode.

**Deviations** (`deviations.md`): "Music track choice", "Footstep variants", "Speech playback", "Ambient timing",
"Sounds out of sight", "Queen's positional sound", "Idle sounds of unseen animals", "Music mode on the server", "Last
kill talked about", "Creature music clear", "Ambient sound events".

**Limitations.** Not played yet (gaps "Sound coverage"): a driving vehicle's movement sound and a turning tank's
turret (nothing drives a vehicle or turns a tank in tactical; `vehicleMoved` does not exist), a vehicle's battle
sounds; the boarding sound plays on the map screen at full volume. Button click schemes
(`src/sgp/Button_Sound_Control.cc:11-50`) belong to the canvas UI (`30` §8).

---

## 2. Video

### 2.1 The original

**The videos** are Smacker files named in `Intro.cc:34-78` (`INTRODIR` = `intro`, `Directories.h:14`): four for the
beginning (`rebel_cr`, `omerta`, `prague_cr`, `prague`), five for the ending (`throne_mig` or `throne_nomig`,
`heli_flyby`, `heli_sky` or `heli_nosky`), the splash (`splashscreen`) and a TalonSoft logo that is never played
(`talonsoftid_endhold`, `Intro.cc:322`, commented out). Only `Intro.cc` uses SMK: the A.I.M. video conference is the
animated face system with STI static (`Laptop/AIMMembers.cc:1619-1627`, `:1866-1899`); a new game's helicopter drop is
a tactical animation (`Tactical/Merc_Entering.cc:686-700`); meanwhile scenes are tactical scenes (`26` §1.6).

**Sequences** (`GetNextIntroVideo`, `Intro.cc:252-329`; the mode enum `Intro.h:12-18`):

| Sequence | Videos | Started by | Followed by |
|---|---|---|---|
| `INTRO_SPLASH` | the splash | process start, English and Chinese versions only (`src/sgp/SGP.cc:441-444`); other versions blit an MLG splash picture (`JA2_Splash.cc:17-25`) | the Sir-Tech logo picture (`Intro.cc:364-370`), then the main menu after 500 ms (`JAScreens.h:8`) |
| `INTRO_BEGINING` | the four beginning videos in order (`Intro.cc:262-278`) | every new game, after the game init options screen (`GameInitOptionsScreen.cc:725-730`); in Dead is Dead mode after the save screen (`:722-723`, `SaveLoadScreen.cc:1476-1494`) | `INIT_SCREEN` → `InitNewGame` → the laptop (`Intro.cc:229`, `JAScreens.cc:181-185`) |
| `INTRO_ENDING` | Miguel's throne video by `gMercProfiles[MIGUEL].bMercStatus == MERC_IS_DEAD`, the fly-by, Skyrider's helicopter video by the same test on SKYRIDER (`Intro.cc:289-311`) | `DoneFadeOutEndCinematic` (`Tactical/End_Game.cc:351-366`, `26` §6.7) | `ReStartingGame()` and the credits (`Intro.cc:239-245`), then the main menu (`Credits.cc:169-186`) |

No setting turns the intro off: the beginning sequence plays on every new game and can only be skipped. Skipping
(`Intro.cc:199-217`, on key up): Escape ends the sequence, Space or any mouse button the current video. While a sequence
plays the screen is black, the cursor hidden and the music off (`Intro.cc:126-134`).

**Playback** (`Utils/Cinematics.cc`, called only by `Intro.cc`): the file read whole, decoded by libsmacker
(`:200-209`); all audio tracks decoded up front into buffers and started with the video (`:122-178`); frames paced by
the wall clock, late frames decoded but not shown (`:259-271`); each frame, an 8-bit image with a 256-colour palette,
converted to 16-bit and blitted 1:1 at the screen centre, unscaled (`:282-316`, `UILayout.cc:13-14`). A missing or
broken file is logged and skipped, so a sequence with no files exits at once (`Utils/Cinematics.cc:193-219`,
`Intro.cc:339-342`).

**Credits** (`Credits.cc`): `interface/credits.sti` with blinking faces; the text from `binarydata/credits.edt` (rows of
80 characters, `src/externalized/strings/EDT.h:61-65`, whose comment says 496 rows; the English Gold file has 248, and
row 0 is never read because the record counter is incremented before the first read) with inline `@` control codes for
gaps, speed, justification and colours (`Credits.cc:44-58`, `:460-502`), scrolled 1 px every 25 ms (`:71-76`); 15
hoverable faces with names from the compiled strings (`:108-127`, `Utils/Text.h:212-214`). The main menu reaches the
credits too (`MainMenuScreen.cc:217-220`).

### 2.2 The data

The user's Steam 1.12 data (formats only): the eleven videos are in `Intro-old.slf`, library path `intro\`; the Steam
package appears to rename it so that its own executable skips the intro (inferred). Stracciatella mounts every SLF it
finds (`rust/stracciatella/src/vfs/mod.rs:129-150`, library path from the header,
`rust/stracciatella/src/vfs/slf.rs:62`), as does ja2-node (`src/node/data-vfs.ts`), so the files resolve as
`intro/<name>.smk` either way. All: version-2 Smacker (`SMK2`, flags 0), 640×480, 15 fps (the splash 30), one audio
track (compressed, 16-bit stereo, 44.1 kHz); 0.6 to 30 MB each, about 70 MB in all.

### 2.3 Decoder

`src/content/formats/smk.ts`: DOM-free and Node-free like every decoder (D8), written from the public description of
Smacker (RAD's format; no SFI header). libsmacker, which Stracciatella bundles (`dependencies/lib-smacker/LICENSE.txt`,
LGPL 2.1), is neither read nor ported (`01` §5.3).

- `openSmk(bytes)` reads the 104-byte header, the frame size and type tables and the four Huffman trees (mono map, mono
  colours, full, type): 16-bit trees built from two 8-bit trees, with three escape leaves that return the three most
  recently decoded values, reset at every frame.
- `decodeAudio(video, track)` decodes every chunk of a track up front into an `Int16Array` per channel: Huffman DPCM
  with per-chunk trees, 8 and 16 bit, mono and stereo, wrap-around deltas; uncompressed 8/16-bit PCM is copied.
- `createFrameReader(video).nextFrame()` returns `{index, indices, palette, paletteChanged}`; the index buffer and the
  palette are reused across frames because void blocks keep the previous picture (copy them to keep them). Palette
  chunks: skip, copy from the previous palette, 6-bit colours scaled by `(c << 2) | (c >> 4)` (`sixBitToEight`). Block
  types mono, full, void and solid, chained by the 64-entry run table (`SMK_RUN_LENGTHS`).
- Refused with a clear error: ring frames, Y-interlaced and Y-doubled files, Bink audio and SMK4 (no game file uses
  them, and SMK4's extra full-block modes could not be checked against a sample).

On the user's data every video decodes, its audio as long as the video to within one frame. In Node a 640×480 frame
decodes in about 1.4 ms on average and under 9 ms at worst (the first, full frames), the audio of the longest video
(`throne_nomig`, 2 minutes) in about 0.4 s, so a Worker keeps up with 15 and 30 fps easily.

### 2.4 Player and sequences

**Presentation only.** No video blocks the simulation or the server. The beginning intro plays in the browser while the
new campaign session already exists and waits in its laptop flow (no input needed until the player acts); the ending
plays after `campaignWon` from `observe.ended.ending {miguelAlive, skyriderAlive}` (`26` §7), the two choices of
`GetNextIntroVideo`. Agents never see videos.

**No transcoding** to WebM or MP4, neither in the repository nor in a server cache: the browser decodes the user's own
files. A server-side transcoder would add a native dependency for about 70 MB of video that a client decoder handles in
real time.

**Player** (`src/app/video/`):

- `player.ts` fetches `/vfs/intro/<name>.smk` whole (404 → `missing`, skipped) and opens it in a module Worker
  (`decoder-worker.ts`, which decodes the audio up front and converts it to float; messages in `worker-protocol.ts`). It
  draws through `src/render/indexed-frame.ts` (WebGL2: an R8UI index texture and a 256×1 RGB palette texture, sampled
  with `texelFetch`) at the largest integer scale that fits the window (`integerScale`; deviations "Video scaling").
- `sound.ts` plays the audio as one buffer on the audio engine's music bus (`AudioEngine.playBuffer`, full volume as the
  original's `MAXVOLUME`, under the master gain and mute) or on a plain `AudioContext` (`contextSound`).
- `pacing.ts`: the audio clock (the time since the buffer started) paces frames; without a running audio context, with
  the master at 0 or for a silent video the wall clock does (deviations "Video pacing"). Each animation frame asks the
  Worker for the newest due frame; the Worker decodes every frame up to it and posts only that one, so late frames are
  decoded but never shown, as in `SmkSkipFrames`; the video ends when the frame after the last one is due.
- `sequence-player.ts` covers the screen with a black, cursorless overlay and handles the keys of `Intro.cc`: Escape
  (key up) ends the sequence, Space (key up) or any mouse button (down) the current video. It downloads the sequence's
  files one after another from its start (`download-queue.ts`), so the next video arrives while the current one plays;
  a key or click during a download skips at once while the download runs on into the browser cache; an ended sequence
  starts no further download.

**Sequences** (`src/app/video/sequences.ts`): the eleven names (`IntroVideo`); `splashPlan` (the splash only, then the
main menu; the TalonSoft logo is never played); `beginningPlan` (the four beginning videos, then the new game);
`endingPlan({miguelAlive, skyriderAlive})` (throne video by Miguel's death, the fly-by, the helicopter video by
Skyrider's, then the credits). `sequenceEnabled` applies the client settings `playSplash` and `playIntro` (default on);
the ending always plays (deviations "Intro and splash switches": a browser player re-enters often and should not be
forced through the videos). Where they play:

- launcher: the splash after a first click, once per browser tab (deviations "Splash start"); the beginning when it
  starts a campaign;
- `/play`: the beginning after the new game (`src/app/game/front-end.ts`), the ending (`src/app/game/story-host.ts`);
  opens on the main menu without the splash (deviations "Game page start");
- `src/devtools/video/`: plays every sequence and the credits, toggles the two settings, exposes `window.__ja2Video`;
  `?autoplay=splash` plays the splash on load unless `playSplash` is off.

### 2.5 Credits

- **Parser** (`src/content/formats/credits.ts`, `readCreditRow`) like `GetNextCreditFromTextFile`: codes `D B S J C R T
  { }` after `@`, separated by `,` and ended by `;`; the rest of a code skipped up to the next separator; numbers read
  like `sscanf("%u")` (`scanUnsigned`); colours truncated to 8 bits; unknown codes and justifications other than 0–2
  reported and ignored; the section flags applied after the codes of the same row. Defaults (`INITIAL_CREDIT_STYLE`):
  node gap 12, section gap 50, scroll delay 25 ms, centred, title colour `FONT_MCOLOR_RED`, active colour
  `FONT_MCOLOR_DARKWHITE`. All 248 rows of the English credits parse without unknown codes.
- **Rows** come from `GET /api/text?file=binarydata/credits.edt&row=N` (`src/app/credits/rows.ts`, `CreditRowFeed`),
  prefetched from row 1 (`FIRST_CREDIT_ROW`) until the first 404.
- **Roll** (`src/ui/screens/credit-roll.ts`): a row is read when the last node has risen `gapBeforeNextRow` pixels above
  the bottom less the original's 16-pixel overlap; nodes rise 1 px per scroll delay; the top node is dropped once off
  screen; the screen ends when the rows ran out and the last node left.
- **Screens**: `/play` draws the original credits screen on the canvas (`src/ui/screens/front-end/credits.ts`,
  `30` §1.8); the launcher's "Video and credits" button keeps a DOM scroller (`src/app/credits/scroller.ts`: Arial
  12 px and bold 14 px in the 210-pixel column at x = 10 of a 640×480 stage, the `FONT_MCOLOR_*` indices mapped to
  approximate CSS colours, Escape on key up ends it; deviations "Credits screen").

### 2.6 Stubs

`stubs/smk-encode.ts` writes SMK2 files with frequency-built Huffman trees (optionally using the escape leaves), all
four block types chosen per 4×4 block (unchanged → void, one colour → solid, two → mono, else full), palette chunks with
skip/copy/colour commands and a DPCM or raw audio track. `stubs/video.ts` draws an own title card ("ja2-node" in a 5×7
pixel font, a colour band whose ramp rotates through palette copies, a progress bar) with a two-note triangle chime: 30
frames at 15 fps, 22.05 kHz 16-bit stereo compressed like the originals, `intro/splashscreen.smk`, about 40 KB and
byte-identical every build; `stubs/build.test.ts` decodes it back to the source frames, palettes and samples. The other
ten names stay missing and are skipped, which exercises the missing-file path. The stub credits are an own
`binarydata/credits.edt` (`32` §1.7).

### 2.7 Quirks kept and deviations

**Quirks kept** (§2.1): the ending's throne video by Miguel's death, its helicopter video by Skyrider's; Escape ends a
sequence, Space or a click one video; late frames decoded but not shown; missing files skipped.

**Deviations** (`deviations.md`): "Video pacing", "Video scaling", "Intro and splash switches", "Splash start", "Game
page start", "Credits screen". The launcher plays the splash whatever the data version, where the original plays it for
English and Chinese data only (`src/sgp/SGP.cc:441-444`).

---

## 3. Localization

### 3.1 The original: one version switch for all text

**The version switch.** Stracciatella knows nine data versions
(`rust/stracciatella/src/config/vanilla_version.rs:11-30`: Dutch, English, French, German, Italian, Polish, Russian (the
Buka release), Russian Gold, Simplified Chinese), chosen by `--resversion` or `ja2.json` `resversion`
(`rust/stracciatella/src/config/cli.rs:93-94`, `rust/stracciatella/src/config/ja2_json.rs:42`), default English
(`rust/stracciatella/src/config/engine_options.rs:69`). The launcher guesses it from `russian/`, `german/`, `dutch/`,
`italian/` or `polish/` files inside the SLFs and from file hashes (`rust/stracciatella/src/guess.rs:128-237`); Russian
Gold cannot be guessed (no resource pack, inferred). The version is one switch for everything language-related:

| Depends on the version | Where |
|---|---|
| UI string file `strings/translation-<suffix>.json` (`-eng`, …; **both** Russian versions read `-rusgold`, `GetSuffix(version, false)`) | `src/externalized/strings/Localization.cc:13-34`, `src/externalized/DefaultContentManager.cc:968-971` |
| other per-language JSON (new strings, town names and locatives, land types, calibres, shipping destinations; both Russian versions read `-rus`) | `src/externalized/DefaultContentManager.cc:876`, `:956-957`, `:1203-1204`, `src/externalized/strings/TranslatableString.cc:18` |
| character → glyph table `translation_tables/translation-table-<x>.json` (`fr`, `rus`, `rus-gold`, `chs`, else `eng`) | `src/externalized/DefaultContentManager.cc:1338-1376` |
| EDT decoding mode (`SE_RUSSIAN` for both Russian versions, `SE_POLISH`, `SE_ENGLISH` for English and Chinese, `SE_NORMAL` otherwise) | `GameRes.cc:329-344` |
| language graphics (33 MLG pictures; Russian Buka uses `russian/<name>_russian.sti`, Russian Gold the default paths) | `GameRes.cc:70-319` |
| map major version 6.00 and 148 extra bytes (Russian Buka) | `GameRes.cc:60-64`, `TileEngine/WorldDef.cc:2297-2301` |
| NPC record layout with a leading identifier (Russian Buka only), also in saves | `TacticalAI/NPC.cc:122-215`, `:2388-2424` |
| R.P.C. speech as `speech/r_<voice>_<quote>.wav` (both Russian versions) | `src/externalized/content/Dialogs.cc:88-92` |
| the splash video (English, Chinese) or picture (others) | `src/sgp/SGP.cc:441-444` |
| English and Chinese only: `Random(100) < 30` picks a battle sound instead of the "see enemy" quote | `Tactical/OppList.cc:2388-2402` |
| German only: save encryption factor, door tooltip layout, an argument order | `SaveLoadGame.cc:2512-2515`, `Tactical/Handle_Doors.cc:1089`, `Laptop/AIMMembers.cc:2903-2911` |

**UI strings are JSON.** The formerly compiled string tables are `L10n_t`
(`src/externalized/strings/Localization.h:200-425`, fixed array sizes at `:20-196`), loaded from
`translation-<suffix>.json` with a length check per array (`src/externalized/strings/Localization.cc:37-280`): 217 keys,
1,901 strings per language. `translation-rus.json` and `translation-rusgold.json` differ in five strings (the copyright
line and four mail sender names); only the latter is read (no other caller passes `false` to `GetSuffix`, inferred).

**Data text is EDT, per installed version.** Dialogue (`mercedt/NNN.edt`, `npcdata/NNN.edt`, `d_NNN.edt`), civilian
quotes, item names and descriptions (`binarydata/itemdesc.edt`, `braydesc.edt`), A.I.M. and M.E.R.C. bios, mails, files,
history and quest lines, I.M.P. text, help, credits, insurance and florist text are fixed-width UTF-16 records
(`src/externalized/strings/EDT.h:60-110`, `src/externalized/ItemModel.cc:11-20`, `Laptop/EMail.cc:34`,
`Tactical/Civ_Quotes.cc:36`) decoded by `LoadEncryptedData` (`src/externalized/strings/EncryptedString.cc`): ROT-1
(`:17`), then per mode. Russian maps 0xC0–0xFF to U+0410–U+044F (`:24`: the text was CP1251 read as CP1252); Ё, № and
the guillemets are not mapped (so they cannot render, inferred). Merc names in `prof.dat` get the same fix
(`src/sgp/LoadSaveData.cc:77-90`). Record sizes are the same in every language. Item and merc names are never in JSON
(`items.json` has none; `src/externalized/mercs/MercProfile.cc:151-152` allows overrides only).

**Fonts decide what can be drawn.** All 16 fonts are `fonts/*.sti` with the same names in every version
(`Utils/Font_Control.cc:37-52`); one translation table maps code points to glyph indices for all of them
(`src/externalized/DefaultContentManager.h:294`); a missing code point draws `?` (`src/sgp/Font.cc:163-172`). The
tables are incompatible: the English fonts carry only upper-case Cyrillic (32 glyphs, for one NPC's lines, decoded by
the non-Russian branch of `src/externalized/strings/EncryptedString.cc:70-91`), the Buka fonts put Cyrillic at 96–159
with no accented Latin, Russian Gold at 100–163. So mixed-case Russian on original bitmap fonts needs Russian data (or
replacement fonts); with English data Cyrillic can only be drawn in capitals (inferred from the tables).

**Speech** has the same file names in every version except the Russian R.P.C. prefix; its language is whatever the
installed `speech.slf` holds (inferred). **Numbers and money** are not localized anywhere: `$` with `,` thousands and
`.` decimals (`Laptop/Finances.cc:954-985`); only unit labels come from the strings. Translations keep printf
placeholders in the original order (no positional arguments, `src/sgp/SGPStrings.cc`). **Mods** can override strings,
EDT rows (`<file>.edt.json`, `src/externalized/strings/EDT.cc:48-129`) and fonts through the VFS
(`rust/stracciatella/src/vfs/mod.rs:200-345`); ja2-node has no mods.

### 3.2 Data version and display language

ja2-node splits the switch in two (deviation "Display language"):

- **Data version** (`dataVersion`): a property of the content, detected once at server start from the language folders
  inside the SLFs (English otherwise), overridden by `JA2_DATA_VERSION` (a name of `VANILLA_VERSIONS`; case, spaces,
  `_` and `-` ignored; ignored with a warning without original data). Without original data: `stubs` (English text
  and EDT mode, the stub glyph table). It selects the EDT decoding mode, the NPC record layout, the `prof.dat` name
  fix, the R.P.C. speech prefix, the glyph table for the data's fonts and the MLG picture paths (`28` §3.4). It is part
  of the save's content identity (`27` §1.4), because it reaches the simulation (§3.3).
- **Display language** (`language`: `eng`, `rus`, `ger`, `dut`, `fr`, `it`, `pl`, `chs`): which
  `translation-<suffix>.json` and per-language files label the UI. Default: the data version's language (stubs →
  `eng`); `rus` reads `translation-rusgold.json` and the `-rus` files, as Stracciatella does for both Russian versions.
  Server default `JA2_LANG`; a session has its own (`newSession {language}`), a client its own setting; changing it
  never touches a session. Russian with English data gives Russian UI labels and English data text (dialogue, item
  names, mails), which the original cannot do; with Russian data both are Russian.
- **Text stays out of the simulation**: never in state, saves or logs (`29` §13). Views and events carry machine
  tokens (`moraleText: 'good'`, `reason: 'outOfAPs'`) and text keys (`{file, row, width}` for EDT, `{table, index}` for
  UI strings) that clients resolve in the tables they loaded; `src/server/text-keys.ts` maps each token to its `L10n`
  array and index, so every surface labels the same way. Routes, view labels and MCP behaviour: `29` §25.

### 3.3 What the data version reaches in the simulation

The display language never reaches the simulation. The data version does, only here, each faithful to the user's
version:

1. **Quote durations**: the longer of the voice's length and 12 ticks per character of the decoded EDT line
   (deviations "Speech", `24` §10.2); a Russian line and its voice have other lengths than the English ones, so the
   speech channel frees at another tick.
2. **NPC record layout** (Russian Buka): the same records from another byte layout (`src/content/formats/npc.ts`
   `'russian'`), also in native saves.
3. **The battle-sound branch** of `Tactical/OppList.cc:2388-2402`: one extra `Random(100)` in English and Chinese. Not
   ported (§3.6).
4. **Map bytes** (Russian Buka): like `WorldDef.cc`, the reader skips the 148 bytes by the map file's own version
   6.00/26 (`RUSSIAN_MAP_EXTRA_BYTES`, `src/content/formats/map.ts`), so the map model is unaffected; the major version
   matters only for writing maps.

So a save records `dataVersion` and a hash of the quote lengths it ran with (`quoteLengthIdentity`,
`src/server/content-identity.ts`); another data version or other lengths load with the warning `dataVersionDiffers`
(`27` §1.4), like Stracciatella's version warning (`SaveLoadScreen.cc:707-731`).

### 3.4 Russian

- **With Russian data** (Buka or Gold): detection (Buka has `russian/` files; Gold must be named in
  `JA2_DATA_VERSION`), the Russian EDT mode, the Buka NPC layout, `speech/r_` for R.P.C.s, the Buka MLG pictures, the
  Russian strings (`translation-rusgold.json` plus the `-rus` files) and the `rus` or `rus-gold` glyph table.
- **With English data and `rus`**: Russian UI strings, English data text (§3.2); the launcher and the developer pages
  render Cyrillic with system fonts (the canvas: §3.6).
- **Kept as in the original**: Ё and the other unmapped CP1251 characters stay unmapped; money and numbers keep `$`,
  `,` and `.`; no layout changes. Stracciatella's tooltip table exists only in English (`tooltips-eng.json`) and its
  `informative_tooltips` option is off by default (`assets/externalized/game.json:144`), so tooltips are out of scope.
- **Repository rule**: the Russian JSON strings are Stracciatella's externalized tables (SFI-SCLA, copied unchanged like
  the rest of `data/externalized`); nothing from the user's EDT files, fonts or speech is committed, and tests assert
  keys, counts and lengths, never original text (`29` §13).

### 3.5 Implementation in ja2-node

| Module or file | Role |
|---|---|
| `src/content/text/data-version.ts` | `VANILLA_VERSIONS`, `STUB_DATA_VERSION`; `dataDecoding` → `DataDecoding {edt, npcRecords, profileNames, rpcSpeechPrefixed}`; `edtEncodingOf` (`getStringEncType`); `stringSuffix` (`GetSuffix`: `-rusgold` for the translation file, `-rus` for the per-language files); `displayLanguageOf`, `languageVersion` (`rus` → Russian Gold); `glyphTablePath`; `guessVanillaVersion` (the language-folder half of `guess.rs`: exactly one language folder found, else no guess) |
| `src/server/data-version.ts` | `detectDataVersion` / `chooseDataVersion` at server start (source `stubs`, `override`, `detected` or `default`), `chooseDisplayLanguage` (`JA2_LANG`) |
| content loading | an optional `DataDecoding` argument, default English: `loadTacticalContent` (`src/sim/tactical/load-content.ts`, the `prof.dat` names), the narrative content (`src/server/narrative-content.ts`: EDT mode, NPC record layout, cached per decoding), the campaign, sandbox and save session factories (also the NPC layout of native saves) |
| `src/content/formats/edt.ts` | EDT modes `english`, `russian`, `polish`, `other` (`SE_NORMAL`) |
| `src/content/narrative/speech-path.ts` | `dialogueSpeechPath` (`Dialogs.cc` `GetDialogueVoiceFilename`, the `r_` prefix), used by `src/content/audio/speech.ts` |
| `src/content/text/strings.ts` | `loadUiStrings`: the translation file plus `LANGUAGE_FILES` (`new-strings`, `strategic-map-land-types`, `strategic-map-town-names`, `strategic-map-town-name-locatives`, `ammo-calibre`, `ammo-calibre-bobbyray`, `shipping-destinations`); `checkTranslation` repeats the per-array length check of `Localization.cc:37-53` against `data/tables/l10n.json`; all nine translation files pass |
| `data/tables/l10n.json` | `tools/transcribe/l10n.ts` from `Localization.h:20-196`: each `L10n` key with its array size (`null` for a single string) |
| `data/tables/edt-layouts.json` | `tools/transcribe/edt-layouts.ts`, read by `src/content/text/edt-layouts.ts`: the record layout of every EDT file the game reads, 20 fixed files and 5 name patterns (`npcdata/civNN.edt`, `npcdata/<sector>.edt`, `npcdata/d_NNN.edt`, `npcdata/NNN.edt`, `mercedt/NNN.edt`). On the English Gold data every fixed file holds whole records; the row counts in the `EDT.h` comments are twice the real ones for all files but `help.edt`, so they are not transcribed |
| `src/content/text/glyph-table.ts` | parses Stracciatella's glyph tables and the stub table |
| `src/server/text-service.ts` | `TextService`: EDT rows through the VFS in the data version's decoding (stub files only on the stub data version) and the UI tables of a language, for `/api/strings`, `/api/text` and `observe` labels |
| `data/tables/mlg.json`, `src/ui/layout/model.ts` | `tools/transcribe/mlg.ts` from `GameRes.cc` `GetMLGFilename`; `mlgPath` resolves an MLG id per data version (`28` §3.4) |

### 3.6 Known limitations

- The guesser has only the language-folder half of `guess.rs`, not the resource-pack hashes: French, Simplified
  Chinese and Russian Gold data (and anything recognisable only by hash) run as English unless `JA2_DATA_VERSION`
  names the version (gap "Data version detection").
- The English/Chinese battle-sound branch waits for the "see enemy" quote, which `src/sim` does not port.
- Cyrillic with English data on the canvas (`/play`): the page draws with the data's fonts and the data version's glyph
  table (`glyphTablePath` in `src/app/game/ui-boot.ts`), whose English fonts carry upper-case Cyrillic only, so other
  Cyrillic letters draw `?`. The stub fonts have the whole Cyrillic alphabet (`32` §1.6.5) but are not used as a
  fallback.
- The oracle has never run on Russian data; the probes that read text lengths should be rerun once on a Russian copy.

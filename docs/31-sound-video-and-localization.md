# 31 — Sound, music, video and localization

How the browser plays the original's sounds, music, speech and Smacker videos, and how text reaches every surface in
the data's language and the player's. Siblings: `24` the timing of conversation lines; `26` the ending that starts the
last videos; `27` the music state in saves and the client settings; `28` fonts, glyph tables and MLG pictures; `29` the
events and text keys clients read; `30` UI sounds, faces and lip-sync, the speech presenter, the canvas credits; `32`
the stub media and the launcher. Each module's `@src` header names the Stracciatella functions it ports; read those for
the volume, pan and fade rules and the music setters. The cue tables are in `data/tables` (`sound-effects.json`,
`battle-sounds.json`) and Stracciatella's `data/externalized` (`music.json`, weapons, calibres, explosions, vehicles).

## 1. Where things live

Paths are under `src/`.

```
sound   view frames, events, replayed animation codes      app/sound/tactical-sound.ts → audio/director.ts
          → cues: file, mix rule, bus, tile                  content/audio/cues.ts, battle-sound.ts, cue.ts
          → the original's volume and pan                    content/audio/sound-position.ts
          → voices on four buses, decoded-buffer cache       audio/engine.ts, content/formats/wav.ts
music   sim events + session facts → {mode, previous}       protocol/music.ts, server/session.ts
          → welcome and changed frames → tracks, fades       app/net/music.ts → audio/music.ts
speech  a quote's text key → its speech file                content/audio/speech.ts; on /play ui/speech.ts
video   sequence plan → downloads → Worker → frames          app/video/, content/formats/smk.ts
          indexed colour on WebGL2, sound as one buffer      render/indexed-frame.ts, app/video/sound.ts
credits /api/text rows → the roll                           app/credits/rows.ts → ui/screens/credit-roll.ts
text    data version → decodings; language → UI tables       content/text/data-version.ts, server/data-version.ts
          EDT rows and strings for routes and observe        server/text-service.ts, server/text-keys.ts
```

| Module | Holds |
|---|---|
| `content/formats/` | WAV (PCM and IMA ADPCM), `.gap`, `.bad` ambient tables, Smacker, credit codes, EDT rows in four decodings |
| `content/audio/` | Cue tables, cues per source (footsteps, gunfire, impacts, doors, codes 700–798, battle sounds, creature cries, code 491), the original's mix rule per call site, ambient scheduling, the tile an unseen sound plays from, speech files and voice lengths |
| `audio/` | `AudioEngine`, `SoundDirector` (per-soldier presentation memory, ambient, the developer pages' speech queue), `MusicPlayer`, `ClientRandom` |
| `app/sound/`, `app/map/map-sound.ts`, `app/battle/battle-sound.ts`, `app/game/ui-audio.ts` | The wiring per screen: tactical, map screen, autoresolve, the engine of `/play` |
| `content/text/` | Data versions and their decodings, UI string tables, EDT record layouts, glyph tables |

`data/tables/l10n.json` gives each `L10n` key its array size, `edt-layouts.json` every EDT file's record layout (the
row counts in the `EDT.h` comments are twice the real ones but for `help.edt`, so they are not transcribed),
`mlg.json` the language pictures per version.

## 2. Design

### Sound and speech

**Sound is presentation.** Nothing in `sim` plays, waits for or draws on behalf of sound (`01` D2, D13, D14). The
client derives every sound from view frames, events (with optional sound facts, `29`) and the animation codes it
replays; headless sessions and agents get the same outcome. The one audio fact the simulation reads is data: voice
lengths measured from the WAV headers into the rule pack (`@rules/speech/lengths.json`, outside its hash), which time
conversation lines (`24`).

**Where the original's gameplay waits for sound,** ja2-node uses game time: a quote lasts its sample, waits for the
speaker's battle sound and is cut by a critical one (deviation "Speech"; the client still stops the voice, "Speech
playback"); the defeat track's end unloads the sector ("Defeat track"); Skyrider's destruction waits for a sound
("Helicopter destruction"); ambient sounds are strategic events ("Ambient sound events", "Ambient timing"); the first
helicopter drop waits for the engine sound to fade (gaps "Helicopter entrance": once ported, its end follows the
script's ticks). Sound picks on the gameplay generator are not drawn, or drawn on the client's `ClientRandom`, seeded
from the session id ("Cosmetic draws …", "Footstep variants", "Music track choice").

**The client hears what the squad hears.** The view has no position for an unseen soldier (D16), so an unseen source
plays from where the squad hears it ("Sounds out of sight"), and only animals in sight make idle sounds ("Idle sounds
of unseen animals"). Code 491 is counted from the passes of the loop that holds it, since the server sends no frames of
a predictable loop. Frames more than 100 ticks behind the newest (`CATCH_UP_TICKS`) only update the director's memory,
so a skip replays no sounds.

**The original's mixer on Web Audio.** Each cue's mix rule computes volume and pan as its call site in the original
does, applied per voice under one master gain: 16 voices, a new sound dropped when all are busy; two gains per voice
for the linear balance, which `StereoPannerNode`'s equal-power law is not; 128 decoded buffers, like the original's
sample cache. ja2-node decodes WAV itself, since almost every battle sound and all speech are IMA ADPCM, which
`decodeAudioData` does not decode reliably. Speech and music (about 500 MB) load per file through `/vfs`, never
bundled; a missing file is skipped, as the original skips a failed play.

**Speech** plays for every quote with a text key; the next line waits for the sample, and a line end on the
simulation's side never cuts it. On `/play` the speech presenter owns voice, subtitle and skip (`30`).

### Music

**The music mode is state the player sees, so the server computes it** (deviation "Music mode on the server").
`musicMode` replays the original's `SetMusicMode` setters over the events of an advance and a few session facts read
after them. `Session` keeps `{mode, previous}` in the save's presentation part (`27`); a native import starts at the
saved mode byte with the menu as previous, as the original's load sets the menu first. Frames carry the mode when it
changes, with `fastFade` for the sector entry and exit. The browser picks tracks with its own generator, fades, and
turns to the nothing tracks after the victory track by itself; the session keeps the victory mode, and a restore maps
victory and defeat to nothing, so both sides agree.

**What the setters read is simulation state:** whether `SetEnemyPresence` fired while a sector loaded, the last enemy
a merc killed (deviation "Last kill talked about"), and the creature music flag, which the simulation clears where the
original's victory track would, so native saves and ours carry the same flag ("Creature music clear").

### Video and credits

**Videos are presentation.** None blocks the simulation or the server: the beginning plays while the new campaign
waits in its laptop flow, the ending after the victory from `observe.ended.ending` (`26`). Agents never see a video.

**The browser decodes the user's files.** Nothing is transcoded: a server transcoder would add a native dependency for
about 70 MB that a client decoder plays in real time (a 640×480 frame in about 1.4 ms, under 9 ms at worst). `smk.ts`
is written from the public description of the Smacker format and carries no SFI header; libsmacker, which Stracciatella
bundles under LGPL 2.1, is neither read nor ported (`01`). It refuses what no game file uses: ring frames, Y-interlaced
and Y-doubled files, Bink audio, SMK4.

**The player** decodes in a module Worker, which decodes up to the newest due frame and posts only that one, so late
frames are decoded but never shown, as in the original. Frames are indexed colour on WebGL2 at an integer scale
("Video scaling"), paced by the audio clock ("Video pacing"); the sound is one buffer at full volume under the master
gain, like the original's `MAXVOLUME`. A missing file is skipped, as in the original. A sequence's files download one
after another, so the next video arrives while one plays.

**Where videos play.** The splash in the launcher after a first click ("Splash start"), never on `/play` ("Game page
start"); the beginning after a new game, the ending after the victory; the client settings can turn off the splash and
the beginning, never the ending ("Intro and splash switches"). Steam's data keeps the videos in `Intro-old.slf`;
ja2-node mounts every SLF by its library path as Stracciatella does, so they resolve as `intro/<name>.smk` either way.

**Credits.** `CreditRoll` runs the original's roll for the canvas screen of `/play` (`30`) and the launcher's DOM
scroller ("Credits screen").

### Text and languages

**Two switches instead of one** (deviation "Display language"). Stracciatella's version picks the data's text and the
UI strings together; ja2-node splits it:
- the **data version** is a property of the content, detected at server start from the language folders inside the
  SLFs (gaps "Data version detection") or named by `JA2_DATA_VERSION`; `stubs` without original data. It selects what
  must match the files: the EDT decoding, the Russian NPC record layout and profile names, the Russian R.P.C. speech
  prefix, the glyph table of the data's fonts, the MLG pictures (`28`);
- the **display language** picks the UI string tables: the data's by default, `JA2_LANG` on the server, per session
  and per client; changing it never touches a session. Russian labels over English dialogue, item names and mails are
  possible, which the original cannot do; the MLG pictures keep the data's language.

**Text stays out of the simulation**: never in state, saves or logs (`29`). Views and events carry machine tokens and
text keys that each client resolves in the tables it loaded; `server/text-keys.ts` maps every token to its `L10n`
array, so every surface labels alike.

**What the data version reaches in the simulation**, as the user's version has it: quote durations (a Russian line and
its voice have other lengths, `24`) and the Russian NPC record layout, also in native saves; Russian maps' extra bytes
are skipped by the map's own version. A save records the data version and a hash of the line lengths
(`server/content-identity.ts`); another version or other lengths load with the warning `dataVersionDiffers` (`27`),
like Stracciatella's version warning.

**Fonts decide what can be drawn.** One glyph table per data version serves all fonts; a missing code point draws `?`.
The English fonts carry only upper-case Cyrillic, so `/play` with English data in Russian draws the other Cyrillic
letters as `?`; the stub fonts have the whole alphabet but are no fallback (`32`). Money and numbers keep `$`, `,` and
`.` in every language, as in the original; Stracciatella's tooltips exist only in English and are off by default.

**Repository rule.** The Russian strings are Stracciatella's externalized tables (SFI-SCLA, like the rest of
`data/externalized`); nothing from the user's EDT files, fonts or speech is committed, and tests assert keys, counts
and lengths, never original text.

## 3. Quirks of the original the code keeps

Each looks like a bug and is the original's behaviour. Paths are under `src/`:

| Quirk | Test |
|---|---|
| A new sound is dropped when 16 play; none is stolen | `audio/engine.test.ts` |
| Pan is a linear balance, not equal power | `content/audio/sound-position.test.ts`, `audio/engine.test.ts` |
| Off screen a sound is 25 quieter with a floor of 25 and no falloff, so a quiet sound gets louder | `content/audio/sound-position.test.ts` |
| Soldier samples (footsteps, the robot's beep) go through the effects volume twice | `content/audio/sound-position.test.ts`, `cues.test.ts` |
| Our mercs' battle sounds keep their volume off screen; only other teams' drop | `content/audio/sound-position.test.ts` |
| A muted confirmation still counts for the 2 s repeat filter | `content/audio/cues.test.ts` |
| Music starts without a fade-in | `audio/music.test.ts` |
| Setting the playing mode again makes it its own previous mode: the prebattle screen sets enemy present twice, so a later restore forgets what played before | `protocol/music.test.ts` |
| A restore never returns to the victory or defeat track, but to the nothing music | `protocol/music.test.ts` |
| Entering a sector switches to the nothing music unless battle plays, or enemy present with hostiles left; the interrogation's menu music gives way to it in N7 even with enemies there | `protocol/music.test.ts` |
| After the victory track the nothing music, after the defeat track silence | `audio/music.test.ts` |
| Late video frames are decoded but not shown | `app/video/pacing.test.ts` |
| The TalonSoft logo is in the archive but never played | `app/video/sequences.test.ts` |
| The credits never read row 0: the original counts its record up before the first read | `ui/screens/credit-roll.test.ts` |
| Russian decoding shifts only 0xC0–0xFF, so Ё, ё and № stay CP1252 characters | `content/formats/edt.test.ts` |
| Both Russian versions read `translation-rusgold.json` for the UI and the `-rus` files for the rest; `translation-rus.json` is never read | `content/text/strings.test.ts`, `data-version.test.ts` |

Not pinned yet:
- The map screen never sets a music mode, so whatever played goes on.
- A low-morale battle sound draws its variant with the plain kind's count; the table gives both the same count.

## 4. Not checked against the native build

The oracle runs the native build with `-nosound` and draws nothing, so no sound choice, music mode, video frame or
credits row is compared; the music modes are ported from the setters as read (`tools/oracle/README.md`). The
original-data tests decode every effect, battle-sound and music WAV, a sample of the speech, every `.gap` file, the
splash and beginning videos and every credits row (`content/formats/*-original.test.ts`). Inferred:
- That `decodeAudioData` does not decode IMA ADPCM reliably (from the browsers' codec lists).
- That vanilla looped a positional sound on `loop = 0` (deviation "Queen's positional sound").
- That the Steam package renames the intro archive so that its own executable skips the intro.
- That Stracciatella cannot guess Russian Gold (it has no resource pack); that Ё and № cannot render with Russian data;
  that a speech archive speaks whatever language it holds; that mixed-case Russian on the original's fonts needs
  Russian data (from the glyph tables).
- The oracle has never run on Russian data; the probes that read line lengths should be rerun once on a Russian copy.

Not ported: gaps "Sound coverage", "Sighting quotes" (the English and Chinese `Random(100)` battle-sound branch of a
sighting), "Data version detection", "Splash and the data version", "Helicopter entrance", "Map screen speech",
"Laptop video faces", "I.M.P. voice samples".

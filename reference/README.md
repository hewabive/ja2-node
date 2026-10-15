# reference/: third-party sources, read-only

Shallow clones of third-party repositories. Do not modify, build or run anything inside this
directory. It is excluded from git (see `../.gitignore`).

| Directory | Source | Commit | License | Purpose |
|---|---|---|---|---|
| `stracciatella/` | https://github.com/ja2-stracciatella/ja2-stracciatella | `ae6bf01` (2026-10-15, v0.23.0) | SFI-SCLA (+ public domain after `8287b98`) | Primary source of game logic; JSON data in `assets/externalized` |
| `vanilla/` | https://github.com/gtrafimenkov/ja2-vanilla | `8caa128` (2024-11-17) | SFI-SCLA | Original 2004 C code, for checking intent |
| `vanilla-cp/` | https://github.com/gtrafimenkov/ja2-vanilla-cp | `93e32c8` (2024-12-29) | SFI-SCLA | "Vanilla" on the Stracciatella code base |
| `alexbatalov-ts/` | https://github.com/alexbatalov/ja2 | `b5a0133` (2021-04-25) | SFI-SCLA | Full TypeScript translation of vanilla, a "Rosetta stone" |
| `ja2-web/` | https://github.com/Virtastic/ja2-web | `f9d4465` (2026-10-12) | claims GPLv3 (disputable) | **Read only** as a list of browser pitfalls; never copy code |

Restore:

```sh
git clone --depth 1 https://github.com/ja2-stracciatella/ja2-stracciatella.git stracciatella
git clone --depth 1 https://github.com/gtrafimenkov/ja2-vanilla.git vanilla
git clone --depth 1 https://github.com/gtrafimenkov/ja2-vanilla-cp.git vanilla-cp
git clone https://github.com/alexbatalov/ja2.git alexbatalov-ts   # full history shows the translation method
git clone --depth 1 https://github.com/Virtastic/ja2-web.git ja2-web
```

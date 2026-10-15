# ja2-node

A non-commercial reimplementation of Jagged Alliance 2 in TypeScript. The game state lives on a
server (Node), the browser is a client, and agents play through an API. The goal is the
original's behaviour (mechanics, formulas, order of checks), not a line-by-line port of its code.

**Status:** milestone M0 "Foundation": reading the original archives and sprites, a data server,
WebGL2 sprite rendering, an asset browser and a stub pack. There is no game yet.

Documents in [`docs/`](docs/): scope and license (`00`), architecture (`01`), mechanics catalog
(`02`), how logic is tied to animation (`03`), time, server and agent API (`04`).

## License and data

- The code is distributed under the **SFI-SCLA** ([`LICENSE`](LICENSE)): non-commercial use only.
  Files ported from the original's logic carry a header with the date of the change.
- **The original game data is not here and never will be.** You need your own copy of Jagged
  Alliance 2 (GOG, Steam). Without it the stub pack works: the project's own original assets.

## Quick start

Requires Node 24 and pnpm 11.

```sh
pnpm install
pnpm stubs                         # build the stub pack into dist/stubs
export JA2_DATA_DIR="/path/to/Jagged Alliance 2 Gold/Data"   # optional
pnpm dev                           # server (7420) + Vite (5173)
```

Open http://127.0.0.1:5173/ → "Asset browser". Without `JA2_DATA_DIR` only the stubs
(`stubs/…`) are visible.

The server listens on `127.0.0.1` only and requires the token from `.ja2/token`, which it creates
itself. The Vite proxy adds the token, so it never appears in page code.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Server and Vite together; builds the stubs if they are missing |
| `pnpm server` / `pnpm web` | Separately |
| `pnpm check` | Biome, types (`tsc -b`), layer boundaries, unit tests |
| `pnpm e2e` | Playwright on the stubs (own ports 7431/5183) |
| `pnpm build` | Client build into `dist/client` |
| `pnpm stubs` | Stub pack |
| `pnpm cli inspect vfs` | VFS layers and per-file-type statistics |
| `pnpm cli inspect ls <prefix>` | File list |
| `pnpm cli inspect sti <path> --png <dir>` | Describe an STI, dump frames to PNG |
| `pnpm cli inspect verify` | Decode every STI and report errors |
| `pnpm cli inspect slf <file>` / `cat <path> --out <file>` | Archive directory, file extraction |

The original-data test runs only when `JA2_DATA_DIR` is set.

## Layout

Layers (details in `docs/01-architecture.md`, §2):

| Layer | Runs in | Depends on |
|---|---|---|
| `src/core`: RNG, C integer semantics | everywhere, no DOM or Node | — |
| `src/content`: VFS, formats (SLF, STI, PNG), picture model | everywhere, no DOM or Node | core |
| `src/node`: VFS over the disk, token | Node | core, content |
| `src/server`: HTTP `/api/health`, `/api/vfs`, `/vfs/<path>` | Node | core, content, node |
| `src/render`: WebGL2 R8UI atlases, palette texture, sprites | browser | core, content |
| `src/devtools`: asset browser | browser | core, content, render |
| `stubs/`: stub pack generator | Node | core, content, node |
| `tools/`: CLI, dev runner, import checker | Node | everything except browser code |

Boundaries are enforced three ways:
- project references in `tsconfig`;
- `lib` and `types` settings: no DOM and no `@types/node` in shared layers;
- `tools/check-imports.ts`: allowed layers and packages per layer, plus a ban on
  nondeterminism (`Math.random`, `Date`, timers) in `core` and `content`.

Node runs TypeScript without a build step (type stripping), so the code uses no `enum` or
`namespace`, and relative imports carry the `.ts` extension.

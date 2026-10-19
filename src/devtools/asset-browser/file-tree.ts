import type { VfsFile } from '../../app/net/vfs.ts';

interface Dir {
  readonly name: string;
  readonly path: string;
  readonly dirs: Map<string, Dir>;
  readonly files: VfsFile[];
  open: boolean;
}

const FILTER_LIMIT = 400;

function formatSize(n: number): string {
  return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} K` : `${(n / 1048576).toFixed(1)} M`;
}

export class FileTree {
  readonly #root: Dir = { name: '', path: '', dirs: new Map(), files: [], open: true };
  readonly #el: HTMLElement;
  readonly #onSelect: (file: VfsFile) => void;
  #files: VfsFile[] = [];
  #filter = '';
  #selected = '';

  constructor(el: HTMLElement, onSelect: (file: VfsFile) => void) {
    this.#el = el;
    this.#onSelect = onSelect;
  }

  setFiles(files: VfsFile[]): void {
    this.#files = files;
    for (const f of files) {
      const parts = f.path.split('/');
      let dir = this.#root;
      for (const part of parts.slice(0, -1)) {
        let next = dir.dirs.get(part);
        if (!next) {
          next = { name: part, path: dir.path ? `${dir.path}/${part}` : part, dirs: new Map(), files: [], open: false };
          dir.dirs.set(part, next);
        }
        dir = next;
      }
      dir.files.push(f);
    }
    this.render();
  }

  setFilter(filter: string): void {
    this.#filter = filter.trim().toLowerCase();
    this.render();
  }

  reveal(path: string): VfsFile | undefined {
    const file = this.#files.find((f) => f.path === path);
    if (!file) return undefined;
    let dir = this.#root;
    for (const part of path.split('/').slice(0, -1)) {
      const next = dir.dirs.get(part);
      if (!next) break;
      next.open = true;
      dir = next;
    }
    this.#selected = path;
    this.render();
    this.#el.querySelector('.row.selected')?.scrollIntoView({ block: 'center' });
    return file;
  }

  #fileRow(f: VfsFile, depth: number, label: string): HTMLElement {
    const row = document.createElement('div');
    row.className = `row${f.path === this.#selected ? ' selected' : ''}`;
    row.style.paddingLeft = `${8 + depth * 14}px`;
    row.dataset.path = f.path;
    row.title = `${f.path} — ${f.layer}`;
    row.append(label);
    const size = document.createElement('span');
    size.className = 'size';
    size.textContent = formatSize(f.size);
    row.append(size);
    row.addEventListener('click', () => {
      this.#selected = f.path;
      for (const r of this.#el.querySelectorAll('.row.selected')) r.classList.remove('selected');
      row.classList.add('selected');
      this.#onSelect(f);
    });
    return row;
  }

  #renderDir(dir: Dir, depth: number, out: HTMLElement[]): void {
    const dirs = [...dir.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
    for (const d of dirs) {
      const row = document.createElement('div');
      row.className = 'row dir';
      row.style.paddingLeft = `${8 + depth * 14}px`;
      row.textContent = `${d.open ? '▾' : '▸'} ${d.name}/`;
      row.addEventListener('click', () => {
        d.open = !d.open;
        this.render();
      });
      out.push(row);
      if (d.open) this.#renderDir(d, depth + 1, out);
    }
    for (const f of dir.files) out.push(this.#fileRow(f, depth, f.path.slice(f.path.lastIndexOf('/') + 1)));
  }

  render(): void {
    const scroll = this.#el.scrollTop;
    const rows: HTMLElement[] = [];
    if (this.#filter) {
      const hits = this.#files.filter((f) => f.path.includes(this.#filter));
      for (const f of hits.slice(0, FILTER_LIMIT)) rows.push(this.#fileRow(f, 0, f.path));
      const note = document.createElement('div');
      note.className = 'note';
      note.textContent = hits.length > FILTER_LIMIT ? `showing ${FILTER_LIMIT} of ${hits.length}` : `found: ${hits.length}`;
      rows.unshift(note);
    } else {
      this.#renderDir(this.#root, 0, rows);
    }
    this.#el.replaceChildren(...rows);
    this.#el.scrollTop = scroll;
  }
}

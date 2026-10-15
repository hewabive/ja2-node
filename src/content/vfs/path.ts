export function normalizeVfsPath(path: string): string {
  const parts: string[] = [];
  for (const part of path.normalize('NFC').toLowerCase().replaceAll('\\', '/').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') throw new RangeError(`'..' is not allowed in VFS paths: ${path}`);
    parts.push(part);
  }
  return parts.join('/');
}

export function joinVfsPath(prefix: string, name: string): string {
  const a = normalizeVfsPath(prefix);
  const b = normalizeVfsPath(name);
  return a === '' ? b : b === '' ? a : `${a}/${b}`;
}

export function vfsExtension(path: string): string {
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  return dot > slash ? path.slice(dot + 1).toLowerCase() : '';
}

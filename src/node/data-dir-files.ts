import { createHash } from 'node:crypto';
import { createReadStream, type Stats } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { DataDirFile, HashFile } from '../content/text/resource-packs.ts';

async function statOrNull(abs: string): Promise<Stats | null> {
  try {
    return await stat(abs);
  } catch {
    return null;
  }
}

async function namesIn(abs: string): Promise<string[]> {
  try {
    return (await readdir(abs)).sort();
  } catch {
    return [];
  }
}

export async function dataDirFiles(root: string): Promise<DataDirFile[]> {
  const files: DataDirFile[] = [];
  const dirs = [''];
  for (let dir = dirs.shift(); dir !== undefined; dir = dirs.shift()) {
    for (const name of await namesIn(join(root, dir))) {
      const path = dir === '' ? name : `${dir}/${name}`;
      const info = await statOrNull(join(root, path));
      if (info?.isDirectory()) dirs.push(path);
      else if (info?.isFile()) files.push({ path, size: info.size });
    }
  }
  return files;
}

function digestOf(abs: string, algorithm: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash(algorithm);
    createReadStream(abs)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

export function dataDirHasher(root: string): HashFile {
  const digests = new Map<string, Promise<string>>();
  return (file, algorithm) => {
    const key = `${algorithm}\t${file.path}`;
    let digest = digests.get(key);
    if (!digest) {
      digest = digestOf(join(root, file.path), algorithm);
      digests.set(key, digest);
    }
    return digest;
  };
}

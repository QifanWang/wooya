import fs from 'node:fs';
import path from 'node:path';

export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return base || 'source';
}

export function uniqueDest(dir: string, name: string): string {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let candidate = path.join(dir, name);
  for (let i = 2; fs.existsSync(candidate); i++) {
    candidate = path.join(dir, `${base}-${i}${ext}`);
  }
  return candidate;
}

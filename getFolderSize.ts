import fs from 'fs';
import path from 'path';

export function getFolderSize(dirPath: string): number {
  let size = 0;
  if (!fs.existsSync(dirPath)) return 0;
  const files = fs.readdirSync(dirPath);
  for (const file of files) {
    const fullPath = path.resolve(dirPath, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      size += getFolderSize(fullPath);
    } else {
      size += stat.size;
    }
  }
  return size;
}

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import AdmZip from 'adm-zip';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const binDir = path.resolve(__dirname, '../bin');
const exePath = path.join(binDir, 'aria2c.exe');
const zipUrl = 'https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip';
const zipPath = path.join(binDir, 'aria2c.zip');

if (fs.existsSync(exePath)) {
  const stats = fs.statSync(exePath);
  if (stats.size > 1024 * 1024) {
    console.log(`[Postinstall] Verified aria2c binary at ${exePath}`);
    process.exit(0);
  } else {
    console.log(`[Postinstall] aria2c binary at ${exePath} is too small, redownloading...`);
    fs.unlinkSync(exePath);
  }
}

if (!fs.existsSync(binDir)) {
  fs.mkdirSync(binDir, { recursive: true });
}

console.log(`[Postinstall] Downloading aria2c from ${zipUrl}...`);

async function downloadAndExtract() {
  try {
    const response = await axios({
      url: zipUrl,
      method: 'GET',
      responseType: 'arraybuffer',
      maxRedirects: 5
    });
    
    fs.writeFileSync(zipPath, response.data);
    console.log('[Postinstall] Download complete. Extracting...');
    
    const zip = new AdmZip(zipPath);
    const zipEntries = zip.getEntries();
    
    let found = false;
    for (const entry of zipEntries) {
      if (entry.entryName.endsWith('aria2c.exe')) {
        const content = zip.readFile(entry);
        fs.writeFileSync(exePath, content);
        found = true;
        break;
      }
    }
    
    if (found) {
      const stats = fs.statSync(exePath);
      if (stats.size < 1024 * 1024) { // less than 1MB
        console.error(`[Postinstall] aria2c.exe is too small (${stats.size} bytes). Corrupt file?`);
        fs.unlinkSync(exePath);
        throw new Error('Downloaded aria2c.exe is corrupt or incomplete.');
      }
      console.log(`[Postinstall] Successfully extracted aria2c.exe to ${exePath}`);
    } else {
      console.error('[Postinstall] Could not find aria2c.exe in the downloaded zip archive.');
    }
    
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  } catch (err) {
    console.error('[Postinstall] Failed to download or extract aria2c:', err.message);
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    process.exit(1);
  }
}

downloadAndExtract();

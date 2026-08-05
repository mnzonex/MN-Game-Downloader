const fs = require('fs');

const content = fs.readFileSync('server.ts', 'utf8');

const regex = /function getAria2cPath\(\): string \| null \{[\s\S]*?return null;\n  \}\n\}/;

const newCode = `function getAria2cPath(): string | null {
  const isPackaged = process.env.NODE_ENV === 'production' && (process as any).resourcesPath;
  
  if (isPackaged) {
    const prodPath = path.join((process as any).resourcesPath, 'bin', 'aria2c.exe');
    if (fs.existsSync(prodPath)) return prodPath;
  }

  const devPath = path.join(process.cwd(), 'bin', 'aria2c.exe');
  if (fs.existsSync(devPath)) return devPath;

  const appData = process.env.APPDATA || (process.platform === 'darwin' ? process.env.HOME + '/Library/Preferences' : process.env.HOME + '/.local/share');
  const appDataPath = path.join(appData, 'MN Game Downloader', 'bin', 'aria2c.exe');
  if (fs.existsSync(appDataPath)) return appDataPath;

  try {
    const cmd = process.platform === 'win32' ? 'where aria2c' : 'which aria2c';
    execSync(cmd, { stdio: 'ignore' });
    return 'aria2c';
  } catch {
    return null;
  }
}`;

const newContent = content.replace(regex, newCode);
fs.writeFileSync('server.ts', newContent);
console.log('done');

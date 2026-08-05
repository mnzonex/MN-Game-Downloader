const fs = require('fs');

const pkgStr = fs.readFileSync('package.json', 'utf8');
const pkg = JSON.parse(pkgStr);

pkg.repository = {
  type: "git",
  url: "git+https://github.com/mnzonex/MN-Game-Downloader.git"
};

pkg.build.publish = {
  provider: "github",
  owner: "mnzonex",
  repo: "MN-Game-Downloader"
};

fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));

const serverStr = fs.readFileSync('server.ts', 'utf8');

const oldLaunchInstaller = `const launchInstallerWithAdmin = (setupExePath: string): Promise<boolean> => {
  return new Promise((resolve) => {
    const normalizedPath = path.normalize(setupExePath);

    if (!fs.existsSync(normalizedPath)) {
      console.error(\`[Installer Engine] Setup executable not found at path: \${normalizedPath}\`);
      return resolve(false);
    }

    const escapedPath = normalizedPath.replace(/'/g, "''");
    const psScript = \`Start-Process -FilePath '\${escapedPath}' -Verb RunAs\`;

    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-Command',
      psScript
    ], {
      detached: true,
      stdio: 'ignore'
    });

    child.unref();

    child.on('error', (err) => {
      console.error('[Installer Engine] Failed to spawn PowerShell elevation:', err);
      resolve(false);
    });

    setTimeout(() => {
      resolve(true);
    }, 1000);
  });
};`;

const newLaunchInstaller = `export const launchInstallerWithAdmin = (setupPath: string) => {
  return new Promise((resolve) => {
    const command = \`powershell -Command "Start-Process -FilePath '\${setupPath.replace(/'/g, "''")}' -Verb RunAs"\`;
    
    exec(command, (error) => {
      if (error) {
        console.error('[Windows Installer Engine] UAC Launch Error:', error);
        resolve(false);
      } else {
        console.log('[Windows Installer Engine] UAC Prompt triggered successfully.');
        resolve(true);
      }
    });
  });
};`;

const newServerStr = serverStr.replace(oldLaunchInstaller, newLaunchInstaller);

fs.writeFileSync('server.ts', newServerStr);
console.log('done');

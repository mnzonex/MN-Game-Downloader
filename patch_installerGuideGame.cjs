const fs = require('fs');

const path = 'src/components/GamesLibraryView.tsx';
let content = fs.readFileSync(path, 'utf8');

const targetLine = 'const [gameToDelete, setGameToDelete] = useState<LibraryGame | DownloadTask | null>(null);';

const addition = `
  const [installerGuideGame, setInstallerGuideGame] = useState<LibraryGame | DownloadTask | null>(null);
  
  const handleInstallerGuideContinue = () => {
    if (installerGuideGame) {
      handleInstallGame(installerGuideGame);
      setInstallerGuideGame(null);
    }
  };
`;

if (!content.includes('installerGuideGame, setInstallerGuideGame')) {
  content = content.replace(targetLine, targetLine + '\\n' + addition);
  fs.writeFileSync(path, content);
  console.log('patched');
} else {
  console.log('already patched');
}

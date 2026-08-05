const fs = require('fs');

let content = fs.readFileSync('src/components/GamesLibraryView.tsx', 'utf8');

const stateAddition = `
  const [installerGuideGame, setInstallerGuideGame] = useState<LibraryGame | null>(null);
  
  const handleInstallerGuideContinue = () => {
    if (installerGuideGame) {
      handleInstallGame(installerGuideGame);
      setInstallerGuideGame(null);
    }
  };
`;

content = content.replace(/const \[gameToDelete, setGameToDelete\] = useState<LibraryGame \| null>\(null\);/, 'const [gameToDelete, setGameToDelete] = useState<LibraryGame | null>(null);\n' + stateAddition);


const buttonRegex = /\{\/\* Actions: Setup Button \+ Open Folder Button \*\/\}([\s\S]*?)<\/div>/;

const newButton = `{/* Actions: Setup Button + Open Folder Button */}
                <div className="p-3.5 bg-white flex items-center gap-2.5">
                  <button
                    onClick={() => setInstallerGuideGame(game)}
                    className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 rounded-xl text-xs transition-all flex items-center justify-center gap-2 shadow-md shadow-indigo-600/20 hover:shadow-lg hover:shadow-indigo-600/30 cursor-pointer"
                  >
                    <FolderOpen className="w-4 h-4" />
                    <span>Open Folder & Install</span>
                  </button>
                  <button
                    onClick={() => setGameToDelete(game)}
                    className="w-11 h-11 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-xl flex items-center justify-center border border-rose-200 transition-colors cursor-pointer shrink-0"
                    title="Delete Game"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>`;

content = content.replace(buttonRegex, newButton);


const modalHTML = `
      {/* Installer Guide Modal */}
      {installerGuideGame && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-[24px] max-w-lg w-full p-8 shadow-2xl relative overflow-hidden">
            <div className="flex items-center gap-4 mb-6 text-slate-800">
              <div className="w-12 h-12 bg-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center shrink-0">
                <Wrench className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-xl font-black">Game Installation Guide</h3>
                <p className="text-sm font-semibold text-slate-500">ක්රීඩාව ස්ථාපනය කිරීමේ උපදෙස්</p>
              </div>
            </div>

            <div className="space-y-4 mb-8">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex gap-4">
                <div className="text-xl">📌</div>
                <div>
                  <div className="font-bold text-slate-800">Step 1: Locate the setup.exe file inside the opened folder.</div>
                  <div className="text-sm font-medium text-slate-500 mt-1">විවෘත වන ෆෝල්ඩරය තුළ ඇති setup.exe ගොනුව සොයාගන්න.</div>
                </div>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex gap-4">
                <div className="text-xl">📌</div>
                <div>
                  <div className="font-bold text-slate-800">Step 2: Double-click on setup.exe to launch installation.</div>
                  <div className="text-sm font-medium text-slate-500 mt-1">setup.exe මත දෙවරක් ක්ලික් කර ස්ථාපනය ආරම්භ කරන්න.</div>
                </div>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex gap-4">
                <div className="text-xl">📌</div>
                <div>
                  <div className="font-bold text-slate-800">Step 3: If Windows asks for Administrator Permission (UAC), click Yes.</div>
                  <div className="text-sm font-medium text-slate-500 mt-1">Administrator අවසර ඉල්ලූ විට Yes ලබාදෙන්න.</div>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setInstallerGuideGame(null)}
                className="flex-1 py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleInstallerGuideContinue}
                className="flex-[2] py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl shadow-md shadow-indigo-600/20 flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <FolderOpen className="w-5 h-5" />
                <span>Open Game Folder & Continue</span>
              </button>
            </div>
          </div>
        </div>
      )}
`;

content = content.replace(/\{\/\* Delete Game Confirmation Warning Modal \*\/\}/, modalHTML + '\n      {/* Delete Game Confirmation Warning Modal */}');

fs.writeFileSync('src/components/GamesLibraryView.tsx', content);
console.log('done');

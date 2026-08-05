const fs = require('fs');
const content = fs.readFileSync('src/components/TitleBar.tsx', 'utf8');

const clockImport = `import React, { useState, useEffect } from 'react';`;

let newContent = content.replace(/import React from 'react';/, clockImport);

const clockCode = `
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };
`;

newContent = newContent.replace(/export const TitleBar: React\.FC<TitleBarProps> = \(\{[\s\S]*?activeDownloadsCount\n\}\) => \{/, `export const TitleBar: React.FC<TitleBarProps> = ({\n  isOnline,\n  versionInfo,\n  onOpenUpdateModal,\n  onOpenAboutModal,\n  onOpenDonateModal,\n  defenderActive,\n  activeDownloadsCount\n}) => {\n${clockCode}\n`);

const clockJSX = `
        {/* Real-time System Clock */}
        <div className="hidden lg:flex items-center gap-1.5 text-[11px] px-3 py-0.5 rounded-lg font-mono font-bold border text-slate-700 bg-slate-50 border-slate-200 shadow-sm">
          {formatTime(time)}
        </div>
`;

newContent = newContent.replace(/\{\/\* Defender Status \*\/\}/, clockJSX + '\n        {/* Defender Status */}');

fs.writeFileSync('src/components/TitleBar.tsx', newContent);
console.log('done');

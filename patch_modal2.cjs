const fs = require('fs');

const content = fs.readFileSync('src/components/SearchScraperView.tsx', 'utf8');

const modalJSX = `
        {/* Schedule Confirmation Modal */}
        {scheduleModalOpen && selectedGame && scheduleOption && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col border border-slate-200">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                  <Clock className="w-5 h-5 text-indigo-600" />
                  Confirm Download
                </h3>
                <button 
                  onClick={() => setScheduleModalOpen(false)}
                  className="p-2 hover:bg-slate-200 rounded-full text-slate-500 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-6 flex flex-col gap-5">
                <div className="flex gap-4 items-start bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <img src={displayCover || 'https://via.placeholder.com/60'} alt="Cover" className="w-16 h-20 object-cover rounded-md shadow-sm" />
                  <div className="flex-1">
                    <h4 className="font-bold text-slate-900 line-clamp-2">{selectedGame.title}</h4>
                    <div className="flex items-center gap-2 mt-1 text-xs">
                      <span className="bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded font-bold">{selectedGame.siteBadge}</span>
                      <span className="text-slate-500 font-semibold">{displayRepackSize}</span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-600">Current System Time:</span>
                    <span className="text-sm font-bold text-slate-900 bg-slate-100 px-3 py-1 rounded-lg border border-slate-200 font-mono">
                      {currentTime.toLocaleTimeString()}
                    </span>
                  </div>

                  <div className="space-y-3 mt-2">
                    <label className={\`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all \${scheduleMode === 'immediate' ? 'border-indigo-600 bg-indigo-50' : 'border-slate-200 hover:border-indigo-300'}\`}>
                      <input 
                        type="radio" 
                        name="scheduleMode" 
                        checked={scheduleMode === 'immediate'} 
                        onChange={() => setScheduleMode('immediate')}
                        className="w-4 h-4 text-indigo-600 cursor-pointer"
                      />
                      <div>
                        <div className="font-bold text-slate-900">Immediate Download</div>
                        <div className="text-xs text-slate-500 font-medium">Start downloading right now</div>
                      </div>
                    </label>

                    <label className={\`flex flex-col gap-2 p-3 rounded-xl border-2 cursor-pointer transition-all \${scheduleMode === 'scheduled' ? 'border-indigo-600 bg-indigo-50' : 'border-slate-200 hover:border-indigo-300'}\`}>
                      <div className="flex items-center gap-3">
                        <input 
                          type="radio" 
                          name="scheduleMode" 
                          checked={scheduleMode === 'scheduled'} 
                          onChange={() => setScheduleMode('scheduled')}
                          className="w-4 h-4 text-indigo-600 cursor-pointer"
                        />
                        <div>
                          <div className="font-bold text-slate-900">Scheduled Time</div>
                          <div className="text-xs text-slate-500 font-medium">Pick a future time to start</div>
                        </div>
                      </div>
                      {scheduleMode === 'scheduled' && (
                        <div className="pl-7 pt-2">
                          <input 
                            type="datetime-local" 
                            value={scheduledTimeString}
                            onChange={(e) => setScheduledTimeString(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium focus:ring-2 focus:ring-indigo-600 focus:border-indigo-600"
                          />
                        </div>
                      )}
                    </label>
                  </div>
                </div>
              </div>

              <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                <button 
                  onClick={() => setScheduleModalOpen(false)}
                  className="px-5 py-2.5 rounded-xl font-bold text-slate-600 hover:bg-slate-200 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => {
                    if (scheduleMode === 'immediate') {
                      onStartDownload(selectedGame, scheduleOption);
                      setScheduleModalOpen(false);
                    } else {
                      if (!scheduledTimeString) return alert('Please select a valid future time.');
                      const targetTime = new Date(scheduledTimeString).getTime();
                      if (targetTime <= Date.now()) return alert('Scheduled time must be in the future.');
                      
                      fetch('/api/downloads/schedule', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          id: \`dl-\${Date.now()}\`,
                          title: selectedGame.title,
                          url: scheduleOption.url,
                          cover: displayCover || selectedGame.cover,
                          repacker: selectedGame.repacker,
                          siteBadge: selectedGame.siteBadge,
                          size: displayRepackSize || selectedGame.size,
                          scheduledTime: targetTime
                        })
                      }).then(() => {
                        setScheduleModalOpen(false);
                      }).catch(err => alert('Failed to schedule download.'));
                    }
                  }}
                  className="px-6 py-2.5 rounded-xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm transition-colors cursor-pointer"
                >
                  {scheduleMode === 'immediate' ? 'Confirm & Start' : 'Schedule Task'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
`;

const oldEnding = `      </div>
    );
  }`;

const newContent = content.replace(oldEnding, modalJSX);

fs.writeFileSync('src/components/SearchScraperView.tsx', newContent);
console.log('done');

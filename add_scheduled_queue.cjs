const fs = require('fs');

let content = fs.readFileSync('src/components/DownloadsQueueView.tsx', 'utf8');

const importRegex = /import React, \{ useEffect, useState \} from 'react';/;
// no need, it's there.

const interfaceRegex = /export const DownloadsQueueView: React.FC<DownloadsQueueViewProps> = \(\{[\s\S]*?\}\) => \{/;

const stateAddition = `
  const [scheduledTasks, setScheduledTasks] = useState<any[]>([]);

  const fetchScheduledTasks = () => {
    fetch('/api/downloads/scheduled')
      .then(res => res.json())
      .then(data => {
        if (data.scheduledTasks) {
          setScheduledTasks(data.scheduledTasks);
        }
      })
      .catch(err => console.error("Failed to fetch scheduled tasks", err));
  };

  useEffect(() => {
    fetchScheduledTasks();
    const interval = setInterval(fetchScheduledTasks, 5000);
    return () => clearInterval(interval);
  }, []);
  
  // Custom event listener for refreshing scheduled queue
  useEffect(() => {
    const handleRefresh = () => fetchScheduledTasks();
    window.addEventListener('refresh-scheduled-queue', handleRefresh);
    return () => window.removeEventListener('refresh-scheduled-queue', handleRefresh);
  }, []);
`;

content = content.replace(/const activeTasks = tasks.filter/, stateAddition + '\n  const activeTasks = tasks.filter');

const removeScheduledTaskFunction = `
  const onRemoveScheduledTask = (id: string) => {
    fetch(\`/api/downloads/scheduled/\${id}\`, { method: 'DELETE' })
      .then(() => fetchScheduledTasks())
      .catch(err => console.error(err));
  };
`;

content = content.replace(/const formatBytes = /, removeScheduledTaskFunction + '\n  const formatBytes = ');

const uiAddition = `
      {/* Scheduled Tasks Section */}
      {scheduledTasks.length > 0 && (
        <div className="flex-1 overflow-y-auto p-5 pb-0">
          <div className="flex items-center gap-2 mb-4 text-slate-800 font-black px-2">
            <Calendar className="w-5 h-5 text-indigo-500" />
            <h2>Scheduled Downloads ({scheduledTasks.length})</h2>
          </div>
          <div className="flex flex-col gap-3">
            {scheduledTasks.map((task: any) => (
              <div key={task.id} className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200/80 flex items-center gap-4 transition-all hover:shadow-md hover:border-indigo-300 group">
                <img src={task.cover || 'https://via.placeholder.com/60'} alt="Cover" className="w-12 h-16 object-cover rounded-md shadow-xs bg-slate-100" />
                <div className="flex-1">
                  <h3 className="font-bold text-slate-900 text-sm line-clamp-1">{task.title}</h3>
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-800 border border-indigo-200 flex items-center gap-1">
                      <Clock className="w-3 h-3 text-indigo-600" />
                      {new Date(task.scheduledTime).toLocaleString()}
                    </span>
                    <span className="text-xs font-semibold text-slate-500">{task.size || 'Unknown Size'}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => onRemoveScheduledTask(task.id)}
                    className="p-2 bg-rose-50 text-rose-600 hover:bg-rose-600 hover:text-white rounded-xl font-bold shadow-xs transition-all border border-rose-100 hover:border-rose-600"
                    title="Cancel Scheduled Task"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
`;

content = content.replace(/\{activeTasks\.length === 0 && tasks\.length === 0 && \(/, uiAddition + '\n      {activeTasks.length === 0 && tasks.length === 0 && (');

fs.writeFileSync('src/components/DownloadsQueueView.tsx', content);
console.log('done');

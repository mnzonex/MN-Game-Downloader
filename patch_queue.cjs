const fs = require('fs');

const content = fs.readFileSync('src/components/DownloadsQueueView.tsx', 'utf8');

const importLines = `import React, { useEffect, useState } from 'react';
import { Download, Pause, Play, Trash2, WifiOff, Cpu, AlertTriangle, Folder, CheckCircle, Gamepad2, Clock, Calendar } from 'lucide-react';
`;

let newContent = content.replace(/import React from 'react';\nimport \{[^\n]+\} from 'lucide-react';/, importLines);

const scheduledState = `
  const [scheduledTasks, setScheduledTasks] = useState<any[]>([]);

  useEffect(() => {
    const fetchScheduled = () => {
      fetch('/api/downloads/scheduled')
        .then(res => res.json())
        .then(data => setScheduledTasks(data.scheduledTasks || []))
        .catch(console.error);
    };
    fetchScheduled();
    const interval = setInterval(fetchScheduled, 5000);
    return () => clearInterval(interval);
  }, []);

  const cancelScheduled = async (id: string) => {
    try {
      await fetch(\`/api/downloads/scheduled/\${id}\`, { method: 'DELETE' });
      setScheduledTasks(prev => prev.filter(t => t.id !== id));
    } catch (e) {
      console.error('Failed to cancel scheduled task');
    }
  };
`;

newContent = newContent.replace(/export const DownloadsQueueView: React\.FC<DownloadsQueueViewProps> = \(\{[\s\S]*?onDeleteTask\n\}\) => \{/, `export const DownloadsQueueView: React.FC<DownloadsQueueViewProps> = ({\n  tasks,\n  onPauseTask,\n  onResumeTask,\n  onDeleteTask\n}) => {\n${scheduledState}`);

const scheduledJSX = `
      {/* Scheduled Tasks Section */}
      {scheduledTasks.length > 0 && (
        <div className="mx-6 sm:mx-10 mt-6 bg-indigo-50 border border-indigo-100 rounded-xl overflow-hidden shadow-sm">
          <div className="px-5 py-3 border-b border-indigo-100 bg-indigo-100/50 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-indigo-700" />
            <h3 className="font-bold text-indigo-900">Scheduled Downloads ({scheduledTasks.length})</h3>
          </div>
          <div className="divide-y divide-indigo-100">
            {scheduledTasks.map(task => (
              <div key={task.id} className="p-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <img src={task.cover || 'https://via.placeholder.com/48'} className="w-12 h-16 object-cover rounded shadow-sm" alt="Cover" />
                  <div>
                    <h4 className="font-bold text-indigo-900 line-clamp-1">{task.title}</h4>
                    <div className="text-sm font-semibold text-indigo-700 flex items-center gap-1.5 mt-0.5">
                      <Clock className="w-3.5 h-3.5" />
                      Starts at {new Date(task.scheduledTime).toLocaleString()}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => cancelScheduled(task.id)}
                  className="bg-white hover:bg-rose-50 text-rose-600 border border-indigo-100 hover:border-rose-200 px-4 py-2 rounded-lg text-sm font-bold shadow-sm transition-colors cursor-pointer"
                >
                  Cancel Schedule
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
`;

newContent = newContent.replace(/\{activeTasks\.length === 0 \? \(/, scheduledJSX + '\n        {activeTasks.length === 0 ? (');

fs.writeFileSync('src/components/DownloadsQueueView.tsx', newContent);
console.log('done');

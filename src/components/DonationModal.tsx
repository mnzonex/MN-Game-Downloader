import React, { useState } from 'react';
import { Copy, X, Check, Heart } from 'lucide-react';

interface DonationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DonationModal: React.FC<DonationModalProps> = ({ isOpen, onClose }) => {
  const [copied, setCopied] = useState(false);
  const binancePayId = '766308505';

  if (!isOpen) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(binancePayId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Failed to copy');
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white border border-slate-200 rounded-[24px] max-w-sm w-full p-8 space-y-6 shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-full transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex flex-col items-center text-center space-y-3">
          <div className="w-16 h-16 rounded-full bg-amber-100 border border-amber-200 flex items-center justify-center mb-2 shadow-sm shadow-amber-500/10">
            <Heart className="w-8 h-8 text-amber-500 fill-amber-500" />
          </div>
          
          <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">Support the Developer</h2>
          <p className="text-xs text-slate-500 font-medium leading-relaxed max-w-[240px]">
            If you love this tool and want to support further development, please consider donating via Binance Pay.
          </p>
        </div>

        <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-col items-center justify-center space-y-4">
          <div className="w-full aspect-square max-w-[260px] relative rounded-xl border border-slate-200 shadow-sm overflow-hidden bg-white flex items-center justify-center p-2">
            <img 
              src="/donate.jpeg" 
              alt="Binance Pay QR Code" 
              className="w-full h-full object-cover scale-[1.65] object-center"
              onError={(e) => {
                (e.target as HTMLImageElement).parentElement!.style.display = 'none';
              }}
            />
          </div>

          <div className="w-full flex items-center justify-between bg-white border border-slate-200 rounded-lg p-2.5">
            <div className="flex flex-col text-left overflow-hidden">
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Binance Pay ID</span>
              <span className="text-sm font-mono font-bold text-slate-900">{binancePayId}</span>
            </div>
            <button
              onClick={handleCopy}
              className={`p-2 rounded-lg transition-colors cursor-pointer ${copied ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}
              title="Copy ID"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <button
          onClick={onClose}
          className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-sm transition-all shadow-md shadow-amber-500/20 cursor-pointer"
        >
          Thank You!
        </button>
      </div>
    </div>
  );
};

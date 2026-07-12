import type { TranscriptEntry } from '@/hooks/useVoiceLoop';

export function TranscriptView({ entries, interim }: { entries: TranscriptEntry[]; interim: string }) {
  return (
    <div className="flex min-h-64 flex-col gap-2 rounded-lg border border-slate-700 bg-slate-900/60 p-4">
      {entries.length === 0 && (
        <p className="text-sm text-slate-500">「通話を開始」を押すと受付が応答します。</p>
      )}
      {entries.map((entry, i) => (
        <div key={i} className={entry.role === 'user' ? 'self-end text-right' : 'self-start'}>
          <span className="mb-0.5 block text-xs text-slate-500">
            {entry.role === 'user' ? 'あなた' : '受付'}
          </span>
          <p
            className={`inline-block max-w-md rounded-lg px-3 py-2 text-sm ${
              entry.role === 'user' ? 'bg-indigo-600/30' : 'bg-slate-800'
            }`}
          >
            {entry.text}
          </p>
        </div>
      ))}
      {interim.length > 0 && (
        <div className="self-end text-right">
          <p className="inline-block max-w-md rounded-lg bg-indigo-600/10 px-3 py-2 text-sm text-slate-400">
            {interim}…
          </p>
        </div>
      )}
    </div>
  );
}

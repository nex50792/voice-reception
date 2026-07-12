import type { Slots } from '@/lib/reservation-slots';

const ROWS: { key: keyof Slots; label: string }[] = [
  { key: 'date', label: '日付' },
  { key: 'time', label: '時間' },
  { key: 'partySize', label: '人数' },
  { key: 'name', label: 'お名前' },
];

export function SlotsCard({ slots }: { slots: Slots }) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-4">
      <h3 className="mb-2 text-sm font-semibold text-slate-300">聞き取り状況</h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {ROWS.map(({ key, label }) => {
          const value = slots[key];
          return (
            <div key={key} className="flex justify-between border-b border-slate-800 py-1">
              <dt className="text-slate-400">{label}</dt>
              <dd className={value !== undefined ? 'text-emerald-400' : 'text-slate-600'}>
                {value !== undefined ? (key === 'partySize' ? `${value}名` : String(value)) : '未確認'}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

import type { TurnState } from '@/lib/turn-machine';

const LABEL: Record<TurnState, { text: string; className: string }> = {
  idle: { text: '待機中', className: 'bg-slate-700 text-slate-300' },
  listening: { text: '聞き取り中', className: 'bg-emerald-600/20 text-emerald-400 border border-emerald-600' },
  thinking: { text: '考え中', className: 'bg-amber-600/20 text-amber-400 border border-amber-600' },
  speaking: { text: '応答中 (話しかけると中断)', className: 'bg-sky-600/20 text-sky-400 border border-sky-600' },
};

export function StatusBadge({ state }: { state: TurnState }) {
  const { text, className } = LABEL[state];
  return <span className={`rounded-full px-3 py-1 text-xs font-medium ${className}`}>{text}</span>;
}

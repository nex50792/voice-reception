import type { LatencyView } from '@/hooks/useVoiceLoop';

function ms(value: number | null | undefined): string {
  return value === null || value === undefined ? '-' : `${Math.round(value)}ms`;
}

export function LatencyHud({ latency, model }: { latency: LatencyView; model: string | null }) {
  const seg = latency.lastSegments;
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-300">応答レイテンシ (発話終了→応答開始)</h3>
        {model && <span className="text-xs text-slate-500">応答: {model}</span>}
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded bg-slate-800 p-2">
          <div className="text-lg font-semibold">{ms(seg?.total)}</div>
          <div className="text-xs text-slate-400">直近ターン</div>
        </div>
        <div className="rounded bg-slate-800 p-2">
          <div className="text-lg font-semibold">{ms(latency.p50)}</div>
          <div className="text-xs text-slate-400">p50 ({latency.count}ターン)</div>
        </div>
        <div className="rounded bg-slate-800 p-2">
          <div className="text-lg font-semibold">{ms(latency.p95)}</div>
          <div className="text-xs text-slate-400">p95</div>
        </div>
      </div>
      {seg && (
        <p className="mt-2 text-xs text-slate-500">
          内訳: 認識確定 {ms(seg.stt)} / 初トークン {ms(seg.llm)} / 発声開始 {ms(seg.tts)}
        </p>
      )}
    </div>
  );
}

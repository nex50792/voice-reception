'use client';

import { LatencyHud } from '@/components/LatencyHud';
import { CancelledCard, EscalationBanner, ReservationCard } from '@/components/ResultCards';
import { SlotsCard } from '@/components/SlotsCard';
import { StatusBadge } from '@/components/StatusBadge';
import { TranscriptView } from '@/components/TranscriptView';
import { useVoiceLoop } from '@/hooks/useVoiceLoop';

export default function Home() {
  const loop = useVoiceLoop();
  const active = loop.turnState !== 'idle';

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-6">
      <header>
        <h1 className="text-2xl font-bold">voice-reception</h1>
        <p className="mt-1 text-sm text-slate-400">
          電話の一次受けを想定した音声受付のデモ。予約 (日付・時間・人数・名前を聞き取って確定) とキャンセル (既存予約と照合して取り消し) を音声だけで完結できます。読み上げ中に話しかけると、発話が認識された時点で残りを打ち切って応答します。
        </p>
      </header>

      <div className="flex items-center gap-3">
        {active ? (
          <button
            type="button"
            onClick={loop.stop}
            className="rounded-lg bg-rose-600 px-5 py-2 text-sm font-medium hover:bg-rose-500"
          >
            通話を終了
          </button>
        ) : (
          <button
            type="button"
            onClick={loop.start}
            className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium hover:bg-indigo-500"
          >
            通話を開始
          </button>
        )}
        <StatusBadge state={loop.turnState} />
        {loop.micRms !== null && (
          <span className="flex items-center gap-2 text-xs text-slate-500">
            マイク
            <span className="inline-block h-2 w-24 overflow-hidden rounded bg-slate-800">
              <span
                className="block h-full bg-emerald-500 transition-[width] duration-150"
                style={{ width: `${Math.min(100, (loop.micRms / 0.3) * 100)}%` }}
              />
            </span>
            <span data-testid="mic-rms">{loop.micRms.toFixed(3)}</span>
          </span>
        )}
      </div>

      {loop.error && (
        <div className="rounded-lg border border-rose-700 bg-rose-950/40 p-3 text-sm text-rose-300">
          {loop.error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-[1fr_320px]">
        <TranscriptView entries={loop.transcript} interim={loop.interim} />
        <div className="space-y-4">
          <SlotsCard slots={loop.slots} />
          <LatencyHud latency={loop.latency} model={loop.model} />
          {loop.reservation && <ReservationCard reservation={loop.reservation} />}
          {loop.cancelled && <CancelledCard reservation={loop.cancelled} />}
          {loop.escalation && <EscalationBanner escalation={loop.escalation} />}
        </div>
      </div>

      <footer className="border-t border-slate-800 pt-3 text-xs text-slate-500">
        音声認識と読み上げはブラウザ内蔵の Web Speech API、応答は Gemini の function calling
        (空き確認・予約確定・担当者への引き継ぎ)。API キー未設定時は決定的なスタブ応答で動きます。
      </footer>
    </main>
  );
}

import type { Escalation } from '@/hooks/useVoiceLoop';
import type { Reservation } from '@/lib/reservation-store';

export function ReservationCard({ reservation }: { reservation: Reservation }) {
  return (
    <div className="rounded-lg border border-emerald-700 bg-emerald-950/40 p-4">
      <h3 className="mb-2 text-sm font-semibold text-emerald-400">予約が確定しました</h3>
      <p className="text-sm">
        {reservation.date} {reservation.time} / {reservation.partySize}名 / {reservation.name}様
      </p>
      <p className="mt-1 text-xs text-slate-400">確認番号: {reservation.confirmationCode}</p>
    </div>
  );
}

export function CancelledCard({ reservation }: { reservation: Reservation }) {
  return (
    <div className="rounded-lg border border-slate-600 bg-slate-900/60 p-4">
      <h3 className="mb-2 text-sm font-semibold text-slate-300">予約を取り消しました</h3>
      <p className="text-sm">
        {reservation.date} {reservation.time} / {reservation.partySize}名 / {reservation.name}様
      </p>
      <p className="mt-1 text-xs text-slate-400">確認番号: {reservation.confirmationCode}</p>
    </div>
  );
}

export function EscalationBanner({ escalation }: { escalation: Escalation }) {
  return (
    <div className="rounded-lg border border-amber-700 bg-amber-950/40 p-4">
      <h3 className="mb-1 text-sm font-semibold text-amber-400">担当者へ引き継ぎ</h3>
      <p className="text-sm text-slate-300">{escalation.reason}</p>
      {escalation.summary && <p className="mt-1 text-xs text-slate-400">引き継ぎメモ: {escalation.summary}</p>}
    </div>
  );
}

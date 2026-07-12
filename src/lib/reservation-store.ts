import { nameToKana } from './jp-name-readings';
import { isComplete, missingSlots, type Slots } from './reservation-slots';
import * as neonStore from './reservation-store-neon';

export interface Reservation {
  confirmationCode: string;
  date: string;
  time: string;
  partySize: number;
  name: string;
  createdAt: number;
}

export type CreateResult =
  | { reservation: Reservation; alreadyExisted: boolean }
  | { error: string; alternatives?: string[] };

export type CancelResult = { reservation: Reservation } | { error: 'not_found' };

export interface Availability {
  available: boolean;
  reason?: string;
  alternatives?: string[];
  dayFull?: boolean;
}

export const OPEN = '17:00';
export const CLOSE = '21:30';
export const ALWAYS_FULL_TIME = '19:00';
export const CAPACITY_PER_SLOT = 3;
export const SLOT_TIMES = [
  '17:00',
  '17:30',
  '18:00',
  '18:30',
  '19:00',
  '19:30',
  '20:00',
  '20:30',
  '21:00',
  '21:30',
];

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function slotOpen(time: string, countBySlot: Record<string, number>): boolean {
  if (time === ALWAYS_FULL_TIME) return false;
  return (countBySlot[time] ?? 0) < CAPACITY_PER_SLOT;
}

export function evaluateAvailability(
  time: string,
  countBySlot: Record<string, number>,
): Availability {
  if (time < OPEN || time > CLOSE) {
    return { available: false, reason: `営業時間は ${OPEN}〜${CLOSE} です` };
  }
  if (slotOpen(time, countBySlot)) {
    return { available: true };
  }

  const alternatives = SLOT_TIMES.filter((t) => t !== time && slotOpen(t, countBySlot))
    .sort((a, b) => Math.abs(toMinutes(a) - toMinutes(time)) - Math.abs(toMinutes(b) - toMinutes(time)))
    .slice(0, 2);

  if (alternatives.length === 0) {
    return { available: false, dayFull: true, reason: 'その日は満席です' };
  }
  const reason = time === ALWAYS_FULL_TIME ? `${time} は満席です` : 'その時間帯は満席です';
  return { available: false, reason, alternatives };
}

const neonEnabled = () => Boolean(process.env.DATABASE_URL);

// DATABASE_URL 未設定時のフォールバック (開発・CI 用)。
// serverless ではインスタンス間で共有されないため、本番は Neon を使う。
const memory = new Map<string, Reservation>();
let sequence = 0;

function memoryCounts(date: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of memory.values()) {
    if (r.date === date) counts[r.time] = (counts[r.time] ?? 0) + 1;
  }
  return counts;
}

export async function resetStore(): Promise<void> {
  memory.clear();
  sequence = 0;
  if (neonEnabled()) await neonStore.resetAll();
}

export async function createReservation(sessionId: string, slots: Slots): Promise<CreateResult> {
  if (!isComplete(slots)) {
    return { error: `missing slots: ${missingSlots(slots).join(', ')}` };
  }

  // 二重送信は満席扱いにせず既存予約を返す (自分の予約で枠が埋まるケースがあるため先に見る)
  const existing = neonEnabled()
    ? await neonStore.findBySession(sessionId)
    : (memory.get(sessionId) ?? null);
  if (existing) {
    return { reservation: existing, alreadyExisted: true };
  }

  // 空き確認は LLM 任せにせず、確定時にサーバー側で必ず行う
  const availability = await checkAvailability(slots.date!, slots.time!);
  if (!availability.available) {
    return { error: availability.reason ?? '満席です', alternatives: availability.alternatives };
  }

  if (neonEnabled()) return neonStore.createReservation(sessionId, slots);

  sequence += 1;
  const reservation: Reservation = {
    confirmationCode: `R-${String(sequence).padStart(4, '0')}`,
    date: slots.date!,
    time: slots.time!,
    partySize: slots.partySize!,
    name: nameToKana(slots.name!),
    createdAt: Date.now(),
  };
  memory.set(sessionId, reservation);
  return { reservation, alreadyExisted: false };
}

export async function cancelReservation(
  date: string,
  time: string,
  name: string,
): Promise<CancelResult> {
  if (neonEnabled()) return neonStore.cancelReservation(date, time, name);

  const queryName = nameToKana(name);
  for (const [key, reservation] of memory) {
    if (
      reservation.date === date &&
      reservation.time === time &&
      nameToKana(reservation.name) === queryName
    ) {
      memory.delete(key);
      return { reservation };
    }
  }
  return { error: 'not_found' };
}

export async function listReservations(): Promise<Reservation[]> {
  if (neonEnabled()) return neonStore.listReservations();
  return [...memory.values()].sort((a, b) => a.createdAt - b.createdAt);
}

export async function checkAvailability(date: string, time: string): Promise<Availability> {
  const counts = neonEnabled() ? await neonStore.slotCounts(date) : memoryCounts(date);
  return evaluateAvailability(time, counts);
}

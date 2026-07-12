import { neon } from '@neondatabase/serverless';
import { nameToKana } from './jp-name-readings';
import type { Slots } from './reservation-slots';
import type { CancelResult, CreateResult, Reservation } from './reservation-store';

interface ReservationRow {
  id: number;
  session_id: string;
  date: string;
  time: string;
  party_size: number;
  name: string;
  created_at: string;
}

function sql() {
  return neon(process.env.DATABASE_URL!);
}

let schemaReady: Promise<void> | null = null;

function ensureSchema(): Promise<void> {
  schemaReady ??= (async () => {
    await sql()`
      CREATE TABLE IF NOT EXISTS reservations (
        id SERIAL PRIMARY KEY,
        session_id TEXT NOT NULL UNIQUE,
        date TEXT NOT NULL,
        time TEXT NOT NULL,
        party_size INT NOT NULL,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
  })();
  return schemaReady;
}

function toReservation(row: ReservationRow): Reservation {
  return {
    confirmationCode: `R-${String(row.id).padStart(4, '0')}`,
    date: row.date,
    time: row.time,
    partySize: row.party_size,
    name: row.name,
    createdAt: new Date(row.created_at).getTime(),
  };
}

export async function findBySession(sessionId: string): Promise<Reservation | null> {
  await ensureSchema();
  const rows = (await sql()`
    SELECT * FROM reservations WHERE session_id = ${sessionId}
  `) as ReservationRow[];
  return rows.length > 0 ? toReservation(rows[0]) : null;
}

export async function createReservation(sessionId: string, slots: Slots): Promise<CreateResult> {
  await ensureSchema();
  const name = nameToKana(slots.name!);
  const inserted = (await sql()`
    INSERT INTO reservations (session_id, date, time, party_size, name)
    VALUES (${sessionId}, ${slots.date!}, ${slots.time!}, ${slots.partySize!}, ${name})
    ON CONFLICT (session_id) DO NOTHING
    RETURNING *
  `) as ReservationRow[];
  if (inserted.length > 0) {
    return { reservation: toReservation(inserted[0]), alreadyExisted: false };
  }
  const existing = (await sql()`
    SELECT * FROM reservations WHERE session_id = ${sessionId}
  `) as ReservationRow[];
  return { reservation: toReservation(existing[0]), alreadyExisted: true };
}

export async function cancelReservation(
  date: string,
  time: string,
  name: string,
): Promise<CancelResult> {
  await ensureSchema();
  const rows = (await sql()`
    SELECT * FROM reservations WHERE date = ${date} AND time = ${time}
  `) as ReservationRow[];
  const queryName = nameToKana(name);
  const hit = rows.find((row) => nameToKana(row.name) === queryName);
  if (hit === undefined) {
    return { error: 'not_found' };
  }
  await sql()`DELETE FROM reservations WHERE id = ${hit.id}`;
  return { reservation: toReservation(hit) };
}

export async function slotCounts(date: string): Promise<Record<string, number>> {
  await ensureSchema();
  const rows = (await sql()`
    SELECT time, count(*)::int AS n FROM reservations WHERE date = ${date} GROUP BY time
  `) as { time: string; n: number }[];
  return Object.fromEntries(rows.map((row) => [row.time, row.n]));
}

export async function listReservations(): Promise<Reservation[]> {
  await ensureSchema();
  const rows = (await sql()`
    SELECT * FROM reservations ORDER BY created_at
  `) as ReservationRow[];
  return rows.map(toReservation);
}

export async function resetAll(): Promise<void> {
  await ensureSchema();
  await sql()`DELETE FROM reservations`;
}

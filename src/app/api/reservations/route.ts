import { listReservations } from '@/lib/reservation-store';

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  return Response.json({ reservations: await listReservations() });
}

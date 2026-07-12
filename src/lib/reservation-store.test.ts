import { beforeEach, describe, expect, it } from 'vitest';
import {
  cancelReservation,
  checkAvailability,
  createReservation,
  listReservations,
  resetStore,
  type CreateResult,
} from './reservation-store';

const SLOTS = { date: '2026-07-15', time: '18:00', partySize: 2, name: '山田' };

function expectCreated(result: CreateResult) {
  if ('error' in result) {
    throw new Error(`expected reservation but got error: ${result.error}`);
  }
  return result;
}

beforeEach(async () => {
  delete process.env.DATABASE_URL;
  await resetStore();
});

describe('createReservation', () => {
  it('予約を作成して確認番号を返す', async () => {
    const result = expectCreated(await createReservation('session-1', SLOTS));
    expect(result.reservation.confirmationCode).toMatch(/^R-\d{4}$/);
    expect(result.alreadyExisted).toBe(false);
    expect(await listReservations()).toHaveLength(1);
  });

  it('同一セッションの二重確定は同じ予約を返す (冪等)', async () => {
    const first = expectCreated(await createReservation('session-1', SLOTS));
    const second = expectCreated(await createReservation('session-1', SLOTS));
    expect(second.alreadyExisted).toBe(true);
    expect(second.reservation.confirmationCode).toBe(first.reservation.confirmationCode);
    expect(await listReservations()).toHaveLength(1);
  });

  it('別セッションなら別予約になる', async () => {
    await createReservation('session-1', SLOTS);
    await createReservation('session-2', { ...SLOTS, name: '佐藤' });
    expect(await listReservations()).toHaveLength(2);
  });

  it('スロットが欠けていればエラーを返す', async () => {
    const result = await createReservation('session-1', { ...SLOTS, name: undefined });
    expect('error' in result && result.error).toContain('name');
  });

  it('満席の時間帯はサーバー側で確定を拒否して代替案を返す (LLM の空き確認任せにしない)', async () => {
    const result = await createReservation('session-1', { ...SLOTS, time: '19:00' });
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('満席');
      expect(result.alternatives).toEqual(['18:30', '19:30']);
    }
  });

  it('営業時間外はサーバー側で確定を拒否する', async () => {
    const result = await createReservation('session-1', { ...SLOTS, time: '12:00' });
    expect('error' in result && result.error).toContain('営業時間');
  });

  it('自分の予約で枠が埋まっていても二重確定は満席でなく既存予約を返す', async () => {
    await createReservation('s1', SLOTS);
    await createReservation('s2', SLOTS);
    await createReservation('s3', SLOTS);
    const dup = await createReservation('s1', SLOTS);
    expect('reservation' in dup && dup.alreadyExisted).toBe(true);
  });
});

describe('cancelReservation', () => {
  it('日付・時間・名前が一致する予約を取り消す', async () => {
    await createReservation('s1', SLOTS);
    const result = await cancelReservation('2026-07-15', '18:00', '山田');
    expect('reservation' in result && result.reservation.confirmationCode).toBe('R-0001');
    expect(await listReservations()).toHaveLength(0);
  });

  it('名前はカタカナに正規化して保存する (電話では漢字を確認できないため)', async () => {
    await createReservation('s1', { ...SLOTS, name: 'やまだ' });
    expect((await listReservations())[0].name).toBe('ヤマダ');
  });

  it('ひらがなとカタカナの表記揺れはカタカナ正規化で照合する', async () => {
    await createReservation('s1', { ...SLOTS, name: 'やまだ' });
    const result = await cancelReservation('2026-07-15', '18:00', 'ヤマダ');
    expect('reservation' in result).toBe(true);
    expect(await listReservations()).toHaveLength(0);
  });

  it('名前が一致しなければ取り消さない', async () => {
    await createReservation('s1', SLOTS);
    const result = await cancelReservation('2026-07-15', '18:00', '佐藤');
    expect('error' in result && result.error).toBe('not_found');
    expect(await listReservations()).toHaveLength(1);
  });

  it('該当予約がなければ not_found を返す', async () => {
    const result = await cancelReservation('2026-07-15', '18:00', '山田');
    expect('error' in result && result.error).toBe('not_found');
  });
});

describe('checkAvailability', () => {
  it('営業時間内 (17:00〜21:30) は空きあり', async () => {
    expect((await checkAvailability('2026-07-15', '17:00')).available).toBe(true);
    expect((await checkAvailability('2026-07-15', '21:30')).available).toBe(true);
  });

  it('営業時間外は空きなしで営業時間を案内する', async () => {
    const result = await checkAvailability('2026-07-15', '12:00');
    expect(result.available).toBe(false);
    expect(result.reason).toContain('17:00');
  });

  it('19:00 は常に満席で代替時刻を提示する (デモ用の固定ルール)', async () => {
    const result = await checkAvailability('2026-07-15', '19:00');
    expect(result.available).toBe(false);
    expect(result.alternatives).toEqual(['18:30', '19:30']);
  });

  it('満席の時間帯は近い順に空き時間を提案する', async () => {
    for (const s of ['s1', 's2', 's3']) await createReservation(s, SLOTS);
    const result = await checkAvailability('2026-07-15', '18:00');
    expect(result.available).toBe(false);
    expect(result.alternatives).toEqual(['17:30', '18:30']);
  });

  it('全時間帯が満席なら dayFull で別日を促す', async () => {
    const times = ['17:00', '17:30', '18:00', '18:30', '19:30', '20:00', '20:30', '21:00', '21:30'];
    let i = 0;
    for (const time of times) {
      for (let n = 0; n < 3; n++) {
        await createReservation(`s${i++}`, { ...SLOTS, time });
      }
    }
    const result = await checkAvailability('2026-07-15', '18:00');
    expect(result.available).toBe(false);
    expect(result.dayFull).toBe(true);
    expect(result.reason).toContain('その日は満席');
  });

  it('別の日は満席の影響を受けない', async () => {
    for (const s of ['s1', 's2', 's3']) await createReservation(s, SLOTS);
    expect((await checkAvailability('2026-07-16', '18:00')).available).toBe(true);
  });
});

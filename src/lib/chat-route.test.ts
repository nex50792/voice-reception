import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as geminiModule from '@/lib/gemini';
import { POST } from '@/app/api/chat/route';
import { GET } from '@/app/api/reservations/route';
import { parseDateJa } from './jp-parse';
import type { ChatEvent, ChatMessage } from './receptionist';
import { createReservation, resetStore } from './reservation-store';
import type { Slots } from './reservation-slots';

function tomorrowInJst(): string {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
  return parseDateJa('明日', today)!;
}

interface Session {
  sessionId: string;
  slots: Slots;
  messages: ChatMessage[];
}

async function callChat(session: Session, text: string): Promise<ChatEvent[]> {
  session.messages.push({ role: 'user', text });
  const request = new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(session),
  });
  const response = await POST(request);
  expect(response.status).toBe(200);

  const events = (await response.text())
    .split('\n\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)) as ChatEvent);

  const reply = events
    .filter((e): e is Extract<ChatEvent, { type: 'delta' }> => e.type === 'delta')
    .map((e) => e.text)
    .join('');
  for (const event of events) {
    if (event.type === 'slots') session.slots = event.slots;
  }
  session.messages.push({ role: 'assistant', text: reply });
  return events;
}

function eventOf<T extends ChatEvent['type']>(events: ChatEvent[], type: T) {
  return events.find((e): e is Extract<ChatEvent, { type: T }> => e.type === type);
}

describe('/api/chat スタブモード統合テスト', () => {
  beforeEach(async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.DATABASE_URL;
    await resetStore();
  });

  it('スロット充填 → 満席代替 → 予約確定 → 冪等性 → エスカレーションが一連で通る', async () => {
    const session: Session = { sessionId: 'it-session-1', slots: {}, messages: [] };

    const intro = await callChat(session, '予約をお願いしたいんですが');
    const introReply = intro
      .filter((e): e is Extract<ChatEvent, { type: 'delta' }> => e.type === 'delta')
      .map((e) => e.text)
      .join('');
    expect(introReply).toContain('日付');
    expect(introReply).not.toContain('聞き取れません');

    await callChat(session, '明日お願いします');
    expect(session.slots.date).toBeDefined();

    const fullEvents = await callChat(session, '19時でお願いします');
    const fullReply = fullEvents
      .filter((e): e is Extract<ChatEvent, { type: 'delta' }> => e.type === 'delta')
      .map((e) => e.text)
      .join('');
    expect(fullReply).toContain('満席');
    expect(fullReply).toContain('18:30');
    expect(session.slots.time).toBeUndefined();

    await callChat(session, '18時半で');
    expect(session.slots.time).toBe('18:30');

    await callChat(session, '4名です');
    expect(session.slots.partySize).toBe(4);

    const createEvents = await callChat(session, '山田です');
    const created = eventOf(createEvents, 'reservation');
    expect(created).toBeDefined();
    expect(created!.alreadyExisted).toBe(false);
    expect(created!.reservation.confirmationCode).toMatch(/^R-\d{4}$/);
    expect(eventOf(createEvents, 'end')?.reason).toBe('completed');

    const dupEvents = await callChat(session, 'もう一度お願いします 山田です');
    const dup = eventOf(dupEvents, 'reservation');
    expect(dup).toBeDefined();
    expect(dup!.alreadyExisted).toBe(true);
    expect(dup!.reservation.confirmationCode).toBe(created!.reservation.confirmationCode);

    const listResponse = await GET();
    const list = (await listResponse.json()) as { reservations: unknown[] };
    expect(list.reservations).toHaveLength(1);

    const escalateEvents = await callChat(session, 'クレームを言いたいんですが');
    const escalation = eventOf(escalateEvents, 'escalation');
    expect(escalation).toBeDefined();
    expect(escalation!.reason).toContain('クレーム');
    expect(eventOf(escalateEvents, 'end')?.reason).toBe('escalated');

    const done = eventOf(escalateEvents, 'done');
    expect(done!.model).toBe('stub');
  });

  it('挨拶だけの発話には用件確認で返し、同意で予約フローに入る', async () => {
    const session: Session = { sessionId: 'it-greeting', slots: {}, messages: [] };

    const first = await callChat(session, 'こんにちは');
    const firstReply = first
      .filter((e): e is Extract<ChatEvent, { type: 'delta' }> => e.type === 'delta')
      .map((e) => e.text)
      .join('');
    expect(firstReply).toContain('ご予約のお電話でしょうか');
    expect(firstReply).not.toContain('聞き取れません');
    expect(firstReply).not.toContain('日付');

    const second = await callChat(session, 'はい、お願いします');
    const secondReply = second
      .filter((e): e is Extract<ChatEvent, { type: 'delta' }> => e.type === 'delta')
      .map((e) => e.text)
      .join('');
    expect(secondReply).toContain('日付');
    expect(secondReply).toContain('ありがとうございます');
  });

  it('問い合わせの用件は担当者へ引き継ぐ', async () => {
    const session: Session = { sessionId: 'it-inquiry', slots: {}, messages: [] };
    const events = await callChat(session, 'ちょっと問い合わせをしたいのですが');
    expect(eventOf(events, 'escalation')).toBeDefined();
    expect(eventOf(events, 'end')?.reason).toBe('escalated');
    const reply = events
      .filter((e): e is Extract<ChatEvent, { type: 'delta' }> => e.type === 'delta')
      .map((e) => e.text)
      .join('');
    expect(reply).toContain('担当の者');
    expect(reply).not.toContain('聞き取れません');
  });

  it('キャンセルは日付・時間・名前を聞き取って予約を取り消す', async () => {
    const reserveSession: Session = { sessionId: 'it-cancel-r', slots: {}, messages: [] };
    await callChat(reserveSession, '明日の18時半に4名でお願いします');
    const createEvents = await callChat(reserveSession, '山田です');
    expect(eventOf(createEvents, 'reservation')).toBeDefined();

    const cancelSession: Session = { sessionId: 'it-cancel-c', slots: {}, messages: [] };
    const intro = await callChat(cancelSession, '予約のキャンセルをお願いします');
    const introReply = intro
      .filter((e): e is Extract<ChatEvent, { type: 'delta' }> => e.type === 'delta')
      .map((e) => e.text)
      .join('');
    expect(introReply).toContain('キャンセル');
    expect(introReply).toContain('日付');

    await callChat(cancelSession, '明日です');
    await callChat(cancelSession, '18時半');
    const cancelEvents = await callChat(cancelSession, '山田です');
    const cancelledEvent = eventOf(cancelEvents, 'cancelled');
    expect(cancelledEvent).toBeDefined();
    expect(cancelledEvent!.reservation.name).toBe('ヤマダ');
    expect(eventOf(cancelEvents, 'end')?.reason).toBe('completed');

    const listResponse = await GET();
    const list = (await listResponse.json()) as { reservations: unknown[] };
    expect(list.reservations).toHaveLength(0);
  });

  it('名前はカタカナで復唱され、ひらがな予約とカタカナキャンセルが照合できる', async () => {
    const reserveSession: Session = { sessionId: 'it-kana-r', slots: {}, messages: [] };
    await callChat(reserveSession, '明日の18時半に2名でお願いします');
    const createEvents = await callChat(reserveSession, 'やまだです');
    const readback = createEvents
      .filter((e): e is Extract<ChatEvent, { type: 'delta' }> => e.type === 'delta')
      .map((e) => e.text)
      .join('');
    expect(readback).toContain('ヤマダ様');
    expect(readback).not.toContain('やまだ様');

    const cancelSession: Session = { sessionId: 'it-kana-c', slots: {}, messages: [] };
    await callChat(cancelSession, 'キャンセルをお願いします');
    await callChat(cancelSession, '明日です');
    await callChat(cancelSession, '18時半');
    const events = await callChat(cancelSession, 'ヤマダです');
    expect(eventOf(events, 'cancelled')).toBeDefined();
  });

  it('全時間帯が満席の日は別の日を案内する', async () => {
    const tomorrow = tomorrowInJst();
    const times = ['17:00', '17:30', '18:00', '18:30', '19:30', '20:00', '20:30', '21:00', '21:30'];
    let i = 0;
    for (const time of times) {
      for (let n = 0; n < 3; n++) {
        await createReservation(`fill-${i++}`, { date: tomorrow, time, partySize: 2, name: 'ヤマダ' });
      }
    }

    const session: Session = { sessionId: 'it-dayfull', slots: {}, messages: [] };
    const events = await callChat(session, '明日の18時に2名でお願いします');
    const reply = events
      .filter((e): e is Extract<ChatEvent, { type: 'delta' }> => e.type === 'delta')
      .map((e) => e.text)
      .join('');
    expect(reply).toContain('その日は満席');
    expect(reply).toContain('別の日');
    expect(session.slots.date).toBeUndefined();
    expect(session.slots.time).toBeUndefined();
  });

  it('該当予約が見つからなければ聞き直しになる', async () => {
    const session: Session = { sessionId: 'it-cancel-miss', slots: {}, messages: [] };
    await callChat(session, 'キャンセルしたいです');
    await callChat(session, '明日です');
    await callChat(session, '18時半');
    const events = await callChat(session, '佐藤です');
    const reply = events
      .filter((e): e is Extract<ChatEvent, { type: 'delta' }> => e.type === 'delta')
      .map((e) => e.text)
      .join('');
    expect(reply).toContain('見つかりませんでした');
    expect(eventOf(events, 'cancelled')).toBeUndefined();
    expect(session.slots.date).toBeUndefined();
  });

  it('Gemini が 429 を返したときはスタブにフォールバックしてエラーを出さない', async () => {
    const spy = vi
      .spyOn(geminiModule, 'runGeminiReceptionist')
      .mockRejectedValueOnce(new Error('429 RESOURCE_EXHAUSTED'));
    process.env.GEMINI_API_KEY = 'test-key';
    try {
      const session: Session = { sessionId: 'it-429', slots: {}, messages: [] };
      const events = await callChat(session, '予約したいです');
      expect(events.find((e) => e.type === 'error')).toBeUndefined();
      expect(events.find((e) => e.type === 'done')).toBeDefined();
    } finally {
      delete process.env.GEMINI_API_KEY;
      spy.mockRestore();
    }
  });

  it('sessionId か messages が欠けていれば 400 を返す', async () => {
    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: '', slots: {}, messages: [] }),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });
});

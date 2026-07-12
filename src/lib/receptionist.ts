import { parseDateJa, parsePartySizeJa, parseTimeJa } from './jp-parse';
import { isComplete, missingSlots, updateSlots, type SlotKey, type Slots } from './reservation-slots';
import {
  cancelReservation,
  checkAvailability,
  createReservation,
  type Reservation,
} from './reservation-store';

export type ChatEvent =
  | { type: 'delta'; text: string }
  | { type: 'slots'; slots: Slots }
  | { type: 'reservation'; reservation: Reservation; alreadyExisted: boolean }
  | { type: 'cancelled'; reservation: Reservation }
  | { type: 'escalation'; reason: string; summary: string }
  | { type: 'end'; reason: 'completed' | 'escalated' }
  | { type: 'done'; model: string }
  | { type: 'error'; message: string };

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface ReceptionContext {
  sessionId: string;
  slots: Slots;
  today: string;
}

const SLOT_LABEL: Record<string, string> = {
  date: '日付',
  time: '時間',
  partySize: '人数',
  name: 'お名前',
};

export function buildSystemPrompt(today: string): string {
  return [
    'あなたはレストラン「よあけ食堂」の電話受付です。音声で読み上げられる前提で、1回の返答は短く(2文以内)、記号や箇条書きを使わず話し言葉で答えてください。「できません」のような否定的な言い回しは避け、前向きな案内をしてください。',
    `今日は ${today} です。お客様が「明日」「7月15日」のように言った日付は YYYY-MM-DD に直してください。`,
    '受け付けられる用件は、新規予約とキャンセルの2つです。',
    '新規予約: 日付・時間・人数・お名前の4つを聞き取り、聞き取れたものはその都度 update_reservation_state で記録します。電話では漢字の表記を確認できないため、お名前は必ずカタカナの読みで扱ってください (name にはカタカナを渡し、復唱もカタカナの読みで)。時間が決まったら create_reservation の前に必ず check_availability で空きを確認し、満席なら alternatives の時間を提案します。day_full が true ならその日は満席なので、別の日を提案してください。4つそろったら内容を復唱して確認を取り、同意を得てから create_reservation を呼びます。create_reservation が error と alternatives を返した場合は満席なので、その時間を案内して取り直してください。',
    'キャンセル: ご予約の日付・時間・お名前の3つを伺ってから cancel_reservation を呼びます。お名前はカタカナの読みで渡してください (照合は読みで行います)。見つからない場合は、内容をもう一度確認させてほしいと伝えます。',
    '予約とキャンセル以外の用件 (予約内容の変更、設備やメニューの問い合わせ、クレームなど) は escalate_to_human を呼び、「担当の者にお繋ぎします」と案内してください。クレームには謝罪しつつ、内容への回答はせず担当者に引き継ぎます。',
    '用件が済んだら (確定・取り消しのお礼、または担当者への案内を言い終えたら)、end_call を呼んで通話を終えてください。',
  ].join('\n');
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ReceptionContext,
): Promise<{ response: Record<string, unknown>; events: ChatEvent[] }> {
  switch (name) {
    case 'update_reservation_state': {
      const patch: Partial<Slots> = {
        date: typeof args.date === 'string' ? args.date : undefined,
        time: typeof args.time === 'string' ? args.time : undefined,
        partySize: typeof args.party_size === 'number' ? args.party_size : undefined,
        name: typeof args.name === 'string' ? args.name : undefined,
      };
      ctx.slots = updateSlots(ctx.slots, patch, ctx.today);
      return {
        response: { slots: ctx.slots, missing: missingSlots(ctx.slots) },
        events: [{ type: 'slots', slots: ctx.slots }],
      };
    }
    case 'check_availability': {
      const date = typeof args.date === 'string' ? args.date : (ctx.slots.date ?? '');
      const time = typeof args.time === 'string' ? args.time : (ctx.slots.time ?? '');
      return { response: { ...(await checkAvailability(date, time)) }, events: [] };
    }
    case 'create_reservation': {
      const result = await createReservation(ctx.sessionId, ctx.slots);
      if ('error' in result) {
        return { response: { error: result.error }, events: [] };
      }
      return {
        response: {
          confirmation_code: result.reservation.confirmationCode,
          already_existed: result.alreadyExisted,
        },
        events: [
          {
            type: 'reservation',
            reservation: result.reservation,
            alreadyExisted: result.alreadyExisted,
          },
        ],
      };
    }
    case 'cancel_reservation': {
      const date = typeof args.date === 'string' ? args.date : '';
      const time = typeof args.time === 'string' ? args.time : '';
      const name = typeof args.name === 'string' ? args.name : '';
      const result = await cancelReservation(date, time, name);
      if ('error' in result) {
        return { response: { error: result.error }, events: [] };
      }
      return {
        response: { cancelled: true, confirmation_code: result.reservation.confirmationCode },
        events: [{ type: 'cancelled', reservation: result.reservation }],
      };
    }
    case 'escalate_to_human': {
      const reason = typeof args.reason === 'string' ? args.reason : '不明';
      const summary = typeof args.summary === 'string' ? args.summary : '';
      return {
        response: { acknowledged: true },
        events: [{ type: 'escalation', reason, summary }],
      };
    }
    case 'end_call': {
      const reason = args.reason === 'escalated' ? 'escalated' : 'completed';
      return {
        response: { acknowledged: true },
        events: [{ type: 'end', reason }],
      };
    }
    default:
      return { response: { error: `unknown tool: ${name}` }, events: [] };
  }
}

const ESCALATION_WORDS = [
  '変更',
  'クレーム',
  '苦情',
  '人間',
  '担当者',
  '問い合わせ',
  '質問',
  '聞きたい',
  '営業時間',
  '駐車場',
  '場所',
  '住所',
  'メニュー',
  'アレルギー',
];
const CANCEL_WORDS = ['キャンセル', '取り消し', '取消'];

interface StubReply {
  sentences: string[];
  events: ChatEvent[];
}

function detectIntent(messages: ChatMessage[]): 'cancel' | 'reserve' {
  const cancelled = messages.some(
    (m) => m.role === 'user' && CANCEL_WORDS.some((w) => m.text.includes(w)),
  );
  return cancelled ? 'cancel' : 'reserve';
}

function extractPatch(userText: string, ctx: ReceptionContext, pending: SlotKey | undefined): Partial<Slots> {
  const patch: Partial<Slots> = {
    date: parseDateJa(userText, ctx.today),
    time: parseTimeJa(userText),
    partySize: parsePartySizeJa(userText),
  };
  if (
    pending === 'name' &&
    patch.date === undefined &&
    patch.time === undefined &&
    patch.partySize === undefined
  ) {
    patch.name = userText.replace(/です|といいます|と申します|。/g, '').trim();
  }
  return patch;
}

function askNext(missing: SlotKey[], progressed: boolean): string {
  const next = missing[0];
  return progressed
    ? `ありがとうございます。${SLOT_LABEL[next]}を教えてください。`
    : `すみません、聞き取れませんでした。${SLOT_LABEL[next]}を教えてください。`;
}

const RESERVE_QUESTION = 'ご予約のお電話でしょうか？';
const AFFIRMATIVE = /はい|ええ|そうです|お願いします/;

async function stubReserve(
  userText: string,
  lastAssistantText: string,
  ctx: ReceptionContext,
): Promise<StubReply> {
  const events: ChatEvent[] = [];
  const sentences: string[] = [];

  const before = missingSlots(ctx.slots);
  const patch = extractPatch(userText, ctx, before[0]);
  const exec = await executeTool(
    'update_reservation_state',
    { date: patch.date, time: patch.time, party_size: patch.partySize, name: patch.name },
    ctx,
  );
  events.push(...exec.events);

  if (ctx.slots.time !== undefined && ctx.slots.date !== undefined) {
    const availability = await checkAvailability(ctx.slots.date, ctx.slots.time);
    if (!availability.available) {
      if (availability.dayFull) {
        ctx.slots = { ...ctx.slots, date: undefined, time: undefined };
        events.push({ type: 'slots', slots: ctx.slots });
        sentences.push('申し訳ありません、その日は満席です。', '別の日にちをお願いできますか？');
        return { sentences, events };
      }
      ctx.slots = { ...ctx.slots, time: undefined };
      events.push({ type: 'slots', slots: ctx.slots });
      const alt = availability.alternatives?.length
        ? `${availability.alternatives.join('か')}はいかがですか？`
        : '別の時間をお願いできますか？';
      sentences.push(`申し訳ありません、${availability.reason}。`, alt);
      return { sentences, events };
    }
  }

  // 用件がまだ分からない段階では、いきなり日付を聞かずに用件を確認する
  const missingNow = missingSlots(ctx.slots);
  if (missingNow.length === 4) {
    if (/予約/.test(userText)) {
      sentences.push('かしこまりました。ご希望の日付を教えてください。');
      return { sentences, events };
    }
    if (lastAssistantText.includes(RESERVE_QUESTION)) {
      if (AFFIRMATIVE.test(userText)) {
        sentences.push('ありがとうございます。ご希望の日付を教えてください。');
      } else {
        sentences.push('恐れ入ります、ご用件をもう一度お伺いできますか？');
      }
      return { sentences, events };
    }
    sentences.push(RESERVE_QUESTION);
    return { sentences, events };
  }

  if (isComplete(ctx.slots)) {
    const create = await executeTool('create_reservation', {}, ctx);
    events.push(...create.events);
    const response = create.response as {
      confirmation_code?: string;
      error?: string;
      alternatives?: string[];
    };
    if (response.error !== undefined) {
      ctx.slots = { ...ctx.slots, time: undefined };
      events.push({ type: 'slots', slots: ctx.slots });
      const alt = response.alternatives?.length
        ? `${response.alternatives.join('か')}はいかがですか？`
        : '別の時間をお願いできますか？';
      sentences.push(`申し訳ありません、${response.error}。`, alt);
      return { sentences, events };
    }
    events.push({ type: 'end', reason: 'completed' });
    sentences.push(
      `${ctx.slots.date} ${ctx.slots.time} に ${ctx.slots.partySize}名、${ctx.slots.name}様ですね。`,
      `ご予約をお取りしました。確認番号は ${response.confirmation_code} です。`,
      'お待ちしております。お電話ありがとうございました。',
    );
    return { sentences, events };
  }

  sentences.push(askNext(missingSlots(ctx.slots), missingSlots(ctx.slots).length < before.length));
  return { sentences, events };
}

const CANCEL_ORDER: SlotKey[] = ['date', 'time', 'name'];

async function stubCancel(
  userText: string,
  ctx: ReceptionContext,
  firstCancelTurn: boolean,
): Promise<StubReply> {
  const events: ChatEvent[] = [];
  const sentences: string[] = [];

  const missingBefore = CANCEL_ORDER.filter((key) => ctx.slots[key] === undefined);
  const patch = extractPatch(userText, ctx, missingBefore[0]);
  ctx.slots = updateSlots(ctx.slots, patch, ctx.today);
  events.push({ type: 'slots', slots: ctx.slots });

  const missing = CANCEL_ORDER.filter((key) => ctx.slots[key] === undefined);
  if (missing.length > 0) {
    const prefix = firstCancelTurn ? 'キャンセルですね。' : '';
    const body = firstCancelTurn
      ? `ご予約の${SLOT_LABEL[missing[0]]}を教えてください。`
      : askNext(missing, missing.length < missingBefore.length);
    sentences.push(`${prefix}${body}`);
    return { sentences, events };
  }

  const exec = await executeTool(
    'cancel_reservation',
    { date: ctx.slots.date, time: ctx.slots.time, name: ctx.slots.name },
    ctx,
  );
  events.push(...exec.events);

  if ('error' in exec.response) {
    ctx.slots = { ...ctx.slots, date: undefined, time: undefined, name: undefined };
    events.push({ type: 'slots', slots: ctx.slots });
    sentences.push(
      '申し訳ありません、その内容のご予約が見つかりませんでした。',
      'ご予約の日付からもう一度確認させてください。',
    );
    return { sentences, events };
  }

  events.push({ type: 'end', reason: 'completed' });
  sentences.push(
    `${ctx.slots.date} ${ctx.slots.time} の ${ctx.slots.name}様のご予約を取り消しました。`,
    'またのご利用をお待ちしております。お電話ありがとうございました。',
  );
  return { sentences, events };
}

/**
 * GEMINI_API_KEY なしで一連の受付フローを動かすための決定的スタブ。
 * 音声ループと UI の検証、CI の E2E を API キーなしで回すために使う。
 */
export async function runStubReceptionist(
  messages: ChatMessage[],
  ctx: ReceptionContext,
): Promise<StubReply> {
  const userMessages = messages.filter((m) => m.role === 'user');
  const userText = userMessages[userMessages.length - 1]?.text ?? '';
  const assistantMessages = messages.filter((m) => m.role === 'assistant');
  const lastAssistantText = assistantMessages[assistantMessages.length - 1]?.text ?? '';

  const hit = ESCALATION_WORDS.find((w) => userText.includes(w));
  if (hit) {
    const events: ChatEvent[] = [];
    const exec = await executeTool(
      'escalate_to_human',
      { reason: `「${hit}」のご用件`, summary: userText },
      ctx,
    );
    events.push(...exec.events);
    events.push({ type: 'end', reason: 'escalated' });
    return {
      sentences: ['かしこまりました。担当の者にお繋ぎしますので、そのままお待ちください。'],
      events,
    };
  }

  if (detectIntent(messages) === 'cancel') {
    const firstCancelTurn = CANCEL_WORDS.some((w) => userText.includes(w));
    return stubCancel(userText, ctx, firstCancelTurn);
  }
  return stubReserve(userText, lastAssistantText, ctx);
}

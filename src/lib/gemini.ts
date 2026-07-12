import {
  GoogleGenAI,
  Type,
  type Content,
  type FunctionDeclaration,
  type Part,
} from '@google/genai';
import {
  buildSystemPrompt,
  executeTool,
  type ChatEvent,
  type ChatMessage,
  type ReceptionContext,
} from './receptionist';

const MAX_TOOL_ROUNDS = 4;
const MAX_RETRIES = 2;
const RETRYABLE = /429|RESOURCE_EXHAUSTED|503|UNAVAILABLE/;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const FUNCTION_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'update_reservation_state',
    description: '聞き取れた予約情報を記録する。判明した項目だけ渡す。',
    parameters: {
      type: Type.OBJECT,
      properties: {
        date: { type: Type.STRING, description: 'YYYY-MM-DD' },
        time: { type: Type.STRING, description: 'HH:MM (24時間表記)' },
        party_size: { type: Type.NUMBER, description: '人数 (1〜12)' },
        name: { type: Type.STRING, description: '予約者の名前 (カタカナの読み)' },
      },
    },
  },
  {
    name: 'check_availability',
    description: '指定日時の空き状況を確認する。',
    parameters: {
      type: Type.OBJECT,
      properties: {
        date: { type: Type.STRING, description: 'YYYY-MM-DD' },
        time: { type: Type.STRING, description: 'HH:MM' },
      },
      required: ['date', 'time'],
    },
  },
  {
    name: 'create_reservation',
    description: '記録済みの予約情報で予約を確定する。全項目そろってから呼ぶこと。',
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: 'cancel_reservation',
    description: '既存の予約を取り消す。日付・時間・名前の3つを聞き取ってから呼ぶこと。',
    parameters: {
      type: Type.OBJECT,
      properties: {
        date: { type: Type.STRING, description: 'YYYY-MM-DD' },
        time: { type: Type.STRING, description: 'HH:MM (24時間表記)' },
        name: { type: Type.STRING, description: '予約者の名前 (カタカナの読み)' },
      },
      required: ['date', 'time', 'name'],
    },
  },
  {
    name: 'escalate_to_human',
    description: '予約の新規受付以外の用件 (変更・キャンセル・クレーム等) を人間の担当者に引き継ぐ。',
    parameters: {
      type: Type.OBJECT,
      properties: {
        reason: { type: Type.STRING, description: '引き継ぐ理由' },
        summary: { type: Type.STRING, description: '担当者向けの用件の要約' },
      },
      required: ['reason', 'summary'],
    },
  },
  {
    name: 'end_call',
    description: '用件が済んで挨拶を言い終えたあとに通話を終了する。',
    parameters: {
      type: Type.OBJECT,
      properties: {
        reason: { type: Type.STRING, description: 'completed (予約完了) か escalated (引き継ぎ)' },
      },
      required: ['reason'],
    },
  },
];

export async function runGeminiReceptionist(
  messages: ChatMessage[],
  ctx: ReceptionContext,
  emit: (event: ChatEvent) => void,
  options: { apiKey: string; model: string },
): Promise<void> {
  const ai = new GoogleGenAI({ apiKey: options.apiKey });
  const contents: Content[] = messages.map((m) => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.text }],
  }));

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    let spoke = false;

    // 無料枠の 429 / 一時的な 503 は指数バックオフで再試行する。
    // すでに delta を送った後のエラーは、読み上げの重複を避けるため再試行しない。
    for (let attempt = 0; ; attempt++) {
      try {
        const stream = await ai.models.generateContentStream({
          model: options.model,
          contents,
          config: {
            systemInstruction: buildSystemPrompt(ctx.today),
            tools: [{ functionDeclarations: FUNCTION_DECLARATIONS }],
            temperature: 0.3,
          },
        });
        for await (const chunk of stream) {
          const text = chunk.text;
          if (text) {
            spoke = true;
            emit({ type: 'delta', text });
          }
          for (const fc of chunk.functionCalls ?? []) {
            if (fc.name) {
              calls.push({ name: fc.name, args: (fc.args ?? {}) as Record<string, unknown> });
            }
          }
        }
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!spoke && calls.length === 0 && attempt < MAX_RETRIES && RETRYABLE.test(message)) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        throw error;
      }
    }

    if (calls.length === 0) return;

    const callParts: Part[] = calls.map((c) => ({
      functionCall: { name: c.name, args: c.args },
    }));
    const responseParts: Part[] = [];
    for (const c of calls) {
      const executed = await executeTool(c.name, c.args, ctx);
      for (const event of executed.events) emit(event);
      responseParts.push({ functionResponse: { name: c.name, response: executed.response } });
    }
    contents.push({ role: 'model', parts: callParts });
    contents.push({ role: 'user', parts: responseParts });

    if (spoke && round === MAX_TOOL_ROUNDS - 1) return;
  }
}

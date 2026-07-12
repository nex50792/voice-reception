import { runGeminiReceptionist } from '@/lib/gemini';
import {
  runStubReceptionist,
  type ChatEvent,
  type ChatMessage,
  type ReceptionContext,
} from '@/lib/receptionist';
import { emptySlots, type Slots } from '@/lib/reservation-slots';

export const runtime = 'nodejs';

const HISTORY_WINDOW = 12;

interface ChatRequest {
  sessionId: string;
  slots: Slots;
  messages: ChatMessage[];
}

function todayInJst(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as ChatRequest;
  if (!body.sessionId || !Array.isArray(body.messages) || body.messages.length === 0) {
    return Response.json({ error: 'sessionId and messages are required' }, { status: 400 });
  }

  const ctx: ReceptionContext = {
    sessionId: body.sessionId,
    slots: body.slots ?? emptySlots(),
    today: todayInJst(),
  };
  const messages = body.messages.slice(-HISTORY_WINDOW);
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: ChatEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      try {
        if (apiKey) {
          await runGeminiReceptionist(messages, ctx, emit, { apiKey, model });
          emit({ type: 'done', model });
        } else {
          const result = await runStubReceptionist(messages, ctx);
          for (const event of result.events) emit(event);
          for (const sentence of result.sentences) emit({ type: 'delta', text: sentence });
          emit({ type: 'done', model: 'stub' });
        }
      } catch (error) {
        const raw = error instanceof Error ? error.message : String(error);
        if (/429|RESOURCE_EXHAUSTED/.test(raw)) {
          const result = await runStubReceptionist(messages, ctx);
          for (const event of result.events) emit(event);
          for (const sentence of result.sentences) emit({ type: 'delta', text: sentence });
          emit({ type: 'done', model: 'stub' });
        } else {
          emit({ type: 'error', message: raw });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVoiceLoop } from './useVoiceLoop';

// ブラウザ音声 API を全部モックして、hook のオーケストレーション
// (マイクを開くタイミング / 割り込み / エコー破棄 / 終話) を人手なしで検証する。

class FakeUtterance {
  text: string;
  lang = '';
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

class FakeRecognition {
  static instances: FakeRecognition[] = [];
  lang = '';
  continuous = false;
  interimResults = false;
  started = false;
  startCalls = 0;
  onresult: ((event: unknown) => void) | null = null;
  onspeechend: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  constructor() {
    FakeRecognition.instances.push(this);
  }
  start() {
    this.started = true;
    this.startCalls += 1;
  }
  stop() {
    this.started = false;
  }
  abort() {
    this.started = false;
  }
  emitResult(transcript: string, isFinal: boolean) {
    const result = Object.assign([{ transcript, confidence: 1 }], { isFinal, length: 1 });
    this.onresult?.({ resultIndex: 0, results: Object.assign([result], { length: 1 }) });
  }
}

const spokenUtterances: FakeUtterance[] = [];
let synthesisCancelled = 0;

function playNextUtterance(): FakeUtterance {
  const utterance = spokenUtterances[spokenUtterances.length - 1];
  act(() => utterance.onstart?.());
  return utterance;
}

function finishUtterance(utterance: FakeUtterance) {
  act(() => utterance.onend?.());
}

function sseResponse(events: object[]): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] });
  FakeRecognition.instances = [];
  spokenUtterances.length = 0;
  synthesisCancelled = 0;

  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  window.SpeechRecognition = FakeRecognition as unknown as new () => SpeechRecognition;
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: {
      speak: (utterance: FakeUtterance) => {
        spokenUtterances.push(utterance);
      },
      cancel: () => {
        synthesisCancelled += 1;
      },
    },
  });
  // 声量メーター (表示専用) が参照する audio API
  vi.stubGlobal(
    'AudioContext',
    class {
      state = 'running';
      createAnalyser() {
        return {
          fftSize: 1024,
          getFloatTimeDomainData(buffer: Float32Array) {
            buffer.fill(0);
          },
        };
      }
      createMediaStreamSource() {
        return { connect() {} };
      }
      async resume() {}
      async close() {}
    },
  );
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function startCall() {
  const rendered = renderHook(() => useVoiceLoop());
  await act(async () => {
    rendered.result.current.start();
  });
  return rendered;
}

async function speakGreetingThrough() {
  const first = playNextUtterance();
  finishUtterance(first);
  await act(async () => {});
  const second = playNextUtterance();
  finishUtterance(second);
  await act(async () => {});
}

describe('useVoiceLoop のオーケストレーション', () => {
  it('通話開始と同時に認識を開始し、挨拶中の発話で挨拶を打ち切って応答する', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sseResponse([
        { type: 'delta', text: 'かしこまりました。ご希望の日付を教えてください。' },
        { type: 'done', model: 'stub' },
      ])),
    );
    const { result } = await startCall();
    const recognition = FakeRecognition.instances[0];
    expect(recognition.started).toBe(true);

    playNextUtterance(); // 挨拶 1 文目を再生中
    await act(async () => {
      recognition.emitResult('予約したいです', true);
    });

    expect(synthesisCancelled).toBeGreaterThan(0);
    expect(
      result.current.transcript.filter((t) => t.role === 'user').map((t) => t.text),
    ).toEqual(['予約したいです']);
    expect(result.current.turnState).toBe('thinking');
  });

  it('挨拶読み上げ中に挨拶自身のエコーが認識されても発話として扱わない', async () => {
    const fetchMock = vi.fn(async () => sseResponse([{ type: 'done', model: 'stub' }]));
    vi.stubGlobal('fetch', fetchMock);
    await startCall();
    const recognition = FakeRecognition.instances[0];

    playNextUtterance();
    await act(async () => {
      recognition.emitResult('お電話ありがとうございますよあけ食堂です', true);
    });

    expect(fetchMock.mock.calls.length).toBe(0);
    expect(synthesisCancelled).toBe(0);
  });

  it('応答読み上げ中にユーザー発話が認識されたら残りの読み上げを破棄してその発話を処理する', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sseResponse([
        { type: 'delta', text: 'かしこまりました。ご希望の日付を教えてください。' },
        { type: 'done', model: 'stub' },
      ])),
    );
    const { result } = await startCall();
    await speakGreetingThrough();
    const recognition = FakeRecognition.instances[0];

    await act(async () => {
      recognition.emitResult('予約をお願いします', true);
    });
    expect(result.current.turnState).toBe('thinking');
    playNextUtterance();
    expect(result.current.turnState).toBe('speaking');

    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    await act(async () => {
      recognition.emitResult('明日でお願いします', true);
    });

    expect(synthesisCancelled).toBeGreaterThan(0);
    expect(vi.mocked(fetch).mock.calls.length).toBe(2);
    expect(
      result.current.transcript.filter((t) => t.role === 'user').map((t) => t.text),
    ).toEqual(['予約をお願いします', '明日でお願いします']);
  });

  it('応答開始直後に届く認識テキスト (直前発話の遅延結果) では割り込まない', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sseResponse([
        { type: 'delta', text: 'ご予約ですね、ありがとうございます。' },
        { type: 'done', model: 'stub' },
      ])),
    );
    await startCall();
    await speakGreetingThrough();
    const recognition = FakeRecognition.instances[0];

    await act(async () => {
      recognition.emitResult('予約をお願いします', true);
    });
    playNextUtterance();

    await act(async () => {
      recognition.emitResult('お願いします', false);
    });
    expect(synthesisCancelled).toBe(0);

    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    await act(async () => {
      recognition.emitResult('すみません', false);
    });
    expect(synthesisCancelled).toBeGreaterThan(0);
  });

  it('読み上げ直後のエコー (読み上げ文と同じ認識結果) はユーザー発話として扱わない', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sseResponse([
        { type: 'delta', text: 'ご希望の日付を教えてください。' },
        { type: 'done', model: 'stub' },
      ])),
    );
    const { result } = await startCall();
    await speakGreetingThrough();
    const recognition = FakeRecognition.instances[0];

    await act(async () => {
      recognition.emitResult('明日でお願いします', true);
    });
    const reply = playNextUtterance();
    finishUtterance(reply);
    await act(async () => {});
    expect(result.current.turnState).toBe('listening');

    const fetchMock = vi.mocked(fetch);
    const callsBefore = fetchMock.mock.calls.length;
    await act(async () => {
      recognition.emitResult('ご希望の日付を教えてください', true);
    });
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
    expect(result.current.transcript.filter((t) => t.role === 'user')).toHaveLength(1);
  });

  it('speechend が発火しないターンでは前ターンの発話終了をレイテンシに使わない', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sseResponse([
        { type: 'delta', text: 'ご希望の日付を教えてください。' },
        { type: 'done', model: 'stub' },
      ])),
    );
    const { result } = await startCall();
    await speakGreetingThrough();
    const recognition = FakeRecognition.instances[0];

    // 1 ターン目: speechend → 確定 → 応答
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    act(() => recognition.onspeechend?.());
    await act(async () => {
      recognition.emitResult('予約をお願いします', true);
    });
    const reply = playNextUtterance();
    finishUtterance(reply);
    await act(async () => {});
    expect(result.current.turnState).toBe('listening');

    // 20 秒考えてから話す。Chrome が speechend を発火させないまま確定が届く
    await act(async () => {
      vi.advanceTimersByTime(20000);
    });
    await act(async () => {
      recognition.emitResult('明日でお願いします', true);
    });
    playNextUtterance(); // 2 ターン目の応答開始で計測が記録される

    expect(result.current.latency.lastSegments?.stt ?? 0).toBeLessThan(1000);
  });

  it('end イベントの後は読み上げ完了で自動終話してマイクを解放する', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sseResponse([
        { type: 'delta', text: 'ご予約をお取りしました。' },
        { type: 'end', reason: 'completed' },
        { type: 'done', model: 'stub' },
      ])),
    );
    const { result } = await startCall();
    await speakGreetingThrough();
    const recognition = FakeRecognition.instances[0];

    await act(async () => {
      recognition.emitResult('明日の18時に2名で山田です', true);
    });
    const reply = playNextUtterance();
    finishUtterance(reply);
    await act(async () => {});

    expect(result.current.turnState).toBe('idle');
    expect(recognition.started).toBe(false);
  });
});

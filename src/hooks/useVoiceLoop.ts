'use client';

import { useCallback, useRef, useState } from 'react';
import { isLikelyEcho } from '@/lib/echo-guard';
import { createLatencyLog, type TurnMarks, type TurnSegments, turnSegments } from '@/lib/latency-meter';
import { createSentenceChunker } from '@/lib/sentence-chunker';
import { transition, type TurnState } from '@/lib/turn-machine';
import { emptySlots, type Slots } from '@/lib/reservation-slots';
import type { ChatEvent, ChatMessage } from '@/lib/receptionist';
import type { Reservation } from '@/lib/reservation-store';

export interface TranscriptEntry {
  role: 'user' | 'assistant';
  text: string;
}

export interface Escalation {
  reason: string;
  summary: string;
}

export interface LatencyView {
  lastSegments: TurnSegments | null;
  p50: number | null;
  p95: number | null;
  count: number;
}

// 音量閾値による割り込み検知は不採用。スピーカー再生の自己音声が実測 0.084〜0.23 に達し
// ユーザー発話 (~0.3) と分離できないため (AEC の参照信号なしでは原理的に不可)。
// 割り込みは「認識テキストが届いたら残りの読み上げを破棄してその発話を処理する」方式のみ。
const BARGE_IN_MIN_CHARS = 3;
// 応答開始直後に届く認識結果は直前のユーザー発話の遅延分なので割り込みに使わない
const STT_BARGE_IN_GUARD_MS = 600;
const ECHO_TAIL_MS = 1500;
const METER_INTERVAL_MS = 150;

export function useVoiceLoop() {
  const [turnState, setTurnState] = useState<TurnState>('idle');
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [interim, setInterim] = useState('');
  const [slots, setSlots] = useState<Slots>(emptySlots());
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [cancelled, setCancelled] = useState<Reservation | null>(null);
  const [escalation, setEscalation] = useState<Escalation | null>(null);
  const [latency, setLatency] = useState<LatencyView>({ lastSegments: null, p50: null, p95: null, count: 0 });
  const [model, setModel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [micRms, setMicRms] = useState<number | null>(null);

  const stateRef = useRef<TurnState>('idle');
  const slotsRef = useRef<Slots>(emptySlots());
  const historyRef = useRef<ChatMessage[]>([]);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const sessionIdRef = useRef<string>('');
  const marksRef = useRef<TurnMarks>({});
  const latencyLogRef = useRef(createLatencyLog());
  const ttsQueueRef = useRef<string[]>([]);
  const ttsBusyRef = useRef(false);
  const llmDoneRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const spokenBufferRef = useRef<string[]>([]);
  const lastTtsEndRef = useRef(0);
  const endPendingRef = useRef(false);
  const recognitionActiveRef = useRef(false);
  const lastInterimAtRef = useRef<number | null>(null);
  const meterStreamRef = useRef<MediaStream | null>(null);
  const meterContextRef = useRef<AudioContext | null>(null);
  const meterTimerRef = useRef<number | null>(null);

  const applyEvent = useCallback((event: Parameters<typeof transition>[1]) => {
    stateRef.current = transition(stateRef.current, event);
    setTurnState(stateRef.current);
  }, []);

  const cancelSpeech = useCallback(() => {
    ttsQueueRef.current = [];
    ttsBusyRef.current = false;
    window.speechSynthesis.cancel();
  }, []);

  // 声量メーター (表示専用)。割り込み判定には使わない
  const stopMicMeter = useCallback(() => {
    if (meterTimerRef.current !== null) {
      window.clearInterval(meterTimerRef.current);
      meterTimerRef.current = null;
    }
    meterStreamRef.current?.getTracks().forEach((track) => track.stop());
    meterStreamRef.current = null;
    void meterContextRef.current?.close();
    meterContextRef.current = null;
    setMicRms(null);
  }, []);

  const startMicMeter = useCallback(async (context: AudioContext) => {
    if (meterStreamRef.current) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    meterStreamRef.current = stream;
    // クリック起点でも suspended で作られることがある (autoplay policy)
    if (context.state === 'suspended') {
      await context.resume();
    }
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(analyser);
    const buffer = new Float32Array(analyser.fftSize);
    meterTimerRef.current = window.setInterval(() => {
      analyser.getFloatTimeDomainData(buffer);
      let sum = 0;
      for (let i = 0; i < buffer.length; i++) {
        sum += buffer[i] * buffer[i];
      }
      setMicRms(Math.sqrt(sum / buffer.length));
    }, METER_INTERVAL_MS);
  }, []);

  const finishTurnIfDone = useCallback(() => {
    if (llmDoneRef.current && ttsQueueRef.current.length === 0 && !ttsBusyRef.current) {
      if (endPendingRef.current) {
        endPendingRef.current = false;
        applyEvent({ type: 'STOP' });
        recognitionActiveRef.current = false;
        stopMicMeter();
        const recognition = recognitionRef.current;
        recognitionRef.current = null;
        recognition?.stop();
        return;
      }
      applyEvent({ type: 'TTS_DONE' });
    }
  }, [applyEvent, stopMicMeter]);

  const bargeIn = useCallback(() => {
    cancelSpeech();
    abortRef.current?.abort();
    applyEvent({ type: 'BARGE_IN' });
  }, [applyEvent, cancelSpeech]);

  const pumpTts = useCallback(() => {
    if (ttsBusyRef.current) return;
    const next = ttsQueueRef.current.shift();
    if (next === undefined) {
      finishTurnIfDone();
      return;
    }
    ttsBusyRef.current = true;
    const utterance = new SpeechSynthesisUtterance(next);
    utterance.lang = 'ja-JP';
    utterance.onstart = () => {
      spokenBufferRef.current.push(next);
      if (marksRef.current.ttsStart === undefined) {
        marksRef.current.ttsStart = performance.now();
        latencyLogRef.current.add({ ...marksRef.current });
        const stats = latencyLogRef.current.stats();
        setLatency({
          lastSegments: turnSegments(marksRef.current),
          p50: stats.p50,
          p95: stats.p95,
          count: stats.count,
        });
        applyEvent({ type: 'TTS_START' });
      }
    };
    utterance.onend = () => {
      lastTtsEndRef.current = performance.now();
      ttsBusyRef.current = false;
      pumpTts();
    };
    utterance.onerror = (event) => {
      // interrupted / canceled は自前の cancel() 由来なので通常フロー
      if (event.error !== 'interrupted' && event.error !== 'canceled') {
        console.warn(`[tts] error=${event.error} at=${event.charIndex}`);
      }
      lastTtsEndRef.current = performance.now();
      ttsBusyRef.current = false;
      pumpTts();
    };
    window.speechSynthesis.speak(utterance);
  }, [applyEvent, finishTurnIfDone]);

  const enqueueSpeech = useCallback(
    (sentence: string) => {
      ttsQueueRef.current.push(sentence);
      pumpTts();
    },
    [pumpTts],
  );

  const appendAssistantText = useCallback((text: string) => {
    setTranscript((entries) => {
      const last = entries[entries.length - 1];
      if (last?.role === 'assistant') {
        return [...entries.slice(0, -1), { role: 'assistant', text: last.text + text }];
      }
      return [...entries, { role: 'assistant', text }];
    });
  }, []);

  const handleServerEvent = useCallback(
    (event: ChatEvent, chunker: ReturnType<typeof createSentenceChunker>) => {
      switch (event.type) {
        case 'delta':
          if (marksRef.current.llmFirstToken === undefined) {
            marksRef.current.llmFirstToken = performance.now();
          }
          appendAssistantText(event.text);
          for (const sentence of chunker.feed(event.text)) enqueueSpeech(sentence);
          break;
        case 'slots':
          slotsRef.current = event.slots;
          setSlots(event.slots);
          break;
        case 'reservation':
          setReservation(event.reservation);
          break;
        case 'cancelled':
          setCancelled(event.reservation);
          setReservation(null);
          break;
        case 'escalation':
          setEscalation({ reason: event.reason, summary: event.summary });
          break;
        case 'end':
          endPendingRef.current = true;
          break;
        case 'done':
          setModel(event.model);
          break;
        case 'error':
          setError(event.message);
          break;
      }
    },
    [appendAssistantText, enqueueSpeech],
  );

  const sendToServer = useCallback(
    async (userText: string) => {
      historyRef.current = [...historyRef.current, { role: 'user', text: userText }];
      setTranscript((entries) => [...entries, { role: 'user', text: userText }]);
      applyEvent({ type: 'SPEECH_FINAL' });
      llmDoneRef.current = false;
      spokenBufferRef.current = [];

      const chunker = createSentenceChunker();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            sessionId: sessionIdRef.current,
            slots: slotsRef.current,
            messages: historyRef.current,
          }),
          signal: controller.signal,
        });
        if (!response.ok || response.body === null) {
          throw new Error(`chat API ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let assistantText = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const event = JSON.parse(line.slice(6)) as ChatEvent;
            if (event.type === 'delta') assistantText += event.text;
            handleServerEvent(event, chunker);
          }
        }

        const rest = chunker.flush();
        if (rest !== null) enqueueSpeech(rest);
        if (assistantText.length > 0) {
          historyRef.current = [...historyRef.current, { role: 'assistant', text: assistantText }];
        }
        llmDoneRef.current = true;
        if (assistantText.length === 0) {
          applyEvent({ type: 'LLM_DONE' });
        } else {
          finishTurnIfDone();
        }
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setError(err instanceof Error ? err.message : String(err));
          applyEvent({ type: 'ERROR' });
        }
      }
    },
    [applyEvent, enqueueSpeech, finishTurnIfDone, handleServerEvent],
  );

  const handleRecognitionResult = useCallback(
    (event: SpeechRecognitionEvent) => {
      let finalText = '';
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalText += result[0].transcript;
        } else {
          interimText += result[0].transcript;
        }
      }

      const heard = (finalText + interimText).trim();
      const ttsActive = ttsBusyRef.current || ttsQueueRef.current.length > 0;
      const guardActive =
        ttsActive ||
        stateRef.current === 'speaking' ||
        performance.now() - lastTtsEndRef.current < ECHO_TAIL_MS;
      if (guardActive && heard.length > 0 && isLikelyEcho(heard, spokenBufferRef.current)) {
        console.debug(`[stt] echo-drop text=${heard}`);
        setInterim('');
        return;
      }

      const ttsAge = performance.now() - (marksRef.current.ttsStart ?? 0);
      if (
        stateRef.current === 'speaking' &&
        heard.length >= BARGE_IN_MIN_CHARS &&
        ttsAge >= STT_BARGE_IN_GUARD_MS
      ) {
        console.debug(`[barge-in] stt text=${heard}`);
        bargeIn();
      }

      setInterim(interimText);
      if (interimText.trim().length > 0) {
        lastInterimAtRef.current = performance.now();
      }
      const text = finalText.trim();
      if (text.length > 0 && stateRef.current === 'listening') {
        // 挨拶などの読み上げが残っていれば打ち切ってターンを譲る
        if (ttsActive) cancelSpeech();
        // speechend が発火しないターンで前ターンのマークを引き継ぐと、
        // 認識確定にターン全体の時間が計上される。前回の応答開始より
        // 新しいマークだけを発話終了として採用する
        const now = performance.now();
        const freshSince = marksRef.current.ttsStart ?? 0;
        const { speechEnd } = marksRef.current;
        const interimAt = lastInterimAtRef.current;
        const speechEndMark =
          speechEnd !== undefined && speechEnd > freshSince
            ? speechEnd
            : interimAt !== null && interimAt > freshSince
              ? interimAt
              : now;
        marksRef.current = { speechEnd: speechEndMark, sttFinal: now };
        setInterim('');
        void sendToServer(text);
      } else if (text.length > 0) {
        console.debug(`[stt] drop state=${stateRef.current} text=${text}`);
      }
    },
    [bargeIn, cancelSpeech, sendToServer],
  );

  const start = useCallback(() => {
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) {
      setError('このブラウザは音声認識に対応していません。Chrome を使ってください。');
      return;
    }
    if (sessionIdRef.current === '') {
      sessionIdRef.current = crypto.randomUUID();
    }
    setError(null);
    endPendingRef.current = false;
    spokenBufferRef.current = [];
    // 計測は通話単位。前の通話のマークや集計を持ち越さない
    marksRef.current = {};
    lastInterimAtRef.current = null;
    latencyLogRef.current = createLatencyLog();
    setLatency({ lastSegments: null, p50: null, p95: null, count: 0 });
    applyEvent({ type: 'START' });

    const recognition = new Recognition();
    recognition.lang = 'ja-JP';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = handleRecognitionResult;
    recognition.onspeechend = () => {
      // 最後の発話終了を採用する。最初のマークを保持すると、ユーザーが
      // 考えてから話し直したときに沈黙時間がレイテンシへ合算される
      if (stateRef.current === 'listening') {
        marksRef.current.speechEnd = performance.now();
      }
    };
    recognition.onerror = (event) => {
      if (event.error === 'not-allowed') {
        setError('マイクの使用が許可されていません。');
        stateRef.current = 'idle';
        setTurnState('idle');
      } else {
        console.debug(`[stt] error=${event.error}`);
      }
    };
    recognition.onend = () => {
      const willRestart = recognitionActiveRef.current && stateRef.current !== 'idle';
      console.debug(`[stt] end restart=${willRestart}`);
      if (willRestart) {
        try {
          recognition.start();
        } catch (err) {
          console.warn(`[stt] restart failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    };
    recognitionRef.current = recognition;
    recognitionActiveRef.current = true;
    recognition.start();

    // AudioContext はクリックと同期で作る (await 後だと autoplay policy で suspended になる)
    const meterContext = new AudioContext();
    meterContextRef.current = meterContext;
    // 声量メーターは補助表示。取得に失敗しても通話は続行する (マイク拒否は認識側で通知される)
    startMicMeter(meterContext).catch(() => {});

    const greeting = 'お電話ありがとうございます、よあけ食堂です。ご用件をお伺いします。';
    setTranscript([{ role: 'assistant', text: greeting }]);
    historyRef.current = [{ role: 'assistant', text: greeting }];
    // 文の隙間で認識結果が届きやすいよう、挨拶も文単位で読み上げる
    enqueueSpeech('お電話ありがとうございます、よあけ食堂です。');
    enqueueSpeech('ご用件をお伺いします。');
  }, [applyEvent, enqueueSpeech, handleRecognitionResult, startMicMeter]);

  const stop = useCallback(() => {
    applyEvent({ type: 'STOP' });
    endPendingRef.current = false;
    recognitionActiveRef.current = false;
    abortRef.current?.abort();
    cancelSpeech();
    stopMicMeter();
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    try {
      recognition?.stop();
    } catch {
      // 挨拶中に終了した場合など、開始前の stop は無視してよい
    }
  }, [applyEvent, cancelSpeech, stopMicMeter]);

  return {
    turnState,
    transcript,
    interim,
    slots,
    reservation,
    cancelled,
    escalation,
    latency,
    model,
    error,
    micRms,
    start,
    stop,
  };
}

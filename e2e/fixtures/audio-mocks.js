/**
 * addInitScript に渡す音声 API モック。
 * unit test の FakeRecognition / FakeUtterance と同等の構造をブラウザ内に
 * inject して、認識テキスト注入と読み上げ状態の観測を可能にする。
 *
 * 公開グローバル:
 *   window.__synthesisCancelled: cancel() 呼び出し回数
 *   window.__speakCount        : speak() 呼び出し回数
 *   window.__finishSpeech()    : 現在の発話に onend を手動トリガー
 *   window.__emitSpeech(text)  : SpeechRecognition に result を注入
 *   window.__latestRecognition : 最後に作られた recognition インスタンス
 */

// ── SpeechSynthesis ───────────────────────────────────────────────────────────
window.__synthesisCancelled = 0;
window.__speakCount = 0;

let __currentUtterance = null;

window.__finishSpeech = () => {
  const u = __currentUtterance;
  __currentUtterance = null;
  if (u) u.onend?.();
};

Object.defineProperty(window, 'speechSynthesis', {
  configurable: true,
  value: {
    speak(utterance) {
      __currentUtterance = utterance;
      window.__speakCount = (window.__speakCount || 0) + 1;
      // onstart は非同期で発火 (実ブラウザと同様)
      setTimeout(() => utterance.onstart?.(), 10);
      // onend は __finishSpeech() で手動トリガー (割り込みテストのため止めたまま)
    },
    cancel() {
      window.__synthesisCancelled = (window.__synthesisCancelled || 0) + 1;
      const u = __currentUtterance;
      __currentUtterance = null;
      if (u) setTimeout(() => u.onerror?.({ error: 'interrupted', charIndex: 0 }), 0);
    },
  },
});

// ── SpeechRecognition ─────────────────────────────────────────────────────────
window.__latestRecognition = null;

window.SpeechRecognition = class FakeRecognition {
  constructor() {
    this.lang = '';
    this.continuous = false;
    this.interimResults = false;
    this.started = false;
    this.onresult = null;
    this.onspeechend = null;
    this.onerror = null;
    this.onend = null;
    window.__latestRecognition = this;
  }
  start() {
    this.started = true;
    window.__latestRecognition = this;
  }
  stop() { this.started = false; }
  abort() { this.started = false; }
};

window.__emitSpeech = function(text, isFinal = true) {
  const rec = window.__latestRecognition;
  if (!rec || !rec.onresult) return;
  const result = Object.assign(
    [{ transcript: text, confidence: 1 }],
    { isFinal, length: 1 }
  );
  rec.onresult({
    resultIndex: 0,
    results: Object.assign([result], { length: 1 }),
  });
};

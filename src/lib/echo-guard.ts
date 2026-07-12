const STRIP = /[。、．，！？!?\s]/g;

function normalize(text: string): string {
  return text.replace(STRIP, '');
}

function bigrams(text: string): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < text.length - 1; i++) {
    set.add(text.slice(i, i + 2));
  }
  return set;
}

// 丁寧語 (〜ください、すみません等) は AI 発話とユーザーの割り込みで共通しやすい。
// 連結した読み上げ全体と比較すると語尾の一致だけで割り込みを誤ってエコー判定するため、
// 「読み上げた 1 文への部分一致」だけをエコーとみなす。
const ECHO_THRESHOLD = 0.75;

/**
 * スピーカー再生した自分の声をマイクが拾う対策。
 * Web Speech API はマイク入力を設定できず、speechSynthesis の出力は
 * WebRTC のエコーキャンセルの対象外なので、テキスト照合で自己音声を判定する。
 */
export function isLikelyEcho(recognized: string, spokenRecently: string[]): boolean {
  const target = normalize(recognized);
  if (target.length === 0 || spokenRecently.length === 0) return false;

  if (target.length <= 2) {
    return spokenRecently.some((sentence) => normalize(sentence).includes(target));
  }

  const targetGrams = bigrams(target);
  return spokenRecently.some((sentence) => {
    const sentenceGrams = bigrams(normalize(sentence));
    let hit = 0;
    for (const gram of targetGrams) {
      if (sentenceGrams.has(gram)) hit++;
    }
    return hit / targetGrams.size >= ECHO_THRESHOLD;
  });
}

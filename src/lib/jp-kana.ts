const STRIP = /[\s・･]/g;

/**
 * 名前照合用のキーを作る。音声認識は同じ名前でも
 * ひらがな / カタカナ / 半角カナで揺れるため、カタカナに正規化して比較する。
 * 漢字から読みへの変換はしない (実モードでは LLM が name_kana を付与する)。
 */
export function normalizeNameKey(text: string): string {
  const nfkc = text.normalize('NFKC').replace(STRIP, '');
  let result = '';
  for (const char of nfkc) {
    const code = char.codePointAt(0)!;
    if (code >= 0x3041 && code <= 0x3096) {
      result += String.fromCodePoint(code + 0x60);
    } else {
      result += char;
    }
  }
  return result;
}

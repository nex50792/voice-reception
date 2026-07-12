import { describe, expect, it } from 'vitest';
import { isLikelyEcho } from './echo-guard';

const SPOKEN = ['かしこまりました。', 'ご希望の日時を教えてください。'];

describe('isLikelyEcho', () => {
  it('読み上げた文がそのまま認識された場合はエコーと判定する', () => {
    expect(isLikelyEcho('ご希望の日時を教えてください', SPOKEN)).toBe(true);
  });

  it('句読点や空白の差は無視して判定する', () => {
    expect(isLikelyEcho('ご希望の 日時を 教えて ください。', SPOKEN)).toBe(true);
  });

  it('読み上げ文の一部だけ拾われた場合もエコーと判定する', () => {
    expect(isLikelyEcho('日時を教えてください', SPOKEN)).toBe(true);
  });

  it('読み上げと無関係な発話はエコーではない', () => {
    expect(isLikelyEcho('あ、すみません明日でお願いします', SPOKEN)).toBe(false);
  });

  it('内容が違う割り込みはエコーではない', () => {
    expect(isLikelyEcho('やっぱり19時にしてください', SPOKEN)).toBe(false);
  });

  it('読み上げ履歴が空なら常にエコーではない', () => {
    expect(isLikelyEcho('ご希望の日時を教えてください', [])).toBe(false);
  });

  it('短すぎる認識片 (2文字以下) は読み上げに含まれていればエコー扱い', () => {
    expect(isLikelyEcho('日時', SPOKEN)).toBe(true);
    expect(isLikelyEcho('嫌だ', SPOKEN)).toBe(false);
  });

  it('割り込みの定型句「すみません」は丁寧語の類似だけでエコー扱いしない', () => {
    expect(isLikelyEcho('すみません', ['申し訳ありません、19:00 は満席です。'])).toBe(false);
    expect(isLikelyEcho('あ、すみません', ['ありがとうございます。人数を教えてください。'])).toBe(false);
  });

  it('言い直しの割り込みは語尾が同じでもエコー扱いしない', () => {
    expect(isLikelyEcho('やっぱり明後日にしてください', ['ご希望の日付を教えてください。'])).toBe(false);
    expect(isLikelyEcho('違います', ['18:30 でお取りします。'])).toBe(false);
  });
});

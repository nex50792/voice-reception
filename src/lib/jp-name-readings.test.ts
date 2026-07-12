import { describe, expect, it } from 'vitest';
import { nameToKana } from './jp-name-readings';

describe('nameToKana', () => {
  it('よくある姓の漢字をカタカナの読みに変換する', () => {
    expect(nameToKana('山田')).toBe('ヤマダ');
    expect(nameToKana('佐藤')).toBe('サトウ');
    expect(nameToKana('佐々木')).toBe('ササキ');
    expect(nameToKana('長谷川')).toBe('ハセガワ');
  });

  it('ひらがな・カタカナ・半角カナはカタカナに正規化する', () => {
    expect(nameToKana('やまだ')).toBe('ヤマダ');
    expect(nameToKana('ﾔﾏﾀﾞ')).toBe('ヤマダ');
  });

  it('空白が混ざっていても変換できる', () => {
    expect(nameToKana('山 田')).toBe('ヤマダ');
  });

  it('辞書にない漢字はそのまま残す', () => {
    expect(nameToKana('躑躅森')).toBe('躑躅森');
  });

  it('空文字は空のまま', () => {
    expect(nameToKana('')).toBe('');
  });
});

import { describe, expect, it } from 'vitest';
import { normalizeNameKey } from './jp-kana';

describe('normalizeNameKey', () => {
  it('ひらがなをカタカナに揃える', () => {
    expect(normalizeNameKey('やまだ')).toBe('ヤマダ');
    expect(normalizeNameKey('ヤマダ')).toBe('ヤマダ');
  });

  it('ひらがなとカタカナの混在も同じキーになる', () => {
    expect(normalizeNameKey('やまダ')).toBe(normalizeNameKey('ヤマだ'));
  });

  it('空白 (全角含む) と中点を除去する', () => {
    expect(normalizeNameKey('やま だ')).toBe('ヤマダ');
    expect(normalizeNameKey('ヤマ・ダ')).toBe('ヤマダ');
    expect(normalizeNameKey('やま　だ')).toBe('ヤマダ');
  });

  it('半角カタカナは全角に正規化する', () => {
    expect(normalizeNameKey('ﾔﾏﾀﾞ')).toBe('ヤマダ');
  });

  it('漢字はそのまま残る (読み変換はしない)', () => {
    expect(normalizeNameKey('山田')).toBe('山田');
  });

  it('空文字は空のまま', () => {
    expect(normalizeNameKey('')).toBe('');
  });
});

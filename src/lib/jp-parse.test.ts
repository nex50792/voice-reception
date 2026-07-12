import { describe, expect, it } from 'vitest';
import { parseDateJa, parsePartySizeJa, parseTimeJa } from './jp-parse';

const TODAY = '2026-07-11';

describe('parseDateJa', () => {
  it('今日・明日・明後日を解決する', () => {
    expect(parseDateJa('今日お願いします', TODAY)).toBe('2026-07-11');
    expect(parseDateJa('明日の夜', TODAY)).toBe('2026-07-12');
    expect(parseDateJa('明後日で', TODAY)).toBe('2026-07-13');
  });

  it('M月D日 形式を解決する', () => {
    expect(parseDateJa('7月15日でお願いします', TODAY)).toBe('2026-07-15');
    expect(parseDateJa('12月3日', TODAY)).toBe('2026-12-03');
  });

  it('過去になる M月D日 は翌年として解決する', () => {
    expect(parseDateJa('1月10日', TODAY)).toBe('2027-01-10');
  });

  it('日付が含まれなければ undefined', () => {
    expect(parseDateJa('4名です', TODAY)).toBeUndefined();
  });
});

describe('parseTimeJa', () => {
  it('N時・N時半・N時M分を解決する', () => {
    expect(parseTimeJa('19時でお願いします')).toBe('19:00');
    expect(parseTimeJa('18時半')).toBe('18:30');
    expect(parseTimeJa('19時15分')).toBe('19:15');
  });

  it('HH:MM 形式も受ける', () => {
    expect(parseTimeJa('19:30に')).toBe('19:30');
  });

  it('午後N時は 12 時間補正する', () => {
    expect(parseTimeJa('午後7時')).toBe('19:00');
  });

  it('時刻がなければ undefined', () => {
    expect(parseTimeJa('明日です')).toBeUndefined();
  });
});

describe('parsePartySizeJa', () => {
  it('N名・N人を解決する', () => {
    expect(parsePartySizeJa('4名でお願いします')).toBe(4);
    expect(parsePartySizeJa('2人です')).toBe(2);
  });

  it('漢数字も基本の範囲で解決する', () => {
    expect(parsePartySizeJa('四名')).toBe(4);
    expect(parsePartySizeJa('十二人')).toBe(12);
  });

  it('人数がなければ undefined', () => {
    expect(parsePartySizeJa('19時です')).toBeUndefined();
  });
});

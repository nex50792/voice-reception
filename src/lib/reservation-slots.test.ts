import { describe, expect, it } from 'vitest';
import {
  emptySlots,
  isComplete,
  missingSlots,
  updateSlots,
  type Slots,
} from './reservation-slots';

const TODAY = '2026-07-11';

describe('updateSlots', () => {
  it('部分的な更新をマージする', () => {
    let s = emptySlots();
    s = updateSlots(s, { date: '2026-07-15' }, TODAY);
    s = updateSlots(s, { partySize: 4 }, TODAY);
    expect(s).toEqual({ date: '2026-07-15', time: undefined, partySize: 4, name: undefined });
  });

  it('過去の日付は拒否して既存値を保持する', () => {
    const s = updateSlots({ ...emptySlots(), date: '2026-07-15' }, { date: '2026-07-01' }, TODAY);
    expect(s.date).toBe('2026-07-15');
  });

  it('当日は受け付ける', () => {
    expect(updateSlots(emptySlots(), { date: TODAY }, TODAY).date).toBe(TODAY);
  });

  it('日付形式が不正なら無視する', () => {
    expect(updateSlots(emptySlots(), { date: '7月15日' }, TODAY).date).toBeUndefined();
  });

  it('時刻形式 (HH:MM) 以外は無視する', () => {
    expect(updateSlots(emptySlots(), { time: '19時' }, TODAY).time).toBeUndefined();
    expect(updateSlots(emptySlots(), { time: '19:00' }, TODAY).time).toBe('19:00');
  });

  it('人数は 1〜12 のみ受け付ける', () => {
    expect(updateSlots(emptySlots(), { partySize: 0 }, TODAY).partySize).toBeUndefined();
    expect(updateSlots(emptySlots(), { partySize: 13 }, TODAY).partySize).toBeUndefined();
    expect(updateSlots(emptySlots(), { partySize: 2 }, TODAY).partySize).toBe(2);
  });

  it('名前は空白のみなら無視する', () => {
    expect(updateSlots(emptySlots(), { name: '  ' }, TODAY).name).toBeUndefined();
  });

  it('名前はカタカナの読みに正規化して持つ (よくある姓は漢字も変換)', () => {
    expect(updateSlots(emptySlots(), { name: 'やまだ' }, TODAY).name).toBe('ヤマダ');
    expect(updateSlots(emptySlots(), { name: 'ﾔﾏﾀﾞ' }, TODAY).name).toBe('ヤマダ');
    expect(updateSlots(emptySlots(), { name: '山田' }, TODAY).name).toBe('ヤマダ');
  });
});

describe('missingSlots / isComplete', () => {
  it('未入力スロットを決まった順序で返す', () => {
    expect(missingSlots(emptySlots())).toEqual(['date', 'time', 'partySize', 'name']);
    const half: Slots = { date: '2026-07-15', time: '19:00', partySize: undefined, name: undefined };
    expect(missingSlots(half)).toEqual(['partySize', 'name']);
  });

  it('全部埋まったら complete', () => {
    const full: Slots = { date: '2026-07-15', time: '19:00', partySize: 2, name: '山田' };
    expect(missingSlots(full)).toEqual([]);
    expect(isComplete(full)).toBe(true);
    expect(isComplete(emptySlots())).toBe(false);
  });
});

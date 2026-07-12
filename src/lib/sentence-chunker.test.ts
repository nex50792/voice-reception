import { describe, expect, it } from 'vitest';
import { createSentenceChunker } from './sentence-chunker';

describe('createSentenceChunker', () => {
  it('文の区切りが来るまでは何も返さない', () => {
    const c = createSentenceChunker();
    expect(c.feed('ご予約ですね')).toEqual([]);
  });

  it('句点で 1 文を返し、残りはバッファに保持する', () => {
    const c = createSentenceChunker();
    expect(c.feed('かしこまりました。ご希望の')).toEqual(['かしこまりました。']);
    expect(c.feed('日時を教えてください。')).toEqual(['ご希望の日時を教えてください。']);
  });

  it('複数の文が 1 つの delta に含まれる場合は全部返す', () => {
    const c = createSentenceChunker();
    expect(c.feed('はい。2名ですね！何時にしますか？')).toEqual([
      'はい。',
      '2名ですね！',
      '何時にしますか？',
    ]);
  });

  it('delta をまたいだ文も正しく結合する', () => {
    const c = createSentenceChunker();
    expect(c.feed('18時')).toEqual([]);
    expect(c.feed('ですね')).toEqual([]);
    expect(c.feed('。')).toEqual(['18時ですね。']);
  });

  it('flush で残りを返してバッファを空にする', () => {
    const c = createSentenceChunker();
    c.feed('お名前を');
    expect(c.flush()).toBe('お名前を');
    expect(c.flush()).toBeNull();
  });

  it('空白のみの文は捨てる', () => {
    const c = createSentenceChunker();
    expect(c.feed('  \n')).toEqual([]);
    expect(c.flush()).toBeNull();
  });

  it('改行も文の区切りとして扱う', () => {
    const c = createSentenceChunker();
    expect(c.feed('確認します\nお名前は？')).toEqual(['確認します', 'お名前は？']);
  });
});

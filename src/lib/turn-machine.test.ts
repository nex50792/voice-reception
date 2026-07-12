import { describe, expect, it } from 'vitest';
import { transition, type TurnState } from './turn-machine';

describe('transition', () => {
  it('idle から START で listening になる', () => {
    expect(transition('idle', { type: 'START' })).toBe('listening');
  });

  it('通常の 1 ターン: listening → thinking → speaking → listening', () => {
    let s: TurnState = 'listening';
    s = transition(s, { type: 'SPEECH_FINAL' });
    expect(s).toBe('thinking');
    s = transition(s, { type: 'TTS_START' });
    expect(s).toBe('speaking');
    s = transition(s, { type: 'TTS_DONE' });
    expect(s).toBe('listening');
  });

  it('speaking 中の BARGE_IN で listening に戻る', () => {
    expect(transition('speaking', { type: 'BARGE_IN' })).toBe('listening');
  });

  it('speaking 以外での BARGE_IN は無視される', () => {
    expect(transition('listening', { type: 'BARGE_IN' })).toBe('listening');
    expect(transition('thinking', { type: 'BARGE_IN' })).toBe('thinking');
    expect(transition('idle', { type: 'BARGE_IN' })).toBe('idle');
  });

  it('thinking で音声化するものがなく LLM_DONE なら listening に戻る', () => {
    expect(transition('thinking', { type: 'LLM_DONE' })).toBe('listening');
  });

  it('speaking 中の LLM_DONE は無視される (読み上げ完了までは speaking)', () => {
    expect(transition('speaking', { type: 'LLM_DONE' })).toBe('speaking');
  });

  it('どの状態からでも STOP で idle になる', () => {
    const states: TurnState[] = ['idle', 'listening', 'thinking', 'speaking'];
    for (const s of states) {
      expect(transition(s, { type: 'STOP' })).toBe('idle');
    }
  });

  it('thinking で ERROR なら listening に戻って再入力を待つ', () => {
    expect(transition('thinking', { type: 'ERROR' })).toBe('listening');
  });

  it('不正なイベントは状態を変えない', () => {
    expect(transition('idle', { type: 'SPEECH_FINAL' })).toBe('idle');
    expect(transition('idle', { type: 'TTS_DONE' })).toBe('idle');
    expect(transition('listening', { type: 'TTS_START' })).toBe('listening');
  });
});

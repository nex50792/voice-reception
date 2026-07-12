import { describe, expect, it } from 'vitest';
import { createLatencyLog, percentile, turnSegments } from './latency-meter';

describe('turnSegments', () => {
  it('全マークが揃っていれば各区間と合計を返す', () => {
    const seg = turnSegments({
      speechEnd: 1000,
      sttFinal: 1200,
      llmFirstToken: 1700,
      ttsStart: 1900,
    });
    expect(seg).toEqual({ stt: 200, llm: 500, tts: 200, total: 900 });
  });

  it('欠けているマークの区間は undefined になる', () => {
    const seg = turnSegments({ speechEnd: 1000, ttsStart: 1800 });
    expect(seg.stt).toBeUndefined();
    expect(seg.llm).toBeUndefined();
    expect(seg.total).toBe(800);
  });

  it('speechEnd がなければ total も undefined', () => {
    expect(turnSegments({ ttsStart: 500 }).total).toBeUndefined();
  });
});

describe('percentile (nearest-rank)', () => {
  it('空配列は null', () => {
    expect(percentile([], 50)).toBeNull();
  });

  it('1 件ならその値', () => {
    expect(percentile([340], 50)).toBe(340);
    expect(percentile([340], 95)).toBe(340);
  });

  it('p50 と p95 を nearest-rank で返す', () => {
    const values = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    expect(percentile(values, 50)).toBe(500);
    expect(percentile(values, 95)).toBe(1000);
  });

  it('未ソートの入力でも正しい', () => {
    expect(percentile([900, 100, 500], 50)).toBe(500);
  });
});

describe('createLatencyLog', () => {
  it('ターンを蓄積して total の統計を返す', () => {
    const log = createLatencyLog();
    log.add({ speechEnd: 0, sttFinal: 100, llmFirstToken: 400, ttsStart: 600 });
    log.add({ speechEnd: 0, sttFinal: 150, llmFirstToken: 500, ttsStart: 800 });
    log.add({ speechEnd: 0, ttsStart: 1000 });
    const stats = log.stats();
    expect(stats.count).toBe(3);
    expect(stats.p50).toBe(800);
    expect(stats.p95).toBe(1000);
  });

  it('total が計算できないターンは統計から除外する', () => {
    const log = createLatencyLog();
    log.add({ sttFinal: 100 });
    expect(log.stats().count).toBe(0);
    expect(log.stats().p50).toBeNull();
  });
});

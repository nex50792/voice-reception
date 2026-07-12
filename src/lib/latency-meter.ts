export interface TurnMarks {
  speechEnd?: number;
  sttFinal?: number;
  llmFirstToken?: number;
  ttsStart?: number;
}

export interface TurnSegments {
  stt?: number;
  llm?: number;
  tts?: number;
  total?: number;
}

export function turnSegments(marks: TurnMarks): TurnSegments {
  const diff = (from?: number, to?: number) =>
    from !== undefined && to !== undefined ? to - from : undefined;
  return {
    stt: diff(marks.speechEnd, marks.sttFinal),
    llm: diff(marks.sttFinal, marks.llmFirstToken),
    tts: diff(marks.llmFirstToken, marks.ttsStart),
    total: diff(marks.speechEnd, marks.ttsStart),
  };
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

export function createLatencyLog() {
  const turns: TurnMarks[] = [];

  return {
    add(marks: TurnMarks) {
      turns.push(marks);
    },
    stats() {
      const totals = turns
        .map((t) => turnSegments(t).total)
        .filter((v): v is number => v !== undefined);
      return {
        count: totals.length,
        p50: percentile(totals, 50),
        p95: percentile(totals, 95),
      };
    },
    all(): TurnMarks[] {
      return [...turns];
    },
  };
}

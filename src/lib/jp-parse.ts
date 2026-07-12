const KANJI_DIGITS: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
  十一: 11,
  十二: 12,
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function addDays(today: string, days: number): string {
  const [y, m, d] = today.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function parseDateJa(text: string, today: string): string | undefined {
  if (text.includes('明後日')) return addDays(today, 2);
  if (text.includes('明日')) return addDays(today, 1);
  if (text.includes('今日') || text.includes('本日')) return today;

  const md = text.match(/(\d{1,2})月(\d{1,2})日/);
  if (md) {
    const year = Number(today.slice(0, 4));
    const candidate = `${year}-${pad(Number(md[1]))}-${pad(Number(md[2]))}`;
    return candidate >= today ? candidate : `${year + 1}-${pad(Number(md[1]))}-${pad(Number(md[2]))}`;
  }
  return undefined;
}

export function parseTimeJa(text: string): string | undefined {
  const colon = text.match(/([01]?\d|2[0-3]):([0-5]\d)/);
  if (colon) return `${pad(Number(colon[1]))}:${colon[2]}`;

  const hourMatch = text.match(/(午後|午前)?\s*(\d{1,2})時(半|(\d{1,2})分)?/);
  if (!hourMatch) return undefined;

  let hour = Number(hourMatch[2]);
  if (hourMatch[1] === '午後' && hour < 12) hour += 12;
  if (hour > 23) return undefined;

  const minute = hourMatch[3] === '半' ? 30 : hourMatch[4] !== undefined ? Number(hourMatch[4]) : 0;
  if (minute > 59) return undefined;
  return `${pad(hour)}:${pad(minute)}`;
}

export function parsePartySizeJa(text: string): number | undefined {
  const arabic = text.match(/(\d{1,2})\s*(名|人)/);
  if (arabic) {
    const n = Number(arabic[1]);
    return n >= 1 && n <= 12 ? n : undefined;
  }

  const kanji = text.match(/(十[一二]?|[一二三四五六七八九])\s*(名|人)/);
  if (kanji) return KANJI_DIGITS[kanji[1]];
  return undefined;
}

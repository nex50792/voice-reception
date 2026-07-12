import { nameToKana } from './jp-name-readings';

export interface Slots {
  date?: string;
  time?: string;
  partySize?: number;
  name?: string;
}

export type SlotKey = keyof Slots;

const SLOT_ORDER: SlotKey[] = ['date', 'time', 'partySize', 'name'];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function emptySlots(): Slots {
  return { date: undefined, time: undefined, partySize: undefined, name: undefined };
}

export function updateSlots(current: Slots, patch: Partial<Slots>, today: string): Slots {
  const next = { ...current };
  if (patch.date !== undefined && DATE_PATTERN.test(patch.date) && patch.date >= today) {
    next.date = patch.date;
  }
  if (patch.time !== undefined && TIME_PATTERN.test(patch.time)) {
    next.time = patch.time;
  }
  if (
    patch.partySize !== undefined &&
    Number.isInteger(patch.partySize) &&
    patch.partySize >= 1 &&
    patch.partySize <= 12
  ) {
    next.partySize = patch.partySize;
  }
  // 電話では漢字表記を確認できないため、名前はカタカナの読みとして持つ
  if (patch.name !== undefined && patch.name.trim().length > 0) {
    next.name = nameToKana(patch.name);
  }
  return next;
}

export function missingSlots(slots: Slots): SlotKey[] {
  return SLOT_ORDER.filter((key) => slots[key] === undefined);
}

export function isComplete(slots: Slots): boolean {
  return missingSlots(slots).length === 0;
}

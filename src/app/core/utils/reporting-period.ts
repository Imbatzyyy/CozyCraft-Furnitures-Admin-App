/** Reporting follows the store's Philippine calendar, not the device timezone. */
const PHT_OFFSET = 8 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
export type ReportingRange = 'week' | 'month' | 'quarter';
export interface ReportingSlice { label: string; start: Date; end: Date; }

export function phtMonthStart(now: Date, monthOffset = 0): Date {
  const local = new Date(now.getTime() + PHT_OFFSET);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + monthOffset, 1) - PHT_OFFSET);
}

export function reportingBounds(range: ReportingRange, now = new Date()) {
  const local = new Date(now.getTime() + PHT_OFFSET);
  const start = range === 'week'
    ? new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - 6) - PHT_OFFSET)
    : phtMonthStart(now, range === 'quarter' ? -(local.getUTCMonth() % 3) : 0);
  const end = new Date(now);
  const previousStart = new Date(start.getTime() - (end.getTime() - start.getTime()));
  return { start, end, previousStart };
}

export function reportingSlices(range: ReportingRange, start: Date, end: Date): ReportingSlice[] {
  if (range === 'quarter') {
    return Array.from({ length: 3 }, (_, index) => {
      const sliceStart = phtMonthStart(start, index);
      const sliceEnd = phtMonthStart(start, index + 1);
      return { label: sliceStart.toLocaleDateString('en-PH', { month: 'short', timeZone: 'Asia/Manila' }), start: sliceStart, end: new Date(Math.max(sliceStart.getTime(), Math.min(sliceEnd.getTime(), end.getTime() + 1))) };
    });
  }
  const step = range === 'week' ? DAY : 7 * DAY;
  const count = range === 'week' ? 7 : Math.ceil((end.getTime() - start.getTime() + 1) / step);
  return Array.from({ length: count }, (_, index) => {
    const sliceStart = new Date(start.getTime() + index * step);
    return {
      label: range === 'week'
        ? sliceStart.toLocaleDateString('en-PH', { weekday: 'short', timeZone: 'Asia/Manila' }).slice(0, 2)
        : String(new Date(sliceStart.getTime() + PHT_OFFSET).getUTCDate()),
      start: sliceStart,
      end: new Date(Math.min(sliceStart.getTime() + step, end.getTime() + 1)),
    };
  });
}

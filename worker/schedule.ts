import { END, START } from '../shared/config.ts';
import { isDate, parseWallTime } from '../shared/time.ts';
import type { Booking, Interval, Limits, Segment } from '../shared/types.ts';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid record');
  }
  return value as Record<string, unknown>;
}

export function parseLimits(value: unknown): Limits {
  const limits = record(value);
  if (!isDate(limits.minDateLoad) || !isDate(limits.maxDateLoad) ||
      limits.minDateLoad > limits.maxDateLoad) throw new Error('Invalid publication limits');
  return { minDate: limits.minDateLoad, maxDate: limits.maxDateLoad };
}

export function normalizeSchedule(value: unknown, date: string) {
  if (!isDate(date) || !Array.isArray(value) || value.length > 1000) {
    throw new Error('Invalid schedule');
  }
  const bookings: Booking[] = [];
  for (const item of value) {
    const allocation = record(item);
    const from = parseWallTime(allocation.date_from);
    const to = parseWallTime(allocation.date_to);
    if (from.date > to.date || (from.date === to.date && from.minutes >= to.minutes)) {
      throw new Error('Invalid booking interval');
    }
    const event = record(allocation.belegungsserie).veranstaltung;
    let title = 'Closed';
    if (event !== null) {
      const details = record(event);
      if (typeof details.allocationTitle !== 'string' ||
          !['number', 'string'].includes(typeof details.findetStatt)) {
        throw new Error('Invalid event');
      }
      // Match ETH's strict cancellation filter, including numeric (not string) 1.
      if (details.findetStatt !== 1) continue;
      title = details.allocationTitle.trim() || 'Booked';
    }

    const start = from.date < date ? START : from.date > date ? END : Math.max(START, from.minutes);
    const end = to.date > date ? END : to.date < date ? START : Math.min(END, to.minutes);
    if (start < end) {
      bookings.push({
        start, end, title,
        from: allocation.date_from as string,
        to: allocation.date_to as string,
        kind: event === null ? 'closed' : 'booking',
      });
    }
  }
  bookings.sort((a, b) => a.start - b.start || a.end - b.end);

  const blocked: Interval[] = [];
  for (const booking of bookings) {
    const previous = blocked.at(-1);
    if (previous && booking.start <= previous.end) {
      previous.end = Math.max(previous.end, booking.end);
    } else {
      blocked.push({ start: booking.start, end: booking.end });
    }
  }

  const segments: Segment[] = [];
  let cursor = START;
  for (const interval of blocked) {
    if (cursor < interval.start) segments.push({ start: cursor, end: interval.start, state: 'unbooked' });
    segments.push({ ...interval, state: 'booked' });
    cursor = interval.end;
  }
  if (cursor < END) segments.push({ start: cursor, end: END, state: 'unbooked' });
  return { bookings, segments };
}

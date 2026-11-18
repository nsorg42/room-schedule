import { END, ROOMS, START, TIME_ZONE } from '../shared/config.ts';
import { isDate, parseWallTime } from '../shared/time.ts';
import type { RoomSchedule, TodayResponse } from '../shared/types.ts';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid response');
  return value as Record<string, unknown>;
}

function validRoom(value: unknown, name: string): value is RoomSchedule {
  try {
    const room = object(value);
    if (room.name !== name) return false;
    if (room.status === 'unavailable') return room.fetchedAt === null;
    if (room.status !== 'ok' || typeof room.fetchedAt !== 'string' ||
        !Number.isFinite(Date.parse(room.fetchedAt)) || !Array.isArray(room.bookings) ||
        !Array.isArray(room.segments)) return false;
    for (const item of room.bookings) {
      const booking = object(item);
      if (typeof booking.title !== 'string' || !['booking', 'closed'].includes(String(booking.kind)) ||
          typeof booking.start !== 'number' || typeof booking.end !== 'number' ||
          !Number.isFinite(booking.start) || !Number.isFinite(booking.end) ||
          booking.start < START || booking.end > END || booking.start >= booking.end) return false;
      parseWallTime(booking.from);
      parseWallTime(booking.to);
    }
    let cursor = START;
    for (const item of room.segments) {
      const segment = object(item);
      if (segment.start !== cursor || typeof segment.end !== 'number' ||
          !Number.isFinite(segment.end) || segment.end <= cursor || segment.end > END ||
          !['booked', 'unbooked'].includes(String(segment.state))) return false;
      cursor = segment.end;
    }
    return cursor === END;
  } catch { return false; }
}

export function parseToday(value: unknown, date: string): TodayResponse {
  const data = object(value);
  if (data.date !== date || data.timeZone !== TIME_ZONE || !Array.isArray(data.rooms)) {
    throw new Error('Schedule date or response is invalid');
  }
  const coverage = object(data.coverage);
  const covered = coverage.status === 'ok' && isDate(coverage.minDate) && isDate(coverage.maxDate) &&
    coverage.minDate <= date && date <= coverage.maxDate;
  const results = data.rooms;
  const rooms = ROOMS.map((room, index): RoomSchedule => {
    const result = results[index];
    return covered && validRoom(result, room.name)
      ? { ...result, ...room }
      : { ...room, status: 'unavailable', fetchedAt: null, reason: 'coverage' };
  });
  return { date, timeZone: TIME_ZONE, coverage: data.coverage as TodayResponse['coverage'], rooms };
}

import { ROOMS, TIME_ZONE } from '../shared/config.ts';
import { zurichTime } from '../shared/time.ts';
import type { RoomSchedule, TodayResponse } from '../shared/types.ts';
import { createEthClient } from './eth.ts';

export const SCHEDULE_TTL = 300;
export const LIMITS_TTL = 6 * 60 * 60;

export interface TodayOptions {
  origin: string;
  date?: string;
  cache: Pick<Cache, 'match' | 'put'>;
  waitUntil: (task: Promise<unknown>) => void;
  fetcher?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
}

export async function getToday(options: TodayOptions): Promise<TodayResponse> {
  const { origin, cache, waitUntil, fetcher, timeoutMs } = options;
  const now = options.now ?? (() => new Date());
  const date = options.date ?? zurichTime(now()).date;
  const eth = createEthClient(fetcher, timeoutMs);

  async function cached<T>(path: string, ttl: number, load: () => Promise<T>) {
    const key = new Request(new URL(`/__schedule-cache/v1/${path}`, origin));
    try {
      const response = await cache.match(key);
      if (response) {
        const saved = await response.json() as { value: T; fetchedAt: string };
        const age = now().getTime() - Date.parse(saved.fetchedAt);
        if (age >= 0 && age < ttl * 1000) return saved;
      }
    } catch { /* A cache miss or cache failure can still use live data. */ }

    const value = await load();
    const saved = { value, fetchedAt: now().toISOString() };
    const response = Response.json(saved, { headers: { 'Cache-Control': `public, max-age=${ttl}` } });
    waitUntil(cache.put(key, response).catch(() => undefined));
    return saved;
  }

  let coverage: TodayResponse['coverage'];
  try {
    const limits = await cached('limits', LIMITS_TTL, () => eth.limits());
    coverage = { status: 'ok', ...limits.value, fetchedAt: limits.fetchedAt };
  } catch (error) {
    console.warn('ETH publication limits unavailable:', error);
    coverage = { status: 'unavailable' };
  }

  const unavailable = (room: typeof ROOMS[number], reason: 'coverage' | 'upstream'): RoomSchedule =>
    ({ ...room, status: 'unavailable', fetchedAt: null, reason });
  if (coverage.status !== 'ok' || date < coverage.minDate || date > coverage.maxDate) {
    return { date, timeZone: TIME_ZONE, coverage, rooms: ROOMS.map(room => unavailable(room, 'coverage')) };
  }

  const rooms = new Array<RoomSchedule>(ROOMS.length);
  let next = 0;
  async function consume() {
    while (next < ROOMS.length) {
      const index = next++;
      const room = ROOMS[index];
      try {
        const schedule = await cached(`${date}/${encodeURIComponent(room.name)}`, SCHEDULE_TTL,
          () => eth.room(room.name, date));
        rooms[index] = { ...room, status: 'ok', fetchedAt: schedule.fetchedAt, ...schedule.value };
      } catch (error) {
        console.warn(`ETH schedule unavailable for ${room.name}:`, error);
        rooms[index] = unavailable(room, 'upstream');
      }
    }
  }
  await Promise.all([consume(), consume()]);
  return { date, timeZone: TIME_ZONE, coverage, rooms };
}

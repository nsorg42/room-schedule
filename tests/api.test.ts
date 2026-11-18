import { expect, it } from 'vitest';
import { parseToday } from '../src/api.ts';
import { DATE, todayFixture } from './fixtures.ts';

it('accepts complete validated rows and keeps the configured order', () => {
  expect(parseToday(todayFixture(), DATE)).toEqual(todayFixture());
});

it('rejects a previous-day response', () => {
  expect(() => parseToday(todayFixture(), '2026-11-19')).toThrow();
});

it('keeps missing, malformed, or unverified coverage gray', () => {
  const fixture = todayFixture();
  fixture.rooms[0] = {} as never;
  const result = parseToday(fixture, DATE);
  expect(result.rooms[0].status).toBe('unavailable');
  expect(result.rooms[1].status).toBe('ok');
  fixture.coverage = { status: 'unavailable' };
  expect(parseToday(fixture, DATE).rooms.every(room => room.status === 'unavailable')).toBe(true);
});

it('rejects incomplete or invalid segments rather than filling their gaps with green', () => {
  const fixture = todayFixture();
  if (fixture.rooms[0].status === 'ok') fixture.rooms[0].segments = [];
  expect(parseToday(fixture, DATE).rooms[0].status).toBe('unavailable');
});

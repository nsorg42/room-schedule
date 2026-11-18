import { expect, it } from 'vitest';
import { formatTime, parseWallTime, zurichTime } from '../shared/time.ts';

it.each([
  ['2026-11-18T23:30:00Z', '2026-11-19', 30],
  ['2026-07-18T22:30:00Z', '2026-07-19', 30],
  ['2026-03-29T00:30:00Z', '2026-03-29', 90],
  ['2026-03-29T01:30:00Z', '2026-03-29', 210],
  ['2026-10-25T00:30:00Z', '2026-10-25', 150],
  ['2026-10-25T01:30:00Z', '2026-10-25', 150],
])('uses Zurich time at %s, including midnight and DST', (instant, date, minutes) => {
  expect(zurichTime(new Date(instant))).toEqual({ date, minutes });
});

it('preserves summer and winter ETH wall times without treating them as UTC', () => {
  expect(parseWallTime('2026-07-18T14:15:00')).toEqual({ date: '2026-07-18', minutes: 855 });
  expect(parseWallTime('2026-11-18T14:15:00')).toEqual({ date: '2026-11-18', minutes: 855 });
  expect(formatTime(855)).toBe('14:15');
});

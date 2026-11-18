import { describe, expect, it } from 'vitest';
import { ROOMS } from '../shared/config.ts';
import { normalizeSchedule, parseLimits } from '../worker/schedule.ts';
import { allocation, DATE } from './fixtures.ts';

describe('fixed rooms', () => {
  it('keeps the tested human-readable schedule names in the specified order', () => {
    expect(ROOMS.map(room => room.name)).toEqual([
      'HG K 30.1', 'HG D 11', 'HG D 12', 'HG E 19',
      'HG E 26.1', 'HG E 26.3', 'HG E 27', 'HG G 1',
    ]);
    expect(ROOMS[0].label).toBe('HG K 30.1 · Vis Dome');
  });
});

describe('schedule normalization', () => {
  const normalize = (items: unknown[]) => normalizeSchedule(items, DATE);

  it('excludes cancelled events and requires the numeric 1', () => {
    const result = normalize([
      allocation('09:00', '10:00', 'Cancelled', 0),
      allocation('10:00', '11:00', 'String flag', '1'),
      allocation('11:00', '12:00', 'Held', 1),
    ]);
    expect(result.bookings.map(b => b.title)).toEqual(['Held']);
    expect(result.segments).toEqual([
      { start: 480, end: 660, state: 'unbooked' },
      { start: 660, end: 720, state: 'booked' },
      { start: 720, end: 1200, state: 'unbooked' },
    ]);
  });

  it('retains null-event closures, including closures during visible hours', () => {
    const result = normalize([allocation('07:00', '09:30', null)]);
    expect(result.bookings[0]).toMatchObject({ start: 480, end: 570, title: 'Closed', kind: 'closed' });
    expect(result.segments[0]).toEqual({ start: 480, end: 570, state: 'booked' });
  });

  it('merges unsorted adjacent and overlapping intervals and preserves their labels', () => {
    const result = normalize([
      allocation('14:00', '17:00', 'Second'),
      allocation('12:00', '14:00', 'First'),
      allocation('13:30', '14:30', 'Overlap'),
    ]);
    expect(result.segments).toEqual([
      { start: 480, end: 720, state: 'unbooked' },
      { start: 720, end: 1020, state: 'booked' },
      { start: 1020, end: 1200, state: 'unbooked' },
    ]);
    expect(result.bookings.map(b => b.title)).toEqual(['First', 'Overlap', 'Second']);
    expect(result.bookings[0].to).toBe(`${DATE}T14:00:00`);
  });

  it('keeps the end of an interval half-open', () => {
    const result = normalize([allocation('11:00', '12:00')]);
    expect(result.segments[2]).toEqual({ start: 720, end: 1200, state: 'unbooked' });
  });

  it('handles overnight and multi-day bookings without shifting wall times', () => {
    const result = normalize([
      allocation('2026-11-17T23:00:00', '2026-11-18T09:15:00', 'Overnight'),
      allocation('2026-11-18T19:30:00', '2026-11-20T13:00:00', 'Multi-day'),
    ]);
    expect(result.bookings.map(b => [b.start, b.end])).toEqual([[480, 555], [1170, 1200]]);
    expect(normalize([allocation('2026-11-17T12:00:00', '2026-11-19T22:00:00')]).segments)
      .toEqual([{ start: 480, end: 1200, state: 'booked' }]);
  });

  it('clips at 08:00 and 20:00 and excludes bookings entirely outside the window', () => {
    const result = normalize([
      allocation('00:00', '08:00', null), allocation('07:30', '08:15'),
      allocation('19:45', '22:00'), allocation('20:00', '23:59', null),
      allocation('2026-11-17T12:00:00', '2026-11-17T14:00:00'),
      allocation('2026-11-19T09:00:00', '2026-11-19T12:00:00'),
    ]);
    expect(result.bookings.map(b => [b.start, b.end])).toEqual([[480, 495], [1185, 1200]]);
  });

  it('uses reservation minutes and seconds without rounding to lecture times', () => {
    const result = normalize([allocation(`${DATE}T10:07:30`, `${DATE}T11:52:00`)]);
    expect(result.bookings[0]).toMatchObject({ start: 607.5, end: 712 });
  });

  it('treats a successfully validated empty schedule as unbooked', () => {
    expect(normalize([]).segments).toEqual([{ start: 480, end: 1200, state: 'unbooked' }]);
  });

  it.each([
    null, {}, [null], [{ date_from: `${DATE}T09:00:00` }],
    [allocation('12:00', '11:00')], [allocation('10:00', '10:00')],
    [allocation('2026-02-30T08:00:00', `${DATE}T10:00:00`)],
    [allocation(`${DATE}T09:00:00Z`, `${DATE}T10:00:00Z`)],
    [allocation(`${DATE}T25:00:00`, `${DATE}T26:00:00`)],
    [{ ...allocation('09:00', '10:00'), belegungsserie: {} }],
    [{ ...allocation('09:00', '10:00'), belegungsserie: { veranstaltung: {} } }],
  ])('rejects invalid records instead of generating availability (%j)', value => {
    expect(() => normalizeSchedule(value, DATE)).toThrow();
  });
});

it('validates publication limits, including calendar dates and range order', () => {
  expect(parseLimits({ minDateLoad: '2026-02-21', maxDateLoad: '2027-02-21' }))
    .toEqual({ minDate: '2026-02-21', maxDate: '2027-02-21' });
  expect(() => parseLimits({ minDateLoad: '2027-02-21', maxDateLoad: '2026-02-21' })).toThrow();
  expect(() => parseLimits({ minDateLoad: '2026-02-30', maxDateLoad: '2027-02-21' })).toThrow();
});

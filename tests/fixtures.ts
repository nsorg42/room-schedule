import { ROOMS, TIME_ZONE } from '../shared/config.ts';
import type { TodayResponse } from '../shared/types.ts';
import { normalizeSchedule } from '../worker/schedule.ts';

export const DATE = '2026-11-18';
export const NOW = new Date('2026-11-18T09:30:00Z');
export const LIMITS = { minDateLoad: '2026-02-21', maxDateLoad: '2027-02-21' };

export function allocation(from: string, to: string, title: string | null = 'A booking', findetStatt: unknown = 1) {
  return {
    date_from: from.includes('T') ? from : `${DATE}T${from}:00`,
    date_to: to.includes('T') ? to : `${DATE}T${to}:00`,
    belegungsserie: { veranstaltung: title === null ? null : { allocationTitle: title, findetStatt } },
  };
}

export function todayFixture(date = DATE): TodayResponse {
  const allocations = [
    [allocation('14:00', '17:00', 'Engineering Design and Material Selection')],
    [allocation('00:00', '08:00', null), allocation('22:00', '23:59', null)],
    [allocation('11:00', '12:00', 'Seminar')],
    [allocation('08:30', '10:15', 'Lecture'), allocation('13:00', '15:00', 'Tutorial')],
    [allocation('09:00', '12:00', 'Lecture'), allocation('15:00', '16:30', 'Seminar')],
    [allocation('10:00', '11:00', 'Seminar'), allocation('16:00', '18:00', 'Lecture')],
    [allocation('08:00', '10:00', null), allocation('12:00', '14:00', 'Lecture')],
    [allocation('12:00', '14:00', 'First booking'), allocation('14:00', '17:00', 'Second booking')],
  ];
  return {
    date, timeZone: TIME_ZONE,
    coverage: { status: 'ok', minDate: '2026-02-21', maxDate: '2027-02-21', fetchedAt: NOW.toISOString() },
    rooms: ROOMS.map((room, i) => ({
      ...room, status: 'ok', fetchedAt: NOW.toISOString(),
      ...normalizeSchedule(allocations[i].map(item => ({
        ...item,
        date_from: item.date_from.replace(DATE, date),
        date_to: item.date_to.replace(DATE, date),
      })), date),
    })),
  };
}

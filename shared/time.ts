import { TIME_ZONE } from './config.ts';

const clock = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export function zurichTime(now = new Date()) {
  const parts = Object.fromEntries(clock.formatToParts(now).map(p => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute) + Number(parts.second) / 60,
  };
}

export function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 2000 && date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

// ETH supplies Zurich wall times. Keep their calendar date and clock time together;
// no UTC conversion is needed to intersect them with a Zurich daytime window.
export function parseWallTime(value: unknown) {
  if (typeof value !== 'string') throw new Error('Invalid timestamp');
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(value);
  if (!match || !isDate(match[1])) throw new Error('Invalid timestamp');
  const [, date, hour, minute, second, fraction = '0'] = match;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) {
    throw new Error('Invalid clock time');
  }
  return {
    date,
    minutes: Number(hour) * 60 + Number(minute) +
      (Number(second) + Number(`0.${fraction}`)) / 60,
  };
}

export function formatTime(minutes: number) {
  const whole = Math.floor(minutes);
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}

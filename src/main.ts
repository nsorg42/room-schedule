import './style.css';
import { API_TIMEOUT_MS, END, ROOMS, START, TIME_ZONE } from '../shared/config.ts';
import { formatTime, parseWallTime, zurichTime } from '../shared/time.ts';
import type { Booking, RoomSchedule, Segment } from '../shared/types.ts';
import { parseToday } from './api.ts';

function find<T extends HTMLElement>(id: string) {
  return document.getElementById(id) as T;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

const themeToggle = find<HTMLButtonElement>('theme-toggle');
const systemTheme = matchMedia('(prefers-color-scheme: dark)');

function updateTheme() {
  const theme = document.documentElement.dataset.theme ?? 'system';
  const dark = theme === 'dark' || (theme === 'system' && systemTheme.matches);
  const label = `Switch to ${dark ? 'light' : 'dark'} theme`;
  themeToggle.setAttribute('aria-label', label);
  themeToggle.title = label;
  themeToggle.querySelector('.theme-sun')!.toggleAttribute('hidden', !dark);
  themeToggle.querySelector('.theme-moon')!.toggleAttribute('hidden', dark);
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach(meta => {
    meta.content = dark ? '#171c19' : '#f5f5f0';
  });
}

themeToggle.addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme === 'dark' ||
    (!document.documentElement.dataset.theme && systemTheme.matches);
  const theme = dark ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('theme', theme); }
  catch { /* The theme still works when storage is unavailable. */ }
  updateTheme();
});
systemTheme.addEventListener('change', updateTheme);
updateTheme();

const table = find<HTMLTableElement>('timetable');
const rows = find<HTMLTableSectionElement>('room-rows');
const axis = find<HTMLDivElement>('time-axis');
const status = find<HTMLParagraphElement>('load-status');
const updated = find<HTMLParagraphElement>('updated');
const popover = find<HTMLDivElement>('booking-popover');
const dateFormat = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
});
const updatedFormat = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: TIME_ZONE,
});

let displayedDate = '';
let currentDate = zurichTime().date;
let requestDate = '';
let pending: AbortController | undefined;
let activeButton: HTMLButtonElement | undefined;

function nowLine() {
  const line = element('span', 'now-line');
  line.setAttribute('aria-hidden', 'true');
  return line;
}

for (let minute = START; minute <= END; minute += 60) {
  const tick = element('span', 'hour', formatTime(minute));
  if ((minute - START) % 240 !== 0) tick.classList.add('minor-hour');
  tick.style.left = `${(minute - START) / (END - START) * 100}%`;
  if (minute === START) tick.classList.add('first');
  if (minute === END) tick.classList.add('last');
  axis.append(tick);
}
const axisNow = nowLine();
const nowLabel = element('span', 'now-label');
axis.append(axisNow, nowLabel);

function closePopover() {
  if (popover.matches(':popover-open')) popover.hidePopover();
}

popover.addEventListener('toggle', () => {
  activeButton?.setAttribute('aria-expanded', String(popover.matches(':popover-open')));
});
find<HTMLButtonElement>('close-popover').addEventListener('click', () => {
  closePopover();
  activeButton?.focus({ preventScroll: true });
});
find('board-scroll').addEventListener('scroll', closePopover);
window.addEventListener('resize', closePopover);

function bookingTime(booking: Booking) {
  const from = parseWallTime(booking.from);
  const to = parseWallTime(booking.to);
  const exactTime = (value: string) => Number(value.slice(17)) === 0 ? value.slice(11, 16) : value.slice(11);
  const start = `${from.date === displayedDate ? '' : `${from.date} · `}${exactTime(booking.from)}`;
  const end = `${to.date === displayedDate ? '' : `${to.date} · `}${exactTime(booking.to)}`;
  return `${start}–${end}`;
}

function showBookings(button: HTMLButtonElement, room: string, bookings: Booking[]) {
  if (activeButton === button && popover.matches(':popover-open')) {
    closePopover();
    return;
  }
  closePopover();
  activeButton?.setAttribute('aria-expanded', 'false');
  activeButton = button;
  find('popover-room').textContent = room;
  const content = find('popover-content');
  content.replaceChildren();
  for (const booking of bookings) {
    const item = element('div', 'booking-detail');
    item.append(element('p', 'booking-time', bookingTime(booking)));
    item.append(element('p', 'booking-title', booking.title));
    content.append(item);
  }
  popover.showPopover();
  button.setAttribute('aria-expanded', 'true');
  const anchor = button.getBoundingClientRect();
  const box = popover.getBoundingClientRect();
  const left = Math.max(12, Math.min(anchor.left + anchor.width / 2 - box.width / 2, innerWidth - box.width - 12));
  const top = anchor.bottom + box.height + 12 < innerHeight
    ? anchor.bottom + 8 : Math.max(12, anchor.top - box.height - 8);
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
}

function addSegment(lane: HTMLElement, segment: Segment, room: Extract<RoomSchedule, { status: 'ok' }>) {
  const booked = segment.state === 'booked';
  const bookings = room.bookings.filter(b => b.start < segment.end && b.end > segment.start);
  const closed = booked && bookings.every(b => b.kind === 'closed');
  const label = booked ? (closed ? 'Closed' : 'Booked') : 'Unbooked';
  const node = booked ? element('button', 'segment booked') : element('span', 'segment unbooked');
  node.style.left = `${(segment.start - START) / (END - START) * 100}%`;
  node.style.width = `${(segment.end - segment.start) / (END - START) * 100}%`;
  node.setAttribute('aria-label', `${room.label}, ${formatTime(segment.start)}–${formatTime(segment.end)}, ${label.toLowerCase()}`);
  if (node instanceof HTMLButtonElement) {
    node.type = 'button';
    node.setAttribute('aria-expanded', 'false');
    node.setAttribute('aria-controls', 'booking-popover');
    node.addEventListener('click', () => showBookings(node, room.label, bookings));
  } else {
    node.setAttribute('role', 'img');
  }
  lane.append(node);
}

function render(schedules?: RoomSchedule[]) {
  closePopover();
  rows.replaceChildren();
  ROOMS.forEach((room, index) => {
    const schedule = schedules?.[index];
    const row = element('tr');
    const label = element('th', 'room-label');
    label.scope = 'row';
    label.setAttribute('aria-label', room.label);
    const [name, alias] = room.label.split(' · ');
    label.append(element('span', 'room-name', name));
    const meta = element('span', 'room-meta');
    if (alias) meta.append(element('span', 'room-alias', `· ${alias}`));
    if (schedule?.status === 'ok') {
      const allDay = schedule.segments.every(segment => segment.state === 'unbooked');
      const candidate = schedule.segments.some(segment =>
        segment.state === 'unbooked' && segment.start <= 9 * 60 && segment.end >= 17 * 60);
      if (allDay || candidate) {
        const text = allDay ? 'All day' : 'Candidate';
        const hours = allDay ? '08:00–20:00' : '09:00–17:00';
        const badge = element('span', `availability-badge ${allDay ? 'all-day' : 'candidate'}`, text);
        badge.title = `No scheduled bookings from ${hours}`;
        meta.append(badge);
        label.setAttribute('aria-label', `${room.label}, ${text.toLowerCase()}, unbooked ${hours}`);
      }
    }
    if (meta.childElementCount) label.append(meta);
    const cell = element('td');
    const track = element('div', 'row-track');
    const lane = element('div', 'lane');
    if (schedule?.status === 'ok') {
      row.dataset.state = 'ok';
      for (const segment of schedule.segments) addSegment(lane, segment, schedule);
    } else {
      row.dataset.state = schedule ? 'unavailable' : 'loading';
      lane.classList.add('neutral');
      lane.append(element('span', 'neutral-label', schedule ? 'Schedule unavailable' : 'Loading schedule…'));
    }
    track.append(lane, nowLine());
    cell.append(track);
    row.append(label, cell);
    rows.append(row);
  });
  updateClock();
}

function setDate(date: string) {
  displayedDate = date;
  const [year, month, day] = date.split('-').map(Number);
  const label = dateFormat.format(new Date(Date.UTC(year, month - 1, day)));
  find('today-date').textContent = label;
  table.caption!.textContent = `Room schedules for ${label}, from 08:00 to 20:00, Europe/Zurich. Activate a booked segment for details.`;
}

function updateClock() {
  const { date, minutes } = zurichTime();
  if (date !== currentDate) {
    const followingToday = displayedDate === currentDate;
    currentDate = date;
    if (followingToday) void load(date);
  }
  const visible = displayedDate === date && minutes >= START && minutes < END;
  table.style.setProperty('--now-position', `${(minutes - START) / (END - START) * 100}%`);
  document.querySelectorAll<HTMLElement>('.now-line').forEach(line => { line.hidden = !visible; });
  nowLabel.hidden = !visible;
  nowLabel.textContent = formatTime(minutes);
}

async function load(date = displayedDate) {
  if (pending && requestDate === date) return;
  pending?.abort();
  const controller = new AbortController();
  pending = controller;
  requestDate = date;
  setDate(date);
  render();
  updated.textContent = 'Not updated yet';
  status.textContent = 'Loading schedules…';
  updated.removeAttribute('title');
  table.setAttribute('aria-busy', 'true');
  try {
    const url = date === zurichTime().date ? '/api/today' : `/api/today?date=${date}`;
    const response = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(API_TIMEOUT_MS)]),
    });
    if (response.status !== 200 || !/^application\/json\b/i.test(response.headers.get('Content-Type') ?? '')) {
      throw new Error('Schedule request failed');
    }
    const data = parseToday(await response.json(), date);
    if (controller.signal.aborted || date !== displayedDate) return;
    render(data.rooms);
    const successful = data.rooms.filter(room => room.status === 'ok');
    const failures = ROOMS.length - successful.length;
    const outsideCoverage = data.coverage.status === 'ok' &&
      (date < data.coverage.minDate || date > data.coverage.maxDate);
    status.textContent = outsideCoverage
      ? 'ETH has not published schedules for this date.'
      : failures === 0 ? '' : failures === ROOMS.length
      ? 'Schedules unavailable. Please reload later.'
      : `${failures} ${failures === 1 ? 'schedule' : 'schedules'} unavailable.`;
    const oldest = successful.map(room => room.fetchedAt).sort()[0];
    if (oldest) {
      updated.textContent = `Updated ${updatedFormat.format(new Date(oldest))}`;
      updated.title = `Oldest successful room fetch: ${oldest}. Times shown in Zurich.`;
    }
  } catch {
    if (controller.signal.aborted) return;
    render(ROOMS.map(room => ({ ...room, status: 'unavailable', fetchedAt: null, reason: 'upstream' })));
    status.textContent = 'Schedules unavailable. Please reload later.';
  } finally {
    if (pending === controller) {
      pending = undefined;
      table.setAttribute('aria-busy', 'false');
      updateClock();
    }
  }
}

function changeDay(offset: number) {
  const date = new Date(`${displayedDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  void load(date.toISOString().slice(0, 10));
}
find('previous-day').addEventListener('click', () => changeDay(-1));
find('next-day').addEventListener('click', () => changeDay(1));

document.addEventListener('visibilitychange', () => { if (!document.hidden) updateClock(); });
window.addEventListener('focus', updateClock);
window.addEventListener('pageshow', updateClock);
setDate(zurichTime().date);
void load();
setInterval(updateClock, 60_000);

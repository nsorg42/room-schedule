import { expect, test } from '@playwright/test';
import { ROOMS } from '../../shared/config.ts';
import { normalizeSchedule } from '../../worker/schedule.ts';
import { allocation, DATE, NOW, todayFixture } from '../fixtures.ts';

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: NOW });
});

test('shows all configured rows in order with one perfectly aligned axis and now indicator', async ({ page }, info) => {
  await page.route('**/api/today', route => route.fulfill({ json: todayFixture() }));
  await page.goto('/');
  await expect(page.locator('tr[data-state="ok"]')).toHaveCount(ROOMS.length);
  await expect(page.locator('#today-date')).toHaveText('Wednesday, 18 November 2026');
  await expect(page.getByRole('heading', { name: 'Study Rooms', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh schedules' })).toHaveCount(0);
  await expect(page.locator('.page-footer')).toHaveCount(0);
  expect((await page.locator('.segment').allTextContents()).every(text => text === '')).toBe(true);
  const names = await page.locator('.room-name').allTextContents();
  expect(names).toEqual(ROOMS.map(room => room.label));
  const geometry = await page.evaluate(() => ({
    tracks: Array.from(document.querySelectorAll('.row-track, .time-axis')).map(el => {
      const rect = el.getBoundingClientRect();
      return { left: rect.left, width: rect.width };
    }),
    now: Array.from(document.querySelectorAll('.now-line')).map(el => el.getBoundingClientRect().left),
    pageWidth: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }));
  for (const track of geometry.tracks) {
    expect(track.left).toBeCloseTo(geometry.tracks[0].left, 1);
    expect(track.width).toBeCloseTo(geometry.tracks[0].width, 1);
  }
  for (const x of geometry.now) expect(x).toBeCloseTo(geometry.now[0], 1);
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewport);
  await expect(page.locator('.now-label')).toHaveText('10:30');
  await page.screenshot({ path: `artifacts/${info.project.name}.png`, fullPage: true });
});

test('fits the whole day without horizontal scrolling and keeps the desktop header sticky', async ({ page }, info) => {
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 600 });
  await page.route('**/api/today', route => route.fulfill({ json: todayFixture() }));
  await page.goto('/');
  await expect(page.locator('tr[data-state="ok"]')).toHaveCount(ROOMS.length);
  const label = page.locator('.room-label').first();
  const labelBefore = await label.boundingBox();
  const headerBefore = await page.locator('.corner').boundingBox();
  const axisBefore = await page.locator('.time-axis').boundingBox();
  const scroll = await page.locator('#board-scroll').evaluate(el => {
    el.scrollLeft = 350;
    el.scrollTop = 100;
    return { x: el.scrollLeft, y: el.scrollTop, width: el.clientWidth, content: el.scrollWidth };
  });
  const labelAfter = await label.boundingBox();
  const headerAfter = await page.locator('.corner').boundingBox();
  const axisAfter = await page.locator('.time-axis').boundingBox();
  expect(labelAfter!.x).toBeCloseTo(labelBefore!.x, 1);
  expect(headerAfter!.x).toBeCloseTo(headerBefore!.x, 1);
  expect(headerAfter!.y).toBeCloseTo(headerBefore!.y, 1);
  expect(axisAfter!.x).toBeCloseTo(axisBefore!.x - scroll.x, 1);
  const track = await page.locator('.row-track').first().boundingBox();
  expect(track!.x).toBeCloseTo(axisAfter!.x, 1);
  expect(scroll.x).toBe(0);
  expect(scroll.content).toBe(scroll.width);
  const first = await page.locator('.hour.first').boundingBox();
  const last = await page.locator('.hour.last').boundingBox();
  const board = await page.locator('#board-scroll').boundingBox();
  expect(first!.x).toBeGreaterThan(board!.x);
  expect(last!.x + last!.width).toBeLessThan(board!.x + board!.width);
  if (info.project.name === 'mobile') {
    expect(scroll.y).toBe(0);
    await expect(page.locator('.hour:visible')).toHaveCount(4);
  } else {
    expect(scroll.y).toBeGreaterThan(0);
    expect(board!.width).toBeGreaterThan(page.viewportSize()!.width * 0.9);
  }
});

test('opens exact booking details by touch or keyboard and renders titles as text', async ({ page }, info) => {
  const data = todayFixture();
  if (data.rooms[0].status === 'ok') data.rooms[0].bookings[0].title = '<img src=x onerror="alert(1)"> Design';
  await page.route('**/api/today', route => route.fulfill({ json: data }));
  await page.goto('/');
  const button = page.locator('#room-rows tr').first().getByRole('button');
  await expect(button).toBeVisible();
  if (info.project.name === 'mobile') {
    await button.tap();
  } else {
    await button.focus();
    await page.keyboard.press('Enter');
  }
  const popover = page.getByRole('region', { name: 'Booking details', exact: true });
  await expect(popover).toBeVisible();
  await expect(popover).toContainText('14:00–17:00');
  await expect(popover).toContainText('<img src=x onerror="alert(1)"> Design');
  await expect(popover.locator('img')).toHaveCount(0);
  const box = await popover.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.keyboard.press('Escape');
  await expect(popover).not.toBeVisible();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
});

test('moves now locally once a minute without requesting schedules', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/today', route => { requests++; return route.fulfill({ json: todayFixture() }); });
  await page.goto('/');
  await expect(page.locator('tr[data-state="ok"]')).toHaveCount(ROOMS.length);
  const before = await page.locator('.now-line').first().boundingBox();
  await page.clock.fastForward(60_000);
  await expect(page.locator('.now-label')).toHaveText('10:31');
  const after = await page.locator('.now-line').first().boundingBox();
  expect(after!.x).toBeGreaterThan(before!.x);
  expect(requests).toBe(1);
});

test('hides now outside the study window', async ({ page }) => {
  await page.clock.setSystemTime(new Date('2026-11-18T06:30:00Z'));
  await page.route('**/api/today', route => route.fulfill({ json: todayFixture() }));
  await page.goto('/');
  await expect(page.locator('tr[data-state="ok"]')).toHaveCount(ROOMS.length);
  await expect(page.locator('.now-line:visible')).toHaveCount(0);
  await page.clock.setSystemTime(new Date('2026-11-18T19:00:00Z'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.now-line:visible')).toHaveCount(0);
});

test('renders a failed page reload as gray, never as previously green availability', async ({ page }) => {
  let failed = false;
  await page.route('**/api/today', route => failed ? route.fulfill({ status: 204 }) : route.fulfill({ json: todayFixture() }));
  await page.goto('/');
  await expect(page.locator('tr[data-state="ok"]')).toHaveCount(ROOMS.length);
  failed = true;
  await page.reload();
  await expect(page.locator('tr[data-state="unavailable"]')).toHaveCount(ROOMS.length);
  await expect(page.locator('#room-rows .unbooked')).toHaveCount(0);
  await expect(page.getByText('Schedule unavailable', { exact: true })).toHaveCount(ROOMS.length);
  await expect(page.locator('.all-day')).toHaveCount(0);
});

test('preserves individual failures and the upstream timestamp on a cache hit', async ({ page }) => {
  const data = todayFixture();
  data.rooms[2] = { ...ROOMS[2], status: 'unavailable', fetchedAt: null, reason: 'upstream' };
  await page.route('**/api/today', route => route.fulfill({ json: data }));
  await page.goto('/');
  await expect(page.locator('tr[data-state="ok"]')).toHaveCount(ROOMS.length - 1);
  await expect(page.locator('tr[data-state="unavailable"]')).toHaveCount(1);
  const timestamp = await page.locator('#updated').textContent();
  await page.clock.fastForward(120_000);
  await page.reload();
  await expect(page.locator('#updated')).toHaveText(timestamp!);
});

test('marks only validated rooms that are unbooked for the whole visible day', async ({ page }) => {
  const data = todayFixture();
  data.rooms[2] = { ...ROOMS[2], status: 'unavailable', fetchedAt: null, reason: 'upstream' };
  await page.route('**/api/today', route => route.fulfill({ json: data }));
  await page.goto('/');
  await expect(page.locator('.all-day')).toHaveCount(1);
  await expect(page.locator('#room-rows tr').nth(1).locator('.all-day')).toHaveText('All day');
  await expect(page.locator('tr[data-state="unavailable"] .all-day')).toHaveCount(0);
});

test('marks 09:00–17:00 candidates, respects boundaries, and keeps All day preferred', async ({ page }, info) => {
  const data = todayFixture();
  const schedules = [
    [0, [allocation('08:00', '09:00', null), allocation('17:00', '20:00')]],
    [2, [allocation('08:00', '09:01')]],
    [3, [allocation('16:59', '18:00')]],
    [4, [allocation('12:00', '12:30', null)]],
    [5, [allocation('17:00', '18:00')]],
  ] as const;
  for (const [index, bookings] of schedules) {
    data.rooms[index] = {
      ...ROOMS[index], status: 'ok', fetchedAt: NOW.toISOString(),
      ...normalizeSchedule(bookings, DATE),
    };
  }
  data.rooms[6] = { ...ROOMS[6], status: 'unavailable', fetchedAt: null, reason: 'upstream' };
  await page.route('**/api/today', route => route.fulfill({ json: data }));
  await page.goto('/');
  await expect(page.locator('.candidate')).toHaveCount(2);
  const rows = page.locator('#room-rows tr');
  for (const index of [0, 5]) await expect(rows.nth(index).locator('.candidate')).toHaveText('Candidate');
  for (const index of [1, 2, 3, 4, 6, 7]) await expect(rows.nth(index).locator('.candidate')).toHaveCount(0);
  await expect(rows.nth(1).locator('.all-day')).toHaveText('All day');
  await expect(rows.nth(0).locator('.candidate')).toHaveAttribute('title', 'No scheduled bookings from 09:00–17:00');
  const badge = await rows.nth(0).locator('.candidate').boundingBox();
  const label = await rows.nth(0).locator('.room-label').boundingBox();
  expect(badge!.x + badge!.width).toBeLessThan(label!.x + label!.width);
  await page.screenshot({ path: `artifacts/${info.project.name}-candidates.png`, fullPage: true });
});

test('stays dark regardless of device settings or an old saved theme', async ({ page }, info) => {
  const data = todayFixture();
  data.rooms[2] = { ...ROOMS[2], status: 'unavailable', fetchedAt: null, reason: 'upstream' };
  await page.route('**/api/today', route => route.fulfill({ json: data }));
  await page.addInitScript(() => localStorage.setItem('theme', 'light'));
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await expect(page.locator('tr[data-state="ok"]')).toHaveCount(ROOMS.length - 1);
  await expect(page.locator('#theme-toggle')).toHaveCount(0);
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(23, 28, 25)');
  await expect(page.locator('.legend')).toHaveText('Free Booked');
  const colors = () => page.evaluate(() => ['html', '.board-scroll', '.segment.unbooked', '.segment.booked', '.neutral', '.booking-popover']
    .map(selector => getComputedStyle(document.querySelector(selector)!).backgroundColor));
  const before = await colors();
  await page.emulateMedia({ colorScheme: 'dark' });
  expect(await colors()).toEqual(before);
  await page.screenshot({ path: `artifacts/${info.project.name}-dark.png`, fullPage: true });
  await page.locator('#room-rows tr').first().getByRole('button').click();
  await expect(page.getByRole('region', { name: 'Booking details', exact: true })).toBeVisible();
});

test('fetches the new Zurich day across midnight', async ({ page }) => {
  let requests = 0;
  await page.clock.setSystemTime(new Date('2026-11-18T22:59:30Z'));
  await page.route('**/api/today', route => {
    requests++;
    return route.fulfill({ json: todayFixture(requests === 1 ? '2026-11-18' : '2026-11-19') });
  });
  await page.goto('/');
  await expect(page.locator('tr[data-state="ok"]')).toHaveCount(ROOMS.length);
  await page.clock.fastForward(60_000);
  await expect(page.locator('#today-date')).toHaveText('Thursday, 19 November 2026');
  await expect(page.locator('tr[data-state="ok"]')).toHaveCount(ROOMS.length);
  expect(requests).toBe(2);
});

test('fetches the new date when the browser resumes after an overnight suspension', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/today', route => {
    requests++;
    return route.fulfill({ json: todayFixture(requests === 1 ? '2026-11-18' : '2026-11-19') });
  });
  await page.goto('/');
  await expect(page.locator('tr[data-state="ok"]')).toHaveCount(ROOMS.length);
  await page.clock.setSystemTime(new Date('2026-11-19T08:00:00Z'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('#today-date')).toHaveText('Thursday, 19 November 2026');
  await expect(page.locator('tr[data-state="ok"]')).toHaveCount(ROOMS.length);
  expect(requests).toBe(2);
});


test('browses dates, hides now for other days, and explains unpublished schedules', async ({ page }) => {
  await page.route('**/api/today*', route => {
    const date = new URL(route.request().url()).searchParams.get('date') ?? DATE;
    const data = todayFixture(date);
    if (date === '2026-11-20' && data.coverage.status === 'ok') data.coverage.maxDate = '2026-11-19';
    return route.fulfill({ json: data });
  });
  await page.goto('/');
  await expect(page.locator('tr[data-state="ok"]')).toHaveCount(ROOMS.length);
  await page.getByRole('button', { name: 'Next day', exact: true }).click();
  await expect(page.locator('#today-date')).toHaveText('Thursday, 19 November 2026');
  await expect(page.locator('tr[data-state="ok"]')).toHaveCount(ROOMS.length);
  await expect(page.locator('.now-line:visible')).toHaveCount(0);
  await page.clock.fastForward(60_000);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('#today-date')).toHaveText('Thursday, 19 November 2026');
  await page.getByRole('button', { name: 'Next day', exact: true }).click();
  await expect(page.locator('#load-status')).toHaveText('ETH has not published schedules for this date.');
  await expect(page.locator('tr[data-state="unavailable"]')).toHaveCount(ROOMS.length);
  await page.getByRole('button', { name: 'Previous day', exact: true }).click();
  await expect(page.locator('tr[data-state="ok"]')).toHaveCount(ROOMS.length);
  await page.getByRole('button', { name: 'Previous day', exact: true }).click();
  await expect(page.locator('#today-date')).toHaveText('Wednesday, 18 November 2026');
  await expect(page.locator('.now-label')).toBeVisible();
});

test('coalesces fast date clicks and waits for the active request without showing its stale result', async ({ page }) => {
  const requests: string[] = [];
  let release: () => void = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/today*', async route => {
    const date = new URL(route.request().url()).searchParams.get('date') ?? DATE;
    requests.push(date);
    if (date === '2026-11-19') await held;
    await route.fulfill({ json: todayFixture(date) });
  });
  await page.goto('/');
  await expect(page.locator('tr[data-state="ok"]')).toHaveCount(ROOMS.length);
  await page.clock.pauseAt(new Date(NOW.getTime() + 60_000));
  const next = page.getByRole('button', { name: 'Next day', exact: true });
  await next.click();
  await page.clock.fastForward(250);
  await expect.poll(() => requests).toEqual([DATE, '2026-11-19']);
  await next.click();
  await next.click();
  await page.getByRole('button', { name: 'Previous day', exact: true }).click();
  await page.clock.fastForward(500);
  expect(requests).toEqual([DATE, '2026-11-19']);
  await expect(page.locator('#today-date')).toHaveText('Friday, 20 November 2026');
  release();
  await expect(page.locator('tr[data-state="ok"]')).toHaveCount(0);
  // Let the held response finish and the queued request's debounce elapse.
  await expect.poll(async () => {
    await page.clock.fastForward(250);
    return requests;
  }).toEqual([DATE, '2026-11-19', '2026-11-20']);
  await expect(page.locator('tr[data-state="ok"]')).toHaveCount(ROOMS.length);
  await expect(page.locator('#today-date')).toHaveText('Friday, 20 November 2026');
});

test('debounces rapid date clicks before starting a request', async ({ page }) => {
  const requests: string[] = [];
  await page.route('**/api/today*', route => {
    const date = new URL(route.request().url()).searchParams.get('date') ?? DATE;
    requests.push(date);
    return route.fulfill({ json: todayFixture(date) });
  });
  await page.goto('/');
  await expect(page.locator('tr[data-state="ok"]')).toHaveCount(ROOMS.length);
  await page.clock.pauseAt(new Date(NOW.getTime() + 60_000));
  const next = page.getByRole('button', { name: 'Next day', exact: true });
  await next.click();
  await next.click();
  await next.click();
  expect(requests).toEqual([DATE]);
  await page.clock.fastForward(250);
  await expect(page.locator('tr[data-state="ok"]')).toHaveCount(ROOMS.length);
  expect(requests).toEqual([DATE, '2026-11-21']);
});

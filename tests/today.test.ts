import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROOMS } from '../shared/config.ts';
import worker from '../worker/index.ts';
import { getToday } from '../worker/today.ts';
import { allocation, DATE, LIMITS, NOW } from './fixtures.ts';

function memoryCache() {
  const entries = new Map<string, Response>();
  return {
    async match(request: RequestInfo | URL) { return entries.get(String(request instanceof Request ? request.url : request))?.clone(); },
    async put(request: RequestInfo | URL, response: Response) {
      entries.set(String(request instanceof Request ? request.url : request), response.clone());
    },
  };
}

function harness(respond?: (path: string, request: Request) => Response | Promise<Response>) {
  let instant = NOW;
  const requests: Request[] = [];
  const background: Promise<unknown>[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const request = input as Request;
    requests.push(request);
    const path = new URL(request.url).searchParams.get('path')!;
    return respond ? respond(path, request) : Response.json(path === '/min-max-allocation-date' ? LIMITS : []);
  }) as unknown as typeof fetch;
  const options = {
    origin: 'https://rooms.example', cache: memoryCache(), fetcher,
    now: () => instant, waitUntil: (task: Promise<unknown>) => { background.push(task); },
  };
  return {
    options, requests,
    advance(ms: number) { instant = new Date(instant.getTime() + ms); },
    async run() { const result = await getToday(options); await Promise.all(background); return result; },
  };
}

beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('requests only the fixed unversioned routes, using the Zurich date and fresh headers', async () => {
  const h = harness();
  const data = await h.run();
  expect(data.rooms.map(room => room.name)).toEqual(ROOMS.map(room => room.name));
  expect(h.requests).toHaveLength(9);
  for (const request of h.requests) {
    const url = new URL(request.url);
    expect(url.origin + url.pathname).toBe('https://ethz.ch/bin/ethz/roominfo');
    expect(request.headers.get('User-Agent')).toBe('Mozilla/5.0');
    expect(request.headers.get('Accept')).toBe('application/json');
    expect(request.headers.has('Origin')).toBe(false);
    expect(request.headers.has('Cookie')).toBe(false);
    expect(request.redirect).toBe('manual');
    if (url.searchParams.get('path') !== '/min-max-allocation-date') {
      expect(url.searchParams.get('from')).toBe(DATE);
      expect(url.searchParams.get('to')).toBe(DATE);
    }
  }
  expect(h.requests.map(request => new URL(request.url).searchParams.get('path')))
    .toEqual(['/min-max-allocation-date', ...ROOMS.map(room => `/rooms/${room.name}/allocations`)]);
});

it('loads Vis Dome without any catalogue or room-group lookup', async () => {
  const h = harness(path => Response.json(path === '/min-max-allocation-date' ? LIMITS
    : path === '/rooms/HG K 30.1/allocations' ? [allocation('14:00', '17:00', 'Design')] : []));
  const data = await h.run();
  expect(data.rooms[0]).toMatchObject({ status: 'ok', bookings: [{ title: 'Design', start: 840, end: 1020 }] });
  expect(h.requests.every(request => !/roomgroup|\/v2|114/.test(request.url))).toBe(true);
});

it('limits upstream concurrency to two while keeping configured row order', async () => {
  let active = 0;
  let maximum = 0;
  const h = harness(async path => {
    active++;
    maximum = Math.max(active, maximum);
    await new Promise(resolve => setTimeout(resolve, path.includes('D 11') ? 12 : 2));
    active--;
    return Response.json(path === '/min-max-allocation-date' ? LIMITS : []);
  });
  expect((await h.run()).rooms.map(room => room.name)).toEqual(ROOMS.map(room => room.name));
  expect(maximum).toBe(2);
});

it('caches successful rooms for five minutes and preserves their real fetch timestamps', async () => {
  const h = harness();
  const first = await h.run();
  h.advance(120_000);
  expect(await h.run()).toEqual(first);
  expect(h.requests).toHaveLength(9);
  h.advance(181_000);
  const refreshed = await h.run();
  expect(h.requests).toHaveLength(17);
  expect(refreshed.coverage).toEqual(first.coverage);
  expect(refreshed.rooms[0].fetchedAt).not.toBe(first.rooms[0].fetchedAt);
});

it('refreshes publication limits after six hours', async () => {
  const h = harness();
  await h.run();
  h.advance(6 * 60 * 60 * 1000 + 1);
  await h.run();
  expect(h.requests.filter(request => new URL(request.url).searchParams.get('path') === '/min-max-allocation-date')).toHaveLength(2);
});

it('never falls back to an expired green schedule when a later upstream request fails', async () => {
  let failed = false;
  const h = harness(path => path === '/min-max-allocation-date' ? Response.json(LIMITS)
    : failed && path === '/rooms/HG D 12/allocations' ? new Response(null, { status: 503 }) : Response.json([]));
  expect((await h.run()).rooms[2].status).toBe('ok');
  failed = true;
  h.advance(301_000);
  const result = await h.run();
  expect(result.rooms[2].status).toBe('unavailable');
  expect(result.rooms[2]).not.toHaveProperty('segments');
});

describe('unavailable data', () => {
  const failures = [
    ['HTTP 204', () => new Response(null, { status: 204 })],
    ['redirect', () => new Response(null, { status: 302, headers: { Location: 'https://example.com' } })],
    ['HTML with HTTP 200', () => new Response('<html>Error</html>', { headers: { 'Content-Type': 'text/html' } })],
    ['malformed JSON', () => new Response('[broken', { headers: { 'Content-Type': 'application/json' } })],
    ['wrong schema', () => Response.json({ error: 'No schedule' })],
    ['invalid records', () => Response.json([{}])],
    ['upstream error', () => new Response('Unavailable', { status: 503 })],
    ['network error', () => { throw new Error('Network error'); }],
  ] as const;

  it.each(failures)('never turns %s into a green row and preserves other rooms', async (_, fail) => {
    const h = harness(path => path === '/min-max-allocation-date' ? Response.json(LIMITS)
      : path === '/rooms/HG D 12/allocations' ? fail() : Response.json([]));
    const data = await h.run();
    expect(data.rooms[2]).toMatchObject({ status: 'unavailable', fetchedAt: null });
    expect(data.rooms[2]).not.toHaveProperty('segments');
    expect(data.rooms.filter(room => room.status === 'ok')).toHaveLength(7);
    await h.run();
    expect(h.requests).toHaveLength(10); // Retry the failed room only on the next explicit load.
  });

  it('times out a stalled room without losing the other seven', async () => {
    const h = harness((path, request) => {
      if (path === '/min-max-allocation-date') return Response.json(LIMITS);
      if (path !== '/rooms/HG D 12/allocations') return Response.json([]);
      return new Promise((_, reject) => request.signal.addEventListener('abort', () => reject(new Error('Aborted'))));
    });
    const data = await getToday({ ...h.options, timeoutMs: 5 });
    expect(data.rooms[2].status).toBe('unavailable');
    expect(data.rooms.filter(room => room.status === 'ok')).toHaveLength(7);
  });

  it.each([{}, { minDateLoad: '2026-11-19', maxDateLoad: '2027-02-21' },
    { minDateLoad: '2026-01-01', maxDateLoad: '2026-11-17' }])
  ('requires established publication coverage before treating any room as unbooked', async limits => {
    const h = harness(() => Response.json(limits));
    const data = await h.run();
    expect(data.rooms.every(room => room.status === 'unavailable')).toBe(true);
    expect(h.requests).toHaveLength(1);
  });

  it('does not serve yesterday from a still-warm cache after Zurich midnight', async () => {
    const h = harness();
    await h.run();
    h.advance(24 * 60 * 60 * 1000);
    expect((await h.run()).date).toBe('2026-11-19');
    expect(new URL(h.requests.at(-1)!.url).searchParams.get('from')).toBe('2026-11-19');
  });
});

it('exposes a GET endpoint, rejects proxy routes, and never forwards visitor headers', async () => {
  const h = harness();
  vi.stubGlobal('caches', { default: h.options.cache });
  vi.stubGlobal('fetch', h.options.fetcher);
  const assets = { fetch: vi.fn(async () => new Response('asset')) };
  const context = { waitUntil: h.options.waitUntil };
  expect((await worker.fetch(new Request('https://rooms.example/api/today', { method: 'POST' }), { ASSETS: assets }, context)).status).toBe(405);
  expect((await worker.fetch(new Request('https://rooms.example/api/proxy?url=https://example.com'), { ASSETS: assets }, context)).status).toBe(404);
  const response = await worker.fetch(new Request('https://rooms.example/api/today?path=/v2/rooms', {
    headers: { Origin: 'https://visitor.example', Cookie: 'secret=visitor', Authorization: 'Bearer visitor' },
  }), { ASSETS: assets }, context);
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(h.requests.every(request => !request.headers.has('Authorization') && !request.headers.has('Origin') && !request.headers.has('Cookie'))).toBe(true);
});

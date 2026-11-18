import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UPSTREAM_RETRY_DELAY_MS } from '../shared/config.ts';
import { createEthClient } from '../worker/eth.ts';
import { DATE, LIMITS, NOW } from './fixtures.ts';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => vi.useRealTimers());

const failures = [
  ['server error', () => new Response(null, { status: 503 })],
  ['empty response', () => new Response(null, { status: 204 })],
  ['HTML', () => new Response('<html>Error</html>')],
  ['malformed JSON', () => new Response('[broken', { headers: { 'Content-Type': 'application/json' } })],
  ['invalid schedule', () => Response.json([{}])],
  ['network error', () => { throw new Error('Connection reset'); }],
] as const;

it.each(failures)('waits before retrying a %s and validates the recovered schedule', async (_, fail) => {
  const fetcher = vi.fn().mockImplementationOnce(fail).mockResolvedValueOnce(Response.json([]));
  const result = createEthClient(fetcher).room('HG D 11', DATE);
  await vi.advanceTimersByTimeAsync(UPSTREAM_RETRY_DELAY_MS - 1);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(await result).toEqual({ bookings: [], segments: [{ start: 480, end: 1200, state: 'unbooked' }] });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('stops after one retry when the response stays invalid', async () => {
  const fetcher = vi.fn(async () => Response.json({ error: 'Invalid schedule' }));
  const result = expect(createEthClient(fetcher).room('HG D 11', DATE)).rejects.toThrow();
  await vi.runAllTimersAsync();
  await result;
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('retries a timed-out request with a fresh abort signal', async () => {
  const signals: AbortSignal[] = [];
  const fetcher = vi.fn(async (request: Request) => {
    signals.push(request.signal);
    if (signals.length === 2) return Response.json([]);
    return new Promise<Response>((_, reject) => {
      request.signal.addEventListener('abort', () => reject(new Error('Aborted')));
    });
  }) as unknown as typeof fetch;
  const result = createEthClient(fetcher, 20).room('HG D 11', DATE);
  await vi.runAllTimersAsync();
  await result;
  expect(signals).toHaveLength(2);
  expect(signals[0].aborted).toBe(true);
  expect(signals[1].aborted).toBe(false);
});

it.each(['2', new Date(NOW.getTime() + 2000).toUTCString()])('honors Retry-After: %s', async retryAfter => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': retryAfter } }))
    .mockResolvedValueOnce(Response.json([]));
  const result = createEthClient(fetcher).room('HG D 11', DATE);
  await vi.advanceTimersByTimeAsync(1999);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  await result;
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it.each([
  [404, {}],
  [429, { 'Retry-After': '60' }],
])('does not retry permanent failures or long rate limits (%s)', async (status, headers) => {
  const fetcher = vi.fn(async () => new Response(null, { status, headers }));
  const result = expect(createEthClient(fetcher).room('HG D 11', DATE)).rejects.toThrow();
  await vi.runAllTimersAsync();
  await result;
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('also retries invalid publication limits', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({})).mockResolvedValueOnce(Response.json(LIMITS));
  const result = createEthClient(fetcher).limits();
  await vi.runAllTimersAsync();
  expect(await result).toEqual({ minDate: LIMITS.minDateLoad, maxDate: LIMITS.maxDateLoad });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

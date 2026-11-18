import { MAX_RETRY_DELAY_MS, ROOMS, UPSTREAM_RETRY_DELAY_MS, UPSTREAM_TIMEOUT_MS } from '../shared/config.ts';
import { normalizeSchedule, parseLimits } from './schedule.ts';

export const ETH_ENDPOINT = 'https://ethz.ch/bin/ethz/roominfo';

class UpstreamError extends Error {
  readonly retryDelay: number;

  constructor(message: string, retryDelay: number) {
    super(message);
    this.retryDelay = retryDelay;
  }
}

export function createEthClient(fetcher: typeof fetch = fetch, timeoutMs = UPSTREAM_TIMEOUT_MS) {
  async function retry<T>(load: () => Promise<T>): Promise<T> {
    try {
      return await load();
    } catch (error) {
      const delay = error instanceof UpstreamError ? error.retryDelay : UPSTREAM_RETRY_DELAY_MS;
      // Never retry early if ETH asks us to wait longer than this request can allow.
      if (delay > MAX_RETRY_DELAY_MS) throw error;
      await new Promise(resolve => setTimeout(resolve, delay));
      return load();
    }
  }

  async function json(path: string, date?: string): Promise<unknown> {
    const url = new URL(ETH_ENDPOINT);
    url.search = new URLSearchParams({ path, ...(date ? { from: date, to: date } : {}) }).toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(new Request(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
        signal: controller.signal,
        redirect: 'manual',
      }));
      if (response.status !== 200 ||
          !/^application\/json\b/i.test(response.headers.get('Content-Type') ?? '')) {
        const retryable = response.status < 400 || response.status === 408 ||
          response.status === 429 || response.status >= 500;
        const retryAfter = response.headers.get('Retry-After');
        const requestedDelay = retryAfter === null ? 0 : /^\d+$/.test(retryAfter)
          ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
        const delay = Math.max(UPSTREAM_RETRY_DELAY_MS, Number.isNaN(requestedDelay) ? 0 : requestedDelay);
        await response.body?.cancel();
        throw new UpstreamError(`ETH returned ${response.status}`, retryable ? delay : Infinity);
      }
      // Bound parsing work and memory on the free Worker; normal day responses are a few KB.
      if (Number(response.headers.get('Content-Length')) > 512_000) throw new Error('Response too large');
      const body = await response.text();
      if (body.length > 512_000) throw new Error('Response too large');
      return JSON.parse(body);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async limits() {
      return retry(async () => parseLimits(await json('/min-max-allocation-date')));
    },
    async room(name: string, date: string) {
      if (!ROOMS.some(room => room.name === name)) throw new Error('Unknown room');
      return retry(async () => normalizeSchedule(await json(`/rooms/${name}/allocations`, date), date));
    },
  };
}

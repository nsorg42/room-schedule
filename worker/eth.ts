import { ROOMS, UPSTREAM_TIMEOUT_MS } from '../shared/config.ts';
import { normalizeSchedule, parseLimits } from './schedule.ts';

export const ETH_ENDPOINT = 'https://ethz.ch/bin/ethz/roominfo';

export function createEthClient(fetcher: typeof fetch = fetch, timeoutMs = UPSTREAM_TIMEOUT_MS) {
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
        throw new Error(`ETH returned ${response.status} (${response.headers.get('Content-Type') ?? 'no content type'})`);
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
      return parseLimits(await json('/min-max-allocation-date'));
    },
    async room(name: string, date: string) {
      if (!ROOMS.some(room => room.name === name)) throw new Error('Unknown room');
      return normalizeSchedule(await json(`/rooms/${name}/allocations`, date), date);
    },
  };
}

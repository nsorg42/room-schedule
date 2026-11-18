import { getToday } from './today.ts';

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export default {
  async fetch(request: Request, env: Env, ctx: { waitUntil(task: Promise<unknown>): void }) {
    const url = new URL(request.url);
    if (url.pathname === '/api/today') {
      if (request.method !== 'GET') {
        return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } });
      }
      const data = await getToday({
        origin: url.origin,
        cache: (caches as CacheStorage & { default: Cache }).default,
        waitUntil: task => ctx.waitUntil(task),
      });
      return Response.json(data, {
        headers: {
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/__schedule-cache/')) {
      return new Response('Not found', { status: 404 });
    }
    return env.ASSETS.fetch(request);
  },
};

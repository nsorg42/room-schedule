import { ROOMS } from '../shared/config.ts';
import { zurichTime } from '../shared/time.ts';
import { createEthClient } from '../worker/eth.ts';
import type { TodayResponse } from '../shared/types.ts';

const origin = process.argv[2];
const date = zurichTime().date;
if (origin) {
  const response = await fetch(new URL('/api/today', origin), { signal: AbortSignal.timeout(35_000) });
  if (response.status !== 200 || !response.headers.get('Content-Type')?.includes('application/json')) {
    throw new Error(`Backend returned ${response.status} without usable JSON`);
  }
  const data = await response.json() as TodayResponse;
  if (data.date !== date || data.rooms.length !== ROOMS.length ||
      data.rooms.some((room, i) => room.name !== ROOMS[i].name || room.status !== 'ok')) {
    throw new Error('Not all eight schedules are available for today; inspect /api/today');
  }
  console.log(`Backend smoke test passed: ${date}, all eight rooms, ${origin}`);
  for (const room of data.rooms) console.log(`${room.name}: ${room.status}, fetched ${room.fetchedAt}`);
} else {
  const eth = createEthClient();
  const limits = await eth.limits();
  console.log(`Publication range: ${limits.minDate} to ${limits.maxDate}; Zurich today: ${date}`);
  if (date < limits.minDate || date > limits.maxDate) throw new Error('Today is outside publication coverage');
  let next = 0;
  let failed = false;
  async function consume() {
    while (next < ROOMS.length) {
      const room = ROOMS[next++];
      try {
        const schedule = await eth.room(room.name, date);
        console.log(`${room.name}: OK, ${schedule.bookings.length} visible bookings/closures`);
      } catch (error) {
        failed = true;
        console.error(`${room.name}: FAILED`, error);
      }
    }
  }
  await Promise.all([consume(), consume()]);
  if (failed) process.exitCode = 1;
}

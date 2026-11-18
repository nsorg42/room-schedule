# Study Rooms

Today's ETH Zürich room schedules from 08:00 to 20:00. Green means unbooked,
red means booked or closed, and gray means unavailable. An **All day** badge
marks rooms with no scheduled bookings throughout that window.

The full timetable fits on mobile, and dark mode follows your device setting.

## Run locally

Requires Node.js 22.12+ and npm.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. Reload the page to update schedules; successful
data is cached for five minutes. Stop the servers with Ctrl+C.

To preview the production build locally, run `npm run preview` and open
**http://127.0.0.1:8787**.

See [deploy.md](deploy.md) for Cloudflare deployment.

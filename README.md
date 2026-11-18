# Study Rooms

Shows the ETH Zürich room schedules from 08:00 to 20:00 for select rooms. Green means unbooked,
red means booked. The **All day** badge marks rooms with no scheduled bookings. **Candidate**
means that the room is free from 09:00 to 17:00. Dark mode follows your device setting.

The application is deployed at **https://rooms.eth-room-schedule.workers.dev/**

## Run locally

Requires Node.js 22.12+ and npm.

```sh
npm ci && npm run dev
```

Available at **http://127.0.0.1:5173**, reload the page to update the schedule.

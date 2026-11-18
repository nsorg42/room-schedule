export interface Interval {
  start: number;
  end: number;
}

export interface Booking extends Interval {
  from: string;
  to: string;
  title: string;
  kind: 'booking' | 'closed';
}

export interface Segment extends Interval {
  state: 'booked' | 'unbooked';
}

export type RoomSchedule = {
  name: string;
  label: string;
} & (
  | { status: 'ok'; fetchedAt: string; bookings: Booking[]; segments: Segment[] }
  | { status: 'unavailable'; fetchedAt: null; reason: 'coverage' | 'upstream' }
);

export interface Limits {
  minDate: string;
  maxDate: string;
}

export interface TodayResponse {
  date: string;
  timeZone: string;
  coverage: (Limits & { status: 'ok'; fetchedAt: string }) | { status: 'unavailable' };
  rooms: RoomSchedule[];
}

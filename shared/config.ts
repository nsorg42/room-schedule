export const ROOMS = [
  { name: 'HG K 30.1', label: 'Vis Dome' },
  { name: 'HG D 11', label: 'HG D 11' },
  { name: 'HG D 12', label: 'HG D 12' },
  { name: 'HG E 19', label: 'HG E 19' },
  { name: 'HG E 26.1', label: 'HG E 26.1' },
  { name: 'HG E 26.3', label: 'HG E 26.3' },
  { name: 'HG E 27', label: 'HG E 27' },
  { name: 'HG G 1', label: 'HG G 1' },
  { name: 'HG H 30.1', label: 'HG H 30.1' },
  { name: 'CAB H 56', label: 'CAB H 56' },
  { name: 'CAB H 57', label: 'CAB H 57' },
] as const;

export const TIME_ZONE = 'Europe/Zurich';
export const START = 8 * 60;
export const END = 20 * 60;

export const UPSTREAM_TIMEOUT_MS = 6000;
// One coverage request, then two rooms at a time, with a response margin.
export const API_TIMEOUT_MS = (1 + Math.ceil(ROOMS.length / 2)) * UPSTREAM_TIMEOUT_MS + 5000;

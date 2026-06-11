import { getSessionType } from '../src/lib/SessionShading';

const ts_utc = new Date('2023-01-03T09:30:00Z').getTime() / 1000;
console.log('09:30 UTC (which is 04:30 ET):', getSessionType(ts_utc));

const ts_utc2 = new Date('2023-01-03T16:00:00Z').getTime() / 1000;
console.log('16:00 UTC (which is 11:00 ET):', getSessionType(ts_utc2));

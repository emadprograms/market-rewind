import { getSessionType } from '../src/lib/SessionShading';

const t1 = new Date('2023-01-03T16:00:00Z').getTime() / 1000;
console.log('16:00 UTC:', getSessionType(t1));

const t2 = new Date('2023-01-03T16:25:00Z').getTime() / 1000;
console.log('16:25 UTC:', getSessionType(t2));

const t3 = new Date('2023-01-03T16:30:00Z').getTime() / 1000;
console.log('16:30 UTC:', getSessionType(t3));

const t4 = new Date('2023-01-03T20:00:00Z').getTime() / 1000;
console.log('20:00 UTC (16:00 ET, market close):', getSessionType(t4));

const t5 = new Date('2023-01-03T20:30:00Z').getTime() / 1000;
console.log('20:30 UTC (16:30 ET):', getSessionType(t5));

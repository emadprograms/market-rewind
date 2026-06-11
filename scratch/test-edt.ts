import { getSessionType } from '../src/lib/SessionShading';

const t_edt = new Date('2023-06-01T13:30:00Z').getTime() / 1000;
console.log('09:30 EDT (summer):', getSessionType(t_edt));

const t_edt_pre = new Date('2023-06-01T13:25:00Z').getTime() / 1000;
console.log('09:25 EDT (summer):', getSessionType(t_edt_pre));

const t_est = new Date('2023-01-03T14:30:00Z').getTime() / 1000;
console.log('09:30 EST (winter):', getSessionType(t_est));

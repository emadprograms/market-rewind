
import { performance } from 'perf_hooks';

// Mock the original getSessionType (instantiating formatter inside)
function getSessionTypeOld(timestamp) {
  const date = new Date(timestamp * 1000);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false
  });
  
  const parts = formatter.formatToParts(date);
  const hour = parseInt(parts.find(p => p.type === 'hour').value);
  const minute = parseInt(parts.find(p => p.type === 'minute').value);
  const totalMinutes = hour * 60 + minute;
  
  if (totalMinutes >= 240 && totalMinutes < 570) return 'PRE';
  if (totalMinutes >= 570 && totalMinutes < 960) return 'RTH';
  if (totalMinutes >= 960 && totalMinutes < 1200) return 'POST';
  return 'OTHER';
}

// Mock the new getSessionType (singleton formatter)
const singletonFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: 'numeric',
  minute: 'numeric',
  hour12: false
});

function getSessionTypeNew(timestamp) {
  const date = new Date(timestamp * 1000);
  const parts = singletonFormatter.formatToParts(date);
  const hour = parseInt(parts.find(p => p.type === 'hour').value);
  const minute = parseInt(parts.find(p => p.type === 'minute').value);
  const totalMinutes = hour * 60 + minute;
  
  if (totalMinutes >= 240 && totalMinutes < 570) return 'PRE';
  if (totalMinutes >= 570 && totalMinutes < 960) return 'RTH';
  if (totalMinutes >= 960 && totalMinutes < 1200) return 'POST';
  return 'OTHER';
}

const ITERATIONS = 10000;
const timestamp = 1685534400; // Example timestamp

console.log(`Running benchmark with ${ITERATIONS} iterations...`);

const startOld = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
  getSessionTypeOld(timestamp + i * 60);
}
const endOld = performance.now();
const oldTime = endOld - startOld;

const startNew = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
  getSessionTypeNew(timestamp + i * 60);
}
const endNew = performance.now();
const newTime = endNew - startNew;

console.log(`\nResults:`);
console.log(`Old Implementation (New Formatter per call): ${oldTime.toFixed(2)}ms`);
console.log(`New Implementation (Singleton Formatter):   ${newTime.toFixed(2)}ms`);
console.log(`Improvement: ${((oldTime - newTime) / oldTime * 100).toFixed(2)}% speedup`);

// Demonstrate Visible Range Slicing Impact
const TOTAL_BARS = 10000;
const VISIBLE_BARS = 200;

console.log(`\nSimulating Data Processing Complexity:`);
console.log(`Full Dataset Processing (Total: ${TOTAL_BARS}): ${TOTAL_BARS} operations/frame`);
console.log(`Visible Range Processing (Visible: ${VISIBLE_BARS}): ${VISIBLE_BARS} operations/frame`);
console.log(`Reduction in Operations: ${((TOTAL_BARS - VISIBLE_BARS) / TOTAL_BARS * 100).toFixed(2)}%`);

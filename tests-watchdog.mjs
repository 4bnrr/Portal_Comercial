import assert from 'node:assert/strict';
import { decideWatchdogAction } from './supabase/functions/cvcrm-watchdog/decision.js';

const now = Date.parse('2026-10-13T16:47:00Z');

assert.deepEqual(
  decideWatchdogAction([{ id: 1, status: 'in_progress', run_started_at: '2026-10-13T16:20:00Z' }], now),
  { action: 'wait', reason: 'workflow-active', runId: 1 },
);

assert.deepEqual(
  decideWatchdogAction([{ id: 2, status: 'completed', conclusion: 'success', updated_at: '2026-10-13T16:32:00Z' }], now),
  { action: 'skip', reason: 'recent-success', runId: 2, ageMinutes: 15 },
);

assert.deepEqual(
  decideWatchdogAction([{ id: 3, status: 'completed', conclusion: 'success', updated_at: '2026-10-13T16:30:00Z' }], now),
  { action: 'dispatch', reason: 'stale-success', runId: 3, ageMinutes: 17 },
);

assert.deepEqual(
  decideWatchdogAction([], now),
  { action: 'dispatch', reason: 'no-successful-run' },
);

console.log('OK — Vigia CVCRM evita duplicidade e recupera consultas atrasadas.');

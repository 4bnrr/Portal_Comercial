const ACTIVE_STATUSES = new Set(['queued', 'in_progress', 'waiting', 'requested', 'pending']);

export function decideWatchdogAction(runs, now = Date.now(), staleAfterMinutes = 210) {
  const list = Array.isArray(runs) ? runs : [];
  const recentActive = list.find(run => {
    if (!ACTIVE_STATUSES.has(String(run?.status || '').toLowerCase())) return false;
    const startedAt = Date.parse(run?.run_started_at || run?.created_at || 0);
    return Number.isFinite(startedAt) && now - startedAt < 2 * 60 * 60 * 1000;
  });

  if (recentActive) {
    return { action: 'wait', reason: 'workflow-active', runId: recentActive.id };
  }

  const latestSuccess = list.find(run =>
    run?.status === 'completed'
    && run?.conclusion === 'success'
  );

  if (!latestSuccess) {
    return { action: 'dispatch', reason: 'no-successful-run' };
  }

  const completedAt = Date.parse(
    latestSuccess.updated_at || latestSuccess.run_started_at || latestSuccess.created_at || 0
  );
  const ageMinutes = Number.isFinite(completedAt)
    ? Math.floor((now - completedAt) / 60000)
    : Number.POSITIVE_INFINITY;

  if (ageMinutes <= staleAfterMinutes) {
    return {
      action: 'skip',
      reason: 'recent-success',
      runId: latestSuccess.id,
      ageMinutes,
    };
  }

  return {
    action: 'dispatch',
    reason: 'stale-success',
    runId: latestSuccess.id,
    ageMinutes,
  };
}

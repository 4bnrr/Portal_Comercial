import { decideWatchdogAction } from './decision.js';

const OWNER = '4bnrr';
const REPOSITORY = 'Portal_Comercial';
const WORKFLOW = 'vercel-hourly-sync.yml';
const BRANCH = 'main';
const GITHUB_API = `https://api.github.com/repos/${OWNER}/${REPOSITORY}`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function safeEquals(left: string, right: string) {
  if (!left || !right || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

Deno.serve(async request => {
  if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405);

  const watchdogSecret = Deno.env.get('WATCHDOG_SECRET') || '';
  const receivedSecret = request.headers.get('x-watchdog-secret') || '';
  if (!safeEquals(receivedSecret, watchdogSecret)) return json({ error: 'unauthorized' }, 401);

  const githubToken = Deno.env.get('GITHUB_ACTIONS_TOKEN') || '';
  if (!githubToken) return json({ error: 'github-token-not-configured' }, 503);

  const githubHeaders = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${githubToken}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'estacao1-cvcrm-watchdog',
  };

  try {
    const runsResponse = await fetch(
      `${GITHUB_API}/actions/workflows/${WORKFLOW}/runs?per_page=20`,
      { headers: githubHeaders, signal: AbortSignal.timeout(10000) },
    );
    if (!runsResponse.ok) {
      return json({ error: 'github-runs-unavailable', status: runsResponse.status }, 502);
    }

    const runsPayload = await runsResponse.json();
    const decision = decideWatchdogAction(runsPayload.workflow_runs, Date.now(), 210);
    if (decision.action !== 'dispatch') {
      return json({ ok: true, dispatched: false, ...decision });
    }

    const dispatchResponse = await fetch(
      `${GITHUB_API}/actions/workflows/${WORKFLOW}/dispatches`,
      {
        method: 'POST',
        headers: { ...githubHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ ref: BRANCH }),
        signal: AbortSignal.timeout(10000),
      },
    );

    if (!dispatchResponse.ok) {
      const detail = (await dispatchResponse.text()).slice(0, 300);
      return json({ error: 'github-dispatch-failed', status: dispatchResponse.status, detail }, 502);
    }

    return json({ ok: true, dispatched: true, ...decision }, 202);
  } catch (error) {
    return json({ error: 'watchdog-failed', detail: error instanceof Error ? error.message : String(error) }, 500);
  }
});

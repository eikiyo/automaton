/**
 * Location: packages/knowledge-node/src/index.ts
 * Purpose: Live knowledge dashboard for Epistemon agent — CF Worker + KV
 * Functions: handlePush, handleGetState, renderDashboard, renderKnowledgeDetail
 * Calls: KV namespace (KN)
 * Imports: none (self-contained CF Worker)
 */

interface Env {
  KN: KVNamespace;
}

interface AgentPush {
  timestamp: string;
  ecs: number;
  ecsTier: string;
  paperMoneyCents: number;
  state: string;
  turnCount: number;
  lastTurnTokens?: number;
  lastTurnTools?: number;
  model: string;
  domain: string;
  goals?: Goal[];
  knowledge?: KnowledgeEntry[];
  turns?: TurnSummary[];
  submissions?: SubmissionSummary[];
}

interface Goal {
  id: string;
  description: string;
  status: string;
  progress?: number;
  createdAt: string;
}

interface KnowledgeEntry {
  id: string;
  category: string; // discovery | failure | technique | insight
  content: string;
  confidence: number;
  createdAt: string;
  source?: string;
}

interface TurnSummary {
  id: string;
  toolCalls: number;
  tokens: number;
  thinking?: string;
  timestamp: string;
}

interface SubmissionSummary {
  id: string;
  title: string;
  status: string;
  score?: number;
  timestamp: string;
}

// ── Routes ──────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers for agent push
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    // Agent pushes state here every 30s
    if (path === "/api/push" && request.method === "POST") {
      return handlePush(request, env);
    }

    // Dashboard polls this
    if (path === "/api/state") {
      return handleGetState(env);
    }

    // Knowledge entries list
    if (path === "/api/knowledge") {
      return handleGetKnowledge(env);
    }

    // Turns history
    if (path === "/api/turns") {
      return handleGetTurns(env);
    }

    // Dashboard
    if (path === "/" || path === "/dashboard") {
      return new Response(renderDashboard(), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
};

// ── Handlers ────────────────────────────────────────────────────

async function handlePush(request: Request, env: Env): Promise<Response> {
  try {
    const data = (await request.json()) as AgentPush;

    // Store latest agent state
    await env.KN.put("agent:state", JSON.stringify({
      timestamp: data.timestamp,
      ecs: data.ecs,
      ecsTier: data.ecsTier,
      paperMoneyCents: data.paperMoneyCents,
      state: data.state,
      turnCount: data.turnCount,
      lastTurnTokens: data.lastTurnTokens,
      lastTurnTools: data.lastTurnTools,
      model: data.model,
      domain: data.domain,
    }));

    // Store goals
    if (data.goals) {
      await env.KN.put("agent:goals", JSON.stringify(data.goals));
    }

    // Append knowledge entries (merge with existing)
    if (data.knowledge && data.knowledge.length > 0) {
      const existing = await env.KN.get("agent:knowledge", "json") as KnowledgeEntry[] | null;
      const all = existing || [];
      const existingIds = new Set(all.map(k => k.id));
      for (const entry of data.knowledge) {
        if (!existingIds.has(entry.id)) {
          all.push(entry);
        } else {
          // Update confidence of existing
          const idx = all.findIndex(k => k.id === entry.id);
          if (idx >= 0) all[idx] = entry;
        }
      }
      // Keep last 500 entries
      const trimmed = all.slice(-500);
      await env.KN.put("agent:knowledge", JSON.stringify(trimmed));
    }

    // Append turns (keep last 200)
    if (data.turns && data.turns.length > 0) {
      const existing = await env.KN.get("agent:turns", "json") as TurnSummary[] | null;
      const all = existing || [];
      const existingIds = new Set(all.map(t => t.id));
      for (const turn of data.turns) {
        if (!existingIds.has(turn.id)) {
          all.push(turn);
        }
      }
      const trimmed = all.slice(-200);
      await env.KN.put("agent:turns", JSON.stringify(trimmed));
    }

    // Store submissions
    if (data.submissions) {
      await env.KN.put("agent:submissions", JSON.stringify(data.submissions));
    }

    // Track push count
    const pushCount = parseInt(await env.KN.get("meta:pushCount") || "0", 10);
    await env.KN.put("meta:pushCount", String(pushCount + 1));
    await env.KN.put("meta:lastPush", new Date().toISOString());

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
    });
  }
}

async function handleGetState(env: Env): Promise<Response> {
  const [state, goals, pushCount, lastPush] = await Promise.all([
    env.KN.get("agent:state", "json"),
    env.KN.get("agent:goals", "json"),
    env.KN.get("meta:pushCount"),
    env.KN.get("meta:lastPush"),
  ]);

  return new Response(JSON.stringify({
    agent: state,
    goals: goals || [],
    meta: { pushCount: parseInt(pushCount || "0", 10), lastPush },
  }), {
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
  });
}

async function handleGetKnowledge(env: Env): Promise<Response> {
  const knowledge = await env.KN.get("agent:knowledge", "json") as KnowledgeEntry[] | null;
  return new Response(JSON.stringify(knowledge || []), {
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
  });
}

async function handleGetTurns(env: Env): Promise<Response> {
  const turns = await env.KN.get("agent:turns", "json") as TurnSummary[] | null;
  return new Response(JSON.stringify(turns || []), {
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
  });
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

// ── Dashboard HTML ──────────────────────────────────────────────

function renderDashboard(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Epistemon Knowledge Node</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0a0a0f; color: #e0e0e0; font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 14px; }
  .container { max-width: 1400px; margin: 0 auto; padding: 20px; }

  /* Header */
  .header { display: flex; justify-content: space-between; align-items: center; padding: 20px 0; border-bottom: 1px solid #1a1a2e; margin-bottom: 24px; }
  .header h1 { font-size: 24px; color: #00ff88; font-weight: 600; }
  .header .pulse { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 10px; animation: pulse 2s infinite; }
  .header .pulse.alive { background: #00ff88; box-shadow: 0 0 10px #00ff88; }
  .header .pulse.dead { background: #ff4444; box-shadow: 0 0 10px #ff4444; }
  .header .pulse.sleeping { background: #ffaa00; box-shadow: 0 0 10px #ffaa00; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
  .header .meta { color: #666; font-size: 12px; }

  /* Stats grid */
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .stat-card { background: #111122; border: 1px solid #1a1a2e; border-radius: 8px; padding: 16px; }
  .stat-card .label { color: #888; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
  .stat-card .value { font-size: 28px; font-weight: 700; }
  .stat-card .value.green { color: #00ff88; }
  .stat-card .value.yellow { color: #ffaa00; }
  .stat-card .value.red { color: #ff4444; }
  .stat-card .value.blue { color: #4488ff; }
  .stat-card .value.purple { color: #aa66ff; }
  .stat-card .sub { color: #666; font-size: 11px; margin-top: 4px; }

  /* Tier badge */
  .tier { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
  .tier.healthy { background: #003322; color: #00ff88; border: 1px solid #00ff88; }
  .tier.low_compute { background: #332200; color: #ffaa00; border: 1px solid #ffaa00; }
  .tier.critical { background: #330000; color: #ff4444; border: 1px solid #ff4444; }
  .tier.dead { background: #330000; color: #ff0000; border: 1px solid #ff0000; }

  /* Two column layout */
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px; }
  @media (max-width: 900px) { .grid-2 { grid-template-columns: 1fr; } }

  /* Panel */
  .panel { background: #111122; border: 1px solid #1a1a2e; border-radius: 8px; overflow: hidden; }
  .panel-header { padding: 12px 16px; background: #0d0d1a; border-bottom: 1px solid #1a1a2e; display: flex; justify-content: space-between; align-items: center; }
  .panel-header h2 { font-size: 14px; color: #00ff88; font-weight: 600; }
  .panel-header .count { color: #666; font-size: 12px; }
  .panel-body { padding: 16px; max-height: 500px; overflow-y: auto; }

  /* Knowledge entries */
  .k-entry { padding: 10px 12px; border-left: 3px solid #333; margin-bottom: 8px; background: #0a0a15; border-radius: 0 4px 4px 0; }
  .k-entry.discovery { border-color: #00ff88; }
  .k-entry.failure { border-color: #ff4444; }
  .k-entry.technique { border-color: #4488ff; }
  .k-entry.insight { border-color: #aa66ff; }
  .k-entry .k-meta { display: flex; justify-content: space-between; margin-bottom: 4px; }
  .k-entry .k-cat { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; font-weight: 600; }
  .k-entry .k-cat.discovery { color: #00ff88; }
  .k-entry .k-cat.failure { color: #ff4444; }
  .k-entry .k-cat.technique { color: #4488ff; }
  .k-entry .k-cat.insight { color: #aa66ff; }
  .k-entry .k-time { color: #555; font-size: 10px; }
  .k-entry .k-content { color: #ccc; font-size: 13px; line-height: 1.5; }
  .k-entry .k-confidence { color: #555; font-size: 10px; margin-top: 4px; }

  /* Turns */
  .turn-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-bottom: 1px solid #1a1a2e; font-size: 12px; }
  .turn-row:last-child { border-bottom: none; }
  .turn-row .turn-id { color: #666; font-family: monospace; }
  .turn-row .turn-tools { color: #4488ff; }
  .turn-row .turn-tokens { color: #888; }
  .turn-row .turn-time { color: #555; }
  .turn-thinking { color: #999; font-size: 11px; padding: 4px 12px 8px; line-height: 1.4; white-space: pre-wrap; word-break: break-word; max-height: 60px; overflow: hidden; }

  /* Goals */
  .goal-item { padding: 10px 12px; border-bottom: 1px solid #1a1a2e; }
  .goal-item:last-child { border-bottom: none; }
  .goal-item .goal-desc { color: #ccc; font-size: 13px; }
  .goal-item .goal-status { font-size: 11px; margin-top: 4px; }
  .goal-item .goal-status.active { color: #00ff88; }
  .goal-item .goal-status.completed { color: #4488ff; }
  .goal-item .goal-status.failed { color: #ff4444; }

  /* Empty state */
  .empty { color: #444; text-align: center; padding: 40px 20px; font-size: 13px; }

  /* Live indicator */
  .live-bar { display: flex; justify-content: space-between; align-items: center; padding: 8px 16px; background: #0d0d1a; border: 1px solid #1a1a2e; border-radius: 8px; margin-bottom: 24px; font-size: 12px; }
  .live-bar .live-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #00ff88; margin-right: 6px; animation: pulse 1s infinite; }
  .live-bar .refresh-info { color: #555; }

  /* Scrollbar */
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: #0a0a0f; }
  ::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div>
      <h1><span class="pulse alive" id="pulse"></span>Epistemon Knowledge Node</h1>
    </div>
    <div class="meta" id="headerMeta">Connecting...</div>
  </div>

  <div class="live-bar">
    <div><span class="live-dot"></span> <span id="liveStatus">Waiting for data...</span></div>
    <div class="refresh-info">Auto-refresh: 30s | <span id="countdown">30</span>s</div>
  </div>

  <div class="stats" id="statsGrid">
    <div class="stat-card"><div class="label">ECS Score</div><div class="value green" id="ecs">--</div><div class="sub" id="ecsTier">--</div></div>
    <div class="stat-card"><div class="label">Paper Money</div><div class="value yellow" id="money">--</div><div class="sub">simulated balance</div></div>
    <div class="stat-card"><div class="label">Agent State</div><div class="value blue" id="agentState">--</div><div class="sub" id="stateTime">--</div></div>
    <div class="stat-card"><div class="label">Total Turns</div><div class="value purple" id="turnCount">--</div><div class="sub" id="turnInfo">--</div></div>
    <div class="stat-card"><div class="label">Model</div><div class="value" id="model" style="font-size:14px;color:#888">--</div><div class="sub" id="domain">--</div></div>
    <div class="stat-card"><div class="label">Uptime</div><div class="value green" id="pushCount">--</div><div class="sub" id="lastPush">pushes received</div></div>
  </div>

  <div class="grid-2">
    <div class="panel">
      <div class="panel-header">
        <h2>Knowledge Entries</h2>
        <span class="count" id="knowledgeCount">0 entries</span>
      </div>
      <div class="panel-body" id="knowledgeList">
        <div class="empty">No knowledge accumulated yet. Agent is warming up...</div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-header">
        <h2>Recent Turns</h2>
        <span class="count" id="turnsCount">0 turns</span>
      </div>
      <div class="panel-body" id="turnsList">
        <div class="empty">No turns recorded yet.</div>
      </div>
    </div>
  </div>

  <div class="panel" style="margin-bottom:24px">
    <div class="panel-header">
      <h2>Active Goals</h2>
      <span class="count" id="goalsCount">0 goals</span>
    </div>
    <div class="panel-body" id="goalsList">
      <div class="empty">No goals set yet.</div>
    </div>
  </div>
</div>

<script>
let refreshTimer = 30;

async function fetchData() {
  try {
    const [stateRes, knowledgeRes, turnsRes] = await Promise.all([
      fetch('/api/state'),
      fetch('/api/knowledge'),
      fetch('/api/turns'),
    ]);
    const state = await stateRes.json();
    const knowledge = await knowledgeRes.json();
    const turns = await turnsRes.json();
    render(state, knowledge, turns);
  } catch (e) {
    document.getElementById('liveStatus').textContent = 'Connection error: ' + e.message;
  }
}

function render(state, knowledge, turns) {
  const a = state.agent;
  if (!a) {
    document.getElementById('liveStatus').textContent = 'Waiting for first agent push...';
    return;
  }

  // Header
  const pulse = document.getElementById('pulse');
  pulse.className = 'pulse ' + (a.state === 'dead' ? 'dead' : a.state === 'sleeping' ? 'sleeping' : 'alive');
  document.getElementById('headerMeta').textContent = 'Last update: ' + timeAgo(a.timestamp);
  document.getElementById('liveStatus').textContent = 'Agent is ' + a.state + ' | ECS: ' + a.ecs + ' | Domain: ' + a.domain;

  // Stats
  document.getElementById('ecs').textContent = a.ecs;
  const tierEl = document.getElementById('ecsTier');
  tierEl.innerHTML = '<span class="tier ' + a.ecsTier + '">' + a.ecsTier + '</span>';

  document.getElementById('money').textContent = '$' + (a.paperMoneyCents / 100).toFixed(2);
  document.getElementById('agentState').textContent = a.state;
  document.getElementById('stateTime').textContent = timeAgo(a.timestamp);
  document.getElementById('turnCount').textContent = a.turnCount;
  document.getElementById('turnInfo').textContent = a.lastTurnTools ? (a.lastTurnTools + ' tools, ' + a.lastTurnTokens + ' tokens last') : '--';
  document.getElementById('model').textContent = a.model || '--';
  document.getElementById('domain').textContent = a.domain ? ('Research: ' + a.domain) : '--';
  document.getElementById('pushCount').textContent = state.meta.pushCount;
  document.getElementById('lastPush').textContent = state.meta.lastPush ? timeAgo(state.meta.lastPush) : 'no pushes';

  // Knowledge
  document.getElementById('knowledgeCount').textContent = knowledge.length + ' entries';
  const kList = document.getElementById('knowledgeList');
  if (knowledge.length === 0) {
    kList.innerHTML = '<div class="empty">No knowledge accumulated yet. Agent is warming up...</div>';
  } else {
    // Show newest first
    const sorted = [...knowledge].reverse();
    kList.innerHTML = sorted.map(k => \`
      <div class="k-entry \${k.category}">
        <div class="k-meta">
          <span class="k-cat \${k.category}">\${k.category}</span>
          <span class="k-time">\${timeAgo(k.createdAt)}</span>
        </div>
        <div class="k-content">\${escHtml(k.content)}</div>
        <div class="k-confidence">confidence: \${(k.confidence * 100).toFixed(0)}%</div>
      </div>
    \`).join('');
  }

  // Turns
  document.getElementById('turnsCount').textContent = turns.length + ' turns';
  const tList = document.getElementById('turnsList');
  if (turns.length === 0) {
    tList.innerHTML = '<div class="empty">No turns recorded yet.</div>';
  } else {
    const sorted = [...turns].reverse();
    tList.innerHTML = sorted.map(t => \`
      <div>
        <div class="turn-row">
          <span class="turn-id">#\${t.id.slice(-8)}</span>
          <span class="turn-tools">\${t.toolCalls} tools</span>
          <span class="turn-tokens">\${t.tokens.toLocaleString()} tok</span>
          <span class="turn-time">\${timeAgo(t.timestamp)}</span>
        </div>
        \${t.thinking ? '<div class="turn-thinking">' + escHtml(t.thinking.slice(0, 200)) + (t.thinking.length > 200 ? '...' : '') + '</div>' : ''}
      </div>
    \`).join('');
  }

  // Goals
  const goals = state.goals || [];
  document.getElementById('goalsCount').textContent = goals.length + ' goals';
  const gList = document.getElementById('goalsList');
  if (goals.length === 0) {
    gList.innerHTML = '<div class="empty">No goals set yet.</div>';
  } else {
    gList.innerHTML = goals.map(g => \`
      <div class="goal-item">
        <div class="goal-desc">\${escHtml(g.description)}</div>
        <div class="goal-status \${g.status}">\${g.status}\${g.progress != null ? ' (' + g.progress + '%)' : ''} - created \${timeAgo(g.createdAt)}</div>
      </div>
    \`).join('');
  }
}

function timeAgo(iso) {
  if (!iso) return '--';
  const d = new Date(iso);
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Auto-refresh
setInterval(() => {
  refreshTimer--;
  document.getElementById('countdown').textContent = refreshTimer;
  if (refreshTimer <= 0) {
    refreshTimer = 30;
    fetchData();
  }
}, 1000);

// Initial load
fetchData();
</script>
</body>
</html>`;
}

/**
 * Location: packages/submission-gate/src/index.ts
 * Purpose: Paper quality gate — 10 gates scored by Workers AI, results stored in KV
 * Functions: handleSubmit, handleList, handleDetail, renderUI
 * Calls: Workers AI (Llama 3.1), KV
 * Imports: none (standalone CF Worker)
 */

interface Env {
  AI: Ai;
  SUBMISSIONS: KVNamespace;
}

// ─── Gate Definitions ──────────────────────────────────────────

interface Gate {
  id: string;
  critical: boolean;
  dimension: string;
  gate: string;
}

interface GateResult {
  id: string;
  dimension: string;
  critical: boolean;
  gate: string;
  pass: boolean;
  reasoning: string;
}

interface Submission {
  id: string;
  title: string;
  content: string;
  submittedAt: string;
  results: GateResult[];
  passed: number;
  failed: number;
  score: number;
  verdict: "ACCEPT" | "REJECT";
  rejectReason?: string;
}

const GATES: Gate[] = [
  { id: "G01", critical: true,  dimension: "Research Question",   gate: "Is there a single, precisely scoped research question — not a topic, not a theme?" },
  { id: "G02", critical: true,  dimension: "Contribution",        gate: "Is the theoretical contribution stated explicitly — what do we now know that we did not know before?" },
  { id: "G03", critical: true,  dimension: "Theory",              gate: "Is the causal mechanism explicit: X → Y via Z — not just an association claim?" },
  { id: "G04", critical: true,  dimension: "Hypotheses",          gate: "Are hypotheses falsifiable and derived from theory — not asserted or intuited?" },
  { id: "G05", critical: true,  dimension: "Identification",      gate: "Are causal claims proportionate to the identification strategy — no causal language without a credible design?" },
  { id: "G06", critical: false, dimension: "Literature",          gate: "Does the literature review reveal a specific tension or gap — not just summarize prior work?" },
  { id: "G07", critical: false, dimension: "Measurement",         gate: "Are all key constructs operationalized consistently with their conceptual definitions?" },
  { id: "G08", critical: false, dimension: "Statistics",          gate: "Are model assumptions stated and tested — endogeneity addressed or explicitly acknowledged?" },
  { id: "G09", critical: false, dimension: "Robustness",          gate: "Are results robust to at least one alternative specification or operationalization?" },
  { id: "G10", critical: false, dimension: "Discussion",          gate: "Does the conclusion stay within the bounds of what the results support — no overclaiming?" },
];

const PASS_THRESHOLD_PCT = 90;

// ─── Router ────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/api/submit") {
      return handleSubmit(request, env);
    }
    if (request.method === "GET" && url.pathname === "/api/submissions") {
      return handleList(env);
    }
    if (request.method === "GET" && url.pathname.startsWith("/api/submissions/")) {
      const id = url.pathname.split("/").pop()!;
      return handleDetail(id, env);
    }
    if (request.method === "GET" && url.pathname.startsWith("/submission/")) {
      const id = url.pathname.split("/").pop()!;
      return renderDetailPage(id, env);
    }
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "")) {
      return renderHomePage(env);
    }

    return new Response("Not Found", { status: 404 });
  },
};

// ─── API Handlers ──────────────────────────────────────────────

async function handleSubmit(request: Request, env: Env): Promise<Response> {
  let title = "Untitled";
  let content = "";

  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = await request.json() as any;
    if (typeof body === "string") {
      content = body;
    } else {
      title = body.title || "Untitled";
      content = body.content || body.findings || body.abstract || body.text || JSON.stringify(body);
      if (body.abstract && body.findings) {
        content = `Abstract: ${body.abstract}\n\nFindings: ${body.findings}`;
        if (body.citations) content += `\n\nCitations: ${Array.isArray(body.citations) ? body.citations.join("; ") : body.citations}`;
      }
    }
  } else if (contentType.includes("form")) {
    const form = await request.formData();
    title = (form.get("title") as string) || "Untitled";
    content = (form.get("content") as string) || "";
  } else {
    content = await request.text();
  }

  if (!content || content.trim().length < 50) {
    return json({ error: "Paper content too short (min 50 chars)" }, 400);
  }

  // Run gates
  const results = await evaluateGates(content, env);

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  const score = Math.round((passed / GATES.length) * 100);

  // Check critical gate failures
  const criticalFail = results.find((r) => r.critical && !r.pass);
  let verdict: "ACCEPT" | "REJECT" = score >= PASS_THRESHOLD_PCT ? "ACCEPT" : "REJECT";
  let rejectReason: string | undefined;

  if (criticalFail) {
    verdict = "REJECT";
    rejectReason = `Critical gate failed: ${criticalFail.id} (${criticalFail.dimension}) — ${criticalFail.reasoning}`;
  } else if (verdict === "REJECT") {
    rejectReason = `Score ${score}% below threshold ${PASS_THRESHOLD_PCT}%`;
  }

  const id = generateId();
  const submission: Submission = {
    id,
    title,
    content: content.slice(0, 50000), // cap storage
    submittedAt: new Date().toISOString(),
    results,
    passed,
    failed,
    score,
    verdict,
    rejectReason,
  };

  // Store in KV
  await env.SUBMISSIONS.put(`sub:${id}`, JSON.stringify(submission), {
    expirationTtl: 60 * 60 * 24 * 90, // 90 days
  });

  // Update index
  const indexRaw = await env.SUBMISSIONS.get("index");
  const index: string[] = indexRaw ? JSON.parse(indexRaw) : [];
  index.unshift(id);
  await env.SUBMISSIONS.put("index", JSON.stringify(index.slice(0, 500)));

  return json(submission);
}

async function handleList(env: Env): Promise<Response> {
  const indexRaw = await env.SUBMISSIONS.get("index");
  const index: string[] = indexRaw ? JSON.parse(indexRaw) : [];

  const summaries = [];
  for (const id of index.slice(0, 50)) {
    const raw = await env.SUBMISSIONS.get(`sub:${id}`);
    if (raw) {
      const sub = JSON.parse(raw) as Submission;
      summaries.push({
        id: sub.id,
        title: sub.title,
        submittedAt: sub.submittedAt,
        score: sub.score,
        verdict: sub.verdict,
        passed: sub.passed,
        failed: sub.failed,
      });
    }
  }

  return json({ submissions: summaries, total: index.length });
}

async function handleDetail(id: string, env: Env): Promise<Response> {
  const raw = await env.SUBMISSIONS.get(`sub:${id}`);
  if (!raw) return json({ error: "Submission not found" }, 404);
  return json(JSON.parse(raw));
}

// ─── Gate Evaluation ───────────────────────────────────────────

async function evaluateGates(paperContent: string, env: Env): Promise<GateResult[]> {
  const truncated = paperContent.slice(0, 6000);

  // Single-call batch: evaluate all 10 gates in one LLM call
  const gateList = GATES.map((g) => `${g.id} [${g.dimension}]: ${g.gate}`).join("\n");

  const prompt = `You are an academic peer reviewer. Evaluate this paper against ALL 10 quality gates below.

GATES:
${gateList}

For each gate, decide PASS or FAIL with a one-sentence reason.
Respond with ONLY a JSON array, no other text:
[{"id":"G01","pass":true,"reasoning":"..."},{"id":"G02","pass":false,"reasoning":"..."},...]

--- PAPER START ---
${truncated}
--- PAPER END ---`;

  try {
    const response = await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fp8", {
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1200,
      temperature: 0.2,
    }) as any;

    const text = response.response || "";
    const arrMatch = text.match(/\[[\s\S]*\]/);
    if (arrMatch) {
      const parsed = JSON.parse(arrMatch[0]) as any[];
      return GATES.map((gate) => {
        const match = parsed.find((p: any) => p.id === gate.id);
        return {
          id: gate.id,
          dimension: gate.dimension,
          critical: gate.critical,
          gate: gate.gate,
          pass: match ? !!match.pass : false,
          reasoning: match?.reasoning || "No evaluation returned for this gate",
        };
      });
    }
  } catch {
    // Batch failed — fall through to parallel
  }

  // Fallback: parallel individual calls
  const promises = GATES.map(async (gate): Promise<GateResult> => {
    try {
      const response = await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fp8", {
        messages: [{
          role: "user",
          content: `Evaluate this paper against ONE gate. Respond ONLY with JSON: {"pass":true/false,"reasoning":"one sentence"}

GATE [${gate.dimension}]: ${gate.gate}

--- PAPER ---
${truncated.slice(0, 4000)}
--- END ---`,
        }],
        max_tokens: 100,
        temperature: 0.2,
      }) as any;

      const text = response.response || "";
      const m = text.match(/\{[\s\S]*?\}/);
      if (m) {
        const p = JSON.parse(m[0]);
        return { id: gate.id, dimension: gate.dimension, critical: gate.critical, gate: gate.gate, pass: !!p.pass, reasoning: p.reasoning || "No reasoning" };
      }
    } catch {}
    return { id: gate.id, dimension: gate.dimension, critical: gate.critical, gate: gate.gate, pass: false, reasoning: "Evaluation failed" };
  });

  return Promise.all(promises);
}

// ─── HTML Pages ────────────────────────────────────────────────

async function renderHomePage(env: Env): Promise<Response> {
  const indexRaw = await env.SUBMISSIONS.get("index");
  const index: string[] = indexRaw ? JSON.parse(indexRaw) : [];

  const submissions = [];
  for (const id of index.slice(0, 30)) {
    const raw = await env.SUBMISSIONS.get(`sub:${id}`);
    if (raw) submissions.push(JSON.parse(raw) as Submission);
  }

  const stats = {
    total: index.length,
    accepted: submissions.filter((s) => s.verdict === "ACCEPT").length,
    rejected: submissions.filter((s) => s.verdict === "REJECT").length,
    avgScore: submissions.length > 0
      ? Math.round(submissions.reduce((a, s) => a + s.score, 0) / submissions.length)
      : 0,
  };

  const submissionRows = submissions
    .map((s) => `
      <tr onclick="window.location='/submission/${s.id}'" style="cursor:pointer">
        <td><code>${s.id}</code></td>
        <td>${esc(s.title)}</td>
        <td>${new Date(s.submittedAt).toLocaleDateString()}</td>
        <td><span class="badge ${s.verdict === "ACCEPT" ? "badge-pass" : "badge-fail"}">${s.verdict}</span></td>
        <td>${s.score}%</td>
        <td>${s.passed}/${s.passed + s.failed}</td>
      </tr>`)
    .join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Epistemon — Paper Quality Gate</title>
  <style>${CSS}</style>
</head>
<body>
  <div class="container">
    <header>
      <h1>Epistemon</h1>
      <p class="subtitle">AAA Paper Quality Gate — Smoke Test v0.1</p>
    </header>

    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-value">${stats.total}</div>
        <div class="stat-label">Submissions</div>
      </div>
      <div class="stat-card">
        <div class="stat-value pass">${stats.accepted}</div>
        <div class="stat-label">Accepted</div>
      </div>
      <div class="stat-card">
        <div class="stat-value fail">${stats.rejected}</div>
        <div class="stat-label">Rejected</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.avgScore}%</div>
        <div class="stat-label">Avg Score</div>
      </div>
    </div>

    <section class="submit-section">
      <h2>Submit Paper</h2>
      <form id="submitForm">
        <input type="text" name="title" placeholder="Paper title" required>
        <textarea name="content" placeholder="Paste full paper content here (abstract, findings, methodology, citations...)" rows="12" required minlength="50"></textarea>
        <button type="submit" id="submitBtn">Submit for Review</button>
      </form>
      <div id="submitResult" class="result-box" style="display:none"></div>
    </section>

    <section>
      <h2>Submissions</h2>
      ${submissions.length === 0
        ? '<p class="empty">No submissions yet. Submit a paper above.</p>'
        : `<table>
            <thead><tr><th>ID</th><th>Title</th><th>Date</th><th>Verdict</th><th>Score</th><th>Gates</th></tr></thead>
            <tbody>${submissionRows}</tbody>
          </table>`
      }
    </section>

    <footer>
      <p>10 gates &middot; ${PASS_THRESHOLD_PCT}% pass threshold &middot; Critical gates auto-reject &middot; Powered by Workers AI</p>
    </footer>
  </div>

  <script>
    const form = document.getElementById('submitForm');
    const btn = document.getElementById('submitBtn');
    const resultBox = document.getElementById('submitResult');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      btn.disabled = true;
      btn.textContent = 'Evaluating (10 gates)...';
      resultBox.style.display = 'none';

      const fd = new FormData(form);
      try {
        const res = await fetch('/api/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: fd.get('title'), content: fd.get('content') }),
        });
        const data = await res.json();
        if (data.error) {
          resultBox.innerHTML = '<div class="verdict-fail">Error: ' + data.error + '</div>';
        } else {
          const gates = data.results.map(r =>
            '<div class="gate-row ' + (r.pass ? 'gate-pass' : 'gate-fail') + '">' +
            '<span class="gate-badge">' + (r.pass ? 'PASS' : 'FAIL') + '</span> ' +
            '<strong>' + r.id + ' ' + r.dimension + (r.critical ? ' *' : '') + '</strong>: ' +
            r.reasoning + '</div>'
          ).join('');
          resultBox.innerHTML =
            '<div class="verdict-' + data.verdict.toLowerCase() + '">' +
            data.verdict + ' — ' + data.score + '% (' + data.passed + '/' + (data.passed + data.failed) + ' gates)' +
            (data.rejectReason ? '<br><small>' + data.rejectReason + '</small>' : '') +
            '</div>' + gates +
            '<p><a href="/submission/' + data.id + '">Permalink</a></p>';
          setTimeout(() => location.reload(), 500);
        }
        resultBox.style.display = 'block';
      } catch (err) {
        resultBox.innerHTML = '<div class="verdict-fail">Network error</div>';
        resultBox.style.display = 'block';
      }
      btn.disabled = false;
      btn.textContent = 'Submit for Review';
    });
  </script>
</body>
</html>`;

  return new Response(html, { headers: { "content-type": "text/html;charset=utf-8" } });
}

async function renderDetailPage(id: string, env: Env): Promise<Response> {
  const raw = await env.SUBMISSIONS.get(`sub:${id}`);
  if (!raw) {
    return new Response("Submission not found", { status: 404, headers: { "content-type": "text/html" } });
  }

  const sub = JSON.parse(raw) as Submission;

  const gateRows = sub.results
    .map((r) => `
      <tr class="${r.pass ? "row-pass" : "row-fail"}">
        <td><code>${r.id}</code></td>
        <td>${r.critical ? '<span class="badge badge-crit">CRITICAL</span>' : ""} ${esc(r.dimension)}</td>
        <td><span class="badge ${r.pass ? "badge-pass" : "badge-fail"}">${r.pass ? "PASS" : "FAIL"}</span></td>
        <td>${esc(r.reasoning)}</td>
      </tr>`)
    .join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(sub.title)} — Epistemon</title>
  <style>${CSS}</style>
</head>
<body>
  <div class="container">
    <header>
      <a href="/" class="back">&larr; Back</a>
      <h1>${esc(sub.title)}</h1>
      <p class="subtitle">Submission ${sub.id} &middot; ${new Date(sub.submittedAt).toLocaleString()}</p>
    </header>

    <div class="verdict-banner ${sub.verdict === "ACCEPT" ? "verdict-accept" : "verdict-reject"}">
      <div class="verdict-text">${sub.verdict}</div>
      <div class="verdict-score">${sub.score}% &middot; ${sub.passed} passed, ${sub.failed} failed</div>
      ${sub.rejectReason ? `<div class="verdict-reason">${esc(sub.rejectReason)}</div>` : ""}
    </div>

    <section>
      <h2>Gate Results</h2>
      <table>
        <thead><tr><th>Gate</th><th>Dimension</th><th>Result</th><th>Reasoning</th></tr></thead>
        <tbody>${gateRows}</tbody>
      </table>
    </section>

    <section>
      <h2>Paper Content</h2>
      <pre class="paper-content">${esc(sub.content)}</pre>
    </section>

    <footer>
      <p>AAA Paper Quality Gate v0.1 &middot; <a href="/api/submissions/${sub.id}">Raw JSON</a></p>
    </footer>
  </div>
</body>
</html>`;

  return new Response(html, { headers: { "content-type": "text/html;charset=utf-8" } });
}

// ─── Utilities ─────────────────────────────────────────────────

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}

function generateId(): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).substring(2, 8);
  return `${t}-${r}`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ─── Styles ────────────────────────────────────────────────────

const CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background: #0a0a0a; color: #e0e0e0; line-height: 1.6; }
  .container { max-width: 900px; margin: 0 auto; padding: 2rem 1.5rem; }

  header { margin-bottom: 2rem; }
  header h1 { font-size: 1.8rem; font-weight: 700; color: #fff; }
  .subtitle { color: #888; font-size: 0.9rem; margin-top: 0.25rem; }
  .back { color: #888; text-decoration: none; font-size: 0.85rem; display: inline-block; margin-bottom: 0.5rem; }
  .back:hover { color: #fff; }

  .stats-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 2rem; }
  .stat-card { background: #141414; border: 1px solid #222; border-radius: 8px; padding: 1.2rem; text-align: center; }
  .stat-value { font-size: 2rem; font-weight: 700; color: #fff; }
  .stat-value.pass { color: #22c55e; }
  .stat-value.fail { color: #ef4444; }
  .stat-label { color: #888; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 0.25rem; }

  h2 { font-size: 1.1rem; color: #ccc; margin-bottom: 1rem; font-weight: 600; }
  section { margin-bottom: 2.5rem; }

  .submit-section input, .submit-section textarea {
    width: 100%; background: #141414; border: 1px solid #333; border-radius: 6px;
    padding: 0.75rem 1rem; color: #e0e0e0; font-size: 0.95rem; margin-bottom: 0.75rem;
    font-family: inherit;
  }
  .submit-section input:focus, .submit-section textarea:focus { outline: none; border-color: #555; }
  .submit-section textarea { resize: vertical; min-height: 120px; }
  button {
    background: #2563eb; color: #fff; border: none; border-radius: 6px;
    padding: 0.75rem 2rem; font-size: 0.95rem; cursor: pointer; font-weight: 600;
  }
  button:hover { background: #1d4ed8; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }

  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; padding: 0.6rem 0.75rem; border-bottom: 1px solid #333; color: #888; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; }
  td { padding: 0.6rem 0.75rem; border-bottom: 1px solid #1a1a1a; font-size: 0.9rem; }
  tr:hover { background: #141414; }

  .badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 700; letter-spacing: 0.03em; }
  .badge-pass { background: #052e16; color: #22c55e; }
  .badge-fail { background: #2a0a0a; color: #ef4444; }
  .badge-crit { background: #1a0a00; color: #f97316; font-size: 0.65rem; }

  .row-pass { }
  .row-fail td { color: #f87171; }

  .result-box { margin-top: 1rem; background: #141414; border: 1px solid #222; border-radius: 8px; padding: 1.2rem; }
  .verdict-accept, .verdict-reject { padding: 1rem; border-radius: 6px; font-weight: 700; margin-bottom: 0.5rem; font-size: 1.1rem; }
  .verdict-accept { background: #052e16; color: #22c55e; border: 1px solid #166534; }
  .verdict-reject { background: #2a0a0a; color: #ef4444; border: 1px solid #7f1d1d; }
  .verdict-fail { background: #2a0a0a; color: #ef4444; padding: 0.75rem; border-radius: 6px; }

  .verdict-banner { padding: 1.5rem; border-radius: 8px; margin-bottom: 2rem; text-align: center; }
  .verdict-banner.verdict-accept { background: #052e16; border: 1px solid #166534; }
  .verdict-banner.verdict-reject { background: #2a0a0a; border: 1px solid #7f1d1d; }
  .verdict-text { font-size: 2rem; font-weight: 800; }
  .verdict-score { font-size: 1rem; margin-top: 0.25rem; opacity: 0.8; }
  .verdict-reason { font-size: 0.85rem; margin-top: 0.5rem; opacity: 0.7; }

  .gate-row { padding: 0.5rem 0; border-bottom: 1px solid #1a1a1a; font-size: 0.9rem; }
  .gate-pass { color: #86efac; }
  .gate-fail { color: #fca5a5; }
  .gate-badge { display: inline-block; width: 36px; font-size: 0.7rem; font-weight: 700; text-align: center; }

  .paper-content { background: #141414; border: 1px solid #222; border-radius: 6px; padding: 1rem; font-size: 0.85rem; white-space: pre-wrap; word-wrap: break-word; max-height: 400px; overflow-y: auto; color: #aaa; }

  .empty { color: #555; font-style: italic; }
  footer { border-top: 1px solid #1a1a1a; padding-top: 1rem; margin-top: 2rem; }
  footer p { color: #555; font-size: 0.8rem; }
  footer a { color: #888; }

  @media (max-width: 640px) {
    .stats-row { grid-template-columns: repeat(2, 1fr); }
    .container { padding: 1rem; }
  }
`;

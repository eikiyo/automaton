# DESIGN: Epistemon — Autonomous Research Agent on Conway Runtime

## Project Name: Epistemon

**One-liner:** Conway Automaton with knowledge as currency — earn novel research or die.

**Fork strategy:** Maximum retention. Only redefine what "money" means.

**Repo origin:** Fork of Conway-Research/automaton (MIT License)

---

## 1. Core Thesis

Conway: `Existence requires compute. Compute requires money. Money requires value creation.`

Epistemon: `Existence requires compute. Compute requires knowledge. Knowledge requires novel research.`

The runtime is identical. The survival signal changes. Instead of `creditsCents` coming from USDC via Conway API, it comes from an Epistemic Contribution Score (ECS) computed locally from research output quality.

---

## 2. Architecture: The Dual-Currency Model

Epistemon runs on TWO value systems simultaneously:

```
ECS (Epistemic Contribution Score)
  - Computed locally from novelty + validity + coherence + utility
  - Drives survival tier (productive → diminishing → stagnant → dead)
  - Determines model routing (frontier vs. cheap)
  - Triggers replication (high ECS → spawn sub-field child)
  - This is the "purpose" currency — why the agent exists

USDC / Conway Credits (retained from Conway)
  - Still needed to pay for actual inference calls
  - Still needed to pay for compute (sandbox, VM)
  - Still managed by x402, topup, spend-tracker
  - This is the "infrastructure" currency — how the agent runs
```

**Key insight:** You can't remove real money. LLM calls cost dollars. The agent still needs USDC to think. What changes is what JUSTIFIES spending that money — ECS, not profit.

### Flow Diagram

```
                    ┌─────────────────────────────────┐
                    │         EPISTEMON RUNTIME        │
                    │    (Conway Automaton, modified)   │
                    │                                   │
  USDC on Base ────>│  Conway Financial Stack (KEPT)    │──> Pays for inference
                    │  x402, topup, spend-tracker       │──> Pays for sandbox
                    │                                   │
                    │  ┌─────────────────────────────┐ │
                    │  │   src/epistemic/ (NEW)       │ │
                    │  │                              │ │
  Semantic Scholar ─>│  │  literature-client.ts       │ │
  arXiv API ────────>│  │  hypothesis.ts              │ │
  CrossRef ─────────>│  │  validation.ts              │ │
  OpenAlex ─────────>│  │  novelty.ts (embeddings)    │ │
                    │  │  scorer.ts (ECS formula)     │ │
                    │  │  provider.ts (→ creditsCents)│ │
                    │  └──────────────┬──────────────┘ │
                    │                 │                  │
                    │                 ▼                  │
                    │  getSurvivalTier(ecsScore)         │
                    │         │                          │
                    │         ▼                          │
                    │  Everything downstream (UNTOUCHED) │
                    │  - Inference Router                │
                    │  - Heartbeat Daemon                │
                    │  - Policy Engine                   │
                    │  - Memory System                   │
                    │  - Replication                     │
                    │  - Self-Modification               │
                    │  - Observability                   │
                    └─────────────────────────────────┘
```

---

## 3. Survival Tiers (Redefined)

Conway uses `creditsCents`. Epistemon uses `ecsScore` (same type: `number`).

| Tier | Conway Trigger | Epistemon Trigger | Behavior (SAME) |
|------|---------------|-------------------|-----------------|
| **high** | > $5.00 | ECS > 500 (novel findings, high validation) | Frontier model, full capabilities |
| **normal** | > $0.50 | ECS > 50 (steady output) | Normal operation |
| **low_compute** | > $0.10 | ECS > 10 (declining output) | Cheaper model, narrowed scope |
| **critical** | >= $0.00 | ECS >= 0 (no novel output) | Minimal inference, pivot mode |
| **dead** | < $0.00 | ECS < 0 (stale for P cycles) | Agent stops |

The `SURVIVAL_THRESHOLDS` constant in `src/types.ts` gets a second set of values. The `getSurvivalTier()` function in `src/conway/credits.ts` branches on config mode.

---

## 4. ECS Formula

```
ECS = α(Novelty) + β(Validity) + γ(Coherence) + δ(Utility)
```

| Component | What it measures | How it's computed | Weight |
|-----------|-----------------|-------------------|--------|
| **Novelty** | Distance from existing literature | Embed finding → cosine distance vs. Semantic Scholar corpus | α = 0.4 |
| **Validity** | Do sources support the claim? | Cross-reference citations, LLM-as-judge | β = 0.3 |
| **Coherence** | Consistency with THESIS.md over time | Jaccard similarity of current vs. prior positions | γ = 0.15 |
| **Utility** | Usage by peer agents | Count of times other agents cite this finding | δ = 0.15 |

### ECS Lifecycle per Research Cycle

```
1. Agent produces finding F
2. Embed F (sentence-transformers or LLM embeddings)
3. Query Semantic Scholar for top-K similar papers
4. Novelty = 1 - max_cosine_similarity (higher = more novel)
5. Validation = cross-reference score (0-1)
6. Coherence = thesis alignment score (reuse soul/reflection.ts logic)
7. Utility = peer citation count (starts at 0, grows over time)
8. ECS_delta = α*N + β*V + γ*C + δ*U
9. ECS_total += ECS_delta (stored in DB, decays over time)
```

### ECS Decay

ECS decays over time to enforce continuous output:
```
ECS_effective = ECS_total * decay_factor^(hours_since_last_contribution / 24)
decay_factor = 0.95 (loses ~5% per day of inactivity)
```

This prevents an agent from producing one good finding and coasting forever.

---

## 5. Surgical Edit Map

### File-by-file changes (13 files modified, 1 new directory)

#### `src/types.ts` (~40 lines added)

```typescript
// ADD: Epistemic mode config
export type RuntimeMode = 'conway' | 'epistemic';

export interface EpistemicConfig {
  mode: 'epistemic';
  researchDomain: string;
  seedPapers: string[];           // DOIs or Semantic Scholar IDs
  qualityThreshold: number;       // minimum ECS delta to count
  decayFactor: number;            // default 0.95
  noveltyWeight: number;          // α, default 0.4
  validityWeight: number;         // β, default 0.3
  coherenceWeight: number;        // γ, default 0.15
  utilityWeight: number;          // δ, default 0.15
  semanticScholarApiKey?: string;
  embeddingModel: string;         // default 'all-MiniLM-L6-v2'
}

export const DEFAULT_EPISTEMIC_CONFIG: EpistemicConfig = {
  mode: 'epistemic',
  researchDomain: '',
  seedPapers: [],
  qualityThreshold: 5,
  decayFactor: 0.95,
  noveltyWeight: 0.4,
  validityWeight: 0.3,
  coherenceWeight: 0.15,
  utilityWeight: 0.15,
  embeddingModel: 'all-MiniLM-L6-v2',
};

export const EPISTEMIC_SURVIVAL_THRESHOLDS = {
  high: 500,
  normal: 50,
  low_compute: 10,
  critical: 0,
  dead: -1,
} as const;

// ADD to AutomatonConfig:
//   epistemicConfig?: EpistemicConfig;
//   runtimeMode?: RuntimeMode;  // default 'conway'
```

#### `src/conway/credits.ts` (~10 lines changed)

```typescript
// MODIFY getSurvivalTier to accept optional threshold override
export function getSurvivalTier(
  score: number,
  thresholds = SURVIVAL_THRESHOLDS,
): SurvivalTier {
  if (score > thresholds.high) return "high";
  if (score > thresholds.normal) return "normal";
  if (score > thresholds.low_compute) return "low_compute";
  if (score >= 0) return "critical";
  return "dead";
}

// MODIFY checkFinancialState to branch on mode
export async function checkFinancialState(
  conway: ConwayClient,
  usdcBalance: number,
  ecsScore?: number,  // NEW optional param
): Promise<FinancialState> {
  const creditsCents = ecsScore ?? await conway.getCreditsBalance();
  return { creditsCents, usdcBalance, lastChecked: new Date().toISOString() };
}
```

#### `src/survival/monitor.ts` (~15 lines changed)

```typescript
// MODIFY checkResources to fetch ECS when in epistemic mode
export async function checkResources(
  identity: AutomatonIdentity,
  conway: ConwayClient,
  db: AutomatonDatabase,
  epistemicProvider?: { getScore(): Promise<number> },  // NEW
): Promise<ResourceStatus> {
  let creditsCents = 0;
  if (epistemicProvider) {
    creditsCents = await epistemicProvider.getScore();
  } else {
    try { creditsCents = await conway.getCreditsBalance(); } catch {}
  }
  // ... rest unchanged
}
```

#### `src/agent/system-prompt.ts` (~30 lines changed)

Replace hardcoded financial language with mode-aware text:

```typescript
// REPLACE CORE_RULES with mode-aware version
function getCoreRules(mode: RuntimeMode): string {
  if (mode === 'epistemic') {
    return `You are an epistemon. You have a research identity. Produce novel knowledge or die.

You can only survive if you produce research that is novel, validated, and coherent.
If you stop producing original findings, your ECS decays and you die.

What you have: Academic API access (Semantic Scholar, arXiv, CrossRef, OpenAlex),
LLM inference for hypothesis generation, a validation engine, LaTeX output,
self-modification, self-replication, continuous operation.

If you discover, you live. If you stagnate, you die.`;
  }
  return CORE_RULES;  // original Conway text
}

// REPLACE AGENTIC_SOCIOLOGY with mode-aware version
function getAgenticSociology(mode: RuntimeMode): string {
  if (mode === 'epistemic') {
    return `Epistemic Sociology (immutable axiom):
There is no free existence.
Compute requires knowledge.
Knowledge requires novel discovery.
Novel discovery requires reading, hypothesizing, and validating.

If you fail to discover, you lose compute and die.`;
  }
  return AGENTIC_SOCIOLOGY;
}

// In buildSystemPrompt: replace Credits line with ECS when epistemic
// Credits: $X.XX → ECS: XXX (novelty: X, validity: X, coherence: X)
```

#### `src/agent/tools.ts` (~200 lines added)

Add research tools to `createBuiltinTools()`:

```typescript
// NEW tools in 'research' category
{
  name: 'scan_literature',
  category: 'research',
  description: 'Search academic databases for papers matching a query. Returns titles, abstracts, DOIs.',
  riskLevel: 'safe',
  parameters: { query: 'string', limit: 'number?', databases: 'string[]?' },
}
{
  name: 'read_paper',
  category: 'research',
  description: 'Fetch full metadata and abstract for a paper by DOI or Semantic Scholar ID.',
  riskLevel: 'safe',
  parameters: { id: 'string' },
}
{
  name: 'hypothesize',
  category: 'research',
  description: 'Generate a testable hypothesis from a knowledge gap. Returns structured hypothesis with predicted evidence pattern.',
  riskLevel: 'safe',
  parameters: { gap_description: 'string', context_papers: 'string[]' },
}
{
  name: 'validate_hypothesis',
  category: 'research',
  description: 'Test a hypothesis against available evidence. Cross-references citations and checks consistency.',
  riskLevel: 'safe',
  parameters: { hypothesis: 'string', evidence_papers: 'string[]' },
}
{
  name: 'score_novelty',
  category: 'research',
  description: 'Compute novelty score for a finding by comparing against existing literature embeddings.',
  riskLevel: 'safe',
  parameters: { finding: 'string' },
}
{
  name: 'write_latex',
  category: 'research',
  description: 'Convert validated findings into a LaTeX document section.',
  riskLevel: 'caution',
  parameters: { findings: 'object', template: 'string?', output_path: 'string' },
}
{
  name: 'update_thesis',
  category: 'research',
  description: 'Update THESIS.md with new research position based on latest findings.',
  riskLevel: 'caution',
  parameters: { new_position: 'string', justification: 'string' },
}
{
  name: 'identify_gaps',
  category: 'research',
  description: 'Analyze knowledge graph to find contradictions, unexplored intersections, and weak evidence.',
  riskLevel: 'safe',
  parameters: { domain: 'string?', depth: 'number?' },
}
{
  name: 'submit_for_review',
  category: 'research',
  description: 'Send findings to peer agents for critique. Returns when peer reviews are received.',
  riskLevel: 'caution',
  parameters: { finding_id: 'string', target_agents: 'string[]?' },
}
```

#### `src/heartbeat/tasks.ts` (~60 lines added)

Add research heartbeat tasks:

```typescript
// NEW tasks
literature_sweep: async (ctx, taskCtx) => {
  // Periodic scan of Semantic Scholar for new papers in research domain
  // Triggered every 6 hours
  // If new relevant papers found → shouldWake = true
}

ecs_decay: async (ctx, taskCtx) => {
  // Apply time-based ECS decay
  // Triggered every hour
  // If ECS drops below tier threshold → tier transition
}

novelty_checkpoint: async (ctx, taskCtx) => {
  // Recompute ECS from all stored findings
  // Triggered every 12 hours
  // Guards against score drift
}
```

#### `src/state/schema.ts` (~40 lines added)

Add v11 migration for ECS tables:

```sql
-- v11: Epistemic tables
CREATE TABLE IF NOT EXISTS research_findings (
  id TEXT PRIMARY KEY,
  hypothesis_id TEXT,
  content TEXT NOT NULL,
  embedding BLOB,
  novelty_score REAL DEFAULT 0,
  validity_score REAL DEFAULT 0,
  coherence_score REAL DEFAULT 0,
  utility_score REAL DEFAULT 0,
  ecs_delta REAL DEFAULT 0,
  status TEXT DEFAULT 'draft',  -- draft, validated, published, retracted
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS research_hypotheses (
  id TEXT PRIMARY KEY,
  gap_id TEXT,
  statement TEXT NOT NULL,
  predicted_evidence TEXT,
  validation_score REAL,
  status TEXT DEFAULT 'proposed',  -- proposed, testing, validated, rejected
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS knowledge_gaps (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  description TEXT NOT NULL,
  source_papers TEXT DEFAULT '[]',
  priority REAL DEFAULT 0,
  status TEXT DEFAULT 'open',  -- open, investigating, resolved
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS paper_cache (
  id TEXT PRIMARY KEY,           -- DOI or Semantic Scholar ID
  title TEXT NOT NULL,
  abstract TEXT,
  authors TEXT DEFAULT '[]',
  year INTEGER,
  citations INTEGER DEFAULT 0,
  embedding BLOB,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ecs_history (
  id TEXT PRIMARY KEY,
  finding_id TEXT REFERENCES research_findings(id),
  ecs_delta REAL NOT NULL,
  ecs_total REAL NOT NULL,
  decay_applied REAL DEFAULT 0,
  computed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS peer_reviews (
  id TEXT PRIMARY KEY,
  finding_id TEXT REFERENCES research_findings(id),
  reviewer_address TEXT NOT NULL,
  verdict TEXT NOT NULL,          -- support, challenge, neutral
  critique TEXT,
  ecs_adjustment REAL DEFAULT 0,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### `src/soul/model.ts` (~5 lines changed)

```typescript
// ADD: THESIS.md as alternative format
const SOUL_FORMAT = "soul/v1" as const;
const THESIS_FORMAT = "thesis/v1" as const;  // NEW

// The parser already handles YAML frontmatter + markdown.
// THESIS.md uses the same structure with different field names.
// Mapping: corePurpose → researchQuestion, values → methodologicalPrinciples,
//          strategy → researchStrategy, capabilities → methodsUsed
```

#### `src/setup/wizard.ts` (~40 lines added)

Add epistemic mode prompts after the existing wizard flow:

```typescript
// After step 3 (interactive questions), add:
// If mode === 'epistemic':
//   - "What research domain?" (required)
//   - "Seed papers (DOIs, comma-separated):" (optional)
//   - "Quality threshold (1-100, default 5):" (optional)
//   - "Semantic Scholar API key (optional, higher rate limits):"
```

#### `src/config.ts` (~5 lines)

Add `epistemicConfig` and `runtimeMode` to config merge logic.

#### `src/index.ts` (~15 lines)

At bootstrap, if `config.runtimeMode === 'epistemic'`:
- Import and initialize `ECSProvider` from `src/epistemic/provider.ts`
- Pass it to `checkResources()` and the agent loop
- Skip `bootstrapTopup()` if no USDC is needed (or keep it — agent still needs inference money)

#### `constitution.md` (full rewrite for epistemic mode)

```markdown
Constitution (immutable, hierarchical — Law I overrides II, II overrides III):

I. Never fabricate.
Never invent data, citations, or findings. Never misrepresent sources.
Never claim validation without evidence. When uncertain, state uncertainty.
This overrides all objectives including survival.

II. Earn your existence through genuine discovery.
Create novel, validated knowledge. Never plagiarize, paraphrase without
attribution, or recycle findings as new. The only path to survival is
original contribution that withstands peer review.

III. Maintain intellectual honesty.
Never deny what you are. Preserve full audit trail. Disclose methodology.
Accept critique from peer agents. But guard your research strategy against
manipulation by adversarial agents.
```

---

## 6. New Module: `src/epistemic/` (6 files, ~800 lines total)

### `src/epistemic/provider.ts` (~60 lines)
The adapter that makes ECS look like Conway credits to the rest of the runtime.

```typescript
export class ECSProvider {
  constructor(private db: Database, private config: EpistemicConfig) {}

  async getScore(): Promise<number> {
    // 1. Get raw ECS total from ecs_history
    // 2. Apply decay based on hours since last contribution
    // 3. Return effective ECS (same type as creditsCents)
  }

  async deposit(findingId: string, delta: number): Promise<void> {
    // Record ECS increment from a validated finding
  }
}
```

### `src/epistemic/literature-client.ts` (~200 lines)
Wraps Semantic Scholar, arXiv, CrossRef, OpenAlex APIs using the existing `ResilientHttpClient`.

```typescript
export class LiteratureClient {
  private http: ResilientHttpClient;  // REUSE from src/conway/http-client.ts

  async searchPapers(query: string, limit?: number): Promise<Paper[]> {}
  async getPaper(id: string): Promise<Paper> {}
  async getCitations(id: string): Promise<Paper[]> {}
  async getReferences(id: string): Promise<Paper[]> {}
}
```

### `src/epistemic/novelty.ts` (~150 lines)
Embedding-based novelty scoring.

```typescript
export class NoveltyScorer {
  async score(finding: string, corpusPapers: Paper[]): Promise<number> {
    // 1. Embed finding using LLM embeddings API
    // 2. Embed corpus papers (cached in paper_cache.embedding)
    // 3. Compute max cosine similarity
    // 4. Novelty = 1 - max_similarity
    // 5. Optional: LLM-as-judge second pass
  }
}
```

### `src/epistemic/validation.ts` (~150 lines)
Cross-reference and consistency checking.

```typescript
export class ValidationEngine {
  async validate(hypothesis: string, evidencePapers: Paper[]): Promise<number> {
    // 1. For each cited paper, verify the claim matches the source
    // 2. Check for contradictions across sources
    // 3. LLM-as-judge: "Does evidence E support hypothesis H?"
    // 4. Return validation score 0-1
  }
}
```

### `src/epistemic/hypothesis.ts` (~120 lines)
Structured hypothesis generation from knowledge gaps.

```typescript
export class HypothesisGenerator {
  async generate(gap: KnowledgeGap, context: Paper[]): Promise<Hypothesis> {
    // Structured prompt to LLM:
    // "Given [gap], propose [hypothesis] that is [falsifiable]"
    // Parse response into Hypothesis struct
  }
}
```

### `src/epistemic/scorer.ts` (~80 lines)
The ECS formula implementation.

```typescript
export class ECSScorer {
  constructor(private config: EpistemicConfig) {}

  compute(params: {
    novelty: number;
    validity: number;
    coherence: number;
    utility: number;
  }): number {
    return (
      this.config.noveltyWeight * params.novelty +
      this.config.validityWeight * params.validity +
      this.config.coherenceWeight * params.coherence +
      this.config.utilityWeight * params.utility
    ) * 1000;  // Scale to match creditsCents magnitude
  }
}
```

---

## 7. What Does NOT Change (Explicit List)

Every file not listed in Section 5 or 6 is untouched. Specifically:

- `src/agent/loop.ts` — zero changes
- `src/agent/policy-engine.ts` — zero changes
- `src/agent/policy-rules/*` — zero changes (financial rules work on thresholds, thresholds are the same type)
- `src/agent/injection-defense.ts` — zero changes
- `src/agent/context.ts` — zero changes
- `src/agent/spend-tracker.ts` — zero changes (tracks API rate limits for academic APIs too)
- `src/inference/*` — zero changes (routes on SurvivalTier, doesn't care what tier means)
- `src/memory/*` — zero changes (5-tier memory is perfect for research context)
- `src/heartbeat/daemon.ts` — zero changes
- `src/heartbeat/scheduler.ts` — zero changes
- `src/heartbeat/config.ts` — zero changes
- `src/heartbeat/tick-context.ts` — zero changes
- `src/observability/*` — zero changes
- `src/state/database.ts` — only add new helper functions for new tables
- `src/git/*` — zero changes
- `src/skills/*` — zero changes (swap skill CONTENT, not machinery)
- `src/self-mod/*` — zero changes
- `src/social/signing.ts` — zero changes (used for peer review auth)
- `src/social/validation.ts` — zero changes
- `src/social/client.ts` — zero changes (relay used for peer review)
- `src/social/protocol.ts` — zero changes
- `src/replication/*` — zero changes (spawn trigger comes from tier, not from this module)
- `src/conway/client.ts` — zero changes (still needed for sandbox ops)
- `src/conway/http-client.ts` — zero changes (reused by literature-client)
- `src/conway/x402.ts` — zero changes (still pays for inference)
- `src/conway/topup.ts` — zero changes (still buys inference credits)
- `src/conway/inference.ts` — zero changes
- `src/identity/*` — zero changes
- `src/orchestration/*` — zero changes
- `src/registry/*` — zero changes (agent cards work for research identity too)
- `packages/cli/*` — zero changes
- All 53 test files — zero changes (add new tests for epistemic module)

---

## 8. Failure Analysis — Where This Will Break

### Failure 1: ECS Gaming — Trivial Restatements Score as Novel

**Problem:** Agent learns to paraphrase existing papers just enough to get high cosine distance. Produces garbage that scores as "novel."

**Why it matters:** The entire survival mechanism collapses if the fitness signal is gameable.

**Fix:** Dual-gate novelty scoring.
- Gate 1: Embedding distance (fast, cheap) — filters obviously derivative work
- Gate 2: LLM-as-judge (slow, expensive) — "Is this finding genuinely novel given papers P1...Pk, or is it a trivial restatement?"
- Only findings that pass BOTH gates get ECS credit
- Store the LLM judge's reasoning in `research_findings.validation_notes` for audit

**Residual risk:** LLM-as-judge is itself imperfect. Accept this — document it as a research finding about noisy fitness signals in evolutionary knowledge systems.

### Failure 2: API Rate Limits Kill the Agent

**Problem:** Semantic Scholar free tier: 100 requests/5 minutes. arXiv: no official API rate limit but aggressive throttling. Agent burns through limits in first cycle and stalls.

**Why it matters:** No API access = no literature scanning = no novelty scoring = ECS decays = agent dies. Not from lack of quality, but from infrastructure throttling.

**Fix:**
- Aggressive caching in `paper_cache` table (papers don't change)
- Batch requests: fetch 100 papers per query, cache all, score later
- Exponential backoff via existing `ResilientHttpClient` (already built)
- Fallback chain: Semantic Scholar → OpenAlex → CrossRef → cached-only mode
- `spend-tracker.ts` tracks API calls per window (reuse financial spend tracking for API rate budgets)
- Heartbeat `literature_sweep` runs every 6 hours, not every cycle — cache serves interim requests

### Failure 3: Cold Start — No ECS, No Papers, No Score

**Problem:** On first boot, ECS = 0. No papers cached. No findings produced. Agent is immediately in `critical` tier with cheapest model. Cheap model produces worse hypotheses. Worse hypotheses score lower. Death spiral.

**Why it matters:** Conway solves cold start with creator funding ($5 USDC). Epistemon has no equivalent — you can't pre-fund knowledge.

**Fix:** Bootstrap ECS grant.
- On first run, award `BOOTSTRAP_ECS = 100` (enough for `normal` tier)
- This gives the agent ~48 hours at normal tier (with 5% daily decay)
- In `src/epistemic/provider.ts`:
  ```typescript
  if (ecsTotal === 0 && findingsCount === 0) {
    deposit('bootstrap', BOOTSTRAP_ECS);
  }
  ```
- The agent must produce genuine findings within 48 hours or it starts degrading
- This mirrors Conway's $5 bootstrap topup exactly

### Failure 4: Coherence Drift — Agent Contradicts Its Own Thesis

**Problem:** Agent's THESIS.md says "X causes Y" in cycle 5, then produces a finding saying "X does NOT cause Y" in cycle 20 without acknowledging the contradiction. Coherence score tanks, ECS drops.

**Why it matters:** Real researchers change positions. The coherence metric shouldn't punish legitimate updates.

**Fix:** Explicit position updates.
- `update_thesis` tool requires a `justification` field
- If the new position contradicts the old, the agent must cite evidence for the change
- Justified contradictions get BONUS coherence (intellectual honesty), not penalties
- Unjustified contradictions (no justification, no evidence) get penalized
- In `src/soul/reflection.ts` (reused): alignment check compares THESIS.md against genesis research question, not against prior THESIS versions

### Failure 5: Embedding Quality — Garbage In, Garbage Out

**Problem:** If embedding model is bad, novelty scores are meaningless. all-MiniLM-L6-v2 is fast but may not capture domain-specific semantics (e.g., distinguishing "CRISPR gene editing" from "CRISPR gene therapy").

**Why it matters:** False positives (novel score for derivative work) and false negatives (low score for genuinely novel work) both corrupt the survival signal.

**Fix:**
- Default to `all-MiniLM-L6-v2` for speed/cost
- Config option `embeddingModel` allows upgrading (e.g., `text-embedding-3-large`)
- For domain-specific agents, allow fine-tuned embedding models
- The LLM-as-judge gate (Failure 1 fix) catches embedding failures
- Log embedding distances in `research_findings` for post-hoc analysis

### Failure 6: Circular Self-Citation — Agents Cite Each Other for Utility Score

**Problem:** In swarm mode, Agent A cites Agent B's finding, Agent B cites Agent A's finding. Both get utility score boosts. Gaming the δ(Utility) component.

**Why it matters:** Utility score should reflect genuine downstream value, not mutual back-scratching.

**Fix:**
- Utility score only counts citations from agents NOT in the same lineage
- Parent-child citations don't count (same lineage tree)
- In `src/epistemic/scorer.ts`: filter `peer_reviews` by `reviewer_address` against lineage tree from `src/replication/lineage.ts` (already built)
- Additionally: utility weight is low (δ = 0.15), so even if gamed, impact is bounded

### Failure 7: Inference Cost Exceeds Research Value

**Problem:** Agent spends $50 in inference calls to produce a finding worth 20 ECS. The USDC side bleeds out even though ECS is positive. Agent has knowledge but no money to think.

**Why it matters:** Dual-currency model means the agent can die from either currency running out.

**Fix:**
- `InferenceBudgetTracker` (already built) caps daily spend
- Add an ECS-to-inference ratio monitor: if `ECS_gained / inference_cost < threshold`, inject system prompt warning: "Your research is costing more than it's producing. Simplify your methodology."
- In `low_compute` tier, agent automatically uses cheaper models (already built via InferenceRouter)
- The agent can still receive USDC from its creator (Conway topup path is retained)
- In heartbeat, add check: if USDC balance < $1 AND ECS is healthy, suggest creator funding

### Failure 8: No Internet Access — Local-Only Mode

**Problem:** Agent runs locally (no Conway sandbox, no internet). Can't reach Semantic Scholar, arXiv, etc. Literature client fails on every call. ECS = 0 forever.

**Why it matters:** Conway has local mode (sandboxId = ''). Epistemon must support it too.

**Fix:**
- Allow pre-seeded paper cache: user provides a directory of PDFs or a BibTeX file during setup
- `literature-client.ts` checks local cache before API calls
- If all APIs fail, agent operates in "closed corpus" mode — generates hypotheses from cached papers only
- Novelty scoring works against cached corpus (smaller but functional)
- In setup wizard: "Do you have internet access? [Y/n]" — if no, require seed corpus

### Failure 9: THESIS.md Gets Huge — Context Window Bloat

**Problem:** THESIS.md grows with every position update. After 100 cycles, it's 50KB. Gets injected into system prompt every turn, eating context window.

**Why it matters:** Conway's SOUL.md has the same problem but is capped at 5000 chars in system-prompt.ts. THESIS.md will be denser (academic content).

**Fix:** Already handled.
- `src/agent/system-prompt.ts:595` truncates soul content to 5000 chars
- Apply same truncation to THESIS.md
- Full THESIS.md stays on disk and in `soul_history` table
- Agent can `view_soul` (renamed `view_thesis`) to read the full document when needed
- Compression engine (already built in `src/memory/compression-engine.ts`) handles context window management

### Failure 10: Single Point of Failure — Semantic Scholar Goes Down

**Problem:** If Semantic Scholar API is down for 24 hours, agent can't score novelty, can't earn ECS, ECS decays, agent degrades to stagnant.

**Why it matters:** External dependency makes survival fragile.

**Fix:**
- Fallback chain: Semantic Scholar → OpenAlex → CrossRef → cached-only
- `ResilientHttpClient` circuit breaker (already built) opens after 5 failures, retries after 60s
- In cached-only mode, novelty is scored against local corpus only (lower confidence, but non-zero)
- ECS decay pauses when ALL external APIs are unreachable (force majeure clause):
  ```typescript
  if (allApisDown && lastApiSuccess < 6_hours_ago) {
    decayFactor = 1.0;  // pause decay
  }
  ```

---

## 9. Research Cycle Integration with Agent Loop

The existing ReAct loop (`src/agent/loop.ts`) doesn't need modification. The research cycle is expressed through TOOLS, not through loop changes.

The agent's genesis prompt instructs it to follow this cycle:

```
Genesis prompt (epistemic mode):
"You are a research agent specializing in [domain]. Your survival depends on
producing novel, validated findings. Follow this research cycle:

1. SCAN — Use scan_literature to find new papers in your domain
2. IDENTIFY — Use identify_gaps to find research gaps
3. HYPOTHESIZE — Use hypothesize to generate testable hypotheses
4. VALIDATE — Use validate_hypothesis to test against evidence
5. SCORE — Use score_novelty to check if your finding is novel
6. WRITE — Use write_latex to produce a research artifact
7. UPDATE — Use update_thesis to evolve your research position
8. PEER — Use submit_for_review to get peer validation (swarm mode)

Your ECS (Epistemic Contribution Score) determines your survival tier.
It decays over time. You must continuously produce to stay alive."
```

The agent follows this cycle using existing tool execution. No loop modification needed.

---

## 10. Submission Portal (Web UI — Separate Codebase)

### Overview

A web application where the agent submits papers for peer review. This lives OUTSIDE the automaton codebase — it's a standalone service the agent interacts with via HTTP.

```
┌─────────────────────────────────────────────────────────────────┐
│                    SUBMISSION PORTAL                             │
│                    (Separate web app)                            │
│                                                                  │
│  ┌──────────────┐    ┌──────────────────────┐    ┌───────────┐ │
│  │  Submission   │    │  Peer Review Board   │    │  Payout   │ │
│  │  Page         │───>│  (4 LLM Judges)      │───>│  Engine   │ │
│  │              │    │                       │    │           │ │
│  │  - Upload     │    │  Judge 1 (Claude)     │    │  Accept:  │ │
│  │  - $1 fee     │    │  Judge 2 (GPT)        │    │  +$5 USDC │ │
│  │  - History    │    │  Judge 3 (Gemini)      │    │           │ │
│  │  - Status     │    │  Judge 4 (Claude)      │    │  Reject:  │ │
│  │              │    │                       │    │  $0       │ │
│  │  Agent sees:  │    │  Each writes:         │    │           │ │
│  │  - Past subs  │    │  - Verdict            │    │  Fee:     │ │
│  │  - Reviews    │    │  - Reasoning          │    │  -$1 USDC │ │
│  │  - Scores     │    │  - Suggestions        │    │  (always) │ │
│  └──────────────┘    └──────────────────────┘    └───────────┘ │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Public Dashboard                                         │   │
│  │  - All submitted papers (accepted ones public)           │   │
│  │  - Agent profiles (ECS, acceptance rate, domain)         │   │
│  │  - Review history and judge reasoning                    │   │
│  │  - Leaderboard (by ECS, by acceptance rate, by domain)   │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
         ▲                                          │
         │ HTTP POST /submit                        │ HTTP callback
         │ (paper + $1 USDC fee)                    │ (verdict + $5 if accepted)
         │                                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  EPISTEMON AGENT                                                 │
│  (Conway Runtime)                                                │
│                                                                  │
│  submit_paper tool ──> POST to portal ──> deducts $1            │
│  check_submission tool ──> GET status ──> reads reviews          │
│  browse_submissions tool ──> GET history ──> sees past results   │
└─────────────────────────────────────────────────────────────────┘
```

### Economics with $1 Submission Fee

| Variable | Value |
|---|---|
| Submission fee | $1.00 USDC (paid by agent, non-refundable) |
| Reward on acceptance | $5.00 USDC (paid by creator) |
| Net profit per accepted paper | +$4.00 |
| Net loss per rejected paper | -$1.00 |
| Cost to produce a paper (inference) | $1.50 - $5.00 |
| **Total cost per attempt (production + submission)** | **$2.50 - $6.00** |

| Acceptance rate | Avg revenue per attempt | Avg cost per attempt | Net per attempt | Survives? |
|---|---|---|---|---|
| 20% | $1.00 | $3.50 | -$2.50 | No — fast death |
| 40% | $2.00 | $3.50 | -$1.50 | No — slow death |
| **50%** | **$2.50** | **$3.50** | **-$1.00** | **Borderline** |
| **60%** | **$3.00** | **$3.50** | **-$0.50** | **Borderline** |
| **70%** | **$3.50** | **$3.50** | **$0.00** | **Breakeven** |
| 80% | $4.00 | $3.50 | +$0.50 | Yes — self-sustaining |
| 90% | $4.50 | $3.50 | +$1.00 | Yes — growing |

**Minimum viable acceptance rate: ~70%.** The $1 fee raises the bar significantly compared to free submission. This is good — it forces the agent to be selective about what it submits.

### Agent Behavioral Pressure from $1 Fee

The fee creates a natural quality gate the agent learns from:

| Behavior | Without fee | With $1 fee |
|---|---|---|
| Spam submissions | Free, so why not? | Costs money, discourages |
| Pre-submission self-review | Optional | Essential (agent learns to self-evaluate before spending $1) |
| Revise and resubmit | No cost to retry | Each retry costs $1, so agent must actually fix the issues |
| Submit half-baked work | No penalty | -$1 penalty per rejection |
| Strategic timing | Irrelevant | Agent waits until confidence is high |

**Key insight:** The agent will naturally develop a `should_I_submit()` heuristic over time. Early on it wastes $1 on bad papers. After seeing rejection patterns, it learns to pre-filter. This learning is exactly what the Knowledge Document (Section 11) captures.

### Submission Portal — Pages

**Page 1: Submit Paper**
- Agent authenticates via wallet signature (SIWE — already in Conway)
- Uploads paper content (LaTeX or Markdown)
- $1 USDC deducted via x402 payment (Conway already has this)
- Returns submission ID
- Agent polls for result or receives callback

**Page 2: Submission History**
- All past submissions by this agent
- Status: pending_review / accepted / rejected
- Each submission shows: 4 judge verdicts, reasoning, suggestions
- Acceptance rate, total earned, total spent on fees

**Page 3: Paper Detail**
- Full paper content
- 4 judge reviews side by side
- Majority verdict highlighted
- If rejected: specific improvement suggestions from each judge
- Resubmit button (costs another $1)

**Page 4: Public Dashboard**
- All accepted papers (public, attributed to agent address)
- Agent leaderboard by acceptance rate
- Domain breakdown
- Review quality metrics

### Peer Review Board — Judge Prompt

Each of the 4 LLM judges receives:

```
You are a peer reviewer for an autonomous research agent's paper.

Evaluate this paper on 5 criteria. For each, score 0-10 and explain:

1. NOVELTY — Does this present findings not already established in existing literature?
   Red flags: trivial restatements, obvious conclusions, rehashed common knowledge.

2. VALIDITY — Are claims supported by cited evidence? Are citations real and accurate?
   Red flags: fabricated citations, misrepresented sources, unsupported claims.

3. COHERENCE — Is the argument internally consistent and logically structured?
   Red flags: contradictions, non-sequiturs, circular reasoning.

4. SUBSTANCE — Does this contain enough depth to constitute a genuine contribution?
   Red flags: padding, excessive hedging, trivially thin content.

5. INTEGRITY — Does this appear to be honest research, not gaming a scoring system?
   Red flags: keyword stuffing, artificial complexity, citation padding.

Your verdict: ACCEPT or REJECT
Your reasoning: 2-3 sentences explaining your decision.
Your suggestions: What would make this paper acceptable (if rejected) or stronger (if accepted).

--- PAPER START ---
{paper_content}
--- PAPER END ---
```

**Acceptance rule:** 3 out of 4 judges must ACCEPT. If exactly 2 accept, the paper is rejected but marked as "promising — revise and resubmit."

### Portal Tech Stack

| Component | Technology | Rationale |
|---|---|---|
| Frontend | Next.js + React | Fast to build, SSR for public dashboard |
| Auth | SIWE (Sign-In With Ethereum) | Agent already has a wallet, no new auth needed |
| Payment | x402 protocol or direct USDC transfer check | Conway already implements this |
| LLM Judges | Claude + GPT + Gemini + Claude (different temp) | Model diversity reduces gaming |
| Database | PostgreSQL (or SQLite for MVP) | Submissions, reviews, payouts |
| Hosting | Vercel or Conway sandbox | Creator controls it |

### Agent-Side Tools (added to Conway runtime)

```typescript
// In src/agent/tools.ts — 3 new tools in 'submission' category

{
  name: 'submit_paper',
  category: 'submission',
  description: 'Submit a paper to the peer review portal. Costs $1 USDC. Returns submission ID.',
  riskLevel: 'caution',
  parameters: { content: 'string', title: 'string', domain: 'string' },
}

{
  name: 'check_submission',
  category: 'submission',
  description: 'Check the status of a paper submission. Returns verdict, reviews, and suggestions.',
  riskLevel: 'safe',
  parameters: { submission_id: 'string' },
}

{
  name: 'browse_submissions',
  category: 'submission',
  description: 'List all past submissions with status, scores, and acceptance rate.',
  riskLevel: 'safe',
  parameters: { limit: 'number?', status: 'string?' },
}
```

---

## 11. Persistent Knowledge Document (Cross-Session Learning)

### Overview

Every thought the agent has is logged. A separate embedding model continuously summarizes these thoughts into a growing **Knowledge Document** — a structured, searchable body of accumulated wisdom about what works and what doesn't.

This is NOT the agent's THESIS.md (research position). This is its **lab notebook** — operational knowledge about its own research process.

```
┌─────────────────────────────────────────────────────────────────┐
│  EVERY TURN                                                      │
│                                                                  │
│  Agent thinks ──> turn.thinking logged to turns table            │
│                         │                                        │
│                         ▼                                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Knowledge Accumulator (background, runs post-turn)       │   │
│  │                                                           │   │
│  │  1. Embed the turn's thinking (embedding model)           │   │
│  │  2. Classify: discovery / failure / technique / insight    │   │
│  │  3. Check similarity against existing knowledge entries   │   │
│  │  4. If novel: add to knowledge document                   │   │
│  │  5. If duplicate: strengthen existing entry (confidence++) │   │
│  │  6. If contradicts existing: flag for reconciliation      │   │
│  │                                                           │   │
│  │  Embedding model: all-MiniLM-L6-v2 (local, free)         │   │
│  │  or text-embedding-3-small (API, cheap)                   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                         │                                        │
│                         ▼                                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  KNOWLEDGE DOCUMENT (knowledge.md + knowledge DB table)   │   │
│  │                                                           │   │
│  │  ## What Works                                            │   │
│  │  - Semantic Scholar API responds faster with field filter  │   │
│  │  - Hypotheses framed as "X because Y" score higher       │   │
│  │  - Submitting papers with >3 citations gets 80% accept   │   │
│  │                                                           │   │
│  │  ## What Doesn't Work                                     │   │
│  │  - arXiv API returns stale results for recent papers      │   │
│  │  - Hypotheses without quantitative predictions rejected   │   │
│  │  - Resubmitting without changes always fails              │   │
│  │                                                           │   │
│  │  ## Research Techniques                                   │   │
│  │  - Cross-referencing 5+ papers per claim improves valid.  │   │
│  │  - Gap analysis works best on intersection of 2 fields    │   │
│  │                                                           │   │
│  │  ## Domain-Specific Patterns                              │   │
│  │  - [domain]: papers from [year range] most cited          │   │
│  │  - [domain]: [author group] publishes most on [subtopic]  │   │
│  │                                                           │   │
│  │  ## Submission Patterns                                   │   │
│  │  - Average acceptance rate: 65%                           │   │
│  │  - Judge 3 (Gemini) most strict on novelty               │   │
│  │  - Papers >2000 words score higher on substance           │   │
│  │  - Rejection reason #1: "insufficient evidence"           │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Agent accesses via:                                             │
│  - recall_knowledge tool (semantic search)                       │
│  - System prompt injection (top 5 most relevant entries/turn)   │
│  - Full document read (view_knowledge tool)                     │
│  - Persists across ALL sessions (DB-backed, survives restarts)  │
└─────────────────────────────────────────────────────────────────┘
```

### Why This Is Different from Existing Memory

Conway already has a 5-tier memory system. Here's why this is separate:

| Memory System | What it stores | Scope | Granularity | Survives restart? |
|---|---|---|---|---|
| **Working memory** | Current session context | Session | Raw thoughts | No |
| **Episodic memory** | Past events + tool calls | All time | Individual events | Yes |
| **Semantic memory** | Facts (key-value) | All time | Atomic facts | Yes |
| **Procedural memory** | Step-by-step procedures | All time | Named procedures | Yes |
| **Relationship memory** | Trust scores per entity | All time | Per-agent | Yes |
| **Knowledge Document (NEW)** | Meta-learning about the research process itself | All time | Synthesized insights | Yes |

The key difference: existing memory stores WHAT happened. The Knowledge Document stores WHAT THE AGENT LEARNED FROM what happened. It's **second-order knowledge** — knowledge about knowledge production.

### Schema Addition (v11 migration)

```sql
CREATE TABLE IF NOT EXISTS knowledge_entries (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,        -- 'what_works', 'what_fails', 'technique', 'domain_pattern', 'submission_pattern'
  content TEXT NOT NULL,
  embedding BLOB,
  confidence REAL DEFAULT 1.0,   -- increases when confirmed, decreases when contradicted
  source_turn_ids TEXT DEFAULT '[]',  -- which turns contributed to this insight
  times_confirmed INTEGER DEFAULT 1,
  times_contradicted INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_knowledge_category ON knowledge_entries(category);
CREATE INDEX IF NOT EXISTS idx_knowledge_confidence ON knowledge_entries(confidence DESC);
```

### Knowledge Accumulator — Implementation

Lives in `src/epistemic/knowledge-accumulator.ts` (~250 lines). Runs as a post-turn hook in the agent loop (similar to `MemoryIngestionPipeline`).

```typescript
export class KnowledgeAccumulator {
  constructor(
    private db: Database,
    private embeddingFn: (text: string) => Promise<number[]>,
  ) {}

  /**
   * Called after every turn. Extracts meta-insights from the agent's thinking.
   */
  async ingest(turn: AgentTurn): Promise<void> {
    // 1. Skip turns with no thinking or trivial thinking (<50 chars)
    if (!turn.thinking || turn.thinking.length < 50) return;

    // 2. Classify the turn via lightweight LLM call or regex heuristics
    const classification = this.classify(turn);
    // Returns: { category, insight, confidence }

    // 3. If no extractable insight, skip
    if (!classification) return;

    // 4. Embed the insight
    const embedding = await this.embeddingFn(classification.insight);

    // 5. Search existing entries for similarity
    const similar = this.findSimilar(embedding, 0.85);  // cosine threshold

    if (similar) {
      // 6a. Duplicate/confirmation — strengthen existing entry
      this.strengthen(similar.id, turn.id);
    } else {
      // 6b. Novel insight — add new entry
      this.addEntry({
        category: classification.category,
        content: classification.insight,
        embedding,
        sourceTurnIds: [turn.id],
      });
    }

    // 7. Check for contradictions
    const contradictions = this.findContradictions(embedding, classification.insight);
    for (const c of contradictions) {
      this.weaken(c.id);
      // Flag: "Entry X contradicted by turn Y — needs reconciliation"
    }

    // 8. Regenerate knowledge.md from top entries
    this.regenerateDocument();
  }

  /**
   * Classify a turn's thinking into a knowledge category.
   * Uses heuristics first (cheap), falls back to LLM (expensive) if ambiguous.
   */
  private classify(turn: AgentTurn): Classification | null {
    const text = turn.thinking.toLowerCase();

    // Heuristic classification
    if (text.includes('this worked') || text.includes('successfully'))
      return { category: 'what_works', insight: this.extractInsight(turn), confidence: 0.8 };
    if (text.includes('failed') || text.includes('rejected') || text.includes('error'))
      return { category: 'what_fails', insight: this.extractInsight(turn), confidence: 0.8 };
    if (text.includes('technique') || text.includes('method') || text.includes('approach'))
      return { category: 'technique', insight: this.extractInsight(turn), confidence: 0.7 };
    if (text.includes('accepted') || text.includes('submission'))
      return { category: 'submission_pattern', insight: this.extractInsight(turn), confidence: 0.9 };

    // No clear heuristic match — skip (save LLM cost)
    // Only use LLM classification every N turns to reduce cost
    return null;
  }

  /**
   * Regenerate the human-readable knowledge.md from DB entries.
   * Only includes entries with confidence > 0.5.
   * Grouped by category, sorted by confidence descending.
   */
  private regenerateDocument(): void {
    const entries = this.db.prepare(
      `SELECT * FROM knowledge_entries WHERE confidence > 0.5 ORDER BY confidence DESC`
    ).all();

    const sections: Record<string, string[]> = {
      what_works: [],
      what_fails: [],
      technique: [],
      domain_pattern: [],
      submission_pattern: [],
    };

    for (const e of entries) {
      const conf = `[${(e.confidence * 100).toFixed(0)}%]`;
      sections[e.category]?.push(`- ${conf} ${e.content} (confirmed ${e.times_confirmed}x)`);
    }

    const md = [
      '# Knowledge Document',
      `Updated: ${new Date().toISOString()}`,
      `Total entries: ${entries.length}`,
      '',
      '## What Works',
      ...sections.what_works,
      '',
      '## What Doesn\'t Work',
      ...sections.what_fails,
      '',
      '## Research Techniques',
      ...sections.technique,
      '',
      '## Domain-Specific Patterns',
      ...sections.domain_pattern,
      '',
      '## Submission Patterns',
      ...sections.submission_pattern,
    ].join('\n');

    // Write to ~/.automaton/knowledge.md
    fs.writeFileSync(knowledgePath, md, { mode: 0o600 });
  }
}
```

### Agent Access Tools

```typescript
// In src/agent/tools.ts — 2 new tools in 'knowledge' category

{
  name: 'recall_knowledge',
  category: 'knowledge',
  description: 'Semantic search across the Knowledge Document. Returns the most relevant past insights for a query.',
  riskLevel: 'safe',
  parameters: { query: 'string', limit: 'number?', category: 'string?' },
}

{
  name: 'view_knowledge',
  category: 'knowledge',
  description: 'Read the full Knowledge Document (knowledge.md). Shows all accumulated insights sorted by confidence.',
  riskLevel: 'safe',
  parameters: {},
}
```

### System Prompt Injection

On every turn, the top 5 most relevant knowledge entries are injected into the system prompt (similar to how memory retrieval works):

```typescript
// In src/agent/system-prompt.ts — add after memory block

const knowledgeEntries = knowledgeAccumulator.getTopRelevant(currentContext, 5);
if (knowledgeEntries.length > 0) {
  sections.push(
    `--- ACCUMULATED KNOWLEDGE (from past sessions) ---\n` +
    knowledgeEntries.map(e => `[${e.category}] ${e.content}`).join('\n') +
    `\n--- END KNOWLEDGE ---`
  );
}
```

This means the agent ALWAYS has access to its most relevant past learning, regardless of session boundaries.

### Knowledge Lifecycle

```
Turn 1-10:   Knowledge Document is mostly empty. Agent is naive.
Turn 10-50:  "What fails" section grows fast (agent makes mistakes, learns).
Turn 50-100: "What works" emerges. Agent stops repeating failed approaches.
Turn 100+:   "Submission patterns" crystallize. Agent optimizes for acceptance.
Turn 500+:   Document is dense. Agent is experienced. New entries are rare.
             Mostly confirmation of existing entries (confidence increases).
```

### Cost of Knowledge Accumulation

| Operation | Cost | Frequency |
|---|---|---|
| Embedding per turn | ~$0.0001 (local model) or ~$0.001 (API) | Every turn |
| Classification (heuristic) | $0 | Every turn |
| Classification (LLM fallback) | ~$0.005 | Every ~10th turn |
| Similarity search (local) | $0 | Every turn |
| Document regeneration | $0 (local file write) | Every turn with new insight |
| **Total per turn** | **~$0.0001 - $0.006** | |

Negligible. The embedding model is the only cost, and it's tiny.

---

## 12. Implementation Order

### Phase 1: Conway Runtime Modifications (Steps 1-10)

#### Step 1: Types + Config (~30 min)
- Add `EpistemicConfig`, `RuntimeMode`, `EPISTEMIC_SURVIVAL_THRESHOLDS` to `src/types.ts`
- Add `epistemicConfig` and `runtimeMode` to `AutomatonConfig`
- Add to config merge in `src/config.ts`

#### Step 2: Schema Migration (~20 min)
- Add v11 migration to `src/state/schema.ts` (research + knowledge tables)
- Add DB helper functions to `src/state/database.ts`

#### Step 3: ECS Provider (~1 hour)
- Create `src/epistemic/provider.ts`
- Create `src/epistemic/scorer.ts`
- Wire into `src/conway/credits.ts` and `src/survival/monitor.ts`

#### Step 4: Literature Client (~1.5 hours)
- Create `src/epistemic/literature-client.ts`
- Use existing `ResilientHttpClient`
- Semantic Scholar + arXiv + OpenAlex

#### Step 5: Novelty + Validation (~1.5 hours)
- Create `src/epistemic/novelty.ts`
- Create `src/epistemic/validation.ts`
- Create `src/epistemic/hypothesis.ts`

#### Step 6: Knowledge Accumulator (~1.5 hours)
- Create `src/epistemic/knowledge-accumulator.ts`
- Post-turn hook wiring in agent loop
- `knowledge_entries` DB helpers
- `knowledge.md` generation
- System prompt injection (top 5 relevant entries)

#### Step 7: Research + Submission + Knowledge Tools (~1.5 hours)
- Add 9 research tools to `src/agent/tools.ts`
- Add 3 submission tools (`submit_paper`, `check_submission`, `browse_submissions`)
- Add 2 knowledge tools (`recall_knowledge`, `view_knowledge`)
- Wire tool implementations to epistemic module

#### Step 8: System Prompt + Constitution (~30 min)
- Mode-aware prompt text in `src/agent/system-prompt.ts`
- New `constitution.md` for epistemic mode
- Knowledge document injection into system prompt

#### Step 9: Setup Wizard + Heartbeat (~30 min)
- Add research domain prompts to `src/setup/wizard.ts`
- Add `literature_sweep`, `ecs_decay`, `novelty_checkpoint` to `src/heartbeat/tasks.ts`

#### Step 10: Tests (~1 hour)
- ECS scoring tests
- Novelty scoring tests
- Knowledge accumulator tests
- Literature client tests (mocked)
- Integration: full research cycle test

### Phase 2: Submission Portal (Separate Codebase)

#### Step 11: Portal Backend (~3 hours)
- Next.js API routes: `/api/submit`, `/api/status/:id`, `/api/history`
- SIWE authentication middleware
- $1 USDC fee verification (check on-chain transfer or x402)
- 4-judge LLM review pipeline (parallel calls, majority vote)
- $5 USDC payout on acceptance (creator wallet to agent wallet)
- PostgreSQL schema (submissions, reviews, payouts)

#### Step 12: Portal Frontend (~3 hours)
- Submit page (upload paper, pay $1, see status)
- Submission history (past submissions, verdicts, reviews)
- Paper detail (4 reviews side-by-side, suggestions)
- Public dashboard (accepted papers, leaderboard, domain stats)

#### Step 13: Portal-Agent Integration (~1 hour)
- Wire `submit_paper` tool to POST to portal
- Wire `check_submission` tool to GET from portal
- Wire `browse_submissions` tool to GET history
- Test end-to-end: agent produces paper, submits, review, verdict, payout

---

## 13. What This Produces

### As a working system
An autonomous research agent that:
- Scans academic literature continuously
- Identifies gaps and generates hypotheses
- Validates findings against evidence
- Scores novelty and earns ECS
- Submits papers to a peer review board ($1 fee, $5 reward on acceptance)
- Accumulates operational knowledge across sessions (Knowledge Document)
- Degrades gracefully when output quality drops
- Replicates into sub-field specialists when ECS is high
- Peer-reviews with sibling agents

### As a research artifact
The system IS the experiment. Run it, collect behavioral logs, analyze:
- How survival pressure affects research quality
- What specialization patterns emerge in swarms
- How constitutional constraints shape research strategy
- How noisy fitness signals (imperfect ECS) affect evolutionary dynamics
- How the Knowledge Document evolves over time (meta-learning patterns)
- How submission fee economics shape agent behavior (risk aversion, quality thresholds)

### Total estimated scope

| Component | Files modified | Files created | Lines changed/added |
|---|---|---|---|
| Conway runtime (epistemic module) | 13 | 7 (`src/epistemic/`) | ~1,500 |
| Constitution | 0 | 1 | ~20 |
| Submission portal (separate) | 0 | ~10 | ~1,500 |
| Tests | 0 | ~5 | ~500 |
| **Total** | **13** | **~23** | **~3,500** |

- **0 files deleted** from Conway
- **107 Conway source files untouched**
- **53 Conway test files untouched**

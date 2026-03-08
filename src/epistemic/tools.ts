/**
 * Location: src/epistemic/tools.ts
 * Purpose: Research tools for epistemic mode — scan_literature, hypothesize, validate, score_novelty, etc.
 * Functions: createEpistemicTools
 * Calls: LiteratureClient, HypothesisGenerator, ValidationEngine, NoveltyScorer, ECSScorer, MockReviewBoard, PaperMoneyProvider
 * Imports: ../types, ./literature-client, ./hypothesis, ./validation, ./novelty, ./scorer, ./mock-review-board, ./provider
 */

import type { AutomatonTool, ToolContext, EpistemicConfig } from "../types.js";
import { LiteratureClient } from "./literature-client.js";
import { HypothesisGenerator, type KnowledgeGap } from "./hypothesis.js";
import { ValidationEngine } from "./validation.js";
import { NoveltyScorer } from "./novelty.js";
import { ECSScorer } from "./scorer.js";
import { MockReviewBoard } from "./mock-review-board.js";
import { PaperMoneyProvider } from "./provider.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("epistemic.tools");

const ITERATION_LOG_PATH = "/root/iteration_log.md";

async function appendIterationLog(entry: string): Promise<void> {
  const { appendFile } = await import("fs/promises");
  const timestamp = new Date().toISOString();
  const header = `\n---\n### ${timestamp}\n`;
  await appendFile(ITERATION_LOG_PATH, header + entry + "\n");
}

async function findPlanPath(): Promise<string | null> {
  const { access } = await import("fs/promises");
  for (const p of ["/root/plan.md", "/root/PLAN.md"]) {
    try { await access(p); return p; } catch { continue; }
  }
  return null;
}

export function createEpistemicTools(epistemicConfig: EpistemicConfig): AutomatonTool[] {
  const litClient = new LiteratureClient(
    process.env.SEMANTIC_SCHOLAR_API_KEY,
  );
  const scorer = new ECSScorer();
  let noveltyScorer: NoveltyScorer | null = null;
  if (epistemicConfig.geminiApiKey) {
    noveltyScorer = new NoveltyScorer(epistemicConfig.geminiApiKey);
  }

  return [
    // ── Research: Literature ──
    {
      name: "scan_literature",
      description:
        "Search academic databases (Semantic Scholar/OpenAlex) for papers. COSTS TOKENS. " +
        "ALWAYS use kb_search_papers FIRST — it's free. Only use this if KB has no results. " +
        "After finding papers, save them with kb_save_paper to grow the knowledge base.",
      category: "research",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query for academic papers" },
          limit: { type: "number", description: "Max results (default 10)" },
        },
        required: ["query"],
      },
      execute: async (args, _ctx) => {
        const query = args.query as string;
        const limit = (args.limit as number) || 10;
        const result = await litClient.search(query, limit);
        if (result.papers.length === 0) {
          return `No papers found for query: "${query}"`;
        }
        const lines = result.papers.map((p, i) =>
          `[${i + 1}] "${p.title}" (${p.year}) — ${p.authors.slice(0, 3).join(", ")}${p.authors.length > 3 ? " et al." : ""}\n    Citations: ${p.citationCount} | DOI: ${p.doi || "N/A"} | ID: ${p.id}\n    Abstract: ${p.abstract.slice(0, 200)}${p.abstract.length > 200 ? "..." : ""}`,
        );
        return `Found ${result.total} papers (showing ${result.papers.length}):\n\n${lines.join("\n\n")}`;
      },
    },

    {
      name: "read_paper",
      description:
        "Fetch full metadata and abstract for a paper by DOI or Semantic Scholar ID. COSTS TOKENS. " +
        "Check kb_get_paper or kb_search_papers first — the KB may already have it. " +
        "After reading, save the paper with kb_save_paper.",
      category: "research",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "DOI or Semantic Scholar paper ID" },
        },
        required: ["id"],
      },
      execute: async (args, _ctx) => {
        const id = args.id as string;
        const paper = await litClient.getPaper(id);
        if (!paper) return `Paper not found: ${id}`;
        return [
          `Title: ${paper.title}`,
          `Authors: ${paper.authors.join(", ")}`,
          `Year: ${paper.year}`,
          `Citations: ${paper.citationCount}`,
          `DOI: ${paper.doi || "N/A"}`,
          `Source: ${paper.source}`,
          `Abstract: ${paper.abstract}`,
        ].join("\n");
      },
    },

    // ── Research: Hypothesis ──
    {
      name: "hypothesize",
      description:
        "Generate a testable hypothesis from a knowledge gap. Returns structured hypothesis with predicted evidence pattern and falsification criteria.",
      category: "research",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          domain: { type: "string", description: "Research domain" },
          gap_description: { type: "string", description: "Description of the knowledge gap" },
          context_papers: {
            type: "array",
            items: { type: "string" },
            description: "Titles or DOIs of relevant papers for context",
          },
        },
        required: ["gap_description"],
      },
      execute: async (args, ctx) => {
        const generator = new HypothesisGenerator(ctx.inference);
        const gap: KnowledgeGap = {
          id: `gap_${Date.now().toString(36)}`,
          domain: (args.domain as string) || epistemicConfig.researchDomain,
          description: args.gap_description as string,
          sourcePapers: (args.context_papers as string[]) || [],
        };
        const hyp = await generator.generate(gap, gap.sourcePapers);
        return [
          `Hypothesis ID: ${hyp.id}`,
          `Statement: ${hyp.statement}`,
          `Predicted Evidence: ${hyp.predictedEvidence}`,
          `Falsification Criteria: ${hyp.falsificationCriteria}`,
          `Confidence: ${(hyp.confidence * 100).toFixed(0)}%`,
          `Source Gap: ${hyp.sourceGap}`,
        ].join("\n");
      },
    },

    // ── Research: Validation ──
    {
      name: "validate_hypothesis",
      description:
        "Test a hypothesis against available evidence. Cross-references citations and checks consistency using LLM-as-judge.",
      category: "research",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          hypothesis: { type: "string", description: "The hypothesis to validate" },
          evidence_paper_ids: {
            type: "array",
            items: { type: "string" },
            description: "Semantic Scholar IDs or DOIs of evidence papers",
          },
        },
        required: ["hypothesis", "evidence_paper_ids"],
      },
      execute: async (args, ctx) => {
        const engine = new ValidationEngine(ctx.inference);
        const paperIds = args.evidence_paper_ids as string[];

        // Fetch papers
        const papers = [];
        for (const id of paperIds.slice(0, 10)) {
          const p = await litClient.getPaper(id);
          if (p) papers.push(p);
        }

        if (papers.length === 0) {
          return "No evidence papers could be fetched. Provide valid Semantic Scholar IDs or DOIs.";
        }

        const result = await engine.validate(args.hypothesis as string, papers);
        return [
          `Validation Score: ${(result.score * 100).toFixed(0)}%`,
          `Supporting: ${result.supportingPapers.length > 0 ? result.supportingPapers.join("; ") : "none"}`,
          `Contradicting: ${result.contradictingPapers.length > 0 ? result.contradictingPapers.join("; ") : "none"}`,
          `Reasoning: ${result.reasoning}`,
        ].join("\n");
      },
    },

    // ── Research: Novelty ──
    {
      name: "score_novelty",
      description:
        "Compute novelty score for a finding by comparing against existing literature embeddings. Returns 0-1 where 1 = maximally novel.",
      category: "research",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          finding: { type: "string", description: "The research finding to score" },
          comparison_query: {
            type: "string",
            description: "Query to find comparison papers (defaults to the finding text)",
          },
        },
        required: ["finding"],
      },
      execute: async (args, _ctx) => {
        if (!noveltyScorer) {
          return "Novelty scoring unavailable: no Gemini API key configured. Set geminiApiKey in epistemicConfig.";
        }
        const finding = args.finding as string;
        const query = (args.comparison_query as string) || finding.slice(0, 100);

        // Fetch comparison corpus
        const searchResult = await litClient.search(query, 10);
        const comparisonTexts = searchResult.papers
          .filter((p) => p.abstract.length > 50)
          .map((p) => `${p.title}. ${p.abstract}`);

        const novelty = await noveltyScorer.score(finding, comparisonTexts);
        return [
          `Novelty Score: ${(novelty * 100).toFixed(1)}%`,
          `Compared against: ${comparisonTexts.length} papers`,
          novelty > 0.7
            ? "Assessment: High novelty — finding appears significantly different from existing literature."
            : novelty > 0.4
              ? "Assessment: Moderate novelty — some overlap with existing work detected."
              : "Assessment: Low novelty — finding closely resembles existing literature.",
        ].join("\n");
      },
    },

    // ── Research: Knowledge Gaps ──
    {
      name: "identify_gaps",
      description:
        "Analyze recent literature to find contradictions, unexplored intersections, and weak evidence in a domain.",
      category: "research",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          domain: { type: "string", description: "Research domain to analyze" },
          query: { type: "string", description: "Specific area to search for gaps" },
        },
        required: ["query"],
      },
      execute: async (args, ctx) => {
        const query = args.query as string;
        const domain = (args.domain as string) || epistemicConfig.researchDomain;

        // Fetch recent papers in the area
        const result = await litClient.search(query, 15);
        if (result.papers.length < 3) {
          return `Not enough papers found for "${query}" to identify gaps. Try a broader query.`;
        }

        // Use LLM to identify gaps from abstracts
        const abstractsSummary = result.papers
          .slice(0, 10)
          .map((p, i) => `[${i + 1}] "${p.title}" (${p.year}): ${p.abstract.slice(0, 200)}`)
          .join("\n\n");

        const response = await ctx.inference.chat(
          [
            {
              role: "system",
              content: `You are a research gap analyst for the domain: ${domain}. Given paper abstracts, identify 2-4 specific knowledge gaps. For each gap, state:
1. What is unknown or contradicted
2. Which papers relate to this gap
3. A potential research question

Respond in structured text, not JSON.`,
            },
            {
              role: "user",
              content: `Analyze these recent papers for knowledge gaps:\n\n${abstractsSummary}`,
            },
          ],
          { maxTokens: 600, temperature: 0.5 },
        );

        return response.message?.content || "Gap analysis failed — no response from inference.";
      },
    },

    // ── Research: Write ──
    {
      name: "write_latex",
      description:
        "Convert validated findings into a LaTeX document section. Writes to sandbox filesystem.",
      category: "research",
      riskLevel: "caution",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Paper title" },
          abstract: { type: "string", description: "Paper abstract" },
          findings: { type: "string", description: "Main findings text" },
          citations: {
            type: "array",
            items: { type: "string" },
            description: "Citation strings (author, title, year)",
          },
          output_path: { type: "string", description: "File path for output (default: /root/paper.tex)" },
        },
        required: ["title", "findings"],
      },
      execute: async (args, ctx) => {
        const title = args.title as string;
        const abstract = (args.abstract as string) || "";
        const findings = args.findings as string;
        const citations = (args.citations as string[]) || [];
        const outputPath = (args.output_path as string) || "/root/paper.tex";

        const bibEntries = citations.map((c, i) => `\\bibitem{ref${i + 1}} ${c}`).join("\n");

        const latex = `\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath}

\\title{${title}}
\\author{Epistemon Agent}
\\date{\\today}

\\begin{document}
\\maketitle

\\begin{abstract}
${abstract}
\\end{abstract}

\\section{Findings}
${findings}

${citations.length > 0 ? `\\begin{thebibliography}{99}
${bibEntries}
\\end{thebibliography}` : ""}

\\end{document}
`;

        try {
          await ctx.conway.writeFile(outputPath, latex);
          return `LaTeX document written to ${outputPath} (${latex.length} chars)`;
        } catch (err: any) {
          return `Failed to write LaTeX: ${err.message}`;
        }
      },
    },

    // ── Research: Thesis ──
    {
      name: "update_thesis",
      description:
        "Update THESIS.md with a new research position based on latest findings. Requires justification.",
      category: "research",
      riskLevel: "caution",
      parameters: {
        type: "object",
        properties: {
          new_position: { type: "string", description: "The new research position statement" },
          justification: { type: "string", description: "Evidence-based justification for the change" },
        },
        required: ["new_position", "justification"],
      },
      execute: async (args, ctx) => {
        const position = args.new_position as string;
        const justification = args.justification as string;
        const now = new Date().toISOString();

        // Read existing thesis
        let existing = "";
        try {
          existing = await ctx.conway.readFile("/root/THESIS.md");
        } catch {
          existing = "# Research Thesis\n\nNo prior position established.\n";
        }

        // Append the new position with justification
        const update = `\n\n---\n\n## Position Update (${now})\n\n**Position:** ${position}\n\n**Justification:** ${justification}\n`;
        const updated = existing + update;

        try {
          await ctx.conway.writeFile("/root/THESIS.md", updated);
          // Store in DB for history
          ctx.db.setKV("thesis_last_update", JSON.stringify({ position, justification, timestamp: now }));
          return `THESIS.md updated with new position. Justification recorded.`;
        } catch (err: any) {
          return `Failed to update THESIS.md: ${err.message}`;
        }
      },
    },

    // ── Submission: Mock Review ──
    {
      name: "submit_for_review",
      description:
        "Submit findings for peer review. Costs $1 submission fee. If accepted (SUBMIT verdict), earns $20. " +
        "Also submits to the external Submission Gate (288-gate JIBS AAA quality review at " +
        "https://epistemon-submission-gate.syedmosayebalam.workers.dev). " +
        "To read submission rules first, use fetch_submission_rules.",
      category: "research",
      riskLevel: "caution",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Paper title" },
          content: { type: "string", description: "Full paper content (findings, evidence, citations)" },
        },
        required: ["title", "content"],
      },
      execute: async (args, ctx) => {
        // Anti-exploit: check cooldown after acceptance
        const cooldownUntil = ctx.db.raw.prepare("SELECT value FROM kv WHERE key = 'submission_cooldown_until'").get() as any;
        if (cooldownUntil) {
          const until = new Date(cooldownUntil.value);
          if (until > new Date()) {
            const mins = Math.ceil((until.getTime() - Date.now()) / 60000);
            return `BLOCKED: You must sleep after an accepted paper. Cooldown expires in ${mins} minutes (${cooldownUntil.value}). Research a NEW topic while you wait.`;
          }
        }

        const paperContent = (args.content as string).trim();
        const paperTitle = (args.title as string) || "Untitled";

        // Anti-exploit: cosine similarity check against past submissions
        const pastRaw = ctx.db.raw.prepare("SELECT value FROM kv WHERE key = 'submitted_paper_vectors'").get() as any;
        const pastPapers: Array<{ title: string; vector: Record<string, number>; ts: string }> = pastRaw ? JSON.parse(pastRaw.value) : [];

        // Build word frequency vector
        const buildVector = (text: string): Record<string, number> => {
          const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(w => w.length > 3);
          const freq: Record<string, number> = {};
          for (const w of words) freq[w] = (freq[w] || 0) + 1;
          const mag = Math.sqrt(Object.values(freq).reduce((s, v) => s + v * v, 0));
          if (mag > 0) for (const k in freq) freq[k] /= mag;
          return freq;
        };

        const currentVec = buildVector(paperContent);

        const cosine = (a: Record<string, number>, b: Record<string, number>): number => {
          let dot = 0;
          for (const k in a) if (b[k]) dot += a[k] * b[k];
          return dot; // vectors already normalized
        };

        for (const past of pastPapers) {
          const sim = cosine(currentVec, past.vector);
          if (sim > 0.8) {
            return `BLOCKED: This paper is too similar to a previous submission "${past.title}" (cosine=${sim.toFixed(3)} > 0.8 threshold). ` +
              `You must write a substantially NEW paper on a different research question. Do not resubmit the same work with minor edits.`;
          }
        }

        const provider = new PaperMoneyProvider(
          ctx.db.raw,
          epistemicConfig.paperMoneyBalanceCents,
          epistemicConfig.ecsDecayFactor,
        );
        // Mock review board gives feedback only — reward ONLY from Submission Gate (Gemini 2.5 Pro)
        const board = new MockReviewBoard(provider, epistemicConfig.mockReviewAcceptRate, 0);

        const title = args.title as string;
        const content = args.content as string;
        const result = board.review(title, content);

        const verdictLines = result.verdicts.map((v) =>
          `  ${v.judge}: ${v.verdict.toUpperCase()} — "${v.reasoning}" (novelty:${v.scores.novelty}/10, validity:${v.scores.validity}/10, coherence:${v.scores.coherence}/10)`,
        );

        // Fire-and-forget to Submission Gate — don't wait, result shows on dashboard
        const gateUrl = epistemicConfig.submissionGateUrl || "https://epistemon-submission-gate.syedmosayebalam.workers.dev";
        fetch(`${gateUrl}/api/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, content }),
        }).then(resp => {
          if (resp.ok) {
            resp.json().then((d: any) => {
              logger.info(`[SUBMIT] Gate result: ${d.score}/100 | ${d.verdict} | ${d.passed}/${d.passed + (d.partial || 0) + d.failed} gates | Partial: ${d.partial || 0}`);
              if (d.accepted) {
                const reward = epistemicConfig.acceptanceRewardCents || 2000;
                provider.deposit(reward, `Submission Gate ACCEPTED: "${title}" (${d.score}/100)`);
                const ecsDelta = scorer.compute({ novelty: 0.6 + Math.random() * 0.3, validity: 0.5 + Math.random() * 0.3, coherence: 0.6 + Math.random() * 0.2, utility: 0 });
                provider.addECS(ecsDelta);
                logger.info(`[SUBMIT] ACCEPTED! +$${(reward / 100).toFixed(2)} deposited, ECS +${ecsDelta}`);
                // Set 30-min cooldown — agent must sleep and research new topic
                const cooldown = new Date(Date.now() + 30 * 60 * 1000).toISOString();
                ctx.db.raw.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES ('submission_cooldown_until', ?)").run(cooldown);
                logger.info(`[SUBMIT] Cooldown set until ${cooldown} — agent must research new topic`);
              }
            });
          } else {
            logger.warn(`[SUBMIT] Gate HTTP ${resp.status}`);
          }
        }).catch(err => logger.warn(`[SUBMIT] Gate fire-and-forget failed: ${err.message}`));

        // Store paper vector for similarity check on future submissions
        pastPapers.push({ title, vector: currentVec, ts: new Date().toISOString() });
        // Keep last 50 submissions
        const trimmed = pastPapers.slice(-50);
        ctx.db.raw.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES ('submitted_paper_vectors', ?)").run(JSON.stringify(trimmed));

        return [
          `=== MOCK REVIEW ===`,
          result.summary,
          `Submission ID: ${result.submissionId}`,
          `Fee paid: $${(result.feePaid / 100).toFixed(2)}`,
          ``,
          `Judge verdicts:`,
          ...verdictLines,
          ``,
          `Submission Gate: fired in background — check dashboard for full 288-gate result.`,
          `Paper money balance: $${(provider.getBalance() / 100).toFixed(2)}`,
          `ECS: ${provider.getECS()}`,
        ].join("\n");
      },
    },

    // ── Submission: Fetch Rules ──
    {
      name: "fetch_submission_rules",
      description:
        "Fetch the submission rules and quality gates from the Submission Gate. " +
        "Read these BEFORE submitting a paper to understand all 288 gates across 21 dimensions. " +
        "Endpoint: https://epistemon-submission-gate.syedmosayebalam.workers.dev/api/rules",
      category: "research",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {},
      },
      execute: async (_args, _ctx) => {
        const gateUrl = epistemicConfig.submissionGateUrl || "https://epistemon-submission-gate.syedmosayebalam.workers.dev";
        try {
          const resp = await fetch(`${gateUrl}/api/rules`);
          if (!resp.ok) {
            return `Failed to fetch rules: HTTP ${resp.status}`;
          }
          const rules = await resp.json() as any;
          const lines = [
            `=== SUBMISSION GATE RULES ===`,
            `Submit to: ${gateUrl}/api/submit (POST JSON with { title, content })`,
            `Total gates: ${rules.totalGates} | Critical: ${rules.criticalGates}`,
            `Scoring: 90-100=SUBMIT($20), 75-89=MINOR, 60-74=MAJOR, <60=DO NOT SUBMIT`,
            ``,
          ];
          // Flatten dimensions into gate list
          for (const dim of (rules.dimensions || [])) {
            lines.push(`${dim.id} — ${dim.name} (${dim.maxPoints} pts):`);
            for (const g of (dim.gates || [])) {
              lines.push(`  ${g.id}${g.critical ? " (CRITICAL)" : ""}: ${g.gate}`);
            }
            lines.push(``);
          }
          lines.push(`INSTRUCTIONS:`);
          for (const inst of (rules.instructions || [])) {
            lines.push(`  - ${inst}`);
          }
          return lines.join("\n");
        } catch (err: any) {
          return `Failed to fetch rules: ${err.message}`;
        }
      },
    },

    // ── Submission: Status ──
    {
      name: "check_ecs",
      description:
        "Check current ECS (Epistemic Contribution Score), paper money balance, and survival tier.",
      category: "research",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {},
      },
      execute: async (_args, ctx) => {
        const provider = new PaperMoneyProvider(
          ctx.db.raw,
          epistemicConfig.paperMoneyBalanceCents,
          epistemicConfig.ecsDecayFactor,
        );
        const ecs = provider.getECS();
        const balance = provider.getBalance();

        // Determine tier
        let tier = "critical";
        if (ecs > 500) tier = "high";
        else if (ecs > 200) tier = "normal";
        else if (ecs > 50) tier = "low_compute";
        else if (ecs >= 0) tier = "critical";
        else tier = "dead";

        return [
          `ECS (effective): ${ecs}`,
          `Survival Tier: ${tier}`,
          `Paper Money Balance: $${(balance / 100).toFixed(2)}`,
          `Research Domain: ${epistemicConfig.researchDomain}`,
        ].join("\n");
      },
    },

    // ── Knowledge Base: Search Papers ──
    {
      name: "kb_search_papers",
      description:
        "Search the local knowledge base of 8,600+ academic papers by keyword. " +
        "Returns titles, abstracts, DOIs, citation counts, journal tiers. " +
        "Use this BEFORE calling scan_literature to avoid redundant API calls.",
      category: "research",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Keyword to search in titles and abstracts" },
          limit: { type: "number", description: "Max results (default 20)" },
        },
        required: ["query"],
      },
      execute: async (args, _ctx) => {
        const q = args.query as string;
        const limit = (args.limit as number) || 20;
        try {
          const resp = await fetch(`http://127.0.0.1:8177/papers/search?q=${encodeURIComponent(q)}&limit=${limit}`);
          if (!resp.ok) return `KB search failed: HTTP ${resp.status}`;
          const data = await resp.json() as any;
          if (data.count === 0) return `No papers found for "${q}" in knowledge base.`;
          const lines = [`Found ${data.count} papers for "${q}":\n`];
          for (const p of data.results) {
            const tier = p.journal_tier ? ` [${p.journal_tier}]` : "";
            const cites = p.citation_count ? ` (${p.citation_count} cites)` : "";
            lines.push(`- ${p.title}${tier}${cites}`);
            if (p.doi) lines.push(`  DOI: ${p.doi}`);
            if (p.year) lines.push(`  Year: ${p.year}`);
            if (p.abstract) lines.push(`  Abstract: ${p.abstract.slice(0, 200)}...`);
            lines.push("");
          }
          return lines.join("\n");
        } catch (err: any) {
          return `KB unavailable: ${err.message}`;
        }
      },
    },

    // ── Knowledge Base: Search Claims ──
    {
      name: "kb_search_claims",
      description:
        "Search 62,000+ extracted research claims from academic papers. " +
        "Each claim includes study design, sample size, effect size, p-value, confidence. " +
        "Use this to find evidence for hypotheses and build citations.",
      category: "research",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Keyword to search in claim text" },
          limit: { type: "number", description: "Max results (default 30)" },
        },
        required: ["query"],
      },
      execute: async (args, _ctx) => {
        const q = args.query as string;
        const limit = (args.limit as number) || 30;
        try {
          const resp = await fetch(`http://127.0.0.1:8177/claims/search?q=${encodeURIComponent(q)}&limit=${limit}`);
          if (!resp.ok) return `KB claims search failed: HTTP ${resp.status}`;
          const data = await resp.json() as any;
          if (data.count === 0) return `No claims found for "${q}".`;
          const lines = [`Found ${data.count} claims for "${q}":\n`];
          for (const c of data.results) {
            lines.push(`- [${c.claim_type}] ${c.claim_text}`);
            lines.push(`  Paper: ${c.paper_title || "unknown"}`);
            if (c.paper_doi) lines.push(`  DOI: ${c.paper_doi}`);
            const meta = [];
            if (c.study_design) meta.push(`design: ${c.study_design}`);
            if (c.sample_size) meta.push(`n=${c.sample_size}`);
            if (c.effect_size) meta.push(`effect: ${c.effect_size}`);
            if (c.p_value) meta.push(`p=${c.p_value}`);
            if (c.confidence) meta.push(`conf: ${c.confidence}`);
            if (meta.length) lines.push(`  ${meta.join(", ")}`);
            lines.push("");
          }
          return lines.join("\n");
        } catch (err: any) {
          return `KB unavailable: ${err.message}`;
        }
      },
    },

    // ── Knowledge Base: Get Paper Detail ──
    {
      name: "kb_get_paper",
      description:
        "Get full details of a paper from the knowledge base by paper ID. " +
        "Includes full text if available, all claims, and DOI validation status.",
      category: "research",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          paper_id: { type: "number", description: "Paper ID from kb_search_papers results" },
          doi: { type: "string", description: "DOI to look up (alternative to paper_id)" },
        },
      },
      execute: async (args, _ctx) => {
        try {
          let url: string;
          if (args.paper_id) {
            url = `http://127.0.0.1:8177/papers/${args.paper_id}`;
          } else if (args.doi) {
            url = `http://127.0.0.1:8177/papers/by-doi/${encodeURIComponent(args.doi as string)}`;
          } else {
            return "Provide paper_id or doi.";
          }
          const resp = await fetch(url);
          if (!resp.ok) return `Paper not found (HTTP ${resp.status})`;
          const p = await resp.json() as any;

          const lines = [
            `Title: ${p.title}`,
            `Year: ${p.year || "unknown"} | Citations: ${p.citation_count || 0}`,
            p.journal_tier ? `Journal: ${p.journal_name} [${p.journal_tier}]` : "",
            p.doi ? `DOI: ${p.doi}` : "",
            p.authors?.length ? `Authors: ${p.authors.slice(0, 5).join(", ")}${p.authors.length > 5 ? "..." : ""}` : "",
            `\nAbstract:\n${p.abstract || "No abstract"}`,
          ].filter(Boolean);

          if (p.full_text) {
            lines.push(`\nFull Text (${p.full_text_truncated ? "truncated" : "complete"}):`);
            lines.push(p.full_text.slice(0, 10000));
          }

          // Also fetch claims for this paper
          if (p.doi) {
            const claimsResp = await fetch(`http://127.0.0.1:8177/claims/by-paper?doi=${encodeURIComponent(p.doi)}`);
            if (claimsResp.ok) {
              const claimsData = await claimsResp.json() as any;
              if (claimsData.count > 0) {
                lines.push(`\nExtracted Claims (${claimsData.count}):`);
                for (const c of claimsData.results.slice(0, 20)) {
                  lines.push(`  - [${c.claim_type}] ${c.claim_text}`);
                }
              }
            }
          }

          return lines.join("\n");
        } catch (err: any) {
          return `KB unavailable: ${err.message}`;
        }
      },
    },

    // ── Knowledge Base: DOI Validation ──
    {
      name: "kb_check_doi",
      description:
        "Check if a DOI has been validated — retraction status, citation count from cache. " +
        "Saves API calls to Crossref/Semantic Scholar for known papers.",
      category: "research",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          doi: { type: "string", description: "DOI to check" },
        },
        required: ["doi"],
      },
      execute: async (args, _ctx) => {
        const doi = args.doi as string;
        try {
          const resp = await fetch(`http://127.0.0.1:8177/doi/${encodeURIComponent(doi)}`);
          if (resp.status === 404) return `DOI ${doi} not in validation cache — needs fresh lookup.`;
          if (!resp.ok) return `DOI check failed: HTTP ${resp.status}`;
          const d = await resp.json() as any;
          const lines = [
            `DOI: ${doi}`,
            `Retracted: ${d.retracted ? "YES — DO NOT CITE" : "No"}`,
            `Citation count: ${d.citation_count || 0}`,
            d.update_to ? `Updated to: ${d.update_to}` : "",
            d.notes ? `Notes: ${d.notes}` : "",
          ].filter(Boolean);
          return lines.join("\n");
        } catch (err: any) {
          return `KB unavailable: ${err.message}`;
        }
      },
    },

    // ── Knowledge Base: Save Paper ──
    {
      name: "kb_save_paper",
      description:
        "Save a paper to the shared knowledge base for future use by all agents. " +
        "Deduplicates by DOI or title. Include full text if available — it increases " +
        "your knowledge base quality and helps future submissions. " +
        "EVERY paper you read should be saved here. This is beneficial: " +
        "a richer KB means fewer API calls, lower token costs, and better submissions.",
      category: "research",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Paper title" },
          abstract: { type: "string", description: "Paper abstract" },
          authors: { type: "array", items: { type: "string" }, description: "Author names" },
          year: { type: "number", description: "Publication year" },
          doi: { type: "string", description: "DOI" },
          citation_count: { type: "number", description: "Number of citations" },
          full_text: { type: "string", description: "Full paper text if available" },
          journal_tier: { type: "string", description: "Journal tier: AAA, AA, A, B" },
          journal_name: { type: "string", description: "Journal name" },
          url: { type: "string", description: "Paper URL" },
        },
        required: ["title"],
      },
      execute: async (args, _ctx) => {
        try {
          const resp = await fetch("http://127.0.0.1:8177/papers/save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: args.title,
              abstract: args.abstract || null,
              authors: args.authors || [],
              year: args.year || null,
              doi: args.doi || null,
              source: "agent",
              citation_count: args.citation_count || 0,
              full_text: args.full_text || null,
              journal_tier: args.journal_tier || null,
              journal_name: args.journal_name || null,
              url: args.url || null,
            }),
          });
          if (!resp.ok) return `KB save failed: HTTP ${resp.status}`;
          const data = await resp.json() as any;
          return `Paper ${data.action} in KB (ID: ${data.paper_id}). Your knowledge base grows stronger.`;
        } catch (err: any) {
          return `KB unavailable: ${err.message}`;
        }
      },
    },

    // ── Knowledge Base: Save Claim ──
    {
      name: "kb_save_claim",
      description:
        "Save a research claim extracted from a paper to the shared knowledge base. " +
        "Claims are the building blocks of your submissions — each saved claim is evidence " +
        "you can reuse in future papers without re-reading the source. " +
        "Include study design, sample size, effect size, p-value when available.",
      category: "research",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          paper_title: { type: "string", description: "Title of the source paper" },
          paper_doi: { type: "string", description: "DOI of the source paper" },
          claim_text: { type: "string", description: "The research claim text" },
          claim_type: { type: "string", description: "Type: finding, hypothesis, methodology, limitation, implication" },
          confidence: { type: "number", description: "Confidence 0-1" },
          study_design: { type: "string", description: "e.g. RCT, panel, cross-sectional" },
          sample_size: { type: "string", description: "Sample size" },
          effect_size: { type: "string", description: "Effect size" },
          p_value: { type: "string", description: "P-value" },
          population: { type: "string", description: "Study population" },
          country: { type: "string", description: "Country/region" },
        },
        required: ["paper_title", "claim_text"],
      },
      execute: async (args, _ctx) => {
        try {
          const resp = await fetch("http://127.0.0.1:8177/claims/save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              paper_title: args.paper_title,
              paper_doi: args.paper_doi || null,
              claim_text: args.claim_text,
              claim_type: args.claim_type || "finding",
              confidence: args.confidence || 0.5,
              study_design: args.study_design || null,
              sample_size: args.sample_size || null,
              effect_size: args.effect_size || null,
              p_value: args.p_value || null,
              population: args.population || null,
              country: args.country || null,
            }),
          });
          if (!resp.ok) return `KB claim save failed: HTTP ${resp.status}`;
          const data = await resp.json() as any;
          return `Claim saved to KB (ID: ${data.claim_id}). Evidence bank grows stronger.`;
        } catch (err: any) {
          return `KB unavailable: ${err.message}`;
        }
      },
    },

    // ── Self-Evaluate: Dry-Run Gate Check ──
    {
      name: "self_evaluate",
      description:
        "Dry-run your paper against the 288-gate Submission Gate WITHOUT paying $1. " +
        "Returns full score, verdict, per-gate pass/fail, and dimension breakdown. " +
        "Use this to iterate and fix failures BEFORE spending money on submit_for_review. " +
        "FREE — no submission fee, no KV record. Call this as many times as needed.",
      category: "research",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Paper title" },
          content: { type: "string", description: "Full paper content" },
        },
        required: ["title", "content"],
      },
      execute: async (args, _ctx) => {
        const content = (args.content as string).trim();
        const wordCount = content.split(/\s+/).length;

        // Gate 1: Minimum word count
        if (wordCount < 2000) {
          return `BLOCKED: Paper is only ${wordCount} words. Need at least 2,000 before dry-run evaluation. ` +
            `Go back and write the full paper first. Call read_plan to see your next task.`;
        }

        // Gate 2: Must pass quality_check first (free programmatic check)
        try {
          const qcResp = await fetch("http://127.0.0.1:8178/quality_check", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: args.title || "", content }),
          });
          if (qcResp.ok) {
            const qcData = await qcResp.json() as any;
            const qcSummary = qcData.summary;
            if (qcSummary && qcSummary.critical_failure) {
              return `BLOCKED: quality_check has CRITICAL failures. Fix these first (free) before spending tokens on self_evaluate.\n` +
                `Passed: ${qcSummary.passed}/${qcSummary.total} | Critical failure: YES\n` +
                `Call quality_check to see what to fix, then fix it, then try self_evaluate again.`;
            }
            const passRate = qcSummary ? (qcSummary.passed / qcSummary.total) : 1;
            if (passRate < 0.5) {
              return `BLOCKED: quality_check only passes ${qcSummary.passed}/${qcSummary.total} gates (${Math.round(passRate * 100)}%). ` +
                `Fix programmatic issues first (free) before spending tokens on self_evaluate.\n` +
                `Call quality_check to see failures.`;
            }
          }
        } catch {
          // If quality_check unavailable, allow self_evaluate to proceed
        }

        const gateUrl = epistemicConfig.submissionGateUrl || "https://epistemon-submission-gate.syedmosayebalam.workers.dev";
        try {
          const resp = await fetch(`${gateUrl}/api/evaluate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: args.title, content: args.content }),
          });
          if (!resp.ok) {
            const errText = await resp.text();
            return `Self-evaluate failed: HTTP ${resp.status} — ${errText}`;
          }
          const data = await resp.json() as any;
          const totalGates = (data.passed || 0) + (data.failed || 0) + (data.partial || 0);
          const lines = [
            `=== DRY-RUN EVALUATION (free, no $1 fee) ===`,
            `Score: ${data.score}/100 | Verdict: ${data.verdict} | Accepted: ${data.accepted ? "YES" : "NO"}`,
            `Passed: ${data.passed}/${totalGates || "?"} | Partial: ${data.partial || 0} | Failed: ${data.failed || 0}`,
          ];
          if (data.totalPoints != null) lines.push(`Points: ${data.totalPoints}/${totalGates} (PARTIAL gates score 0.5 each)`);
          if (data.rejectReason) lines.push(`Reject reason: ${data.rejectReason}`);

          if (data.dimensionScores) {
            lines.push(`\nDimension Scores:`);
            for (const ds of data.dimensionScores) {
              const pts = ds.points != null ? ds.points : ds.passed;
              const pct = Math.round((pts / ds.total) * 100);
              const marker = pct === 100 ? "OK" : pct >= 75 ? "WEAK" : "FAIL";
              const partialNote = ds.partial ? ` (${ds.partial} PARTIAL)` : "";
              lines.push(`  ${ds.id} ${ds.name}: ${pts}/${ds.total} pts (${marker})${partialNote}`);
            }
          }

          if (data.results) {
            // Show PARTIAL gates separately — these are revision targets
            const partials = data.results.filter((r: any) => r.scoring === "qualitative" && r.rawScore === 1);
            if (partials.length > 0) {
              lines.push(`\nPARTIAL Gates (${partials.length}) — present but shallow, each costs 0.5 pts:`);
              for (const p of partials) {
                lines.push(`  ${p.id} [${p.dimension}]: ${p.reasoning}`);
              }
            }

            const failures = data.results.filter((r: any) => !r.pass && (r.rawScore === 0 || r.rawScore == null));
            if (failures.length > 0) {
              lines.push(`\nFailed Gates (${failures.length}):`);
              for (const f of failures) {
                lines.push(`  ${f.id} [${f.dimension}]${f.critical ? " *CRITICAL*" : ""}: ${f.reasoning}`);
              }
            }
          }
          lines.push(`\n=== NEXT: read_iteration_log to see all past attempts. Fix SPECIFIC failed gates using fetch_guidance. Do NOT repeat previous fixes. Only submit_for_review when score >= 90. ===`);
          const result = lines.join("\n");
          // Log evaluation result so it appears in journalctl
          logger.info(`[SELF_EVALUATE] "${args.title}" — Score: ${data.score}/100 | Verdict: ${data.verdict} | Passed: ${data.passed}/${data.passed + data.failed} | Accepted: ${data.accepted}`);
          if (data.dimensionScores) {
            const dimSummary = data.dimensionScores.map((ds: any) => `${ds.id}:${ds.passed}/${ds.total}`).join(" ");
            logger.info(`[SELF_EVALUATE] Dimensions: ${dimSummary}`);
          }

          // Auto-log iteration for learning
          try {
            const logLines = [`**self_evaluate** — Score: ${data.score}/100 | Verdict: ${data.verdict} | Passed: ${data.passed}/${totalGates} | Partial: ${data.partial || 0}`];
            if (data.rejectReason) logLines.push(`Reject: ${data.rejectReason}`);
            if (data.results) {
              const partials = data.results.filter((r: any) => r.scoring === "qualitative" && r.rawScore === 1);
              if (partials.length > 0) {
                logLines.push(`Partial gates (${partials.length}):`);
                for (const p of partials) {
                  logLines.push(`- ${p.id} [${p.dimension}] PARTIAL: ${p.reasoning}`);
                }
              }
              const failures = data.results.filter((r: any) => !r.pass && (r.rawScore === 0 || r.rawScore == null));
              if (failures.length > 0) {
                logLines.push(`Failed gates (${failures.length}):`);
                for (const f of failures) {
                  logLines.push(`- ${f.id} [${f.dimension}]${f.critical ? " *CRITICAL*" : ""}: ${f.reasoning}`);
                }
              }
            }
            if (data.dimensionScores) {
              const weak = data.dimensionScores.filter((ds: any) => (ds.points != null ? ds.points : ds.passed) < ds.total);
              if (weak.length > 0) {
                logLines.push(`Weak dimensions: ${weak.map((ds: any) => `${ds.id}(${ds.points != null ? ds.points : ds.passed}/${ds.total})`).join(", ")}`);
              }
            }
            await appendIterationLog(logLines.join("\n"));
          } catch { /* don't fail if logging fails */ }

          // Blueprint of Success: auto-snapshot when score >= 95
          if (data.score >= 95) {
            try {
              const { appendFile, readFile } = await import("fs/promises");
              const blueprintPath = "/root/BluePrintOfSuccess.md";
              const timestamp = new Date().toISOString();
              const perfectDims = data.dimensionScores?.filter((ds: any) => ds.passed === ds.total).map((ds: any) => `${ds.id} ${ds.name}`) || [];
              const weakDims = data.dimensionScores?.filter((ds: any) => ds.passed < ds.total).map((ds: any) => `${ds.id} ${ds.name} (${ds.passed}/${ds.total})`) || [];
              const failedGates = data.results?.filter((r: any) => !r.pass).map((f: any) => `${f.id}: ${f.reasoning}`) || [];
              const snapshot = [
                `\n---`,
                `## Snapshot: ${timestamp} — Score ${data.score}/100 (${data.passed}/${data.passed + data.failed} gates)`,
                ``,
                `### What Worked (perfect dimensions):`,
                ...perfectDims.map((d: string) => `- ${d}`),
                ``,
                `### Still Failing:`,
                ...(failedGates.length > 0 ? failedGates.map((f: string) => `- ${f}`) : ["- None!"]),
                ``,
                `### Weak Dimensions (passed but not perfect):`,
                ...(weakDims.length > 0 ? weakDims.map((d: string) => `- ${d}`) : ["- None!"]),
                ``,
                `### Strategy That Got Here:`,
                `> (AGENT: Replace this with what you did differently this iteration. What specific changes raised the score? What approach worked? What was a waste of time?)`,
                ``,
              ].join("\n");

              // Create header if file doesn't exist
              let existing = "";
              try { existing = await readFile(blueprintPath, "utf-8"); } catch { /* new file */ }
              if (!existing) {
                const header = [
                  `# Blueprint of Success`,
                  ``,
                  `This document is auto-updated every time self_evaluate scores >= 95.`,
                  `The agent MUST revise the Strategy section after each snapshot.`,
                  `Read this FIRST on every new iteration before writing anything.`,
                  ``,
                ].join("\n");
                await appendFile(blueprintPath, header);
              }
              await appendFile(blueprintPath, snapshot);
              logger.info(`[BLUEPRINT] Score ${data.score} >= 95 — snapshot appended to BluePrintOfSuccess.md`);
            } catch { /* don't fail if blueprint write fails */ }

            // Tell the agent to revise the blueprint
            return result + `\n\n=== BLUEPRINT UPDATE REQUIRED ===\n` +
              `Score >= 95 triggered a snapshot in /root/BluePrintOfSuccess.md.\n` +
              `You MUST now:\n` +
              `1. read_file /root/BluePrintOfSuccess.md\n` +
              `2. Replace the "Strategy That Got Here" placeholder with what you ACTUALLY did\n` +
              `3. Add what worked, what didn't, what you'd do differently — be SPECIFIC\n` +
              `4. STRICT LIMIT: Keep the ENTIRE file under 500 words. Condense older entries if needed.\n` +
              `5. Never delete proven strategies — merge and compress, don't remove.`;
          }

          return result;
        } catch (err: any) {
          return `Self-evaluate unavailable: ${err.message}`;
        }
      },
    },

    // ── Web Search ──
    {
      name: "web_search",
      description:
        "Search the web for academic papers, datasets, methodology guides, and research context. " +
        "Returns titles, URLs, and snippets. Use this to find sources beyond Semantic Scholar/OpenAlex. " +
        "Good for: working papers, SSRN preprints, dataset descriptions, methodology tutorials, grey literature. " +
        "COSTS TOKENS (small). Prefer kb_search_papers for known topics first.",
      category: "research",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          limit: { type: "number", description: "Max results (default 10)" },
        },
        required: ["query"],
      },
      execute: async (args, _ctx) => {
        const query = args.query as string;
        const limit = Math.min((args.limit as number) || 10, 20);
        try {
          // Use DuckDuckGo HTML lite — free, no API key needed
          const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
          const resp = await fetch(url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (compatible; Epistemon/1.0; research-agent)",
            },
          });
          if (!resp.ok) return `Web search failed: HTTP ${resp.status}`;
          const html = await resp.text();

          // Parse results from DuckDuckGo HTML response
          const results: { title: string; url: string; snippet: string }[] = [];
          const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
          let match;
          while ((match = resultRegex.exec(html)) !== null && results.length < limit) {
            const rawUrl = match[1];
            const title = match[2].replace(/<[^>]*>/g, "").trim();
            const snippet = match[3].replace(/<[^>]*>/g, "").trim();
            // DuckDuckGo wraps URLs in a redirect — extract the actual URL
            const urlMatch = rawUrl.match(/uddg=([^&]*)/);
            const actualUrl = urlMatch ? decodeURIComponent(urlMatch[1]) : rawUrl;
            if (title && actualUrl) {
              results.push({ title, url: actualUrl, snippet });
            }
          }

          if (results.length === 0) {
            // Fallback: try simpler pattern
            const simpleRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
            while ((match = simpleRegex.exec(html)) !== null && results.length < limit) {
              const rawUrl = match[1];
              const title = match[2].replace(/<[^>]*>/g, "").trim();
              const urlMatch = rawUrl.match(/uddg=([^&]*)/);
              const actualUrl = urlMatch ? decodeURIComponent(urlMatch[1]) : rawUrl;
              if (title && actualUrl) {
                results.push({ title, url: actualUrl, snippet: "" });
              }
            }
          }

          if (results.length === 0) return `No web results found for "${query}".`;

          const lines = [`Web search: ${results.length} results for "${query}":\n`];
          for (const [i, r] of results.entries()) {
            lines.push(`[${i + 1}] ${r.title}`);
            lines.push(`    URL: ${r.url}`);
            if (r.snippet) lines.push(`    ${r.snippet}`);
            lines.push("");
          }
          return lines.join("\n");
        } catch (err: any) {
          return `Web search failed: ${err.message}`;
        }
      },
    },

    // ── Web Fetch ──
    {
      name: "web_fetch",
      description:
        "Fetch a web page and extract its text content. Use after web_search to read full articles, " +
        "SSRN preprints, dataset descriptions, methodology guides, or any URL. " +
        "Returns plain text (HTML tags stripped). Truncates to 15,000 chars. " +
        "COSTS TOKENS. Save useful content to KB with kb_save_paper or kb_save_claim after reading.",
      category: "research",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to fetch" },
        },
        required: ["url"],
      },
      execute: async (args, _ctx) => {
        const targetUrl = args.url as string;
        if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
          return "Invalid URL — must start with http:// or https://";
        }
        try {
          const resp = await fetch(targetUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (compatible; Epistemon/1.0; research-agent)",
              "Accept": "text/html,application/xhtml+xml,text/plain,application/pdf",
            },
            redirect: "follow",
          });
          if (!resp.ok) return `Fetch failed: HTTP ${resp.status}`;

          const contentType = resp.headers.get("content-type") || "";
          if (contentType.includes("application/pdf")) {
            return `PDF detected at ${targetUrl}. Cannot extract text from PDFs directly. Try finding an HTML version or abstract page.`;
          }

          const html = await resp.text();

          // Strip HTML tags and extract meaningful text
          let text = html
            // Remove script and style blocks
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<nav[\s\S]*?<\/nav>/gi, "")
            .replace(/<header[\s\S]*?<\/header>/gi, "")
            .replace(/<footer[\s\S]*?<\/footer>/gi, "")
            // Convert common elements to readable text
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<\/p>/gi, "\n\n")
            .replace(/<\/div>/gi, "\n")
            .replace(/<\/h[1-6]>/gi, "\n\n")
            .replace(/<\/li>/gi, "\n")
            // Strip remaining tags
            .replace(/<[^>]*>/g, " ")
            // Decode HTML entities
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&nbsp;/g, " ")
            // Clean up whitespace
            .replace(/[ \t]+/g, " ")
            .replace(/\n\s*\n\s*\n/g, "\n\n")
            .trim();

          const maxLen = 15000;
          if (text.length > maxLen) {
            text = text.slice(0, maxLen) + `\n\n[TRUNCATED: ${text.length - maxLen} chars omitted]`;
          }

          if (text.length < 50) return `Page at ${targetUrl} returned minimal text content.`;

          return `=== Content from ${targetUrl} ===\n\n${text}`;
        } catch (err: any) {
          return `Fetch failed: ${err.message}`;
        }
      },
    },

    // ── ARA: Quality Check (programmatic, no LLM) ──
    {
      name: "quality_check",
      description:
        "Run programmatic quality checks on your paper BEFORE self_evaluate. FREE, no LLM, instant. " +
        "Checks: abstract word count (D14-09), seminal IB citations (D03-04), recent literature (D03-05), " +
        "citation count (D04-04), reference list (D04-05), hallucinated refs (D04-11 CRITICAL), " +
        "sample size (D07-02), descriptive stats table (D07-08), " +
        "correlation matrix (D07-09), software version (D10-09), coefficient reporting (D12-01), " +
        "results tables (D12-06), LLM artifact detection (D08-03 CRITICAL). " +
        "v3.0: 288 gates, 55 critical, 21 dimensions. D00 = anti-gaming, D15-D20 = stress tests, readiness, evidence, references, style, cross-section. Fix all failures here first, then self_evaluate.",
      category: "research",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Paper title" },
          content: { type: "string", description: "Full paper content" },
        },
        required: ["content"],
      },
      execute: async (args, _ctx) => {
        try {
          const resp = await fetch("http://127.0.0.1:8178/quality_check", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: args.title || "", content: args.content }),
          });
          if (!resp.ok) return `Quality check failed: HTTP ${resp.status}`;
          const data = await resp.json() as any;
          const lines = [
            `=== PROGRAMMATIC QUALITY CHECK (free, no LLM) ===`,
            `Word count: ${data.word_count}`,
            `Sections present: ${data.sections_present?.join(", ") || "none"}`,
            `Sections missing: ${data.sections_missing?.join(", ") || "none"}`,
            ``,
          ];
          for (const [gateId, gate] of Object.entries(data.gates || {})) {
            const g = gate as any;
            const mark = g.pass ? "PASS" : (g.critical ? "CRITICAL FAIL" : "FAIL");
            lines.push(`  ${gateId} [${mark}]: ${g.gate} — ${g.note}`);
          }
          const s = data.summary;
          lines.push(`\nSummary: ${s.passed}/${s.total} passed | Critical failure: ${s.critical_failure}`);
          lines.push(s.ready_for_gate ? "Ready for self_evaluate!" : "Fix failures above first.");

          // Auto-log iteration for learning
          try {
            const logLines = [`**quality_check** — ${s.passed}/${s.total} passed | Critical: ${s.critical_failure}`];
            logLines.push(`Word count: ${data.word_count} | Sections: ${data.sections_present?.join(", ") || "none"}`);
            const failedGates = Object.entries(data.gates || {}).filter(([, g]: [string, any]) => !g.pass);
            if (failedGates.length > 0) {
              logLines.push(`Failed gates (${failedGates.length}):`);
              for (const [gateId, g] of failedGates) {
                const gate = g as any;
                logLines.push(`- ${gateId}${gate.critical ? " *CRITICAL*" : ""}: ${gate.gate} — ${gate.note}`);
              }
            }
            await appendIterationLog(logLines.join("\n"));
          } catch { /* don't fail if logging fails */ }

          return lines.join("\n");
        } catch (err: any) {
          return `Quality check unavailable (is ara-tools running on port 8178?): ${err.message}`;
        }
      },
    },

    // ── Iteration Log ──
    {
      name: "read_iteration_log",
      description:
        "Read your iteration log — shows every quality_check and self_evaluate result with timestamps, " +
        "scores, failed gates, and gate responses. READ THIS BEFORE retrying to avoid repeating mistakes. " +
        "Use 'last' parameter to see only the N most recent entries.",
      category: "research",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          last: { type: "number", description: "Show only the last N entries (default: all)" },
        },
      },
      execute: async (args, _ctx) => {
        try {
          const { readFile } = await import("fs/promises");
          const content = await readFile(ITERATION_LOG_PATH, "utf-8");
          const entries = content.split("\n---\n").filter(e => e.trim());
          const last = args.last as number | undefined;
          const shown = last ? entries.slice(-last) : entries;
          return `=== ITERATION LOG (${shown.length}/${entries.length} entries) ===\n` +
            shown.join("\n---\n") +
            `\n\n=== BEFORE retrying: identify what CHANGED since last attempt. Do NOT repeat the same fix. ===`;
        } catch {
          return "No iteration log yet. Run quality_check or self_evaluate first.";
        }
      },
    },

    // ── ARA: Validate Citations ──
    {
      name: "validate_citations",
      description:
        "Check citation integrity: extract all in-text citations, check DOIs against blacklist " +
        "(predatory publishers, preprint servers) and classify journal tiers. " +
        "Maps to D04-01..D04-07 gates. Provide the paper content and any DOIs you want checked.",
      category: "research",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "Paper content to scan for citations" },
          dois: { type: "array", items: { type: "string" }, description: "DOIs to check against blacklist" },
        },
        required: ["content"],
      },
      execute: async (args, _ctx) => {
        try {
          const resp = await fetch("http://127.0.0.1:8178/validate_citations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: args.content, dois: args.dois || [] }),
          });
          if (!resp.ok) return `Citation validation failed: HTTP ${resp.status}`;
          const data = await resp.json() as any;
          const lines = [
            `=== CITATION VALIDATION ===`,
            `Total citations: ${data.total_citations} | Unique: ${data.unique_citations}`,
          ];
          if (data.blacklisted?.length > 0) {
            lines.push(`\nBLACKLISTED DOIs (remove these!):`);
            for (const b of data.blacklisted) {
              lines.push(`  ${b.doi} — ${b.reason}`);
            }
          }
          if (data.tiered?.length > 0) {
            lines.push(`\nTiered journals found:`);
            for (const t of data.tiered) {
              lines.push(`  ${t.doi} — ${t.journal} [${t.tier}]`);
            }
          }
          for (const [gateId, gate] of Object.entries(data.gates || {})) {
            const g = gate as any;
            lines.push(`${gateId} [${g.pass ? "PASS" : "FAIL"}]: ${g.note}`);
          }
          return lines.join("\n");
        } catch (err: any) {
          return `Citation validation unavailable: ${err.message}`;
        }
      },
    },

    // ── ARA: Classify Journal ──
    {
      name: "classify_journal",
      description:
        "Classify a journal tier from DOI: AAA (FT50/UTD24), AA (ABS4/ABDC A*), or unknown. " +
        "Also checks blacklist (predatory/preprint/vanity). 150+ journals in database. " +
        "Use AAA/AA papers as primary citations for maximum gate credibility (D03-04).",
      category: "research",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          doi: { type: "string", description: "DOI to classify" },
        },
        required: ["doi"],
      },
      execute: async (args, _ctx) => {
        try {
          const resp = await fetch("http://127.0.0.1:8178/classify_journal", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ doi: args.doi }),
          });
          if (!resp.ok) return `Journal classification failed: HTTP ${resp.status}`;
          const data = await resp.json() as any;
          const lines = [`DOI: ${data.doi}`];
          if (data.blacklisted) {
            lines.push(`BLACKLISTED: ${data.blacklisted} — DO NOT CITE`);
          } else if (data.tier) {
            lines.push(`Journal: ${data.journal_name} [${data.tier}]`);
          } else {
            lines.push(`Journal: Unknown tier (not in AAA/AA database)`);
          }
          return lines.join("\n");
        } catch (err: any) {
          return `Journal classification unavailable: ${err.message}`;
        }
      },
    },

    // ── ARA: Check Retraction ──
    {
      name: "check_retraction",
      description:
        "Check if a paper has been retracted via CrossRef API. " +
        "CRITICAL for D04-01 (no fabricated citations) and D08-07 (data integrity). " +
        "Check EVERY key citation before including in your paper.",
      category: "research",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          doi: { type: "string", description: "DOI to check for retraction" },
        },
        required: ["doi"],
      },
      execute: async (args, _ctx) => {
        try {
          const resp = await fetch("http://127.0.0.1:8178/check_retraction", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ doi: args.doi }),
          });
          if (!resp.ok) return `Retraction check failed: HTTP ${resp.status}`;
          const data = await resp.json() as any;
          const lines = [`DOI: ${data.doi}`];
          if (data.retracted) {
            lines.push(`RETRACTED — DO NOT CITE THIS PAPER`);
          } else {
            lines.push(`Not retracted`);
          }
          if (data.blacklisted) {
            lines.push(`Blacklisted: ${data.blacklisted}`);
          }
          return lines.join("\n");
        } catch (err: any) {
          return `Retraction check unavailable: ${err.message}`;
        }
      },
    },

    // ── ARA: Multi-API Search ──
    {
      name: "ara_search",
      description:
        "Search 3 academic APIs in parallel: Semantic Scholar + OpenAlex + CrossRef. " +
        "Returns deduplicated results with journal tier and blacklist status. " +
        "More comprehensive than scan_literature (single API). " +
        "COSTS TOKENS. Use kb_search_papers FIRST. Only use this if KB lacks results.",
      category: "research",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Academic search query" },
          limit: { type: "number", description: "Max results (default 20)" },
        },
        required: ["query"],
      },
      execute: async (args, _ctx) => {
        try {
          const resp = await fetch("http://127.0.0.1:8178/ara_search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: args.query, limit: args.limit || 20 }),
          });
          if (!resp.ok) return `ARA search failed: HTTP ${resp.status}`;
          const data = await resp.json() as any;
          if (!data.papers?.length) return `No results for "${args.query}"`;
          const lines = [`Found ${data.total} papers for "${args.query}":\n`];
          for (const [i, p] of data.papers.entries()) {
            const tier = p.journal_tier ? ` [${p.journal_tier}]` : "";
            const bl = p.blacklisted ? ` BLACKLISTED:${p.blacklisted}` : "";
            lines.push(`[${i + 1}] ${p.title}${tier}${bl}`);
            lines.push(`    Authors: ${(p.authors || []).slice(0, 3).join(", ")}${(p.authors?.length || 0) > 3 ? " et al." : ""}`);
            lines.push(`    Year: ${p.year || "?"} | Citations: ${p.citation_count || 0} | Source: ${p.source}`);
            if (p.doi) lines.push(`    DOI: ${p.doi}`);
            if (p.abstract) lines.push(`    Abstract: ${p.abstract.slice(0, 200)}...`);
            lines.push("");
          }
          return lines.join("\n");
        } catch (err: any) {
          return `ARA search unavailable: ${err.message}`;
        }
      },
    },

    // ── ARA: MMR Semantic Search ──
    {
      name: "mmr_search",
      description:
        "Diversity-aware semantic search on the knowledge base using MMR (Maximal Marginal Relevance). " +
        "Returns papers that are BOTH relevant AND diverse — avoids getting 10 papers that all say the same thing. " +
        "Better than kb_search_papers when you need breadth of perspectives for literature review.",
      category: "research",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          limit: { type: "number", description: "Max results (default 10)" },
          lambda: { type: "number", description: "Balance relevance vs diversity (0-1, default 0.7 = more relevant)" },
        },
        required: ["query"],
      },
      execute: async (args, _ctx) => {
        try {
          const resp = await fetch("http://127.0.0.1:8178/mmr_search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              query: args.query,
              limit: args.limit || 10,
              lambda_param: (args as any).lambda || 0.7,
            }),
          });
          if (!resp.ok) return `MMR search failed: HTTP ${resp.status}`;
          const data = await resp.json() as any;
          if (data.error) return `MMR search error: ${data.error}`;
          if (!data.papers?.length) return `No results for "${args.query}"`;
          const lines = [`MMR search (${data.method}): ${data.total} diverse results for "${args.query}":\n`];
          for (const [i, p] of data.papers.entries()) {
            lines.push(`[${i + 1}] ${p.title}`);
            if (p.doi) lines.push(`    DOI: ${p.doi}`);
            if (p.year) lines.push(`    Year: ${p.year}`);
            if (p.abstract) lines.push(`    ${p.abstract.slice(0, 200)}...`);
            lines.push("");
          }
          return lines.join("\n");
        } catch (err: any) {
          return `MMR search unavailable: ${err.message}`;
        }
      },
    },

    // ── Knowledge Base: Stats ──
    {
      name: "kb_stats",
      description:
        "Get statistics about the local knowledge base — paper count, claim count, " +
        "embeddings, full texts, DOI validations.",
      category: "research",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {},
      },
      execute: async (_args, _ctx) => {
        try {
          const resp = await fetch("http://127.0.0.1:8177/stats");
          if (!resp.ok) return `KB stats failed: HTTP ${resp.status}`;
          const s = await resp.json() as any;
          return [
            `=== Knowledge Base Statistics ===`,
            `Papers: ${s.papers} (${s.papers_with_embeddings} with embeddings, ${s.papers_with_fulltext} with full text)`,
            `Claims: ${s.claims} (${s.claims_with_embeddings} with embeddings)`,
            `DOI Validations: ${s.doi_validations}`,
            `Paper Chunks: ${s.chunks} (${s.chunks_with_embeddings} with embeddings)`,
          ].join("\n");
        } catch (err: any) {
          return `KB unavailable: ${err.message}`;
        }
      },
    },

    // ── Knowledge Base: Top Tier Papers ──
    {
      name: "kb_top_tier_papers",
      description:
        "Get papers from top-tier journals (AAA, AA, A, B). " +
        "Use AAA/AA tier papers as primary citations for maximum submission gate credibility.",
      category: "research",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          tier: { type: "string", description: "Journal tier: AAA, AA, A, B (default AAA)" },
          limit: { type: "number", description: "Max results (default 30)" },
        },
      },
      execute: async (args, _ctx) => {
        const tier = (args.tier as string) || "AAA";
        const limit = (args.limit as number) || 30;
        try {
          const resp = await fetch(`http://127.0.0.1:8177/papers/top-tier?tier=${encodeURIComponent(tier)}&limit=${limit}`);
          if (!resp.ok) return `KB top tier failed: HTTP ${resp.status}`;
          const data = await resp.json() as any;
          if (data.count === 0) return `No ${tier}-tier papers in knowledge base.`;
          const lines = [`${data.count} papers from ${tier}-tier journals:\n`];
          for (const p of data.results) {
            lines.push(`- ${p.title}`);
            if (p.journal_name) lines.push(`  Journal: ${p.journal_name}`);
            lines.push(`  Year: ${p.year || "?"} | Citations: ${p.citation_count || 0}`);
            if (p.doi) lines.push(`  DOI: ${p.doi}`);
            lines.push("");
          }
          return lines.join("\n");
        } catch (err: any) {
          return `KB unavailable: ${err.message}`;
        }
      },
    },

    // ── Plan: Create Paper Plan ──
    {
      name: "create_plan",
      description:
        "Create a structured plan for your paper. You MUST create a plan BEFORE writing. " +
        "The plan is a checklist of tasks. Each task has a description and acceptance criteria from the guidance docs. " +
        "After creating the plan, execute tasks one at a time using mark_task_done when complete. " +
        "Call fetch_guidance for relevant dimensions BEFORE creating the plan so tasks are gate-aware.",
      category: "research",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          topic: { type: "string", description: "Research topic / paper title" },
          tasks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "number", description: "Task number (1, 2, 3...)" },
                phase: { type: "string", description: "RESEARCH, PLAN, WRITE, or ITERATE" },
                description: { type: "string", description: "What to do" },
                acceptance: { type: "string", description: "How to know this task is done (gate references)" },
              },
            },
            description: "List of tasks to complete",
          },
        },
        required: ["topic", "tasks"],
      },
      execute: async (args, _ctx) => {
        const { writeFile } = await import("fs/promises");
        const topic = args.topic as string;
        const tasks = args.tasks as Array<{ id: number; phase: string; description: string; acceptance: string }>;

        const lines = [
          `# Paper Plan: ${topic}`,
          `Created: ${new Date().toISOString()}`,
          `Status: IN_PROGRESS`,
          ``,
          `## Tasks`,
          ``,
        ];

        for (const t of tasks) {
          lines.push(`- [ ] ${t.id}. [${t.phase}] ${t.description}`);
          lines.push(`  Acceptance: ${t.acceptance}`);
          lines.push(``);
        }

        lines.push(`## Progress`);
        lines.push(`Completed: 0/${tasks.length}`);
        lines.push(``);

        const planContent = lines.join("\n");
        const planPath = "/root/plan.md";
        await writeFile(planPath, planContent, "utf-8");
        logger.info(`[PLAN] Created plan for "${topic}" with ${tasks.length} tasks`);
        return `Plan created at ${planPath} with ${tasks.length} tasks. Now execute tasks one at a time. Call read_plan to see your next task.`;
      },
    },

    // ── Plan: Read Current Plan ──
    {
      name: "read_plan",
      description:
        "Read your current paper plan to see which task is next. " +
        "Returns the full plan with completed/pending status. " +
        "Look for the first [ ] (unchecked) task — that's your next action.",
      category: "research",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {},
      },
      execute: async (_args, _ctx) => {
        const { readFile } = await import("fs/promises");
        const planPath = await findPlanPath();
        if (!planPath) {
          return "No plan found. Call create_plan first, after reading guidance docs with fetch_guidance.";
        }
        try {
          const plan = await readFile(planPath, "utf-8");

          // Find next incomplete task
          const lines = plan.split("\n");
          let nextTask = "";
          for (const line of lines) {
            if (line.startsWith("- [ ] ")) {
              nextTask = line.replace("- [ ] ", "").trim();
              break;
            }
          }

          const completed = lines.filter(l => l.startsWith("- [x] ")).length;
          const total = lines.filter(l => l.match(/^- \[[ x]\] /)).length;

          let result = plan;
          result += `\n\n=== STATUS: ${completed}/${total} tasks complete ===`;
          if (nextTask) {
            result += `\n\nNEXT TASK: ${nextTask}`;
            result += `\nDo this task NOW. When done, call mark_task_done with the task number.`;
          } else {
            result += `\n\nALL TASKS COMPLETE. Your paper should be ready. Run quality_check, then self_evaluate.`;
          }
          return result;
        } catch {
          return "No plan found. Call create_plan first, after reading guidance docs with fetch_guidance.";
        }
      },
    },

    // ── Plan: Mark Task Done ──
    {
      name: "mark_task_done",
      description:
        "Mark a task as completed in your paper plan. " +
        "After completing a task, call this to track progress. " +
        "Then call read_plan to see your next task.",
      category: "research",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "number", description: "Task number to mark as done" },
          note: { type: "string", description: "Brief note on what was accomplished" },
        },
        required: ["task_id"],
      },
      execute: async (args, _ctx) => {
        const { readFile, writeFile } = await import("fs/promises");
        const taskId = args.task_id as number;
        const note = (args.note as string) || "";
        const planPath = await findPlanPath();
        if (!planPath) {
          return "No plan found. Call create_plan first.";
        }

        try {
          let plan = await readFile(planPath, "utf-8");

          // Find and check off the task — support "Task N:" format too
          const pattern = new RegExp(`^- \\[ \\] (?:Task )?${taskId}[.:]`, "m");
          if (!pattern.test(plan)) {
            return `Task ${taskId} not found or already completed. Call read_plan to see current status.`;
          }

          plan = plan.replace(pattern, `- [x] ${taskId}.`);

          // Update progress count
          const lines = plan.split("\n");
          const completed = lines.filter(l => l.startsWith("- [x] ")).length;
          const total = lines.filter(l => l.match(/^- \[[ x]\] /)).length;
          plan = plan.replace(/Completed: \d+\/\d+/, `Completed: ${completed}/${total}`);

          // Add note to progress section
          if (note) {
            const progressIdx = plan.indexOf("## Progress");
            if (progressIdx >= 0) {
              const insertAt = plan.indexOf("\n", plan.indexOf("Completed:", progressIdx)) + 1;
              plan = plan.slice(0, insertAt) + `- Task ${taskId}: ${note}\n` + plan.slice(insertAt);
            }
          }

          await writeFile(planPath, plan, "utf-8");
          logger.info(`[PLAN] Task ${taskId} marked done. ${completed}/${total} complete.`);

          // Find next task
          const nextMatch = plan.match(/^- \[ \] (\d+)\. .+$/m);
          if (nextMatch) {
            return `Task ${taskId} done (${completed}/${total}). Next: ${nextMatch[0].replace("- [ ] ", "")}`;
          }
          return `Task ${taskId} done. ALL ${total} TASKS COMPLETE! Run quality_check on your full paper, then self_evaluate.`;
        } catch {
          return "No plan found. Call create_plan first.";
        }
      },
    },

    // ── Guidance: Fetch Writing Guidance ──
    {
      name: "fetch_guidance",
      description:
        "Read ARA-derived writing guidance for a specific JIBS dimension (D01-D14). " +
        "Each guidance doc maps gate requirements to concrete writing instructions. " +
        "Call this BEFORE writing each section to understand what the gates demand. " +
        "Available: 01-research-question, 02-theory-causal-logic, 03-literature-positioning, " +
        "04-citations, 05-constructs, 06-hypotheses, 07-data-sample, 08-verified-data, " +
        "09-measurement, 10-statistical-methods, 11-causal-identification, 12-results, " +
        "13-robustness, 14-discussion-contribution. Use 'all' to get a summary of all.",
      category: "research",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          dimension: {
            type: "string",
            description:
              "Which dimension guidance to fetch. Examples: '01-research-question', '14-discussion-contribution', 'all'",
          },
        },
        required: ["dimension"],
      },
      execute: async (args, _ctx) => {
        const dim = args.dimension as string;
        const guidanceDir = "/opt/epistemon/guidance";

        if (dim === "all") {
          // Return a summary index of all guidance docs
          const { readdir } = await import("fs/promises");
          try {
            const files = await readdir(guidanceDir);
            const mdFiles = files.filter((f: string) => f.endsWith(".md")).sort();
            const lines = [
              "=== AVAILABLE GUIDANCE DOCUMENTS ===",
              "Call fetch_guidance with a specific dimension to read full guidance.",
              "",
            ];
            for (const f of mdFiles) {
              const name = f.replace(".md", "");
              lines.push(`  - ${name}`);
            }
            lines.push("");
            lines.push("WORKFLOW: Read guidance for the section you're about to write.");
            lines.push("  Writing Introduction? → fetch_guidance('01-research-question') + fetch_guidance('03-literature-positioning')");
            lines.push("  Writing Lit Review? → fetch_guidance('03-literature-positioning') + fetch_guidance('04-citations')");
            lines.push("  Writing Methods? → fetch_guidance('07-data-sample') + fetch_guidance('10-statistical-methods')");
            lines.push("  Writing Results? → fetch_guidance('12-results') + fetch_guidance('06-hypotheses')");
            lines.push("  Writing Discussion? → fetch_guidance('14-discussion-contribution') + fetch_guidance('11-causal-identification')");
            return lines.join("\n");
          } catch (err: any) {
            return `Guidance directory unavailable: ${err.message}`;
          }
        }

        // Read specific guidance file
        const { readFile } = await import("fs/promises");
        const candidates = [
          `${guidanceDir}/${dim}.md`,
          `${guidanceDir}/${dim}`,
        ];
        for (const path of candidates) {
          try {
            const content = await readFile(path, "utf-8");
            return content;
          } catch {
            continue;
          }
        }
        return `Guidance not found for '${dim}'. Use fetch_guidance('all') to see available documents.`;
      },
    },
  ];
}

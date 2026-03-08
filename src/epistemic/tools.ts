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
        "Search academic databases for papers matching a query. Returns titles, abstracts, DOIs. Uses Semantic Scholar with OpenAlex fallback.",
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
        "Fetch full metadata and abstract for a paper by DOI or Semantic Scholar ID.",
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
        "Submit findings for peer review. Costs $1 submission fee. If accepted by 3/4 judges, earns $5. Returns detailed judge verdicts.",
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
        const provider = new PaperMoneyProvider(
          ctx.db.raw,
          epistemicConfig.paperMoneyBalanceCents,
          epistemicConfig.ecsDecayFactor,
        );
        const board = new MockReviewBoard(provider, epistemicConfig.mockReviewAcceptRate);

        const title = args.title as string;
        const content = args.content as string;
        const result = board.review(title, content);

        // If accepted, add ECS
        if (result.accepted) {
          const novelty = 0.6 + Math.random() * 0.3; // placeholder — real scoring below
          const validity = 0.5 + Math.random() * 0.3;
          const coherence = 0.6 + Math.random() * 0.2;
          const ecsDelta = scorer.compute({ novelty, validity, coherence, utility: 0 });
          provider.addECS(ecsDelta);
          logger.info(`Paper accepted: "${title}" — ECS +${ecsDelta}`);
        }

        const verdictLines = result.verdicts.map((v) =>
          `  ${v.judge}: ${v.verdict.toUpperCase()} — "${v.reasoning}" (novelty:${v.scores.novelty}/10, validity:${v.scores.validity}/10, coherence:${v.scores.coherence}/10)`,
        );

        return [
          result.summary,
          `Submission ID: ${result.submissionId}`,
          `Fee paid: $${(result.feePaid / 100).toFixed(2)}`,
          `Reward earned: $${(result.rewardEarned / 100).toFixed(2)}`,
          ``,
          `Judge verdicts:`,
          ...verdictLines,
          ``,
          `Paper money balance: $${(provider.getBalance() / 100).toFixed(2)}`,
          `ECS: ${provider.getECS()}`,
        ].join("\n");
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
  ];
}

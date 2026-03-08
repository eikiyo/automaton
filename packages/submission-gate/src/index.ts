/**
 * Location: packages/submission-gate/src/index.ts
 * Purpose: JIBS AAA Quality Gate v3.0 — 286 gates, 20 dimensions, scored by Gemini 2.5 Pro
 * Functions: handleSubmit, handleList, handleDetail, handleRules, renderUI
 * Calls: Gemini 2.5 Pro (via Google AI API), KV
 * Imports: none (standalone CF Worker)
 */

interface Env {
  AI: Ai;
  SUBMISSIONS: KVNamespace;
  GEMINI_API_KEY: string;
}

// ─── Types ────────────────────────────────────────────────────

type GateScoring = "binary" | "qualitative";

interface Gate {
  id: string;
  critical: boolean;
  gate: string;
  scoring?: GateScoring; // computed at runtime, not stored in DIMENSIONS
}

interface Dimension {
  id: string;
  name: string;
  maxPoints: number;
  note?: string;
  gates: Gate[];
}

interface GateResult {
  id: string;
  dimension: string;
  dimensionId: string;
  critical: boolean;
  gate: string;
  pass: boolean;
  scoring: GateScoring;
  rawScore: number;   // binary: 0|1, qualitative: 0|1|2
  points: number;     // effective: binary 0|1, qualitative 0|0.5|1
  reasoning: string;
}

type Verdict = "SUBMIT" | "MINOR_REVISIONS" | "MAJOR_REVISIONS" | "DO_NOT_SUBMIT";

interface Submission {
  id: string;
  title: string;
  content: string;
  submittedAt: string;
  results: GateResult[];
  passed: number;
  failed: number;
  partial?: number;
  totalPoints?: number;
  score: number;
  verdict: Verdict;
  accepted: boolean;
  rejectReason?: string;
  dimensionScores: { id: string; name: string; passed: number; partial?: number; total: number; points?: number }[];
}

// ─── JIBS AAA Quality Gate v3.0 ───────────────────────────────

const DIMENSIONS: Dimension[] = [
  {
    id: "D00", name: "Structural-Substantive Coherence", maxPoints: 14,
    note: "These gates exist specifically because a paper can satisfy every other gate through surface compliance while being intellectually void. These cannot be answered by reading the text — they require probing the gap between what the paper claims and what it actually does.",
    gates: [
      { id: "D00-01", critical: true , gate: "Is the paper free of rubric scaffolding artifacts — no gate codes, checklist markers, or evaluation-framework references embedded in the body text, footnotes, or tables? A paper written to satisfy a rubric and a paper written to advance knowledge are different objects." },
      { id: "D00-02", critical: true , gate: "Does the claimed methodology match what is actually executed — if PRISMA or JBI systematic review protocols are invoked, is the full apparatus present: PRISMA flowchart, search logs, inter-rater reliability, and quality appraisal scores? Invoking a protocol without executing it is methodological misrepresentation." },
      { id: "D00-03", critical: true , gate: "Do the cases, observations, or data points used as evidence actually instantiate the theoretical construct under study — not cases selected because they are famous, available, or directionally supportive?" },
      { id: "D00-04", critical: true , gate: "Is the aggregate N, if reported, derived from compatible units — not a sum of firm observations across studies with different sampling frames, methodologies, and definitions of 'firm observation' presented as a single coherent sample?" },
      { id: "D00-05", critical: true , gate: "Is every quantitative-looking table — matrices, indices, composite scores — derived from operations that are statistically valid for the data type? A vote-count or directional-agreement ratio presented in the visual form of a correlation matrix is a misrepresentation, not a robustness check." },
      { id: "D00-06", critical: false, gate: "Can the paper's core argument be falsified from within its own evidence — does the paper acknowledge at least one case or observation in its own sample where the predicted mechanism did not hold, and does it explain why?" },
      { id: "D00-07", critical: false, gate: "Is the theoretical argument non-tautological — does the paper predict something that could not have been derived simply by restating the definitions of its constructs? ('Voids cause exploration because the absence of constraints removes constraints' is a tautology, not a theory.)" },
      { id: "D00-08", critical: false, gate: "Does the paper exhibit genuine intellectual tension — is there at least one moment where the evidence complicates, qualifies, or partially contradicts the theoretical prediction, handled analytically rather than dismissed?" },
      { id: "D00-09", critical: false, gate: "Is the hypothesis set non-trivially falsifiable — would any plausible real-world dataset have the potential to reject H1, H2, or H3 as stated, or are the hypotheses so broadly framed that virtually any pattern in the data would be consistent with them?" },
      { id: "D00-10", critical: false, gate: "Is the theoretical contribution distinguishable from a synthesis — does the paper generate a novel prediction that cannot be derived by reading the cited sources in sequence, or is the 'contribution' the act of combining existing ideas?" },
      { id: "D00-11", critical: false, gate: "Is the paper's causal model unique — could the same double-loop mechanism (context → exploration → transfer) be applied, unchanged, to any industry in any emerging market, or does the Fintech-specific institutional void logic generate predictions that would not hold in other sectors?" },
      { id: "D00-12", critical: false, gate: "Is the study design capable of distinguishing the proposed mechanism from the most obvious alternative — if voids drive exploration, does the paper show cases where voids are absent and exploration does not occur, not just cases where both are present?" },
      { id: "D00-13", critical: false, gate: "Is the literature gap real and not manufactured — does the paper accurately characterize the state of prior work, or does it selectively omit proximate studies that would significantly narrow or eliminate the claimed gap?" },
      { id: "D00-14", critical: false, gate: "Is the paper's contribution durable — would it still constitute a contribution if one of the three landmark cases were removed from the analysis, or does the entire argument depend on the specific selection of cases that happen to support it?" },
    ],
  },
  {
    id: "D01", name: "Research Question & IB Contribution", maxPoints: 14,
    gates: [
      { id: "D01-01", critical: true , gate: "Is there a single, precisely scoped research question — not a topic, not a theme?" },
      { id: "D01-02", critical: true , gate: "Is the research question genuinely international — would it collapse or become trivial in a single-country setting?" },
      { id: "D01-03", critical: true , gate: "Is the theoretical contribution stated explicitly — what does the field now know that it did not know before?" },
      { id: "D01-04", critical: true , gate: "Is the empirical contribution distinct from the theoretical contribution and stated separately?" },
      { id: "D01-05", critical: false, gate: "Is the contribution non-incremental — does it challenge, extend, or reconcile prior theory rather than merely replicate?" },
      { id: "D01-06", critical: false, gate: "Is the empirical setting justified as the right context for the theory — not selected purely for data convenience?" },
      { id: "D01-07", critical: false, gate: "Does the paper state the consequence of knowing vs. not knowing — why answering this question matters to the IB field?" },
      { id: "D01-08", critical: false, gate: "Is the unit of analysis defined (firm, dyad, country, individual, subsidiary) and held constant throughout?" },
      { id: "D01-09", critical: false, gate: "Is the level of analysis consistent — no conflation of firm-level arguments with country-level evidence or vice versa?" },
      { id: "D01-10", critical: false, gate: "Is the paper's scope bounded — does it explicitly state what it does NOT claim?" },
      { id: "D01-11", critical: false, gate: "Does the paper contribute to at least one of: theory development, theory testing, theory reconciliation, or phenomenon documentation at JIBS standard?" },
      { id: "D01-12", critical: false, gate: "Is the IB phenomenon studied intrinsically cross-border — not a domestic phenomenon measured in multiple countries?" },
      { id: "D01-13", critical: false, gate: "Does the paper avoid the 'substitution fallacy' — using country as a proxy for culture, institutions, or other constructs without justification?" },
      { id: "D01-14", critical: false, gate: "Is the paper's contribution to IB theory stated in the introduction, not deferred to the conclusion?" },
      { id: "D01-15", critical: true , gate: "Do all empirical cases or observations actually fit the unit of analysis claimed in the research question — e.g., if the paper claims to study MNE subsidiaries, are all cases genuinely MNE subsidiaries and not standalone domestic firms or VC-backed startups?" },
      { id: "D01-16", critical: true , gate: "Is the empirical scope consistent with the theoretical framing throughout — does the paper not claim to study X while presenting evidence from Y because Y was more available?" },
      { id: "D01-17", critical: true , gate: "Is the paper's framing of 'MNE subsidiary' applied consistently to all cases — does each case entity actually have an MNE parent that controls or significantly owns it, or are independent firms, domestic champions, or VC-backed startups misclassified as subsidiaries because they operate in the same sector?" },
    ],
  },
  {
    id: "D02", name: "IB Theory & Causal Logic", maxPoints: 16,
    gates: [
      { id: "D02-01", critical: true , gate: "Is a formal theoretical framework identified and applied — not merely cited for legitimacy?" },
      { id: "D02-02", critical: true , gate: "Is the causal mechanism explicit: X → Y via Z — not just a predicted association or correlation?" },
      { id: "D02-03", critical: true , gate: "Is the theory grounded in IB or management scholarship, or is its application to IB contexts explicitly justified?" },
      { id: "D02-04", critical: false, gate: "Is the chosen theory the strongest available for this phenomenon — are alternatives considered and dismissed on stated grounds?" },
      { id: "D02-05", critical: false, gate: "Are boundary conditions of the theory acknowledged — where does it not apply?" },
      { id: "D02-06", critical: false, gate: "If multiple theories are used, are they integrated rather than listed independently?" },
      { id: "D02-07", critical: false, gate: "Does the theory travel to the empirical context — is cross-national application of the theory justified?" },
      { id: "D02-08", critical: false, gate: "Is the theoretical contribution separated from the empirical contribution?" },
      { id: "D02-09", critical: false, gate: "Are competing theoretical predictions acknowledged and addressed?" },
      { id: "D02-10", critical: false, gate: "Is the theory used to explain variance, not just describe a pattern?" },
      { id: "D02-11", critical: false, gate: "Is the direction of the predicted effect derived from theory — not just asserted as positive or negative?" },
      { id: "D02-12", critical: false, gate: "If the paper introduces a theoretical extension or modification, is the deviation from the base theory justified?" },
      { id: "D02-13", critical: false, gate: "Does the theory identify the actor whose behavior is being explained — and is this actor the unit of analysis?" },
      { id: "D02-14", critical: false, gate: "Is the temporal logic of the theory explicit — does X precede Y, and is this reflected in the data?" },
      { id: "D02-15", critical: false, gate: "Are institutional context effects theorized, not just controlled for — if institutions matter, the theory must say why?" },
      { id: "D02-16", critical: false, gate: "Is the theoretical model internally consistent — no contradictory premises within the same argument?" },
    ],
  },
  {
    id: "D03", name: "Literature Positioning", maxPoints: 12,
    gates: [
      { id: "D03-01", critical: true , gate: "Is the gap specific — a precise void, tension, or paradox — not 'little research has examined X'?" },
      { id: "D03-02", critical: false, gate: "Does the literature review synthesize rather than list — does it reveal structure, conflict, or evolution in the field?" },
      { id: "D03-03", critical: false, gate: "Is the paper positioned against at least two distinct streams of prior work?" },
      { id: "D03-04", critical: false, gate: "Are seminal and canonical IB works cited?" },
      { id: "D03-05", critical: false, gate: "Is literature from the past 5 years included?" },
      { id: "D03-06", critical: false, gate: "Are conflicting findings in the literature acknowledged — not cherry-picked to support the argument?" },
      { id: "D03-07", critical: false, gate: "Is the contribution stated relative to the literature — what it overturns, extends, or reconciles?" },
      { id: "D03-08", critical: false, gate: "Is the literature review proportionate — focused on the gap, not encyclopedic?" },
      { id: "D03-09", critical: false, gate: "Are meta-analyses or systematic reviews in the area cited where they exist?" },
      { id: "D03-10", critical: false, gate: "Is the most recent JIBS-published work on the topic engaged with directly?" },
      { id: "D03-11", critical: false, gate: "Does the paper avoid literature review as chronological summary — is it organized by argument, not by year?" },
      { id: "D03-12", critical: false, gate: "Is the theoretical gap distinguished from the empirical gap — these are different justifications and must not be conflated?" },
    ],
  },
  {
    id: "D04", name: "Verified Citations", maxPoints: 10, note: "Reviewer must open and check cited sources directly. No inference allowed.",
    gates: [
      { id: "D04-01", critical: true , gate: "VERIFY: For every empirical claim attributed to a specific study, does that study actually report that finding? (Spot-check minimum 5 citations)" },
      { id: "D04-02", critical: true , gate: "VERIFY: Are there no cases where a cited paper's conclusion is reversed, overstated, or taken out of context in this paper?" },
      { id: "D04-03", critical: true , gate: "VERIFY: Are statistical figures cited from prior work (sample sizes, effect sizes, percentages) traceable to the original source — not a secondary citation?" },
      { id: "D04-04", critical: false, gate: "VERIFY: Are all works cited in-text present in the reference list — no orphan citations?" },
      { id: "D04-05", critical: false, gate: "VERIFY: Are all works in the reference list cited in-text — no ghost references?" },
      { id: "D04-06", critical: false, gate: "VERIFY: Are there no self-citation chains that inflate the apparent support for a claim beyond what the work actually demonstrates?" },
      { id: "D04-07", critical: false, gate: "VERIFY: When a finding is described as 'well-established' or 'consistent', do the cited studies actually show consistency — not mixed evidence?" },
      { id: "D04-08", critical: false, gate: "VERIFY: Are country-level stylized facts (e.g., FDI flows, institutional rankings) cited from primary sources — World Bank, OECD, UNCTAD — not from other papers that themselves cite these?" },
      { id: "D04-09", critical: false, gate: "VERIFY: Are any foundational theoretical claims (e.g., OLI, TCE, institutional theory) cited to the original theoretical source, not a textbook or review?" },
      { id: "D04-10", critical: false, gate: "VERIFY: When the paper claims 'no prior study has examined X', is this claim defensible — has a basic literature search been conducted to validate it?" },
      { id: "D04-11", critical: true , gate: "VERIFY: Do all cited papers exist as described — correct authors, year, journal, and title — or is there evidence of hallucinated, confabulated, or AI-generated references?" },
      { id: "D04-12", critical: true , gate: "VERIFY: Is the cited paper's subject matter consistent with the claim it is being used to support — e.g., a paper on explainable AI should not be cited as evidence for local embeddedness dynamics in fintech?" },
      { id: "D04-13", critical: false, gate: "VERIFY: Are all cited databases, tools, or knowledge bases recognized academic sources — not obscure repositories, grey literature portals, or non-peer-reviewed platforms cited as if they were primary scholarly sources?" },
    ],
  },
  {
    id: "D05", name: "Construct Definition & Conceptual Clarity", maxPoints: 12,
    gates: [
      { id: "D05-01", critical: true , gate: "Are all key constructs formally defined at first use?" },
      { id: "D05-02", critical: true , gate: "Are construct definitions stable — no conceptual drift between theory, hypotheses, and measurement?" },
      { id: "D05-03", critical: false, gate: "Are conceptual boundaries between similar constructs made explicit?" },
      { id: "D05-04", critical: false, gate: "Is the dependent variable defined both conceptually and operationally — and are the two consistent?" },
      { id: "D05-05", critical: false, gate: "Are mediators and moderators conceptually distinct from main effect variables?" },
      { id: "D05-06", critical: false, gate: "Is the level of construct abstraction consistent — no mixing of firm-level constructs with country-level operationalizations without justification?" },
      { id: "D05-07", critical: false, gate: "Is every construct grounded in prior literature — not invented ad hoc without theoretical precedent?" },
      { id: "D05-08", critical: false, gate: "Are reflective vs. formative constructs distinguished — and is the measurement model appropriate for each?" },
      { id: "D05-09", critical: false, gate: "Are constructs defined in a way that is cross-nationally valid — not culturally bound to one context?" },
      { id: "D05-10", critical: false, gate: "Is the dependent variable conceptually justified as the right outcome — not just the most available one?" },
      { id: "D05-11", critical: false, gate: "Are all abbreviations defined at first use and used consistently thereafter?" },
      { id: "D05-12", critical: false, gate: "Is the construct space complete — are there important related constructs that should be in the model but are absent without justification?" },
    ],
  },
  {
    id: "D06", name: "Hypotheses & Argumentation", maxPoints: 14,
    gates: [
      { id: "D06-01", critical: true , gate: "Are all hypotheses falsifiable — could they be empirically wrong?" },
      { id: "D06-02", critical: true , gate: "Is each hypothesis derived from the theoretical framework — not asserted or borrowed from intuition?" },
      { id: "D06-03", critical: true , gate: "Is the logical chain premise → argument → hypothesis traceable without non-sequiturs or leaps?" },
      { id: "D06-04", critical: false, gate: "Are directional hypotheses justified — not just predicting 'an effect'?" },
      { id: "D06-05", critical: false, gate: "Are all stated hypotheses tested — none introduced and quietly abandoned?" },
      { id: "D06-06", critical: false, gate: "Are interaction/moderation hypotheses theoretically derived — not post-hoc pattern matching?" },
      { id: "D06-07", critical: false, gate: "For mediation: is the full sequence X→M→Y theoretically argued, not just tested?" },
      { id: "D06-08", critical: false, gate: "Are null or competing predictions discussed where theory legitimately permits them?" },
      { id: "D06-09", critical: false, gate: "Are curvilinear predictions (if any) theoretically derived — not fitted to observed data?" },
      { id: "D06-10", critical: false, gate: "Are country-level moderating hypotheses grounded in theory — not generic 'institutional context will moderate' claims?" },
      { id: "D06-11", critical: false, gate: "Does the argument rule out alternative explanations for the predicted relationship before the results section?" },
      { id: "D06-12", critical: false, gate: "Is the number of hypotheses proportionate to the theory — not so many that the paper loses focus?" },
      { id: "D06-13", critical: false, gate: "Are hypotheses stated in a way that maps cleanly onto a specific statistical test — no ambiguity between the verbal hypothesis and its test?" },
      { id: "D06-14", critical: false, gate: "For multi-level hypotheses: is the cross-level interaction theoretically argued at both levels simultaneously?" },
      { id: "D06-15", critical: true , gate: "Is the paper epistemologically consistent — does it not mix deductive hypothesis language (H1, H2, H3) with inductive proposition language (P1, P2, P3) in the same manuscript without a clear methodological justification for doing so?" },
      { id: "D06-16", critical: true , gate: "Is the chosen framing — hypotheses vs. propositions — appropriate for the method actually used: hypotheses for deductive quantitative testing, propositions for inductive qualitative theory building?" },
      { id: "D06-17", critical: false, gate: "Does the theory predict the direction of the effect with enough specificity that a null result or negative result would be surprising and theoretically significant — or is the hypothesis so vague that any outcome can be post-hoc rationalized as consistent with the theory?" },
    ],
  },
  {
    id: "D07", name: "Data & Sample", maxPoints: 16,
    gates: [
      { id: "D07-01", critical: true , gate: "Is the data source described in sufficient detail for independent replication — database name, version, access date, download filters?" },
      { id: "D07-02", critical: true , gate: "Is sample size reported and sufficient for the statistical tests employed?" },
      { id: "D07-03", critical: false, gate: "Are sampling procedures and inclusion/exclusion criteria explicitly stated?" },
      { id: "D07-04", critical: false, gate: "Is the time period of data collection stated and theoretically justified?" },
      { id: "D07-05", critical: false, gate: "For cross-national data: does the country sample reflect the theoretical population, not just data availability?" },
      { id: "D07-06", critical: false, gate: "Are potential selection biases identified — survivorship, self-selection, non-response, attrition — and addressed?" },
      { id: "D07-07", critical: false, gate: "Is missing data reported: volume, pattern, and handling method?" },
      { id: "D07-08", critical: false, gate: "Is a descriptive statistics table provided for all key variables?" },
      { id: "D07-09", critical: false, gate: "Is a correlation matrix provided for all key variables?" },
      { id: "D07-10", critical: false, gate: "Is the target population to which results generalize explicitly stated?" },
      { id: "D07-11", critical: false, gate: "For longitudinal data: is the lag structure between independent and dependent variables theoretically justified?" },
      { id: "D07-12", critical: false, gate: "For archival data: are the data collection and coding procedures described in enough detail to assess reliability?" },
      { id: "D07-13", critical: false, gate: "For survey data: is the response rate reported and non-response bias assessed?" },
      { id: "D07-14", critical: false, gate: "Is the sampling frame appropriate — does it actually represent the theoretical population?" },
      { id: "D07-15", critical: false, gate: "Are data from multiple sources merged correctly — is the match key described and its accuracy addressed?" },
      { id: "D07-16", critical: false, gate: "Is generalizability of findings explicitly discussed relative to the specific sample used?" },
      { id: "D07-17", critical: true , gate: "If a systematic review or meta-analytic protocol (PRISMA, JBI, PROSPERO) is invoked, is the full protocol actually executed and documented — search logs, inclusion/exclusion flowchart, inter-rater reliability — or is 'systematic' used as a credibility label over a narrative synthesis?" },
      { id: "D07-18", critical: true , gate: "Is the total N reported for any aggregated analysis traceable to explicit arithmetic from the stated sources — no opaque aggregation where the sum cannot be independently reconstructed from the data described?" },
      { id: "D07-19", critical: false, gate: "For qualitative or case-based studies: is the case selection justified against the theoretical sampling logic — not convenience, not fame, and not post-hoc selection of cases that confirm the argument?" },
    ],
  },
  {
    id: "D08", name: "Verified Data", maxPoints: 12, note: "Reviewer must spot-check the dataset or data construction directly. No inference allowed.",
    gates: [
      { id: "D08-01", critical: true , gate: "VERIFY: Are summary statistics internally consistent — do means, SDs, and N match the reported sample after stated exclusions?" },
      { id: "D08-02", critical: true , gate: "VERIFY: For secondary data, are variable definitions traceable to the original codebook or database documentation?" },
      { id: "D08-03", critical: true , gate: "VERIFY: Are there no impossible values — negative firm age, leverage > 10, ROA outside plausible range, binary variables with non-binary means?" },
      { id: "D08-04", critical: false, gate: "VERIFY: For hand-collected data, is inter-rater reliability reported and at an acceptable level (Cohen's κ > 0.70 or equivalent)?" },
      { id: "D08-05", critical: false, gate: "VERIFY: Is the correlation matrix sign-consistent with theory — no theoretically implausible correlations without explanation?" },
      { id: "D08-06", critical: false, gate: "VERIFY: For country-level data (WDI, WGI, Hofstede, ICRG), is the vintage/year matched to the firm-level data year — not a fixed single year applied to a multi-year panel?" },
      { id: "D08-07", critical: false, gate: "VERIFY: Are panel composition and attrition consistent with what is reported — does N per year match the stated panel construction?" },
      { id: "D08-08", critical: false, gate: "VERIFY: Is the dependent variable winsorized or trimmed as stated — are the distributional tails consistent with the stated thresholds?" },
      { id: "D08-09", critical: false, gate: "VERIFY: Are the number of countries, industries, and years consistent across tables — no unexplained variation in N across models?" },
      { id: "D08-10", critical: false, gate: "VERIFY: For survey data — do the Likert scale descriptives (means near midpoint, reasonable SDs) suggest no systematic acquiescence or ceiling/floor bias?" },
      { id: "D08-11", critical: false, gate: "VERIFY: Is the exchange rate conversion method stated and consistent — no mixing of nominal and PPP-adjusted figures without justification?" },
      { id: "D08-12", critical: false, gate: "VERIFY: Are industry classifications consistent — no mixing of SIC, NAICS, ISIC codes within the same analysis without crosswalk documentation?" },
    ],
  },
  {
    id: "D09", name: "Measurement & Variables", maxPoints: 14,
    gates: [
      { id: "D09-01", critical: true , gate: "Is the operationalization of each construct specified in detail — not just named?" },
      { id: "D09-02", critical: false, gate: "For survey/scale items: are reliability coefficients (Cronbach α or McDonald ω) reported?" },
      { id: "D09-03", critical: false, gate: "For survey/scale items: is construct validity assessed — convergent and discriminant?" },
      { id: "D09-04", critical: false, gate: "For cross-national surveys: is measurement equivalence (configural, metric, scalar) tested across groups?" },
      { id: "D09-05", critical: false, gate: "Are proxy variables justified when direct measures are unavailable — and their limitations acknowledged?" },
      { id: "D09-06", critical: false, gate: "Is the direction of coding for all variables unambiguous?" },
      { id: "D09-07", critical: false, gate: "Are control variables theoretically justified — not a kitchen-sink list?" },
      { id: "D09-08", critical: false, gate: "Is measurement error acknowledged and addressed where feasible?" },
      { id: "D09-09", critical: false, gate: "For country-level moderators: is the institutional/cultural measure matched to the right theoretical dimension — rule of law, corruption, and uncertainty avoidance are not interchangeable?" },
      { id: "D09-10", critical: false, gate: "Are interaction terms constructed correctly — mean-centered or standardized before multiplication to reduce multicollinearity?" },
      { id: "D09-11", critical: false, gate: "For count or rate dependent variables: is the distributional assumption of the model appropriate — Poisson, negative binomial, or zero-inflated as required?" },
      { id: "D09-12", critical: false, gate: "Are time-invariant controls included in cross-sectional models where theoretically relevant?" },
      { id: "D09-13", critical: false, gate: "For cultural distance measures: is the chosen formula (Kogut-Singh, Mahalanobis, etc.) justified and its known limitations acknowledged?" },
      { id: "D09-14", critical: false, gate: "Is the measurement of the key independent variable free from contamination by the dependent variable — no construct overlap in operationalization?" },
      { id: "D09-15", critical: true , gate: "Are all quantitative-looking constructs — indices, ratios, composite scores — formally valid for the statistical operations performed on them: e.g., an 'agreement ratio' or vote-count cannot be presented as or substituted for a Pearson correlation coefficient?" },
      { id: "D09-16", critical: false, gate: "Are any pseudo-quantitative constructs derived from qualitative data explicitly labeled as such — not dressed in the visual language of quantitative measurement (correlation matrices, regression-style tables) without the underlying statistical validity?" },
    ],
  },
  {
    id: "D10", name: "Statistical Methods", maxPoints: 16,
    gates: [
      { id: "D10-01", critical: true , gate: "Is the statistical method appropriate for the data structure — OLS, panel FE/RE, multilevel, count, survival, etc.?" },
      { id: "D10-02", critical: true , gate: "Is endogeneity addressed — or explicitly acknowledged as a limitation with the likely direction of bias stated?" },
      { id: "D10-03", critical: false, gate: "Are model assumptions stated and tested?" },
      { id: "D10-04", critical: false, gate: "Are standard errors corrected for heteroscedasticity and/or clustering at the appropriate level?" },
      { id: "D10-05", critical: false, gate: "Is multicollinearity assessed and within acceptable bounds?" },
      { id: "D10-06", critical: false, gate: "For panel data: is fixed vs. random effects choice justified with a Hausman test or equivalent?" },
      { id: "D10-07", critical: false, gate: "For mediation: are bootstrapped confidence intervals used — not Baron-Kenny steps alone?" },
      { id: "D10-08", critical: false, gate: "For multilevel data: is a multilevel model used rather than OLS that ignores nesting?" },
      { id: "D10-09", critical: false, gate: "Is software and version reported?" },
      { id: "D10-10", critical: false, gate: "For survival/hazard models: is the baseline hazard specification justified — Cox, Weibull, etc.?" },
      { id: "D10-11", critical: false, gate: "For binary dependent variables: is a logit/probit used rather than OLS — and are marginal effects reported rather than raw coefficients?" },
      { id: "D10-12", critical: false, gate: "For SEM: are model fit indices reported (CFI, RMSEA, SRMR) and within acceptable thresholds?" },
      { id: "D10-13", critical: false, gate: "Is the estimation strategy described with enough detail that a researcher in the same field could replicate the results?" },
      { id: "D10-14", critical: false, gate: "Is the number of estimated parameters reasonable relative to sample size — no overfitting risk?" },
      { id: "D10-15", critical: false, gate: "For panel models: is time fixed effects inclusion/exclusion theoretically justified — not left as default?" },
      { id: "D10-16", critical: false, gate: "Is the model build-up presented sequentially — baseline, then controls, then hypothesized variables — so the incremental contribution of each block is visible?" },
      { id: "D10-17", critical: false, gate: "Is the statistical software cited actually used for operations the software performs — no citation of quantitative analysis software (Stata, R, SPSS) for operations that are purely qualitative aggregation or categorical vote-counting?" },
      { id: "D10-18", critical: false, gate: "Is the analytical method free of credibility-signaling — no invocation of advanced tools, protocols, or software to lend quantitative legitimacy to work that is inherently qualitative or interpretive?" },
    ],
  },
  {
    id: "D11", name: "Causal Identification", maxPoints: 12,
    gates: [
      { id: "D11-01", critical: true , gate: "Are causal claims proportionate to the identification strategy — no causal language in a purely observational design?" },
      { id: "D11-02", critical: true , gate: "Is reverse causality explicitly considered — not just acknowledged in one sentence at the end?" },
      { id: "D11-03", critical: false, gate: "If IV is used: are instrument relevance (first-stage F > 10) and exclusion restriction both defended?" },
      { id: "D11-04", critical: false, gate: "If DiD is used: are parallel pre-trends tested, and is treatment assignment exogenous?" },
      { id: "D11-05", critical: false, gate: "If RDD is used: is manipulation of the running variable tested?" },
      { id: "D11-06", critical: false, gate: "Are omitted variable threats named specifically — not just generically acknowledged?" },
      { id: "D11-07", critical: false, gate: "Is a placebo or falsification test performed to strengthen causal interpretation?" },
      { id: "D11-08", critical: false, gate: "Is simultaneity bias addressed where the independent and dependent variables could be jointly determined?" },
      { id: "D11-09", critical: false, gate: "For natural experiments: is the exogeneity of the shock defended — not just assumed because it is 'exogenous to the firm'?" },
      { id: "D11-10", critical: false, gate: "Is the direction of omitted variable bias stated — would unobserved confounders inflate or attenuate the estimated effect?" },
      { id: "D11-11", critical: false, gate: "Is Heckman selection correction or equivalent used where sample selection into the study is non-random?" },
      { id: "D11-12", critical: false, gate: "For cross-national studies: is country-level unobserved heterogeneity addressed — country fixed effects, or justified absence thereof?" },
    ],
  },
  {
    id: "D12", name: "Results Presentation", maxPoints: 10,
    gates: [
      { id: "D12-01", critical: true , gate: "Are coefficient estimates, standard errors or confidence intervals, and significance levels reported for every model?" },
      { id: "D12-02", critical: false, gate: "Are effect sizes reported alongside p-values?" },
      { id: "D12-03", critical: false, gate: "Is economic or practical significance discussed — not just statistical significance?" },
      { id: "D12-04", critical: false, gate: "Are null results reported and given substantive explanation — not buried or dropped?" },
      { id: "D12-05", critical: false, gate: "Are all model specifications presented — not only those supporting the hypotheses?" },
      { id: "D12-06", critical: false, gate: "Is there no p-hacking signal — no cluster of results just at p < .05 without robustness confirmation?" },
      { id: "D12-07", critical: false, gate: "For interactions: are marginal effects plotted across the range of the moderator — not just reported as a coefficient?" },
      { id: "D12-08", critical: false, gate: "Are the signs of all control variable coefficients consistent with theory or prior literature — or are unexpected signs explained?" },
      { id: "D12-09", critical: false, gate: "Is the variance explained (R², pseudo-R², ICC) reported and interpreted?" },
      { id: "D12-10", critical: false, gate: "For multi-model tables: is the progression from model to model explained — not left to the reader to infer?" },
    ],
  },
  {
    id: "D13", name: "Robustness & Validity", maxPoints: 12,
    gates: [
      { id: "D13-01", critical: false, gate: "Are robustness checks performed with at least one alternative model specification?" },
      { id: "D13-02", critical: false, gate: "Are results robust to alternative operationalizations of the key independent variable?" },
      { id: "D13-03", critical: false, gate: "For survey data: is common method bias assessed — Harman single factor, marker variable, or CFA approach?" },
      { id: "D13-04", critical: false, gate: "Are influential observations and outliers assessed — results reported with and without them?" },
      { id: "D13-05", critical: false, gate: "Is subgroup heterogeneity explored — do results hold across economically meaningful subsamples?" },
      { id: "D13-06", critical: false, gate: "For cross-national studies: do results hold when specific countries or regions are excluded?" },
      { id: "D13-07", critical: false, gate: "Is a sensitivity analysis performed if any key assumption is contestable?" },
      { id: "D13-08", critical: false, gate: "Are results robust to alternative time windows or observation periods?" },
      { id: "D13-09", critical: false, gate: "Is the alternative dependent variable test performed — does the finding hold with a different but theoretically valid outcome measure?" },
      { id: "D13-10", critical: false, gate: "For matched samples or PSM: is balance across matched and unmatched groups reported?" },
      { id: "D13-11", critical: false, gate: "Is construct validity checked — do results hold when the key construct is measured differently?" },
      { id: "D13-12", critical: false, gate: "Is the placebo dependent variable test performed — does the effect disappear when an outcome that should not be affected is used as the DV?" },
    ],
  },
  {
    id: "D14", name: "Discussion, Limitations & Contribution", maxPoints: 14,
    gates: [
      { id: "D14-01", critical: true , gate: "Does the conclusion stay within the bounds of what the results support — no overclaiming beyond the data?" },
      { id: "D14-02", critical: true , gate: "Is the JIBS relevance explicit — does the paper engage with the international dimension of business, not just use cross-country data?" },
      { id: "D14-03", critical: false, gate: "Does the discussion interpret findings through the theoretical framework — not just restate coefficients in prose?" },
      { id: "D14-04", critical: false, gate: "Are surprising or null results given substantive theoretical explanation?" },
      { id: "D14-05", critical: false, gate: "Is the theoretical contribution restated concretely — what the field should update or revise in light of these findings?" },
      { id: "D14-06", critical: false, gate: "Are managerial or policy implications stated concretely — not generic 'managers should consider X' platitudes?" },
      { id: "D14-07", critical: false, gate: "Are limitations acknowledged honestly and specifically — including their likely direction and magnitude of bias?" },
      { id: "D14-08", critical: false, gate: "Are future research directions specific and actionable — not 'more research is needed'?" },
      { id: "D14-09", critical: false, gate: "Is the abstract complete: motivation, gap, method, key finding, and contribution?" },
      { id: "D14-10", critical: false, gate: "Does the discussion distinguish between what the results confirm versus what they suggest — epistemic humility about exploratory findings?" },
      { id: "D14-11", critical: false, gate: "Are the implications stated at the right level — do firm-level findings generate firm-level implications, not country-level policy prescriptions?" },
      { id: "D14-12", critical: false, gate: "Does the paper avoid the 'theoretical hand-wave' — where implications are described as 'consistent with theory' without specifying which aspect of theory is supported or challenged?" },
      { id: "D14-13", critical: false, gate: "Is the generalizability of findings explicitly scoped — to which countries, industries, firm types, or periods do conclusions apply?" },
      { id: "D14-14", critical: false, gate: "Are the limitations section and the future research section distinct — limitations are not research questions in disguise?" },
    ],
  },
  {
    id: "D15", name: "Adversarial Stress Tests", maxPoints: 12,
    note: "These gates subject the paper to hostile-reviewer scrutiny — the tests an editor-in-chief applies before deciding whether to send a paper to review. A paper that fails these is desk-rejected regardless of methodological quality.",
    gates: [
      { id: "D15-01", critical: true , gate: "NOVELTY KILL TEST: Does the paper address a question that is genuinely unanswered in the cited literature — not a question whose answer is already implied by existing findings, proposed as 'future research' in a prior paper's discussion, or derivable by combining two known results?" },
      { id: "D15-02", critical: true , gate: "SO-WHAT TEST: If the paper's central claim were confirmed beyond all doubt, would it change either (a) how practitioners in the field operate, or (b) how researchers conceptualize the phenomenon? If the answer to both is 'not materially,' the contribution is trivial regardless of methodological quality." },
      { id: "D15-03", critical: false, gate: "FEASIBILITY TEST: Is the proposed or executed research design practically feasible — could a researcher with standard institutional access, a reasonable budget, and 12-18 months realistically execute this study as described?" },
      { id: "D15-04", critical: false, gate: "ADVERSARIAL COUNTER-HYPOTHESIS: Does the paper anticipate and address the strongest possible objection from a hostile expert — or can a devastating counter-argument be constructed that the paper fails to acknowledge?" },
      { id: "D15-05", critical: false, gate: "DESK REJECTION RISK: Would this paper survive desk rejection at its target journal — is the scope right (not too broad, not too narrow), does it fit the journal's established domain, and does it meet basic threshold standards for contribution, rigor, and writing quality?" },
      { id: "D15-06", critical: false, gate: "COUNTER-ARGUMENT ANSWERABILITY: For the strongest counter-argument against the paper's thesis, does the paper provide a convincing rebuttal — or is the objection devastating and left unaddressed?" },
      { id: "D15-07", critical: false, gate: "WEAKEST POINT HONESTY: Does the paper identify its own most vulnerable assumption, design choice, or inferential leap and address it directly — rather than burying it in a generic limitations paragraph or deflecting entirely?" },
      { id: "D15-08", critical: false, gate: "CONCRETE CONSEQUENCE: Does the paper state a specific consequence of its findings — who changes behavior, what decision is made differently, what policy shifts — rather than generic 'contributes to the literature' or 'has implications for managers'?" },
      { id: "D15-09", critical: false, gate: "NOVELTY TYPE CLARITY: Is the paper's contribution classifiable as a specific type — theoretical inversion, missing causal link, moderator discovery, cross-domain transfer, new measurement approach, or taxonomy revision — or is it a vague 'adds to the conversation'?" },
      { id: "D15-10", critical: false, gate: "CONFIDENCE CALIBRATION: Does the strength of the paper's language ('demonstrates', 'proves', 'establishes') match the actual strength of its evidence — or does the paper systematically overclaim relative to what its data and methodology can support?" },
      { id: "D15-11", critical: false, gate: "ALTERNATIVE EXPLANATION EXCLUSION: Has the paper considered and ruled out the most obvious alternative explanation for its findings — or could a simpler, more parsimonious account explain the same observed pattern?" },
      { id: "D15-12", critical: false, gate: "DOMAIN EXPERT SURPRISE TEST: Would a domain expert learn something genuinely new from this paper — would they update their beliefs or revise their mental model of the phenomenon — or would they say 'we already knew this'?" },
    ],
  },
  {
    id: "D16", name: "Publication Readiness Audit", maxPoints: 14,
    note: "These gates check whether the paper is structurally ready for peer review — catching problems that would trigger immediate desk rejection or reviewer frustration before they become embedded in the manuscript.",
    gates: [
      { id: "D16-01", critical: true , gate: "RED THREAD TEST: Can a single coherent argument be traced from the first sentence of the introduction to the last sentence of the conclusion without the logical thread being lost, interrupted, or substituted at any point?" },
      { id: "D16-02", critical: true , gate: "GAP-CONTRIBUTION ALIGNMENT: Does the gap identified in the introduction EXACTLY match the contribution claimed in the discussion and conclusion — or has the paper drifted, addressing a different question than the one it originally posed?" },
      { id: "D16-03", critical: false, gate: "SECTION COUPLING: Does the last paragraph of each major section explicitly connect to the first paragraph of the next section — or are there jarring transitions where sections feel like independent essays stitched together?" },
      { id: "D16-04", critical: false, gate: "OVERCLAIMING LANGUAGE DETECTION: Is the paper free of overclaiming language patterns — 'This proves that...', 'This is the first study to...' (unverified), 'All evidence suggests...', 'This definitively shows...', strong causal language without experimental evidence, universal claims from limited samples?" },
      { id: "D16-05", critical: false, gate: "CITATION RECENCY: Do at least 40% of the paper's citations come from the last 5 years — indicating engagement with the current state of the field rather than reliance on dated literature?" },
      { id: "D16-06", critical: false, gate: "CITATION DIVERSITY: Is the citation base diverse — no single paper accounts for more than 5% of all in-text citations, and the top 5 most-cited papers account for less than 25% of total citations?" },
      { id: "D16-07", critical: false, gate: "PHANTOM CITATION CHECK: Is every (Author, Year) citation in the text matched by a corresponding entry in the reference list — and is every reference list entry cited at least once in the text (no orphan references, no ghost citations)?" },
      { id: "D16-08", critical: false, gate: "ABSTRACT STRUCTURE: Does the abstract follow a structured format — Background (1-2 sentences), Gap (1 sentence), Method (1-2 sentences), Key Findings (2-3 sentences), Implications (1-2 sentences) — and stay within 250-350 words?" },
      { id: "D16-09", critical: false, gate: "STYLE DISCIPLINE: Is the paper free of common style violations — no paragraphs opening with 'Furthermore/Additionally/Moreover', no single-sentence paragraphs, no paragraphs exceeding 12 sentences, consistent tense usage (past for methods/results, present for theory/discussion)?" },
      { id: "D16-10", critical: false, gate: "ACTIVE VOICE DOMINANCE: Does the paper primarily use active voice — with no passages containing more than 3 consecutive sentences in passive voice?" },
      { id: "D16-11", critical: true , gate: "LLM ARTIFACT DETECTION: Is the paper free of AI-generation artifacts — no '[INSERT]', '[TODO]', '[PLACEHOLDER]', no 'As an AI...', no emoji in body text, no HTML tags, no rubric scaffolding markers, no gate codes or checklist references embedded in the manuscript?" },
      { id: "D16-12", critical: false, gate: "WORD COUNT PROPORTIONALITY: Are all sections proportionate — no single section consuming more than 35% of total word count, and no required section below 400 words?" },
      { id: "D16-13", critical: false, gate: "OPENING QUALITY: Does the introduction open with a concrete hook — a specific fact, statistic, or recent event — rather than a vague platitude like 'In recent years...' or 'The rapid growth of...' or 'It is well known that...'?" },
      { id: "D16-14", critical: false, gate: "ROADMAP PRESENCE: Does the introduction end with a brief roadmap paragraph previewing the paper's structure — 'The remainder of this paper is organized as follows...' or equivalent?" },
    ],
  },
  {
    id: "D17", name: "Evidence-Claim Alignment", maxPoints: 12,
    note: "These gates verify that claims made in the paper are proportionate to the evidence presented — the single most common reason papers are rejected after full review.",
    gates: [
      { id: "D17-01", critical: true , gate: "THESIS-EVIDENCE PROPORTIONALITY: Is the strength of the paper's central thesis proportionate to the evidence presented — if the evidence is preliminary or from few studies, does the thesis use appropriately hedged language ('suggests' not 'demonstrates')?" },
      { id: "D17-02", critical: true , gate: "EVIDENCE-CLAIM TRACEABILITY: Can every major claim in the results and discussion sections be traced back to specific data, analysis, or cited evidence presented in the paper — or are there claims that appear without any supporting evidence?" },
      { id: "D17-03", critical: false, gate: "GRADE-LANGUAGE CALIBRATION: Does the paper's confidence language match the quality of evidence — 'demonstrates' only for high-quality replicated evidence, 'suggests' for moderate evidence, 'preliminary evidence indicates' for limited evidence, 'tentatively suggests' for very limited evidence?" },
      { id: "D17-04", critical: false, gate: "CAUSAL MODEL COMPLETENESS: If the paper proposes a causal mechanism, does it address forward causation evidence, reverse causation possibility, key confounders, and the basis for directional claims — not just assert a causal pathway without supporting analysis?" },
      { id: "D17-05", critical: false, gate: "SINGLE-STUDY RELIANCE: Does the paper avoid presenting single-study findings as established facts — clearly labeling evidence from one study as 'preliminary', 'one study reported', or 'initial evidence from [Author]'?" },
      { id: "D17-06", critical: false, gate: "EVIDENCE CONCENTRATION: For each major theme or finding, is the evidence drawn from multiple independent studies — or does the argument rest on 1-2 studies while being presented as broadly supported?" },
      { id: "D17-07", critical: false, gate: "CONTRADICTION ACKNOWLEDGMENT: Where cited studies report conflicting findings on the same phenomenon, does the paper acknowledge the contradiction explicitly and offer an explanation (methodological differences, population differences, moderating conditions) rather than cherry-picking one side?" },
      { id: "D17-08", critical: false, gate: "RESEARCH MATURITY TRANSPARENCY: Does the paper distinguish between established findings (replicated across 5+ studies), emerging findings (2-4 studies), and preliminary findings (single study) — rather than treating all evidence as equally established?" },
      { id: "D17-09", critical: false, gate: "GEOGRAPHIC REPRESENTATIVENESS: If the paper makes general claims, does the evidence base include studies from multiple geographic regions or cultural contexts — or are universal claims derived from a single country or culture without acknowledging this limitation?" },
      { id: "D17-10", critical: false, gate: "QUANTITATIVE CONSISTENCY: Are reported quantitative figures (effect sizes, sample sizes, percentages, confidence intervals) internally consistent across tables, text, and abstract — no contradictions between what the text states and what the tables show?" },
      { id: "D17-11", critical: false, gate: "OVERCLAIMING PER SECTION: Is each section individually free of claims that exceed the evidence strength available for that specific argument — checked section by section, not just at the overall paper level?" },
      { id: "D17-12", critical: false, gate: "EFFECT DIRECTION ACCURACY: When the paper reports the direction of effects (positive, negative, null), are these consistent with what the cited studies actually found — no misrepresentation of cited papers' conclusions to fit the narrative?" },
    ],
  },
  {
    id: "D18", name: "Reference Quality & Integrity", maxPoints: 12,
    note: "These gates assess the quality and integrity of the paper's reference base — not just whether citations exist, but whether they are from credible, high-quality sources. A paper built on low-quality references is a house built on sand.",
    gates: [
      { id: "D18-01", critical: true , gate: "REFERENCE EXISTENCE: Do ALL cited references appear to be real, published works — correct author names, plausible publication years, identifiable journals — with no evidence of hallucinated, fabricated, or AI-generated references that do not exist in any academic database?" },
      { id: "D18-02", critical: true , gate: "PREDATORY JOURNAL EXCLUSION: Are ALL cited references from legitimate, peer-reviewed sources — with no citations from known predatory publishers (Beall's list: SciencePG, SCIRP, OMICS, CCSE, Medwin, etc.), vanity presses, or publishers with no real peer review process?" },
      { id: "D18-03", critical: false, gate: "JOURNAL TIER DISTRIBUTION: Does the paper cite a substantial proportion (at least 30%) of references from top-tier journals (FT50, UTD24, ABS 4*/4, or field-equivalent A/A* journals) — indicating engagement with the highest quality scholarship in the field?" },
      { id: "D18-04", critical: false, gate: "RETRACTION AWARENESS: Does the paper avoid citing papers that have been retracted, withdrawn, or subject to expressions of concern — or if citing controversial works, does it explicitly acknowledge the retraction or concern?" },
      { id: "D18-05", critical: false, gate: "CITATION IMPACT: Are the foundational claims in the paper supported by well-cited, influential works — not exclusively by zero-citation or very low-citation papers that may not have been vetted by the field?" },
      { id: "D18-06", critical: false, gate: "PREPRINT TRANSPARENCY: If preprints (arXiv, SSRN, bioRxiv, working papers) are cited, are they clearly identified as non-peer-reviewed — and do the paper's critical claims NOT rest solely on preprint evidence?" },
      { id: "D18-07", critical: false, gate: "CANONICAL CITATION: Does the paper cite the foundational/canonical works in its theoretical tradition — original theoretical sources for the frameworks it invokes, not textbooks or review papers as substitutes for the original?" },
      { id: "D18-08", critical: false, gate: "CITATION TOPICAL RELEVANCE: Is every cited reference topically relevant to the paper — no references from completely unrelated fields cited as if they support the argument (e.g., a clinical medicine paper cited in a management context without explicit justification)?" },
      { id: "D18-09", critical: false, gate: "SECONDARY CITATION AVOIDANCE: Are key empirical claims and statistics cited to their original primary source — not to a secondary source that itself cites the original (no 'as cited in' chains for critical evidence)?" },
      { id: "D18-10", critical: false, gate: "REFERENCE FORMAT CONSISTENCY: Are all references formatted consistently in a single citation style — no mixing of APA, Chicago, Harvard, and numbered styles, no incomplete entries, no inconsistent author name formats?" },
      { id: "D18-11", critical: false, gate: "SELF-CITATION PROPORTION: Is self-citation within reasonable bounds — no more than 10-15% of total references from the same author(s) — and are self-citations substantively justified rather than artificially inflating citation counts?" },
      { id: "D18-12", critical: false, gate: "REFERENCE LIST COMPLETENESS: Does the reference list contain all necessary bibliographic details for every entry — author(s), year, title, journal/publisher, volume, issue, pages or DOI — with no truncated or incomplete entries?" },
    ],
  },
  {
    id: "D19", name: "Writing & Style Standards", maxPoints: 12,
    note: "These gates assess whether the paper meets the prose quality, formatting, and stylistic standards expected by top-tier journals. Poor writing is the #1 reason for desk rejection at JIBS.",
    gates: [
      { id: "D19-01", critical: false, gate: "ARGUMENT-DRIVEN PROSE: Is the literature review organized by argument and theme — not a paper-by-paper summary ('Smith (2021) found X. Jones (2022) found Y.') but concept-driven prose where authors appear in citations, not as sentence subjects?" },
      { id: "D19-02", critical: false, gate: "SHOPPING-LIST AVOIDANCE: Does the paper avoid 4+ consecutive sentences starting with 'Author (Year) found/showed/demonstrated...' — grouping findings by theme rather than listing them by author?" },
      { id: "D19-03", critical: false, gate: "TENSE CONSISTENCY: Is verb tense used consistently and correctly throughout — past tense for methods and reported findings, present tense for established theory and current discussion?" },
      { id: "D19-04", critical: false, gate: "TOPIC SENTENCE QUALITY: Does every paragraph start with a substantive topic sentence that makes a claim or argument point — not a transition word or meta-commentary like 'This section discusses...' or 'The purpose of this section is...'?" },
      { id: "D19-05", critical: false, gate: "CONTINUOUS PROSE: Is the body of the paper written in continuous prose — no bullet points, numbered lists, or dashed lists in body sections (tables and methods appendices excepted)?" },
      { id: "D19-06", critical: false, gate: "FORMATTING DISCIPLINE: Is the paper free of excessive em-dashes, en-dashes used as sentence connectors, and other informal punctuation — using commas, semicolons, colons, or parentheses for subordination instead?" },
      { id: "D19-07", critical: false, gate: "HEDGING CALIBRATION: Does the paper calibrate hedging language appropriately — not over-hedging strong evidence ('might possibly suggest') nor under-hedging weak evidence ('clearly demonstrates' from one observational study)?" },
      { id: "D19-08", critical: false, gate: "JARGON MANAGEMENT: Is every technical term, acronym, and field-specific concept defined on first use — and used consistently thereafter without unexplained switching between synonyms for the same concept?" },
      { id: "D19-09", critical: false, gate: "SENTENCE VARIETY: Does the paper demonstrate variety in sentence structure and length — no more than 3 consecutive sentences with the same syntactic pattern (e.g., Subject-Verb-Object repeated mechanically)?" },
      { id: "D19-10", critical: false, gate: "CONCLUSION DISCIPLINE: Does the conclusion avoid introducing new information, new citations, or new arguments — serving only to synthesize, summarize, and provide takeaways from what has already been presented?" },
      { id: "D19-11", critical: false, gate: "TABLE PLACEMENT: Is every table referenced in the text before it appears, placed in the appropriate section, does it appear exactly once, and are no tables placed in the discussion or conclusion sections?" },
      { id: "D19-12", critical: false, gate: "DISCUSSION STRUCTURE: Does the discussion follow a clear structure — opening with key findings summary, then theoretical implications ('extends X by Y'), practical implications (actor-action-outcome), limitations with direction of bias, and future research with specific study designs?" },
    ],
  },
  {
    id: "D20", name: "Cross-Section Integrity", maxPoints: 12,
    note: "These gates check consistency and coherence ACROSS sections — catching contradictions, drift, and misalignment that single-section reviews miss. These are the errors that only surface when the entire paper is read end-to-end.",
    gates: [
      { id: "D20-01", critical: true , gate: "CONSTRUCT NAMING CONSISTENCY: Does each key construct, variable, or framework maintain the EXACT same name across all sections — introduction, theory, hypotheses, methods, results, and discussion — with no unexplained name changes or synonym substitution mid-paper?" },
      { id: "D20-02", critical: true , gate: "HYPOTHESIS-RESULTS ALIGNMENT: Is every hypothesis or proposition stated in the theory section tested or addressed in the results section — and do the results address ONLY hypotheses that were formally stated, with no post-hoc additions or silent omissions?" },
      { id: "D20-03", critical: false, gate: "FRAMEWORK NAMING CONSISTENCY: If the paper introduces a named framework or model, is the name and any acronym used identically in every section — no variations, expansions, or abbreviation inconsistencies anywhere in the manuscript?" },
      { id: "D20-04", critical: false, gate: "MECHANISM-PROPOSITION COUNT ALIGNMENT: If the abstract or introduction states N mechanisms, propositions, or hypotheses, does the body of the paper present exactly N — no silent additions, omissions, or renumbering?" },
      { id: "D20-05", critical: false, gate: "ABSTRACT-BODY CONSISTENCY: Does the abstract accurately represent the paper's actual content — same number of mechanisms/propositions, same key findings, same methodological claims — with no exaggeration, simplification, or omission?" },
      { id: "D20-06", critical: false, gate: "INTRODUCTION-CONCLUSION BOOKEND: Does the conclusion answer the specific research question posed in the introduction — and do the key findings reported in the conclusion exactly match those reported in the results section?" },
      { id: "D20-07", critical: false, gate: "CROSS-SECTION NON-REDUNDANCY: Are major arguments, tables, and comparison matrices presented ONCE in the appropriate section — not repeated, paraphrased, or duplicated across multiple sections?" },
      { id: "D20-08", critical: false, gate: "METHODOLOGY-EXECUTION MATCH: Does what is described in the methods section match what is actually done in the results — same statistical tests, same variables, same inclusion criteria, same analysis approach, with no unexplained divergence?" },
      { id: "D20-09", critical: false, gate: "LIMITATION-IMPLICATION CONSISTENCY: Are the limitations acknowledged in the discussion consistent with the strength of the implications claimed — if a major limitation is acknowledged, are the affected implications appropriately tempered rather than stated with full confidence?" },
      { id: "D20-10", critical: false, gate: "FIGURE-TEXT ALIGNMENT: Are all figures and diagrams referenced in the text, do they match what the text describes, and are the labels in figures consistent with the construct names used in the text?" },
      { id: "D20-11", critical: false, gate: "SAMPLE DESCRIPTION CONSISTENCY: Is the sample described consistently across methods, results, and limitations — same N, same inclusion criteria, same time period — with no unexplained discrepancies between sections?" },
      { id: "D20-12", critical: false, gate: "N-COUNT TRACEABILITY: If the paper reports an aggregate sample size, observation count, or study count, can the total be independently reconstructed by summing the component figures reported elsewhere in the paper — no opaque arithmetic?" },
    ],
  },
];

const ALL_GATES = DIMENSIONS.flatMap((d) =>
  d.gates.map((g) => ({ ...g, dimensionId: d.id, dimensionName: d.name })),
);
const TOTAL_GATES = ALL_GATES.length; // 288 (v3.0 — 21 dimensions)
const CRITICAL_GATES = ALL_GATES.filter((g) => g.critical);

// ─── Gate Scoring Classification (v3.0) ──────────────────────
// Binary: YES/NO (0 or 1 point). All critical gates, all D04/D08, specified structural gates.
// Qualitative: FULL/PARTIAL/ABSENT (1 / 0.5 / 0 points). Non-critical content gates where depth matters.

const FORCE_QUALITATIVE = new Set([
  // D00 — all non-critical coherence gates
  "D00-06", "D00-07", "D00-08", "D00-09", "D00-10", "D00-11", "D00-12", "D00-13", "D00-14",
  // D02 — argumentation depth
  "D02-04", "D02-05", "D02-09",
  // D05 — conceptual clarity
  "D05-03",
  // D06 — hypothesis quality
  "D06-04", "D06-10", "D06-11",
  // D09 — measurement
  "D09-07",
  // D11 — causal identification
  "D11-06", "D11-10",
  // D13 — robustness
  "D13-05",
  // D14 — discussion depth
  "D14-04", "D14-07", "D14-08",
  // D15 — adversarial stress tests (depth of argumentation matters)
  "D15-03", "D15-04", "D15-06", "D15-07", "D15-08", "D15-09", "D15-10", "D15-11", "D15-12",
  // D16 — publication readiness
  "D16-03", "D16-04", "D16-05", "D16-06", "D16-13",
  // D17 — evidence-claim alignment
  "D17-03", "D17-04", "D17-05", "D17-06", "D17-07", "D17-08", "D17-09", "D17-11",
  // D18 — all binary (forced in getGateScoring like D04/D08)
  // D19 — writing & style
  "D19-01", "D19-07", "D19-09", "D19-12",
  // D20 — cross-section integrity
  "D20-07", "D20-09",
]);

function getGateScoring(gate: { id: string; critical: boolean; dimensionId: string }): GateScoring {
  // All critical gates are binary — no partial credit on auto-rejects
  if (gate.critical) return "binary";
  // All D04 (verified citations), D08 (verified data), D18 (reference quality) are binary — you found it or you didn't
  if (gate.dimensionId === "D04" || gate.dimensionId === "D08" || gate.dimensionId === "D18") return "binary";
  // Explicitly qualitative gates
  if (FORCE_QUALITATIVE.has(gate.id)) return "qualitative";
  // Everything else is binary
  return "binary";
}

const GATE_SCORING_MAP = new Map<string, GateScoring>();
for (const g of ALL_GATES) {
  GATE_SCORING_MAP.set(g.id, getGateScoring(g));
}

const BINARY_GATES = ALL_GATES.filter((g) => GATE_SCORING_MAP.get(g.id) === "binary");
const QUALITATIVE_GATES = ALL_GATES.filter((g) => GATE_SCORING_MAP.get(g.id) === "qualitative");

// Max possible points: binary gates contribute max 1 each, qualitative gates contribute max 1 each
// So max = TOTAL_GATES (same ceiling as before)

function getVerdict(score: number, hasCriticalFail: boolean): Verdict {
  if (hasCriticalFail) return "DO_NOT_SUBMIT";
  if (score >= 90) return "SUBMIT";
  if (score >= 75) return "MINOR_REVISIONS";
  if (score >= 60) return "MAJOR_REVISIONS";
  return "DO_NOT_SUBMIT";
}

function computeScore(results: GateResult[]) {
  const totalPoints = results.reduce((sum, r) => sum + r.points, 0);
  const score = Math.round((totalPoints / TOTAL_GATES) * 100);

  const passed = results.filter((r) => r.pass).length;
  const partial = results.filter((r) => r.scoring === "qualitative" && r.rawScore === 1).length;
  const failed = results.filter((r) => !r.pass && r.rawScore === 0).length;

  const criticalFails = results.filter((r) => r.critical && !r.pass);
  const hasCriticalFail = criticalFails.length > 0;
  const verdict = getVerdict(score, hasCriticalFail);
  const accepted = verdict === "SUBMIT";

  let rejectReason: string | undefined;
  if (hasCriticalFail) {
    const failList = criticalFails.map((f) => `${f.id} (${f.dimension})`).join(", ");
    rejectReason = `${criticalFails.length} critical gate(s) failed: ${failList}`;
  } else if (!accepted) {
    rejectReason = `Score ${score}/100 — verdict: ${verdict}`;
    if (partial > 0) {
      rejectReason += ` (${partial} PARTIAL gates — each scores 0.5 instead of 1.0)`;
    }
  }

  const dimensionScores = DIMENSIONS.map((d) => {
    const dimResults = results.filter((r) => r.dimensionId === d.id);
    const dimPoints = dimResults.reduce((sum, r) => sum + r.points, 0);
    return {
      id: d.id,
      name: d.name,
      passed: dimResults.filter((r) => r.pass).length,
      partial: dimResults.filter((r) => r.scoring === "qualitative" && r.rawScore === 1).length,
      total: d.gates.length,
      points: dimPoints,
    };
  });

  return { score, passed, failed, partial, totalPoints, verdict, accepted, rejectReason, dimensionScores };
}

// ─── Router ────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "content-type",
        },
      });
    }

    if (request.method === "POST" && url.pathname === "/api/submit") {
      return handleSubmit(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/evaluate") {
      return handleEvaluate(request, env);
    }
    if (request.method === "GET" && url.pathname === "/api/submissions") {
      return handleList(env);
    }
    if (request.method === "GET" && url.pathname.endsWith("/download") && url.pathname.startsWith("/api/submissions/")) {
      const id = url.pathname.split("/").slice(-2, -1)[0];
      return handleDownload(id, env);
    }
    if (request.method === "GET" && url.pathname.startsWith("/api/submissions/")) {
      const id = url.pathname.split("/").pop()!;
      return handleDetail(id, env);
    }
    if (request.method === "GET" && url.pathname.startsWith("/submission/")) {
      const id = url.pathname.split("/").pop()!;
      return renderDetailPage(id, env);
    }
    if (request.method === "GET" && url.pathname === "/api/rules") {
      return handleRules();
    }
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "")) {
      return renderHomePage(env);
    }

    return new Response("Not Found", { status: 404 });
  },
};

// ─── API Handlers ──────────────────────────────────────────────

function handleRules(): Response {
  return json({
    name: "JIBS AAA Quality Gate",
    target: "Journal of International Business Studies",
    version: "1.0",
    totalGates: TOTAL_GATES,
    criticalGates: CRITICAL_GATES.length,
    scoring: {
      autoReject: "Any gate marked critical:true that scores NO = auto-reject regardless of total",
      binaryGates: { count: BINARY_GATES.length, scale: "YES (1 pt) or NO (0 pt)" },
      qualitativeGates: { count: QUALITATIVE_GATES.length, scale: "FULL (1 pt), PARTIAL (0.5 pt), or ABSENT (0 pt)" },
      maxPoints: TOTAL_GATES,
      note: "PARTIAL on qualitative gates counts as 0.5. A paper full of PARTIALs cannot break ~75 (major revision ceiling).",
      verdict: {
        "90-100": "SUBMIT ($20 reward)",
        "75-89": "MINOR REVISIONS",
        "60-74": "MAJOR REVISIONS",
        "0-59": "DO NOT SUBMIT",
      },
    },
    submissionEndpoint: "/api/submit",
    submissionFormat: {
      method: "POST",
      contentType: "application/json",
      body: { title: "string (paper title)", content: "string (full paper text)" },
    },
    dimensions: DIMENSIONS.map((d) => ({
      id: d.id,
      name: d.name,
      maxPoints: d.maxPoints,
      note: d.note,
      gates: d.gates.map((g) => ({ id: g.id, critical: g.critical, scoring: GATE_SCORING_MAP.get(g.id) || "binary", gate: g.gate })),
    })),
    instructions: [
      "Submit via POST /api/submit with JSON body { title, content }.",
      "Content must be a full academic paper (minimum 500 characters).",
      `Paper is evaluated against ${TOTAL_GATES} gates across ${DIMENSIONS.length} dimensions.`,
      `${CRITICAL_GATES.length} gates are CRITICAL — failing any one auto-rejects the paper.`,
      "Score >= 90 = SUBMIT. 75-89 = MINOR REVISIONS. 60-74 = MAJOR REVISIONS. <60 = DO NOT SUBMIT.",
      "Only SUBMIT verdict earns the $20 acceptance reward.",
      "Response includes per-gate scoring (binary: pass/fail, qualitative: FULL/PARTIAL/ABSENT) with reasoning.",
      "JIBS requires explicit cross-national relevance, institutional context, and IB theory grounding.",
      "Read all 21 dimensions carefully before writing. A purely domestic study will be desk-rejected.",
    ],
  });
}

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

  if (!content || content.trim().length < 500) {
    return json({ error: "Paper content too short. Minimum 500 characters for meaningful evaluation." }, 400);
  }

  const results = await evaluateGates(content, env);
  const { score, passed, failed, partial, totalPoints, verdict, accepted, rejectReason, dimensionScores } = computeScore(results);

  const id = generateId();
  const submission: Submission = {
    id,
    title,
    content: content.slice(0, 80000),
    submittedAt: new Date().toISOString(),
    results,
    passed,
    failed,
    partial,
    totalPoints,
    score,
    verdict,
    accepted,
    rejectReason,
    dimensionScores,
  };

  await env.SUBMISSIONS.put(`sub:${id}`, JSON.stringify(submission), {
    expirationTtl: 60 * 60 * 24 * 90,
  });

  const indexRaw = await env.SUBMISSIONS.get("index");
  const index: string[] = indexRaw ? JSON.parse(indexRaw) : [];
  index.unshift(id);
  await env.SUBMISSIONS.put("index", JSON.stringify(index.slice(0, 500)));

  return json(submission);
}

async function handleEvaluate(request: Request, env: Env): Promise<Response> {
  let title = "Untitled";
  let content = "";

  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = await request.json() as any;
    title = body.title || "Untitled";
    content = body.content || body.findings || body.abstract || body.text || JSON.stringify(body);
  } else {
    content = await request.text();
  }

  if (!content || content.trim().length < 500) {
    return json({ error: "Paper content too short. Minimum 500 characters." }, 400);
  }

  const results = await evaluateGates(content, env);
  const { score, passed, failed, partial, totalPoints, verdict, rejectReason, dimensionScores } = computeScore(results);

  // Save dry run to KV so it appears in the dashboard
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const submission: Submission = {
    id,
    title,
    content: content.slice(0, 50000),
    submittedAt: new Date().toISOString(),
    results,
    passed,
    failed,
    partial,
    totalPoints,
    score,
    verdict,
    accepted: verdict === "SUBMIT",
    rejectReason,
    dimensionScores,
  };

  await env.SUBMISSIONS.put(`sub:${id}`, JSON.stringify({ ...submission, dryRun: true }), {
    expirationTtl: 60 * 60 * 24 * 90,
  });
  const indexRaw = await env.SUBMISSIONS.get("index");
  const index: string[] = indexRaw ? JSON.parse(indexRaw) : [];
  index.unshift(id);

  // Auto-cleanup: keep latest 30 dry runs, delete older ones. Never touch real submissions.
  let dryRunCount = 0;
  const toKeep: string[] = [];
  const toDelete: string[] = [];
  for (const subId of index) {
    const raw = await env.SUBMISSIONS.get(`sub:${subId}`);
    if (!raw) continue;
    const sub = JSON.parse(raw);
    if (sub.dryRun) {
      dryRunCount++;
      if (dryRunCount <= 30) {
        toKeep.push(subId);
      } else {
        toDelete.push(subId);
      }
    } else {
      toKeep.push(subId); // Always keep real submissions
    }
  }
  for (const delId of toDelete) {
    await env.SUBMISSIONS.delete(`sub:${delId}`);
  }
  await env.SUBMISSIONS.put("index", JSON.stringify(toKeep.slice(0, 500)));

  return json({
    dryRun: true,
    id,
    title,
    score,
    verdict,
    accepted: verdict === "SUBMIT",
    passed,
    failed,
    partial,
    totalPoints,
    rejectReason,
    dimensionScores,
    results,
  });
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
        accepted: sub.accepted,
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

async function handleDownload(id: string, env: Env): Promise<Response> {
  const raw = await env.SUBMISSIONS.get(`sub:${id}`);
  if (!raw) return json({ error: "Submission not found" }, 404);
  const sub = JSON.parse(raw) as Submission;
  const filename = sub.title.replace(/[^a-zA-Z0-9\s-]/g, "").replace(/\s+/g, "_").slice(0, 80) + ".md";
  return new Response(sub.content, {
    headers: {
      "content-type": "text/markdown;charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}

// ─── Content Normalization ─────────────────────────────────────

function normalizeContent(content: string): string {
  return content
    .replace(/^#{1,6}\s+/gm, "")       // Strip markdown headers
    .replace(/\*\*/g, "")              // Strip bold
    .replace(/__/g, "")                // Strip underline-bold
    .replace(/^---+\s*$/gm, "")        // Strip horizontal rules
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // [text](url) -> text
    .replace(/\n{3,}/g, "\n\n")        // Collapse extra blank lines
    .trim();
}

// ─── Gate Evaluation (Gemini 2.5 Pro) ─────────────────────────

async function evaluateGates(paperContent: string, env: Env): Promise<GateResult[]> {
  const truncated = normalizeContent(paperContent).slice(0, 60000);

  const gateList = DIMENSIONS.map((d) => {
    const gates = d.gates.map((g) => {
      const scoring = GATE_SCORING_MAP.get(g.id) || "binary";
      const tag = scoring === "qualitative" ? "QUALITATIVE" : "BINARY";
      return `  ${g.id} [${tag}${g.critical ? ", CRITICAL" : ""}]: ${g.gate}`;
    }).join("\n");
    return `${d.id} — ${d.name} (${d.maxPoints} pts):\n${gates}`;
  }).join("\n\n");

  const prompt = `You are an expert academic peer reviewer for the Journal of International Business Studies (JIBS).
Evaluate this paper against ALL ${TOTAL_GATES} quality gates below. Be rigorous and fair.

SCORING SYSTEM (two scales):

BINARY gates (marked [BINARY]): Score "YES" (pass) or "NO" (fail).
  - All CRITICAL gates are binary. Failing any CRITICAL gate = auto-reject.
  - All VERIFY gates (D04, D08) are binary. The citation exists or it doesn't.

QUALITATIVE gates (marked [QUALITATIVE]): Score "FULL", "PARTIAL", or "ABSENT".
  - FULL = criterion met rigorously and without qualification (1 point)
  - PARTIAL = criterion present but shallow, inconsistent, or incomplete (0.5 points)
  - ABSENT = criterion not met (0 points)
  - These test execution depth, not presence. A paper full of PARTIALs is a major revision.

GATES:
${gateList}

Respond with ONLY a JSON array — no markdown, no explanation, no wrapping.
For BINARY gates: {"id":"D01-01","score":"YES","reasoning":"..."}
For QUALITATIVE gates: {"id":"D00-06","score":"PARTIAL","reasoning":"..."}

Every gate ID must appear exactly once. ${TOTAL_GATES} entries total.

--- PAPER START ---
${truncated}
--- PAPER END ---`;

  // Try Gemini 2.5 Pro first
  if (env.GEMINI_API_KEY) {
    try {
      const geminiResult = await callGemini(prompt, env.GEMINI_API_KEY);
      if (geminiResult) {
        return mapResults(geminiResult);
      }
    } catch {
      // Fall through to Workers AI
    }
  }

  // Fallback: Workers AI (Llama 3.1 8B) — less accurate but free
  try {
    const response = await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fp8", {
      messages: [{ role: "user", content: prompt }],
      max_tokens: 8000,
      temperature: 0.2,
    }) as any;

    const text = response.response || "";
    const arrMatch = text.match(/\[[\s\S]*\]/);
    if (arrMatch) {
      const parsed = JSON.parse(arrMatch[0]) as any[];
      return mapResults(parsed);
    }
  } catch {
    // Both failed
  }

  // Last resort: all gates fail with error
  return ALL_GATES.map((g) => ({
    id: g.id,
    dimension: g.dimensionName,
    dimensionId: g.dimensionId,
    critical: g.critical,
    gate: g.gate,
    pass: false,
    scoring: (GATE_SCORING_MAP.get(g.id) || "binary") as GateScoring,
    rawScore: 0,
    points: 0,
    reasoning: "Evaluation system unavailable — please retry",
  }));
}

async function callGemini(prompt: string, apiKey: string): Promise<any[] | null> {
  // Pro primary (paid key), fall back to Flash if quota exceeded (429)
  const models = ["gemini-2.5-pro", "gemini-2.5-flash"];
  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 16000,
            responseMimeType: "application/json",
          },
        }),
      });

      if (!resp.ok) {
        // 429 = quota exceeded, try next model
        if (resp.status === 429) continue;
        return null;
      }

      const data = await resp.json() as any;
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

      const arrMatch = text.match(/\[[\s\S]*\]/);
      if (arrMatch) {
        return JSON.parse(arrMatch[0]);
      }

      try {
        const parsed = JSON.parse(text);
        return Array.isArray(parsed) ? parsed : null;
      } catch {
        continue; // Bad JSON, try next model
      }
    } catch {
      continue; // Network error, try next model
    }
  }
  return null;
}

function mapResults(parsed: any[]): GateResult[] {
  return ALL_GATES.map((gate) => {
    const match = parsed.find((p: any) => p.id === gate.id);
    const scoring = GATE_SCORING_MAP.get(gate.id) || "binary";

    let rawScore: number;
    let points: number;
    let pass: boolean;

    if (!match) {
      rawScore = 0;
      points = 0;
      pass = false;
    } else if (scoring === "qualitative") {
      // Parse FULL/PARTIAL/ABSENT (also accept legacy true/false)
      const s = String(match.score || "").toUpperCase();
      if (s === "FULL" || s === "YES" || match.pass === true) {
        rawScore = 2; points = 1; pass = true;
      } else if (s === "PARTIAL") {
        rawScore = 1; points = 0.5; pass = false; // PARTIAL = not fully passed
      } else {
        rawScore = 0; points = 0; pass = false;
      }
    } else {
      // Binary: YES/NO or legacy pass:true/false
      const s = String(match.score || "").toUpperCase();
      const passed = s === "YES" || match.pass === true;
      rawScore = passed ? 1 : 0;
      points = passed ? 1 : 0;
      pass = passed;
    }

    return {
      id: gate.id,
      dimension: gate.dimensionName,
      dimensionId: gate.dimensionId,
      critical: gate.critical,
      gate: gate.gate,
      pass,
      scoring,
      rawScore,
      points,
      reasoning: match?.reasoning || "No evaluation returned for this gate",
    };
  });
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
    accepted: submissions.filter((s) => s.accepted).length,
    rejected: submissions.filter((s) => !s.accepted).length,
    avgScore: submissions.length > 0
      ? Math.round(submissions.reduce((a, s) => a + s.score, 0) / submissions.length)
      : 0,
  };

  const verdictClass = (v: Verdict) => {
    if (v === "SUBMIT") return "badge-submit";
    if (v === "MINOR_REVISIONS") return "badge-minor";
    if (v === "MAJOR_REVISIONS") return "badge-major";
    return "badge-reject";
  };

  const submissionRows = submissions
    .map((s: any) => {
      const isDry = s.dryRun ? ' <span style="color:#f0c040;font-size:0.75rem;font-weight:600">DRY RUN</span>' : '';
      return `
      <tr onclick="window.location='/submission/${s.id}'" style="cursor:pointer">
        <td><code>${s.id}</code></td>
        <td>${esc(s.title)}${isDry}</td>
        <td>${new Date(s.submittedAt).toLocaleDateString()}</td>
        <td><span class="badge ${verdictClass(s.verdict)}">${s.verdict.replace(/_/g, " ")}</span></td>
        <td>${s.score}/100</td>
        <td>${s.passed}/${s.passed + s.failed}</td>
        <td><a href="/api/submissions/${s.id}/download" onclick="event.stopPropagation()" style="color:#60a5fa;text-decoration:none;font-size:0.85rem">&#x2B07;</a></td>
      </tr>`;
    })
    .join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Epistemon — Dashboard</title>
  <style>
  ${CSS}
  .tabs { display: flex; gap: 0; margin-bottom: 0; border-bottom: 2px solid #333; }
  .tab { padding: 0.75rem 1.5rem; cursor: pointer; color: #888; font-weight: 600; font-size: 0.95rem; border: none; background: none; border-bottom: 2px solid transparent; margin-bottom: -2px; transition: all 0.2s; }
  .tab:hover { color: #ccc; }
  .tab.active { color: #fff; border-bottom-color: #4a9eff; }
  .tab-content { display: none; }
  .tab-content.active { display: block; }
  .kb-frame { width: 100%; height: calc(100vh - 120px); border: none; border-radius: 8px; background: #111; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>Epistemon</h1>
      <p class="subtitle">Autonomous Research Agent Dashboard</p>
    </header>

    <div class="tabs">
      <button class="tab active" onclick="switchTab('submissions')">Submissions</button>
      <button class="tab" onclick="switchTab('knowledge')">Knowledge Base</button>
    </div>

    <div id="tab-submissions" class="tab-content active">
      <div class="stats-row" style="margin-top:1.5rem">
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
          <div class="stat-value">${stats.avgScore}</div>
          <div class="stat-label">Avg Score</div>
        </div>
      </div>

      <section class="submit-section">
        <h2>Submit Paper</h2>
        <form id="submitForm">
          <input type="text" name="title" placeholder="Paper title" required>
          <textarea name="content" placeholder="Paste full paper content (abstract, theory, hypotheses, data, methods, results, discussion, references...)" rows="16" required minlength="500"></textarea>
          <button type="submit" id="submitBtn">Submit for Review (${TOTAL_GATES} gates)</button>
        </form>
        <div id="submitResult" class="result-box" style="display:none"></div>
      </section>

      <section>
        <h2>Submissions</h2>
        ${submissions.length === 0
          ? '<p class="empty">No submissions yet.</p>'
          : `<table>
              <thead><tr><th>ID</th><th>Title</th><th>Date</th><th>Verdict</th><th>Score</th><th>Gates</th><th></th></tr></thead>
              <tbody>${submissionRows}</tbody>
            </table>`
        }
      </section>

      <footer>
        <p>${TOTAL_GATES} gates &middot; ${DIMENSIONS.length} dimensions &middot; ${CRITICAL_GATES.length} critical auto-rejects &middot; Powered by Gemini 2.5 Pro</p>
      </footer>
    </div>

    <div id="tab-knowledge" class="tab-content">
      <iframe class="kb-frame" src="https://epistemon-knowledge-node.syedmosayebalam.workers.dev/" loading="lazy"></iframe>
    </div>
  </div>

  <script>
    const form = document.getElementById('submitForm');
    const btn = document.getElementById('submitBtn');
    const resultBox = document.getElementById('submitResult');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      btn.disabled = true;
      btn.textContent = 'Evaluating (${TOTAL_GATES} gates via Gemini 2.5 Pro)...';
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
          let html = '<div class="verdict-' + data.verdict.toLowerCase().replace(/_/g,'-') + '">' +
            data.verdict.replace(/_/g,' ') + ' &mdash; ' + data.score + '/100 (' + data.passed + '/' + (data.passed + data.failed) + ' gates)' +
            (data.rejectReason ? '<br><small>' + data.rejectReason + '</small>' : '') +
            '</div>';

          // Dimension breakdown
          if (data.dimensionScores) {
            html += '<div class="dim-grid">';
            for (const ds of data.dimensionScores) {
              const pct = Math.round((ds.passed / ds.total) * 100);
              const cls = pct === 100 ? 'dim-perfect' : pct >= 75 ? 'dim-good' : pct >= 50 ? 'dim-warn' : 'dim-bad';
              html += '<div class="dim-card ' + cls + '"><strong>' + ds.id + '</strong><br>' +
                ds.name + '<br><span>' + ds.passed + '/' + ds.total + '</span></div>';
            }
            html += '</div>';
          }

          // Per-gate details (binary: YES/NO, qualitative: FULL/PARTIAL/ABSENT)
          const gates = data.results.map(r => {
            const scoring = r.scoring || 'binary';
            let cls = r.pass ? 'gate-pass' : 'gate-fail';
            let badge = r.pass ? 'YES' : 'NO';
            if (scoring === 'qualitative') {
              const raw = r.rawScore != null ? r.rawScore : (r.pass ? 2 : 0);
              if (raw === 2) { badge = 'FULL'; cls = 'gate-pass'; }
              else if (raw === 1) { badge = 'PARTIAL'; cls = 'gate-partial'; }
              else { badge = 'ABSENT'; cls = 'gate-fail'; }
            }
            return '<div class="gate-row ' + cls + '">' +
              '<span class="gate-badge">' + badge + '</span> ' +
              '<strong>' + r.id + ' ' + r.dimension + (r.critical ? ' *CRITICAL*' : '') + '</strong>: ' +
              r.reasoning + '</div>';
          }).join('');
          html += '<details><summary>All ' + data.results.length + ' gate results</summary>' + gates + '</details>';
          html += '<p><a href="/submission/' + data.id + '">Permalink</a></p>';
          resultBox.innerHTML = html;
        }
        resultBox.style.display = 'block';
      } catch (err) {
        resultBox.innerHTML = '<div class="verdict-fail">Network error</div>';
        resultBox.style.display = 'block';
      }
      btn.disabled = false;
      btn.textContent = 'Submit for Review (${TOTAL_GATES} gates)';
    });

    function switchTab(tab) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      document.getElementById('tab-' + tab).classList.add('active');
      document.querySelector('[onclick="switchTab(\\'' + tab + '\\')"]').classList.add('active');
    }
    // Fix tab button selection
    document.querySelectorAll('.tab').forEach(btn => {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        this.classList.add('active');
        const tabName = this.textContent.trim().toLowerCase().replace(/\\s+/g, '');
        const tabId = tabName === 'submissions' ? 'tab-submissions' : 'tab-knowledge';
        document.getElementById(tabId).classList.add('active');
      });
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

  // Group results by dimension
  const dimSections = DIMENSIONS.map((d) => {
    const dimResults = sub.results.filter((r) => r.dimensionId === d.id);
    const dimPassed = dimResults.filter((r) => r.pass).length;
    const rows = dimResults
      .map((r) => {
        const scoring = r.scoring || "binary"; // legacy compat
        let rowCls = r.pass ? "row-pass" : "row-fail";
        let badge = r.pass ? "YES" : "NO";
        let badgeCls = r.pass ? "badge-submit" : "badge-reject";
        if (scoring === "qualitative") {
          const raw = r.rawScore ?? (r.pass ? 2 : 0); // legacy compat
          if (raw === 2) { badge = "FULL"; badgeCls = "badge-submit"; rowCls = "row-pass"; }
          else if (raw === 1) { badge = "PARTIAL"; badgeCls = "badge-partial"; rowCls = "row-partial"; }
          else { badge = "ABSENT"; badgeCls = "badge-reject"; rowCls = "row-fail"; }
        }
        const pts = r.points ?? (r.pass ? 1 : 0); // legacy compat
        return `
        <tr class="${rowCls}">
          <td><code>${r.id}</code></td>
          <td>${r.critical ? '<span class="badge badge-crit">CRITICAL</span> ' : ""}${esc(r.gate).slice(0, 120)}</td>
          <td><span class="badge ${badgeCls}">${badge}</span>${scoring === "qualitative" ? ` <small>(${pts}pt)</small>` : ""}</td>
          <td>${esc(r.reasoning)}</td>
        </tr>`;
      })
      .join("");

    return `
      <div class="dim-section">
        <h3>${d.id} — ${d.name} <span class="dim-score">${dimPassed}/${d.gates.length}</span></h3>
        <table>
          <thead><tr><th>Gate</th><th>Criterion</th><th>Result</th><th>Reasoning</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }).join("");

  const verdictClass = sub.accepted ? "verdict-accept" : "verdict-reject";

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
      <p class="subtitle">Submission ${sub.id} &middot; ${new Date(sub.submittedAt).toLocaleString()}
        &middot; <a href="/api/submissions/${sub.id}/download" style="color:#60a5fa;text-decoration:none;font-weight:600">&#x2B07; Download .md</a>
      </p>
    </header>

    <div class="verdict-banner ${verdictClass}">
      <div class="verdict-text">${sub.verdict.replace(/_/g, " ")}</div>
      <div class="verdict-score">${sub.score}/100 &middot; ${sub.passed} passed, ${sub.failed} failed</div>
      ${sub.rejectReason ? `<div class="verdict-reason">${esc(sub.rejectReason)}</div>` : ""}
    </div>

    <section>
      <h2>Dimension Scores</h2>
      <div class="dim-grid">
        ${(sub.dimensionScores || []).map((ds) => {
          const pct = Math.round((ds.passed / ds.total) * 100);
          const cls = pct === 100 ? "dim-perfect" : pct >= 75 ? "dim-good" : pct >= 50 ? "dim-warn" : "dim-bad";
          return `<div class="dim-card ${cls}"><strong>${ds.id}</strong><br>${ds.name}<br><span>${ds.passed}/${ds.total}</span></div>`;
        }).join("")}
      </div>
    </section>

    <section>
      <h2>Gate Results by Dimension</h2>
      ${dimSections}
    </section>

    <section>
      <h2>Paper Content</h2>
      <pre class="paper-content">${esc(sub.content)}</pre>
    </section>

    <footer>
      <p>JIBS AAA Quality Gate v1.0 &middot; ${TOTAL_GATES} gates &middot; <a href="/api/submissions/${sub.id}">Raw JSON</a></p>
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
  .container { max-width: 1000px; margin: 0 auto; padding: 2rem 1.5rem; }

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
  h3 { font-size: 1rem; color: #aaa; margin-bottom: 0.5rem; font-weight: 600; }
  section { margin-bottom: 2.5rem; }

  .submit-section input, .submit-section textarea {
    width: 100%; background: #141414; border: 1px solid #333; border-radius: 6px;
    padding: 0.75rem 1rem; color: #e0e0e0; font-size: 0.95rem; margin-bottom: 0.75rem;
    font-family: inherit;
  }
  .submit-section input:focus, .submit-section textarea:focus { outline: none; border-color: #555; }
  .submit-section textarea { resize: vertical; min-height: 200px; }
  button {
    background: #2563eb; color: #fff; border: none; border-radius: 6px;
    padding: 0.75rem 2rem; font-size: 0.95rem; cursor: pointer; font-weight: 600;
  }
  button:hover { background: #1d4ed8; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }

  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; padding: 0.5rem 0.6rem; border-bottom: 1px solid #333; color: #888; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; }
  td { padding: 0.5rem 0.6rem; border-bottom: 1px solid #1a1a1a; font-size: 0.85rem; }
  tr:hover { background: #141414; }

  .badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.03em; }
  .badge-submit { background: #052e16; color: #22c55e; }
  .badge-minor { background: #1a1a00; color: #eab308; }
  .badge-major { background: #1a0f00; color: #f97316; }
  .badge-reject { background: #2a0a0a; color: #ef4444; }
  .badge-partial { background: #1a1a00; color: #eab308; }
  .badge-crit { background: #1a0a00; color: #f97316; font-size: 0.6rem; }

  .dim-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 0.6rem; margin-bottom: 1.5rem; }
  .dim-card { background: #141414; border: 1px solid #222; border-radius: 6px; padding: 0.7rem; font-size: 0.75rem; text-align: center; }
  .dim-card span { font-size: 1.1rem; font-weight: 700; }
  .dim-perfect { border-color: #166534; }
  .dim-perfect span { color: #22c55e; }
  .dim-good { border-color: #365314; }
  .dim-good span { color: #84cc16; }
  .dim-warn { border-color: #713f12; }
  .dim-warn span { color: #eab308; }
  .dim-bad { border-color: #7f1d1d; }
  .dim-bad span { color: #ef4444; }

  .dim-section { margin-bottom: 1.5rem; }
  .dim-score { float: right; font-weight: 400; color: #888; }

  .row-pass td { }
  .row-partial td { color: #fbbf24; }
  .row-fail td { color: #f87171; }

  .result-box { margin-top: 1rem; background: #141414; border: 1px solid #222; border-radius: 8px; padding: 1.2rem; }
  .verdict-submit { background: #052e16; color: #22c55e; padding: 1rem; border-radius: 6px; font-weight: 700; margin-bottom: 0.75rem; font-size: 1.1rem; border: 1px solid #166534; }
  .verdict-minor-revisions { background: #1a1a00; color: #eab308; padding: 1rem; border-radius: 6px; font-weight: 700; margin-bottom: 0.75rem; font-size: 1.1rem; border: 1px solid #713f12; }
  .verdict-major-revisions { background: #1a0f00; color: #f97316; padding: 1rem; border-radius: 6px; font-weight: 700; margin-bottom: 0.75rem; font-size: 1.1rem; border: 1px solid #92400e; }
  .verdict-do-not-submit { background: #2a0a0a; color: #ef4444; padding: 1rem; border-radius: 6px; font-weight: 700; margin-bottom: 0.75rem; font-size: 1.1rem; border: 1px solid #7f1d1d; }
  .verdict-fail { background: #2a0a0a; color: #ef4444; padding: 0.75rem; border-radius: 6px; }

  .verdict-banner { padding: 1.5rem; border-radius: 8px; margin-bottom: 2rem; text-align: center; }
  .verdict-banner.verdict-accept { background: #052e16; border: 1px solid #166534; }
  .verdict-banner.verdict-reject { background: #2a0a0a; border: 1px solid #7f1d1d; }
  .verdict-text { font-size: 2rem; font-weight: 800; }
  .verdict-score { font-size: 1rem; margin-top: 0.25rem; opacity: 0.8; }
  .verdict-reason { font-size: 0.85rem; margin-top: 0.5rem; opacity: 0.7; }

  .gate-row { padding: 0.4rem 0; border-bottom: 1px solid #1a1a1a; font-size: 0.85rem; }
  .gate-pass { color: #86efac; }
  .gate-partial { color: #fbbf24; }
  .gate-fail { color: #fca5a5; }
  .gate-badge { display: inline-block; width: 30px; font-size: 0.65rem; font-weight: 700; text-align: center; }

  details { margin-top: 1rem; }
  summary { cursor: pointer; color: #888; font-size: 0.9rem; }
  summary:hover { color: #fff; }

  .paper-content { background: #141414; border: 1px solid #222; border-radius: 6px; padding: 1rem; font-size: 0.8rem; white-space: pre-wrap; word-wrap: break-word; max-height: 400px; overflow-y: auto; color: #aaa; }

  .empty { color: #555; font-style: italic; }
  footer { border-top: 1px solid #1a1a1a; padding-top: 1rem; margin-top: 2rem; }
  footer p { color: #555; font-size: 0.8rem; }
  footer a { color: #888; }

  @media (max-width: 640px) {
    .stats-row { grid-template-columns: repeat(2, 1fr); }
    .dim-grid { grid-template-columns: repeat(2, 1fr); }
    .container { padding: 1rem; }
  }
`;

# Guidance: Verified Data (D08)
## Gates: D08-01 through D08-08 | Critical: D08-01, D08-02, D08-03

### What JIBS Demands
- D08-01 (CRITICAL): Summary statistics internally consistent with reported sample.
- D08-02 (CRITICAL): Variable definitions traceable to original codebook/database.
- D08-03 (CRITICAL): No impossible values (negative firm age, leverage > 10, Tobin's Q < 0).
- D08-04: Hand-collected data has documented collection protocol.
- D08-05: Correlation matrix sign-consistent with theory.
- D08-06: Institutional/country data vintage matched to firm-level data year.
- D08-07: Sample attrition and panel composition consistent with reports.
- D08-08: Winsorization/trimming as reported.

### How to Pass

**For Review/Conceptual Papers:**
D08-03 is the most relevant — the LLM artifact detection gate. The agent must ensure:
- No fabricated statistics.
- No impossible numbers.
- When citing others' data, numbers must match the source.
- No hallucinated effect sizes or sample sizes.

**LLM Artifact Detection (AUTO-REJECT if found):**
Never include in your paper:
- "Here is the section," "[INSERT]," "[TODO]," "[PLACEHOLDER]"
- Emoji or HTML tags
- Self-references as AI ("as an AI," "as requested," "per your instructions")
- Em-dashes (—) or en-dashes (–) — use commas, semicolons, colons, or parentheses
- Bullet point lists in body sections — use flowing prose paragraphs
- "Furthermore," "Additionally," "Moreover" as paragraph openers

# Location: src/epistemic/ara-tools-api.py
# Purpose: Programmatic quality checks ported from ARA, reconciled with 115 JIBS gates
# Functions: quality_check, validate_citations, classify_journal, check_retraction, mmr_search
# Calls: CrossRef API, KB API (127.0.0.1:8177)
# Imports: fastapi, httpx, re, json

"""
ARA Tools API — Programmatic pre-gate checks for Epistemon agent.
No LLM calls. All checks are regex, counting, or external API lookups.

JIBS Gate Mapping:
  quality_check    -> D03-04/05, D04-04/05, D07-02/08/09, D10-10, D12-01/06, D14-09
  validate_citations -> D04-01..D04-07
  classify_journal -> D03-04
  check_retraction -> D04-01, D04-02, D08-07
  mmr_search       -> (research tool, not a gate)
"""

from __future__ import annotations

import json
import re
import time
import logging
from typing import Any
from urllib.parse import quote_plus

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("ara-tools")

app = FastAPI(title="ARA Tools API", version="1.0")

KB_BASE = "http://127.0.0.1:8177"

# ══════════════════════════════════════════════════════════════════════
# JOURNAL TIER DATA (from ARA db.py — 150+ journals)
# ══════════════════════════════════════════════════════════════════════

_TIER_DATA = [
    # AAA: FT50 / UTD24 / ABS 4*
    ("Academy of Management Journal", "AAA", ["10.5465/amj"]),
    ("Academy of Management Review", "AAA", ["10.5465/amr"]),
    ("Administrative Science Quarterly", "AAA", ["10.1177/0001839"]),
    ("Strategic Management Journal", "AAA", ["10.1002/smj"]),
    ("Organization Science", "AAA", ["10.1287/orsc"]),
    ("Management Science", "AAA", ["10.1287/mnsc"]),
    ("Journal of Management", "AAA", ["10.1177/0149206"]),
    ("Journal of Management Studies", "AAA", ["10.1111/joms"]),
    ("Journal of International Business Studies", "AAA", ["10.1057/jibs", "10.1057/s41267"]),
    ("Research Policy", "AAA", ["10.1016/j.respol"]),
    ("Journal of World Business", "AAA", ["10.1016/j.jwb"]),
    ("Global Strategy Journal", "AAA", ["10.1002/gsj"]),
    ("Journal of Finance", "AAA", ["10.1111/jofi"]),
    ("Journal of Financial Economics", "AAA", ["10.1016/j.jfineco"]),
    ("Review of Financial Studies", "AAA", ["10.1093/rfs"]),
    ("The Accounting Review", "AAA", ["10.2308/accr"]),
    ("Journal of Accounting Research", "AAA", ["10.1111/1475-679x", "10.1111/joar"]),
    ("Journal of Accounting and Economics", "AAA", ["10.1016/j.jacceco"]),
    ("American Economic Review", "AAA", ["10.1257/aer"]),
    ("Quarterly Journal of Economics", "AAA", ["10.1093/qje"]),
    ("Econometrica", "AAA", ["10.3982/ecta", "10.2307/1913"]),
    ("Journal of Political Economy", "AAA", ["10.1086/jpe", "10.1086/26"]),
    ("Review of Economic Studies", "AAA", ["10.1093/restud"]),
    ("Journal of Marketing", "AAA", ["10.1177/0022242", "10.1509/jm"]),
    ("Journal of Marketing Research", "AAA", ["10.1177/0022243", "10.1509/jmr"]),
    ("Marketing Science", "AAA", ["10.1287/mksc"]),
    ("Journal of Consumer Research", "AAA", ["10.1093/jcr"]),
    ("Journal of Operations Management", "AAA", ["10.1016/j.jom", "10.1002/joom"]),
    ("Production and Operations Management", "AAA", ["10.1111/poms"]),
    ("Manufacturing & Service Operations Management", "AAA", ["10.1287/msom"]),
    ("MIS Quarterly", "AAA", ["10.2307/25148"]),
    ("Information Systems Research", "AAA", ["10.1287/isre"]),
    ("Nature", "AAA", ["10.1038/nature", "10.1038/s41586"]),
    ("Science", "AAA", ["10.1126/science"]),
    ("Proceedings of the National Academy of Sciences", "AAA", ["10.1073/pnas"]),
    ("The Lancet", "AAA", ["10.1016/s0140-6736", "10.1016/j.lancet"]),
    ("New England Journal of Medicine", "AAA", ["10.1056/nejm"]),
    ("BMJ", "AAA", ["10.1136/bmj"]),
    ("JAMA", "AAA", ["10.1001/jama"]),
    ("Journal of Business Venturing", "AAA", ["10.1016/j.jbusvent"]),
    ("Entrepreneurship Theory and Practice", "AAA", ["10.1111/etap", "10.1177/1042258"]),
    # AA: ABS 4 / ABDC A*
    ("Journal of Organizational Behavior", "AA", ["10.1002/job"]),
    ("Organization Studies", "AA", ["10.1177/0170840"]),
    ("Human Resource Management", "AA", ["10.1002/hrm"]),
    ("Leadership Quarterly", "AA", ["10.1016/j.leaqua"]),
    ("British Journal of Management", "AA", ["10.1111/1467-8551"]),
    ("Long Range Planning", "AA", ["10.1016/j.lrp"]),
    ("International Business Review", "AA", ["10.1016/j.ibusrev"]),
    ("Journal of International Management", "AA", ["10.1016/j.intman"]),
    ("Technovation", "AA", ["10.1016/j.technovation"]),
    ("R&D Management", "AA", ["10.1111/radm"]),
    ("Technological Forecasting and Social Change", "AA", ["10.1016/j.techfore"]),
    ("Journal of Corporate Finance", "AA", ["10.1016/j.jcorpfin"]),
    ("Journal of Banking & Finance", "AA", ["10.1016/j.jbankfin"]),
    ("Journal of Monetary Economics", "AA", ["10.1016/j.jmoneco"]),
    ("Journal of Financial Intermediation", "AA", ["10.1016/j.jfi"]),
    ("Review of Finance", "AA", ["10.1093/rof"]),
    ("Journal of the Association for Information Systems", "AA", ["10.17705/1jais"]),
    ("Journal of Strategic Information Systems", "AA", ["10.1016/j.jsis"]),
    ("Information & Management", "AA", ["10.1016/j.im."]),
    ("International Journal of Information Management", "AA", ["10.1016/j.ijinfomgt"]),
    ("European Journal of Information Systems", "AA", ["10.1057/ejis", "10.1080/0960085x"]),
    ("Journal of Information Technology", "AA", ["10.1057/jit", "10.1177/0268396"]),
    ("Journal of the Academy of Marketing Science", "AA", ["10.1007/s11747"]),
    ("Journal of Retailing", "AA", ["10.1016/j.jretai"]),
    ("International Journal of Research in Marketing", "AA", ["10.1016/j.ijresmar"]),
    ("Journal of Supply Chain Management", "AA", ["10.1111/jscm"]),
    ("International Journal of Operations & Production Management", "AA", ["10.1108/ijopm"]),
    ("Journal of Economic Perspectives", "AA", ["10.1257/jep"]),
    ("Journal of Economic Literature", "AA", ["10.1257/jel"]),
    ("Review of Economics and Statistics", "AA", ["10.1162/rest"]),
    ("Journal of International Economics", "AA", ["10.1016/j.jinteco"]),
    ("Journal of Development Economics", "AA", ["10.1016/j.jdeveco"]),
    ("The Lancet Digital Health", "AA", ["10.1016/s2589-7500"]),
    ("Nature Medicine", "AA", ["10.1038/nm", "10.1038/s41591"]),
    ("PLOS Medicine", "AA", ["10.1371/journal.pmed"]),
    ("Annals of Internal Medicine", "AA", ["10.7326/m"]),
    ("Cochrane Database of Systematic Reviews", "AA", ["10.1002/14651858"]),
    ("Journal of Applied Psychology", "AA", ["10.1037/apl"]),
    ("Organizational Behavior and Human Decision Processes", "AA", ["10.1016/j.obhdp"]),
    ("Psychological Bulletin", "AA", ["10.1037/bul"]),
    ("Journal of Business Ethics", "AA", ["10.1007/s10551"]),
    ("Business Strategy and the Environment", "AA", ["10.1002/bse"]),
    ("Journal of Cleaner Production", "AA", ["10.1016/j.jclepro"]),
    ("World Development", "AA", ["10.1016/j.worlddev"]),
    ("Journal of Development Studies", "AA", ["10.1080/00220388"]),
    ("Artificial Intelligence", "AA", ["10.1016/j.artint"]),
    ("IEEE Transactions on Pattern Analysis", "AA", ["10.1109/tpami"]),
    ("Journal of Machine Learning Research", "AA", ["10.5555/154959"]),
    ("ACM Computing Surveys", "AA", ["10.1145/3"]),
]

JOURNAL_TIERS: dict[str, tuple[str, str]] = {}
for _name, _tier, _prefixes in _TIER_DATA:
    for _pfx in _prefixes:
        JOURNAL_TIERS[_pfx.lower()] = (_name, _tier)


# ══════════════════════════════════════════════════════════════════════
# BLACKLISTED DOI PREFIXES (from ARA db.py + writing.py)
# ══════════════════════════════════════════════════════════════════════

_BLACKLIST_DATA = [
    ("SciencePG", "predatory", ["10.11648"]),
    ("CCSE", "predatory", ["10.5539"]),
    ("SCIRP", "predatory", ["10.4236"]),
    ("Science and Academic Publishing", "predatory", ["10.12691"]),
    ("IJSR", "predatory", ["10.21275"]),
    ("IJAEMS", "predatory", ["10.22161"]),
    ("Academic Journals (predatory)", "predatory", ["10.13084"]),
    ("SciDoc Publishers", "predatory", ["10.19070"]),
    ("OMICS International", "predatory", ["10.4172"]),
    ("Medwin Publishers", "predatory", ["10.23880"]),
    ("Academic Star Publishing", "predatory", ["10.26689"]),
    ("AIJR Publisher", "predatory", ["10.21467"]),
    ("Herald Scholarly Open Access", "predatory", ["10.22259"]),
    ("SSRN", "preprint", ["10.2139"]),
    ("Research Square", "preprint", ["10.21203"]),
    ("Preprints.org", "preprint", ["10.20944"]),
    ("OSF Preprints", "preprint", ["10.31219"]),
    ("NBER Working Papers", "preprint", ["10.3386"]),
    ("Fake/Test DOIs", "preprint", ["10.1234"]),
    ("Unknown (zero-cite)", "vanity", [
        "10.21739", "10.26634", "10.35678", "10.54097", "10.55041",
        "10.59670", "10.63075", "10.63385", "10.70301", "10.22515",
        "10.37366", "10.47857", "10.55248", "10.62019", "10.63544",
        "10.69569", "10.25560", "10.9790",
    ]),
    ("IGI Global", "borderline", ["10.4018"]),
    ("Inderscience", "borderline", ["10.1504"]),
    ("EDP Sciences", "borderline", ["10.1051"]),
    ("Walailak Journal", "borderline", ["10.46697"]),
    ("Virtus Interpress", "borderline", ["10.22495"]),
]

# Extra predatory from ARA writing.py
_EXTRA_PREDATORY = [
    "10.63544", "10.47857", "10.55248", "10.46254", "10.51594",
    "10.36713", "10.36348", "10.52589", "10.46328", "10.55529",
    "10.33552", "10.46568", "10.35940", "10.47772", "10.32996",
    "10.47577", "10.46632", "10.52783", "10.55014", "10.36347",
    "10.36346", "10.46471", "10.47176", "10.55708", "10.37394",
    "10.51984", "10.53819", "10.55927", "10.46484", "10.36719",
]

BLACKLISTED_DOI_PREFIXES: dict[str, str] = {}
for _name, _reason, _prefixes in _BLACKLIST_DATA:
    for _pfx in _prefixes:
        BLACKLISTED_DOI_PREFIXES[_pfx.lower()] = _reason
for _pfx in _EXTRA_PREDATORY:
    if _pfx.lower() not in BLACKLISTED_DOI_PREFIXES:
        BLACKLISTED_DOI_PREFIXES[_pfx.lower()] = "predatory"


# ══════════════════════════════════════════════════════════════════════
# CITATION REGEX (from ARA writing.py)
# ══════════════════════════════════════════════════════════════════════

_AUTHOR_FRAG = r'(?:[A-Z][a-z]+(?:-[A-Za-z]+)*)'
_AUTHOR_PAIR = _AUTHOR_FRAG + r'(?:\s(?:&|and)\s' + _AUTHOR_FRAG + r')?'
_AUTHOR_FULL = _AUTHOR_PAIR + r'(?:\set\sal\.)?'

CITATION_PATTERN = re.compile(
    r'(?:'
    r'(' + _AUTHOR_FULL + r'),?\s*(\d{4})'
    r'|'
    r'(' + _AUTHOR_FULL + r')\s*\((\d{4})\)'
    r')'
)

# LLM meta-text patterns (catastrophic in a JIBS paper)
LLM_BODY_PATTERNS = [
    re.compile(r'\[(?:INSERT|TODO|PLACEHOLDER|ADD|INCLUDE|TBD)[^\]]*\]', re.IGNORECASE),
    re.compile(r'[\[\(]Word count[^\]\)]*[\]\)]', re.IGNORECASE),
    re.compile(r'(?:As (?:an? )?(?:AI|artificial intelligence|language model|LLM))[^\n.]*[.\n]', re.IGNORECASE),
    re.compile(r'[\U0001F300-\U0001F9FF\U00002702-\U000027B0]'),
    re.compile(r'</?(?:b|i|em|strong|u|br|p|div|span|a|h[1-6]|ul|ol|li|table|tr|td|th|img)[^>]*>'),
]


# ══════════════════════════════════════════════════════════════════════
# HELPER FUNCTIONS
# ══════════════════════════════════════════════════════════════════════

def classify_journal_doi(doi: str | None) -> tuple[str | None, str | None]:
    """DOI -> (journal_name, tier) using longest-prefix match."""
    if not doi:
        return None, None
    doi_lower = doi.lower().strip()
    if doi_lower.startswith("http"):
        doi_lower = doi_lower.split("doi.org/")[-1]
    best_match = (None, None)
    best_len = 0
    for prefix, (name, tier) in JOURNAL_TIERS.items():
        if doi_lower.startswith(prefix) and len(prefix) > best_len:
            best_match = (name, tier)
            best_len = len(prefix)
    return best_match


def is_blacklisted(doi: str | None) -> str | None:
    """Returns blacklist reason or None."""
    if not doi:
        return None
    doi_lower = doi.lower().strip()
    if doi_lower.startswith("http"):
        doi_lower = doi_lower.split("doi.org/")[-1]
    for prefix, reason in BLACKLISTED_DOI_PREFIXES.items():
        if doi_lower.startswith(prefix):
            return reason
    return None


def extract_citations(text: str) -> list[tuple[str, str]]:
    """Extract (author_fragment, year) tuples from text."""
    results = []
    for m in CITATION_PATTERN.finditer(text):
        if m.group(1):
            results.append((m.group(1), m.group(2)))
        elif m.group(3):
            results.append((m.group(3), m.group(4)))
    return results


def detect_llm_artifacts(text: str) -> list[str]:
    """Find LLM meta-text that would fail D08-03 (AI-generated content flag)."""
    issues = []
    for pat in LLM_BODY_PATTERNS:
        matches = pat.findall(text)
        if matches:
            for m in matches[:3]:
                issues.append(f"LLM artifact: {m[:80]}")
    return issues


# ══════════════════════════════════════════════════════════════════════
# PYDANTIC MODELS
# ══════════════════════════════════════════════════════════════════════

class QualityCheckRequest(BaseModel):
    content: str
    title: str = ""

class CitationValidateRequest(BaseModel):
    content: str
    dois: list[str] = []

class JournalClassifyRequest(BaseModel):
    doi: str

class RetractionCheckRequest(BaseModel):
    doi: str

class SearchRequest(BaseModel):
    query: str
    limit: int = 20

class MmrSearchRequest(BaseModel):
    query: str
    limit: int = 10
    lambda_param: float = 0.7


# ══════════════════════════════════════════════════════════════════════
# ENDPOINTS
# ══════════════════════════════════════════════════════════════════════

@app.get("/health")
def health():
    return {"status": "ok", "service": "ara-tools", "version": "1.0"}



def normalize_content(content: str) -> str:
    """Strip markdown formatting so quality checks focus on content."""
    content = re.sub(r"^#{1,6}\s+", "", content, flags=re.MULTILINE)
    content = content.replace("**", "").replace("__", "")
    content = re.sub(r"^---+\s*$", "", content, flags=re.MULTILINE)
    content = re.sub(r"\[([^\]]+)\]\([^\)]+\)", r"\1", content)
    content = re.sub(r"\n{3,}", "\n\n", content)
    return content.strip()

@app.post("/quality_check")
def quality_check(req: QualityCheckRequest):
    """
    Programmatic pre-gate audit. No LLM.
    Maps to JIBS gates:
      D03-04/05: Literature recency + seminal works
      D04-04/05: Citation cross-check
      D07-02: Sample size mention
      D07-08: Descriptive stats table
      D07-09: Correlation matrix
      D10-10: Software version
      D12-01/06: Coefficient tables
      D14-09: Abstract word count
      D08-03: LLM artifact detection (auto-reject)
    """
    content = normalize_content(req.content)
    title = req.title
    words = content.split()
    word_count = len(words)

    results: dict[str, Any] = {
        "title": title,
        "word_count": word_count,
        "gates": {},
    }

    # -- D14-09: Abstract <= 200 words --
    abstract_match = re.search(
        r'(?:^|\n)\s*(?:Abstract|ABSTRACT)\s*\n([\s\S]*?)(?:\n\s*(?:Keywords|KEYWORDS|Introduction|INTRODUCTION|1\.|1 ))',
        content
    )
    if abstract_match:
        abstract_words = len(abstract_match.group(1).split())
        results["gates"]["D14-09"] = {
            "gate": "Abstract <= 200 words",
            "pass": abstract_words <= 200,
            "value": abstract_words,
            "note": f"Abstract has {abstract_words} words" + (" (too long)" if abstract_words > 200 else ""),
        }
    else:
        results["gates"]["D14-09"] = {
            "gate": "Abstract <= 200 words",
            "pass": False,
            "value": None,
            "note": "No abstract section detected",
        }

    # -- D03-04: Seminal IB works cited --
    seminal_authors = [
        "Dunning", "Buckley", "Casson", "Johanson", "Vahlne",
        "Hymer", "Vernon", "Rugman", "Ghemawat", "Peng",
        "Kostova", "Zaheer", "Hennart", "Cantwell", "Narula",
    ]
    found_seminal = [a for a in seminal_authors if a in content]
    results["gates"]["D03-04"] = {
        "gate": "Seminal IB works cited",
        "pass": len(found_seminal) >= 3,
        "value": found_seminal,
        "note": f"Found {len(found_seminal)}/15 seminal IB authors",
    }

    # -- D03-05: Recent literature (last 3 years) --
    import datetime
    current_year = datetime.datetime.now().year
    recent_years = [str(y) for y in range(current_year - 3, current_year + 1)]
    citations = extract_citations(content)
    recent_cites = [c for c in citations if c[1] in recent_years]
    results["gates"]["D03-05"] = {
        "gate": "Recent literature included",
        "pass": len(recent_cites) >= 5,
        "value": len(recent_cites),
        "note": f"Found {len(recent_cites)} citations from {current_year-3}-{current_year}",
    }

    # -- D04-04/05: Citation count & cross-check --
    unique_citations = list(set(citations))
    results["gates"]["D04-04"] = {
        "gate": "Sufficient in-text citations",
        "pass": len(unique_citations) >= 40,
        "value": len(unique_citations),
        "note": f"Found {len(unique_citations)} unique in-text citations (need >= 40)",
    }

    # Check if References section exists
    ref_section = re.search(r'(?:^|\n)\s*(?:References|REFERENCES|Bibliography)\s*\n', content)
    results["gates"]["D04-05"] = {
        "gate": "Reference list present",
        "pass": ref_section is not None,
        "value": ref_section is not None,
        "note": "Reference section " + ("found" if ref_section else "MISSING"),
    }

    # -- D07-02: Sample size mentioned --
    sample_patterns = [
        r'[Nn]\s*=\s*\d+', r'sample\s+(?:size|of)\s+\d+',
        r'\d+\s+(?:firms?|companies|observations|respondents|participants)',
        r'panel\s+(?:data|of)\s+\d+',
    ]
    sample_found = any(re.search(p, content) for p in sample_patterns)
    results["gates"]["D07-02"] = {
        "gate": "Sample size reported",
        "pass": sample_found,
        "value": sample_found,
        "note": "Sample size " + ("found" if sample_found else "NOT FOUND — add N=X"),
    }

    # -- D07-08: Descriptive statistics table --
    has_desc_table = bool(re.search(
        r'(?:descriptive\s+statistics|summary\s+statistics|table\s+\d+[.:]\s*descriptive)',
        content, re.IGNORECASE
    ))
    # Also check for markdown/ASCII table patterns
    table_pipe = content.count("|") > 10 and "---" in content
    results["gates"]["D07-08"] = {
        "gate": "Descriptive statistics table",
        "pass": has_desc_table or table_pipe,
        "value": has_desc_table or table_pipe,
        "note": "Descriptive stats table " + ("found" if (has_desc_table or table_pipe) else "MISSING"),
    }

    # -- D07-09: Correlation matrix --
    has_corr = bool(re.search(
        r'(?:correlation\s+matrix|correlation\s+table|table\s+\d+[.:]\s*correlation)',
        content, re.IGNORECASE
    ))
    results["gates"]["D07-09"] = {
        "gate": "Correlation matrix",
        "pass": has_corr,
        "value": has_corr,
        "note": "Correlation matrix " + ("found" if has_corr else "MISSING"),
    }

    # -- D10-10: Statistical software version --
    software_patterns = [
        r'(?:Stata|STATA)\s+(?:version\s+)?(\d+)',
        r'(?:SPSS|spss)\s+(?:version\s+)?(\d+)',
        r'\bR\b\s+(?:version\s+)?(\d+\.\d+)',
        r'(?:Python|python)\s+(\d+\.\d+)',
        r'(?:EViews|Eviews|eviews)\s+(\d+)',
        r'(?:SAS|sas)\s+(?:version\s+)?(\d+)',
        r'(?:MATLAB|Matlab)\s+R?(\d{4})',
        r'(?:Mplus|MPLUS)\s+(?:version\s+)?(\d+)',
    ]
    software_found = None
    for pat in software_patterns:
        m = re.search(pat, content)
        if m:
            software_found = m.group(0)
            break
    results["gates"]["D10-10"] = {
        "gate": "Software and version reported",
        "pass": software_found is not None,
        "value": software_found,
        "note": f"Software: {software_found}" if software_found else "No software version found — add 'Stata 17' or similar",
    }

    # -- D12-01: Coefficients with SE/significance --
    has_coefficients = bool(re.search(
        r'(?:coefficient|beta|β)\s*[=:]\s*[-]?\d+\.\d+',
        content, re.IGNORECASE
    ))
    has_se = bool(re.search(r'(?:standard\s+error|s\.e\.|SE)\s*[=:]\s*\d+\.\d+', content, re.IGNORECASE))
    has_pvalue = bool(re.search(r'p\s*[<>=]\s*0?\.\d+', content, re.IGNORECASE))
    has_significance = bool(re.search(r'\*{1,3}', content))
    results["gates"]["D12-01"] = {
        "gate": "Coefficients with SE and significance",
        "pass": has_coefficients and (has_se or has_pvalue or has_significance),
        "value": {"coefficients": has_coefficients, "se": has_se, "p_value": has_pvalue, "stars": has_significance},
        "note": "Results reporting " + ("adequate" if has_coefficients else "MISSING coefficients"),
    }

    # -- D12-06: Readable results tables --
    table_count = len(re.findall(r'(?:Table|TABLE)\s+\d+', content))
    results["gates"]["D12-06"] = {
        "gate": "Results in readable tables",
        "pass": table_count >= 2,
        "value": table_count,
        "note": f"Found {table_count} tables (need >= 2)",
    }

    # -- D08-03: LLM artifact detection (CRITICAL) --
    llm_issues = detect_llm_artifacts(content)
    results["gates"]["D08-03"] = {
        "gate": "No AI-generated content markers",
        "pass": len(llm_issues) == 0,
        "critical": True,
        "value": llm_issues[:5],
        "note": f"Found {len(llm_issues)} LLM artifacts" if llm_issues else "Clean — no LLM artifacts detected",
    }

    # -- Section presence check --
    required_sections = [
        "Introduction", "Literature", "Method", "Result", "Discussion", "Conclusion",
    ]
    found_sections = []
    for sec in required_sections:
        if re.search(rf'(?:^|\n)\s*(?:\d+\.?\s*)?{sec}', content, re.IGNORECASE):
            found_sections.append(sec)
    missing = [s for s in required_sections if s not in found_sections]
    results["sections_present"] = found_sections
    results["sections_missing"] = missing


    # -- Per-section word counts --
    section_headers = ["Abstract", "Introduction", "Literature", "Method", "Result", "Discussion", "Conclusion"]
    section_words = {}
    for i, sec in enumerate(section_headers):
        pat = rf'(?:^|\n)\s*(?:\d+\.?\s*)?{sec}[\s\S]*?'
        if i + 1 < len(section_headers):
            next_sec = section_headers[i + 1]
            pat += rf'(?=(?:^|\n)\s*(?:\d+\.?\s*)?{next_sec})'
        else:
            pat += '$'
        m = re.search(pat, content, re.IGNORECASE)
        if m:
            section_words[sec] = len(m.group().split())
        else:
            section_words[sec] = 0
    results["section_word_counts"] = section_words

    # Minimum section word counts (generous for review/conceptual papers)
    min_section_words = {
        "Introduction": 300, "Literature": 500, "Method": 200,
        "Result": 400, "Discussion": 400, "Conclusion": 150,
    }
    thin_sections = []
    for sec, min_w in min_section_words.items():
        actual = section_words.get(sec, 0)
        if actual < min_w:
            thin_sections.append(f"{sec}: {actual} words (need {min_w}+)")
    results["gates"]["SECTION_DEPTH"] = {
        "gate": "All sections have adequate depth",
        "pass": len(thin_sections) == 0,
        "value": thin_sections,
        "note": f"{len(thin_sections)} thin sections" if thin_sections else "All sections have adequate depth",
    }

    # -- Citation orphan/ghost cross-check --
    # Find reference list entries
    ref_match = re.search(r'(?:^|\n)\s*(?:References|REFERENCES|Bibliography)\s*\n([\s\S]*?)$', content)
    ref_entries = []
    if ref_match:
        ref_text = ref_match.group(1)
        ref_entries = re.findall(r'([A-Z][a-z]+(?:\s+(?:&|and)\s+[A-Z][a-z]+)*)[,.]?\s*\(?(\d{4})\)?', ref_text)

    in_text_set = set((c[0].strip(), c[1]) for c in citations)
    ref_set = set((r[0].strip(), r[1]) for r in ref_entries)

    orphans = in_text_set - ref_set if ref_set else set()
    ghosts = ref_set - in_text_set if in_text_set else set()

    results["gates"]["CITE_CROSSCHECK"] = {
        "gate": "Citation-reference cross-check",
        "pass": len(orphans) <= 3 and len(ghosts) <= 3,
        "value": {"orphans": len(orphans), "ghosts": len(ghosts)},
        "note": f"{len(orphans)} orphan citations (in text but not in refs), {len(ghosts)} ghost refs (in refs but not cited)",
    }

    # -- Overclaiming language detection --
    overclaim_patterns = [
        (r'\bproves?\s+that\b', "proves that"),
        (r'\bdefinitively\s+(?:shows?|demonstrates?)\b', "definitively shows"),
        (r'\ball\s+evidence\s+(?:shows?|suggests?|indicates?)\b', "all evidence shows"),
        (r'\bthis\s+is\s+the\s+first\s+study\b', "this is the first study"),
        (r'\brobust\s+evidence\b', "robust evidence"),
        (r'\bclearly\s+(?:shows?|demonstrates?|proves?)\b', "clearly shows"),
        (r'\bundeniably\b', "undeniably"),
        (r'\bincontrovertible\b', "incontrovertible"),
    ]
    overclaims = []
    for pat, label in overclaim_patterns:
        if re.search(pat, content, re.IGNORECASE):
            overclaims.append(label)
    results["gates"]["OVERCLAIMING"] = {
        "gate": "No overclaiming language",
        "pass": len(overclaims) == 0,
        "value": overclaims,
        "note": f"Found overclaiming: {', '.join(overclaims)}" if overclaims else "No overclaiming detected",
    }

    # -- Construct definition detection (D05-01) --
    definition_patterns = [
        r'defined\s+as\b',
        r'refers?\s+to\b',
        r'is\s+(?:the|a)\s+(?:concept|construct|term|phenomenon)',
        r'we\s+define\b',
        r'following\s+[A-Z][a-z]+\s*\(\d{4}\)',
    ]
    definition_count = sum(len(re.findall(p, content, re.IGNORECASE)) for p in definition_patterns)
    results["gates"]["CONSTRUCT_DEFS"] = {
        "gate": "Constructs formally defined",
        "pass": definition_count >= 3,
        "value": definition_count,
        "note": f"Found {definition_count} construct definitions (need >= 3)",
    }

    # -- Research question presence (D01-01) --
    rq_patterns = [
        r'research\s+question',
        r'this\s+(?:paper|study|article)\s+(?:asks|examines|investigates|explores)',
        r'we\s+(?:ask|examine|investigate|explore)',
        r'how\s+does?\b.*\?',
        r'what\s+(?:is|are|explains?)\b.*\?',
        r'to\s+what\s+extent\b',
    ]
    has_rq = any(re.search(p, content, re.IGNORECASE) for p in rq_patterns)
    results["gates"]["RQ_PRESENT"] = {
        "gate": "Research question stated",
        "pass": has_rq,
        "value": has_rq,
        "note": "Research question " + ("found" if has_rq else "NOT FOUND — state your RQ explicitly"),
    }

    # -- IB Theory grounding (D02-03) --
    ib_theories = [
        "OLI", "eclectic paradigm", "internalization", "Uppsala",
        "institutional theory", "institutional distance", "institutional void",
        "resource-based view", "RBV", "transaction cost", "TCE",
        "agency theory", "signaling theory", "social capital",
        "born global", "springboard", "LLL framework",
        "liability of foreignness", "psychic distance",
    ]
    found_theories = [t for t in ib_theories if t.lower() in content.lower()]
    results["gates"]["IB_THEORY"] = {
        "gate": "IB theory grounding",
        "pass": len(found_theories) >= 2,
        "value": found_theories,
        "note": f"Found {len(found_theories)} IB theories: {', '.join(found_theories[:5])}" if found_theories else "No IB theories found — ground in OLI, institutional theory, RBV, etc.",
    }


    # -- Overall --
    gate_results = results["gates"]
    passed = sum(1 for g in gate_results.values() if g["pass"])
    failed = sum(1 for g in gate_results.values() if not g["pass"])
    critical_fail = any(g.get("critical") and not g["pass"] for g in gate_results.values())

    results["summary"] = {
        "passed": passed,
        "failed": failed,
        "total": passed + failed,
        "critical_failure": critical_fail,
        "ready_for_gate": failed == 0 and not critical_fail,
    }

    return results


@app.post("/validate_citations")
def validate_citations(req: CitationValidateRequest):
    """
    Extract citations from text, cross-check DOIs against blacklist/tier.
    Maps to D04-01..D04-07 gates.
    """
    citations = extract_citations(req.content)
    unique_cites = list(set(citations))

    results = {
        "total_citations": len(citations),
        "unique_citations": len(unique_cites),
        "doi_checks": [],
        "blacklisted": [],
        "tiered": [],
        "unverified": [],
    }

    # Check provided DOIs
    for doi in req.dois:
        bl = is_blacklisted(doi)
        if bl:
            results["blacklisted"].append({"doi": doi, "reason": bl})
        jname, jtier = classify_journal_doi(doi)
        if jtier:
            results["tiered"].append({"doi": doi, "journal": jname, "tier": jtier})
        results["doi_checks"].append({
            "doi": doi,
            "blacklisted": bl,
            "journal": jname,
            "tier": jtier,
        })

    # Summary for gate mapping
    results["gates"] = {
        "D04-01": {
            "gate": "No fabricated citations",
            "pass": len(results["blacklisted"]) == 0,
            "note": f"{len(results['blacklisted'])} blacklisted DOIs found" if results["blacklisted"] else "No blacklisted sources",
        },
        "D04-04": {
            "gate": "Sufficient unique citations",
            "pass": len(unique_cites) >= 40,
            "value": len(unique_cites),
            "note": f"{len(unique_cites)} unique citations (need >= 40)",
        },
    }

    return results


@app.post("/classify_journal")
def classify_journal(req: JournalClassifyRequest):
    """
    Classify a DOI's journal tier. Maps to D03-04.
    """
    bl = is_blacklisted(req.doi)
    jname, jtier = classify_journal_doi(req.doi)

    return {
        "doi": req.doi,
        "journal_name": jname,
        "tier": jtier,
        "blacklisted": bl,
        "gate_D03_04": {
            "pass": jtier in ("AAA", "AA") or bl is None,
            "note": f"{jname} [{jtier}]" if jtier else ("BLACKLISTED: " + bl if bl else "Unknown journal"),
        },
    }


@app.post("/check_retraction")
async def check_retraction(req: RetractionCheckRequest):
    """
    Check CrossRef for retraction status. Maps to D04-01, D04-02, D08-07.
    """
    doi = req.doi.strip()
    if not doi:
        raise HTTPException(400, "DOI required")

    # Also check blacklist
    bl = is_blacklisted(doi)

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"https://api.crossref.org/works/{doi}",
                params={"mailto": "epistemon-research@example.com"},
            )
            if resp.status_code == 200:
                data = resp.json().get("message", {})
                update_to = data.get("update-to", [])
                is_retracted = any(u.get("type") == "retraction" for u in update_to)
                return {
                    "doi": doi,
                    "retracted": is_retracted,
                    "blacklisted": bl,
                    "update_to": [
                        {"type": u.get("type"), "DOI": u.get("DOI"), "label": u.get("label")}
                        for u in update_to
                    ] if update_to else [],
                    "gates": {
                        "D04-01": {"pass": not is_retracted, "note": "RETRACTED" if is_retracted else "Not retracted"},
                        "D08-07": {"pass": bl is None, "note": f"Blacklisted: {bl}" if bl else "Not blacklisted"},
                    },
                }
            return {"doi": doi, "retracted": False, "blacklisted": bl, "note": f"CrossRef HTTP {resp.status_code}"}
    except Exception as e:
        return {"doi": doi, "retracted": False, "blacklisted": bl, "error": str(e)}


@app.post("/ara_search")
async def ara_search(req: SearchRequest):
    """
    Multi-API academic search — Semantic Scholar + OpenAlex + CrossRef in parallel.
    Returns deduplicated results sorted by citation count.
    """
    query = req.query
    limit = min(req.limit, 50)
    all_papers = []

    async with httpx.AsyncClient(timeout=20) as client:
        # Semantic Scholar
        try:
            s2_resp = await client.get(
                "https://api.semanticscholar.org/graph/v1/paper/search",
                params={
                    "query": query, "limit": min(limit, 20),
                    "fields": "title,abstract,authors,year,externalIds,citationCount,url",
                },
            )
            if s2_resp.status_code == 200:
                for p in s2_resp.json().get("data", []):
                    doi = (p.get("externalIds") or {}).get("DOI")
                    authors = [a.get("name", "") for a in (p.get("authors") or [])[:10]]
                    jname, jtier = classify_journal_doi(doi)
                    bl = is_blacklisted(doi)
                    all_papers.append({
                        "title": (p.get("title") or "").strip(),
                        "abstract": (p.get("abstract") or "")[:500],
                        "authors": authors,
                        "year": p.get("year"),
                        "doi": doi,
                        "citation_count": p.get("citationCount", 0),
                        "source": "semantic_scholar",
                        "journal_tier": jtier,
                        "journal_name": jname,
                        "blacklisted": bl,
                    })
        except Exception:
            pass

        # OpenAlex
        try:
            oa_resp = await client.get(
                "https://api.openalex.org/works",
                params={"search": query, "per_page": min(limit, 20)},
                headers={"User-Agent": "Epistemon/1.0 (research-agent)"},
            )
            if oa_resp.status_code == 200:
                for w in oa_resp.json().get("results", []):
                    doi = (w.get("doi") or "").replace("https://doi.org/", "")
                    authors = [a.get("author", {}).get("display_name", "") for a in (w.get("authorships") or [])[:10]]
                    jname, jtier = classify_journal_doi(doi)
                    bl = is_blacklisted(doi)
                    all_papers.append({
                        "title": (w.get("title") or "").strip(),
                        "abstract": "",
                        "authors": authors,
                        "year": w.get("publication_year"),
                        "doi": doi if doi else None,
                        "citation_count": w.get("cited_by_count", 0),
                        "source": "openalex",
                        "journal_tier": jtier,
                        "journal_name": jname,
                        "blacklisted": bl,
                    })
        except Exception:
            pass

        # CrossRef
        try:
            cr_resp = await client.get(
                "https://api.crossref.org/works",
                params={
                    "query": query, "rows": min(limit, 20),
                    "mailto": "epistemon-research@example.com",
                },
            )
            if cr_resp.status_code == 200:
                for item in cr_resp.json().get("message", {}).get("items", []):
                    doi = item.get("DOI")
                    titles = item.get("title", [])
                    title = titles[0] if titles else ""
                    authors = []
                    for a in (item.get("author") or [])[:10]:
                        name = f"{a.get('given', '')} {a.get('family', '')}".strip()
                        if name:
                            authors.append(name)
                    year = None
                    dp = item.get("published-print") or item.get("published-online") or item.get("created")
                    if dp and dp.get("date-parts"):
                        year = dp["date-parts"][0][0] if dp["date-parts"][0] else None
                    jname, jtier = classify_journal_doi(doi)
                    bl = is_blacklisted(doi)
                    all_papers.append({
                        "title": title.strip(),
                        "abstract": "",
                        "authors": authors,
                        "year": year,
                        "doi": doi,
                        "citation_count": item.get("is-referenced-by-count", 0),
                        "source": "crossref",
                        "journal_tier": jtier,
                        "journal_name": jname,
                        "blacklisted": bl,
                    })
        except Exception:
            pass

    # Deduplicate by DOI
    seen_dois: set[str] = set()
    seen_titles: set[str] = set()
    deduped = []
    for p in sorted(all_papers, key=lambda x: x.get("citation_count", 0), reverse=True):
        doi = p.get("doi")
        title_lower = (p.get("title") or "").lower().strip()
        if doi and doi in seen_dois:
            continue
        if title_lower and title_lower in seen_titles:
            continue
        if doi:
            seen_dois.add(doi)
        if title_lower:
            seen_titles.add(title_lower)
        deduped.append(p)

    return {"papers": deduped[:limit], "total": len(deduped)}


@app.post("/mmr_search")
async def mmr_search(req: MmrSearchRequest):
    """
    MMR (Maximal Marginal Relevance) semantic search on the KB.
    Wraps the KB's /papers/semantic endpoint with diversity reranking.
    """
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{KB_BASE}/papers/semantic",
                params={"q": req.query, "limit": req.limit * 3},
            )
            if resp.status_code != 200:
                return {"error": f"KB semantic search failed: HTTP {resp.status_code}", "papers": []}
            data = resp.json()
            papers = data.get("results", [])

            if len(papers) <= req.limit:
                return {"papers": papers, "total": len(papers), "method": "semantic_direct"}

            # Simple MMR: penalize papers too similar to already-selected ones
            # Using title/abstract overlap as proxy (no embeddings needed here)
            selected = [papers[0]]
            remaining = papers[1:]

            while len(selected) < req.limit and remaining:
                best_idx = 0
                best_score = -1
                for i, candidate in enumerate(remaining):
                    # Relevance = position score (earlier = higher)
                    relevance = 1.0 - (i / len(remaining))
                    # Diversity = 1 - max_similarity to selected papers
                    max_sim = 0
                    cand_words = set((candidate.get("title", "") + " " + candidate.get("abstract", "")).lower().split())
                    for sel in selected:
                        sel_words = set((sel.get("title", "") + " " + sel.get("abstract", "")).lower().split())
                        if cand_words and sel_words:
                            overlap = len(cand_words & sel_words) / max(len(cand_words | sel_words), 1)
                            max_sim = max(max_sim, overlap)
                    diversity = 1.0 - max_sim
                    score = req.lambda_param * relevance + (1 - req.lambda_param) * diversity
                    if score > best_score:
                        best_score = score
                        best_idx = i
                selected.append(remaining.pop(best_idx))

            return {"papers": selected, "total": len(selected), "method": "mmr"}
    except Exception as e:
        return {"error": str(e), "papers": []}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8178)

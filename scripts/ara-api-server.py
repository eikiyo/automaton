#!/usr/bin/env python3
# Location: scripts/ara-api-server.py
# Purpose: Standalone FastAPI server wrapping ARA central.db for Epistemon agent queries
# Functions: paper search, claim search, DOI validation, MMR semantic search, stats
# Calls: sqlite3, numpy, FastAPI
# Imports: fastapi, sqlite3, json, numpy

"""
ARA Knowledge Base API — Standalone server for Epistemon agent.
Serves papers, claims, DOI validations, and MMR semantic search from the ARA central.db.
Binds to 127.0.0.1:8177 (agent-only, no external access).
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import sqlite3
from pathlib import Path
from typing import Any, Optional

import numpy as np
from fastapi import FastAPI, Query, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("ara-api")

DB_PATH = Path("/opt/ara-db/central.db")

app = FastAPI(title="ARA Knowledge Base", version="1.0.0", docs_url=None, redoc_url=None)


# ─── DB Connection ──────────────────────────────────────────────

def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA query_only=ON")  # read-only for safety
    return conn


_conn: sqlite3.Connection | None = None


def db() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        _conn = get_db()
    return _conn


# ─── Helpers ────────────────────────────────────────────────────

def _title_hash(title: str) -> str:
    t = title.lower().strip()
    t = re.sub(r'[^\w\s]', '', t)
    t = re.sub(r'\s+', ' ', t)
    return hashlib.sha256(t.encode("utf-8")).hexdigest()[:32]


def _parse_authors(raw: str | None) -> list:
    if not raw:
        return []
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return []


def _row_to_paper(row: sqlite3.Row) -> dict:
    d = dict(row)
    d["authors"] = _parse_authors(d.get("authors"))
    # Strip large fields from list views
    d.pop("embedding", None)
    d.pop("full_text", None)
    return d


def _row_to_claim(row: sqlite3.Row) -> dict:
    d = dict(row)
    d.pop("embedding", None)
    return d


def _cosine_sim(a: np.ndarray, b: np.ndarray) -> float:
    na = np.linalg.norm(a)
    nb = np.linalg.norm(b)
    if na == 0 or nb == 0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


# ─── Embedding Cache (loaded lazily) ───────────────────────────

class EmbeddingCache:
    """Loads embeddings from DB into numpy arrays for fast MMR search."""

    def __init__(self):
        self._paper_cache: tuple | None = None  # (items, embs_np)
        self._claim_cache: tuple | None = None
        self._chunk_cache: tuple | None = None

    def get_paper_embeddings(self) -> tuple[list[dict], np.ndarray]:
        if self._paper_cache is None:
            self._paper_cache = self._load("papers", "paper_id")
        return self._paper_cache

    def get_claim_embeddings(self) -> tuple[list[dict], np.ndarray]:
        if self._claim_cache is None:
            self._claim_cache = self._load_claims()
        return self._claim_cache

    def get_chunk_embeddings(self) -> tuple[list[dict], np.ndarray]:
        if self._chunk_cache is None:
            self._chunk_cache = self._load_chunks()
        return self._chunk_cache

    def _load(self, table: str, id_col: str) -> tuple[list[dict], np.ndarray]:
        log.info("Loading %s embeddings into cache...", table)
        rows = db().execute(
            f"SELECT {id_col}, title, abstract, doi, year, citation_count, embedding "
            f"FROM {table} WHERE embedding IS NOT NULL"
        ).fetchall()
        items = []
        embs = []
        for r in rows:
            emb_raw = r["embedding"]
            try:
                emb = json.loads(emb_raw)
                if isinstance(emb, list) and len(emb) > 0:
                    items.append({k: r[k] for k in r.keys() if k != "embedding"})
                    embs.append(emb)
            except (json.JSONDecodeError, TypeError):
                continue
        log.info("Loaded %d %s embeddings (dim=%d)", len(items), table, len(embs[0]) if embs else 0)
        if not embs:
            return items, np.array([])
        return items, np.array(embs, dtype=np.float32)

    def _load_claims(self) -> tuple[list[dict], np.ndarray]:
        log.info("Loading claim embeddings into cache...")
        rows = db().execute(
            "SELECT claim_id, paper_doi, paper_title, claim_text, claim_type, "
            "confidence, study_design, sample_size, effect_size, p_value, embedding "
            "FROM claims WHERE embedding IS NOT NULL"
        ).fetchall()
        items = []
        embs = []
        for r in rows:
            try:
                emb = json.loads(r["embedding"])
                if isinstance(emb, list) and len(emb) > 0:
                    items.append({k: r[k] for k in r.keys() if k != "embedding"})
                    embs.append(emb)
            except (json.JSONDecodeError, TypeError):
                continue
        log.info("Loaded %d claim embeddings", len(items))
        if not embs:
            return items, np.array([])
        return items, np.array(embs, dtype=np.float32)

    def _load_chunks(self) -> tuple[list[dict], np.ndarray]:
        log.info("Loading chunk embeddings into cache...")
        rows = db().execute(
            "SELECT c.chunk_id, c.paper_id, c.chunk_index, c.chunk_text, c.embedding, "
            "p.title as paper_title, p.doi as paper_doi "
            "FROM paper_chunks c JOIN papers p ON c.paper_id = p.paper_id "
            "WHERE c.embedding IS NOT NULL LIMIT 50000"
        ).fetchall()
        items = []
        embs = []
        for r in rows:
            try:
                emb = json.loads(r["embedding"])
                if isinstance(emb, list) and len(emb) > 0:
                    items.append({k: r[k] for k in r.keys() if k != "embedding"})
                    embs.append(emb)
            except (json.JSONDecodeError, TypeError):
                continue
        log.info("Loaded %d chunk embeddings", len(items))
        if not embs:
            return items, np.array([])
        return items, np.array(embs, dtype=np.float32)


_cache = EmbeddingCache()


def mmr_search(
    query_emb: list[float],
    items: list[dict],
    embs: np.ndarray,
    limit: int = 20,
    min_cosine: float = 0.3,
    lam: float = 0.7,
) -> list[dict]:
    """Maximal Marginal Relevance search using numpy for speed."""
    if len(items) == 0 or embs.size == 0:
        return []

    q = np.array(query_emb, dtype=np.float32)
    q_norm = q / (np.linalg.norm(q) + 1e-10)

    # Compute all cosine similarities at once
    norms = np.linalg.norm(embs, axis=1, keepdims=True)
    norms = np.where(norms == 0, 1e-10, norms)
    normed = embs / norms
    sims = normed @ q_norm  # (N,)

    # Filter by min_cosine
    mask = sims >= min_cosine
    valid_indices = np.where(mask)[0]
    if len(valid_indices) == 0:
        return []

    valid_sims = sims[valid_indices]
    valid_embs = normed[valid_indices]

    # MMR selection
    selected = []
    selected_embs = []
    remaining = list(range(len(valid_indices)))

    for _ in range(min(limit, len(remaining))):
        best_score = -1.0
        best_idx = -1

        for i, ri in enumerate(remaining):
            relevance = valid_sims[ri]
            if selected_embs:
                sel_arr = np.array(selected_embs)
                max_sim = float(np.max(sel_arr @ valid_embs[ri]))
            else:
                max_sim = 0.0
            score = lam * relevance - (1 - lam) * max_sim
            if score > best_score:
                best_score = score
                best_idx = i

        if best_idx < 0:
            break

        ri = remaining.pop(best_idx)
        orig_idx = valid_indices[ri]
        item = dict(items[orig_idx])
        item["_score"] = float(valid_sims[ri])
        selected.append(item)
        selected_embs.append(valid_embs[ri].tolist())

    return selected


# ─── API Routes ─────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "db": str(DB_PATH), "exists": DB_PATH.exists()}


@app.get("/stats")
def stats():
    c = db()
    paper_count = c.execute("SELECT COUNT(*) FROM papers").fetchone()[0]
    claim_count = c.execute("SELECT COUNT(*) FROM claims").fetchone()[0]
    doi_count = c.execute("SELECT COUNT(*) FROM doi_validations").fetchone()[0]
    papers_with_emb = c.execute("SELECT COUNT(*) FROM papers WHERE embedding IS NOT NULL").fetchone()[0]
    claims_with_emb = c.execute("SELECT COUNT(*) FROM claims WHERE embedding IS NOT NULL").fetchone()[0]
    chunks = c.execute("SELECT COUNT(*) FROM paper_chunks").fetchone()[0]
    chunks_with_emb = c.execute("SELECT COUNT(*) FROM paper_chunks WHERE embedding IS NOT NULL").fetchone()[0]
    papers_with_fulltext = c.execute("SELECT COUNT(*) FROM papers WHERE full_text IS NOT NULL").fetchone()[0]

    return {
        "papers": paper_count,
        "papers_with_embeddings": papers_with_emb,
        "papers_with_fulltext": papers_with_fulltext,
        "claims": claim_count,
        "claims_with_embeddings": claims_with_emb,
        "doi_validations": doi_count,
        "chunks": chunks,
        "chunks_with_embeddings": chunks_with_emb,
    }


# ── Papers ──

@app.get("/papers/search")
def search_papers(
    q: str = Query(..., min_length=2, description="Keyword to search in title/abstract"),
    limit: int = Query(20, ge=1, le=200),
):
    rows = db().execute(
        "SELECT paper_id, title, abstract, authors, year, doi, source, citation_count, journal_tier, journal_name "
        "FROM papers WHERE (title LIKE ? OR abstract LIKE ?) "
        "ORDER BY citation_count DESC LIMIT ?",
        (f"%{q}%", f"%{q}%", limit),
    ).fetchall()
    return {"results": [_row_to_paper(r) for r in rows], "count": len(rows)}


@app.get("/papers/{paper_id}")
def get_paper(paper_id: int):
    row = db().execute(
        "SELECT paper_id, title, abstract, authors, year, doi, source, url, "
        "citation_count, journal_tier, journal_name, full_text "
        "FROM papers WHERE paper_id = ?",
        (paper_id,),
    ).fetchone()
    if not row:
        raise HTTPException(404, "Paper not found")
    d = _row_to_paper(row)
    # Include full_text if available (truncated for large texts)
    ft = dict(row).get("full_text")
    if ft:
        d["full_text"] = ft[:50000]
        d["full_text_truncated"] = len(ft) > 50000
    return d


@app.get("/papers/by-doi/{doi:path}")
def get_paper_by_doi(doi: str):
    row = db().execute(
        "SELECT paper_id, title, abstract, authors, year, doi, source, url, "
        "citation_count, journal_tier, journal_name "
        "FROM papers WHERE LOWER(doi) = LOWER(?)",
        (doi,),
    ).fetchone()
    if not row:
        raise HTTPException(404, "Paper not found")
    return _row_to_paper(row)


@app.get("/papers/by-year")
def papers_by_year(
    start: int = Query(...), end: int = Query(...), limit: int = Query(100, ge=1, le=500),
):
    rows = db().execute(
        "SELECT paper_id, title, abstract, authors, year, doi, source, citation_count, journal_tier "
        "FROM papers WHERE year BETWEEN ? AND ? ORDER BY citation_count DESC LIMIT ?",
        (start, end, limit),
    ).fetchall()
    return {"results": [_row_to_paper(r) for r in rows], "count": len(rows)}


@app.get("/papers/top-tier")
def top_tier_papers(
    tier: str = Query("AAA", description="Journal tier: AAA, AA, A, B, etc."),
    limit: int = Query(50, ge=1, le=200),
):
    rows = db().execute(
        "SELECT paper_id, title, abstract, authors, year, doi, journal_name, journal_tier, citation_count "
        "FROM papers WHERE journal_tier = ? ORDER BY citation_count DESC LIMIT ?",
        (tier, limit),
    ).fetchall()
    return {"results": [_row_to_paper(r) for r in rows], "count": len(rows)}


# ── Claims ──

@app.get("/claims/search")
def search_claims(
    q: str = Query(..., min_length=2, description="Keyword to search in claim text"),
    limit: int = Query(50, ge=1, le=500),
):
    rows = db().execute(
        "SELECT claim_id, paper_doi, paper_title, claim_text, claim_type, confidence, "
        "study_design, sample_size, effect_size, p_value, confidence_interval, population, country "
        "FROM claims WHERE claim_text LIKE ? ORDER BY confidence DESC LIMIT ?",
        (f"%{q}%", limit),
    ).fetchall()
    return {"results": [_row_to_claim(r) for r in rows], "count": len(rows)}


@app.get("/claims/by-paper")
def claims_by_paper(doi: str = Query(None), title: str = Query(None)):
    if doi:
        rows = db().execute(
            "SELECT claim_id, paper_doi, paper_title, claim_text, claim_type, confidence, "
            "study_design, sample_size, effect_size, p_value, confidence_interval "
            "FROM claims WHERE paper_doi = ?",
            (doi,),
        ).fetchall()
    elif title:
        t_hash = _title_hash(title)
        rows = db().execute(
            "SELECT claim_id, paper_doi, paper_title, claim_text, claim_type, confidence, "
            "study_design, sample_size, effect_size, p_value, confidence_interval "
            "FROM claims WHERE paper_title_hash = ?",
            (t_hash,),
        ).fetchall()
    else:
        raise HTTPException(400, "Provide doi or title parameter")
    return {"results": [_row_to_claim(r) for r in rows], "count": len(rows)}


# ── DOI Validation ──

@app.get("/doi/{doi:path}")
def get_doi_validation(doi: str):
    row = db().execute(
        "SELECT * FROM doi_validations WHERE LOWER(doi) = LOWER(?)", (doi,),
    ).fetchone()
    if not row:
        raise HTTPException(404, "DOI validation not found")
    return dict(row)


# ── Risk of Bias ──

@app.get("/risk-of-bias")
def get_risk_of_bias(topic: str = Query(...)):
    rows = db().execute(
        "SELECT * FROM risk_of_bias WHERE session_topic = ?", (topic,),
    ).fetchall()
    return {"results": [dict(r) for r in rows], "count": len(rows)}


# ── GRADE Evidence ──

@app.get("/grade-evidence")
def get_grade_evidence(topic: str = Query(...)):
    rows = db().execute(
        "SELECT * FROM grade_evidence WHERE session_topic = ?", (topic,),
    ).fetchall()
    return {"results": [dict(r) for r in rows], "count": len(rows)}


# ── MMR Semantic Search ──

class MMRRequest(BaseModel):
    embedding: list[float]
    limit: int = 20
    min_cosine: float = 0.3
    lam: float = 0.7


@app.post("/papers/mmr")
def papers_mmr(req: MMRRequest):
    items, embs = _cache.get_paper_embeddings()
    results = mmr_search(req.embedding, items, embs, req.limit, req.min_cosine, req.lam)
    return {"results": results, "count": len(results)}


@app.post("/claims/mmr")
def claims_mmr(req: MMRRequest):
    items, embs = _cache.get_claim_embeddings()
    results = mmr_search(req.embedding, items, embs, req.limit, req.min_cosine, req.lam)
    return {"results": results, "count": len(results)}


@app.post("/chunks/mmr")
def chunks_mmr(req: MMRRequest):
    items, embs = _cache.get_chunk_embeddings()
    results = mmr_search(req.embedding, items, embs, req.limit, req.min_cosine, req.lam)
    return {"results": results, "count": len(results)}


# ─── Startup ────────────────────────────────────────────────────

@app.on_event("startup")
def startup():
    if not DB_PATH.exists():
        log.warning("Database not found at %s — server will fail on queries", DB_PATH)
        return
    log.info("ARA Knowledge Base API starting — DB: %s", DB_PATH)
    # Test connection
    c = db()
    count = c.execute("SELECT COUNT(*) FROM papers").fetchone()[0]
    log.info("Database connected: %d papers", count)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8177, log_level="info")

/**
 * Location: src/epistemic/literature-client.ts
 * Purpose: Academic API client — Semantic Scholar (free tier), arXiv, OpenAlex
 * Functions: LiteratureClient.search, getPaper, getCitations
 * Calls: Semantic Scholar API, arXiv API, OpenAlex API
 * Imports: ResilientHttpClient
 */

import { ResilientHttpClient } from "../conway/http-client.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("epistemic.literature");

export interface Paper {
  id: string;           // Semantic Scholar paper ID or DOI
  title: string;
  abstract: string;
  authors: string[];
  year: number;
  citationCount: number;
  doi?: string;
  url?: string;
  source: "semantic_scholar" | "arxiv" | "openalex";
}

export interface SearchResult {
  papers: Paper[];
  total: number;
  query: string;
}

const S2_BASE = "https://api.semanticscholar.org/graph/v1";
const OPENALEX_BASE = "https://api.openalex.org";

export class LiteratureClient {
  private http: ResilientHttpClient;
  private apiKey?: string;

  constructor(apiKey?: string) {
    this.http = new ResilientHttpClient({
      baseTimeout: 15000,
      maxRetries: 2,
      backoffBase: 2000,
      circuitBreakerThreshold: 5,
      circuitBreakerResetMs: 120000,
    });
    this.apiKey = apiKey;
  }

  /**
   * Search for papers across academic databases.
   * Tries Semantic Scholar first, falls back to OpenAlex.
   */
  async search(query: string, limit = 20): Promise<SearchResult> {
    try {
      return await this.searchSemanticScholar(query, limit);
    } catch (err: any) {
      logger.warn(`Semantic Scholar search failed: ${err.message}, trying OpenAlex`);
      try {
        return await this.searchOpenAlex(query, limit);
      } catch (err2: any) {
        logger.error(`All literature APIs failed: ${err2.message}`);
        return { papers: [], total: 0, query };
      }
    }
  }

  private async searchSemanticScholar(query: string, limit: number): Promise<SearchResult> {
    const fields = "paperId,title,abstract,authors,year,citationCount,externalIds";
    const url = `${S2_BASE}/paper/search?query=${encodeURIComponent(query)}&limit=${limit}&fields=${fields}`;
    const headers: Record<string, string> = {};
    if (this.apiKey) headers["x-api-key"] = this.apiKey;

    const response = await this.http.request(url, { headers });
    if (!response.ok) throw new Error(`S2 API ${response.status}`);

    const data = await response.json() as any;
    const papers: Paper[] = (data.data || []).map((p: any) => ({
      id: p.paperId,
      title: p.title || "Untitled",
      abstract: p.abstract || "",
      authors: (p.authors || []).map((a: any) => a.name),
      year: p.year || 0,
      citationCount: p.citationCount || 0,
      doi: p.externalIds?.DOI,
      url: `https://www.semanticscholar.org/paper/${p.paperId}`,
      source: "semantic_scholar" as const,
    }));

    return { papers, total: data.total || papers.length, query };
  }

  private async searchOpenAlex(query: string, limit: number): Promise<SearchResult> {
    const url = `${OPENALEX_BASE}/works?search=${encodeURIComponent(query)}&per_page=${limit}&select=id,title,abstract_inverted_index,authorships,publication_year,cited_by_count,doi`;
    const headers = { "User-Agent": "mailto:epistemon@research.agent" };

    const response = await this.http.request(url, { headers });
    if (!response.ok) throw new Error(`OpenAlex API ${response.status}`);

    const data = await response.json() as any;
    const papers: Paper[] = (data.results || []).map((w: any) => ({
      id: w.id,
      title: w.title || "Untitled",
      abstract: this.reconstructAbstract(w.abstract_inverted_index),
      authors: (w.authorships || []).map((a: any) => a.author?.display_name || "Unknown"),
      year: w.publication_year || 0,
      citationCount: w.cited_by_count || 0,
      doi: w.doi,
      url: w.id,
      source: "openalex" as const,
    }));

    return { papers, total: data.meta?.count || papers.length, query };
  }

  /** Get a single paper by Semantic Scholar ID or DOI. */
  async getPaper(id: string): Promise<Paper | null> {
    const fields = "paperId,title,abstract,authors,year,citationCount,externalIds";
    const url = `${S2_BASE}/paper/${encodeURIComponent(id)}?fields=${fields}`;
    const headers: Record<string, string> = {};
    if (this.apiKey) headers["x-api-key"] = this.apiKey;

    try {
      const response = await this.http.request(url, { headers });
      if (!response.ok) return null;
      const p = await response.json() as any;
      return {
        id: p.paperId,
        title: p.title || "Untitled",
        abstract: p.abstract || "",
        authors: (p.authors || []).map((a: any) => a.name),
        year: p.year || 0,
        citationCount: p.citationCount || 0,
        doi: p.externalIds?.DOI,
        url: `https://www.semanticscholar.org/paper/${p.paperId}`,
        source: "semantic_scholar",
      };
    } catch {
      return null;
    }
  }

  /** Reconstruct abstract from OpenAlex inverted index format. */
  private reconstructAbstract(invertedIndex: Record<string, number[]> | null): string {
    if (!invertedIndex) return "";
    const words: [string, number][] = [];
    for (const [word, positions] of Object.entries(invertedIndex)) {
      for (const pos of positions) {
        words.push([word, pos]);
      }
    }
    words.sort((a, b) => a[1] - b[1]);
    return words.map(([w]) => w).join(" ");
  }
}

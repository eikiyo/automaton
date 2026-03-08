/**
 * Location: src/epistemic/data-sources/imf.ts
 * Purpose: IMF DataMapper API client — 133 indicators, 241 countries, free, no auth
 * Functions: IMFClient.searchIndicators, getIndicatorData, getCountryComparison
 * Calls: IMF DataMapper API (https://www.imf.org/external/datamapper/api/v1/)
 * Imports: ResilientHttpClient
 */

import { ResilientHttpClient } from "../../conway/http-client.js";
import { createLogger } from "../../observability/logger.js";

const logger = createLogger("epistemic.imf");

const IMF_BASE = "https://www.imf.org/external/datamapper/api/v1";

export interface IMFIndicator {
  id: string;
  label: string;
  description: string;
  unit: string;
  dataset: string;
}

export interface IMFDataPoint {
  country: string;
  countryCode: string;
  year: string;
  value: number;
}

const IMF_HEADERS = { "User-Agent": "Epistemon/1.0 (research-agent; epistemon@research.agent)" };

export class IMFClient {
  private http: ResilientHttpClient;
  private indicatorCache: Map<string, IMFIndicator> | null = null;
  private countryCache: Map<string, string> | null = null;

  constructor() {
    this.http = new ResilientHttpClient({
      baseTimeout: 20000,
      maxRetries: 2,
      backoffBase: 2000,
      circuitBreakerThreshold: 5,
      circuitBreakerResetMs: 120000,
    });
  }

  /** Load and cache indicator metadata. */
  private async loadIndicators(): Promise<Map<string, IMFIndicator>> {
    if (this.indicatorCache) return this.indicatorCache;
    try {
      const resp = await this.http.request(`${IMF_BASE}/indicators`, { headers: IMF_HEADERS });
      if (!resp.ok) throw new Error(`IMF API ${resp.status}`);
      const data = await resp.json() as any;
      const indicators = data.indicators || {};
      this.indicatorCache = new Map();
      for (const [id, info] of Object.entries(indicators) as [string, any][]) {
        this.indicatorCache.set(id, {
          id,
          label: info.label || id,
          description: (info.description || "").slice(0, 300),
          unit: info.unit || "",
          dataset: info.dataset || "",
        });
      }
      return this.indicatorCache;
    } catch (err: any) {
      logger.error(`Failed to load IMF indicators: ${err.message}`);
      return new Map();
    }
  }

  /** Load and cache country code → name mapping. */
  private async loadCountries(): Promise<Map<string, string>> {
    if (this.countryCache) return this.countryCache;
    try {
      const resp = await this.http.request(`${IMF_BASE}/countries`, { headers: IMF_HEADERS });
      if (!resp.ok) throw new Error(`IMF API ${resp.status}`);
      const data = await resp.json() as any;
      this.countryCache = new Map();
      for (const [code, info] of Object.entries(data.countries || {}) as [string, any][]) {
        this.countryCache.set(code, info.label || code);
      }
      return this.countryCache;
    } catch (err: any) {
      logger.error(`Failed to load IMF countries: ${err.message}`);
      return new Map();
    }
  }

  /**
   * Search indicators by keyword.
   * Filters the full indicator list by matching label/description.
   */
  async searchIndicators(query: string, limit = 15): Promise<IMFIndicator[]> {
    const indicators = await this.loadIndicators();
    const q = query.toLowerCase();
    const matches: IMFIndicator[] = [];
    for (const ind of indicators.values()) {
      if (
        ind.label.toLowerCase().includes(q) ||
        ind.description.toLowerCase().includes(q) ||
        ind.id.toLowerCase().includes(q)
      ) {
        matches.push(ind);
        if (matches.length >= limit) break;
      }
    }
    return matches;
  }

  /**
   * Get data for a specific indicator across countries and years.
   * @param indicatorId e.g. "NGDP_RPCH" (Real GDP growth)
   * @param countryCodes ISO3 codes e.g. ["USA","CHN","DEU"]. Empty = all.
   * @param years e.g. [2018,2019,2020,2021,2022]
   */
  async getIndicatorData(
    indicatorId: string,
    countryCodes: string[] = [],
    startYear = 2015,
    endYear = 2023,
  ): Promise<IMFDataPoint[]> {
    const years = [];
    for (let y = startYear; y <= endYear; y++) years.push(String(y));
    const periodsParam = years.join(",");

    const url = `${IMF_BASE}/${encodeURIComponent(indicatorId)}?periods=${periodsParam}`;

    try {
      const resp = await this.http.request(url, { headers: IMF_HEADERS });
      if (!resp.ok) throw new Error(`IMF API ${resp.status}`);

      const data = await resp.json() as any;
      const values = data.values?.[indicatorId] || {};
      const countries = await this.loadCountries();

      const results: IMFDataPoint[] = [];
      for (const [code, yearData] of Object.entries(values) as [string, any][]) {
        // Filter to requested countries if specified
        if (countryCodes.length > 0 && !countryCodes.includes(code)) continue;
        for (const [year, value] of Object.entries(yearData)) {
          if (typeof value === "number") {
            results.push({
              country: countries.get(code) || code,
              countryCode: code,
              year,
              value,
            });
          }
        }
      }

      // Sort by country then year
      results.sort((a, b) => a.countryCode.localeCompare(b.countryCode) || a.year.localeCompare(b.year));
      return results;
    } catch (err: any) {
      logger.error(`IMF data fetch failed: ${err.message}`);
      return [];
    }
  }

  /** Key macroeconomic indicators for a set of countries. */
  static readonly KEY_INDICATORS = [
    { id: "NGDP_RPCH", label: "Real GDP growth (%)" },
    { id: "NGDPD", label: "GDP (USD billions)" },
    { id: "PCPIPCH", label: "Inflation (%)" },
    { id: "BCA", label: "Current account (USD bn)" },
    { id: "LUR", label: "Unemployment (%)" },
    { id: "GGXWDG_NGDP", label: "Govt debt (% GDP)" },
  ];
}

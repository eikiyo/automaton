/**
 * Location: src/epistemic/data-sources/world-bank.ts
 * Purpose: World Bank Open Data API client — 16,000+ indicators, 200+ countries, free, no auth
 * Functions: WorldBankClient.searchIndicators, getIndicatorData, getCountryProfile
 * Calls: World Bank API v2 (https://api.worldbank.org/v2/)
 * Imports: ResilientHttpClient
 */

import { ResilientHttpClient } from "../../conway/http-client.js";
import { createLogger } from "../../observability/logger.js";

const logger = createLogger("epistemic.worldbank");

const WB_BASE = "https://api.worldbank.org/v2";

export interface WBIndicator {
  id: string;
  name: string;
  sourceNote: string;
}

export interface WBDataPoint {
  country: string;
  countryCode: string;
  year: number;
  value: number | null;
  indicator: string;
  indicatorName: string;
}

export interface WBSearchResult {
  indicators: WBIndicator[];
  total: number;
  query: string;
}

export interface WBDataResult {
  data: WBDataPoint[];
  indicator: string;
  countries: string[];
  yearRange: string;
}

export class WorldBankClient {
  private http: ResilientHttpClient;

  constructor() {
    this.http = new ResilientHttpClient({
      baseTimeout: 30000,
      maxRetries: 2,
      backoffBase: 2000,
      circuitBreakerThreshold: 5,
      circuitBreakerResetMs: 120000,
    });
  }

  /**
   * Search for indicators by keyword.
   * Example: "GDP per capita", "FDI inflows", "trade openness"
   */
  async searchIndicators(query: string, limit = 15): Promise<WBSearchResult> {
    const url = `${WB_BASE}/indicator?format=json&per_page=${limit}&source=2&search=${encodeURIComponent(query)}`;
    try {
      const resp = await this.http.request(url, {});
      if (!resp.ok) throw new Error(`World Bank API ${resp.status}`);

      const data = await resp.json() as any[];
      if (!data || data.length < 2) return { indicators: [], total: 0, query };

      const meta = data[0];
      const indicators: WBIndicator[] = (data[1] || []).map((ind: any) => ({
        id: ind.id,
        name: ind.name,
        sourceNote: (ind.sourceNote || "").slice(0, 200),
      }));

      return { indicators, total: meta?.total || indicators.length, query };
    } catch (err: any) {
      logger.error(`World Bank indicator search failed: ${err.message}`);
      return { indicators: [], total: 0, query };
    }
  }

  /**
   * Get data for a specific indicator across countries and years.
   * @param indicatorId e.g. "NY.GDP.PCAP.CD" (GDP per capita)
   * @param countries ISO2 codes, e.g. ["US","CN","DE"] or ["all"] for top results
   * @param startYear e.g. 2015
   * @param endYear e.g. 2023
   */
  async getIndicatorData(
    indicatorId: string,
    countries: string[] = ["all"],
    startYear = 2015,
    endYear = 2023,
  ): Promise<WBDataResult> {
    const isAll = countries.includes("all");
    const countryParam = isAll ? "all" : countries.join(";");
    // Limit per_page: all-country queries can return thousands of rows
    const perPage = isAll ? 200 : 500;
    const url = `${WB_BASE}/country/${countryParam}/indicator/${encodeURIComponent(indicatorId)}?format=json&date=${startYear}:${endYear}&per_page=${perPage}`;

    try {
      const resp = await this.http.request(url, {});
      if (!resp.ok) throw new Error(`World Bank API ${resp.status}`);

      const raw = await resp.json() as any[];
      if (!raw || raw.length < 2) {
        return { data: [], indicator: indicatorId, countries, yearRange: `${startYear}-${endYear}` };
      }

      const points: WBDataPoint[] = (raw[1] || [])
        .filter((d: any) => d.value !== null)
        .map((d: any) => ({
          country: d.country?.value || "Unknown",
          countryCode: d.countryiso3code || d.country?.id || "",
          year: parseInt(d.date, 10),
          value: d.value,
          indicator: d.indicator?.id || indicatorId,
          indicatorName: d.indicator?.value || "",
        }));

      return {
        data: points,
        indicator: indicatorId,
        countries,
        yearRange: `${startYear}-${endYear}`,
      };
    } catch (err: any) {
      logger.error(`World Bank data fetch failed: ${err.message}`);
      return { data: [], indicator: indicatorId, countries, yearRange: `${startYear}-${endYear}` };
    }
  }

  /**
   * Key indicators for quick country comparison.
   * Returns GDP, FDI, trade, internet users for given countries.
   */
  async getCountrySnapshot(countryCodes: string[], year = 2022): Promise<string> {
    const indicators = [
      { id: "NY.GDP.PCAP.CD", label: "GDP/capita (USD)" },
      { id: "BX.KLT.DINV.WD.GD.ZS", label: "FDI net inflows (% GDP)" },
      { id: "NE.TRD.GNFS.ZS", label: "Trade (% GDP)" },
      { id: "IT.NET.USER.ZS", label: "Internet users (%)" },
    ];

    const lines: string[] = [];
    for (const ind of indicators) {
      const result = await this.getIndicatorData(ind.id, countryCodes, year, year);
      if (result.data.length > 0) {
        const entries = result.data.map(d =>
          `${d.country}: ${typeof d.value === "number" ? d.value.toFixed(2) : "N/A"}`
        );
        lines.push(`${ind.label}: ${entries.join(" | ")}`);
      }
    }

    return lines.length > 0
      ? lines.join("\n")
      : `No data available for ${countryCodes.join(", ")} in ${year}`;
  }
}

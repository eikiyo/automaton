/**
 * Location: src/epistemic/data-sources/fred.ts
 * Purpose: FRED (Federal Reserve Economic Data) API client — 816,000+ time series, free with key
 * Functions: FREDClient.searchSeries, getSeriesData, getSeriesInfo
 * Calls: FRED API (https://api.stlouisfed.org/fred/)
 * Imports: ResilientHttpClient
 */

import { ResilientHttpClient } from "../../conway/http-client.js";
import { createLogger } from "../../observability/logger.js";

const logger = createLogger("epistemic.fred");

const FRED_BASE = "https://api.stlouisfed.org/fred";

export interface FREDSeries {
  id: string;
  title: string;
  frequency: string;
  units: string;
  seasonalAdjustment: string;
  lastUpdated: string;
  notes: string;
}

export interface FREDObservation {
  date: string;
  value: number | null;
}

export interface FREDSearchResult {
  series: FREDSeries[];
  total: number;
  query: string;
}

export interface FREDDataResult {
  seriesId: string;
  title: string;
  units: string;
  observations: FREDObservation[];
}

export class FREDClient {
  private http: ResilientHttpClient;
  private apiKey: string;

  constructor(apiKey: string) {
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
   * Search for economic data series by keyword.
   * Example: "inflation rate", "unemployment", "trade balance", "interest rate"
   */
  async searchSeries(query: string, limit = 10): Promise<FREDSearchResult> {
    const url = `${FRED_BASE}/series/search?search_text=${encodeURIComponent(query)}&limit=${limit}&api_key=${this.apiKey}&file_type=json&order_by=popularity&sort_order=desc`;

    try {
      const resp = await this.http.request(url, {});
      if (!resp.ok) throw new Error(`FRED API ${resp.status}`);

      const data = await resp.json() as any;
      const series: FREDSeries[] = (data.seriess || []).map((s: any) => ({
        id: s.id,
        title: s.title,
        frequency: s.frequency || "",
        units: s.units || "",
        seasonalAdjustment: s.seasonal_adjustment || "",
        lastUpdated: s.last_updated || "",
        notes: (s.notes || "").slice(0, 200),
      }));

      return { series, total: data.count || series.length, query };
    } catch (err: any) {
      logger.error(`FRED search failed: ${err.message}`);
      return { series: [], total: 0, query };
    }
  }

  /**
   * Get observation data for a specific series.
   * @param seriesId e.g. "GDP", "UNRATE", "FEDFUNDS"
   * @param startDate e.g. "2015-01-01"
   * @param endDate e.g. "2023-12-31"
   */
  async getSeriesData(
    seriesId: string,
    startDate = "2015-01-01",
    endDate = "2023-12-31",
  ): Promise<FREDDataResult> {
    // Get series info and observations in parallel
    const infoUrl = `${FRED_BASE}/series?series_id=${encodeURIComponent(seriesId)}&api_key=${this.apiKey}&file_type=json`;
    const obsUrl = `${FRED_BASE}/series/observations?series_id=${encodeURIComponent(seriesId)}&observation_start=${startDate}&observation_end=${endDate}&api_key=${this.apiKey}&file_type=json`;

    try {
      const [infoResp, obsResp] = await Promise.all([
        this.http.request(infoUrl, {}),
        this.http.request(obsUrl, {}),
      ]);

      let title = seriesId;
      let units = "";
      if (infoResp.ok) {
        const infoData = await infoResp.json() as any;
        const s = infoData.seriess?.[0];
        if (s) {
          title = s.title || seriesId;
          units = s.units || "";
        }
      }

      const observations: FREDObservation[] = [];
      if (obsResp.ok) {
        const obsData = await obsResp.json() as any;
        for (const obs of obsData.observations || []) {
          const val = obs.value === "." ? null : parseFloat(obs.value);
          observations.push({ date: obs.date, value: isNaN(val as number) ? null : val });
        }
      }

      return { seriesId, title, units, observations };
    } catch (err: any) {
      logger.error(`FRED data fetch failed: ${err.message}`);
      return { seriesId, title: seriesId, units: "", observations: [] };
    }
  }

  /**
   * Format series data as a readable summary with basic statistics.
   */
  formatSummary(result: FREDDataResult): string {
    const validObs = result.observations.filter(o => o.value !== null);
    if (validObs.length === 0) {
      return `${result.title} (${result.seriesId}): No data available`;
    }

    const values = validObs.map(o => o.value as number);
    const latest = validObs[validObs.length - 1];
    const earliest = validObs[0];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;

    const lines = [
      `${result.title} (${result.seriesId})`,
      `Units: ${result.units}`,
      `Period: ${earliest.date} to ${latest.date} (${validObs.length} observations)`,
      `Latest: ${latest.value} (${latest.date})`,
      `Range: ${min.toFixed(2)} — ${max.toFixed(2)}`,
      `Average: ${avg.toFixed(2)}`,
    ];

    // Show last 5 data points
    const recent = validObs.slice(-5);
    lines.push(`Recent values: ${recent.map(o => `${o.date}=${o.value}`).join(", ")}`);

    return lines.join("\n");
  }
}

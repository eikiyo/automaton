/**
 * Location: src/epistemic/data-sources/comtrade.ts
 * Purpose: UN Comtrade API client — bilateral trade flows between all countries, free preview endpoint
 * Functions: ComtradeClient.getTradeData, getTopPartners, getBilateralTrade
 * Calls: UN Comtrade API v1 (https://comtradeapi.un.org/public/v1/preview/)
 * Imports: ResilientHttpClient
 */

import { ResilientHttpClient } from "../../conway/http-client.js";
import { createLogger } from "../../observability/logger.js";

const logger = createLogger("epistemic.comtrade");

const COMTRADE_BASE = "https://comtradeapi.un.org/public/v1/preview/C/A/HS";

/** ISO3 → Comtrade numeric reporter code (top 30 economies) */
const COUNTRY_CODES: Record<string, { code: number; name: string }> = {
  USA: { code: 842, name: "United States" },
  CHN: { code: 156, name: "China" },
  DEU: { code: 276, name: "Germany" },
  JPN: { code: 392, name: "Japan" },
  GBR: { code: 826, name: "United Kingdom" },
  FRA: { code: 250, name: "France" },
  IND: { code: 356, name: "India" },
  ITA: { code: 380, name: "Italy" },
  CAN: { code: 124, name: "Canada" },
  KOR: { code: 410, name: "South Korea" },
  BRA: { code: 76, name: "Brazil" },
  AUS: { code: 36, name: "Australia" },
  MEX: { code: 484, name: "Mexico" },
  NLD: { code: 528, name: "Netherlands" },
  CHE: { code: 756, name: "Switzerland" },
  SGP: { code: 702, name: "Singapore" },
  ARE: { code: 784, name: "UAE" },
  SAU: { code: 682, name: "Saudi Arabia" },
  IDN: { code: 360, name: "Indonesia" },
  TUR: { code: 792, name: "Turkey" },
  ZAF: { code: 710, name: "South Africa" },
  RUS: { code: 643, name: "Russia" },
  NGA: { code: 566, name: "Nigeria" },
  SWE: { code: 752, name: "Sweden" },
  NOR: { code: 578, name: "Norway" },
  POL: { code: 616, name: "Poland" },
  ESP: { code: 724, name: "Spain" },
  THA: { code: 764, name: "Thailand" },
  VNM: { code: 704, name: "Vietnam" },
  MYS: { code: 458, name: "Malaysia" },
};

const FLOW_NAMES: Record<string, string> = { X: "Exports", M: "Imports", RX: "Re-exports", RM: "Re-imports" };

export interface TradeRecord {
  reporter: string;
  reporterCode: string;
  partner: string;
  partnerCode: number;
  flow: string;
  year: number;
  valueFOB: number | null;
  valueCIF: number | null;
  primaryValue: number;
  commodity: string;
}

export class ComtradeClient {
  private http: ResilientHttpClient;

  constructor() {
    this.http = new ResilientHttpClient({
      baseTimeout: 30000,
      maxRetries: 2,
      backoffBase: 3000,
      circuitBreakerThreshold: 5,
      circuitBreakerResetMs: 120000,
    });
  }

  private resolveCountryCode(iso3: string): number | null {
    return COUNTRY_CODES[iso3.toUpperCase()]?.code || null;
  }

  private resolveCountryName(code: number): string {
    for (const [, info] of Object.entries(COUNTRY_CODES)) {
      if (info.code === code) return info.name;
    }
    return `Country(${code})`;
  }

  /**
   * Get bilateral trade data.
   * @param reporter ISO3 code of reporting country (e.g. "USA")
   * @param partners ISO3 codes of partner countries. Empty = world total.
   * @param flow "X" (exports), "M" (imports), or "X,M" (both)
   * @param year e.g. 2022
   * @param commodity HS code or "TOTAL" for aggregate
   */
  async getTradeData(
    reporter: string,
    partners: string[] = [],
    flow = "X,M",
    year = 2022,
    commodity = "TOTAL",
  ): Promise<TradeRecord[]> {
    const reporterCode = this.resolveCountryCode(reporter);
    if (!reporterCode) return [];

    const partnerCodes = partners.length > 0
      ? partners.map(p => this.resolveCountryCode(p)).filter(Boolean).join(",")
      : "0"; // 0 = World

    const url = `${COMTRADE_BASE}?reporterCode=${reporterCode}&period=${year}&partnerCode=${partnerCodes}&flowCode=${flow}&cmdCode=${commodity}`;

    try {
      const resp = await this.http.request(url, {
        headers: { "User-Agent": "Epistemon/1.0 (research-agent)" },
      });
      if (!resp.ok) throw new Error(`Comtrade API ${resp.status}`);

      const data = await resp.json() as any;
      const records: TradeRecord[] = (data.data || []).map((r: any) => ({
        reporter: this.resolveCountryName(r.reporterCode) || r.reporterDesc || reporter,
        reporterCode: reporter,
        partner: this.resolveCountryName(r.partnerCode) || r.partnerDesc || `Partner(${r.partnerCode})`,
        partnerCode: r.partnerCode,
        flow: FLOW_NAMES[r.flowCode] || r.flowDesc || r.flowCode,
        year: r.refYear,
        valueFOB: r.fobvalue,
        valueCIF: r.cifvalue,
        primaryValue: r.primaryValue || 0,
        commodity: r.cmdDesc || r.cmdCode || commodity,
      }));

      return records;
    } catch (err: any) {
      logger.error(`Comtrade fetch failed: ${err.message}`);
      return [];
    }
  }

  /** Format trade value in billions for readability. */
  static formatValue(value: number): string {
    if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
    if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
    if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
    return `$${value.toLocaleString()}`;
  }

  /** List available country codes for the agent. */
  static listCountries(): string {
    return Object.entries(COUNTRY_CODES)
      .map(([iso, info]) => `${iso} — ${info.name}`)
      .join("\n");
  }
}

/**
 * Location: src/epistemic/data-sources/eurostat.ts
 * Purpose: Eurostat API client — EU economic, trade, and digital economy statistics
 * Functions: EurostatClient.getData, searchDatasets
 * Calls: Eurostat JSON API (https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/)
 * Imports: ResilientHttpClient
 */

import { ResilientHttpClient } from "../../conway/http-client.js";
import { createLogger } from "../../observability/logger.js";

const logger = createLogger("epistemic.eurostat");

const EUROSTAT_BASE = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data";

/** Curated datasets that reliably return data for EU research. */
const CURATED_DATASETS: Record<string, { code: string; name: string; description: string; fixedParams: string }> = {
  gdp: {
    code: "nama_10_gdp",
    name: "GDP and main components",
    description: "GDP at current and constant prices for EU countries",
    fixedParams: "unit=CP_MEUR&na_item=B1GQ",
  },
  gdp_per_capita: {
    code: "nama_10_pc",
    name: "GDP per capita",
    description: "GDP per capita in PPS (purchasing power standards)",
    fixedParams: "unit=CP_EUR_HAB&na_item=B1GQ",
  },
  trade_goods: {
    code: "ext_tec01",
    name: "Extra-EU trade by partner",
    description: "EU trade in goods with non-EU partners",
    fixedParams: "sitc06=TOTAL&stk_flow=BAL&unit=MIO_EUR",
  },
  trade_services: {
    code: "bop_its6_det",
    name: "International trade in services",
    description: "EU trade in services by partner and service type",
    fixedParams: "bop_item=S&stk_flow=BAL&currency=MIO_EUR",
  },
  fdi_positions: {
    code: "bop_fdi6_pos",
    name: "FDI positions",
    description: "Foreign direct investment positions by partner country",
    fixedParams: "currency=MIO_EUR&stk_flow=NET&bop_item=T_FA_F",
  },
  inflation: {
    code: "prc_hicp_aind",
    name: "HICP - annual average inflation",
    description: "Harmonised consumer price index, annual average rate of change",
    fixedParams: "unit=RCH_A_AVG&coicop=CP00",
  },
  unemployment: {
    code: "une_rt_a",
    name: "Unemployment rate - annual",
    description: "Annual unemployment rate by sex and age",
    fixedParams: "unit=PC_ACT&sex=T&age=Y15-74",
  },
  ict_enterprises: {
    code: "isoc_eb_ics",
    name: "ICT usage in enterprises",
    description: "Enterprises using cloud computing, big data, AI",
    fixedParams: "unit=PC_ENT&sizen_r2=10_C10_S951_XK",
  },
  internet_use: {
    code: "isoc_ci_ifp_iu",
    name: "Internet use by individuals",
    description: "Percentage of individuals using the internet",
    fixedParams: "unit=PC_IND&ind_type=IND_TOTAL",
  },
  ecommerce: {
    code: "isoc_ec_ibuy",
    name: "E-commerce by individuals",
    description: "Percentage of individuals who ordered online",
    fixedParams: "unit=PC_IND&ind_type=IND_TOTAL",
  },
};

const EU_COUNTRIES = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "EL", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"];

export interface EurostatDataPoint {
  country: string;
  countryCode: string;
  year: string;
  value: number;
}

export class EurostatClient {
  private http: ResilientHttpClient;

  constructor() {
    this.http = new ResilientHttpClient({
      baseTimeout: 20000,
      maxRetries: 2,
      backoffBase: 2000,
      circuitBreakerThreshold: 5,
      circuitBreakerResetMs: 120000,
    });
  }

  /** List curated datasets. */
  listDatasets(): { id: string; name: string; description: string }[] {
    return Object.entries(CURATED_DATASETS).map(([id, ds]) => ({
      id, name: ds.name, description: ds.description,
    }));
  }

  /**
   * Get data for a curated dataset.
   * @param datasetKey Key from CURATED_DATASETS
   * @param countries Eurostat geo codes (e.g. ["DE","FR","NL"]). Empty = major EU countries.
   * @param years e.g. ["2020","2021","2022"]
   */
  async getData(
    datasetKey: string,
    countries: string[] = [],
    startYear = 2018,
    endYear = 2023,
  ): Promise<EurostatDataPoint[]> {
    const ds = CURATED_DATASETS[datasetKey];
    if (!ds) return [];

    const geos = countries.length > 0 ? countries : ["DE", "FR", "IT", "ES", "NL", "SE", "PL", "IE"];
    const geoParam = geos.map(g => `geo=${g}`).join("&");
    const years = [];
    for (let y = startYear; y <= endYear; y++) years.push(y);
    const timeParam = years.map(y => `time=${y}`).join("&");

    const url = `${EUROSTAT_BASE}/${ds.code}?${geoParam}&${timeParam}&freq=A&${ds.fixedParams}&lang=en`;

    try {
      const resp = await this.http.request(url, {
        headers: { "User-Agent": "Epistemon/1.0" },
      });
      if (!resp.ok) throw new Error(`Eurostat API ${resp.status}`);

      const data = await resp.json() as any;
      const values = data.value || {};
      const dims = data.dimension || {};

      // Build index mappings
      const geoIdx = dims.geo?.category?.index || {};
      const geoLabels = dims.geo?.category?.label || {};
      const timeIdx = dims.time?.category?.index || {};

      // Calculate dimension sizes for index computation
      const dimOrder = data.id || Object.keys(dims);
      const dimSizes: number[] = dimOrder.map((d: string) =>
        Object.keys(dims[d]?.category?.index || {}).length
      );

      const geoPos = dimOrder.indexOf("geo");
      const timePos = dimOrder.indexOf("time");

      const idxToGeo: Record<number, string> = {};
      for (const [code, idx] of Object.entries(geoIdx)) idxToGeo[idx as number] = code;
      const idxToTime: Record<number, string> = {};
      for (const [yr, idx] of Object.entries(timeIdx)) idxToTime[idx as number] = yr;

      const results: EurostatDataPoint[] = [];
      for (const [flatIdx, value] of Object.entries(values)) {
        // Decompose flat index into per-dimension indices
        let remaining = parseInt(flatIdx, 10);
        const indices: number[] = [];
        for (let i = dimSizes.length - 1; i >= 0; i--) {
          indices.unshift(remaining % dimSizes[i]);
          remaining = Math.floor(remaining / dimSizes[i]);
        }

        const geoCode = idxToGeo[indices[geoPos]] || "?";
        const year = idxToTime[indices[timePos]] || "?";

        results.push({
          country: geoLabels[geoCode] || geoCode,
          countryCode: geoCode,
          year,
          value: value as number,
        });
      }

      results.sort((a, b) => a.countryCode.localeCompare(b.countryCode) || a.year.localeCompare(b.year));
      return results;
    } catch (err: any) {
      logger.error(`Eurostat fetch failed: ${err.message}`);
      return [];
    }
  }
}

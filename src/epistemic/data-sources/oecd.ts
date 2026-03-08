/**
 * Location: src/epistemic/data-sources/oecd.ts
 * Purpose: OECD Data client — curated access to FDI, trade, digital economy, STRI datasets
 * Functions: OECDClient.searchDataflows, queryData, getDigitalSTRI
 * Calls: OECD SDMX REST API (https://sdmx.oecd.org/public/rest/)
 * Imports: ResilientHttpClient
 */

import { ResilientHttpClient } from "../../conway/http-client.js";
import { createLogger } from "../../observability/logger.js";

const logger = createLogger("epistemic.oecd");

const OECD_BASE = "https://sdmx.oecd.org/public/rest";

export interface OECDDataflow {
  id: string;
  agencyId: string;
  name: string;
  dsdRef: string;
}

export interface OECDObservation {
  dimensions: Record<string, string>;
  value: number;
  period: string;
}

/**
 * Curated OECD datasets most relevant for international business research.
 * Each entry has the full agency/dataflow path and a simplified description.
 */
const CURATED_DATASETS: Record<string, { agency: string; dsd: string; flow: string; name: string; description: string }> = {
  "fdi_flows": {
    agency: "OECD.DAF.INV",
    dsd: "DSD_FDI",
    flow: "DF_FDI_FLOW_AGGR",
    name: "FDI Flows (main aggregates)",
    description: "Foreign Direct Investment inflows and outflows by country, BMD4 methodology",
  },
  "fdi_positions": {
    agency: "OECD.DAF.INV",
    dsd: "DSD_FDI",
    flow: "DF_FDI_POS_AGGR",
    name: "FDI Positions (main aggregates)",
    description: "FDI stock positions by country",
  },
  "fdi_restrictiveness": {
    agency: "OECD.DAF.INV",
    dsd: "DSD_FDIRRI_SCORES",
    flow: "DF_FDIRRI_SCORES",
    name: "FDI Regulatory Restrictiveness Index",
    description: "Measures statutory restrictions on FDI across 22 economic sectors in 70+ countries",
  },
  "stri": {
    agency: "OECD.TAD.TPD",
    dsd: "DSD_STRI",
    flow: "DF_STRI_MAIN",
    name: "Services Trade Restrictiveness Index",
    description: "Quantifies barriers to services trade across 22 sectors in 50 countries",
  },
  "digital_stri": {
    agency: "OECD.TAD.TPD",
    dsd: "DSD_STRI",
    flow: "DF_STRI_DIGITAL",
    name: "Digital Services Trade Restrictiveness Index",
    description: "Measures barriers to digitally-enabled services trade — directly relevant to data sovereignty",
  },
  "digital_trade": {
    agency: "OECD.STI.DEP",
    dsd: "DSD_DIGITAL_TRADE",
    flow: "DF_DIGITAL_TRADE",
    name: "Digital Trade (experimental estimates)",
    description: "Experimental estimates of digital trade volumes by country and partner",
  },
  "trade_services": {
    agency: "OECD.SDD.TPS",
    dsd: "DSD_BOP",
    flow: "DF_TIS",
    name: "International Trade in Services",
    description: "Balance of payments trade in services data",
  },
  "trade_goods": {
    agency: "OECD.SDD.TPS",
    dsd: "DSD_IMTS",
    flow: "DF_IMTS",
    name: "International Merchandise Trade Statistics",
    description: "Trade in goods by country and commodity",
  },
  "indigo": {
    agency: "OECD.TAD.TPD",
    dsd: "DSD_INDIGO",
    flow: "DF_INDIGO",
    name: "Digital Trade Integration and Openness Index",
    description: "Composite index measuring how open countries are to digital trade",
  },
};

export class OECDClient {
  private http: ResilientHttpClient;
  private dataflowCache: OECDDataflow[] | null = null;

  constructor() {
    this.http = new ResilientHttpClient({
      baseTimeout: 30000,
      maxRetries: 2,
      backoffBase: 3000,
      circuitBreakerThreshold: 5,
      circuitBreakerResetMs: 120000,
    });
  }

  /** List curated datasets available for research. */
  listCuratedDatasets(): { id: string; name: string; description: string }[] {
    return Object.entries(CURATED_DATASETS).map(([id, ds]) => ({
      id,
      name: ds.name,
      description: ds.description,
    }));
  }

  /**
   * Search all OECD dataflows by keyword (searches 1,475+ datasets).
   * Caches the full list on first call.
   */
  async searchDataflows(query: string, limit = 10): Promise<OECDDataflow[]> {
    if (!this.dataflowCache) {
      try {
        const resp = await this.http.request(
          `${OECD_BASE}/dataflow/*`,
          { headers: { Accept: "application/vnd.sdmx.structure+json", "User-Agent": "Epistemon/1.0" } },
        );
        if (!resp.ok) throw new Error(`OECD API ${resp.status}`);
        const data = await resp.json() as any;
        const flows = data.data?.dataflows || [];
        this.dataflowCache = flows.map((f: any) => ({
          id: f.id || "",
          agencyId: f.agencyID || "",
          name: typeof f.name === "string" ? f.name : (f.name?.en || ""),
          dsdRef: `${f.agencyID}/${f.id}`,
        }));
      } catch (err: any) {
        logger.error(`OECD dataflow search failed: ${err.message}`);
        return [];
      }
    }

    const q = query.toLowerCase();
    return (this.dataflowCache || [])
      .filter(f => f.name.toLowerCase().includes(q) || f.id.toLowerCase().includes(q))
      .slice(0, limit);
  }

  /**
   * Get the dimension structure for a dataset (needed to build proper queries).
   */
  async getDatasetStructure(datasetKey: string): Promise<{ dimensions: { id: string; position: number; values: { id: string; name: string }[] }[] } | null> {
    const ds = CURATED_DATASETS[datasetKey];
    if (!ds) return null;

    try {
      const resp = await this.http.request(
        `${OECD_BASE}/datastructure/${ds.agency}/${ds.dsd}`,
        { headers: { Accept: "application/vnd.sdmx.structure+json", "User-Agent": "Epistemon/1.0" } },
      );
      if (!resp.ok) return null;
      const data = await resp.json() as any;
      const dsds = data.data?.dataStructures || [];
      if (dsds.length === 0) return null;

      const dims = dsds[0].dataStructureComponents?.dimensionList?.dimensions || [];
      return {
        dimensions: dims.map((dim: any) => {
          const localRep = dim.localRepresentation?.enumeration;
          // Values may be embedded or require codelist lookup
          const values: { id: string; name: string }[] = [];
          return {
            id: dim.id,
            position: dim.position,
            values,
          };
        }),
      };
    } catch (err: any) {
      logger.error(`OECD structure fetch failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Query a curated dataset with wildcarded dimensions.
   * @param datasetKey Key from CURATED_DATASETS (e.g. "fdi_restrictiveness")
   * @param countries ISO3 country codes to filter (e.g. ["USA","DEU"])
   * @param startPeriod e.g. "2018"
   * @param endPeriod e.g. "2023"
   */
  async queryData(
    datasetKey: string,
    countries: string[] = [],
    startPeriod = "2018",
    endPeriod = "2023",
  ): Promise<{ observations: number; data: Record<string, any>[]; raw?: string }> {
    const ds = CURATED_DATASETS[datasetKey];
    if (!ds) {
      return { observations: 0, data: [], raw: `Unknown dataset: ${datasetKey}. Available: ${Object.keys(CURATED_DATASETS).join(", ")}` };
    }

    // Get structure to know how many dimensions
    const structure = await this.getDatasetStructure(datasetKey);
    if (!structure) {
      return { observations: 0, data: [], raw: "Could not fetch dataset structure" };
    }

    // Build key: put countries in REF_AREA dimension, wildcard everything else
    const dimCount = structure.dimensions.length;
    const keyParts = new Array(dimCount).fill("");

    // Find REF_AREA dimension and set country filter
    for (const dim of structure.dimensions) {
      if (dim.id === "REF_AREA" && countries.length > 0) {
        keyParts[dim.position] = countries.join("+");
      }
    }

    const key = keyParts.join(".");
    const url = `${OECD_BASE}/data/${ds.agency},${ds.dsd}@${ds.flow},/${key}?startPeriod=${startPeriod}&endPeriod=${endPeriod}&dimensionAtObservation=AllDimensions`;

    try {
      const resp = await this.http.request(url, {
        headers: { Accept: "application/vnd.sdmx.data+json", "User-Agent": "Epistemon/1.0" },
      });

      if (!resp.ok) {
        const text = await resp.text();
        return { observations: 0, data: [], raw: `OECD API ${resp.status}: ${text.slice(0, 200)}` };
      }

      const result = await resp.json() as any;
      const dataSets = result.data?.dataSets || [];
      if (dataSets.length === 0) {
        return { observations: 0, data: [] };
      }

      const obs = dataSets[0].observations || {};
      const dimDefs = result.data?.structure?.dimensions?.observation || [];

      // Parse observations into readable format
      const parsed: Record<string, any>[] = [];
      for (const [key, val] of Object.entries(obs) as [string, any][]) {
        const indices = key.split(":");
        const record: Record<string, any> = { value: val[0] };
        for (let i = 0; i < indices.length && i < dimDefs.length; i++) {
          const dimValues = dimDefs[i].values || [];
          const idx = parseInt(indices[i], 10);
          if (idx < dimValues.length) {
            record[dimDefs[i].id] = dimValues[idx].id;
            if (dimDefs[i].id === "REF_AREA") {
              record.country_name = dimValues[idx].name || dimValues[idx].id;
            }
          }
        }
        parsed.push(record);
      }

      return { observations: parsed.length, data: parsed };
    } catch (err: any) {
      logger.error(`OECD data fetch failed: ${err.message}`);
      return { observations: 0, data: [], raw: err.message };
    }
  }
}

/**
 * Location: src/epistemic/data-sources/rest-countries.ts
 * Purpose: REST Countries API client — country metadata for cross-referencing in research
 * Functions: RestCountriesClient.getCountries, getByRegion
 * Calls: REST Countries API v3.1 (https://restcountries.com/v3.1/)
 * Imports: ResilientHttpClient
 */

import { ResilientHttpClient } from "../../conway/http-client.js";
import { createLogger } from "../../observability/logger.js";

const logger = createLogger("epistemic.restcountries");

const RC_BASE = "https://restcountries.com/v3.1";

export interface CountryInfo {
  name: string;
  iso2: string;
  iso3: string;
  region: string;
  subregion: string;
  population: number;
  gini: Record<string, number>;
  currencies: string[];
  languages: string[];
  borders: string[];
  capital: string;
}

export class RestCountriesClient {
  private http: ResilientHttpClient;

  constructor() {
    this.http = new ResilientHttpClient({
      baseTimeout: 10000,
      maxRetries: 2,
      backoffBase: 1000,
      circuitBreakerThreshold: 5,
      circuitBreakerResetMs: 60000,
    });
  }

  /**
   * Get metadata for specific countries by ISO code.
   * @param codes ISO2 or ISO3 codes e.g. ["USA","CHN","DEU"]
   */
  async getCountries(codes: string[]): Promise<CountryInfo[]> {
    const url = `${RC_BASE}/alpha?codes=${codes.join(",")}&fields=name,cca2,cca3,region,subregion,population,gini,currencies,languages,borders,capital`;
    try {
      const resp = await this.http.request(url, {});
      if (!resp.ok) throw new Error(`REST Countries ${resp.status}`);
      const data = await resp.json() as any[];
      return data.map(this.mapCountry);
    } catch (err: any) {
      logger.error(`REST Countries fetch failed: ${err.message}`);
      return [];
    }
  }

  /**
   * Get all countries in a region.
   * @param region "Africa", "Americas", "Asia", "Europe", "Oceania"
   */
  async getByRegion(region: string): Promise<CountryInfo[]> {
    const url = `${RC_BASE}/region/${encodeURIComponent(region)}?fields=name,cca2,cca3,region,subregion,population,gini,currencies,languages,borders,capital`;
    try {
      const resp = await this.http.request(url, {});
      if (!resp.ok) throw new Error(`REST Countries ${resp.status}`);
      const data = await resp.json() as any[];
      return data.map(this.mapCountry).sort((a, b) => b.population - a.population);
    } catch (err: any) {
      logger.error(`REST Countries region fetch failed: ${err.message}`);
      return [];
    }
  }

  private mapCountry(c: any): CountryInfo {
    return {
      name: c.name?.common || "Unknown",
      iso2: c.cca2 || "",
      iso3: c.cca3 || "",
      region: c.region || "",
      subregion: c.subregion || "",
      population: c.population || 0,
      gini: c.gini || {},
      currencies: Object.keys(c.currencies || {}),
      languages: Object.values(c.languages || {}) as string[],
      borders: c.borders || [],
      capital: (c.capital || [])[0] || "",
    };
  }
}

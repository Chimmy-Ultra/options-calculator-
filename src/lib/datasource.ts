import type { ChainRow, ExpiryDef, QuoteSnapshot } from "./types";
import { TXO_EXPIRIES, TXO_SPOT, buildChain, mockQuote } from "./mock";

/**
 * Datasource abstraction. The mock implementation is used until the SinoPac
 * (Shioaji) backend is wired up. To swap in real data, replace this module's
 * exports with implementations that call the Shioaji proxy (e.g. FastAPI
 * service) — the shape of the returned data must match the types below.
 *
 * Suggested production layout:
 *   - Python FastAPI service hosting Shioaji client
 *   - REST: GET /chain, GET /quotes, GET /expiries
 *   - WS:   /ws/quotes for streaming TXO ticks
 *   - Auth: CA cert + login token stored in backend env, not exposed to client
 */
export interface DataSource {
  getQuote(symbol: string): Promise<QuoteSnapshot>;
  getExpiries(): Promise<ExpiryDef[]>;
  getChain(expiryId: string): Promise<{ expiry: ExpiryDef; rows: ChainRow[] }>;
}

export const mockDataSource: DataSource = {
  async getQuote() {
    return mockQuote();
  },
  async getExpiries() {
    return TXO_EXPIRIES;
  },
  async getChain(expiryId: string) {
    const expiry = TXO_EXPIRIES.find((e) => e.id === expiryId) ?? TXO_EXPIRIES[2];
    return {
      expiry,
      rows: buildChain(TXO_SPOT, expiry.dte),
    };
  },
};

export const dataSource: DataSource = mockDataSource;

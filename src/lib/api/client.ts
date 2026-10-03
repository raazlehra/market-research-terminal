import type { AnalysisConfig, AnalysisRequest, AnalysisResult, CryptoMarketSnapshot, ExchangeResponse, ExpiryRecord, FuturesMarketSnapshot, LoginResponse, OptionChainResponse } from "./types";
import type { BotDecisionLog } from "../../stores/autoBot/types";
import { paperResetRequest } from "./paperClient";
import { DEFAULT_API_BASE_URL } from "./config";

export class ApiClient {
  // Use the local or configured API URL set in Settings
  private getBaseUrl() {
    try {
      const saved = JSON.parse(localStorage.getItem("fyers_v3_settings") || "{}");
      const apiUrl = String(saved.apiUrl || "").trim();
      return apiUrl || DEFAULT_API_BASE_URL;
    } catch {
      return DEFAULT_API_BASE_URL;
    }
  }

  private getHeaders() {
    const token = localStorage.getItem("fyers_v3_token");
    return {
      "Content-Type": "application/json",
      ...(token ? { "Authorization": `Bearer ${token}` } : {})
    };
  }

  private async readError(res: Response, fallback: string) {
    const err = await res.json().catch(() => ({}));
    return err.detail || err.message || `${fallback} (${res.status})`;
  }

  async getHealth() {
    const res = await fetch(`${this.getBaseUrl()}/api/health`, { 
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(3000) 
    });
    if (!res.ok) throw new Error("Backend not reachable");
    return await res.json();
  }

  async loginUrl(): Promise<LoginResponse> {
    const res = await fetch(`${this.getBaseUrl()}/api/auth/login-url`, { 
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(3000) 
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Failed to fetch Fyers login URL from backend proxy.");
    }
    return await res.json();
  }

  async completeLogin(handoff: string): Promise<ExchangeResponse> {
    const res = await fetch(`${this.getBaseUrl()}/api/auth/complete`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({ handoff }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(await this.readError(res, "Failed to complete FYERS login."));
    return await res.json();
  }

  async getExpiries(index: string): Promise<ExpiryRecord[]> {
    const res = await fetch(`${this.getBaseUrl()}/api/fyers/expiries?symbol=${encodeURIComponent(index)}`, {
      headers: this.getHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(await this.readError(res, `Failed to fetch real expiries for ${index}`));
    const data: unknown = await res.json();
    if (!Array.isArray(data)) throw new Error("Invalid expiry response from backend.");
    return data.filter((item): item is ExpiryRecord => Boolean(
      item && typeof item === "object" && "expiry" in item
    ));
  }

  async getOptionChain(index: string, expiry?: string): Promise<OptionChainResponse> {
    let url = `${this.getBaseUrl()}/api/fyers/option-chain?symbol=${encodeURIComponent(index)}`;
    if (expiry) url += `&expiry=${encodeURIComponent(expiry)}`;
    
    const res = await fetch(url, {
      headers: this.getHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(await this.readError(res, `Failed to fetch real option chain for ${index}`));
    const data: unknown = await res.json();
    if (!data || typeof data !== "object") throw new Error("Invalid option-chain response from backend.");
    const candidate = data as Partial<OptionChainResponse>;
    if (!Array.isArray(candidate.chain) || !Number.isFinite(Number(candidate.spot))) {
      throw new Error("Option-chain response is missing required market data.");
    }
    return candidate as OptionChainResponse;
  }

  async history(symbol: string, resolution = "5", days = 1) {
    const url = new URL(`${this.getBaseUrl()}/api/fyers/history`);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("resolution", resolution);
    url.searchParams.set("days", String(days));

    const res = await fetch(url.toString(), {
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Failed to fetch history for ${symbol}`);
    }
    return await res.json();
  }

  async getFuturesMarket(symbol: string, contractSymbol?: string): Promise<FuturesMarketSnapshot> {
    const url = new URL(`${this.getBaseUrl()}/api/futures/market`);
    url.searchParams.set("symbol", symbol);
    if (contractSymbol) url.searchParams.set("contract_symbol", contractSymbol);
    const res = await fetch(url.toString(), {
      headers: this.getHeaders(), cache: "no-store", signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) throw new Error(await this.readError(res, "Failed to fetch FYERS futures market data."));
    return await res.json();
  }

  async getAnalysisConfig(): Promise<AnalysisConfig> {
    const res = await fetch(`${this.getBaseUrl()}/api/analysis/config`, {
      headers: this.getHeaders(), cache: "no-store", signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(await this.readError(res, "Failed to read AI analysis configuration."));
    return await res.json();
  }

  async getCryptoMarket(symbol: string, interval: string): Promise<CryptoMarketSnapshot> {
    const url = new URL(`${this.getBaseUrl()}/api/crypto/market`);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", interval);
    const res = await fetch(url.toString(), {
      headers: this.getHeaders(), cache: "no-store", signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(await this.readError(res, "Failed to fetch crypto market data."));
    return await res.json();
  }

  async runAnalysis(payload: AnalysisRequest): Promise<AnalysisResult> {
    const res = await fetch(`${this.getBaseUrl()}/api/analysis/run`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error(await this.readError(res, "Analysis failed."));
    const result = await res.json() as AnalysisResult;
    if (result.execution_enabled !== false || result.signal_type !== "analysis_only") {
      throw new Error("Unsafe analysis response was rejected.");
    }
    return result;
  }


  async placePaperOrder(payload: any) {
    const res = await fetch(`${this.getBaseUrl()}/api/paper/place`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error(await this.readError(res, "Failed to place paper order."));
    return await res.json();
  }

  async getOrders() {
    const res = await fetch(`${this.getBaseUrl()}/api/fyers/orders`, {
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error("Failed to fetch live Fyers orders.");
    return await res.json();
  }

  async getPositions() {
    const res = await fetch(`${this.getBaseUrl()}/api/fyers/positions`, {
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error("Failed to fetch live Fyers positions.");
    return await res.json();
  }

  async getTradebook() {
    const res = await fetch(`${this.getBaseUrl()}/api/fyers/tradebook`, {
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error("Failed to fetch live Fyers tradebook.");
    return await res.json();
  }

  async scan(payload: { type: string; params: any }) {
    const res = await fetch(`${this.getBaseUrl()}/api/scanner/run`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(300000),
    });
    if (!res.ok) throw new Error("Scanner failed to retrieve live data from Fyers backend.");
    return await res.json();
  }

  async getReports(range: string) {
    const res = await fetch(`${this.getBaseUrl()}/api/reports?range=${encodeURIComponent(range)}`, {
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error("Failed to fetch reports.");
    return await res.json();
  }

  async strategyPayoff(payload: { legs: any[]; spot: number; underlying: string }) {
    const res = await fetch(`${this.getBaseUrl()}/api/strategies/payoff`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error("Failed to fetch real option premiums for strategy payoff.");
    return await res.json();
  }

  async getSettings() {
    const res = await fetch(`${this.getBaseUrl()}/api/settings`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) throw new Error(await this.readError(res, "Failed to load settings."));
    return await res.json();
  }

  async saveSettings(form: any) {
    const res = await fetch(`${this.getBaseUrl()}/api/settings`, {
      method: "PUT",
      headers: this.getHeaders(),
      body: JSON.stringify(form),
    });
    if (!res.ok) throw new Error(await this.readError(res, "Failed to save settings."));
    localStorage.setItem("fyers_v3_settings", JSON.stringify(form));
    return await res.json();
  }

  async getBotSettings() {
    const res = await fetch(`${this.getBaseUrl()}/api/bot-settings`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) throw new Error(await this.readError(res, "Failed to load bot settings."));
    return await res.json();
  }

  async saveBotSettings(form: any) {
    const res = await fetch(`${this.getBaseUrl()}/api/bot-settings`, {
      method: "PUT",
      headers: this.getHeaders(),
      body: JSON.stringify(form),
    });
    if (!res.ok) throw new Error(await this.readError(res, "Failed to save bot settings."));
    return await res.json();
  }

  async getBotDecisions(limit = 50): Promise<BotDecisionLog[]> {
    const res = await fetch(`${this.getBaseUrl()}/api/bot-decisions?limit=${encodeURIComponent(String(limit))}`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) throw new Error(await this.readError(res, "Failed to load bot decisions."));
    return await res.json();
  }

  async saveBotDecision(row: BotDecisionLog): Promise<BotDecisionLog> {
    const res = await fetch(`${this.getBaseUrl()}/api/bot-decisions`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(row),
    });
    if (!res.ok) throw new Error(await this.readError(res, "Failed to save bot decision."));
    return await res.json();
  }

  async clearBotDecisions() {
    const res = await fetch(`${this.getBaseUrl()}/api/bot-decisions`, {
      method: "DELETE",
      headers: this.getHeaders(),
    });
    if (!res.ok) throw new Error(await this.readError(res, "Failed to clear bot decisions."));
    return await res.json();
  }

  async killSwitch(active: boolean) {
    const res = await fetch(`${this.getBaseUrl()}/api/risk/kill-switch`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({ on: active }),
    });
    if (!res.ok) throw new Error(await this.readError(res, "Failed to update kill switch."));
    localStorage.setItem("fyers_v3_killswitch", active ? "true" : "false");
    return await res.json();
  }

  // Paper Trading Account API: Maintains its dedicated local ledger state
  async paperReset() {
    return await paperResetRequest(this.getBaseUrl(), this.getHeaders(), this.readError);
  }

  async paperExit(orderId: string, qty?: number) {
    const res = await fetch(`${this.getBaseUrl()}/api/paper/exit/${encodeURIComponent(orderId)}`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({ qty }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Failed to exit paper position.");
    }
    return await res.json();
  }

  async getPaperBalance() {
    const res = await fetch(`${this.getBaseUrl()}/api/paper/balance`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) throw new Error(await this.readError(res, "Failed to fetch paper balance."));
    return await res.json();
  }

  async getPaperOrders() {
    const res = await fetch(`${this.getBaseUrl()}/api/paper/orders`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) throw new Error(await this.readError(res, "Failed to fetch paper orders."));
    return await res.json();
  }

  async getPaperTrades() {
    const res = await fetch(`${this.getBaseUrl()}/api/paper/trades`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) throw new Error(await this.readError(res, "Failed to fetch paper trades."));
    return await res.json();
  }

  async getPaperOutcomes() {
    const res = await fetch(`${this.getBaseUrl()}/api/paper/outcomes`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) throw new Error(await this.readError(res, "Failed to fetch paper outcomes."));
    return await res.json();
  }

  async getPaperOutcomeSummary() {
    const res = await fetch(`${this.getBaseUrl()}/api/paper/outcomes/summary`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) throw new Error(await this.readError(res, "Failed to fetch paper outcome summary."));
    return await res.json();
  }

  async getPaperPositions() {
    const res = await fetch(`${this.getBaseUrl()}/api/paper/positions`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) throw new Error(await this.readError(res, "Failed to fetch paper positions."));
    return await res.json();
  }

  // Trading workflow - Trade journal
  async createTradeJournal(payload: any) {
    const res = await fetch(`${this.getBaseUrl()}/api/trades/journal`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Journal entry failed: ${res.statusText}`);
    return res.json();
  }

  // Trading workflow - Paper wallet
  async updatePaperWallet(payload: any) {
    const res = await fetch(`${this.getBaseUrl()}/api/paper-trading/wallet`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Wallet update failed: ${res.statusText}`);
    return res.json();
  }

  async getPaperWallet() {
    const res = await fetch(`${this.getBaseUrl()}/api/paper-trading/wallet`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) throw new Error('Failed to fetch wallet');
    return res.json();
  }
}

export const api = new ApiClient();

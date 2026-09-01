// Real WebSocket API integration wrapping Fyers v3 Data WebSockets
export class SocketManager {
  private ws: WebSocket | null = null;
  private currentSymbols: string[] = [];
  private reconnectTimer: any = null;

  subscribe(symbols: string[]) {
    this.currentSymbols = symbols;
    this.connect();
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ op: "subscribe", action: "subscribe", symbols }));
    }
  }

  unsubscribe(symbols: string[]) {
    this.currentSymbols = this.currentSymbols.filter(s => !symbols.includes(s));
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ op: "unsubscribe", action: "unsubscribe", symbols }));
    }
  }

  private connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      const saved = JSON.parse(localStorage.getItem("fyers_v3_settings") || "{}");
      const base = saved.apiUrl || "http://localhost:8000";
      const token = localStorage.getItem("fyers_v3_token");
      const wsUrl = base.replace(/^http/, "ws") + "/ws/market" + (token ? `?token=${encodeURIComponent(token)}` : "");
      
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        if (this.currentSymbols.length > 0) {
          this.ws?.send(JSON.stringify({ op: "subscribe", action: "subscribe", symbols: this.currentSymbols }));
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // Broadcast live feed directly to application subscribers
          window.dispatchEvent(new CustomEvent("fyers_ticks", { detail: data }));
        } catch {}
      };

      this.ws.onclose = () => {
        this.ws = null;
        // Attempt clean reconnect to custom proxy
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => this.connect(), 3000);
      };

      this.ws.onerror = () => {
        this.ws?.close();
      };
    } catch {
      // Proxy offline
    }
  }
}

export const socket = new SocketManager();

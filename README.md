# FnO Terminal - Fyers F&O Analysis and Paper-Trading Dashboard

**FnO Terminal** is a local analysis and paper-trading dashboard for Indian equity and F&O workflows. It uses a FastAPI backend proxy for read-only FYERS market data and keeps live broker mutation routes disabled.

---

## Current Capabilities

### 1. Market Data
All randomized option chains, simulated tick streams, and procedural equity curves have been stripped from the network layer. 
- Natively connects to the backend proxy specified in your configuration settings.
- Ingests FYERS quotes, option-chain data, history, and WebSocket ticks through the backend/proxy paths.
- If the backend or FYERS data path is unavailable, the app should surface an error rather than manufacturing prices.

### 2. Stocks Selection Strategies
The stock scanner currently implements five reachable strategies:
- **VWAP Breakout**
- **Breakout Volume**
- **Range Breakout**
- **EMA Trend Alignment**
- **Volume Spike**

Scanner outputs include generated entry, stop-loss, targets, factors, and a rule-based confluence score. These scores are not calibrated probabilities of profit.

### 3. Paper Ticket and Paper Positions
The central ticket provides manual paper Buy and Sell controls:
- **Advanced Bracket Suite**: Configure **Target 1**, **Target 2**, and a hard **Stop Loss** parameter with an **Auto-Trail SL** option.
- **Paper Exits**: Paper positions can use partial exits or full position unwinds. These are local paper-trading actions, not broker orders.

### 4. Auto-Bot Command Center
An integrated command suite embedded natively into the global navigation bar:
- Controls dry-run and paper-auto evaluation. You can **Start/Stop** and **Pause/Resume** background signal checks.
- Live broker order placement, modification, cancellation, position exit, and square-off-all routes are hard-disabled.

### 5. **Option Chain Writer Interception Signals**
The Option Chain view parses live market open interest changes to deliver actionable trading cues:
- **Writer Liquidations**: Features real-time flashing indicators when trapped options writers liquidate (**CE WRITERS EXITING** and **PE WRITERS EXITING**).
- **Volume Confirmation**: Displays discrete alert tags when an individual option's volume massively outpaces open interest.
- **Confluence Scoring**: Computes active **BUY CE** and **BUY PE** rule-based signal scores from market flow, option-contract features, OHLCV-derived indicators, liquidity checks, expiry checks, and risk gates.
- **IV Wording**: The current implementation compares IV values within the current option chain. It is chain-relative IV rank, not historical IV rank.

Rendered charts are for visualization. OHLCV-derived indicators can influence analysis, but the application does not analyze chart screenshots or rendered chart images.

Historical profitability has not been established. A credible historical options backtest with expiry handling, bid/ask spread, slippage, costs, and out-of-sample validation is not implemented yet.

---

## How to Connect & Log in to Your Own FYERS Data Access

To stream market data from Indian markets into FnO Terminal, link it to your own official **Fyers API App**.

### Step 1: Create Your Fyers API App
1. Go to the [Fyers API Dashboard](https://myapi.fyers.in/) and log in with your client ID.
2. Create a new App. Select **API v3** (Trading & Data API).
3. Set your **Redirect URL** to match the backend proxy authentication endpoint (e.g., `http://localhost:8000/auth/callback` or your production domain).
4. Note down your unique **App ID** and **Secret Key**.

### Step 2: Configure Your Backend Proxy
The React frontend requires a native Python FastAPI proxy server to securely sign API requests, route CORS headers, multiplex WebSockets, and maintain local PostgreSQL / SQLite state. We have fully integrated your backend stack directly into the `backend/` directory!

1. Navigate to the project root and create a `.env` file for the backend:
   ```env
   FYERS_APP_ID="YOUR_APP_ID"
   FYERS_SECRET_KEY="YOUR_SECRET_KEY"
   FYERS_REDIRECT_URI="http://localhost:8000/auth/fyers/callback"
   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/fno" # Or omit to default to automatic local SQLite
   ```
2. Install the required Python dependencies:
   ```bash
   pip install fastapi uvicorn sqlalchemy pydantic httpx fyers-apiv3 psycopg2-binary redis python-dotenv
   ```
3. Launch the FastAPI server natively from the project root:
   ```bash
   uvicorn backend.main:app --reload --port 8000
   ```

### Step 3: Configure Frontend Connection Settings
1. Open the **FnO Terminal** application.
2. Navigate to the **Settings** section in the left sidebar.
3. Locate the **Backend Connection** configuration block.
4. Input your running backend proxy URL in the **Backend API Proxy URL** field (e.g., `http://localhost:8000`).
5. Click **Save All Settings**.

### Step 4: Authorize and Log In
1. On the login page, click **Continue with Fyers**.
2. You will be securely redirected to the official Fyers OAuth portal.
3. Authenticate with your Fyers credentials and grant access permissions.
4. FYERS returns an authorization code (`auth_code`) back to your proxy, which exchanges it for an access token.
5. The token is stored locally on your device and attached as a Bearer token to read-only market-data API calls. Live broker mutation endpoints remain disabled.

---

## 🛠️ Development & Build Integration

This project leverages **Vite**, **React 19**, **Tailwind CSS**, and **Zustand** state management.

### Build Verification
To compile the platform and guarantee that all custom hooks, routing matrices, and TypeScript typings output successfully:
```bash
npm run build
```
The output bundles are built in the `dist/` directory for local verification or later review.

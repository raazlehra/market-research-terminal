# FnO Terminal — Fyers API v3 Professional Trading Hub

**FnO Terminal** is a professional-grade execution ecosystem tailored for high-frequency Indian equity and F&O algorithmic traders. It directly interfaces with the official **Fyers API v3 Data Streams** via a custom API proxy.

---

## 🚀 Key Milestones & Architecture Enhancements

### 1. **Removal of Simulated Fallback Data**
All randomized option chains, simulated tick streams, and procedural equity curves have been stripped from the network layer. 
- Natively connects to the backend proxy specified in your configuration settings.
- Natively ingests binary/JSON live WebSockets directly broadcast from Fyers v3 feeds.
- If your custom live proxy is disconnected or down, the platform gracefully halts data pipelines and throws pure network errors. You will never be shown artificial or misleading prices.

### 2. **Institutional Stocks Selection Strategies**
A dedicated workspace enabling one-click evaluation of 15 advanced alpha setups:
- **Momentum & Pullback Edges**: *Breakdown Momentum*, *Pullback Buy*, *Gap Up Sustain*, *Golden Crossover*, *Inside Bar Breakout*, *Bollinger Band Squeeze*, *Supertrend Alignment*, *RSI Reversal Divergence*, *Volume Climax Exhaustion*, *Institutional VWAP Bounce*, *Open High Low (OHL)*, *Prev Day High Breakout*, *Sector Rotation Momentum*, *Harmonic Gartley Reversal*, and *Institutional Block Absorption*.
- **Real-Time Data Integration**: Pulls underlying stock metrics directly from authentic Fyers WebSocket streams.
- **Actionable Execution**: Maps out precise entry structures, Multi-Target bracket levels (**Target 1** and **Target 2**), custom **Stop Loss** constraints, and dynamic **Winning Chance Confluence Scores**.

### 3. **Advanced F&O Ticket with Multi-Bracket Exits**
The central order execution ticket provides high-speed manual Paper Buy and Paper Sell controls:
- **Advanced Bracket Suite**: Configure **Target 1**, **Target 2**, and a hard **Stop Loss** parameter with an **Auto-Trail SL** option.
- **Fast Active Exits**: Execute immediate **Partial Exits (25%, 50%)** or **Full Position Unwinds** with a single button press.

### 4. **Algorithmic Auto-Bot Command Center**
An integrated command suite embedded natively into the global navigation bar:
- Controls live algorithmic evaluation. You can **Start/Stop** and **Pause/Resume** background signal interception.
- Synchronize your chosen institutional selection strategy with the Auto-Bot natively. The bot continuously listens to authentic tick activity to trigger instant high-precision entries.

### 5. **Option Chain Writer Interception Signals**
The Option Chain view parses live market open interest changes to deliver actionable trading cues:
- **Writer Liquidations**: Features real-time flashing indicators when trapped options writers liquidate (**CE WRITERS EXITING** and **PE WRITERS EXITING**).
- **Volume Confirmation**: Displays discrete alert tags when an individual option's volume massively outpaces open interest.
- **Confluence Scoring**: Computes active **BUY CE** and **BUY PE** confidence percentages based on institutional flow and the Put-Call Ratio.

---

## 🔑 How to Connect & Log in to Your Own Live Fyers API

To stream live data from the Indian Markets directly into the FnO Terminal, you must link it to your own official **Fyers API App**.

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
4. Fyers will automatically return an authorization code (`auth_code`) back to your proxy, which directly exchanges it for an official client `access_token`.
5. The token is stored locally on your device and automatically attached as a Bearer token to all downstream API calls. The platform is now completely live!

---

## 🛠️ Development & Build Integration

This project leverages **Vite**, **React 19**, **Tailwind CSS**, and **Zustand** state management.

### Build Verification
To compile the platform and guarantee that all custom hooks, routing matrices, and TypeScript typings output successfully:
```bash
npm run build
```
The output bundles are cleanly built in the `dist/` directory and are ready for production deployment.

import { Navigate, Route, Routes } from "react-router-dom";
import { ViewerLayout } from "./components/ViewerLayout";
import Login from "./pages/Login";
import Dashboard from "./pages/ResearchDashboard";
import Stocks from "./pages/Stocks";
import OptionChain from "./pages/OptionChain";
import Charts from "./pages/Charts";
import Watchlist from "./pages/Watchlist";
import Settings from "./pages/ResearchSettings";
import SystemCheck from "./pages/SystemCheck";
import Crypto from "./pages/Crypto";
import { useAuth } from "./stores";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = useAuth((s) => s.token);

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<SystemCheck />} />
      <Route path="/login" element={<Login />} />
      <Route element={<RequireAuth><ViewerLayout /></RequireAuth>}>
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="stocks" element={<Stocks />} />
        <Route path="watchlist" element={<Watchlist />} />
        <Route path="fno" element={<OptionChain />} />
        <Route path="option-chain" element={<Navigate to="/fno" replace />} />
        <Route path="crypto" element={<Crypto />} />
        <Route path="charts" element={<Charts />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

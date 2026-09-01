import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Stocks from "./pages/Stocks";
import OptionChain from "./pages/OptionChain";
import Charts from "./pages/Charts";
import Orders from "./pages/Orders";
import Positions from "./pages/Positions";
import Trades from "./pages/Trades";
import Journal from "./pages/Journal";
import Paper from "./pages/Paper";
import Watchlist from "./pages/Watchlist";
import Alerts from "./pages/Alerts";
import Strategies from "./pages/Strategies";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import SystemCheck from "./pages/SystemCheck";
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
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="stocks" element={<Stocks />} />
        <Route path="watchlist" element={<Watchlist />} />
        <Route path="option-chain" element={<OptionChain />} />
        <Route path="charts" element={<Charts />} />
        <Route path="orders" element={<Orders />} />
        <Route path="positions" element={<Positions />} />
        <Route path="trades" element={<Trades />} />
        <Route path="journal" element={<Journal />} />
        <Route path="paper" element={<Paper />} />
        <Route path="alerts" element={<Alerts />} />
        <Route path="strategies" element={<Strategies />} />
        <Route path="reports" element={<Reports />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

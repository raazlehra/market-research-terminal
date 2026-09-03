import tempfile
import unittest
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

from backend.paper_engine.engine import PaperEngine
from backend.routes.paper_outcome_routes import _build_outcome_summary, _financials_for_outcome, _serialize_with_financials


def row(**overrides):
    base = {
        "id": "outcome-1",
        "order_id": "order-1",
        "signal_time": None,
        "symbol": "NSE:RBLBANK-EQ",
        "side": "BUY",
        "qty": 110,
        "strategy": "Manual",
        "confidence": 95,
        "entry": 390.75,
        "sl": None,
        "t1": None,
        "t2": None,
        "closed": True,
        "sl_hit": False,
        "t1_hit": False,
        "t2_hit": False,
        "pnl": -198.76961946781478,
        "notes": None,
        "created_at": None,
        "updated_at": None,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def trade(order_id, side, qty, price, charges, pnl=None):
    payload = {
        "orderId": order_id,
        "side": side,
        "qty": qty,
        "price": price,
        "charges": charges,
    }
    if pnl is not None:
        payload["pnl"] = pnl
    return payload


class PaperPerformanceCalculationTests(unittest.TestCase):
    def test_exact_rblbank_regression_uses_executed_entry_notional(self) -> None:
        ledger = [
            trade("order-1", "BUY", 110, 390.8797238133438, 42.43),
            trade("order-1", "SELL", 50, 389.10, 30.77, -88.98619066718823),
            trade("order-1", "SELL", 60, 389.05, 36.92, -109.78342880062655),
        ]

        financials = _financials_for_outcome(row(), ledger)

        self.assertAlmostEqual(financials["entryNotional"], 42996.77, places=2)
        self.assertAlmostEqual(financials["grossPnl"], -198.77, places=2)
        self.assertAlmostEqual(financials["entryCharges"], 42.43, places=2)
        self.assertAlmostEqual(financials["exitCharges"], 67.69, places=2)
        self.assertAlmostEqual(financials["totalCharges"], 110.12, places=2)
        self.assertAlmostEqual(financials["netPnl"], -308.89, places=2)
        self.assertAlmostEqual(financials["grossReturnPct"], -0.46, places=2)
        self.assertAlmostEqual(financials["netReturnPct"], -0.72, places=2)
        self.assertEqual(financials["returnBasis"]["entryQty"], 110)

    def test_summary_keeps_legacy_avg_return_as_correct_gross_return(self) -> None:
        ledger = [
            trade("order-1", "BUY", 110, 390.8797238133438, 42.43),
            trade("order-1", "SELL", 50, 389.10, 30.77, -88.98619066718823),
            trade("order-1", "SELL", 60, 389.05, 36.92, -109.78342880062655),
        ]

        summary = _build_outcome_summary([row()], ledger)
        bucket = next(item for item in summary["buckets"] if item["bucket"] == "90+")

        self.assertEqual(summary["totals"]["trades"], 1)
        self.assertAlmostEqual(summary["totals"]["grossPnl"], -198.77, places=2)
        self.assertAlmostEqual(summary["totals"]["netPnl"], -308.89, places=2)
        self.assertAlmostEqual(bucket["avgReturn"], -0.46, places=2)
        self.assertAlmostEqual(bucket["avgGrossReturn"], -0.46, places=2)
        self.assertAlmostEqual(bucket["avgNetReturn"], -0.72, places=2)
        self.assertAlmostEqual(bucket["grossLoss"], 198.77, places=2)

    def test_multiple_trades_in_one_bucket_use_arithmetic_average(self) -> None:
        rows = [
            row(order_id="loss", confidence=95, pnl=-198.76961946781478),
            row(order_id="profit", confidence=92, pnl=100.0),
        ]
        ledger = [
            trade("loss", "BUY", 110, 390.8797238133438, 42.43),
            trade("loss", "SELL", 110, 389.07363636363635, 67.69, -198.76961946781478),
            trade("profit", "BUY", 10, 100.0, 5.0),
            trade("profit", "SELL", 10, 110.0, 5.0, 100.0),
        ]

        bucket = next(item for item in _build_outcome_summary(rows, ledger)["buckets"] if item["bucket"] == "90+")

        self.assertEqual(bucket["trades"], 2)
        self.assertAlmostEqual(bucket["avgGrossReturn"], 4.77, places=2)
        self.assertAlmostEqual(bucket["avgNetReturn"], 4.14, places=2)

    def test_profitable_losing_and_breakeven_trades_are_summarized(self) -> None:
        rows = [
            row(order_id="win", confidence=75, pnl=50.0),
            row(order_id="loss", confidence=75, pnl=-25.0),
            row(order_id="flat", confidence=75, pnl=0.0),
        ]
        ledger = [
            trade("win", "BUY", 10, 100.0, 2.0),
            trade("win", "SELL", 10, 105.0, 2.0, 50.0),
            trade("loss", "BUY", 10, 100.0, 2.0),
            trade("loss", "SELL", 10, 97.5, 2.0, -25.0),
            trade("flat", "BUY", 10, 100.0, 2.0),
            trade("flat", "SELL", 10, 100.0, 2.0, 0.0),
        ]

        summary = _build_outcome_summary(rows, ledger)
        bucket = next(item for item in summary["buckets"] if item["bucket"] == "70-80")

        self.assertEqual(summary["totals"]["wins"], 1)
        self.assertEqual(summary["totals"]["losses"], 1)
        self.assertEqual(bucket["trades"], 3)
        self.assertAlmostEqual(bucket["avgGrossReturn"], 0.83, places=2)

    def test_missing_or_zero_notional_returns_unavailable(self) -> None:
        no_ledger = _financials_for_outcome(row(order_id="missing"), [])
        zero_notional = _financials_for_outcome(
            row(order_id="zero"),
            [trade("zero", "BUY", 0, 100.0, 0.0), trade("zero", "SELL", 1, 99.0, 1.0, -1.0)],
        )

        self.assertIsNone(no_ledger["entryNotional"])
        self.assertIsNone(no_ledger["grossReturnPct"])
        self.assertEqual(no_ledger["returnBasis"]["source"], "unavailable")
        self.assertIsNone(zero_notional["entryNotional"])
        self.assertIsNone(zero_notional["netReturnPct"])

    def test_historical_rows_without_ledger_remain_readable(self) -> None:
        serialized = _serialize_with_financials(row(order_id="old", pnl=12.34), [])

        self.assertEqual(serialized["pnl"], 12.34)
        self.assertEqual(serialized["grossPnl"], 12.34)
        self.assertIsNone(serialized["entryNotional"])
        self.assertIsNone(serialized["netPnl"])
        self.assertIn("unavailable", serialized["returnBasis"]["source"])

    def test_derivative_quantities_are_treated_as_executed_units_once(self) -> None:
        derivative = row(order_id="derivative", symbol="NSE:NIFTY2670022000CE", qty=50, pnl=250.0)
        ledger = [
            trade("derivative", "BUY", 50, 100.0, 12.0),
            trade("derivative", "SELL", 50, 105.0, 14.0, 250.0),
        ]

        financials = _financials_for_outcome(derivative, ledger)

        self.assertEqual(financials["entryNotional"], 5000.0)
        self.assertEqual(financials["returnBasis"]["entryQty"], 50)
        self.assertEqual(financials["grossReturnPct"], 5.0)

    def test_multiple_entry_fills_are_summed_once_for_basis_and_charges(self) -> None:
        fills = row(order_id="scale-in", qty=30, pnl=150.0)
        ledger = [
            trade("scale-in", "BUY", 10, 100.0, 2.0),
            trade("scale-in", "BUY", 20, 110.0, 3.0),
            trade("scale-in", "SELL", 30, 115.0, 4.0, 150.0),
        ]

        financials = _financials_for_outcome(fills, ledger)

        self.assertEqual(financials["entryNotional"], 3200.0)
        self.assertEqual(financials["entryCharges"], 5.0)
        self.assertEqual(financials["exitCharges"], 4.0)
        self.assertEqual(financials["totalCharges"], 9.0)
        self.assertEqual(financials["netPnl"], 141.0)
        self.assertAlmostEqual(financials["grossReturnPct"], 4.69, places=2)
        self.assertEqual(financials["returnBasis"]["entryFills"], 2)

    def test_short_sell_outcome_uses_positive_entry_basis_and_signs(self) -> None:
        short = row(order_id="short", side="SELL", qty=25, pnl=125.0)
        winning_short = [
            trade("short", "SELL", 25, 200.0, 6.0),
            trade("short", "BUY", 25, 195.0, 5.0, 125.0),
        ]
        losing_short = [
            trade("short-loss", "SELL", 25, 200.0, 6.0),
            trade("short-loss", "BUY", 25, 205.0, 5.0, -125.0),
        ]

        win = _financials_for_outcome(short, winning_short)
        loss = _financials_for_outcome(row(order_id="short-loss", side="SELL", qty=25, pnl=-125.0), losing_short)

        self.assertEqual(win["entryNotional"], 5000.0)
        self.assertEqual(win["grossPnl"], 125.0)
        self.assertEqual(win["grossReturnPct"], 2.5)
        self.assertEqual(win["netPnl"], 114.0)
        self.assertEqual(loss["entryNotional"], 5000.0)
        self.assertEqual(loss["grossPnl"], -125.0)
        self.assertEqual(loss["grossReturnPct"], -2.5)

    def test_option_lot_size_is_not_applied_again_to_unit_quantity(self) -> None:
        option = row(order_id="nifty-option", symbol="NSE:NIFTY2670022000CE", qty=75, pnl=375.0)
        ledger = [
            trade("nifty-option", "BUY", 75, 100.0, 18.0),
            trade("nifty-option", "SELL", 75, 105.0, 20.0, 375.0),
        ]

        financials = _financials_for_outcome(option, ledger)

        self.assertEqual(financials["entryNotional"], 7500.0)
        self.assertEqual(financials["returnBasis"]["entryQty"], 75)
        self.assertEqual(financials["grossReturnPct"], 5.0)


class PaperEngineExitLifecycleTests(unittest.TestCase):
    def test_partial_exit_keeps_position_open_and_final_exit_closes_it(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            class TempPaperEngine(PaperEngine):
                STATE_PATH = f"{tmp_dir}/paper_state.json"

            engine = TempPaperEngine()
            engine.reset("u1")

            class FakeFyers:
                def __init__(self) -> None:
                    self.prices = [389.10, 389.05]

                def get_tick(self, symbol: str) -> dict[str, float | str]:
                    return {"symbol": symbol, "ltp": self.prices.pop(0)}

                def quotes_sync(self, symbols: list[str]) -> dict[str, Any]:
                    return {"d": [{"n": symbol, "v": {"lp": 0}} for symbol in symbols]}

            with patch("backend.paper_engine.orders.market_open", return_value=True):
                entry = engine.place(
                    "u1",
                    {
                        "symbol": "NSE:RBLBANK-EQ",
                        "side": "BUY",
                        "qty": 110,
                        "orderType": "LIMIT",
                        "price": 390.8797238133438,
                    },
                    {"ltp": 390.8797238133438, "bid": 390.8797238133438, "ask": 390.8797238133438},
                )

                self.assertTrue(entry["ok"])
                fyers = FakeFyers()
                first = engine.exit("u1", entry["id"], fyers, qty=50)

                self.assertEqual(first["status"], "PARTIAL_EXITED")
                self.assertEqual(first["remainingQty"], 60)
                self.assertEqual(engine.positions["u1"][0]["openQty"], 60)
                self.assertEqual(engine.orders["u1"][0]["status"], "FILLED")

                second = engine.exit("u1", entry["id"], fyers, qty=60)

            self.assertEqual(second["status"], "EXITED")
            self.assertEqual(second["remainingQty"], 0)
            self.assertEqual(engine.positions["u1"], [])
            self.assertEqual(engine.orders["u1"][0]["status"], "CLOSED")


if __name__ == "__main__":
    unittest.main()

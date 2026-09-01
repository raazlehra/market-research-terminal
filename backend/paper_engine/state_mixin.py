import json
import os
import shutil
from typing import Any, Protocol, cast

from .storage import balances_from_state, ledger_from_state, load_json_record
from .types import BalanceMap, PaperLedger, PaperRecord


class PaperStateOwner(Protocol):
    STATE_PATH: str
    orders: PaperLedger
    trades: PaperLedger
    balances: BalanceMap
    positions: PaperLedger


def _state_owner(value: object) -> PaperStateOwner:
    return cast(PaperStateOwner, value)


class PaperStateMixin:
    def _key(self, uid: Any) -> str:
        return str(uid)

    def _load_state(self) -> None:
        owner = _state_owner(self)
        if not os.path.exists(owner.STATE_PATH):
            return
        state: PaperRecord = {}
        try:
            state = load_json_record(owner.STATE_PATH)
        except json.JSONDecodeError as e:
            print("PAPER STATE LOAD ERROR: invalid JSON, trying backup", e)
            backup_path = owner.STATE_PATH + ".bak"
            if os.path.exists(backup_path):
                try:
                    state = load_json_record(backup_path)
                    print("PAPER STATE LOAD: recovered from backup")
                except Exception as e2:
                    print("PAPER STATE BACKUP LOAD ERROR:", e2)
                    return
            else:
                broken_path = owner.STATE_PATH + ".broken"
                try:
                    os.replace(owner.STATE_PATH, broken_path)
                    print("PAPER STATE LOAD: renamed corrupted state to", broken_path)
                except Exception as e2:
                    print("PAPER STATE RENAME BROKEN ERROR:", e2)
                return
        except Exception as e:
            print("PAPER STATE LOAD ERROR:", e)
            return

        owner.orders = ledger_from_state(state.get("orders"))
        owner.trades = ledger_from_state(state.get("trades"))
        owner.balances = balances_from_state(state.get("balances"))
        owner.positions = ledger_from_state(state.get("positions"))

    def _save_state(self) -> None:
        owner = _state_owner(self)
        state: PaperRecord = {
            "orders": {k: v for k, v in owner.orders.items()},
            "trades": {k: v for k, v in owner.trades.items()},
            "balances": owner.balances,
            "positions": {k: v for k, v in owner.positions.items()},
        }
        tmp_path = owner.STATE_PATH + ".tmp"
        backup_path = owner.STATE_PATH + ".bak"
        try:
            if os.path.exists(owner.STATE_PATH):
                shutil.copy2(owner.STATE_PATH, backup_path)
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(state, f, indent=2)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp_path, owner.STATE_PATH)
        except Exception as e:
            print("PAPER STATE SAVE ERROR:", e)
            try:
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)
            except Exception:
                pass

    def _ensure(self, uid: Any) -> None:
        owner = _state_owner(self)
        uid = self._key(uid)
        if uid not in owner.balances:
            owner.balances[uid] = {"starting": 100000, "available": 100000, "used": 0}

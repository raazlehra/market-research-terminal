import os

from .orders import PaperOrderMixin
from .state_mixin import PaperStateMixin
from .types import BalanceMap, PaperLedger, empty_ledger
from .views import PaperViewMixin


class PaperEngine(PaperStateMixin, PaperViewMixin, PaperOrderMixin):
    STATE_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "paper_state.json")

    def __init__(self) -> None:
        self.orders: PaperLedger = empty_ledger()
        self.trades: PaperLedger = empty_ledger()
        self.balances: BalanceMap = {}
        self.positions: PaperLedger = empty_ledger()
        self._load_state()

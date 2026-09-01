import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    fy_id: Mapped[str | None] = mapped_column(String, unique=True, index=True)
    name: Mapped[str | None] = mapped_column(String)
    email: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)


class BrokerAccount(Base):
    __tablename__ = "broker_accounts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), index=True)
    broker: Mapped[str] = mapped_column(String, default="fyers")
    access_token: Mapped[str | None] = mapped_column(Text)
    refresh_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, onupdate=_utcnow)


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), index=True)
    broker_order_id: Mapped[str | None] = mapped_column(String, index=True, nullable=True)
    symbol: Mapped[str | None] = mapped_column(String)
    side: Mapped[int | None] = mapped_column(Integer)
    qty: Mapped[int | None] = mapped_column(Integer)
    order_type: Mapped[int | None] = mapped_column(Integer)
    product: Mapped[str | None] = mapped_column(String)
    price: Mapped[float] = mapped_column(Float, default=0)
    trigger: Mapped[float] = mapped_column(Float, default=0)
    status: Mapped[str | None] = mapped_column(String)
    payload_json: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)


class Trade(Base):
    __tablename__ = "trades"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), index=True)
    order_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("orders.id"))
    symbol: Mapped[str | None] = mapped_column(String)
    side: Mapped[str | None] = mapped_column(String)
    qty: Mapped[int | None] = mapped_column(Integer)
    price: Mapped[float | None] = mapped_column(Float)
    time: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)


class Position(Base):
    __tablename__ = "positions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), index=True)
    symbol: Mapped[str | None] = mapped_column(String)
    qty: Mapped[int | None] = mapped_column(Integer)
    avg_price: Mapped[float | None] = mapped_column(Float)
    product: Mapped[str | None] = mapped_column(String)


class JournalEntry(Base):
    __tablename__ = "journal_entries"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), index=True)
    symbol: Mapped[str | None] = mapped_column(String)
    side: Mapped[str | None] = mapped_column(String)
    qty: Mapped[int | None] = mapped_column(Integer)
    entry: Mapped[float | None] = mapped_column(Float)
    exit: Mapped[float | None] = mapped_column(Float)
    pnl: Mapped[float | None] = mapped_column(Float)
    strategy: Mapped[str | None] = mapped_column(String)
    tags: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    screenshot_url: Mapped[str | None] = mapped_column(String, nullable=True)
    date: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)


class PaperOrder(Base):
    __tablename__ = "paper_orders"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), index=True)
    symbol: Mapped[str | None] = mapped_column(String)
    side: Mapped[str | None] = mapped_column(String)
    qty: Mapped[int | None] = mapped_column(Integer)
    order_type: Mapped[str | None] = mapped_column(String)
    price: Mapped[float | None] = mapped_column(Float)
    trigger: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str | None] = mapped_column(String)
    filled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    product: Mapped[str] = mapped_column(String, default="INTRADAY")
    open_qty: Mapped[int] = mapped_column(Integer, default=0)
    avg_price: Mapped[float] = mapped_column(Float, default=0)
    unrealized: Mapped[float] = mapped_column(Float, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)


class PaperTrade(Base):
    __tablename__ = "paper_trades"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), index=True)
    order_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("paper_orders.id"))
    symbol: Mapped[str | None] = mapped_column(String)
    side: Mapped[str | None] = mapped_column(String)
    qty: Mapped[int | None] = mapped_column(Integer)
    price: Mapped[float | None] = mapped_column(Float)
    charges: Mapped[float] = mapped_column(Float, default=0)
    time: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)


class PaperTradeOutcome(Base):
    __tablename__ = "paper_trade_outcomes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), index=True)
    order_id: Mapped[str | None] = mapped_column(String, index=True, nullable=True)
    signal_time: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    symbol: Mapped[str | None] = mapped_column(String)
    side: Mapped[str | None] = mapped_column(String)
    qty: Mapped[int | None] = mapped_column(Integer)
    strategy: Mapped[str | None] = mapped_column(String)
    confidence: Mapped[float] = mapped_column(Float, default=0)
    entry: Mapped[float | None] = mapped_column(Float)
    sl: Mapped[float | None] = mapped_column(Float, nullable=True)
    t1: Mapped[float | None] = mapped_column(Float, nullable=True)
    t2: Mapped[float | None] = mapped_column(Float, nullable=True)
    sl_hit: Mapped[bool] = mapped_column(Boolean, default=False)
    t1_hit: Mapped[bool] = mapped_column(Boolean, default=False)
    t2_hit: Mapped[bool] = mapped_column(Boolean, default=False)
    closed: Mapped[bool] = mapped_column(Boolean, default=False)
    pnl: Mapped[float | None] = mapped_column(Float, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, onupdate=_utcnow)


class PaperBalance(Base):
    __tablename__ = "paper_balances"

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True)
    starting: Mapped[float] = mapped_column(Float, default=100000)
    available: Mapped[float] = mapped_column(Float, default=100000)
    used: Mapped[float] = mapped_column(Float, default=0)


class Watchlist(Base):
    __tablename__ = "watchlists"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String, default="Default")
    symbols: Mapped[str] = mapped_column(Text, default="[]")


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), index=True)
    symbol: Mapped[str | None] = mapped_column(String)
    type: Mapped[str | None] = mapped_column(String)
    value: Mapped[float | None] = mapped_column(Float)
    triggered: Mapped[bool] = mapped_column(Boolean, default=False)
    last_fired_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    webhook: Mapped[str | None] = mapped_column(String, nullable=True)


class Settings(Base):
    __tablename__ = "settings"

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True)
    data: Mapped[str] = mapped_column(Text, default="{}")


class BotDecision(Base):
    __tablename__ = "bot_decisions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), index=True)
    status: Mapped[str] = mapped_column(String, default="CHECK")
    message: Mapped[str] = mapped_column(Text, default="")
    symbol: Mapped[str | None] = mapped_column(String, nullable=True)
    side: Mapped[str | None] = mapped_column(String, nullable=True)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    strategy: Mapped[str | None] = mapped_column(String, nullable=True)
    source: Mapped[str | None] = mapped_column(String, nullable=True)
    details_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)


class StrategyRun(Base):
    __tablename__ = "strategy_runs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), index=True)
    strategy: Mapped[str | None] = mapped_column(String)
    payload_json: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

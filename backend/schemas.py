from pydantic import BaseModel
from typing import Optional, Dict, Any


class OrderBase(BaseModel):
    symbol: Optional[str] = None
    qty: Optional[int] = None
    side: Optional[int] = None
    type: Optional[int] = None
    productType: Optional[str] = None
    limitPrice: Optional[float] = None
    stopPrice: Optional[float] = None


class OrderCreate(OrderBase):
    pass


class PositionBase(BaseModel):
    symbol: Optional[str] = None
    qty: Optional[int] = None
    avgPrice: Optional[float] = None
    pnl: Optional[float] = None


class TradeBase(BaseModel):
    symbol: Optional[str] = None
    qty: Optional[int] = None
    price: Optional[float] = None


class JournalEntry(BaseModel):
    symbol: Optional[str] = None
    strategy: Optional[str] = None
    notes: Optional[str] = None
    pnl: Optional[float] = None


class Settings(BaseModel):
    max_loss: Optional[float] = None
    max_trades: Optional[int] = None
    max_exposure: Optional[float] = None


class GenericResponse(BaseModel):
    success: bool = True
    message: Optional[str] = None
    data: Optional[Dict[str, Any]] = None

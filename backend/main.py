import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from .database import engine, Base
from .state import alerts, fyers
from .routes.auth_routes import router as auth_router
from .routes.trading_routes import router as trading_router
from .routes.paper_routes import router as paper_router
from .routes.paper_outcome_routes import router as paper_outcome_router
from .routes.misc_routes import router as misc_router
from .routes.settings_routes import router as settings_router
from .routes.bot_decision_routes import router as bot_decision_router
from .routes.report_routes import router as report_router
from .routes.journal_routes import router as journal_router
from .routes.watchlist_routes import router as watchlist_router
from .routes.alert_routes import router as alert_router
from .routes.scanner_strategy_routes import router as scanner_strategy_router
from .routes.analysis_routes import router as analysis_router

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("fno-backend")

@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    alerts.start(fyers, engine)

    log.info("Lifespan started")
    log.info("Fyers ready: %s", fyers.ready)

    yield

    await fyers.stop_feed()
    alerts.stop()


app = FastAPI(title="Market Research Terminal Backend", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(trading_router)
app.include_router(paper_router)
app.include_router(paper_outcome_router)
app.include_router(settings_router)
app.include_router(bot_decision_router)
app.include_router(report_router)
app.include_router(journal_router)
app.include_router(watchlist_router)
app.include_router(alert_router)
app.include_router(scanner_strategy_router)
app.include_router(misc_router)
app.include_router(analysis_router)

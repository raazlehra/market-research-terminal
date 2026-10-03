import unittest
import uuid

from sqlalchemy import create_engine, select
from sqlalchemy.dialects import sqlite
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from backend import models


class ReportQueryTests(unittest.TestCase):
    def test_closed_predicate_generates_boolean_sql_and_filters_open_rows(
        self,
    ) -> None:
        predicate = models.PaperTradeOutcome.closed.is_(True)
        statement = select(models.PaperTradeOutcome).where(predicate)
        compiled = str(
            statement.compile(
                dialect=sqlite.dialect(),
                compile_kwargs={"literal_binds": True},
            )
        )
        self.assertIn("paper_trade_outcomes.closed IS 1", compiled)

        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        models.Base.metadata.create_all(engine)
        user_id = uuid.uuid4()
        with Session(engine) as session:
            session.add_all(
                [
                    models.PaperTradeOutcome(
                        user_id=user_id,
                        order_id="closed",
                        closed=True,
                    ),
                    models.PaperTradeOutcome(
                        user_id=user_id,
                        order_id="open",
                        closed=False,
                    ),
                ]
            )
            session.commit()
            rows = session.scalars(statement).all()

        self.assertEqual([row.order_id for row in rows], ["closed"])
        engine.dispose()


if __name__ == "__main__":
    unittest.main()

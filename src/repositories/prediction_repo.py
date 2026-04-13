# -*- coding: utf-8 -*-
"""Prediction repository — DB access for prediction_runs table."""

from __future__ import annotations

import logging
from typing import List, Optional, Tuple

from sqlalchemy import desc, func, select

from src.storage import DatabaseManager, PredictionRun

logger = logging.getLogger(__name__)


class PredictionRepository:
    def __init__(self, db_manager: Optional[DatabaseManager] = None):
        self.db = db_manager or DatabaseManager.get_instance()

    def save_run(self, run: PredictionRun) -> PredictionRun:
        with self.db.get_session() as session:
            session.add(run)
            session.commit()
            session.refresh(run)
            return run

    def list_runs(
        self,
        *,
        code: Optional[str] = None,
        offset: int = 0,
        limit: int = 20,
    ) -> Tuple[List[PredictionRun], int]:
        with self.db.get_session() as session:
            conditions = []
            if code:
                conditions.append(PredictionRun.code == code)

            from sqlalchemy import and_
            where = and_(*conditions) if conditions else True

            total = session.execute(
                select(func.count(PredictionRun.id)).where(where)
            ).scalar() or 0

            rows = session.execute(
                select(PredictionRun)
                .where(where)
                .order_by(desc(PredictionRun.created_at))
                .offset(offset)
                .limit(limit)
            ).scalars().all()

            return list(rows), int(total)

    def get_run(self, run_id: int) -> Optional[PredictionRun]:
        with self.db.get_session() as session:
            return session.execute(
                select(PredictionRun).where(PredictionRun.id == run_id)
            ).scalar_one_or_none()

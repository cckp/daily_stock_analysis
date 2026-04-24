# -*- coding: utf-8 -*-
"""Scheduler repository — DB access for scheduler_task_configs / scheduler_task_runs."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import desc, func, select

from src.storage import DatabaseManager, SchedulerTaskConfig, SchedulerTaskRun

logger = logging.getLogger(__name__)


class SchedulerRepository:
    def __init__(self, db_manager: Optional[DatabaseManager] = None):
        self.db = db_manager or DatabaseManager.get_instance()

    # ------------------------------------------------------------------ #
    # TaskConfig                                                           #
    # ------------------------------------------------------------------ #

    def upsert_task_config(
        self,
        task_key: str,
        name: str,
        task_type: str,
        description: str = "",
        schedule_time: Optional[str] = None,
        interval_seconds: Optional[int] = None,
        enabled: bool = True,
    ) -> SchedulerTaskConfig:
        """Insert or update a task config row (keyed by task_key)."""
        with self.db.get_session() as session:
            existing = session.execute(
                select(SchedulerTaskConfig).where(SchedulerTaskConfig.task_key == task_key)
            ).scalar_one_or_none()

            if existing:
                existing.name = name
                existing.task_type = task_type
                if description:
                    existing.description = description
                if schedule_time is not None:
                    existing.schedule_time = schedule_time
                if interval_seconds is not None:
                    existing.interval_seconds = interval_seconds
                existing.updated_at = datetime.now()
                session.commit()
                session.refresh(existing)
                return existing
            else:
                cfg = SchedulerTaskConfig(
                    task_key=task_key,
                    name=name,
                    description=description,
                    task_type=task_type,
                    schedule_time=schedule_time,
                    interval_seconds=interval_seconds,
                    enabled=enabled,
                )
                session.add(cfg)
                session.commit()
                session.refresh(cfg)
                return cfg

    def list_task_configs(self) -> List[SchedulerTaskConfig]:
        with self.db.get_session() as session:
            return list(
                session.execute(
                    select(SchedulerTaskConfig).order_by(SchedulerTaskConfig.id)
                ).scalars().all()
            )

    def get_task_config(self, task_key: str) -> Optional[SchedulerTaskConfig]:
        with self.db.get_session() as session:
            return session.execute(
                select(SchedulerTaskConfig).where(SchedulerTaskConfig.task_key == task_key)
            ).scalar_one_or_none()

    def update_task_config(self, task_key: str, updates: Dict[str, Any]) -> Optional[SchedulerTaskConfig]:
        """Partial update — only keys present in `updates` are written."""
        allowed = {"name", "description", "schedule_time", "interval_seconds", "enabled"}
        with self.db.get_session() as session:
            cfg = session.execute(
                select(SchedulerTaskConfig).where(SchedulerTaskConfig.task_key == task_key)
            ).scalar_one_or_none()
            if cfg is None:
                return None
            for k, v in updates.items():
                if k in allowed:
                    setattr(cfg, k, v)
            cfg.updated_at = datetime.now()
            session.commit()
            session.refresh(cfg)
            return cfg

    # ------------------------------------------------------------------ #
    # TaskRun                                                              #
    # ------------------------------------------------------------------ #

    def start_run(
        self,
        task_key: str,
        task_name: str,
        triggered_by: str = "scheduler",
    ) -> SchedulerTaskRun:
        """Record that a task has started; returns the new run row."""
        with self.db.get_session() as session:
            run = SchedulerTaskRun(
                task_key=task_key,
                task_name=task_name,
                started_at=datetime.now(),
                status="running",
                triggered_by=triggered_by,
            )
            session.add(run)
            session.commit()
            session.refresh(run)
            return run

    def finish_run(
        self,
        run_id: int,
        status: str,
        error_msg: Optional[str] = None,
    ) -> None:
        """Update a run row when the task finishes (success or error)."""
        with self.db.get_session() as session:
            run = session.execute(
                select(SchedulerTaskRun).where(SchedulerTaskRun.id == run_id)
            ).scalar_one_or_none()
            if run is None:
                return
            finished = datetime.now()
            run.finished_at = finished
            run.status = status
            if run.started_at:
                run.duration_seconds = (finished - run.started_at).total_seconds()
            if error_msg:
                run.error_msg = error_msg[:2000]
            session.commit()

    def list_runs(
        self,
        task_key: Optional[str] = None,
        offset: int = 0,
        limit: int = 30,
    ) -> Tuple[List[SchedulerTaskRun], int]:
        with self.db.get_session() as session:
            conditions = []
            if task_key:
                conditions.append(SchedulerTaskRun.task_key == task_key)

            from sqlalchemy import and_
            where = and_(*conditions) if conditions else True

            total = session.execute(
                select(func.count(SchedulerTaskRun.id)).where(where)
            ).scalar() or 0

            rows = session.execute(
                select(SchedulerTaskRun)
                .where(where)
                .order_by(desc(SchedulerTaskRun.started_at))
                .offset(offset)
                .limit(limit)
            ).scalars().all()

            return list(rows), int(total)

    def get_last_run(self, task_key: str) -> Optional[SchedulerTaskRun]:
        with self.db.get_session() as session:
            return session.execute(
                select(SchedulerTaskRun)
                .where(SchedulerTaskRun.task_key == task_key)
                .order_by(desc(SchedulerTaskRun.started_at))
                .limit(1)
            ).scalar_one_or_none()

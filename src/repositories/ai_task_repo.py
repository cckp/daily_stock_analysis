# -*- coding: utf-8 -*-
"""Repository for AI scheduled tasks (CRUD)."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import List, Optional

logger = logging.getLogger(__name__)


class AITaskRepository:
    """CRUD operations for AIScheduledTask."""

    def _get_session(self):
        from src.storage import DatabaseManager
        return DatabaseManager.get_instance().get_session()

    def create_task(
        self,
        name: str,
        prompt: str,
        task_type: str = "daily",
        schedule_time: Optional[str] = None,
        interval_seconds: Optional[int] = None,
        enabled: bool = True,
        notify_on_finish: bool = True,
        description: Optional[str] = None,
    ):
        """Insert a new AI scheduled task and return it."""
        from src.storage import AIScheduledTask
        task_key = f"ai_{uuid.uuid4().hex[:12]}"
        now = datetime.now()
        task = AIScheduledTask(
            task_key=task_key,
            name=name,
            description=description,
            prompt=prompt,
            task_type=task_type,
            schedule_time=schedule_time,
            interval_seconds=interval_seconds,
            enabled=enabled,
            notify_on_finish=notify_on_finish,
            created_at=now,
            updated_at=now,
        )
        with self._get_session() as session:
            session.add(task)
            session.commit()
            session.refresh(task)
            # Detach from session so it can be used outside
            session.expunge(task)
        return task

    def list_tasks(self, enabled_only: bool = False):
        """Return all AI tasks, optionally filtered to enabled ones only."""
        from src.storage import AIScheduledTask
        from sqlalchemy import select
        stmt = select(AIScheduledTask).order_by(AIScheduledTask.id)
        if enabled_only:
            stmt = stmt.where(AIScheduledTask.enabled == True)  # noqa: E712
        with self._get_session() as session:
            rows = session.execute(stmt).scalars().all()
            result = []
            for row in rows:
                session.expunge(row)
                result.append(row)
        return result

    def get_task(self, task_key: str) -> Optional[object]:
        """Return a single task by task_key, or None."""
        from src.storage import AIScheduledTask
        from sqlalchemy import select
        stmt = select(AIScheduledTask).where(AIScheduledTask.task_key == task_key)
        with self._get_session() as session:
            row = session.execute(stmt).scalar_one_or_none()
            if row is not None:
                session.expunge(row)
            return row

    def update_task(self, task_key: str, updates: dict) -> Optional[object]:
        """Apply a partial update dict to the task. Returns updated task or None."""
        from src.storage import AIScheduledTask
        from sqlalchemy import select
        allowed = {
            "name", "description", "prompt", "task_type",
            "schedule_time", "interval_seconds", "enabled", "notify_on_finish",
        }
        filtered = {k: v for k, v in updates.items() if k in allowed}
        if not filtered:
            return self.get_task(task_key)
        filtered["updated_at"] = datetime.now()
        stmt = select(AIScheduledTask).where(AIScheduledTask.task_key == task_key)
        with self._get_session() as session:
            row = session.execute(stmt).scalar_one_or_none()
            if row is None:
                return None
            for k, v in filtered.items():
                setattr(row, k, v)
            session.commit()
            session.refresh(row)
            session.expunge(row)
            return row

    def delete_task(self, task_key: str) -> bool:
        """Delete a task by task_key. Returns True if deleted."""
        from src.storage import AIScheduledTask
        from sqlalchemy import select
        stmt = select(AIScheduledTask).where(AIScheduledTask.task_key == task_key)
        with self._get_session() as session:
            row = session.execute(stmt).scalar_one_or_none()
            if row is None:
                return False
            session.delete(row)
        return True

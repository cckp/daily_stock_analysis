# -*- coding: utf-8 -*-
"""
AI 智能定时任务调度器

职责：
1. 维护所有已启用 AI 任务的调度状态
2. 在独立后台线程中按时触发任务
3. 提供动态注册/注销 API（任务创建/更新/删除时调用）
4. 与 src.scheduler._registry 集成，暴露 is_running / next_run 给 API
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

# ── 单例 ──────────────────────────────────────────────────────────────────────
_instance: Optional["AITaskScheduler"] = None
_instance_lock = threading.Lock()


def get_ai_task_scheduler() -> "AITaskScheduler":
    """Return the process-wide AITaskScheduler singleton."""
    global _instance
    if _instance is not None:
        return _instance
    with _instance_lock:
        if _instance is None:
            _instance = AITaskScheduler()
    return _instance


# ── Scheduler ─────────────────────────────────────────────────────────────────

class AITaskScheduler:
    """
    Background scheduler for AI tasks.

    Each registered task is tracked as::

        {
            "task_key": str,
            "task_type": "daily" | "interval",
            "schedule_time": "HH:MM" | None,
            "interval_seconds": int | None,
            "next_run_ts": float,   # epoch seconds
            "is_running": bool,
            "thread": Thread | None,
        }
    """

    def __init__(self) -> None:
        self._tasks: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.Lock()
        self._thread: Optional[threading.Thread] = None
        self._running = False

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def start(self) -> None:
        """Start the background loop (idempotent)."""
        if self._thread and self._thread.is_alive():
            return
        self._running = True
        self._thread = threading.Thread(
            target=self._loop,
            daemon=True,
            name="ai-task-scheduler",
        )
        self._thread.start()
        logger.info("[AITaskScheduler] 后台调度线程已启动")

    def stop(self) -> None:
        self._running = False

    def load_all_enabled(self) -> None:
        """Load all enabled AI tasks from DB and register them."""
        try:
            from src.repositories.ai_task_repo import AITaskRepository
            tasks = AITaskRepository().list_tasks(enabled_only=True)
            for task in tasks:
                self.register(task)
            logger.info("[AITaskScheduler] 已加载 %d 个启用的 AI 任务", len(tasks))
        except Exception as exc:
            logger.warning("[AITaskScheduler] 加载 AI 任务失败（已忽略）: %s", exc)

    # ── Registration ─────────────────────────────────────────────────────────

    def register(self, task) -> None:
        """Register or re-register a task (replaces any existing entry)."""
        if not task.enabled:
            self.unregister(task.task_key)
            return

        next_ts = self._compute_next_run(task)
        if next_ts is None:
            logger.warning(
                "[AITaskScheduler] 任务 %r 缺少调度配置，跳过注册", task.task_key
            )
            return

        with self._lock:
            existing = self._tasks.get(task.task_key, {})
            self._tasks[task.task_key] = {
                "task_key": task.task_key,
                "task_type": task.task_type,
                "schedule_time": task.schedule_time,
                "interval_seconds": task.interval_seconds,
                "next_run_ts": next_ts,
                "is_running": existing.get("is_running", False),
                "thread": existing.get("thread"),
            }

        # Sync next_run to global registry
        from src.scheduler import _registry_set
        _registry_set(
            task.task_key,
            next_run=datetime.fromtimestamp(next_ts),
            is_running=False,
        )
        logger.info(
            "[AITaskScheduler] 已注册任务 %r，下次执行: %s",
            task.task_key,
            datetime.fromtimestamp(next_ts).strftime("%Y-%m-%d %H:%M:%S"),
        )

    def unregister(self, task_key: str) -> None:
        """Remove a task from the scheduler."""
        with self._lock:
            self._tasks.pop(task_key, None)
        logger.info("[AITaskScheduler] 已移除任务 %r", task_key)

    # ── Runtime status ────────────────────────────────────────────────────────

    def get_status(self, task_key: str) -> Dict[str, Any]:
        """Return runtime status dict for a task key."""
        with self._lock:
            entry = self._tasks.get(task_key)
        if entry is None:
            return {"next_run": None, "is_running": False}
        next_dt = datetime.fromtimestamp(entry["next_run_ts"]) if entry["next_run_ts"] else None
        return {
            "next_run": next_dt.isoformat(sep=" ", timespec="seconds") if next_dt else None,
            "is_running": entry.get("is_running", False),
        }

    # ── Internal loop ─────────────────────────────────────────────────────────

    def _loop(self) -> None:
        while self._running:
            try:
                self._tick()
            except Exception as exc:
                logger.exception("[AITaskScheduler] 调度循环异常: %s", exc)
            time.sleep(30)

    def _tick(self) -> None:
        now = time.time()
        with self._lock:
            candidates = [
                (key, dict(entry))
                for key, entry in self._tasks.items()
                if not entry.get("is_running")
                and entry.get("next_run_ts", float("inf")) <= now
            ]

        for task_key, entry in candidates:
            # Double-check under lock before launching
            with self._lock:
                current = self._tasks.get(task_key)
                if current is None or current.get("is_running"):
                    continue
                current["is_running"] = True

            t = threading.Thread(
                target=self._run_task,
                args=(task_key,),
                daemon=True,
                name=f"ai-task-{task_key}",
            )
            with self._lock:
                if task_key in self._tasks:
                    self._tasks[task_key]["thread"] = t
            t.start()

    def _run_task(self, task_key: str) -> None:
        try:
            from src.ai_task_runner import run_ai_task_by_key
            run_ai_task_by_key(task_key, triggered_by="scheduler")
        except Exception as exc:
            logger.error("[AITaskScheduler] 任务 %r 执行失败: %s", task_key, exc)
        finally:
            with self._lock:
                entry = self._tasks.get(task_key)
                if entry is not None:
                    entry["is_running"] = False
                    entry["thread"] = None
                    # Advance next_run
                    entry["next_run_ts"] = self._compute_next_run_from_entry(entry) or time.time() + 86400

    # ── Helpers ───────────────────────────────────────────────────────────────

    @staticmethod
    def _compute_next_run(task) -> Optional[float]:
        if task.task_type == "daily" and task.schedule_time:
            return AITaskScheduler._daily_next_ts(task.schedule_time)
        if task.task_type == "interval" and task.interval_seconds:
            return time.time() + task.interval_seconds
        return None

    @staticmethod
    def _compute_next_run_from_entry(entry: Dict[str, Any]) -> Optional[float]:
        if entry["task_type"] == "daily" and entry.get("schedule_time"):
            return AITaskScheduler._daily_next_ts(entry["schedule_time"])
        if entry["task_type"] == "interval" and entry.get("interval_seconds"):
            return time.time() + entry["interval_seconds"]
        return None

    @staticmethod
    def _daily_next_ts(schedule_time: str) -> float:
        """Return the next epoch timestamp for a daily HH:MM schedule."""
        try:
            hour, minute = map(int, schedule_time.split(":"))
        except (ValueError, AttributeError):
            return time.time() + 86400
        now = datetime.now()
        target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if target <= now:
            target += timedelta(days=1)
        return target.timestamp()

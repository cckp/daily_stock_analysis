# -*- coding: utf-8 -*-
"""
AI 智能定时任务执行器

职责：
1. 接收 AIScheduledTask 对象，将其 prompt 交给 AgentExecutor 执行
2. 记录执行开始/结束到 scheduler_task_runs 表
3. 执行完成后（可选）推送结果到配置的通知渠道
"""

from __future__ import annotations

import logging
from typing import Optional

logger = logging.getLogger(__name__)


def run_ai_task_by_key(task_key: str, triggered_by: str = "scheduler") -> str:
    """Load an AI task from DB by key and execute it."""
    from src.repositories.ai_task_repo import AITaskRepository
    task = AITaskRepository().get_task(task_key)
    if task is None:
        raise ValueError(f"AI task {task_key!r} not found")
    return run_ai_task(task, triggered_by=triggered_by)


def run_ai_task(task, triggered_by: str = "manual") -> str:
    """
    Execute an AI task via AgentExecutor.

    Args:
        task: AIScheduledTask ORM instance (detached)
        triggered_by: "scheduler" | "manual"

    Returns:
        The agent's text response.

    Raises:
        Exception on fatal errors (after recording failure in DB).
    """
    from src.repositories.scheduler_repo import SchedulerRepository
    from src.scheduler import _registry_set

    repo = SchedulerRepository()

    # ── DB: record run start ───────────────────────────────────────────────
    run_record = repo.start_run(
        task_key=task.task_key,
        task_name=task.name,
        triggered_by=triggered_by,
    )
    run_id: int = run_record.id

    # ── Registry: mark running ─────────────────────────────────────────────
    _registry_set(task.task_key, is_running=True)

    try:
        logger.info("[AITask] 开始执行任务 %r (run_id=%s, triggered_by=%s)", task.task_key, run_id, triggered_by)

        from src.agent.factory import build_agent_executor
        from src.config import get_config

        config = get_config()
        executor = build_agent_executor(config)

        session_id = f"ai_task_{task.task_key}_{run_id}"
        result = executor.chat(message=task.prompt, session_id=session_id)

        if result.success:
            content = result.content
            status = "success"
            error_msg: Optional[str] = None
        else:
            content = result.content or result.error or "Agent 执行失败（无详细信息）"
            status = "error"
            error_msg = result.error

        # ── 推送结果到通知渠道 ─────────────────────────────────────────────
        if task.notify_on_finish and result.success and content:
            _send_notification(task, content)

        repo.finish_run(run_id, status=status, error_msg=error_msg)
        logger.info("[AITask] 任务 %r 执行完成，状态: %s", task.task_key, status)
        return content

    except Exception as exc:
        logger.exception("[AITask] 任务 %r 执行异常: %s", task.task_key, exc)
        try:
            repo.finish_run(run_id, status="error", error_msg=str(exc))
        except Exception:
            pass
        raise

    finally:
        _registry_set(task.task_key, is_running=False)


def _send_notification(task, content: str) -> None:
    """Send task result to all configured notification channels."""
    try:
        from src.notification import NotificationService
        svc = NotificationService()
        if not svc.is_available():
            logger.debug("[AITask] 未配置通知渠道，跳过推送")
            return
        header = f"## AI任务完成：{task.name}\n\n"
        svc.send(header + content)
        logger.info("[AITask] 任务 %r 结果已推送到通知渠道", task.task_key)
    except Exception as exc:
        logger.warning("[AITask] 推送通知失败（已忽略）: %s", exc)

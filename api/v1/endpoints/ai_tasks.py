# -*- coding: utf-8 -*-
"""AI scheduled task endpoints — CRUD + manual trigger + run history."""

from __future__ import annotations

import logging
import threading
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Path, Query
from pydantic import BaseModel, Field

from api.v1.schemas.common import ErrorResponse

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────

class AITaskOut(BaseModel):
    id: int
    task_key: str
    name: str
    description: Optional[str] = None
    prompt: str
    task_type: str                          # "daily" | "interval"
    schedule_time: Optional[str] = None
    interval_seconds: Optional[int] = None
    enabled: bool
    notify_on_finish: bool
    next_run: Optional[str] = None          # ISO datetime string from scheduler
    is_running: bool = False
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class AITaskCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    prompt: str = Field(..., min_length=1)
    task_type: str = Field("daily", pattern="^(daily|interval)$")
    schedule_time: Optional[str] = Field(None, description="HH:MM，daily 任务必填")
    interval_seconds: Optional[int] = Field(None, ge=60, description="interval 任务必填，最小 60 秒")
    enabled: bool = True
    notify_on_finish: bool = True
    description: Optional[str] = None


class AITaskUpdateRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=128)
    prompt: Optional[str] = Field(None, min_length=1)
    task_type: Optional[str] = Field(None, pattern="^(daily|interval)$")
    schedule_time: Optional[str] = None
    interval_seconds: Optional[int] = Field(None, ge=60)
    enabled: Optional[bool] = None
    notify_on_finish: Optional[bool] = None
    description: Optional[str] = None


class AITaskListResponse(BaseModel):
    items: List[AITaskOut]


class TriggerAITaskResponse(BaseModel):
    run_id: int
    task_key: str
    task_name: str
    started_at: str
    status: str
    message: str


# ── Helpers ───────────────────────────────────────────────────────────────────

def _fmt(dt) -> Optional[str]:
    if dt is None:
        return None
    if hasattr(dt, "isoformat"):
        return dt.isoformat(sep=" ", timespec="seconds")
    return str(dt)


def _task_to_out(task) -> AITaskOut:
    from src.ai_task_scheduler import get_ai_task_scheduler
    status = get_ai_task_scheduler().get_status(task.task_key)
    return AITaskOut(
        id=task.id,
        task_key=task.task_key,
        name=task.name,
        description=task.description,
        prompt=task.prompt,
        task_type=task.task_type,
        schedule_time=task.schedule_time,
        interval_seconds=task.interval_seconds,
        enabled=task.enabled,
        notify_on_finish=task.notify_on_finish,
        next_run=status.get("next_run"),
        is_running=status.get("is_running", False),
        created_at=_fmt(task.created_at),
        updated_at=_fmt(task.updated_at),
    )


def _validate_schedule(task_type: str, schedule_time: Optional[str], interval_seconds: Optional[int]) -> None:
    import re
    if task_type == "daily":
        if not schedule_time:
            raise HTTPException(
                status_code=422,
                detail={"error": "validation_error", "message": "daily 类型任务必须提供 schedule_time (HH:MM)"},
            )
        if not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", schedule_time.strip()):
            raise HTTPException(
                status_code=422,
                detail={"error": "validation_error", "message": f"schedule_time {schedule_time!r} 格式无效，应为 HH:MM（24小时制）"},
            )
    elif task_type == "interval":
        if not interval_seconds or interval_seconds < 60:
            raise HTTPException(
                status_code=422,
                detail={"error": "validation_error", "message": "interval 类型任务必须提供 interval_seconds（≥60 秒）"},
            )


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get(
    "",
    response_model=AITaskListResponse,
    summary="获取所有 AI 定时任务",
)
def list_ai_tasks() -> AITaskListResponse:
    try:
        from src.repositories.ai_task_repo import AITaskRepository
        tasks = AITaskRepository().list_tasks()
        return AITaskListResponse(items=[_task_to_out(t) for t in tasks])
    except Exception as exc:
        logger.error("获取 AI 任务列表失败: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail={"error": "internal_error", "message": str(exc)})


@router.post(
    "",
    response_model=AITaskOut,
    status_code=201,
    summary="创建 AI 定时任务",
)
def create_ai_task(request: AITaskCreateRequest) -> AITaskOut:
    _validate_schedule(request.task_type, request.schedule_time, request.interval_seconds)
    try:
        from src.repositories.ai_task_repo import AITaskRepository
        from src.ai_task_scheduler import get_ai_task_scheduler
        repo = AITaskRepository()
        task = repo.create_task(
            name=request.name,
            prompt=request.prompt,
            task_type=request.task_type,
            schedule_time=request.schedule_time,
            interval_seconds=request.interval_seconds,
            enabled=request.enabled,
            notify_on_finish=request.notify_on_finish,
            description=request.description,
        )
        if task.enabled:
            get_ai_task_scheduler().register(task)
        return _task_to_out(task)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("创建 AI 任务失败: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail={"error": "internal_error", "message": str(exc)})


@router.get(
    "/{task_key}",
    response_model=AITaskOut,
    summary="获取单个 AI 定时任务",
)
def get_ai_task(task_key: str = Path(...)) -> AITaskOut:
    try:
        from src.repositories.ai_task_repo import AITaskRepository
        task = AITaskRepository().get_task(task_key)
        if task is None:
            raise HTTPException(status_code=404, detail={"error": "not_found", "message": f"任务 {task_key!r} 不存在"})
        return _task_to_out(task)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("获取 AI 任务失败: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail={"error": "internal_error", "message": str(exc)})


@router.put(
    "/{task_key}",
    response_model=AITaskOut,
    summary="更新 AI 定时任务",
)
def update_ai_task(
    task_key: str = Path(...),
    request: AITaskUpdateRequest = ...,
) -> AITaskOut:
    updates = {k: v for k, v in request.model_dump().items() if v is not None}

    # Validate schedule if relevant fields are being updated
    if "task_type" in updates or "schedule_time" in updates or "interval_seconds" in updates:
        from src.repositories.ai_task_repo import AITaskRepository
        existing = AITaskRepository().get_task(task_key)
        if existing is None:
            raise HTTPException(status_code=404, detail={"error": "not_found", "message": f"任务 {task_key!r} 不存在"})
        merged_type = updates.get("task_type", existing.task_type)
        merged_time = updates.get("schedule_time", existing.schedule_time)
        merged_interval = updates.get("interval_seconds", existing.interval_seconds)
        _validate_schedule(merged_type, merged_time, merged_interval)

    try:
        from src.repositories.ai_task_repo import AITaskRepository
        from src.ai_task_scheduler import get_ai_task_scheduler
        task = AITaskRepository().update_task(task_key, updates)
        if task is None:
            raise HTTPException(status_code=404, detail={"error": "not_found", "message": f"任务 {task_key!r} 不存在"})
        # Re-register (or unregister if disabled)
        get_ai_task_scheduler().register(task)
        return _task_to_out(task)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("更新 AI 任务失败: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail={"error": "internal_error", "message": str(exc)})


@router.delete(
    "/{task_key}",
    status_code=204,
    summary="删除 AI 定时任务",
    responses={
        404: {"description": "任务不存在", "model": ErrorResponse},
    },
)
def delete_ai_task(task_key: str = Path(...)) -> None:
    try:
        from src.repositories.ai_task_repo import AITaskRepository
        from src.ai_task_scheduler import get_ai_task_scheduler
        deleted = AITaskRepository().delete_task(task_key)
        if not deleted:
            raise HTTPException(status_code=404, detail={"error": "not_found", "message": f"任务 {task_key!r} 不存在"})
        get_ai_task_scheduler().unregister(task_key)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("删除 AI 任务失败: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail={"error": "internal_error", "message": str(exc)})


@router.post(
    "/{task_key}/run",
    response_model=TriggerAITaskResponse,
    responses={
        404: {"description": "任务不存在", "model": ErrorResponse},
        409: {"description": "任务正在运行中", "model": ErrorResponse},
    },
    summary="手动立即执行 AI 定时任务",
)
def trigger_ai_task(task_key: str = Path(...)) -> TriggerAITaskResponse:
    from src.repositories.ai_task_repo import AITaskRepository
    from src.repositories.scheduler_repo import SchedulerRepository
    from src.ai_task_scheduler import get_ai_task_scheduler
    from src.scheduler import _registry_set

    try:
        task = AITaskRepository().get_task(task_key)
        if task is None:
            raise HTTPException(
                status_code=404,
                detail={"error": "not_found", "message": f"AI 任务 {task_key!r} 不存在"},
            )

        status = get_ai_task_scheduler().get_status(task_key)
        if status.get("is_running"):
            raise HTTPException(
                status_code=409,
                detail={"error": "already_running", "message": "该任务正在运行中，请稍后再试"},
            )

        # Start DB run record
        run = SchedulerRepository().start_run(
            task_key=task_key,
            task_name=task.name,
            triggered_by="manual",
        )
        _registry_set(task_key, is_running=True)

        def _bg():
            try:
                from src.ai_task_runner import run_ai_task
                # run_ai_task will also call start_run + finish_run, so we need
                # to avoid double-recording. Use a lighter approach: just call
                # the agent + notify, then finish the run we already started.
                _do_run_and_finish(task, run.id)
            except Exception as exc:
                logger.error("[AITask manual] 任务 %r 执行失败: %s", task_key, exc)

        t = threading.Thread(target=_bg, daemon=True, name=f"ai-manual-{task_key}")
        t.start()

        return TriggerAITaskResponse(
            run_id=run.id,
            task_key=task_key,
            task_name=task.name,
            started_at=_fmt(run.started_at) or "",
            status="running",
            message=f"AI 任务「{task.name}」已开始在后台执行",
        )

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("手动触发 AI 任务失败: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail={"error": "internal_error", "message": str(exc)})


def _do_run_and_finish(task, run_id: int) -> None:
    """Execute AI task in background and update existing run record."""
    from src.repositories.scheduler_repo import SchedulerRepository
    from src.scheduler import _registry_set
    repo = SchedulerRepository()
    try:
        from src.agent.factory import build_agent_executor
        from src.config import get_config
        config = get_config()
        executor = build_agent_executor(config)
        result = executor.chat(
            message=task.prompt,
            session_id=f"ai_task_{task.task_key}_{run_id}",
        )
        content = result.content
        status = "success" if result.success else "error"
        error_msg = None if result.success else (result.error or "Agent 执行失败")

        if task.notify_on_finish and result.success and content:
            from src.ai_task_runner import _send_notification
            _send_notification(task, content)

        repo.finish_run(run_id, status=status, error_msg=error_msg)
    except Exception as exc:
        try:
            repo.finish_run(run_id, status="error", error_msg=str(exc))
        except Exception:
            pass
        raise
    finally:
        _registry_set(task.task_key, is_running=False)


@router.get(
    "/{task_key}/runs",
    summary="获取 AI 任务执行历史",
)
def list_ai_task_runs(
    task_key: str = Path(...),
    offset: int = Query(0, ge=0),
    limit: int = Query(30, ge=1, le=100),
):
    try:
        from src.repositories.scheduler_repo import SchedulerRepository
        runs, total = SchedulerRepository().list_runs(task_key=task_key, offset=offset, limit=limit)
        items = []
        for r in runs:
            items.append({
                "id": r.id,
                "task_key": r.task_key,
                "task_name": r.task_name,
                "started_at": _fmt(r.started_at) or "",
                "finished_at": _fmt(r.finished_at),
                "duration_seconds": r.duration_seconds,
                "status": r.status,
                "triggered_by": r.triggered_by,
                "error_msg": r.error_msg,
            })
        return {"items": items, "total": total, "offset": offset, "limit": limit}
    except Exception as exc:
        logger.error("获取 AI 任务执行历史失败: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail={"error": "internal_error", "message": str(exc)})

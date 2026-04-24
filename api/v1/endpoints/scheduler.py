# -*- coding: utf-8 -*-
"""Scheduler endpoints — task configs + run history + runtime status."""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Path, Query
from pydantic import BaseModel

from api.v1.schemas.common import ErrorResponse

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────

class TaskConfigOut(BaseModel):
    id: int
    task_key: str
    name: str
    description: Optional[str] = None
    task_type: str
    schedule_time: Optional[str] = None
    interval_seconds: Optional[int] = None
    enabled: bool
    next_run: Optional[str] = None    # ISO datetime string, from in-process registry
    is_running: bool = False
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class TaskConfigUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    schedule_time: Optional[str] = None
    interval_seconds: Optional[int] = None
    enabled: Optional[bool] = None


class TaskRunOut(BaseModel):
    id: int
    task_key: str
    task_name: Optional[str] = None
    started_at: str
    finished_at: Optional[str] = None
    duration_seconds: Optional[float] = None
    status: str
    triggered_by: Optional[str] = None
    error_msg: Optional[str] = None


class TaskRunListResponse(BaseModel):
    items: List[TaskRunOut]
    total: int
    offset: int
    limit: int


class TaskConfigListResponse(BaseModel):
    items: List[TaskConfigOut]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _fmt(dt) -> Optional[str]:
    if dt is None:
        return None
    if hasattr(dt, "isoformat"):
        return dt.isoformat(sep=" ", timespec="seconds")
    return str(dt)


def _config_to_out(cfg, registry: Dict[str, Any]) -> TaskConfigOut:
    reg = registry.get(cfg.task_key, {})
    next_run_dt = reg.get("next_run")
    return TaskConfigOut(
        id=cfg.id,
        task_key=cfg.task_key,
        name=cfg.name,
        description=cfg.description,
        task_type=cfg.task_type,
        schedule_time=cfg.schedule_time,
        interval_seconds=cfg.interval_seconds,
        enabled=cfg.enabled,
        next_run=_fmt(next_run_dt),
        is_running=bool(reg.get("is_running", False)),
        created_at=_fmt(cfg.created_at),
        updated_at=_fmt(cfg.updated_at),
    )


def _run_to_out(run) -> TaskRunOut:
    return TaskRunOut(
        id=run.id,
        task_key=run.task_key,
        task_name=run.task_name,
        started_at=_fmt(run.started_at) or "",
        finished_at=_fmt(run.finished_at),
        duration_seconds=run.duration_seconds,
        status=run.status,
        triggered_by=run.triggered_by,
        error_msg=run.error_msg,
    )


# ── Task config endpoints ─────────────────────────────────────────────────────

@router.get(
    "/tasks",
    response_model=TaskConfigListResponse,
    summary="获取所有定时任务配置",
)
def list_task_configs() -> TaskConfigListResponse:
    try:
        from src.repositories.scheduler_repo import SchedulerRepository
        from src.scheduler import get_scheduler_registry
        repo = SchedulerRepository()
        configs = repo.list_task_configs()
        registry = get_scheduler_registry()
        return TaskConfigListResponse(
            items=[_config_to_out(c, registry) for c in configs]
        )
    except Exception as exc:
        logger.error("获取任务配置失败: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail={"error": "internal_error", "message": str(exc)})


@router.put(
    "/tasks/{task_key}",
    response_model=TaskConfigOut,
    summary="更新定时任务配置",
)
def update_task_config(
    task_key: str = Path(..., description="任务唯一标识"),
    request: TaskConfigUpdateRequest = ...,
) -> TaskConfigOut:
    try:
        from src.repositories.scheduler_repo import SchedulerRepository
        from src.scheduler import get_scheduler_registry
        repo = SchedulerRepository()
        updates = {k: v for k, v in request.model_dump().items() if v is not None}
        cfg = repo.update_task_config(task_key, updates)
        if cfg is None:
            raise HTTPException(status_code=404, detail={"error": "not_found", "message": "任务不存在"})
        registry = get_scheduler_registry()
        return _config_to_out(cfg, registry)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("更新任务配置失败: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail={"error": "internal_error", "message": str(exc)})


# ── Manual trigger ───────────────────────────────────────────────────────────

class TriggerRunResponse(BaseModel):
    run_id: int
    task_key: str
    task_name: Optional[str] = None
    started_at: str
    status: str
    message: str


def _do_run_task(task_key: str, task_name: str, run_id: int) -> None:
    """后台线程：执行任务并更新 DB 记录。"""
    from src.repositories.scheduler_repo import SchedulerRepository
    repo = SchedulerRepository()
    try:
        if task_key == "daily_analysis":
            import argparse
            from src.config import get_config
            from main import run_full_analysis
            cfg = get_config()
            args = argparse.Namespace(
                dry_run=False,
                no_notify=False,
                single_notify=False,
                workers=None,
                no_context_snapshot=False,
                no_market_review=False,
                force_run=True,   # 手动触发：跳过交易日检查
            )
            run_full_analysis(cfg, args)
        else:
            # 未知 task_key — 记录错误即可
            raise ValueError(f"不支持手动触发的任务类型: {task_key}")

        repo.finish_run(run_id, status="success")
    except Exception as exc:
        logger.error("[ManualTrigger] 任务 %s 执行失败: %s", task_key, exc, exc_info=True)
        repo.finish_run(run_id, status="error", error_msg=str(exc))


@router.post(
    "/tasks/{task_key}/run",
    response_model=TriggerRunResponse,
    responses={
        200: {"description": "任务已触发，后台执行中"},
        404: {"description": "任务不存在", "model": ErrorResponse},
        409: {"description": "任务正在运行中", "model": ErrorResponse},
        500: {"description": "服务器错误", "model": ErrorResponse},
    },
    summary="手动触发定时任务",
    description="立即在后台执行指定任务，返回 run_id 可查询进度。",
)
def trigger_task(
    task_key: str = Path(..., description="任务唯一标识"),
) -> TriggerRunResponse:
    import threading
    from src.repositories.scheduler_repo import SchedulerRepository
    from src.scheduler import get_scheduler_registry

    try:
        repo = SchedulerRepository()

        # 检查任务配置是否存在
        cfg = repo.get_task_config(task_key)
        if cfg is None:
            raise HTTPException(
                status_code=404,
                detail={"error": "not_found", "message": f"任务 {task_key!r} 不存在"},
            )

        # 检查是否已在运行中（注册表 + DB 双重检查）
        registry = get_scheduler_registry()
        if registry.get(task_key, {}).get("is_running"):
            raise HTTPException(
                status_code=409,
                detail={"error": "already_running", "message": "该任务正在运行中，请稍后再试"},
            )

        # 写入 DB 起始记录
        run = repo.start_run(task_key=task_key, task_name=cfg.name, triggered_by="manual")

        # 更新注册表
        from src.scheduler import _registry_set
        _registry_set(task_key, is_running=True)

        # 启动后台线程
        t = threading.Thread(
            target=_do_run_task,
            args=(task_key, cfg.name, run.id),
            daemon=True,
            name=f"manual-trigger-{task_key}",
        )
        t.start()

        return TriggerRunResponse(
            run_id=run.id,
            task_key=task_key,
            task_name=cfg.name,
            started_at=_fmt(run.started_at) or "",
            status="running",
            message=f"任务「{cfg.name}」已开始在后台执行",
        )

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("手动触发任务失败: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail={"error": "internal_error", "message": str(exc)})


# ── Run history endpoints ─────────────────────────────────────────────────────

@router.get(
    "/runs",
    response_model=TaskRunListResponse,
    summary="获取任务执行历史",
)
def list_task_runs(
    task_key: Optional[str] = Query(None, description="按 task_key 过滤"),
    offset: int = Query(0, ge=0),
    limit: int = Query(30, ge=1, le=100),
) -> TaskRunListResponse:
    try:
        from src.repositories.scheduler_repo import SchedulerRepository
        repo = SchedulerRepository()
        runs, total = repo.list_runs(task_key=task_key, offset=offset, limit=limit)
        return TaskRunListResponse(
            items=[_run_to_out(r) for r in runs],
            total=total,
            offset=offset,
            limit=limit,
        )
    except Exception as exc:
        logger.error("获取任务执行历史失败: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail={"error": "internal_error", "message": str(exc)})

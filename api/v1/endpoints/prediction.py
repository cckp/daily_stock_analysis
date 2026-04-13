# -*- coding: utf-8 -*-
"""Prediction endpoint — AI 逐日涨跌预测。"""

from __future__ import annotations

import json
import logging
import threading
import uuid
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Path, Query
from api.v1.schemas.common import ErrorResponse
from api.v1.schemas.prediction import (
    PredictionRunRequest,
    PredictionRunResponse,
    PredictionItem,
    PredictionHistoryEntry,
    PredictionHistoryResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter()

# ─── In-memory async job store ───────────────────────────────────────────────
# job_id → {status: "running"|"done"|"error", result: dict|None, error: str|None}
_jobs: Dict[str, Dict[str, Any]] = {}
_jobs_lock = threading.Lock()


def _resolve_stock_name(code: str) -> Optional[str]:
    try:
        from src.data.stock_index_loader import get_index_stock_name
        name = get_index_stock_name(code)
        if name:
            return name
    except Exception:
        pass
    return None


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _run_to_response(result: dict) -> PredictionRunResponse:
    items = [PredictionItem(**item) for item in result.get("items", [])]
    return PredictionRunResponse(
        run_id=result.get("run_id"),
        code=result["code"],
        stock_name=result.get("stock_name"),
        skill_id=result.get("skill_id"),
        skill_name=result.get("skill_name"),
        start_date=result["start_date"],
        end_date=result["end_date"],
        lookback_days=result["lookback_days"],
        total=result["total"],
        completed=result["completed"],
        with_actual=result["with_actual"],
        accuracy_pct=result.get("accuracy_pct"),
        items=items,
    )


# ─── Synchronous run ──────────────────────────────────────────────────────────

@router.post(
    "/run",
    response_model=PredictionRunResponse,
    responses={
        200: {"description": "预测完成"},
        400: {"description": "参数错误", "model": ErrorResponse},
        500: {"description": "服务器错误", "model": ErrorResponse},
    },
    summary="AI 次日涨跌预测（同步）",
    description=(
        "对指定股票在日期范围内的每个交易日，基于历史 K 线和技术指标，"
        "用 AI 预测次日收盘方向（up / down / flat），并与真实结果对比。"
    ),
)
def run_prediction(request: PredictionRunRequest) -> PredictionRunResponse:
    if request.start_date > request.end_date:
        raise HTTPException(
            status_code=400,
            detail={"error": "invalid_params", "message": "start_date 不能晚于 end_date"},
        )

    try:
        from src.services.prediction_service import PredictionService
        service = PredictionService()
        result = service.run(
            code=request.code,
            start_date=request.start_date,
            end_date=request.end_date,
            skill_id=request.skill_id,
            lookback_days=request.lookback_days,
            max_dates=request.max_dates,
        )

        if result.get("error") and not result.get("items"):
            raise HTTPException(
                status_code=400,
                detail={"error": "data_error", "message": result["error"]},
            )

        return _run_to_response(result)

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("预测任务失败: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={"error": "internal_error", "message": f"预测失败: {exc}"},
        )


# ─── Async run ────────────────────────────────────────────────────────────────

@router.post(
    "/run-async",
    summary="AI 次日涨跌预测（异步后台）",
    description="立即返回 job_id，预测在后台运行，通过 /jobs/{job_id} 轮询结果。",
)
def run_prediction_async(request: PredictionRunRequest) -> dict:
    if request.start_date > request.end_date:
        raise HTTPException(
            status_code=400,
            detail={"error": "invalid_params", "message": "start_date 不能晚于 end_date"},
        )

    job_id = uuid.uuid4().hex[:10]
    stock_name = _resolve_stock_name(request.code)

    with _jobs_lock:
        _jobs[job_id] = {
            "status": "running",
            "result": None,
            "error": None,
            "code": request.code,
            "stock_name": stock_name,
            "start_date": request.start_date,
            "end_date": request.end_date,
            "skill_id": request.skill_id,
            "skill_name": None,
        }

    def _worker():
        try:
            from src.services.prediction_service import PredictionService
            service = PredictionService()
            result = service.run(
                code=request.code,
                start_date=request.start_date,
                end_date=request.end_date,
                skill_id=request.skill_id,
                lookback_days=request.lookback_days,
                max_dates=request.max_dates,
            )
            with _jobs_lock:
                _jobs[job_id]["status"] = "done"
                _jobs[job_id]["result"] = result
                _jobs[job_id]["skill_name"] = result.get("skill_name")
        except Exception as exc:
            logger.error("异步预测任务 %s 失败: %s", job_id, exc, exc_info=True)
            with _jobs_lock:
                _jobs[job_id]["status"] = "error"
                _jobs[job_id]["error"] = str(exc)

    t = threading.Thread(target=_worker, daemon=True)
    t.start()

    return {
        "job_id": job_id,
        "status": "running",
        "code": request.code,
        "stock_name": stock_name,
        "start_date": request.start_date,
        "end_date": request.end_date,
    }


@router.get(
    "/jobs",
    summary="获取所有异步预测任务列表",
)
def list_jobs() -> dict:
    with _jobs_lock:
        job_list = []
        for jid, job_data in _jobs.items():
            job_info = {
                "job_id": jid,
                "status": job_data["status"],
                "code": job_data["code"],
                "stock_name": job_data["stock_name"],
                "start_date": job_data["start_date"],
                "end_date": job_data["end_date"],
                "skill_id": job_data.get("skill_id"),
                "skill_name": job_data.get("skill_name"),
                "error": job_data.get("error"),
            }
            if job_data["status"] == "done" and job_data["result"]:
                result = job_data["result"]
                job_info["result"] = {
                    "run_id": result.get("run_id"),
                    "code": result["code"],
                    "stock_name": result.get("stock_name"),
                    "skill_id": result.get("skill_id"),
                    "skill_name": result.get("skill_name"),
                    "start_date": result["start_date"],
                    "end_date": result["end_date"],
                    "lookback_days": result["lookback_days"],
                    "total": result["total"],
                    "completed": result["completed"],
                    "with_actual": result["with_actual"],
                    "accuracy_pct": result.get("accuracy_pct"),
                    "items": result.get("items", []),
                }
            job_list.append(job_info)
        return {"jobs": job_list}


@router.get(
    "/jobs/{job_id}",
    summary="查询异步预测任务状态",
)
def get_job_status(job_id: str = Path(..., description="run-async 返回的 job_id")) -> dict:
    with _jobs_lock:
        job = _jobs.get(job_id)

    if job is None:
        raise HTTPException(status_code=404, detail={"error": "not_found", "message": "任务不存在"})

    resp: dict = {
        "job_id": job_id,
        "status": job["status"],
        "code": job["code"],
        "stock_name": job["stock_name"],
        "start_date": job["start_date"],
        "end_date": job["end_date"],
        "skill_id": job.get("skill_id"),
        "skill_name": job.get("skill_name"),
        "error": job.get("error"),
        "result": None,
    }

    if job["status"] == "done" and job["result"]:
        result = job["result"]
        resp["result"] = {
            "run_id": result.get("run_id"),
            "code": result["code"],
            "stock_name": result.get("stock_name"),
            "skill_id": result.get("skill_id"),
            "skill_name": result.get("skill_name"),
            "start_date": result["start_date"],
            "end_date": result["end_date"],
            "lookback_days": result["lookback_days"],
            "total": result["total"],
            "completed": result["completed"],
            "with_actual": result["with_actual"],
            "accuracy_pct": result.get("accuracy_pct"),
            "items": result.get("items", []),
        }

    return resp


# ─── History ──────────────────────────────────────────────────────────────────

@router.get(
    "/history",
    response_model=PredictionHistoryResponse,
    summary="查询历史预测记录",
)
def get_prediction_history(
    code: Optional[str] = Query(None, description="按股票代码过滤"),
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
) -> PredictionHistoryResponse:
    try:
        from src.repositories.prediction_repo import PredictionRepository
        from src.data.stock_index_loader import get_index_stock_name
        repo = PredictionRepository()
        runs, total = repo.list_runs(code=code, offset=offset, limit=limit)

        entries = []
        for r in runs:
            try:
                sname = get_index_stock_name(r.code)
            except Exception:
                sname = None
            entries.append(
                PredictionHistoryEntry(
                    run_id=r.id,
                    code=r.code,
                    stock_name=sname,
                    start_date=str(r.start_date),
                    end_date=str(r.end_date),
                    skill_id=r.skill_id,
                    skill_name=r.skill_name,
                    lookback_days=r.lookback_days or 60,
                    total=r.total or 0,
                    completed=r.completed or 0,
                    with_actual=r.with_actual or 0,
                    accuracy_pct=r.accuracy_pct,
                    created_at=r.created_at.strftime("%Y-%m-%d %H:%M:%S") if r.created_at else "",
                )
            )
        return PredictionHistoryResponse(items=entries, total=total, offset=offset, limit=limit)
    except Exception as exc:
        logger.error("查询预测历史失败: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={"error": "internal_error", "message": f"查询失败: {exc}"},
        )


@router.get(
    "/history/{run_id}",
    response_model=PredictionRunResponse,
    summary="获取单次历史预测的完整结果",
)
def get_prediction_run(run_id: int = Path(..., description="预测记录 ID")) -> PredictionRunResponse:
    try:
        from src.repositories.prediction_repo import PredictionRepository
        from src.data.stock_index_loader import get_index_stock_name
        repo = PredictionRepository()
        run = repo.get_run(run_id)
        if not run:
            raise HTTPException(status_code=404, detail={"error": "not_found", "message": "记录不存在"})

        try:
            sname = get_index_stock_name(run.code)
        except Exception:
            sname = None

        raw_items = json.loads(run.items_json or "[]")
        items = [PredictionItem(**item) for item in raw_items]
        return PredictionRunResponse(
            run_id=run.id,
            code=run.code,
            stock_name=sname,
            skill_id=run.skill_id,
            skill_name=run.skill_name,
            start_date=str(run.start_date),
            end_date=str(run.end_date),
            lookback_days=run.lookback_days or 60,
            total=run.total or 0,
            completed=run.completed or 0,
            with_actual=run.with_actual or 0,
            accuracy_pct=run.accuracy_pct,
            items=items,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("获取预测记录失败: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={"error": "internal_error", "message": f"获取失败: {exc}"},
        )

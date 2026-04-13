# -*- coding: utf-8 -*-
"""Prediction API schemas."""

from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class PredictionRunRequest(BaseModel):
    code: str = Field(..., description="股票代码，如 002342")
    start_date: str = Field(..., description="预测起始日期，格式 YYYY-MM-DD")
    end_date: str = Field(..., description="预测结束日期，格式 YYYY-MM-DD")
    skill_id: Optional[str] = Field(None, description="策略技能 ID，留空使用默认技术分析")
    lookback_days: int = Field(60, ge=20, le=120, description="每次分析使用多少天历史数据")
    max_dates: int = Field(20, ge=1, le=30, description="最多预测日期数（限速）")


class PredictionItem(BaseModel):
    date: str = Field(..., description="分析日期")
    close: Optional[float] = Field(None, description="当日收盘价")
    pct_chg: Optional[float] = Field(None, description="当日涨跌幅 %")

    # 关键技术指标
    ma5: Optional[float] = None
    ma10: Optional[float] = None
    ma20: Optional[float] = None
    macd_dif: Optional[float] = None
    macd_dea: Optional[float] = None
    macd_bar: Optional[float] = None
    rsi_6: Optional[float] = None
    rsi_12: Optional[float] = None
    volume_ratio_5d: Optional[float] = None
    trend_status: Optional[str] = None
    macd_status: Optional[str] = None

    # AI 预测
    prediction: Optional[str] = Field(None, description="预测方向: up / down / flat")
    confidence: Optional[float] = Field(None, description="置信度 0.0-1.0")
    reason: Optional[str] = Field(None, description="预测理由")

    # 实际结果（如果次日数据可用）
    actual_next_close: Optional[float] = Field(None, description="次日实际收盘价")
    actual_next_pct_chg: Optional[float] = Field(None, description="次日实际涨跌幅 %")
    actual_direction: Optional[str] = Field(None, description="次日实际方向: up / down / flat")
    correct: Optional[bool] = Field(None, description="预测是否正确")

    # 状态
    status: str = Field("completed", description="completed / error / skipped")
    error_msg: Optional[str] = None


class PredictionRunResponse(BaseModel):
    code: str
    stock_name: Optional[str] = Field(None, description="股票中文名称")
    skill_id: Optional[str] = None
    skill_name: Optional[str] = None
    start_date: str
    end_date: str
    lookback_days: int
    total: int = Field(..., description="总预测日数")
    completed: int = Field(..., description="成功预测数")
    with_actual: int = Field(..., description="有实际结果对比的数量")
    accuracy_pct: Optional[float] = Field(None, description="预测准确率 %（up/down）")
    items: List[PredictionItem] = Field(default_factory=list)
    run_id: Optional[int] = Field(None, description="持久化后的记录 ID")


class PredictionHistoryEntry(BaseModel):
    run_id: int
    code: str
    stock_name: Optional[str] = Field(None, description="股票中文名称")
    start_date: str
    end_date: str
    skill_id: Optional[str] = None
    skill_name: Optional[str] = None
    lookback_days: int
    total: int
    completed: int
    with_actual: int
    accuracy_pct: Optional[float] = None
    created_at: str


class PredictionHistoryResponse(BaseModel):
    items: List[PredictionHistoryEntry]
    total: int
    offset: int
    limit: int

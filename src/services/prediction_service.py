# -*- coding: utf-8 -*-
"""
AI 预测服务 — 基于历史 K 线 + 策略技能，逐日预测次日涨跌。

流程：
  1. 从数据提供层拉取股票历史日线数据
  2. 对日期范围内每一天，用该日前 lookback_days 根 K 线计算技术指标
  3. 将指标 + 近期 K 线摘要 + 策略 instructions 打包给 LLM
  4. 解析 LLM 返回的 JSON {prediction, confidence, reason}
  5. 与次日真实涨跌对比，计算准确率
"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

logger = logging.getLogger(__name__)

# 涨跌中性阈值（%）
_FLAT_THRESHOLD = 0.5


def _direction(pct: Optional[float]) -> Optional[str]:
    if pct is None:
        return None
    if pct > _FLAT_THRESHOLD:
        return "up"
    if pct < -_FLAT_THRESHOLD:
        return "down"
    return "flat"


class PredictionService:
    """逐日 AI 预测服务。"""

    def __init__(self):
        self._fetcher = None
        self._trend_analyzer = None
        self._llm = None

    # ------------------------------------------------------------------
    # Lazy singletons
    # ------------------------------------------------------------------

    def _get_fetcher(self):
        if self._fetcher is None:
            from data_provider import DataFetcherManager
            self._fetcher = DataFetcherManager()
        return self._fetcher

    def _get_trend_analyzer(self):
        if self._trend_analyzer is None:
            from src.stock_analyzer import StockTrendAnalyzer
            self._trend_analyzer = StockTrendAnalyzer()
        return self._trend_analyzer

    def _get_llm(self):
        if self._llm is None:
            from src.agent.llm_adapter import LLMToolAdapter
            self._llm = LLMToolAdapter()
        return self._llm

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    def run(
        self,
        *,
        code: str,
        start_date: str,
        end_date: str,
        skill_id: Optional[str] = None,
        lookback_days: int = 60,
        max_dates: int = 20,
    ) -> Dict[str, Any]:
        """
        对 [start_date, end_date] 范围内每个交易日做次日涨跌预测。

        Returns dict 对应 PredictionRunResponse。
        """
        skill_name, skill_instructions = self._load_skill(skill_id)
        stock_name = self._resolve_stock_name(code)

        # 拉取数据：需要 start_date 之前 lookback_days 个交易日 + end_date 之后 1 天
        fetch_start, fetch_end = self._calc_fetch_range(start_date, end_date, lookback_days)
        df = self._fetch_data(code, fetch_start, fetch_end)

        if df is None or df.empty:
            return self._empty_response(code, stock_name, skill_id, skill_name, start_date, end_date, lookback_days,
                                        error="无法获取股票数据，请检查股票代码或网络连接")

        df = df.sort_values("date").reset_index(drop=True)

        # 找出范围内的交易日（df 中实际存在的日期）
        target_dates = self._filter_target_dates(df, start_date, end_date, max_dates)
        if not target_dates:
            return self._empty_response(code, stock_name, skill_id, skill_name, start_date, end_date, lookback_days,
                                        error="指定日期范围内无交易日数据")

        import time as _time

        items = []
        for i, target_date in enumerate(target_dates):
            if i > 0:
                _time.sleep(0.5)  # 避免连续请求触发限流
            item = self._predict_one_day(
                df=df,
                code=code,
                target_date=target_date,
                lookback_days=lookback_days,
                skill_id=skill_id,
                skill_name=skill_name,
                skill_instructions=skill_instructions,
            )
            items.append(item)

        result = self._build_response(code, stock_name, skill_id, skill_name, start_date, end_date, lookback_days, items)
        self._persist_run(result)
        return result

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    @staticmethod
    def _persist_run(result: Dict[str, Any]) -> None:
        try:
            from datetime import datetime
            from src.storage import PredictionRun
            from src.repositories.prediction_repo import PredictionRepository

            run = PredictionRun(
                code=result["code"],
                start_date=datetime.strptime(result["start_date"], "%Y-%m-%d").date(),
                end_date=datetime.strptime(result["end_date"], "%Y-%m-%d").date(),
                skill_id=result.get("skill_id"),
                skill_name=result.get("skill_name"),
                lookback_days=result.get("lookback_days", 60),
                total=result.get("total", 0),
                completed=result.get("completed", 0),
                with_actual=result.get("with_actual", 0),
                accuracy_pct=result.get("accuracy_pct"),
                items_json=json.dumps(result.get("items", []), ensure_ascii=False),
            )
            PredictionRepository().save_run(run)
            result["run_id"] = run.id
        except Exception as exc:
            logger.warning("[PredictionService] 保存预测记录失败: %s", exc)

    # ------------------------------------------------------------------
    # Single-day prediction
    # ------------------------------------------------------------------

    def _predict_one_day(
        self,
        *,
        df: pd.DataFrame,
        code: str,
        target_date: str,
        lookback_days: int,
        skill_id: Optional[str],
        skill_name: str,
        skill_instructions: str,
    ) -> Dict[str, Any]:
        item: Dict[str, Any] = {"date": target_date, "status": "completed"}

        try:
            # --- 构建滑窗数据帧 ---
            idx = df.index[df["date"].astype(str) == target_date]
            if len(idx) == 0:
                item["status"] = "skipped"
                return item

            pos = int(idx[0])
            window_start = max(0, pos - lookback_days + 1)
            window_df = df.iloc[window_start: pos + 1].copy()

            if len(window_df) < 20:
                item["status"] = "skipped"
                item["error_msg"] = "历史数据不足 20 根，跳过"
                return item

            # --- 当日行情 ---
            today_row = df.iloc[pos]
            item["close"] = _safe_float(today_row.get("close"))
            item["pct_chg"] = _safe_float(today_row.get("pct_chg"))

            # --- 技术指标 ---
            ta = self._get_trend_analyzer()
            trend = ta.analyze(window_df, code)
            item.update({
                "ma5": round(trend.ma5, 3) if trend.ma5 else None,
                "ma10": round(trend.ma10, 3) if trend.ma10 else None,
                "ma20": round(trend.ma20, 3) if trend.ma20 else None,
                "macd_dif": round(trend.macd_dif, 4) if trend.macd_dif else None,
                "macd_dea": round(trend.macd_dea, 4) if trend.macd_dea else None,
                "macd_bar": round(trend.macd_bar, 4) if trend.macd_bar else None,
                "rsi_6": round(trend.rsi_6, 2) if trend.rsi_6 else None,
                "rsi_12": round(trend.rsi_12, 2) if trend.rsi_12 else None,
                "volume_ratio_5d": round(trend.volume_ratio_5d, 2) if trend.volume_ratio_5d else None,
                "trend_status": trend.trend_status.value if trend.trend_status else None,
                "macd_status": trend.macd_status.value if trend.macd_status else None,
            })

            # --- 近期 K 线摘要（最近 10 根）---
            recent = window_df.tail(10)
            kbars = _format_kbars(recent)

            # --- 组织技术摘要 ---
            tech_summary = _build_tech_summary(trend, item["close"])

            # --- 调用 LLM ---
            prediction, confidence, reason = self._call_llm(
                code=code,
                date_str=target_date,
                tech_summary=tech_summary,
                kbars=kbars,
                skill_instructions=skill_instructions,
                skill_name=skill_name,
            )
            item["prediction"] = prediction
            item["confidence"] = confidence
            item["reason"] = reason

            # --- 次日实际结果 ---
            next_pos = pos + 1
            if next_pos < len(df):
                next_row = df.iloc[next_pos]
                next_close = _safe_float(next_row.get("close"))
                next_pct = _safe_float(next_row.get("pct_chg"))
                actual_dir = _direction(next_pct)
                item["actual_next_close"] = next_close
                item["actual_next_pct_chg"] = next_pct
                item["actual_direction"] = actual_dir
                if prediction and actual_dir and prediction != "flat" and actual_dir != "flat":
                    item["correct"] = (prediction == actual_dir)
                elif prediction == "flat" and actual_dir == "flat":
                    item["correct"] = True
                else:
                    item["correct"] = None

        except Exception as exc:
            logger.error("[PredictionService] %s @ %s 预测失败: %s", code, target_date, exc)
            item["status"] = "error"
            item["error_msg"] = str(exc)

        return item

    # ------------------------------------------------------------------
    # LLM call
    # ------------------------------------------------------------------

    def _call_llm(
        self,
        *,
        code: str,
        date_str: str,
        tech_summary: str,
        kbars: str,
        skill_instructions: str,
        skill_name: str,
    ) -> Tuple[Optional[str], Optional[float], Optional[str]]:
        system_prompt = (
            "你是一名专业的量化交易分析师。\n"
            "根据提供的技术指标数据和策略规则，判断该股票次日（下一个交易日）收盘价相对今日收盘价的方向。\n\n"
            "你必须严格按照以下 JSON 格式回复，不得有任何多余文字：\n"
            '{"prediction": "up" | "down" | "flat", "confidence": 0.0到1.0, "reason": "简短中文理由（50字以内）"}\n\n'
            "说明：\n"
            "- up: 预测次日收盘价高于今日收盘价超过 0.5%\n"
            "- down: 预测次日收盘价低于今日收盘价超过 0.5%\n"
            "- flat: 预测涨跌幅在 -0.5% ~ +0.5% 之间\n"
            "- confidence: 你的判断置信度，0.5=中性，1.0=极度确定\n"
        )

        if skill_instructions:
            system_prompt += f"\n\n【策略：{skill_name}】\n{skill_instructions[:800]}"

        user_prompt = (
            f"股票代码：{code}，分析日期：{date_str}\n\n"
            f"【技术指标摘要】\n{tech_summary}\n\n"
            f"【近期 K 线（最新在最后）】\n{kbars}\n\n"
            "请基于以上数据，预测次日方向。"
        )

        import time as _time

        llm = self._get_llm()
        if not llm.is_available:
            return None, None, "LLM 未配置"

        last_err_reason = "LLM 调用或解析失败"

        for attempt in range(3):
            try:
                response = llm.call_text(
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    max_tokens=2000,
                    timeout=120.0,
                )
                content = (response.content or "").strip()
                logger.debug("[PredictionService] LLM raw content attempt=%d (len=%d): %r",
                             attempt + 1, len(content), content[:300])

                # 检测 LLMToolAdapter 自身返回的错误字符串
                if content.startswith("All LLM models failed"):
                    last_err_reason = content[:120]
                    logger.warning("[PredictionService] %s @ %s attempt=%d 模型全部失败: %s",
                                   code, date_str, attempt + 1, content[:200])
                    if attempt < 2:
                        _time.sleep(2 ** attempt)
                    continue

                # DeepSeek 思考模式下 content 可能为空，尝试从 reasoning_content 提取
                if not content and response.reasoning_content:
                    reasoning = (response.reasoning_content or "").strip()
                    last_brace = reasoning.rfind("}")
                    if last_brace >= 0:
                        first_brace = reasoning.rfind("{", 0, last_brace)
                        if first_brace >= 0:
                            content = reasoning[first_brace:last_brace + 1]

                # 尝试提取 JSON
                start = content.find("{")
                end = content.rfind("}") + 1
                if start >= 0 and end > start:
                    data = json.loads(content[start:end])
                    prediction = data.get("prediction", "flat")
                    if prediction not in ("up", "down", "flat"):
                        prediction = "flat"
                    confidence = float(data.get("confidence", 0.5))
                    confidence = max(0.0, min(1.0, confidence))
                    reason = str(data.get("reason", ""))[:200]
                    return prediction, confidence, reason

                last_err_reason = f"响应无 JSON (len={len(content)}): {content[:80]}"
                logger.warning("[PredictionService] %s @ %s attempt=%d 无法找到 JSON: %r",
                               code, date_str, attempt + 1, content[:200])
                if attempt < 2:
                    _time.sleep(2 ** attempt)

            except json.JSONDecodeError as e:
                last_err_reason = f"JSON 解析失败: {e}"
                logger.warning("[PredictionService] %s @ %s attempt=%d JSON 解析失败: %s",
                               code, date_str, attempt + 1, e)
                break  # JSON 解析失败重试意义不大
            except Exception as e:
                last_err_reason = f"{type(e).__name__}: {e}"
                logger.warning("[PredictionService] %s @ %s attempt=%d 异常: %s",
                               code, date_str, attempt + 1, e)
                if attempt < 2:
                    _time.sleep(2 ** attempt)

        return None, None, last_err_reason

    # ------------------------------------------------------------------
    # Skill loading
    # ------------------------------------------------------------------

    def _resolve_stock_name(self, code: str) -> Optional[str]:
        try:
            from src.data.stock_index_loader import get_index_stock_name
            name = get_index_stock_name(code)
            if name:
                return name
        except Exception:
            pass
        try:
            fetcher = self._get_fetcher()
            name = fetcher.get_stock_name(code)
            if name:
                return name
        except Exception:
            pass
        return None

    def _load_skill(self, skill_id: Optional[str]) -> Tuple[str, str]:
        if not skill_id:
            return "通用技术分析", ""
        try:
            from src.agent.factory import get_skill_manager
            sm = get_skill_manager()
            skill = sm.get(skill_id)
            if skill:
                return skill.display_name, skill.instructions or skill.description or ""
        except Exception as e:
            logger.warning("[PredictionService] 加载策略 %s 失败: %s", skill_id, e)
        return skill_id, ""

    # ------------------------------------------------------------------
    # Data fetching helpers
    # ------------------------------------------------------------------

    def _calc_fetch_range(self, start_date: str, end_date: str, lookback_days: int) -> Tuple[str, str]:
        try:
            sd = datetime.strptime(start_date, "%Y-%m-%d").date()
            ed = datetime.strptime(end_date, "%Y-%m-%d").date()
        except ValueError:
            return start_date, end_date
        # lookback_days 个交易日大约需要 lookback_days * 1.5 个自然日（含节假日）
        extra_calendar_days = int(lookback_days * 1.6) + 10
        fetch_start = (sd - timedelta(days=extra_calendar_days)).strftime("%Y-%m-%d")
        fetch_end = (ed + timedelta(days=5)).strftime("%Y-%m-%d")
        return fetch_start, fetch_end

    def _fetch_data(self, code: str, start_date: str, end_date: str) -> Optional[pd.DataFrame]:
        try:
            fetcher = self._get_fetcher()
            df, _ = fetcher.get_daily_data(
                stock_code=code,
                start_date=start_date,
                end_date=end_date,
                days=500,
            )
            return df
        except Exception as e:
            logger.error("[PredictionService] 数据获取失败 %s: %s", code, e)
            return None

    @staticmethod
    def _filter_target_dates(df: pd.DataFrame, start_date: str, end_date: str, max_dates: int) -> List[str]:
        dates = df["date"].astype(str).tolist()
        filtered = [d for d in dates if start_date <= d <= end_date]
        # 最多取 max_dates 个（均匀采样或取最后 max_dates 个）
        if len(filtered) > max_dates:
            filtered = filtered[-max_dates:]
        return filtered

    # ------------------------------------------------------------------
    # Response builders
    # ------------------------------------------------------------------

    @staticmethod
    def _build_response(
        code: str,
        stock_name: Optional[str],
        skill_id: Optional[str],
        skill_name: str,
        start_date: str,
        end_date: str,
        lookback_days: int,
        items: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        completed = sum(1 for i in items if i.get("status") == "completed")
        with_actual = sum(1 for i in items if i.get("actual_direction") is not None)
        # 只统计 up/down 预测的准确率（flat 不计入）
        judged = [
            i for i in items
            if i.get("correct") is not None
            and i.get("prediction") in ("up", "down")
        ]
        accuracy_pct = None
        if judged:
            correct_count = sum(1 for i in judged if i["correct"])
            accuracy_pct = round(correct_count / len(judged) * 100, 1)

        return {
            "code": code,
            "stock_name": stock_name,
            "skill_id": skill_id,
            "skill_name": skill_name,
            "start_date": start_date,
            "end_date": end_date,
            "lookback_days": lookback_days,
            "total": len(items),
            "completed": completed,
            "with_actual": with_actual,
            "accuracy_pct": accuracy_pct,
            "items": items,
        }

    @staticmethod
    def _empty_response(
        code: str,
        stock_name: Optional[str],
        skill_id: Optional[str],
        skill_name: str,
        start_date: str,
        end_date: str,
        lookback_days: int,
        error: str = "",
    ) -> Dict[str, Any]:
        return {
            "code": code,
            "stock_name": stock_name,
            "skill_id": skill_id,
            "skill_name": skill_name,
            "start_date": start_date,
            "end_date": end_date,
            "lookback_days": lookback_days,
            "total": 0,
            "completed": 0,
            "with_actual": 0,
            "accuracy_pct": None,
            "items": [],
            "error": error,
        }


# ------------------------------------------------------------------
# Formatting helpers
# ------------------------------------------------------------------

def _safe_float(v: Any) -> Optional[float]:
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _format_kbars(df: pd.DataFrame) -> str:
    rows = []
    for _, r in df.iterrows():
        date_str = str(r.get("date", ""))[:10]
        o = _safe_float(r.get("open"))
        h = _safe_float(r.get("high"))
        lo = _safe_float(r.get("low"))
        c = _safe_float(r.get("close"))
        vol = _safe_float(r.get("volume"))
        pct = _safe_float(r.get("pct_chg"))
        vol_str = f"{int(vol):,}" if vol else "N/A"
        pct_str = f"{pct:+.2f}%" if pct is not None else "N/A"
        rows.append(
            f"{date_str} | 开{o} 高{h} 低{lo} 收{c} | 量{vol_str} | {pct_str}"
        )
    return "\n".join(rows)


def _build_tech_summary(trend: Any, close: Optional[float]) -> str:
    lines = [
        f"当前价: {close}",
        f"趋势状态: {trend.trend_status.value if trend.trend_status else 'N/A'}",
        f"均线 MA5={trend.ma5:.3f}  MA10={trend.ma10:.3f}  MA20={trend.ma20:.3f}  MA60={trend.ma60:.3f}",
        f"乖离率 MA5偏离={trend.bias_ma5:.2f}%  MA10偏离={trend.bias_ma10:.2f}%",
        f"MACD DIF={trend.macd_dif:.4f}  DEA={trend.macd_dea:.4f}  MACD柱={trend.macd_bar:.4f}  状态: {trend.macd_status.value if trend.macd_status else 'N/A'}",
        f"RSI6={trend.rsi_6:.2f}  RSI12={trend.rsi_12:.2f}  RSI24={trend.rsi_24:.2f}  状态: {trend.rsi_status.value if trend.rsi_status else 'N/A'}",
        f"量能 5日量比={trend.volume_ratio_5d:.2f}  量能状态: {trend.volume_status.value if trend.volume_status else 'N/A'}",
        f"买卖信号: {trend.buy_signal.value if trend.buy_signal else 'N/A'}  综合评分: {trend.signal_score}",
    ]
    if trend.signal_reasons:
        lines.append("买入理由: " + " | ".join(trend.signal_reasons[:3]))
    if trend.risk_factors:
        lines.append("风险因素: " + " | ".join(trend.risk_factors[:3]))
    return "\n".join(lines)

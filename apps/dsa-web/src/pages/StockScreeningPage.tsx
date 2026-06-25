import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { screeningApi } from '../api/screening';
import { getParsedApiError } from '../api/error';
import type { ParsedApiError } from '../api/error';
import { ApiErrorAlert } from '../components/common';
import type { KLineWithIndicators, ScreeningHistoryItem, ScreeningHistoryPage, StockScreeningCriteria, StockScreeningResponse } from '../types/screening';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function fmt(v?: number | null, digits = 2): string {
  return v == null ? '--' : v.toFixed(digits);
}

function fmtCircMv(v?: number | null): string {
  if (v == null) return '--';
  const yi = v / 1e8;
  return `${yi.toFixed(2)} 亿`;
}

function fmtVolume(v?: number | null): string {
  if (v == null) return '--';
  if (v >= 1e8) return `${(v / 1e8).toFixed(2)} 亿手`;
  if (v >= 1e4) return `${(v / 1e4).toFixed(2)} 万手`;
  return `${v.toFixed(0)} 手`;
}

// ─────────────────────────────────────────────
// Candlestick SVG chart
// ─────────────────────────────────────────────

interface CandlestickChartProps {
  data: KLineWithIndicators[];
}

const CHART_PAD_LEFT = 56;
const CHART_PAD_RIGHT = 12;
const CHART_PAD_TOP = 12;
const CHART_PAD_BOTTOM = 24;
const Y_TICKS = 5;

function useDimensions(ref: React.RefObject<HTMLDivElement | null>) {
  const [dims, setDims] = useState({ width: 600, height: 280 });
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (e) setDims({ width: e.contentRect.width, height: e.contentRect.height });
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return dims;
}

const CandlestickChart: React.FC<CandlestickChartProps> = ({ data }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { width, height } = useDimensions(containerRef);

  if (!data.length) return <div className="flex h-full items-center justify-center text-sm text-muted-text">暂无数据</div>;

  const innerW = width - CHART_PAD_LEFT - CHART_PAD_RIGHT;
  const innerH = height - CHART_PAD_TOP - CHART_PAD_BOTTOM;

  // price range
  const prices = data.flatMap((d) => [d.open, d.high, d.low, d.close]);
  const rawMin = Math.min(...prices);
  const rawMax = Math.max(...prices);
  const pad = (rawMax - rawMin) * 0.08;
  const minP = rawMin - pad;
  const maxP = rawMax + pad;

  const toY = (p: number) => CHART_PAD_TOP + ((maxP - p) / (maxP - minP)) * innerH;
  const barW = innerW / data.length;
  const bodyW = Math.max(Math.floor(barW * 0.55), 2);
  const toX = (i: number) => CHART_PAD_LEFT + i * barW + barW / 2;

  // Y axis ticks
  const yTicks = Array.from({ length: Y_TICKS }, (_, i) => {
    const val = minP + (i / (Y_TICKS - 1)) * (maxP - minP);
    return { val, y: toY(val) };
  });

  // X axis labels (show ~6)
  const xStep = Math.max(1, Math.floor(data.length / 6));
  const xLabels = data
    .map((d, i) => ({ i, label: d.date.slice(5) }))
    .filter((_, i) => i % xStep === 0 || i === data.length - 1);

  // MA polyline helper
  const maLine = (key: keyof KLineWithIndicators, color: string) => {
    const pts = data
      .map((d, i) => {
        const v = d[key] as number | null | undefined;
        return v != null ? `${toX(i)},${toY(v)}` : null;
      })
      .filter(Boolean)
      .join(' ');
    return pts ? <polyline key={key} points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" /> : null;
  };

  return (
    <div ref={containerRef} className="h-full w-full">
      <svg width={width} height={height} className="overflow-visible">
        {/* Grid */}
        {yTicks.map(({ y }, i) => (
          <line key={i} x1={CHART_PAD_LEFT} y1={y} x2={width - CHART_PAD_RIGHT} y2={y} stroke="currentColor" strokeOpacity={0.08} strokeWidth={1} />
        ))}

        {/* Y axis labels */}
        {yTicks.map(({ val, y }, i) => (
          <text key={i} x={CHART_PAD_LEFT - 4} y={y} textAnchor="end" dominantBaseline="middle" className="fill-current text-[10px]" style={{ fill: 'var(--color-muted-text, #6b7280)', fontSize: 10 }}>
            {val.toFixed(2)}
          </text>
        ))}

        {/* X axis labels */}
        {xLabels.map(({ i, label }) => (
          <text key={i} x={toX(i)} y={height - 4} textAnchor="middle" style={{ fill: 'var(--color-muted-text, #6b7280)', fontSize: 10 }}>
            {label}
          </text>
        ))}

        {/* MA lines */}
        {maLine('ma5', '#f59e0b')}
        {maLine('ma30', '#818cf8')}

        {/* Candlesticks */}
        {data.map((d, i) => {
          const green = d.close >= d.open;
          const color = green ? '#ef4444' : '#22c55e';
          const cx = toX(i);
          const yHigh = toY(d.high);
          const yLow = toY(d.low);
          const yOpen = toY(d.open);
          const yClose = toY(d.close);
          const bodyTop = Math.min(yOpen, yClose);
          const bodyH = Math.max(Math.abs(yClose - yOpen), 1);
          return (
            <g key={d.date}>
              <line x1={cx} y1={yHigh} x2={cx} y2={yLow} stroke={color} strokeWidth={1} />
              <rect x={cx - bodyW / 2} y={bodyTop} width={bodyW} height={bodyH} fill={color} />
            </g>
          );
        })}

        {/* Legend */}
        <g transform={`translate(${CHART_PAD_LEFT + 4}, ${CHART_PAD_TOP + 2})`}>
          <rect width={10} height={2} y={4} fill="#f59e0b" />
          <text x={14} y={8} style={{ fill: '#f59e0b', fontSize: 10 }}>MA5</text>
          <rect width={10} height={2} y={4} x={48} fill="#818cf8" />
          <text x={62} y={8} style={{ fill: '#818cf8', fontSize: 10 }}>MA30</text>
        </g>
      </svg>
    </div>
  );
};

// ─────────────────────────────────────────────
// Criteria row
// ─────────────────────────────────────────────

const CRITERIA_LABELS: { key: keyof StockScreeningCriteria; label: string; desc: string }[] = [
  { key: 'changeAboveThreshold', label: '今日涨幅 > 3%', desc: '当日涨跌幅超过 3%' },
  { key: 'volumeRatioOk', label: '量比 > 1', desc: '量比大于 1（放量）' },
  { key: 'turnoverInRange', label: '换手率 5%–10%', desc: '换手率在合理活跃区间' },
  { key: 'circMvInRange', label: '流通市值 50–100 亿', desc: '中小市值股' },
  { key: 'notKcbCyb', label: '非创业板 & 非科创板', desc: '主板股票（不含 300/688）' },
  { key: 'priceIsLow', label: '股价 < 20 元', desc: '低价股' },
  { key: 'volumeModerateIncrease', label: '成交量温和放大', desc: '近10日成交量呈上升趋势' },
  { key: 'ma5GoldenCross', label: '5日线金叉', desc: '近5日内 MA5 上穿 MA10' },
  { key: 'ma30Uptrend', label: '30日线趋势向上', desc: '近5日 MA30 持续上升' },
  { key: 'closeAtDailyHigh', label: '尾盘创当日新高', desc: '收盘价 ≥ 当日最高价的 99.5%' },
  { key: 'volumeSurge', label: '成交量 ≥ 前10日均量1.5倍', desc: '当日成交量放大至前10个交易日均量的1.5倍以上' },
];

const CriteriaRow: React.FC<{ label: string; desc: string; value?: boolean | null }> = ({ label, desc, value }) => {
  const icon =
    value === true ? (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-success/20 text-success text-xs font-bold">✓</span>
    ) : value === false ? (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-danger/20 text-danger text-xs font-bold">✗</span>
    ) : (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/10 text-muted-text text-xs">–</span>
    );

  return (
    <div className="flex items-center gap-3 py-2 border-b border-white/5 last:border-0">
      {icon}
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${value === true ? 'text-foreground' : value === false ? 'text-secondary-text' : 'text-muted-text'}`}>
          {label}
        </p>
        <p className="text-xs text-muted-text">{desc}</p>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────
// Stat card
// ─────────────────────────────────────────────

const Stat: React.FC<{ label: string; value: string; accent?: 'up' | 'down' | 'neutral' }> = ({ label, value, accent }) => (
  <div className="flex flex-col gap-0.5">
    <span className="text-xs text-muted-text">{label}</span>
    <span className={`text-sm font-semibold tabular-nums ${accent === 'up' ? 'text-danger' : accent === 'down' ? 'text-success' : 'text-foreground'}`}>
      {value}
    </span>
  </div>
);

// ─────────────────────────────────────────────
// Volume chart
// ─────────────────────────────────────────────

const VolumeChart: React.FC<{ data: KLineWithIndicators[] }> = ({ data }) => {
  const chartData = data.map((d) => ({
    date: d.date.slice(5),
    volume: d.volume ?? 0,
    isGreen: d.close >= d.open,
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.06} />
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis
          tick={{ fontSize: 10, fill: '#6b7280' }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => v >= 1e4 ? `${(v / 1e4).toFixed(0)}万` : String(v)}
          width={44}
        />
        <Tooltip
          contentStyle={{ background: 'var(--color-card, #1e293b)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontSize: 12 }}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          formatter={(v: any) => [`${(Number(v ?? 0) / 1e4).toFixed(2)} 万手`, '成交量'] as [string, string]}
          labelStyle={{ color: '#9ca3af' }}
        />
        <Bar dataKey="volume" maxBarSize={16}>
          {chartData.map((d, i) => (
            <Cell key={i} fill={d.isGreen ? '#ef4444' : '#22c55e'} fillOpacity={0.75} />
          ))}
        </Bar>
      </ComposedChart>
    </ResponsiveContainer>
  );
};

// ─────────────────────────────────────────────
// MACD chart
// ─────────────────────────────────────────────

const MACDChart: React.FC<{ data: KLineWithIndicators[] }> = ({ data }) => {
  const chartData = data.map((d) => ({
    date: d.date.slice(5),
    dif: d.dif ?? null,
    dea: d.dea ?? null,
    histogram: d.macdHistogram ?? null,
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.06} />
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false} width={44} />
        <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" />
        <Tooltip
          contentStyle={{ background: 'var(--color-card, #1e293b)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: '#9ca3af' }}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          formatter={(v: any, name: any) => [v != null ? Number(v).toFixed(4) : '--', String(name).toUpperCase()] as [string, string]}
        />
        <Bar dataKey="histogram" maxBarSize={10} name="histogram">
          {chartData.map((d, i) => (
            <Cell key={i} fill={(d.histogram ?? 0) >= 0 ? '#ef4444' : '#22c55e'} fillOpacity={0.7} />
          ))}
        </Bar>
        <Line type="monotone" dataKey="dif" stroke="#f59e0b" dot={false} strokeWidth={1.5} name="dif" connectNulls />
        <Line type="monotone" dataKey="dea" stroke="#818cf8" dot={false} strokeWidth={1.5} name="dea" connectNulls />
      </ComposedChart>
    </ResponsiveContainer>
  );
};

// ─────────────────────────────────────────────
// Pagination
// ─────────────────────────────────────────────

const HistoryPagination: React.FC<{
  page: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}> = ({ page, total, pageSize, onPageChange }) => {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return null;

  const delta = 2;
  const pages: (number | '…')[] = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= page - delta && i <= page + delta)) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== '…') {
      pages.push('…');
    }
  }

  return (
    <div className="flex items-center justify-center gap-1 pt-2">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-sm text-secondary-text transition-colors hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        ‹
      </button>
      {pages.map((p, i) =>
        p === '…' ? (
          <span key={`ellipsis-${i}`} className="flex h-8 w-8 items-center justify-center text-sm text-muted-text">…</span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onPageChange(p)}
            className={`flex h-8 w-8 items-center justify-center rounded-lg text-sm tabular-nums transition-colors ${p === page ? 'bg-primary text-white font-semibold' : 'text-secondary-text hover:bg-white/10'}`}
          >
            {p}
          </button>
        )
      )}
      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-sm text-secondary-text transition-colors hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        ›
      </button>
      <span className="ml-2 text-xs text-muted-text">{page} / {totalPages} 页</span>
    </div>
  );
};

// ─────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────

function fmtRelativeTime(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

const StockScreeningPage: React.FC = () => {
  useEffect(() => { document.title = '选股筛选 - DSA'; }, []);

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ParsedApiError | null>(null);
  const [result, setResult] = useState<StockScreeningResponse | null>(null);
  const [history, setHistory] = useState<ScreeningHistoryItem[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchMsg, setBatchMsg] = useState('');
  const [historyPage, setHistoryPage] = useState(1);
  const [historyMeta, setHistoryMeta] = useState<Pick<ScreeningHistoryPage, 'total' | 'pageSize'>>({ total: 0, pageSize: 30 });
  const [minScore, setMinScore] = useState(0);

  const loadHistory = useCallback(async (page = 1, score = 0) => {
    try {
      const data = await screeningApi.getHistory(page, 30, score);
      setHistory(data.items);
      setHistoryMeta({ total: data.total, pageSize: data.pageSize });
      setHistoryPage(data.page);
    } catch {
      // history is non-critical, silently ignore
    }
  }, []);

  useEffect(() => { void loadHistory(1, minScore); }, [loadHistory, minScore]);

  const handleSearch = useCallback(async (codeToSearch: string) => {
    const trimmed = codeToSearch.trim().toUpperCase();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      const data = await screeningApi.getScreeningData(trimmed);
      setResult(data);
      void loadHistory(1);
    } catch (err) {
      setError(getParsedApiError(err));
    } finally {
      setLoading(false);
    }
  }, [loadHistory]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') void handleSearch(code);
  };

  const handleHistoryClick = useCallback(async (item: ScreeningHistoryItem) => {
    setCode(item.code);
    setLoading(true);
    setError(null);
    try {
      const data = await screeningApi.getHistoryDetail(item.id);
      setResult(data);
    } catch {
      // fallback: re-fetch live if stored data unavailable
      void handleSearch(item.code);
    } finally {
      setLoading(false);
    }
  }, [handleSearch]);

  const handleBatch = useCallback(async () => {
    setBatchRunning(true);
    setBatchMsg('');
    try {
      const { count, codes } = await screeningApi.runBatch();
      setBatchMsg(`已启动 ${count} 支（${codes.join('、')}），后台处理中…`);
      setTimeout(() => void loadHistory(1), 8000);
    } catch (err) {
      setBatchMsg('批量筛选启动失败');
    } finally {
      setBatchRunning(false);
    }
  }, [loadHistory]);

  const passCount = result
    ? CRITERIA_LABELS.filter(({ key }) => result.criteria[key] === true).length
    : 0;

  const changePct = result?.changePercent ?? null;
  const changeAccent = changePct == null ? 'neutral' : changePct > 0 ? 'up' : changePct < 0 ? 'down' : 'neutral';

  return (
    <div className="flex min-h-full flex-col gap-4 p-4">
      {/* Header / input */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold text-foreground">选股筛选</h1>
        <div className="flex flex-1 flex-wrap items-center gap-2 min-w-0">
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={handleKeyDown}
            placeholder="输入股票代码（如 600519）"
            disabled={loading}
            className="input-surface input-focus-glow h-10 max-w-xs flex-1 rounded-xl border bg-transparent px-4 text-sm transition-all focus:outline-none disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => void handleSearch(code)}
            disabled={loading || !code.trim()}
            className="btn-primary flex items-center gap-2 whitespace-nowrap"
          >
            {loading ? (
              <>
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                查询中…
              </>
            ) : (
              '查询'
            )}
          </button>
          <button
            type="button"
            onClick={() => void handleBatch()}
            disabled={batchRunning || loading}
            className="btn-secondary flex items-center gap-2 whitespace-nowrap"
          >
            {batchRunning ? (
              <>
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                批量中…
              </>
            ) : (
              '批量筛选'
            )}
          </button>
          {batchMsg && (
            <span className="text-xs text-muted-text">{batchMsg}</span>
          )}
        </div>
      </div>

      {error && <ApiErrorAlert error={error} />}

      {result && (
        <div className="flex flex-col gap-4 animate-fade-in">
          {/* Stock info bar */}
          <div className="dashboard-card flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
            <div className="min-w-0">
              <p className="text-base font-bold text-foreground">
                {result.stockName || result.stockCode}
                <span className="ml-2 text-sm font-normal text-secondary-text">{result.stockCode}</span>
              </p>
              <div className="mt-0.5 flex items-center gap-2">
                {result.isCyb && <span className="rounded-full bg-orange-500/20 px-2 py-0.5 text-[10px] text-orange-400">创业板</span>}
                {result.isKcb && <span className="rounded-full bg-cyan/20 px-2 py-0.5 text-[10px] text-cyan">科创板</span>}
                {!result.isCyb && !result.isKcb && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-secondary-text">主板</span>}
              </div>
            </div>
            <Stat label="当前价格" value={result.currentPrice != null ? `¥${fmt(result.currentPrice)}` : '--'} />
            <Stat label="今日涨跌" value={changePct != null ? `${changePct > 0 ? '+' : ''}${fmt(changePct)}%` : '--'} accent={changeAccent} />
            <Stat label="量比" value={fmt(result.volumeRatio)} />
            <Stat label="换手率" value={result.turnoverRate != null ? `${fmt(result.turnoverRate)}%` : '--'} />
            <Stat label="流通市值" value={fmtCircMv(result.circMv)} />
            <Stat label="成交量" value={fmtVolume(result.volume)} />
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-muted-text">满足条件</span>
              <span className={`text-2xl font-bold tabular-nums ${passCount >= 8 ? 'text-success' : passCount >= 5 ? 'text-warning' : 'text-danger'}`}>
                {passCount}
              </span>
              <span className="text-xs text-muted-text">/ 11</span>
            </div>
          </div>

          {/* Main content */}
          <div className="flex flex-col gap-4 lg:flex-row">
            {/* Left: criteria */}
            <div className="dashboard-card w-full px-5 py-4 lg:w-72 lg:flex-shrink-0">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-text">选股条件</p>
              {CRITERIA_LABELS.map(({ key, label, desc }) => (
                <CriteriaRow key={key} label={label} desc={desc} value={result.criteria[key]} />
              ))}
            </div>

            {/* Right: charts */}
            <div className="flex flex-1 flex-col gap-4 min-w-0">
              {/* K线图 */}
              <div className="dashboard-card px-4 py-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-text">
                  日K线 &nbsp;<span className="text-[#f59e0b]">— MA5</span>&nbsp;<span className="text-[#818cf8]">— MA30</span>
                </p>
                <div className="h-64">
                  <CandlestickChart data={result.klineData} />
                </div>
              </div>

              {/* 成交量 */}
              <div className="dashboard-card px-4 py-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-text">成交量</p>
                <div className="h-32">
                  <VolumeChart data={result.klineData} />
                </div>
              </div>

              {/* MACD */}
              <div className="dashboard-card px-4 py-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-text">
                  MACD &nbsp;<span className="text-[#f59e0b]">— DIF</span>&nbsp;<span className="text-[#818cf8]">— DEA</span>
                </p>
                <div className="h-32">
                  <MACDChart data={result.klineData} />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {!result && !loading && !error && (
        <div className="flex flex-1 flex-col gap-4">
          {history.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <div className="h-12 w-12 rounded-2xl bg-white/5 flex items-center justify-center">
                <svg className="h-6 w-6 text-muted-text" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <p className="text-sm text-muted-text">输入股票代码查看选股筛选分析</p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-text">
                  历史查询
                  <span className="ml-2 normal-case font-normal">（共 {historyMeta.total} 条）</span>
                </p>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-text">最低得分</span>
                  {[0, 6, 7, 8, 9, 10, 11].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setMinScore(s);
                        void loadHistory(1, s);
                      }}
                      className={`flex h-7 min-w-[2rem] items-center justify-center rounded-lg px-2 text-xs tabular-nums transition-colors ${
                        minScore === s
                          ? 'bg-primary text-white font-semibold'
                          : 'text-secondary-text hover:bg-white/10'
                      }`}
                    >
                      {s === 0 ? '全部' : `≥${s}`}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {history.map((item) => {
                  const pct = item.changePercent;
                  const passC = item.passCount ?? 0;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleHistoryClick(item)}
                      className="dashboard-card flex flex-col gap-2 px-4 py-3 text-left transition-all hover:ring-1 hover:ring-primary/40 cursor-pointer"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-foreground">{item.name || item.code}</p>
                          <p className="text-xs text-muted-text">{item.code}</p>
                        </div>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${passC >= 8 ? 'bg-success/20 text-success' : passC >= 5 ? 'bg-warning/20 text-warning' : 'bg-danger/20 text-danger'}`}>
                          {passC}/11
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className={`text-sm font-semibold tabular-nums ${pct == null ? 'text-muted-text' : pct > 0 ? 'text-danger' : pct < 0 ? 'text-success' : 'text-foreground'}`}>
                          {pct == null ? '--' : `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`}
                        </span>
                        <span className="text-xs text-muted-text">{fmtRelativeTime(item.queriedAt)}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
              {historyMeta.total > historyMeta.pageSize && (
                <HistoryPagination
                  page={historyPage}
                  total={historyMeta.total}
                  pageSize={historyMeta.pageSize}
                  onPageChange={(p) => void loadHistory(p, minScore)}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default StockScreeningPage;

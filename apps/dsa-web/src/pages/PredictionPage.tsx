import type React from 'react';
import { useState, useEffect, useCallback, useRef } from 'react';
import { TrendingUp, TrendingDown, Minus, CheckCircle, XCircle, History, ChevronDown, ChevronUp, Loader2, X } from 'lucide-react';
import { predictionApi } from '../api/prediction';
import { getParsedApiError } from '../api/error';
import type { ParsedApiError } from '../api/error';
import { ApiErrorAlert, Badge, Card, EmptyState } from '../components/common';
import type { PredictionHistoryEntry, PredictionItem, PredictionRunResponse, SkillOption, JobInfo } from '../types/prediction';

// ─── Shared input class (match BacktestPage) ─────────────────────────────────
const INPUT_CLASS =
  'input-surface input-focus-glow h-10 rounded-xl border bg-transparent px-3 py-2 text-xs transition-all focus:outline-none disabled:cursor-not-allowed disabled:opacity-60';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pct(value?: number | null, digits = 1): string {
  if (value == null) return '--';
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

function confidencePct(v?: number | null): string {
  if (v == null) return '--';
  return `${Math.round(v * 100)}%`;
}

function predictionBadge(p?: string | null) {
  if (!p) return <Badge variant="default">--</Badge>;
  if (p === 'up') return <Badge variant="success" glow><TrendingUp className="mr-1 inline h-3 w-3" />看涨</Badge>;
  if (p === 'down') return <Badge variant="danger" glow><TrendingDown className="mr-1 inline h-3 w-3" />看跌</Badge>;
  return <Badge variant="warning"><Minus className="mr-1 inline h-3 w-3" />震荡</Badge>;
}

function directionBadge(d?: string | null) {
  if (!d) return <span className="text-muted-text">--</span>;
  if (d === 'up') return <span className="font-mono text-success">▲ 涨</span>;
  if (d === 'down') return <span className="font-mono text-danger">▼ 跌</span>;
  return <span className="font-mono text-warning">— 平</span>;
}

function correctIcon(v?: boolean | null) {
  if (v === true) return <CheckCircle className="h-4 w-4 text-success" />;
  if (v === false) return <XCircle className="h-4 w-4 text-danger" />;
  return <Minus className="h-4 w-4 text-muted-text" />;
}

function trendLabel(s?: string | null): string {
  if (!s) return '--';
  return s;
}

// ─── Summary Card ─────────────────────────────────────────────────────────────

const SummaryCard: React.FC<{ result: PredictionRunResponse }> = ({ result }) => {
  const accuracyColor =
    result.accuracyPct == null ? 'text-secondary-text'
    : result.accuracyPct >= 60 ? 'text-success'
    : result.accuracyPct >= 45 ? 'text-warning'
    : 'text-danger';

  return (
    <Card variant="gradient" padding="md" className="animate-fade-in">
      <div className="mb-3">
        <span className="label-uppercase">预测汇总</span>
      </div>
      <div className="space-y-2">
        <div className="flex justify-between text-xs">
          <span className="text-secondary-text">股票</span>
          <span className="font-semibold">
            {result.stockName ? (
              <>
                <span className="font-mono">{result.code}</span>
                <span className="mx-1 text-muted-text">·</span>
                <span>{result.stockName}</span>
              </>
            ) : (
              <span className="font-mono">{result.code}</span>
            )}
          </span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-secondary-text">策略</span>
          <span className="font-semibold">{result.skillName || '通用技术分析'}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-secondary-text">总预测日数</span>
          <span className="font-mono">{result.total}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-secondary-text">成功预测</span>
          <span className="font-mono text-success">{result.completed}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-secondary-text">有实际对比</span>
          <span className="font-mono">{result.withActual}</span>
        </div>
        <div className="mt-3 border-t border-border/40 pt-3 flex justify-between items-center">
          <span className="text-xs text-secondary-text">预测准确率</span>
          <span className={`text-2xl font-bold font-mono ${accuracyColor}`}>
            {result.accuracyPct != null ? `${result.accuracyPct}%` : '--'}
          </span>
        </div>
        <p className="text-[10px] text-muted-text">仅统计明确看涨 / 看跌的预测，排除震荡和无次日数据</p>
      </div>
    </Card>
  );
};

// ─── Results Table ────────────────────────────────────────────────────────────

const ResultsTable: React.FC<{ items: PredictionItem[] }> = ({ items }) => (
  <div className="overflow-x-auto rounded-xl border border-border/50">
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-border/40 bg-surface/60">
          <th className="px-3 py-2.5 text-left font-medium text-secondary-text whitespace-nowrap">日期</th>
          <th className="px-3 py-2.5 text-right font-medium text-secondary-text whitespace-nowrap">收盘价</th>
          <th className="px-3 py-2.5 text-right font-medium text-secondary-text whitespace-nowrap">涨跌幅</th>
          <th className="px-3 py-2.5 text-left font-medium text-secondary-text whitespace-nowrap">趋势状态</th>
          <th className="px-3 py-2.5 text-right font-medium text-secondary-text whitespace-nowrap">MACD柱</th>
          <th className="px-3 py-2.5 text-right font-medium text-secondary-text whitespace-nowrap">RSI6</th>
          <th className="px-3 py-2.5 text-right font-medium text-secondary-text whitespace-nowrap">量比</th>
          <th className="px-3 py-2.5 text-center font-medium text-secondary-text whitespace-nowrap">AI预测</th>
          <th className="px-3 py-2.5 text-center font-medium text-secondary-text whitespace-nowrap">置信度</th>
          <th className="px-3 py-2.5 text-center font-medium text-secondary-text whitespace-nowrap">次日实际</th>
          <th className="px-3 py-2.5 text-right font-medium text-secondary-text whitespace-nowrap">次日涨跌</th>
          <th className="px-3 py-2.5 text-center font-medium text-secondary-text whitespace-nowrap">正确</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item, idx) => (
          <tr
            key={item.date}
            className={`border-b border-border/30 transition-colors hover:bg-hover/50 ${
              idx % 2 === 0 ? '' : 'bg-surface/30'
            } ${item.status === 'error' ? 'opacity-50' : ''}`}
          >
            <td className="px-3 py-2 font-mono text-secondary-text whitespace-nowrap">{item.date}</td>
            <td className="px-3 py-2 text-right font-mono">
              {item.close != null ? item.close.toFixed(2) : '--'}
            </td>
            <td className={`px-3 py-2 text-right font-mono ${
              (item.pctChg ?? 0) > 0 ? 'text-success' : (item.pctChg ?? 0) < 0 ? 'text-danger' : 'text-muted-text'
            }`}>
              {pct(item.pctChg)}
            </td>
            <td className="px-3 py-2 text-secondary-text whitespace-nowrap">
              {trendLabel(item.trendStatus)}
            </td>
            <td className={`px-3 py-2 text-right font-mono ${
              (item.macdBar ?? 0) > 0 ? 'text-success' : (item.macdBar ?? 0) < 0 ? 'text-danger' : 'text-muted-text'
            }`}>
              {item.macdBar != null ? item.macdBar.toFixed(4) : '--'}
            </td>
            <td className={`px-3 py-2 text-right font-mono ${
              (item.rsi6 ?? 50) > 70 ? 'text-danger' : (item.rsi6 ?? 50) < 30 ? 'text-success' : 'text-secondary-text'
            }`}>
              {item.rsi6 != null ? item.rsi6.toFixed(1) : '--'}
            </td>
            <td className="px-3 py-2 text-right font-mono text-secondary-text">
              {item.volumeRatio5d != null ? item.volumeRatio5d.toFixed(2) : '--'}
            </td>
            <td className="px-3 py-2 text-center">
              {item.status === 'error'
                ? <Badge variant="danger">错误</Badge>
                : predictionBadge(item.prediction)}
            </td>
            <td className="px-3 py-2 text-center font-mono text-secondary-text">
              {confidencePct(item.confidence)}
            </td>
            <td className="px-3 py-2 text-center">
              {directionBadge(item.actualDirection)}
            </td>
            <td className={`px-3 py-2 text-right font-mono ${
              (item.actualNextPctChg ?? 0) > 0 ? 'text-success' : (item.actualNextPctChg ?? 0) < 0 ? 'text-danger' : 'text-muted-text'
            }`}>
              {pct(item.actualNextPctChg)}
            </td>
            <td className="px-3 py-2 text-center">
              <div className="flex justify-center">{correctIcon(item.correct)}</div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

// ─── Reason Drawer ────────────────────────────────────────────────────────────

const ReasonList: React.FC<{ items: PredictionItem[] }> = ({ items }) => {
  const withReason = items.filter((i) => i.reason && i.status === 'completed');
  if (!withReason.length) return null;
  return (
    <Card variant="default" padding="md" className="animate-fade-in">
      <div className="mb-3">
        <span className="label-uppercase">AI 预测理由</span>
      </div>
      <div className="space-y-2.5">
        {withReason.map((item) => (
          <div key={item.date} className="flex gap-3 text-xs">
            <span className="shrink-0 font-mono text-muted-text w-24">{item.date}</span>
            <span className="shrink-0">{predictionBadge(item.prediction)}</span>
            <span className="text-secondary-text leading-relaxed">{item.reason}</span>
          </div>
        ))}
      </div>
    </Card>
  );
};

// ─── Running Jobs Panel ──────────────────────────────────────────────────────────

const RunningJobsPanel: React.FC<{
  jobs: JobInfo[];
  onViewResult: (result: PredictionRunResponse) => void;
  onRemoveJob: (jobId: string) => void;
}> = ({ jobs, onViewResult, onRemoveJob }) => {
  if (jobs.length === 0) return null;

  return (
    <Card variant="default" padding="md" className="animate-fade-in">
      <div className="mb-3 flex items-center justify-between">
        <span className="label-uppercase flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          后台预测任务
          <span className="ml-1 rounded-full bg-surface px-1.5 py-0.5 text-[10px] font-mono text-muted-text">
            {jobs.filter((j) => j.status === 'running').length} / {jobs.length}
          </span>
        </span>
      </div>
      <div className="space-y-2">
        {jobs.map((job) => (
          <div
            key={job.jobId}
            className="flex items-center justify-between rounded-lg border border-border/50 bg-surface/30 px-3 py-2 text-xs transition-colors hover:bg-surface/50"
          >
            <div className="flex items-center gap-3">
              {job.status === 'running' && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              )}
              {job.status === 'done' && (
                <CheckCircle className="h-3.5 w-3.5 text-success" />
              )}
              {job.status === 'error' && (
                <XCircle className="h-3.5 w-3.5 text-danger" />
              )}
              <div>
                <div className="font-mono font-semibold">
                  {job.code}
                  {job.stockName && (
                    <span className="ml-2 font-normal text-secondary-text">
                      {job.stockName}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-muted-text">
                  {job.startDate} ~ {job.endDate}
                  {job.skillName && ` · ${job.skillName}`}
                </div>
                {job.status === 'error' && job.error && (
                  <div className="mt-1 text-[10px] text-danger">{job.error}</div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {job.status === 'done' && job.result && (
                <button
                  type="button"
                  className="rounded-lg border border-border/50 px-2 py-1 text-[10px] text-secondary-text transition-colors hover:border-primary/50 hover:text-foreground"
                  onClick={() => onViewResult(job.result!)}
                >
                  查看结果
                </button>
              )}
              {job.status !== 'running' && (
                <button
                  type="button"
                  className="rounded-lg p-1 text-muted-text transition-colors hover:bg-surface hover:text-foreground"
                  onClick={() => onRemoveJob(job.jobId)}
                  title="移除"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
};

// ─── History Panel ───────────────────────────────────────────────────────────

function accuracyColor(pct?: number | null) {
  if (pct == null) return 'text-secondary-text';
  if (pct >= 60) return 'text-success';
  if (pct >= 45) return 'text-warning';
  return 'text-danger';
}

const HistoryPanel: React.FC<{
  onRestore: (runId: number, entry: PredictionHistoryEntry) => void;
}> = ({ onRestore }) => {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<PredictionHistoryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await predictionApi.getHistory({ limit: 30 });
      setEntries(res.items);
      setTotal(res.total);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  return (
    <Card variant="default" padding="md" className="animate-fade-in">
      <button
        type="button"
        className="flex w-full items-center justify-between"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex items-center gap-2 label-uppercase">
          <History className="h-3.5 w-3.5" />
          历史预测记录
          {total > 0 && (
            <span className="ml-1 rounded-full bg-surface px-1.5 py-0.5 text-[10px] font-mono text-muted-text">
              {total}
            </span>
          )}
        </span>
        {open ? <ChevronUp className="h-4 w-4 text-muted-text" /> : <ChevronDown className="h-4 w-4 text-muted-text" />}
      </button>

      {open && (
        <div className="mt-3">
          {loading ? (
            <p className="text-xs text-muted-text animate-pulse">加载中…</p>
          ) : entries.length === 0 ? (
            <p className="text-xs text-muted-text">暂无历史记录</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border/50">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/40 bg-surface/60">
                    <th className="px-3 py-2 text-left font-medium text-secondary-text whitespace-nowrap">时间</th>
                    <th className="px-3 py-2 text-left font-medium text-secondary-text whitespace-nowrap">代码</th>
                    <th className="px-3 py-2 text-left font-medium text-secondary-text whitespace-nowrap">日期范围</th>
                    <th className="px-3 py-2 text-left font-medium text-secondary-text whitespace-nowrap">策略</th>
                    <th className="px-3 py-2 text-right font-medium text-secondary-text whitespace-nowrap">预测数</th>
                    <th className="px-3 py-2 text-right font-medium text-secondary-text whitespace-nowrap">准确率</th>
                    <th className="px-3 py-2 text-center font-medium text-secondary-text whitespace-nowrap">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e, idx) => (
                    <tr
                      key={e.runId}
                      className={`border-b border-border/30 transition-colors hover:bg-hover/50 ${idx % 2 === 0 ? '' : 'bg-surface/30'}`}
                    >
                      <td className="px-3 py-2 font-mono text-muted-text whitespace-nowrap">{e.createdAt.slice(0, 16)}</td>
                      <td className="px-3 py-2">
                        {e.stockName ? (
                          <>
                            <span className="font-mono font-semibold">{e.code}</span>
                            <div className="text-[10px] text-muted-text">{e.stockName}</div>
                          </>
                        ) : (
                          <span className="font-mono font-semibold">{e.code}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-secondary-text whitespace-nowrap">{e.startDate} ~ {e.endDate}</td>
                      <td className="px-3 py-2 text-secondary-text">{e.skillName || '通用技术分析'}</td>
                      <td className="px-3 py-2 text-right font-mono text-secondary-text">{e.completed}/{e.total}</td>
                      <td className={`px-3 py-2 text-right font-mono font-semibold ${accuracyColor(e.accuracyPct)}`}>
                        {e.accuracyPct != null ? `${e.accuracyPct}%` : '--'}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button
                          type="button"
                          className="rounded-lg border border-border/50 px-2 py-1 text-[10px] text-secondary-text transition-colors hover:border-primary/50 hover:text-foreground"
                          onClick={() => onRestore(e.runId, e)}
                        >
                          查看
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Card>
  );
};

// ─── Main Page ────────────────────────────────────────────────────────────────

const PredictionPage: React.FC = () => {
  useEffect(() => {
    document.title = 'AI 预测 - DSA';
  }, []);

  // Form state
  const [code, setCode] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [skillId, setSkillId] = useState('');
  const [lookbackDays, setLookbackDays] = useState('60');
  const [maxDates, setMaxDates] = useState('20');

  // Skills
  const [skills, setSkills] = useState<SkillOption[]>([]);

  // Result state
  const [result, setResult] = useState<PredictionRunResponse | null>(null);
  const [runError, setRunError] = useState<ParsedApiError | null>(null);
  const [historyKey, setHistoryKey] = useState(0);
  const [jobs, setJobs] = useState<JobInfo[]>([]);
  const pollingIntervalRef = useRef<number | null>(null);

  // Load skills on mount
  useEffect(() => {
    predictionApi.getSkills().then(setSkills).catch(() => {});
  }, []);

  // Poll running jobs
  useEffect(() => {
    const runningJobs = jobs.filter((j) => j.status === 'running');

    if (runningJobs.length === 0) {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      return;
    }

    // Poll every 2 seconds
    const poll = async () => {
      for (const job of runningJobs) {
        try {
          const updated = await predictionApi.getJobStatus(job.jobId);
          setJobs((prev) =>
            prev.map((j) => (j.jobId === job.jobId ? updated : j))
          );

          // Refresh history when job completes
          if (updated.status === 'done') {
            setHistoryKey((k) => k + 1);
          }
        } catch (err) {
          console.error('Failed to poll job', job.jobId, err);
        }
      }
    };

    poll(); // Initial poll
    pollingIntervalRef.current = setInterval(poll, 2000);

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [jobs]);

  const handleRun = useCallback(async () => {
    if (!code.trim() || !startDate || !endDate) return;

    setRunError(null);

    try {
      const jobInfo = await predictionApi.runAsync({
        code: code.trim(),
        startDate,
        endDate,
        skillId: skillId || undefined,
        lookbackDays: lookbackDays ? parseInt(lookbackDays, 10) : 60,
        maxDates: maxDates ? parseInt(maxDates, 10) : 20,
      });

      // Add to jobs list
      setJobs((prev) => [jobInfo, ...prev]);
    } catch (err) {
      setRunError(getParsedApiError(err));
    }
  }, [code, startDate, endDate, skillId, lookbackDays, maxDates]);

  const handleViewResult = useCallback((data: PredictionRunResponse) => {
    setResult(data);
    setRunError(null);
  }, []);

  const handleRemoveJob = useCallback((jobId: string) => {
    setJobs((prev) => prev.filter((j) => j.jobId !== jobId));
  }, []);

  const handleRestore = useCallback(async (runId: number, entry: PredictionHistoryEntry) => {
    setCode(entry.code);
    setStartDate(entry.startDate);
    setEndDate(entry.endDate);
    setSkillId(entry.skillId ?? '');
    setLookbackDays(String(entry.lookbackDays));
    setRunError(null);
    setResult(null);
    try {
      const data = await predictionApi.getRun(runId);
      setResult(data);
    } catch (err) {
      setRunError(getParsedApiError(err));
    }
  }, []);

  const canRun = code.trim().length > 0 && startDate.length > 0 && endDate.length > 0;

  return (
    <div className="flex h-full flex-col">
      {/* ── Header ── */}
      <div className="shrink-0 border-b border-border/50 px-6 py-4">
        <h1 className="text-base font-semibold text-foreground">AI 次日涨跌预测</h1>
        <p className="mt-0.5 text-xs text-secondary-text">
          基于历史 K 线 + 技术指标 + 策略，逐日调用 AI 预测次日方向，并与真实结果对比验证
        </p>
        <p className="mt-1 text-[11px] text-muted-text">
          💡 预测逻辑：输入日期范围如 [4.1-4.12]，最后一个预测对象是 4.12，预测 4.13 的涨跌。前面日期的正确性可用于判断 4.13 预测的可信度。
        </p>
      </div>

      {/* ── Toolbar ── */}
      <div className="shrink-0 border-b border-border/40 bg-surface/40 px-6 py-3">
        <div className="flex flex-wrap items-end gap-3">
          {/* Stock code */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-muted-text">股票代码</label>
            <input
              className={`${INPUT_CLASS} w-28`}
              placeholder="如 002342"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>

          {/* Date range */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-muted-text">开始日期</label>
            <input
              type="date"
              className={`${INPUT_CLASS} w-36`}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-muted-text">结束日期</label>
            <input
              type="date"
              className={`${INPUT_CLASS} w-36`}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>

          {/* Skill selector */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-muted-text">策略技能</label>
            <select
              className={`${INPUT_CLASS} w-44`}
              value={skillId}
              onChange={(e) => setSkillId(e.target.value)}
            >
              <option value="">通用技术分析</option>
              {skills.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          {/* Lookback */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-muted-text">回看天数</label>
            <input
              className={`${INPUT_CLASS} w-20`}
              type="number"
              min={20}
              max={120}
              value={lookbackDays}
              onChange={(e) => setLookbackDays(e.target.value)}
            />
          </div>

          {/* Max dates */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-muted-text">最多日数</label>
            <input
              className={`${INPUT_CLASS} w-16`}
              type="number"
              min={1}
              max={30}
              value={maxDates}
              onChange={(e) => setMaxDates(e.target.value)}
            />
          </div>

          {/* Run button */}
          <button
            type="button"
            className="btn-primary h-10 px-5 text-xs disabled:opacity-50"
            disabled={!canRun}
            onClick={() => void handleRun()}
          >
            提交预测任务
          </button>
        </div>

        {jobs.filter((j) => j.status === 'running').length > 0 && (
          <p className="mt-2 text-[11px] text-muted-text">
            后台正在运行 {jobs.filter((j) => j.status === 'running').length} 个预测任务，可继续提交新任务
          </p>
        )}
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {runError && <ApiErrorAlert error={runError} />}

        <RunningJobsPanel
          jobs={jobs}
          onViewResult={handleViewResult}
          onRemoveJob={handleRemoveJob}
        />

        {!result && !runError && jobs.length === 0 && (
          <EmptyState
            icon={<TrendingUp className="h-10 w-10 text-muted-text" />}
            title="填写参数后点击「提交预测任务」"
            description="AI 将在后台读取历史 K 线和技术指标，对每个交易日预测次日涨跌方向，并与真实结果对比。可同时运行多个预测任务。"
          />
        )}

        {result && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[220px_1fr]">
              {/* Left: summary */}
              <div>
                <SummaryCard result={result} />
              </div>

              {/* Right: table */}
              <div className="min-w-0">
                {result.items.length === 0 ? (
                  <EmptyState
                    icon={<Minus className="h-8 w-8 text-muted-text" />}
                    title="无预测结果"
                    description="指定日期范围内没有可用数据，请调整参数重试"
                  />
                ) : (
                  <ResultsTable items={result.items} />
                )}
              </div>
            </div>

            {/* Full-width reason list */}
            {result.items.length > 0 && <ReasonList items={result.items} />}
          </div>
        )}

        <HistoryPanel key={historyKey} onRestore={(id, e) => void handleRestore(id, e)} />
      </div>
    </div>
  );
};

export default PredictionPage;

import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle, Clock, Play, RefreshCw, XCircle, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { systemConfigApi } from '../api/systemConfig';
import { getParsedApiError } from '../api/error';
import type { ParsedApiError } from '../api/error';
import { ApiErrorAlert, Badge, Card } from '../components/common';
import type { SchedulerTaskConfig, SchedulerTaskRun, SchedulerTaskRunListResponse } from '../types/systemConfig';

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDuration(secs?: number | null): string {
  if (secs == null) return '--';
  if (secs < 60) return `${secs.toFixed(0)}s`;
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function fmtDatetime(s?: string | null): string {
  if (!s) return '--';
  return s.replace('T', ' ').slice(0, 19);
}

function fmtInterval(secs?: number | null): string {
  if (secs == null) return '--';
  if (secs < 60) return `${secs} 秒`;
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h} 小时 ${rm} 分钟` : `${h} 小时`;
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'success') return <Badge variant="success"><CheckCircle className="mr-1 inline h-3 w-3" />成功</Badge>;
  if (status === 'error') return <Badge variant="danger"><XCircle className="mr-1 inline h-3 w-3" />失败</Badge>;
  return <Badge variant="warning"><Loader2 className="mr-1 inline h-3 w-3 animate-spin" />运行中</Badge>;
}

// ── Task Config Card ──────────────────────────────────────────────────────────

const TaskConfigCard: React.FC<{
  config: SchedulerTaskConfig;
  onToggle: (key: string, enabled: boolean) => Promise<void>;
  onTrigger: (key: string) => Promise<void>;
}> = ({ config, onToggle, onTrigger }) => {
  const [toggling, setToggling] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [triggerMsg, setTriggerMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const handleToggle = async () => {
    setToggling(true);
    try {
      await onToggle(config.taskKey, !config.enabled);
    } finally {
      setToggling(false);
    }
  };

  const handleTrigger = async () => {
    setTriggering(true);
    setTriggerMsg(null);
    try {
      await onTrigger(config.taskKey);
      setTriggerMsg({ ok: true, text: '已触发，后台执行中' });
    } catch {
      setTriggerMsg({ ok: false, text: '触发失败，请查看日志' });
    } finally {
      setTriggering(false);
      setTimeout(() => setTriggerMsg(null), 4000);
    }
  };

  const isRunning = config.isRunning || triggering;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border/50 bg-surface/60 px-4 py-3 transition-colors hover:border-border/80 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-text" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-foreground">{config.name}</span>
            {isRunning && (
              <Badge variant="warning">
                <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />运行中
              </Badge>
            )}
            {triggerMsg && (
              <span className={`text-[10px] font-medium ${triggerMsg.ok ? 'text-success' : 'text-danger'}`}>
                {triggerMsg.text}
              </span>
            )}
          </div>
          {config.description && (
            <p className="mt-0.5 text-xs text-muted-text">{config.description}</p>
          )}
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-secondary-text">
            {config.taskType === 'daily' && config.scheduleTime && (
              <span>每日 <span className="font-mono font-medium text-foreground">{config.scheduleTime}</span> 执行</span>
            )}
            {config.taskType === 'interval' && config.intervalSeconds != null && (
              <span>每隔 <span className="font-mono font-medium text-foreground">{fmtInterval(config.intervalSeconds)}</span> 执行</span>
            )}
            {config.nextRun && (
              <span>下次执行：<span className="font-mono">{fmtDatetime(config.nextRun)}</span></span>
            )}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Badge
          variant={config.taskType === 'daily' ? 'default' : 'warning'}
          className="border-border/40 bg-surface text-secondary-text"
        >
          {config.taskType === 'daily' ? '每日定时' : '间隔循环'}
        </Badge>

        {/* 立即执行按钮 */}
        <button
          type="button"
          disabled={isRunning}
          onClick={() => void handleTrigger()}
          title="立即执行"
          className="flex items-center gap-1 rounded-lg border border-border/50 px-2.5 py-1 text-[11px] text-secondary-text transition-colors hover:border-primary/60 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          {triggering
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : <Play className="h-3 w-3" />
          }
          立即执行
        </button>

        {/* 启用/禁用开关 */}
        <button
          type="button"
          disabled={toggling}
          onClick={() => void handleToggle()}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 ${
            config.enabled ? 'bg-primary' : 'bg-border'
          }`}
          aria-label={config.enabled ? '禁用任务' : '启用任务'}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
              config.enabled ? 'translate-x-[18px]' : 'translate-x-[2px]'
            }`}
          />
        </button>
      </div>
    </div>
  );
};

// ── Run History Table ─────────────────────────────────────────────────────────

const RunHistoryTable: React.FC<{
  runs: SchedulerTaskRun[];
  total: number;
  offset: number;
  limit: number;
  onPage: (offset: number) => void;
  loading: boolean;
  taskKey?: string;
  onFilterChange: (key: string | undefined) => void;
  taskKeys: string[];
}> = ({ runs, total, offset, limit, onPage, loading, taskKey, onFilterChange, taskKeys }) => {
  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-3">
      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          className="h-8 rounded-lg border border-border/50 bg-transparent px-2 text-xs text-secondary-text focus:outline-none focus:ring-1 focus:ring-primary/50"
          value={taskKey ?? ''}
          onChange={(e) => onFilterChange(e.target.value || undefined)}
        >
          <option value="">全部任务</option>
          {taskKeys.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
        {total > 0 && (
          <span className="text-xs text-muted-text">共 {total} 条记录</span>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-border/50">
        <table className="w-full text-xs">
          <colgroup>
            <col className="w-[30%]" />
            <col className="w-[22%]" />
            <col className="w-[22%]" />
            <col className="w-[8%]" />
            <col className="w-[10%]" />
            <col className="w-[8%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-border/40 bg-surface/60">
              <th className="px-3 py-2.5 text-left font-medium text-secondary-text">任务</th>
              <th className="px-3 py-2.5 text-left font-medium text-secondary-text whitespace-nowrap">开始时间</th>
              <th className="px-3 py-2.5 text-left font-medium text-secondary-text whitespace-nowrap">结束时间</th>
              <th className="px-3 py-2.5 text-right font-medium text-secondary-text whitespace-nowrap">耗时</th>
              <th className="px-3 py-2.5 text-center font-medium text-secondary-text whitespace-nowrap">触发方式</th>
              <th className="px-3 py-2.5 text-center font-medium text-secondary-text whitespace-nowrap">状态</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-text">
                  <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                </td>
              </tr>
            ) : runs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-text">暂无执行记录</td>
              </tr>
            ) : (
              runs.map((run, idx) => (
                <tr
                  key={run.id}
                  className={`border-b border-border/30 transition-colors hover:bg-hover/50 ${idx % 2 === 0 ? '' : 'bg-surface/30'}`}
                  title={run.errorMsg ?? undefined}
                >
                  <td className="px-3 py-2 text-secondary-text max-w-0">
                    <div className="truncate" title={run.taskName ?? run.taskKey}>{run.taskName ?? run.taskKey}</div>
                    <div className="truncate text-[10px] text-muted-text font-mono" title={run.taskKey}>{run.taskKey}</div>
                  </td>
                  <td className="px-3 py-2 font-mono text-secondary-text whitespace-nowrap">{fmtDatetime(run.startedAt)}</td>
                  <td className="px-3 py-2 font-mono text-secondary-text whitespace-nowrap">{fmtDatetime(run.finishedAt)}</td>
                  <td className="px-3 py-2 text-right font-mono text-secondary-text whitespace-nowrap">{fmtDuration(run.durationSeconds)}</td>
                  <td className="px-3 py-2 text-center text-muted-text whitespace-nowrap">{run.triggeredBy ?? '--'}</td>
                  <td className="px-3 py-2 text-center">
                    <StatusBadge status={run.status} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-xs">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPage(offset - limit)}
            className="rounded-lg border border-border/50 px-2.5 py-1 text-secondary-text disabled:opacity-40 hover:border-primary/50 hover:text-foreground"
          >
            上一页
          </button>
          <span className="text-muted-text">{page} / {totalPages}</span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => onPage(offset + limit)}
            className="rounded-lg border border-border/50 px-2.5 py-1 text-secondary-text disabled:opacity-40 hover:border-primary/50 hover:text-foreground"
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
};

// ── Main Page ─────────────────────────────────────────────────────────────────

const ScheduledTasksPage: React.FC = () => {
  useEffect(() => { document.title = '定时任务 - DSA'; }, []);

  const [configs, setConfigs] = useState<SchedulerTaskConfig[]>([]);
  const [configsLoading, setConfigsLoading] = useState(false);
  const [configsError, setConfigsError] = useState<ParsedApiError | null>(null);

  const [runsData, setRunsData] = useState<SchedulerTaskRunListResponse>({ items: [], total: 0, offset: 0, limit: 30 });
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState<ParsedApiError | null>(null);
  const [runsOffset, setRunsOffset] = useState(0);
  const [filterKey, setFilterKey] = useState<string | undefined>(undefined);

  const [historyOpen, setHistoryOpen] = useState(true);

  const loadConfigs = useCallback(async () => {
    setConfigsLoading(true);
    setConfigsError(null);
    try {
      const items = await systemConfigApi.listSchedulerTasks();
      setConfigs(items);
    } catch (err) {
      setConfigsError(getParsedApiError(err));
    } finally {
      setConfigsLoading(false);
    }
  }, []);

  const loadRuns = useCallback(async (offset: number, taskKey?: string) => {
    setRunsLoading(true);
    setRunsError(null);
    try {
      const data = await systemConfigApi.listSchedulerRuns({ taskKey, offset, limit: 30 });
      setRunsData(data);
    } catch (err) {
      setRunsError(getParsedApiError(err));
    } finally {
      setRunsLoading(false);
    }
  }, []);

  useEffect(() => { void loadConfigs(); }, [loadConfigs]);
  useEffect(() => { void loadRuns(runsOffset, filterKey); }, [loadRuns, runsOffset, filterKey]);

  const handleToggle = useCallback(async (taskKey: string, enabled: boolean) => {
    await systemConfigApi.updateSchedulerTask(taskKey, { enabled });
    setConfigs((prev) => prev.map((c) => c.taskKey === taskKey ? { ...c, enabled } : c));
  }, []);

  const handleTrigger = useCallback(async (taskKey: string) => {
    await systemConfigApi.triggerSchedulerTask(taskKey);
    // 稍等 1s 后刷新历史（让 DB 写入完成）
    setTimeout(() => void loadRuns(0, filterKey), 1000);
    setConfigs((prev) => prev.map((c) => c.taskKey === taskKey ? { ...c, isRunning: true } : c));
  }, [loadRuns, filterKey]);

  const handleFilterChange = useCallback((key: string | undefined) => {
    setFilterKey(key);
    setRunsOffset(0);
  }, []);

  const taskKeys = configs.map((c) => c.taskKey);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-border/50 px-6 py-4">
        <h1 className="text-base font-semibold text-foreground">定时任务</h1>
        <p className="mt-0.5 text-xs text-secondary-text">
          查看并管理系统后台定时任务的配置、下次执行时间与历史记录
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

        {/* Task Configs */}
        <Card variant="default" padding="md">
          <div className="mb-3 flex items-center justify-between">
            <span className="label-uppercase">任务配置</span>
            <button
              type="button"
              disabled={configsLoading}
              onClick={() => void loadConfigs()}
              className="flex items-center gap-1 rounded-lg border border-border/50 px-2 py-1 text-[10px] text-secondary-text hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${configsLoading ? 'animate-spin' : ''}`} />
              刷新
            </button>
          </div>

          {configsError ? (
            <ApiErrorAlert error={configsError} />
          ) : configsLoading && configs.length === 0 ? (
            <p className="text-xs text-muted-text animate-pulse">加载中…</p>
          ) : configs.length === 0 ? (
            <p className="text-xs text-muted-text">
              暂无任务记录，启动调度器（--schedule 模式）后任务配置将自动写入数据库。
            </p>
          ) : (
            <div className="space-y-2">
              {configs.map((cfg) => (
                <TaskConfigCard key={cfg.taskKey} config={cfg} onToggle={handleToggle} onTrigger={handleTrigger} />
              ))}
            </div>
          )}
        </Card>

        {/* Run History */}
        <Card variant="default" padding="md">
          <button
            type="button"
            className="flex w-full items-center justify-between mb-3"
            onClick={() => setHistoryOpen((v) => !v)}
          >
            <span className="label-uppercase">执行历史</span>
            {historyOpen
              ? <ChevronUp className="h-4 w-4 text-muted-text" />
              : <ChevronDown className="h-4 w-4 text-muted-text" />
            }
          </button>

          {historyOpen && (
            <>
              {runsError && <ApiErrorAlert error={runsError} />}
              <RunHistoryTable
                runs={runsData.items}
                total={runsData.total}
                offset={runsOffset}
                limit={30}
                onPage={(o) => setRunsOffset(o)}
                loading={runsLoading}
                taskKey={filterKey}
                onFilterChange={handleFilterChange}
                taskKeys={taskKeys}
              />
            </>
          )}
        </Card>

      </div>
    </div>
  );
};

export default ScheduledTasksPage;

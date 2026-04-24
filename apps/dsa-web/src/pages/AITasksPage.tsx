import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, CheckCircle2, Clock, Loader2, Pencil, Play, Plus, RefreshCw, Trash2, XCircle } from 'lucide-react';
import { aiTaskApi } from '../api/aiTask';
import { getParsedApiError, type ParsedApiError } from '../api/error';
import { ApiErrorAlert } from '../components/common';
import type { AITask, AITaskCreateRequest, AITaskRun, AITaskUpdateRequest } from '../types/aiTask';

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDuration(secs?: number | null): string {
  if (secs == null) return '—';
  if (secs < 60) return `${secs.toFixed(1)}s`;
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}m ${s}s`;
}

function formatDatetime(iso?: string | null): string {
  if (!iso) return '—';
  return iso.replace('T', ' ').slice(0, 16);
}

// ── Task Form Modal ────────────────────────────────────────────────────────────

type TaskFormProps = {
  initial?: AITask;
  onClose: () => void;
  onSaved: (task: AITask) => void;
};

const TASK_TYPE_OPTIONS = [
  { value: 'daily', label: '每日定时' },
  { value: 'interval', label: '周期执行' },
];

const TaskFormModal: React.FC<TaskFormProps> = ({ initial, onClose, onSaved }) => {
  const isEdit = initial != null;
  const [name, setName] = useState(initial?.name ?? '');
  const [prompt, setPrompt] = useState(initial?.prompt ?? '');
  const [taskType, setTaskType] = useState<'daily' | 'interval'>(initial?.taskType ?? 'daily');
  const [scheduleTime, setScheduleTime] = useState(initial?.scheduleTime ?? '18:00');
  const [intervalSeconds, setIntervalSeconds] = useState<number>(initial?.intervalSeconds ?? 3600);
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [notifyOnFinish, setNotifyOnFinish] = useState(initial?.notifyOnFinish ?? true);
  const [description, setDescription] = useState(initial?.description ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ParsedApiError | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      let saved: AITask;
      if (isEdit && initial) {
        const req: AITaskUpdateRequest = {
          name, prompt, taskType,
          scheduleTime: taskType === 'daily' ? scheduleTime : undefined,
          intervalSeconds: taskType === 'interval' ? intervalSeconds : undefined,
          enabled, notifyOnFinish,
          description: description || undefined,
        };
        saved = await aiTaskApi.updateTask(initial.taskKey, req);
      } else {
        const req: AITaskCreateRequest = {
          name, prompt, taskType,
          scheduleTime: taskType === 'daily' ? scheduleTime : undefined,
          intervalSeconds: taskType === 'interval' ? intervalSeconds : undefined,
          enabled, notifyOnFinish,
          description: description || undefined,
        };
        saved = await aiTaskApi.createTask(req);
      }
      onSaved(saved);
    } catch (err) {
      setError(getParsedApiError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-border bg-card shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold text-foreground">
            {isEdit ? '编辑 AI 任务' : '新建 AI 任务'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-secondary-text hover:bg-hover hover:text-foreground"
          >
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={(e) => { void handleSubmit(e); }} className="flex flex-col gap-4 p-6">
          {error && <ApiErrorAlert error={error} />}

          {/* Name */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-secondary-text">任务名称 *</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例：今日涨幅分析"
              className="rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-primary focus:outline-none"
            />
          </div>

          {/* Prompt */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-secondary-text">
              任务描述（自然语言） *
            </label>
            <textarea
              required
              rows={6}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={
                '例：拉取今天A股所有上涨的股票，筛选换手率大于10%的，\n分析今天上涨的主要板块和资金流动情况，\n将分析结果整理成报告并发送到飞书。'
              }
              className="resize-y rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-primary focus:outline-none"
            />
            <p className="text-xs text-muted">AI Agent 将根据此描述自动调用相关工具完成任务</p>
          </div>

          {/* Task type + schedule */}
          <div className="flex gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-secondary-text">执行类型</label>
              <select
                value={taskType}
                onChange={(e) => setTaskType(e.target.value as 'daily' | 'interval')}
                className="rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
              >
                {TASK_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            {taskType === 'daily' ? (
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-secondary-text">每日执行时间</label>
                <input
                  type="time"
                  required
                  value={scheduleTime}
                  onChange={(e) => setScheduleTime(e.target.value)}
                  className="rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                />
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-secondary-text">执行间隔（秒，≥60）</label>
                <input
                  type="number"
                  required
                  min={60}
                  value={intervalSeconds}
                  onChange={(e) => setIntervalSeconds(Number(e.target.value))}
                  className="w-36 rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                />
              </div>
            )}
          </div>

          {/* Toggles */}
          <div className="flex gap-6">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="accent-primary"
              />
              启用任务
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={notifyOnFinish}
                onChange={(e) => setNotifyOnFinish(e.target.checked)}
                className="accent-primary"
              />
              完成后推送结果
            </label>
          </div>

          {/* Description (optional) */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-secondary-text">备注（可选）</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="内部备注，不影响执行"
              className="rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-primary focus:outline-none"
            />
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost px-4 py-2 text-sm">
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              className="btn-primary flex items-center gap-2 px-4 py-2 text-sm"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEdit ? '保存' : '创建'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ── Run History Panel ──────────────────────────────────────────────────────────

type RunHistoryProps = {
  taskKey: string;
  onClose: () => void;
};

const RunHistoryPanel: React.FC<RunHistoryProps> = ({ taskKey, onClose }) => {
  const [runs, setRuns] = useState<AITaskRun[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const LIMIT = 15;

  const load = useCallback(async (off: number) => {
    setLoading(true);
    try {
      const res = await aiTaskApi.listRuns(taskKey, off, LIMIT);
      setRuns(res.items);
      setTotal(res.total);
      setOffset(off);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [taskKey]);

  useEffect(() => { void load(0); }, [load]);

  const statusBadge = (status: string) => {
    if (status === 'success')
      return <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs text-green-500"><CheckCircle2 className="h-3 w-3" />成功</span>;
    if (status === 'error')
      return <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-xs text-red-500"><XCircle className="h-3 w-3" />失败</span>;
    return <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-xs text-blue-500"><Loader2 className="h-3 w-3 animate-spin" />运行中</span>;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex w-full max-w-3xl flex-col rounded-2xl border border-border bg-card shadow-2xl" style={{ maxHeight: '80vh' }}>
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold text-foreground">执行历史</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-secondary-text hover:bg-hover">
            <XCircle className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : runs.length === 0 ? (
            <p className="py-8 text-center text-sm text-secondary-text">暂无执行记录</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-secondary-text">
                  <th className="pb-2 pr-4 font-medium">开始时间</th>
                  <th className="pb-2 pr-4 font-medium">结束时间</th>
                  <th className="pb-2 pr-4 font-medium">耗时</th>
                  <th className="pb-2 pr-4 font-medium">触发方式</th>
                  <th className="pb-2 font-medium">状态</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-b border-border/50 last:border-0">
                    <td className="py-2 pr-4 font-mono text-xs">{formatDatetime(r.startedAt)}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{formatDatetime(r.finishedAt)}</td>
                    <td className="py-2 pr-4 text-xs">{formatDuration(r.durationSeconds)}</td>
                    <td className="py-2 pr-4 text-xs">{r.triggeredBy === 'manual' ? '手动' : '定时'}</td>
                    <td className="py-2">
                      {statusBadge(r.status)}
                      {r.errorMsg && (
                        <p className="mt-1 max-w-xs truncate text-xs text-red-400" title={r.errorMsg}>{r.errorMsg}</p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {total > LIMIT && (
          <div className="flex items-center justify-between border-t border-border px-6 py-3 text-xs text-secondary-text">
            <span>共 {total} 条</span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => void load(Math.max(0, offset - LIMIT))}
                className="rounded px-2 py-1 hover:bg-hover disabled:opacity-40"
              >上一页</button>
              <button
                type="button"
                disabled={offset + LIMIT >= total}
                onClick={() => void load(offset + LIMIT)}
                className="rounded px-2 py-1 hover:bg-hover disabled:opacity-40"
              >下一页</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Task Card ─────────────────────────────────────────────────────────────────

type TaskCardProps = {
  task: AITask;
  onEdit: (task: AITask) => void;
  onDelete: (taskKey: string) => void;
  onTrigger: (taskKey: string) => Promise<void>;
  onToggle: (taskKey: string, enabled: boolean) => Promise<void>;
  onShowHistory: (taskKey: string) => void;
};

const TaskCard: React.FC<TaskCardProps> = ({ task, onEdit, onDelete, onTrigger, onToggle, onShowHistory }) => {
  const [triggering, setTriggering] = useState(false);
  const [toggling, setToggling] = useState(false);

  const handleTrigger = async () => {
    setTriggering(true);
    try {
      await onTrigger(task.taskKey);
    } finally {
      setTriggering(false);
    }
  };

  const handleToggle = async () => {
    setToggling(true);
    try {
      await onToggle(task.taskKey, !task.enabled);
    } finally {
      setToggling(false);
    }
  };

  const scheduleLabel =
    task.taskType === 'daily'
      ? `每天 ${task.scheduleTime}`
      : task.intervalSeconds
      ? `每 ${task.intervalSeconds >= 3600 ? `${task.intervalSeconds / 3600}小时` : task.intervalSeconds >= 60 ? `${task.intervalSeconds / 60}分钟` : `${task.intervalSeconds}秒`} 执行`
      : '—';

  return (
    <div className={`flex flex-col gap-3 rounded-2xl border p-5 transition-colors ${task.enabled ? 'border-border bg-card' : 'border-border/50 bg-card/60 opacity-70'}`}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Bot className="h-4 w-4 shrink-0 text-primary" />
          <h3 className="truncate text-sm font-semibold text-foreground">{task.name}</h3>
          {task.isRunning && (
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-xs text-blue-500">
              <Loader2 className="h-3 w-3 animate-spin" />运行中
            </span>
          )}
          {!task.enabled && (
            <span className="rounded-full bg-secondary/30 px-2 py-0.5 text-xs text-secondary-text">已停用</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            title="立即执行"
            disabled={task.isRunning || triggering}
            onClick={() => { void handleTrigger(); }}
            className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-secondary-text hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            {triggering ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            立即执行
          </button>
          <button
            type="button"
            title="执行历史"
            onClick={() => onShowHistory(task.taskKey)}
            className="rounded-lg p-1.5 text-secondary-text hover:bg-hover hover:text-foreground"
          >
            <Clock className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="编辑"
            onClick={() => onEdit(task)}
            className="rounded-lg p-1.5 text-secondary-text hover:bg-hover hover:text-foreground"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="删除"
            onClick={() => onDelete(task.taskKey)}
            className="rounded-lg p-1.5 text-secondary-text hover:bg-hover hover:text-red-500"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Prompt preview */}
      <p className="line-clamp-2 text-xs leading-relaxed text-secondary-text">{task.prompt}</p>

      {/* Meta row */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-secondary-text">
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {scheduleLabel}
        </span>
        {task.nextRun && (
          <span>下次执行：{formatDatetime(task.nextRun)}</span>
        )}
        {task.notifyOnFinish && (
          <span className="text-green-500/80">完成后推送</span>
        )}
      </div>

      {/* Enable toggle */}
      <div className="flex items-center justify-between border-t border-border/50 pt-2">
        <span className="text-xs text-secondary-text">{task.enabled ? '任务已启用' : '任务已停用'}</span>
        <button
          type="button"
          disabled={toggling}
          onClick={() => { void handleToggle(); }}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${task.enabled ? 'bg-primary' : 'bg-secondary'} disabled:opacity-50`}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${task.enabled ? 'translate-x-4' : 'translate-x-0'}`}
          />
        </button>
      </div>
    </div>
  );
};

// ── Main Page ──────────────────────────────────────────────────────────────────

const AITasksPage: React.FC = () => {
  const [tasks, setTasks] = useState<AITask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ParsedApiError | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editTask, setEditTask] = useState<AITask | undefined>(undefined);
  const [historyTaskKey, setHistoryTaskKey] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadTasks = useCallback(async () => {
    try {
      const list = await aiTaskApi.listTasks();
      setTasks(list);
      setError(null);
    } catch (err) {
      setError(getParsedApiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + poll while any task is running
  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    const hasRunning = tasks.some((t) => t.isRunning);
    if (hasRunning) {
      if (!pollingRef.current) {
        pollingRef.current = setInterval(() => { void loadTasks(); }, 3000);
      }
    } else {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    }
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [tasks, loadTasks]);

  const handleSaved = useCallback((task: AITask) => {
    setTasks((prev) => {
      const idx = prev.findIndex((t) => t.taskKey === task.taskKey);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = task;
        return next;
      }
      return [...prev, task];
    });
    setShowForm(false);
    setEditTask(undefined);
  }, []);

  const handleDelete = useCallback(async (taskKey: string) => {
    if (!confirm('确认删除这个 AI 任务？此操作不可撤销。')) return;
    try {
      await aiTaskApi.deleteTask(taskKey);
      setTasks((prev) => prev.filter((t) => t.taskKey !== taskKey));
    } catch (err) {
      setError(getParsedApiError(err));
    }
  }, []);

  const handleTrigger = useCallback(async (taskKey: string) => {
    await aiTaskApi.triggerTask(taskKey);
    setTasks((prev) => prev.map((t) => t.taskKey === taskKey ? { ...t, isRunning: true } : t));
    // Start polling
    setTimeout(() => { void loadTasks(); }, 1500);
  }, [loadTasks]);

  const handleToggle = useCallback(async (taskKey: string, enabled: boolean) => {
    const updated = await aiTaskApi.updateTask(taskKey, { enabled });
    setTasks((prev) => prev.map((t) => t.taskKey === taskKey ? updated : t));
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-primary" />
          <h1 className="text-base font-semibold text-foreground">AI 智能任务</h1>
          <span className="rounded-full bg-secondary/40 px-2 py-0.5 text-xs text-secondary-text">{tasks.length} 个任务</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { void loadTasks(); }}
            className="rounded-lg p-2 text-secondary-text hover:bg-hover hover:text-foreground"
            title="刷新"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => { setEditTask(undefined); setShowForm(true); }}
            className="btn-primary flex items-center gap-2 px-3 py-2 text-sm"
          >
            <Plus className="h-4 w-4" />
            新建任务
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6">
        {error && (
          <div className="mb-4">
            <ApiErrorAlert error={error} />
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
            <Bot className="h-12 w-12 text-secondary-text/40" />
            <p className="text-sm text-secondary-text">还没有 AI 任务</p>
            <button
              type="button"
              onClick={() => { setEditTask(undefined); setShowForm(true); }}
              className="btn-primary flex items-center gap-2 px-4 py-2 text-sm"
            >
              <Plus className="h-4 w-4" />
              创建第一个 AI 任务
            </button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
            {tasks.map((task) => (
              <TaskCard
                key={task.taskKey}
                task={task}
                onEdit={(t) => { setEditTask(t); setShowForm(true); }}
                onDelete={(k) => { void handleDelete(k); }}
                onTrigger={handleTrigger}
                onToggle={handleToggle}
                onShowHistory={(k) => setHistoryTaskKey(k)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      {showForm && (
        <TaskFormModal
          initial={editTask}
          onClose={() => { setShowForm(false); setEditTask(undefined); }}
          onSaved={handleSaved}
        />
      )}
      {historyTaskKey && (
        <RunHistoryPanel
          taskKey={historyTaskKey}
          onClose={() => setHistoryTaskKey(null)}
        />
      )}
    </div>
  );
};

export default AITasksPage;

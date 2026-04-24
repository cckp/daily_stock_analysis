import type React from 'react';
import { useEffect, useState } from 'react';
import { Clock, RefreshCw } from 'lucide-react';
import { systemConfigApi } from '../../api/systemConfig';
import { getParsedApiError } from '../../api/error';
import type { SchedulerStatusResponse, SchedulerTaskInfo } from '../../types/systemConfig';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { ApiErrorAlert } from '../common/ApiErrorAlert';
import { SettingsSectionCard } from './SettingsSectionCard';

function formatInterval(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  return remainMinutes > 0 ? `${hours} 小时 ${remainMinutes} 分钟` : `${hours} 小时`;
}

function TaskRow({ task }: { task: SchedulerTaskInfo }) {
  const isDaily = task.type === 'daily';

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[var(--settings-border)] bg-[var(--settings-surface)] px-4 py-3 shadow-soft-card transition-[background-color,border-color] duration-200 hover:border-[var(--settings-border-strong)] hover:bg-[var(--settings-surface-hover)] sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <Clock className="h-4 w-4 shrink-0 text-muted-text" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{task.name}</p>
          <p className="mt-0.5 text-xs text-muted-text">
            {isDaily
              ? `每日 ${task.scheduleTime ?? '--'} 执行`
              : `每隔 ${task.intervalSeconds != null ? formatInterval(task.intervalSeconds) : '--'} 执行`}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Badge
          variant={task.enabled ? 'success' : 'default'}
          size="sm"
          className={task.enabled ? '' : 'border-[var(--settings-border)] bg-[var(--settings-surface-hover)] text-secondary-text'}
        >
          {task.enabled ? '已启用' : '未启用'}
        </Badge>
        <Badge variant="default" size="sm" className="border-[var(--settings-border)] bg-[var(--settings-surface-hover)] text-secondary-text">
          {isDaily ? '每日定时' : '后台循环'}
        </Badge>
      </div>
    </div>
  );
}

export const SchedulerCard: React.FC = () => {
  const [status, setStatus] = useState<SchedulerStatusResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<ReturnType<typeof getParsedApiError> | null>(null);

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await systemConfigApi.getSchedulerStatus();
      setStatus(data);
    } catch (err: unknown) {
      setError(getParsedApiError(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <SettingsSectionCard
      title="定时任务"
      description="当前系统配置的定时任务列表，包含每日自动分析与后台监控任务。"
      actions={
        <Button
          type="button"
          variant="settings-secondary"
          onClick={() => void load()}
          disabled={isLoading}
          isLoading={isLoading}
          loadingText="刷新中..."
        >
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          刷新
        </Button>
      }
    >
      {error ? (
        <ApiErrorAlert error={error} actionLabel="重试" onAction={() => void load()} />
      ) : isLoading && !status ? (
        <div className="flex items-center gap-2 text-sm text-muted-text">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-foreground" />
          加载中...
        </div>
      ) : status ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-text">
            <span>
              定时调度：
              <span className={status.scheduleEnabled ? 'font-medium text-foreground' : ''}>
                {status.scheduleEnabled ? '已启用' : '未启用'}
              </span>
            </span>
            {status.scheduleEnabled && (
              <span>
                启动时立即执行：
                <span className="font-medium text-foreground">
                  {status.runImmediately ? '是' : '否'}
                </span>
              </span>
            )}
          </div>
          {status.tasks.length > 0 ? (
            <div className="space-y-2">
              {status.tasks.map((task) => (
                <TaskRow key={task.name} task={task} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-text">暂无配置的定时任务。</p>
          )}
        </div>
      ) : null}
    </SettingsSectionCard>
  );
};

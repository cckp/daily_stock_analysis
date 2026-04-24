import apiClient from './index';
import { toCamelCase } from './utils';
import type {
  AITask,
  AITaskCreateRequest,
  AITaskUpdateRequest,
  AITaskRun,
  AITaskRunListResponse,
  TriggerAITaskResponse,
} from '../types/aiTask';

function toSnakeCreatePayload(req: AITaskCreateRequest): Record<string, unknown> {
  return {
    name: req.name,
    prompt: req.prompt,
    task_type: req.taskType,
    schedule_time: req.scheduleTime ?? null,
    interval_seconds: req.intervalSeconds ?? null,
    enabled: req.enabled ?? true,
    notify_on_finish: req.notifyOnFinish ?? true,
    description: req.description ?? null,
  };
}

function toSnakeUpdatePayload(req: AITaskUpdateRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (req.name != null) body.name = req.name;
  if (req.prompt != null) body.prompt = req.prompt;
  if (req.taskType != null) body.task_type = req.taskType;
  if (req.scheduleTime != null) body.schedule_time = req.scheduleTime;
  if (req.intervalSeconds != null) body.interval_seconds = req.intervalSeconds;
  if (req.enabled != null) body.enabled = req.enabled;
  if (req.notifyOnFinish != null) body.notify_on_finish = req.notifyOnFinish;
  if (req.description != null) body.description = req.description;
  return body;
}

export const aiTaskApi = {
  async listTasks(): Promise<AITask[]> {
    const response = await apiClient.get<{ items: Record<string, unknown>[] }>('/api/v1/ai-tasks');
    return (response.data.items || []).map((item) => toCamelCase<AITask>(item));
  },

  async createTask(req: AITaskCreateRequest): Promise<AITask> {
    const response = await apiClient.post<Record<string, unknown>>(
      '/api/v1/ai-tasks',
      toSnakeCreatePayload(req),
    );
    return toCamelCase<AITask>(response.data);
  },

  async getTask(taskKey: string): Promise<AITask> {
    const response = await apiClient.get<Record<string, unknown>>(`/api/v1/ai-tasks/${taskKey}`);
    return toCamelCase<AITask>(response.data);
  },

  async updateTask(taskKey: string, req: AITaskUpdateRequest): Promise<AITask> {
    const response = await apiClient.put<Record<string, unknown>>(
      `/api/v1/ai-tasks/${taskKey}`,
      toSnakeUpdatePayload(req),
    );
    return toCamelCase<AITask>(response.data);
  },

  async deleteTask(taskKey: string): Promise<void> {
    await apiClient.delete(`/api/v1/ai-tasks/${taskKey}`);
  },

  async triggerTask(taskKey: string): Promise<TriggerAITaskResponse> {
    const response = await apiClient.post<Record<string, unknown>>(
      `/api/v1/ai-tasks/${taskKey}/run`,
    );
    return toCamelCase<TriggerAITaskResponse>(response.data);
  },

  async listRuns(taskKey: string, offset = 0, limit = 30): Promise<AITaskRunListResponse> {
    const response = await apiClient.get<Record<string, unknown>>(
      `/api/v1/ai-tasks/${taskKey}/runs?offset=${offset}&limit=${limit}`,
    );
    const data = toCamelCase<AITaskRunListResponse>(response.data);
    return {
      ...data,
      items: (data.items || []).map((item) => toCamelCase<AITaskRun>(item as unknown as Record<string, unknown>)),
    };
  },
};

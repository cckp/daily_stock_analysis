export interface AITask {
  id: number;
  taskKey: string;
  name: string;
  description?: string;
  prompt: string;
  taskType: 'daily' | 'interval';
  scheduleTime?: string;      // HH:MM
  intervalSeconds?: number;
  enabled: boolean;
  notifyOnFinish: boolean;
  nextRun?: string;           // ISO datetime string from scheduler
  isRunning: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface AITaskCreateRequest {
  name: string;
  prompt: string;
  taskType: 'daily' | 'interval';
  scheduleTime?: string;
  intervalSeconds?: number;
  enabled?: boolean;
  notifyOnFinish?: boolean;
  description?: string;
}

export interface AITaskUpdateRequest {
  name?: string;
  prompt?: string;
  taskType?: 'daily' | 'interval';
  scheduleTime?: string;
  intervalSeconds?: number;
  enabled?: boolean;
  notifyOnFinish?: boolean;
  description?: string;
}

export interface AITaskListResponse {
  items: AITask[];
}

export interface TriggerAITaskResponse {
  runId: number;
  taskKey: string;
  taskName: string;
  startedAt: string;
  status: string;
  message: string;
}

export interface AITaskRun {
  id: number;
  taskKey: string;
  taskName?: string;
  startedAt: string;
  finishedAt?: string;
  durationSeconds?: number;
  status: 'running' | 'success' | 'error';
  triggeredBy?: string;
  errorMsg?: string;
}

export interface AITaskRunListResponse {
  items: AITaskRun[];
  total: number;
  offset: number;
  limit: number;
}

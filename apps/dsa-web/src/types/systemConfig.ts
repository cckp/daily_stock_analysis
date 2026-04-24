export interface SchedulerTaskInfo {
  name: string;
  type: 'daily' | 'background';
  scheduleTime?: string;
  intervalSeconds?: number;
  enabled: boolean;
}

export interface SchedulerStatusResponse {
  scheduleEnabled: boolean;
  runImmediately: boolean;
  tasks: SchedulerTaskInfo[];
}

// ── Persistent scheduler models (DB-backed) ──────────────────────────────────

export interface SchedulerTaskConfig {
  id: number;
  taskKey: string;
  name: string;
  description?: string;
  taskType: 'daily' | 'interval';
  scheduleTime?: string;
  intervalSeconds?: number;
  enabled: boolean;
  nextRun?: string;
  isRunning: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface SchedulerTaskConfigUpdateRequest {
  name?: string;
  description?: string;
  scheduleTime?: string;
  intervalSeconds?: number;
  enabled?: boolean;
}

export interface SchedulerTaskRun {
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

export interface SchedulerTaskRunListResponse {
  items: SchedulerTaskRun[];
  total: number;
  offset: number;
  limit: number;
}

export interface TriggerRunResponse {
  runId: number;
  taskKey: string;
  taskName?: string;
  startedAt: string;
  status: string;
  message: string;
}

export type SystemConfigCategory =
  | 'base'
  | 'data_source'
  | 'ai_model'
  | 'notification'
  | 'system'
  | 'agent'
  | 'backtest'
  | 'uncategorized';

export type SystemConfigDataType =
  | 'string'
  | 'integer'
  | 'number'
  | 'boolean'
  | 'array'
  | 'json'
  | 'time';

export type SystemConfigUIControl =
  | 'text'
  | 'password'
  | 'number'
  | 'select'
  | 'textarea'
  | 'switch'
  | 'time';

export interface SystemConfigOption {
  label: string;
  value: string;
}

export interface SystemConfigFieldSchema {
  key: string;
  title?: string;
  description?: string;
  category: SystemConfigCategory;
  dataType: SystemConfigDataType;
  uiControl: SystemConfigUIControl;
  isSensitive: boolean;
  isRequired: boolean;
  isEditable: boolean;
  defaultValue?: string | null;
  options: Array<string | SystemConfigOption>;
  validation: Record<string, unknown>;
  displayOrder: number;
}

export interface SystemConfigCategorySchema {
  category: SystemConfigCategory;
  title: string;
  description?: string;
  displayOrder: number;
  fields: SystemConfigFieldSchema[];
}

export interface SystemConfigSchemaResponse {
  schemaVersion: string;
  categories: SystemConfigCategorySchema[];
}

export interface SystemConfigItem {
  key: string;
  value: string;
  rawValueExists: boolean;
  isMasked: boolean;
  schema?: SystemConfigFieldSchema;
}

export interface SystemConfigResponse {
  configVersion: string;
  maskToken: string;
  items: SystemConfigItem[];
  updatedAt?: string;
}

export interface ExportSystemConfigResponse {
  content: string;
  configVersion: string;
  updatedAt?: string;
}

export interface SystemConfigUpdateItem {
  key: string;
  value: string;
}

export interface UpdateSystemConfigRequest {
  configVersion: string;
  maskToken?: string;
  reloadNow?: boolean;
  items: SystemConfigUpdateItem[];
}

export interface UpdateSystemConfigResponse {
  success: boolean;
  configVersion: string;
  appliedCount: number;
  skippedMaskedCount: number;
  reloadTriggered: boolean;
  updatedKeys: string[];
  warnings: string[];
}

export interface ValidateSystemConfigRequest {
  items: SystemConfigUpdateItem[];
}

export interface ImportSystemConfigRequest {
  configVersion: string;
  content: string;
  reloadNow?: boolean;
}

export interface ConfigValidationIssue {
  key: string;
  code: string;
  message: string;
  severity: 'error' | 'warning';
  expected?: string;
  actual?: string;
}

export interface ValidateSystemConfigResponse {
  valid: boolean;
  issues: ConfigValidationIssue[];
}

export interface TestLLMChannelRequest {
  name: string;
  protocol: string;
  baseUrl?: string;
  apiKey?: string;
  models: string[];
  enabled?: boolean;
  timeoutSeconds?: number;
}

export interface TestLLMChannelResponse {
  success: boolean;
  message: string;
  error?: string | null;
  resolvedProtocol?: string | null;
  resolvedModel?: string | null;
  latencyMs?: number | null;
}

export interface DiscoverLLMChannelModelsRequest {
  name: string;
  protocol: string;
  baseUrl?: string;
  apiKey?: string;
  models?: string[];
  timeoutSeconds?: number;
}

export interface DiscoverLLMChannelModelsResponse {
  success: boolean;
  message: string;
  error?: string | null;
  resolvedProtocol?: string | null;
  models: string[];
  latencyMs?: number | null;
}

export interface SystemConfigValidationErrorResponse {
  error: string;
  message: string;
  issues: ConfigValidationIssue[];
}

export interface SystemConfigConflictResponse {
  error: string;
  message: string;
  currentConfigVersion: string;
}

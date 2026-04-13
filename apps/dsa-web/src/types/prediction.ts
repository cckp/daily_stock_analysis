/**
 * Prediction API type definitions
 * Mirrors api/v1/schemas/prediction.py
 */

// ============ Request ============

export interface PredictionRunRequest {
  code: string;
  startDate: string;
  endDate: string;
  skillId?: string;
  lookbackDays?: number;
  maxDates?: number;
}

// ============ Item ============

export interface PredictionItem {
  date: string;
  close?: number;
  pctChg?: number;

  // Technical indicators
  ma5?: number;
  ma10?: number;
  ma20?: number;
  macdDif?: number;
  macdDea?: number;
  macdBar?: number;
  rsi6?: number;
  rsi12?: number;
  volumeRatio5d?: number;
  trendStatus?: string;
  macdStatus?: string;

  // AI prediction
  prediction?: 'up' | 'down' | 'flat';
  confidence?: number;
  reason?: string;

  // Actual next-day result
  actualNextClose?: number;
  actualNextPctChg?: number;
  actualDirection?: 'up' | 'down' | 'flat';
  correct?: boolean;

  status: string;
  errorMsg?: string;
}

// ============ Response ============

export interface PredictionRunResponse {
  runId?: number;
  code: string;
  stockName?: string;
  skillId?: string;
  skillName?: string;
  startDate: string;
  endDate: string;
  lookbackDays: number;
  total: number;
  completed: number;
  withActual: number;
  accuracyPct?: number;
  items: PredictionItem[];
}

// ============ Async Job ============

export interface JobInfo {
  jobId: string;
  status: 'running' | 'done' | 'error';
  code: string;
  stockName?: string;
  startDate: string;
  endDate: string;
  skillId?: string;
  skillName?: string;
  error?: string;
  result?: PredictionRunResponse;
}

// ============ Skill (reuse agent API shape) ============

export interface SkillOption {
  id: string;
  name: string;
  description: string;
}

// ============ History ============

export interface PredictionHistoryEntry {
  runId: number;
  code: string;
  stockName?: string;
  startDate: string;
  endDate: string;
  skillId?: string;
  skillName?: string;
  lookbackDays: number;
  total: number;
  completed: number;
  withActual: number;
  accuracyPct?: number;
  createdAt: string;
}

export interface PredictionHistoryResponse {
  items: PredictionHistoryEntry[];
  total: number;
  offset: number;
  limit: number;
}

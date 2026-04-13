import apiClient from './index';
import { toCamelCase } from './utils';
import type {
  PredictionRunRequest,
  PredictionRunResponse,
  PredictionHistoryResponse,
  JobInfo,
  SkillOption,
} from '../types/prediction';

export const predictionApi = {
  /**
   * Run AI prediction for a stock over a date range
   */
  run: async (params: PredictionRunRequest): Promise<PredictionRunResponse> => {
    const body: Record<string, unknown> = {
      code: params.code,
      start_date: params.startDate,
      end_date: params.endDate,
    };
    if (params.skillId) body.skill_id = params.skillId;
    if (params.lookbackDays != null) body.lookback_days = params.lookbackDays;
    if (params.maxDates != null) body.max_dates = params.maxDates;

    const response = await apiClient.post<Record<string, unknown>>(
      '/api/v1/prediction/run',
      body,
      { timeout: 300_000 }, // 5 min — LLM batch calls take time
    );

    const data = toCamelCase<PredictionRunResponse>(response.data);
    return {
      ...data,
      items: (data.items || []).map((item) => toCamelCase(item)),
    };
  },

  /**
   * Fetch a single run's full result by ID
   */
  getRun: async (runId: number): Promise<PredictionRunResponse> => {
    const response = await apiClient.get<Record<string, unknown>>(
      `/api/v1/prediction/history/${runId}`,
    );
    const data = toCamelCase<PredictionRunResponse>(response.data);
    return {
      ...data,
      items: (data.items || []).map((item) => toCamelCase(item)),
    };
  },

  /**
   * Fetch history of past prediction runs
   */
  getHistory: async (params?: { code?: string; offset?: number; limit?: number }): Promise<PredictionHistoryResponse> => {
    const query = new URLSearchParams();
    if (params?.code) query.set('code', params.code);
    if (params?.offset != null) query.set('offset', String(params.offset));
    if (params?.limit != null) query.set('limit', String(params.limit));

    const response = await apiClient.get<Record<string, unknown>>(
      `/api/v1/prediction/history?${query.toString()}`,
    );
    const data = toCamelCase<PredictionHistoryResponse>(response.data);
    return {
      ...data,
      items: (data.items || []).map((item) => toCamelCase(item)),
    };
  },

  /**
   * Submit async prediction job — returns immediately with job_id
   */
  runAsync: async (params: PredictionRunRequest): Promise<JobInfo> => {
    const body: Record<string, unknown> = {
      code: params.code,
      start_date: params.startDate,
      end_date: params.endDate,
    };
    if (params.skillId) body.skill_id = params.skillId;
    if (params.lookbackDays != null) body.lookback_days = params.lookbackDays;
    if (params.maxDates != null) body.max_dates = params.maxDates;

    const response = await apiClient.post<Record<string, unknown>>(
      '/api/v1/prediction/run-async',
      body,
    );
    return toCamelCase<JobInfo>(response.data);
  },

  /**
   * Poll async job status; result is nested when done
   */
  getJobStatus: async (jobId: string): Promise<JobInfo> => {
    const response = await apiClient.get<Record<string, unknown>>(
      `/api/v1/prediction/jobs/${jobId}`,
    );
    const data = toCamelCase<JobInfo>(response.data);
    if (data.result) {
      const r = data.result as unknown as Record<string, unknown>;
      data.result = {
        ...(toCamelCase<PredictionRunResponse>(r)),
        items: ((r.items as unknown[]) || []).map((item) =>
          toCamelCase(item as Record<string, unknown>),
        ),
      } as PredictionRunResponse;
    }
    return data;
  },

  /**
   * Fetch available skills from the agent endpoint
   */
  getSkills: async (): Promise<SkillOption[]> => {
    try {
      const response = await apiClient.get<{ skills: Array<{ id: string; name: string; description: string }> }>(
        '/api/v1/agent/skills',
      );
      return (response.data.skills || []).map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
      }));
    } catch {
      return [];
    }
  },
};

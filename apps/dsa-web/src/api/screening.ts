import apiClient from './index';
import type { ScreeningHistoryPage, StockScreeningResponse } from '../types/screening';

function toCamelCase(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(toCamelCase);
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [
        k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
        toCamelCase(v),
      ])
    );
  }
  return obj;
}

export const screeningApi = {
  async getScreeningData(stockCode: string): Promise<StockScreeningResponse> {
    const response = await apiClient.get(`/api/v1/stocks/${encodeURIComponent(stockCode)}/screening`, {
      timeout: 60000,
    });
    return toCamelCase(response.data) as StockScreeningResponse;
  },

  async getHistory(page = 1, pageSize = 30, minScore = 0): Promise<ScreeningHistoryPage> {
    const response = await apiClient.get(`/api/v1/stocks/screening/history?page=${page}&page_size=${pageSize}&min_score=${minScore}`);
    return toCamelCase(response.data) as ScreeningHistoryPage;
  },

  async getHistoryDetail(id: number): Promise<StockScreeningResponse> {
    const response = await apiClient.get(`/api/v1/stocks/screening/history/${id}`);
    return toCamelCase(response.data) as StockScreeningResponse;
  },

  async runBatch(): Promise<{ status: string; codes: string[]; count: number }> {
    const response = await apiClient.post('/api/v1/stocks/screening/batch', null, { timeout: 10000 });
    return response.data as { status: string; codes: string[]; count: number };
  },
};

import apiClient from './index';

export const tipsApi = {
  async getTips(): Promise<string[]> {
    const response = await apiClient.get<{ tips: string[] }>('/api/v1/system/tips');
    return response.data.tips ?? [];
  },
};

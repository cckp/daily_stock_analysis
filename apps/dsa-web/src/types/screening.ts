export type ScreeningHistoryItem = {
  id: number;
  code: string;
  name?: string | null;
  currentPrice?: number | null;
  changePercent?: number | null;
  passCount?: number | null;
  queriedAt: string;
};

export type ScreeningHistoryPage = {
  items: ScreeningHistoryItem[];
  total: number;
  page: number;
  pageSize: number;
};

export type KLineWithIndicators = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
  amount?: number | null;
  changePercent?: number | null;
  ma5?: number | null;
  ma10?: number | null;
  ma20?: number | null;
  ma30?: number | null;
  dif?: number | null;
  dea?: number | null;
  macdHistogram?: number | null;
};

export type StockScreeningCriteria = {
  changeAboveThreshold?: boolean | null;   // 今日涨幅 > 3%
  volumeRatioOk?: boolean | null;          // 量比 > 1
  turnoverInRange?: boolean | null;        // 换手率 5%-10%
  circMvInRange?: boolean | null;          // 流通市值 50-100亿
  notKcbCyb?: boolean | null;             // 非创业板 & 非科创板
  priceIsLow?: boolean | null;            // 股价 < 20元
  volumeModerateIncrease?: boolean | null; // 成交量温和放大
  ma5GoldenCross?: boolean | null;        // 5日线金叉
  ma30Uptrend?: boolean | null;           // 30日线趋势向上
  closeAtDailyHigh?: boolean | null;      // 尾盘创当日新高
  volumeSurge?: boolean | null;           // 成交量 ≥ 前10日均量1.5倍
};

export type StockScreeningResponse = {
  stockCode: string;
  stockName?: string | null;
  currentPrice?: number | null;
  changePercent?: number | null;
  volumeRatio?: number | null;
  turnoverRate?: number | null;
  circMv?: number | null;
  volume?: number | null;
  isCyb: boolean;
  isKcb: boolean;
  klineData: KLineWithIndicators[];
  criteria: StockScreeningCriteria;
};

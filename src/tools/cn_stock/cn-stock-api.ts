import { logger } from '../../utils/logger.js';

/**
 * Tencent Finance API base URL
 * Provides real-time stock quotes, K-line data, etc.
 */
const TENCENT_FINANCE_BASE = 'https://sqt.gtimg.cn';

export interface TencentStockQuote {
  name: string;           // 股票名称
  code: string;           // 股票代码 (e.g., sh600519)
  price: number;          // 当前价格
  yesterdayClose: number;  // 昨日收盘价
  open: number;           // 今日开盘价
  volume: number;         // 成交量（手）
  bidVolume: number;      // 外盘（主动买）
  askVolume: number;      // 内盘（主动卖）
  high: number;           // 最高价
  low: number;            // 最低价
  limitUp: number;        // 涨停价
  limitDown: number;      // 跌停价
  amplitude: number;      // 振幅
  changePercent: number;   // 涨跌幅 (%)
  changeAmount: number;    // 涨跌额
  marketCap: string;       // 总市值
  floatMarketCap: string;  // 流通市值
  peTtm: number;          // 市盈率TTM
  peLyr: number;          // 市盈率LYR
  priceBook: number;      // 市净率
  dividend: number;       // 股息率
  turnover: number;       // 换手率 (%)
  date: string;           // 日期
  time: string;           // 时间
}

/**
 * Parse Tencent Finance real-time quote response
 * Response format: v_sh600519="1~name~code~price~yesterdayClose~open~volume~..."
 *   Index 0: type indicator
 *   Index 1: name
 *   Index 2: code
 *   Index 3: price
 *   Index 4: yesterday close
 *   Index 5: open
 *   Index 6: volume (lots)
 *   Index 31: change amount
 *   Index 32: change percent
 *   Index 33: high
 *   Index 34: low
 *   Index 36: turnover rate
 *   Index 37: PE TTM
 *   Index 43: amplitude
 *   Index 47/48: limit up/down
 *   Index 49: turnover
 *   Index 50: dividend
 */
export function parseTencentQuote(response: string): TencentStockQuote {
  // Remove the "v_shxxxxx=" prefix and quotes
  const jsonStart = response.indexOf('="');
  const raw = jsonStart >= 0 ? response.substring(jsonStart + 2) : response;
  const content = raw.replace(/"/g, '');

  const parts = content.split('~');
  if (parts.length < 10) {
    throw new Error(`Invalid quote response, only ${parts.length} fields: ${response.substring(0, 200)}`);
  }

  return {
    name: parts[1] || '',
    code: parts[2] || '',
    price: parseFloat(parts[3]) || 0,
    yesterdayClose: parseFloat(parts[4]) || 0,
    open: parseFloat(parts[5]) || 0,
    volume: parseFloat(parts[6]) || 0,
    bidVolume: parseFloat(parts[7]) || 0,
    askVolume: parseFloat(parts[8]) || 0,
    high: parseFloat(parts[33]) || 0,
    low: parseFloat(parts[34]) || 0,
    limitUp: parseFloat(parts[47]) || 0,
    limitDown: parseFloat(parts[48]) || 0,
    amplitude: parseFloat(parts[43]) || 0,
    changePercent: parseFloat(parts[32]) || 0,
    changeAmount: parseFloat(parts[31]) || 0,
    marketCap: parts[37] || '0',
    floatMarketCap: parts[38] || '0',
    peTtm: parseFloat(parts[39]) || 0,
    peLyr: parseFloat(parts[40]) || 0,
    priceBook: parseFloat(parts[46]) || 0,
    dividend: parseFloat(parts[50]) || 0,
    turnover: parseFloat(parts[49]) || 0,
    date: parts[30] || '',
    time: parts[30] || '',
  };
}

/**
 * Normalize Chinese stock code to Tencent format
 * A股: sh600519 (上证) / sz000858 (深证)
 * Index: sh000001 (上证指数) / sz399001 (深证成指)
 */
export function normalizeStockCode(code: string): string {
  const cleanCode = code.trim().toLowerCase().replace(/[\s\-]/g, '');
  
  // Already in Tencent format
  if (cleanCode.startsWith('sh') || cleanCode.startsWith('sz')) {
    return cleanCode;
  }
  
  // Add prefix based on code range
  const numPart = cleanCode.replace(/\D/g, '');
  
  // Index codes (special)
  if (['000001', '399001', '399006'].includes(numPart)) {
    return `sz${numPart}`;
  }
  
  // Shanghai (6xxxxx)
  if (numPart.startsWith('6')) {
    return `sh${numPart}`;
  }
  
  // Shenzhen (0xxxxx, 3xxxxx for ChiNext)
  if (numPart.startsWith('0') || numPart.startsWith('3')) {
    return `sz${numPart}`;
  }
  
  // Default to Shanghai
  return `sh${numPart}`;
}

/**
 * Fetch Tencent Finance real-time quote for a stock
 */
export async function fetchTencentQuote(stockCode: string): Promise<TencentStockQuote> {
  const normalized = normalizeStockCode(stockCode);
  const url = `${TENCENT_FINANCE_BASE}/q=${normalized}`;
  
  logger.info(`[CN Stock API] Fetching Tencent quote: ${normalized}`);
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Tencent API error: ${response.status} ${response.statusText}`);
  }
  
  const text = await response.text();
  return parseTencentQuote(text);
}

// ============================================================
// East Money (东方财富) API - for financial data
// Uses emweb.securities.eastmoney.com API which provides comprehensive
// Chinese stock financial data including income, indicators, and key metrics.
// ============================================================

const EM_BASE = 'https://emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis/ZYZBAjaxNew';

export interface EastMoneyFinancialResponse {
  pages: number;
  data: Record<string, unknown>[];
}

/**
 * Normalize stock code to East Money format (SH600519)
 */
function toEastMoneyCode(stockCode: string): string {
  const normalized = normalizeStockCode(stockCode);
  const numPart = normalized.replace(/\D/g, '');
  if (normalized.startsWith('sh')) {
    return `SH${numPart}`;
  }
  return `SZ${numPart}`;
}

/**
 * Fetch financial data from East Money
 * The type parameter maps to different data categories:
 * - 'income': Comprehensive income statement + key indicators (ROE, margins, EPS, etc.)
 * - 'balance': Per-share metrics (BPS, per-share cash, etc.)
 * - 'cashflow': Not available via this API
 * - 'indicator': Same as income via this endpoint
 *
 * Actually, the East Money API only provides one comprehensive endpoint (type=0)
 * which includes income, indicators, and key metrics. The type parameter here
 * is kept for semantic purposes but all resolve to the same API call.
 */
export async function fetchEastMoneyFinancials(
  stockCode: string,
  type: 'income' | 'balance' | 'cashflow' | 'indicator'
): Promise<Record<string, unknown>> {
  const code = toEastMoneyCode(stockCode);
  const url = `${EM_BASE}?type=0&code=${code}&page=1&pageSize=12`;

  logger.info(`[CN Stock API] Fetching East Money financials for: ${stockCode} (${code})`);

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Referer': 'https://emweb.securities.eastmoney.com/',
    },
  });

  if (!response.ok) {
    throw new Error(`East Money API error: ${response.status}`);
  }

  const json = (await response.json()) as EastMoneyFinancialResponse;

  if (!json.data || json.data.length === 0) {
    return {
      success: false,
      stock_code: stockCode,
      message: 'No financial data available',
      source: 'East Money (东方财富)',
    };
  }

  // Format the data into readable Chinese financial format
  const formattedData = json.data.map((item) => {
    const date = String(item.REPORT_DATE || '').split(' ')[0];
    const reportType = String(item.REPORT_TYPE || '');
    return {
      报告期: date,
      报告类型: reportType,
      股票代码: item.SECURITY_CODE,
      股票名称: item.SECURITY_NAME_ABBR,
      货币: item.CURRENCY,
      // 每股数据
      基本每股收益_EPS: item.EPSJB,
      扣非每股收益: item.EPSKCJB,
      稀释每股收益: item.EPSXS,
      每股净资产_BPS: item.BPS,
      每股资本公积: item.MGZBGJ,
      每股未分配利润: item.MGWFPLR,
      每股经营现金流: item.MGJYXJJE,
      // 盈利能力
      营业总收入: item.TOTALOPERATEREVE,
      毛利: item.MLR,
      归属净利润: item.PARENTNETPROFIT,
      扣非净利润: item.KCFJCXSYJLR,
      营业总收入增长率: item.TOTALOPERATEREVETZ,
      净利润增长率: item.PARENTNETPROFITTZ,
      扣非净利润增长率: item.KCFJYXJLRTZ,
      // 盈利能力指标
      加权净资产收益率_ROE: item.ROEJQ,
      扣非净资产收益率: item.ROEKCJQ,
      总资产周转率: item.ZZCJLL,
      销售净利率: item.XSJLL,
      销售毛利率: item.XSMLL,
      营业利润率: item.YYZSRGDHBZC,
      净利率: item.NETPROFITRPHBZC,
      扣非净利率: item.KFJLRGDHBZC,
      // 财务风险
      资产负债率: item.ZCFZL,
      产权比率: item.QYCS,
      长期资本负债率: item.CQBL,
      // 偿债能力
      流动比率: item.LD,
      速动比率: item.SD,
      现金比率: item.XJLLB,
      // 成长能力
      总资产增长率: item.TOAZZL,
      存货周转率: item.CHZZL,
      应收账款周转率: item.YSZKZZL,
      // 经营效率
      总资产周转天数: item.ZZCZZTS,
      存货周转天数: item.CHZZTS,
      应收账款周转天数: item.YSZKZZTS,
      // 杜邦分析
      ROIC: item.ROIC,
    };
  });

  return {
    success: true,
    stock_code: stockCode,
    report_count: json.data.length,
    data: formattedData,
    source: 'East Money (东方财富)',
    data_url: `https://emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis/ZYZBAjaxNew?type=0&code=${code}`,
  };
}

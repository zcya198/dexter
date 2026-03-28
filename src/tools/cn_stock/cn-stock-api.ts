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
 * Response format: v="code,name,price,yesterdayClose,open,volume,bidVolume,askVolume,..."
 */
export function parseTencentQuote(response: string): TencentStockQuote {
  const parts = response.split('~');
  if (parts.length < 50) {
    throw new Error(`Invalid quote response: ${response.substring(0, 200)}`);
  }

  const [code, name, priceStr, yesterdayCloseStr, openStr, volumeStr] = parts;

  return {
    name: name || '',
    code: code || '',
    price: parseFloat(priceStr) || 0,
    yesterdayClose: parseFloat(yesterdayCloseStr) || 0,
    open: parseFloat(openStr) || 0,
    volume: parseFloat(volumeStr) || 0,
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
    time: parts[29] || '',
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
// East Money (东方财富) API - for financial statements
// ============================================================

const EAST_MONEY_BASE = 'https://emappdata.eastmoney.com';

/**
 * Fetch financial data from East Money
 * East Money provides comprehensive Chinese stock financial data
 */
export async function fetchEastMoneyFinancials(stockCode: string, type: 'income' | 'balance' | 'cashflow' | 'main_index'): Promise<Record<string, unknown>> {
  const normalized = normalizeStockCode(stockCode);
  const marketCode = normalized.startsWith('sh') ? '1' : '0';
  const codeNum = normalized.replace(/\D/g, '');
  const secid = `${marketCode}${codeNum}`;
  
  let rptId = '';
  switch (type) {
    case 'income': rptId = 'ProfitStatement'; break;
    case 'balance': rptId = 'BalanceSheet'; break;
    case 'cashflow': rptId = 'CashFlowStatement'; break;
    case 'main_index': rptId = 'MainIndex'; break;
  }
  
  const url = `${EAST_MONEY_BASE}/stationaryServer/stock/financial/index?appId=appId01&deviceId=weblogin&platform=web&version=6.0.0&apiVersion=&platClients=web`;
  
  logger.info(`[CN Stock API] Fetching East Money ${type} for: ${stockCode} (secid: ${secid})`);
  
  // Note: East Money requires a more complex API call with headers
  // For now, return a placeholder - actual implementation would need proper API setup
  return {
    note: `East Money ${type} data for ${stockCode}`,
    secid,
    source: 'East Money (东方财富)',
  };
}

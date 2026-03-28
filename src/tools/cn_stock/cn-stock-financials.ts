import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { normalizeStockCode } from './cn-stock-api.js';
import { logger } from '../../utils/logger.js';

// ============================================================
// East Money Financial Data API
// ============================================================

const EM_BASE = 'https://datacenter.eastmoney.com/securities/api/data/v1/get';

/**
 * Fetch financial indicator data from East Money
 */
async function fetchEastMoneyFinancial(
  code: string,
  type: 'income' | 'balance' | 'cashflow' | 'indicator'
): Promise<Record<string, unknown>> {
  const normalized = normalizeStockCode(code);
  const marketCode = normalized.startsWith('sh') ? '1' : '0';
  const codeNum = normalized.replace(/\D/g, '');
  
  // Map report types to East Money API report types
  const reportTypeMap: Record<string, string> = {
    income: 'ProfitStatement',
    balance: 'BalanceSheet',
    cashflow: 'CashFlowStatement',
    indicator: 'FinancialAnalysis',
  };
  
  const rtype = reportTypeMap[type];
  
  // Use the correct API endpoint format
  const url = `${EM_BASE}?reportName=${encodeURIComponent(`RPT_LICO_FN_${rtype}`)}&columns=SECURITY_CODE,REPORT_DATE,${getColumnsForType(type)}&filter=(SECURITY_CODE="${codeNum}")&pageNumber=1&pageSize=12&sortTypes=-1&sortColumns=REPORT_DATE&source=DataCenter&client=PC`;
  
  logger.info(`[CN Stock Financials] Fetching ${type} for ${code}`);
  
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer': 'https://data.eastmoney.com/',
      },
    });
    
    if (!response.ok) {
      throw new Error(`East Money API error: ${response.status}`);
    }
    
    const json = await response.json() as { result?: { data?: unknown[] } };
    
    if (!json.result?.data) {
      return { stocks: [], source: 'East Money (东方财富)' };
    }
    
    return {
      stock_code: code,
      report_type: type,
      data: json.result.data,
      source: 'East Money (东方财富)',
      count: json.result.data.length,
    };
  } catch (error) {
    logger.error(`[CN Stock Financials] Error: ${error}`);
    throw error;
  }
}

function getColumnsForType(type: string): string {
  switch (type) {
    case 'income':
      return 'TOTAL_OPERATE_INCOME,OPERATE_INCOME,OPERATE_PROFIT,INVEST_INCOME,NON_OPERATE_INCOME,TOTAL_PROFIT,NET_PROFIT,EPS_BASIC,EPS_DILUTED';
    case 'balance':
      return 'TOTAL_ASSETS,TOTAL_LIABILITIES,MINORITY_INTEREST,NET_ASSETS,OPERATE_CASHFLOW,NET_CASHFLOW,TOTAL_CURRENT_ASSETS,TOTAL_CURRENT_LIABILITIES';
    case 'cashflow':
      return 'MANAGE_CASHFLOW,INVEST_CASHFLOW,FINANCE_CASHFLOW,CASH_EQUIVALENT,NET_CASHFLOW';
    case 'indicator':
      return 'ROE_WEIGHTED,ROE_DILUTED,NET_PROFIT_MARGIN,GROSS_PROFIT_MARGIN,DEBT_ASSET_RATIO,EPS_TTM,OPERATE_CASHFLOW_PS,BASIC_PS';
    default:
      return '*';
  }
}

// ============================================================
// Tool Definitions
// ============================================================

export const CN_INCOME_STATEMENT_DESCRIPTION = `
Fetches income statement (利润表) data for Chinese A-share companies. 
Includes revenue, operating profit, total profit, net profit, EPS, etc.

## When to Use
- "贵州茅台2024年年报" (Kweichow Moutai 2024 annual report)
- "招商银行近3年营业收入" (CMB revenue last 3 years)
- "中国平安季度净利润" (Ping An quarterly net profit)

## Input
- Chinese stock code (e.g., '600519', 'sh600519', '000858')
- Date range is auto-inferred but limited to last 12 periods
`.trim();

const CNIncomeStatementInputSchema = z.object({
  code: z.string().describe("Chinese stock code. Examples: '600519' (Kweichow Moutai), '000858' (Wuliangye), 'sh600519'"),
  period: z.enum(['annual', 'quarterly']).default('annual').describe('Reporting period type'),
});

export const getCnIncomeStatement = new DynamicStructuredTool({
  name: 'get_cn_income_statement',
  description: CN_INCOME_STATEMENT_DESCRIPTION,
  schema: CNIncomeStatementInputSchema,
  func: async (input) => {
    try {
      const data = await fetchEastMoneyFinancial(input.code, 'income');
      return formatToolResult(data, ['https://data.eastmoney.com/']);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return formatToolResult({ error: message }, []);
    }
  },
});

export const CN_BALANCE_SHEET_DESCRIPTION = `
Fetches balance sheet (资产负债表) data for Chinese A-share companies.
Includes total assets, total liabilities, net assets, equity, etc.

## When to Use
- "工商银行总资产" (ICBC total assets)
- "比亚迪资产负债率" (BYD debt-to-asset ratio)
- "万科净资产" (Vanke net assets)
`.trim();

const CNBalanceSheetInputSchema = z.object({
  code: z.string().describe("Chinese stock code"),
  period: z.enum(['annual', 'quarterly']).default('annual').describe('Reporting period type'),
});

export const getCnBalanceSheet = new DynamicStructuredTool({
  name: 'get_cn_balance_sheet',
  description: CN_BALANCE_SHEET_DESCRIPTION,
  schema: CNBalanceSheetInputSchema,
  func: async (input) => {
    try {
      const data = await fetchEastMoneyFinancial(input.code, 'balance');
      return formatToolResult(data, ['https://data.eastmoney.com/']);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return formatToolResult({ error: message }, []);
    }
  },
});

export const CN_CASHFLOW_DESCRIPTION = `
Fetches cash flow statement (现金流量表) data for Chinese A-share companies.
Includes operating cash flow, investment cash flow, financing cash flow, etc.

## When to Use
- "贵州茅台经营现金流" (Kweichow Moutai operating cash flow)
- "宁德时代现金流状况" (CATL cash flow status)
`.trim();

const CNCashFlowInputSchema = z.object({
  code: z.string().describe("Chinese stock code"),
  period: z.enum(['annual', 'quarterly']).default('annual').describe('Reporting period type'),
});

export const getCnCashFlowStatement = new DynamicStructuredTool({
  name: 'get_cn_cashflow_statement',
  description: CN_CASHFLOW_DESCRIPTION,
  schema: CNCashFlowInputSchema,
  func: async (input) => {
    try {
      const data = await fetchEastMoneyFinancial(input.code, 'cashflow');
      return formatToolResult(data, ['https://data.eastmoney.com/']);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return formatToolResult({ error: message }, []);
    }
  },
});

export const CN_INDICATORS_DESCRIPTION = `
Fetches key financial indicators for Chinese A-share companies.
Includes ROE, profit margins, debt ratio, EPS, etc.

## When to Use
- "贵州茅台ROE" (Kweichow Moutai ROE)
- "比亚迪毛利率" (BYD gross margin)
- "工商银行估值" (ICBC valuation metrics)
`.trim();

const CNIndicatorInputSchema = z.object({
  code: z.string().describe("Chinese stock code"),
});

export const getCnFinancialIndicators = new DynamicStructuredTool({
  name: 'get_cn_financial_indicators',
  description: CN_INDICATORS_DESCRIPTION,
  schema: CNIndicatorInputSchema,
  func: async (input) => {
    try {
      const data = await fetchEastMoneyFinancial(input.code, 'indicator');
      return formatToolResult(data, ['https://data.eastmoney.com/']);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return formatToolResult({ error: message }, []);
    }
  },
});

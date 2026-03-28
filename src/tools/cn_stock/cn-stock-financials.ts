import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { fetchEastMoneyFinancials } from './cn-stock-api.js';

// ============================================================
// Tool Definitions
// All tools use the same East Money API endpoint (type=0) which provides
// comprehensive financial data including income, indicators, and key metrics.
// ============================================================

export const CN_INCOME_STATEMENT_DESCRIPTION = `
Fetches income statement (利润表) and key financial indicators for Chinese A-share companies.
Includes revenue, operating profit, net profit, EPS, ROE, profit margins, debt ratios, etc.

## When to Use
- "贵州茅台2024年年报" (Kweichow Moutai 2024 annual report)
- "招商银行近3年营业收入" (CMB revenue last 3 years)
- "中国平安季度净利润" (Ping An quarterly net profit)
- "贵州茅台ROE和毛利率" (ROE and gross margin)

## Input
- Chinese stock code (e.g., '600519', 'sh600519', '000858')
- Returns last 12 reporting periods (mix of annual and quarterly)

## Key Fields in Response
- 营业总收入, 归属净利润, 扣非净利润
- 加权净资产收益率_ROE, 销售毛利率, 销售净利率
- 基本每股收益_EPS, 每股净资产_BPS
- 资产负债率, 流动比率, 速动比率
`.trim();

const CNIncomeStatementInputSchema = z.object({
  code: z.string().describe("Chinese stock code. Examples: '600519' (Kweichow Moutai), '000858' (Wuliangye), 'sh600519'"),
  period: z.enum(['annual', 'quarterly']).default('annual').describe('Reporting period type (annual or quarterly)'),
});

export const getCnIncomeStatement = new DynamicStructuredTool({
  name: 'get_cn_income_statement',
  description: CN_INCOME_STATEMENT_DESCRIPTION,
  schema: CNIncomeStatementInputSchema,
  func: async (input) => {
    try {
      const data = await fetchEastMoneyFinancials(input.code, 'income');
      // Filter by period type if specified
      let filtered = data.data as Record<string, unknown>[];
      if (input.period === 'annual') {
        filtered = filtered.filter((r) => String(r['报告类型'] || '').includes('年报'));
      } else {
        filtered = filtered.filter((r) => !String(r['报告类型'] || '').includes('年报'));
      }
      return formatToolResult({ ...data, data: filtered }, ['https://emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis/']);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return formatToolResult({ error: message }, []);
    }
  },
});

export const CN_BALANCE_SHEET_DESCRIPTION = `
Fetches balance sheet data and per-share metrics for Chinese A-share companies.
Note: The East Money API provides comprehensive data including both per-share metrics (BPS, per-share cash) and key balance-related indicators.

## When to Use
- "工商银行总资产" (ICBC total assets)
- "比亚迪资产负债率" (BYD debt-to-asset ratio)
- "万科净资产" (Vanke net assets)
- "贵州茅台每股现金流" (Kweichow Moutai per-share cash flow)

## Key Fields in Response
- 每股净资产_BPS, 每股资本公积, 每股未分配利润
- 每股经营现金流, 资产负债率, 流动比率, 速动比率
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
      const data = await fetchEastMoneyFinancials(input.code, 'balance');
      return formatToolResult(data, ['https://emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis/']);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return formatToolResult({ error: message }, []);
    }
  },
});

export const CN_CASHFLOW_DESCRIPTION = `
Fetches per-share cash flow metrics for Chinese A-share companies.
Includes operating cash flow per share, investing cash flow indicators, etc.

## When to Use
- "贵州茅台经营现金流" (Kweichow Moutai operating cash flow per share)
- "宁德时代现金流状况" (CATL cash flow status)
- "每股经营现金流分析" (Per-share operating cash flow analysis)

## Key Fields in Response
- 每股经营现金流, 每股未分配利润, 每股资本公积
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
      const data = await fetchEastMoneyFinancials(input.code, 'cashflow');
      return formatToolResult(data, ['https://emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis/']);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return formatToolResult({ error: message }, []);
    }
  },
});

export const CN_INDICATORS_DESCRIPTION = `
Fetches key financial indicators and valuation metrics for Chinese A-share companies.
Includes ROE, profit margins, debt ratios, EPS, BPS, ROIC, etc.

## When to Use
- "贵州茅台ROE" (Kweichow Moutai ROE)
- "比亚迪毛利率" (BYD gross margin)
- "工商银行估值" (ICBC valuation metrics)
- "五粮液盈利能力对比" (Wuliangye profitability comparison)

## Key Fields in Response
- ROE: 加权净资产收益率_ROE, 扣非净资产收益率
- Margins: 销售毛利率, 销售净利率, 营业利润率
- Valuation: 基本每股收益_EPS, 每股净资产_BPS, 资产负债率
- Efficiency: 总资产周转率, 存货周转率, 应收账款周转率
- Growth: 营业总收入增长率, 净利润增长率, 扣非净利润增长率
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
      const data = await fetchEastMoneyFinancials(input.code, 'indicator');
      return formatToolResult(data, ['https://emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis/']);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return formatToolResult({ error: message }, []);
    }
  },
});

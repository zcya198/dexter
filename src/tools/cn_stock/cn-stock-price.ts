import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { fetchTencentQuote, normalizeStockCode, type TencentStockQuote } from './cn-stock-api.js';
import { formatToolResult } from '../types.js';

export const CN_STOCK_PRICE_DESCRIPTION = `
Fetches current stock quote for A-shares (Chinese stocks) including price, change, volume, and valuation metrics. Powered by Tencent Finance API.

## Coverage
- Shanghai A-shares (sh600xxx)
- Shenzhen A-shares (sz000xxx, sz300xxx for ChiNext)
- Major indices (sh000001, sz399001, sz399006)

## When to Use
- "贵州茅台现在多少钱" (How much is Kweichow Moutai now?)
- "查询平安银行的股价" (Query Ping An Bank stock price)
- "招商银行今日涨跌幅" (Today's change for CMB)
- "上证指数当前点位" (Current Shanghai Composite index)

## Input
- Stock code in various formats: "600519", "sh600519", "sz000858", "000001" (index)

## Output
Returns real-time quote with: name, price, change percent, open, high, low, volume, turnover, PE ratios, market cap, etc.
`.trim();

const CNStockPriceInputSchema = z.object({
  code: z
    .string()
    .describe("Chinese stock code. Examples: '600519' (Kweichow Moutai), '000858' (Wuliangye), 'sh600519', 'sz000001', '000001' (Shanghai index)"),
});

/**
 * Format Tencent quote into clean result for LLM
 */
function formatQuoteResult(quote: TencentStockQuote): Record<string, unknown> {
  return {
    name: quote.name,
    code: quote.code,
    price: quote.price,
    currency: 'CNY',
    change_percent: `${quote.changePercent > 0 ? '+' : ''}${quote.changePercent.toFixed(2)}%`,
    change_amount: quote.changeAmount,
    open: quote.open,
    high: quote.high,
    low: quote.low,
    yesterday_close: quote.yesterdayClose,
    volume: `${(quote.volume / 100).toFixed(2)}万股`, // 转换为万股
    turnover_rate: `${quote.turnover.toFixed(2)}%`,
    pe_ttm: quote.peTtm,
    pe_lyr: quote.peLyr,
    price_to_book: quote.priceBook,
    dividend_yield: `${quote.dividend.toFixed(2)}%`,
    market_cap: quote.marketCap,
    float_market_cap: quote.floatMarketCap,
    limit_up: quote.limitUp,
    limit_down: quote.limitDown,
    amplitude: `${quote.amplitude.toFixed(2)}%`,
    update_time: `${quote.date} ${quote.time}`,
    source: 'Tencent Finance (腾讯财经)',
  };
}

export const getCnStockPrice = new DynamicStructuredTool({
  name: 'get_cn_stock_price',
  description:
    'Fetches current real-time quote for Chinese A-share stocks. Use for stock price queries. Input stock code in various formats (600519, sh600519, sz000858, etc.)',
  schema: CNStockPriceInputSchema,
  func: async (input) => {
    try {
      const quote = await fetchTencentQuote(input.code);
      const formatted = formatQuoteResult(quote);
      return formatToolResult(formatted, [`https://gu.qq.com/${quote.code}`]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return formatToolResult({ error: message }, []);
    }
  },
});

// ============================================================
// Batch quote for multiple stocks
// ============================================================

const CNStockPricesInputSchema = z.object({
  codes: z
    .array(z.string())
    .min(1)
    .max(20)
    .describe('Array of Chinese stock codes (max 20). Examples: ["600519", "000858", "sh600519"]'),
});

export const getCnStockPrices = new DynamicStructuredTool({
  name: 'get_cn_stock_prices',
  description:
    'Fetches current real-time quotes for multiple Chinese A-share stocks simultaneously. Use when comparing multiple stocks.',
  schema: CNStockPricesInputSchema,
  func: async (input) => {
    try {
      const results: Record<string, unknown>[] = [];
      const errors: string[] = [];
      
      for (const code of input.codes) {
        try {
          const quote = await fetchTencentQuote(code);
          results.push(formatQuoteResult(quote));
        } catch (err) {
          errors.push(`${code}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      
      const response: Record<string, unknown> = { stocks: results };
      if (errors.length > 0) {
        response._errors = errors;
      }
      
      return formatToolResult(response, []);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return formatToolResult({ error: message }, []);
    }
  },
});

// ============================================================
// Index quote
// ============================================================

const CNIndexPriceInputSchema = z.object({
  index_code: z
    .string()
    .describe("Index code. Common indices: '000001' (上证指数), '399001' (深证成指), '399006' (创业板指), '000300' (沪深300), '000016' (上证50), '399005' (中小板指')"),
});

export const getCnIndexQuote = new DynamicStructuredTool({
  name: 'get_cn_index_quote',
  description:
    'Fetches current quote for major Chinese stock indices. Use for index level queries.',
  schema: CNIndexPriceInputSchema,
  func: async (input) => {
    try {
      // Index codes in Tencent format need special handling
      const codeMap: Record<string, string> = {
        '000001': 'sh000001',  // 上证指数
        '399001': 'sz399001',  // 深证成指
        '399006': 'sz399006',  // 创业板指
        '000300': 'sh000300',  // 沪深300
        '000016': 'sh000016',  // 上证50
        '399005': 'sz399005',  // 中小板指
        '000688': 'sh000688',  // 科创50
      };
      
      const normalized = codeMap[input.index_code.toLowerCase()] || normalizeStockCode(input.index_code);
      const quote = await fetchTencentQuote(normalized);
      const formatted = formatQuoteResult(quote);
      
      return formatToolResult(formatted, [`https://gu.qq.com/${quote.code}`]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return formatToolResult({ error: message }, []);
    }
  },
});

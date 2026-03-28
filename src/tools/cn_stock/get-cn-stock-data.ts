import { DynamicStructuredTool, StructuredToolInterface } from '@langchain/core/tools';
import type { RunnableConfig } from '@langchain/core/runnables';
import { AIMessage, ToolCall } from '@langchain/core/messages';
import { z } from 'zod';
import { callLlm } from '../../model/llm.js';
import { formatToolResult } from '../types.js';
import { getCurrentDate } from '../../agent/prompts.js';

/**
 * Rich description for the get_cn_stock_data tool.
 * Used in the system prompt to guide the LLM on when and how to use this tool.
 */
export const GET_CN_STOCK_DATA_DESCRIPTION = `
Intelligent meta-tool for retrieving Chinese A-share stock data. Takes a natural language query and automatically routes to appropriate data sources.

## Coverage
- **Exchanges**: Shanghai (上证), Shenzhen (深证), ChiNext (创业板), STAR Market (科创板)
- **Data Sources**: Tencent Finance (腾讯财经), East Money (东方财富)
- **Supported**: Real-time prices, historical prices, financial statements, key indicators

## When to Use

- Chinese stock price queries ("贵州茅台现在多少钱", "招商银行今日股价")
- A-share index quotes ("上证指数", "创业板指", "沪深300")
- Financial statements ("茅台2024年报", "比亚迪利润表")
- Key financial indicators ("茅台ROE", "比亚迪毛利率")
- Cash flow analysis ("宁德时代现金流")
- Balance sheet analysis ("工商银行资产负载")
- Comparative analysis across Chinese stocks

## When NOT to Use

- US stock queries (use get_market_data or get_financials instead)
- Cryptocurrency prices (use get_market_data)
- Hong Kong stocks (use get_market_data)
- General web searches (use web_search)

## Supported Stock Codes

Common formats accepted:
- 6-digit codes: "600519" (defaults to Shanghai)
- With prefix: "sh600519", "sz000858"
- Index: "000001" (Shanghai), "399001" (Shenzhen), "399006" (ChiNext)

## Usage Notes

- Call ONCE with the complete natural language query
- Handles Chinese company name to stock code resolution
- Handles date inference ("去年", "近3年", "2024年")
- Returns structured JSON data with source attribution

## Common Company Name Mappings

- 贵州茅台 / 茅台 → 600519
- 招商银行 / 招行 → 600036
- 工商银行 / 工行 → 601398
- 中国平安 / 平安 → 601318
- 比亚迪 → 002594
- 宁德时代 → 300750
- 中国中免 → 601888
- 万科A → 000002
- 五粮液 → 000858
`.trim();

/** Format snake_case tool name to Title Case for progress messages */
function formatSubToolName(name: string): string {
  return name.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// Import CN stock tools directly
import { getCnStockPrice, getCnStockPrices, getCnIndexQuote } from './cn-stock-price.js';
import { getCnIncomeStatement, getCnBalanceSheet, getCnCashFlowStatement, getCnFinancialIndicators } from './cn-stock-financials.js';

// All CN stock tools available for routing
const CN_STOCK_TOOLS: StructuredToolInterface[] = [
  getCnStockPrice,
  getCnStockPrices,
  getCnIndexQuote,
  getCnIncomeStatement,
  getCnBalanceSheet,
  getCnCashFlowStatement,
  getCnFinancialIndicators,
];

// Create a map for quick tool lookup by name
const CN_STOCK_TOOL_MAP = new Map(CN_STOCK_TOOLS.map(t => [t.name, t]));

// Company name to stock code mapping
const COMPANY_NAME_MAP: Record<string, string> = {
  '贵州茅台': '600519',
  '茅台': '600519',
  '五粮液': '000858',
  '泸州老窖': '000568',
  '山西汾酒': '600809',
  '洋河股份': '002304',
  '古井贡酒': '000596',
  '今世缘': '603369',
  '口子窖': '603589',
  '水井坊': '600779',
  '酒鬼酒': '000799',
  '舍得酒业': '600702',
  '迎驾贡酒': '603198',
  '老白干酒': '600559',
  '金徽酒': '603919',
  '伊力特': '600197',
  '青青稞酒': '002646',
  '张裕A': '000869',
  '威龙股份': '603779',
  '中葡股份': '600084',
  '莫高股份': '600543',
  '通葡股份': '600365',
  '楼兰酒庄': '870804',
  '王朝酒业': '0828.HK',
  '华致酒行': '300755',
  '怡园酒业': '8146.HK',
  '长城汽车': '601633',
  '吉利汽车': '0175.HK',
  '比亚迪': '002594',
  '宁德时代': '300750',
  '上汽集团': '600104',
  '广汽集团': '601238',
  '长安汽车': '000625',
  '长城汽车': '601633',
  '东风汽车': '600006',
  '北汽蓝谷': '600733',
  '江淮汽车': '600418',
  '蔚来': 'NIO',
  '小鹏汽车': 'XPEV',
  '理想汽车': 'LI',
  '特斯拉': 'TSLA',
  '招商银行': '600036',
  '工商银行': '601398',
  '建设银行': '601939',
  '中国银行': '601988',
  '农业银行': '601288',
  '交通银行': '601328',
  '兴业银行': '601166',
  '浦发银行': '600000',
  '民生银行': '600016',
  '平安银行': '000001',
  '光大银行': '601818',
  '华夏银行': '600015',
  '中信银行': '601998',
  '北京银行': '601169',
  '上海银行': '601229',
  '江苏银行': '600919',
  '杭州银行': '600926',
  '宁波银行': '002142',
  '南京银行': '601009',
  '成都银行': '601838',
  '重庆银行': '601963',
  '青岛银行': '002948',
  '郑州银行': '002936',
  '长沙银行': '601577',
  '贵阳银行': '601997',
  '西安银行': '600928',
  '苏州银行': '002966',
  '齐鲁银行': '601665',
  '厦门银行': '601187',
  '兰州银行': '001227',
  '中国平安': '601318',
  '中国人寿': '601628',
  '中国太保': '601601',
  '新华保险': '601336',
  '中国人保': '601319',
  '中国中免': '601888',
  '万达电影': '002739',
  '华谊兄弟': '300027',
  '光线传媒': '300251',
  '横店影视': '603103',
  '金逸影视': '002415',
  '幸福蓝海': '300528',
  '文投控股': '600715',
  '上海电影': '601595',
  '中影股份': '600977',
  '华策影视': '300133',
  '唐德影视': '300426',
  '鼎龙文化': '002502',
  '捷成股份': '300182',
  '新文化': '300336',
  '引力传媒': '603598',
  '中广天择': '603721',
  '值得买': '300785',
  '壹网壹创': '300792',
  '丽人丽妆': '605136',
  '若羽臣': '003010',
  '凯淳股份': '301001',
  '青木股份': '301110',
  '优趣汇': '0217.HK',
  '宝尊电商': '9991.HK',
  '阿里巴巴': '9988.HK',
  '京东': '9618.HK',
  '拼多多': 'PDD',
  '美团': '3690.HK',
  '腾讯': '0700.HK',
  '网易': '9999.HK',
  '百度': '9888.HK',
  '小米': '1810.HK',
  '快手': '1024.HK',
  '哔哩哔哩': '9626.HK',
  '舜宇光学': '2382.HK',
  '海康威视': '002415',
  '大华股份': '002236',
  '科大讯飞': '002230',
  '寒武纪': '688256',
  '中芯国际': '688981',
  '华大九天': '301269',
  '北方华创': '002371',
  '中微公司': '688012',
  '沪硅产业': '688126',
  '安集科技': '688019',
  '华虹半导体': '1347.HK',
  '台积电': 'TSM',
  '中芯国际': '0981.HK',
  '万科A': '000002',
  '保利发展': '600048',
  '招商蛇口': '001979',
  '金地集团': '600383',
  '华侨城A': '000069',
  '绿地控股': '600606',
  '新城控股': '601155',
  '中南建设': '000961',
  '阳光城': '000671',
  '华夏幸福': '600340',
  '蓝光发展': '600466',
  '荣盛发展': '002146',
  '大悦城': '000031',
  '世茂股份': '600823',
  '首创股份': '600008',
  '北辰实业': '601588',
  '华发股份': '600325',
  '金融街': '000402',
  '中华企业': '600675',
  '陆家嘴': '600663',
  '外高桥': '600648',
  '浦东金桥': '600639',
  '张江高科': '600895',
  '苏州高新': '600736',
  '南京高科': '600064',
  '长春经开': '600215',
  'ST时万': '600241',
  '中天金融': '000540',
  '贵州燃气': '600903',
  '深圳燃气': '601139',
  '重庆燃气': '600917',
  '长春燃气': '600333',
  '佛燃能源': '002911',
  '皖天然气': '603689',
  '浙能电力': '600023',
  '华能国际': '600011',
  '华电国际': '600027',
  '大唐发电': '601991',
  '国电电力': '600795',
  '中国神华': '601088',
  '中煤能源': '601898',
  '兖矿能源': '600188',
  '陕西煤业': '601225',
  '潞安环能': '601699',
  '山西焦化': '600740',
  '开滦股份': '600997',
  '平煤股份': '601666',
  '神火股份': '000933',
  '露天煤业': '002128',
  '冀中能源': '000937',
  '兰花科创': '600123',
  '阳泉煤业': '600348',
  '盘江股份': '600395',
  '上海能源': '600508',
  '淮北矿业': '600985',
  '恒源煤电': '600971',
  '新集能源': '601918',
  '大有能源': '600403',
  '伊泰B股': '900948',
  '昊华能源': '601101',
  '郑州煤电': '600121',
  '安源煤业': '600397',
  'ST安泰': '600408',
  '红阳能源': '600758',
  '锦州能源': '600167',
  '龙星化工': '002442',
  '黑猫股份': '002068',
  '永东股份': '002753',
  '同德化工': '002360',
  '金能科技': '603113',
  '三维股份': '603033',
  '氯碱化工': '600618',
  '三友化工': '600409',
  '中泰化学': '002092',
  '华鲁恒升': '600426',
  '鲁西化工': '000830',
  '扬农化工': '600486',
  '利尔化学': '002258',
  茅台: '600519',
  招行: '600036',
  工行: '601398',
  建行: '601939',
  中行: '601988',
  农行: '601288',
  交行: '601328',
  兴业: '601166',
  浦发: '600000',
  民生: '600016',
  平安银行: '000001',
  光大: '601818',
  中信: '601998',
  北银: '601169',
  上银: '601229',
  苏银: '600919',
  杭银: '600926',
  甬银: '002142',
  南银: '601009',
  成都银行: '601838',
  重银: '601963',
  青银: '002948',
  郑银: '002936',
  长银: '601577',
  贵银: '601997',
  西银: '600928',
  苏银: '002966',
  齐鲁: '601665',
  厦银: '601187',
  兰银: '001227',
  平保: '601318',
  国寿: '601628',
  太保: '601601',
  新华: '601336',
  人保: '601319',
  中免: '601888',
  万科: '000002',
  保利: '600048',
  招蛇: '001979',
  金地: '600383',
  华侨城: '000069',
  绿地: '600606',
  新城: '601155',
  中南: '000961',
  阳光城: '000671',
  华夏幸福: '600340',
  宁德: '300750',
};

// Build the router system prompt for CN stock data
function buildRouterPrompt(): string {
  const companyList = Object.entries(COMPANY_NAME_MAP)
    .slice(0, 50)
    .map(([name, code]) => `${name} → ${code}`)
    .join('\n');

  return `You are a Chinese stock data routing assistant.
Current date: ${getCurrentDate()}

Given a user's natural language query about Chinese A-share stocks, call the appropriate tool(s).

## Company Name to Code Reference (partial list)
${companyList}
...and more

## Guidelines

1. **Stock Code Resolution**: 
   - 6-digit codes starting with 6 → Shanghai (sh)
   - 6-digit codes starting with 9 → Shanghai (sh)
   - 6-digit codes starting with 0 or 3 → Shenzhen (sz)
   - Examples: 600519 → sh600519, 000858 → sz000858, 300750 → sz300750

2. **Index Codes**:
   - 000001 → sh000001 (上证指数)
   - 399001 → sz399001 (深证成指)
   - 399006 → sz399006 (创业板指)
   - 000300 → sh000300 (沪深300)
   - 000016 → sh000016 (上证50)
   - 000688 → sh000688 (科创50)

3. **Date Inference**:
   - "去年" (last year) → 2025
   - "近3年" (last 3 years) → 2023, 2024, 2025
   - "2024年报" → annual report 2024
   - "季度" (quarterly) → quarterly report

4. **Tool Selection**:
   - For current stock price → get_cn_stock_price
   - For multiple stock prices → get_cn_stock_prices
   - For index quotes → get_cn_index_quote
   - For income statement (利润表) → get_cn_income_statement
   - For balance sheet (资产负债表) → get_cn_balance_sheet
   - For cash flow (现金流量表) → get_cn_cashflow_statement
   - For key indicators (ROE, margins, etc.) → get_cn_financial_indicators
   - For comprehensive analysis → call multiple tools as needed

5. **Query Examples**:
   - "贵州茅台现在多少钱" → get_cn_stock_price(code: "600519")
   - "招商银行今日涨跌幅" → get_cn_stock_price(code: "600036")
   - "上证指数当前点位" → get_cn_index_quote(index_code: "000001")
   - "比亚迪2024年年报" → get_cn_income_statement(code: "002594", period: "annual")
   - "宁德时代ROE" → get_cn_financial_indicators(code: "300750")
   - "工商银行资产负载率" → get_cn_balance_sheet(code: "601398")

Call the appropriate tool(s) now.`;
}

// Input schema for the get_cn_stock_data tool
const GetCnStockDataInputSchema = z.object({
  query: z.string().describe('Natural language query about Chinese A-share stocks'),
});

/**
 * Create a get_cn_stock_data tool configured with the specified model.
 */
export function createGetCnStockData(model: string): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'get_cn_stock_data',
    description: `Intelligent meta-tool for retrieving Chinese A-share stock data. Covers real-time prices, financial statements, and key indicators. Use for:
- Stock price queries (贵州茅台, 招商银行, etc.)
- Index quotes (上证指数, 创业板指, 沪深300)
- Financial statements (利润表, 资产负债表, 现金流量表)
- Key financial indicators (ROE, PE, margins, etc.)
- A-share market analysis and comparisons`,
    schema: GetCnStockDataInputSchema,
    func: async (input, _runManager, config?: RunnableConfig) => {
      const onProgress = config?.metadata?.onProgress as ((msg: string) => void) | undefined;

      // 1. Call LLM with CN stock tools bound
      onProgress?.('Fetching A股 data...');
      const { response } = await callLlm(input.query, {
        model,
        systemPrompt: buildRouterPrompt(),
        tools: CN_STOCK_TOOLS,
      });
      const aiMessage = response as AIMessage;

      // 2. Check for tool calls
      const toolCalls = aiMessage.tool_calls as ToolCall[];
      if (!toolCalls || toolCalls.length === 0) {
        return formatToolResult({ error: 'No tools selected for query' }, []);
      }

      // 3. Execute tool calls in parallel
      const toolNames = [...new Set(toolCalls.map(tc => formatSubToolName(tc.name)))];
      onProgress?.(`Fetching from ${toolNames.join(', ')}...`);
      const results = await Promise.all(
        toolCalls.map(async (tc) => {
          try {
            const tool = CN_STOCK_TOOL_MAP.get(tc.name);
            if (!tool) {
              throw new Error(`Tool '${tc.name}' not found`);
            }
            const rawResult = await tool.invoke(tc.args);
            const result = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult);
            const parsed = JSON.parse(result);
            return {
              tool: tc.name,
              args: tc.args,
              data: parsed.data,
              sourceUrls: parsed.sourceUrls || [],
              error: null,
            };
          } catch (error) {
            return {
              tool: tc.name,
              args: tc.args,
              data: null,
              sourceUrls: [],
              error: error instanceof Error ? error.message : String(error),
            };
          }
        })
      );

      // 4. Combine results
      const successfulResults = results.filter((r) => r.error === null);
      const failedResults = results.filter((r) => r.error !== null);

      // Collect all source URLs
      const allUrls = results.flatMap((r) => r.sourceUrls);

      // Build combined data structure
      const combinedData: Record<string, unknown> = {};

      for (const result of successfulResults) {
        const code = (result.args as Record<string, unknown>).code as string | undefined;
        const key = code ? `${result.tool}_${code}` : result.tool;
        combinedData[key] = result.data;
      }

      if (failedResults.length > 0) {
        combinedData._errors = failedResults.map((r) => ({
          tool: r.tool,
          args: r.args,
          error: r.error,
        }));
      }

      return formatToolResult(combinedData, allUrls);
    },
  });
}

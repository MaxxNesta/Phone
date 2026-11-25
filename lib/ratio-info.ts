import type { RatioKey, RatioWindow } from "./financial-ratios";

export type Kind = "x" | "pct" | "times";

/** Every ratio once: what it is called, how it reads, and the two figures it divides. */
export const RATIO: Record<RatioKey, {
  label: string; kind: Kind; lowerIsBetter?: boolean; formula: string; meaning: string;
  parts: (w: RatioWindow) => [number, number];
}> = {
  current: { label: "Current ratio", kind: "x", formula: "Current assets ÷ current liabilities",
    meaning: "Compares current assets to current liabilities.", parts: (w) => [w.currentAssets, w.currentLiabilities] },
  quick: { label: "Quick ratio", kind: "x", formula: "(Current assets − inventory) ÷ current liabilities",
    meaning: "Short-term obligations met from the most liquid assets, inventory excluded.",
    parts: (w) => [w.currentAssets - w.inventory, w.currentLiabilities] },
  cash: { label: "Cash ratio", kind: "x", formula: "Cash and bank ÷ current liabilities",
    meaning: "Short-term liabilities paid off with cash and cash equivalents.", parts: (w) => [w.cash, w.currentLiabilities] },
  absolute: { label: "Absolute liquidity ratio", kind: "x", formula: "(Cash + marketable securities) ÷ current liabilities",
    meaning: "Short-term liabilities covered by cash and marketable securities. The chart holds no short-term investments, so it equals the cash ratio until one is added under 13.",
    parts: (w) => [w.cash, w.currentLiabilities] },
  receivableTurnover: { label: "Receivable turnover", kind: "times", formula: "Net sales ÷ average receivable",
    meaning: "How efficiently receivables are collected: sales made per kyat owed.", parts: (w) => [w.netSales, w.avgReceivable] },
  debtorsTurnover: { label: "Debtors turnover", kind: "times", formula: "Cash collected from customers ÷ average receivable",
    meaning: "How many times receivables were turned into cash in the period.", parts: (w) => [w.collected, w.avgReceivable] },
  creditorsTurnover: { label: "Creditors turnover", kind: "times", formula: "Supplier bills ÷ average payable",
    meaning: "How quickly suppliers are paid. Lower means longer credit is being used.", lowerIsBetter: true,
    parts: (w) => [w.creditPurchases, w.avgPayable] },
  grossMargin: { label: "Gross profit margin", kind: "pct", formula: "Gross profit ÷ net sales",
    meaning: "What is left of each sale after the cost of the goods.", parts: (w) => [w.grossProfit, w.netSales] },
  operatingMargin: { label: "Operating margin", kind: "pct", formula: "Operating profit ÷ net sales",
    meaning: "Profit from trading after running costs, before interest and other income.", parts: (w) => [w.operatingProfit, w.netSales] },
  netMargin: { label: "Earning margin", kind: "pct", formula: "Net profit ÷ net sales",
    meaning: "The share of revenue that becomes profit after all expenses.", parts: (w) => [w.netProfit, w.netSales] },
  roa: { label: "Return on assets (ROA)", kind: "pct", formula: "Net profit ÷ average total assets",
    meaning: "Profit earned on everything the business holds.", parts: (w) => [w.netProfit, w.avgAssets] },
  roe: { label: "Return on equity (ROE)", kind: "pct", formula: "Net profit ÷ average equity",
    meaning: "The return generated on the owners' equity.", parts: (w) => [w.netProfit, w.avgEquity] },
  roi: { label: "Return on investment (ROI)", kind: "pct", formula: "Net profit ÷ average (equity + debt)",
    meaning: "Profit against all the money invested, the owners' and the lenders'.", parts: (w) => [w.netProfit, w.avgCapital] },
  debtToEquity: { label: "Debt to equity", kind: "x", lowerIsBetter: true, formula: "Debt ÷ equity",
    meaning: "Total borrowing compared with the owners' equity. Debt is the loans under 23.", parts: (w) => [w.debt, w.equity] },
  debtToAssets: { label: "Debt to assets", kind: "x", lowerIsBetter: true, formula: "Debt ÷ total assets",
    meaning: "The share of the assets financed by borrowing.", parts: (w) => [w.debt, w.totalAssets] },
  liabilitiesToEquity: { label: "Liabilities to equity", kind: "x", lowerIsBetter: true, formula: "Total liabilities ÷ equity",
    meaning: "Everything owed, borrowing and suppliers alike, against equity.", parts: (w) => [w.totalLiabilities, w.equity] },
  interestCover: { label: "Interest cover", kind: "x", formula: "Operating profit ÷ interest expense",
    meaning: "How many times operating profit covers the interest due. Interest is posted to the Finance Costs group (69).",
    parts: (w) => [w.operatingProfit, w.interest] },
  financialLeverage: { label: "Financial leverage", kind: "x", lowerIsBetter: true, formula: "Average total assets ÷ average equity",
    meaning: "How far borrowed money finances the operations.", parts: (w) => [w.avgAssets, w.avgEquity] },
  operatingLeverage: { label: "Operating leverage", kind: "x", lowerIsBetter: true, formula: "Gross profit ÷ operating profit",
    meaning: "How much a change in sales moves operating profit: the weight of fixed costs. Cost of sales is taken as the variable cost, expenses as the fixed.",
    parts: (w) => [w.grossProfit, w.operatingProfit] },
};

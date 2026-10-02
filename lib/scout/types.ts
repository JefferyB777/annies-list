/** What Price Scout hands back to the app. */
export type Confidence = "high" | "medium" | "low";

export type ScoutStep = {
  source: string;
  /** what this step found, in plain words */
  result: string;
  found: boolean;
};

export type ScoutReport = {
  ok: boolean;
  /** item name as identified */
  item: string;
  brand?: string;
  size?: string;
  /** estimated typical price for one package, in dollars */
  estimate: number | null;
  low?: number;
  high?: number;
  currency: "USD";
  confidence: Confidence | null;
  /** where the winning number came from */
  source: { name: string; detail: string; url?: string } | null;
  /** e.g. "Baldwin, NY" */
  area: string | null;
  /** one-paragraph plain summary for the app */
  summary: string;
  /** every source the agent checked, in order */
  steps: ScoutStep[];
  generatedAt: string;
};

export type ScoutQuery = {
  barcode?: string | null;
  name?: string | null;
  zip?: string | null;
};

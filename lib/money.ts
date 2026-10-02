const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export const money = (n: number) => fmt.format(Math.round(n * 100) / 100);

export const round2 = (n: number) => Math.round(n * 100) / 100;

export const productKeyFor = (barcode: string | null, name: string) =>
  barcode ? barcode : "name:" + name.trim().toLowerCase().replace(/\s+/g, " ");

export type Signal = {
  tone: "good" | "high" | "even" | "new";
  title: string;
  detail?: string;
};

/** Compare the price on the shelf to what she has paid before. */
export function priceSignal(
  price: number,
  stats: { avg: number; count: number; low: number; lowStore: string } | null,
  store: string
): Signal {
  if (!stats || stats.count === 0) {
    return { tone: "new", title: "First time scanning this", detail: "We'll remember the price for next time." };
  }
  if (price <= 0) {
    return { tone: "even", title: `You usually pay ${money(stats.avg)}` };
  }
  const diff = (price - stats.avg) / stats.avg;
  const times = stats.count === 1 ? "once before" : `${stats.count} times before`;
  const lowNote =
    stats.lowStore && stats.lowStore !== store && stats.low < price
      ? `Lowest you've paid: ${money(stats.low)} at ${stats.lowStore}.`
      : `Bought ${times}.`;
  if (diff <= -0.05) {
    return { tone: "good", title: `Good price — ${money(stats.avg - price)} under your usual`, detail: `Bought ${times}.` };
  }
  if (diff >= 0.05) {
    return { tone: "high", title: `Running high — you usually pay ${money(stats.avg)}`, detail: lowNote };
  }
  return { tone: "even", title: `Right on your usual ${money(stats.avg)}`, detail: lowNote };
}

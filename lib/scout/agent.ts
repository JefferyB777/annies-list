import type { Confidence, ScoutQuery, ScoutReport, ScoutStep } from "./types";
import {
  blsAverage,
  categoryForName,
  geocodeZip,
  lookupProduct,
  matchBls,
  openPrices,
  webResearch,
  type Place,
  type PriceObs,
  type Product,
} from "./sources";

/**
 * Price Scout — finds a typical local price for one grocery item.
 *
 * It works through public sources from most to least specific and stops at the
 * first answer it can trust, recording every step so the app can show the
 * shopper exactly where the number came from:
 *
 *   1. Open Prices: this exact barcode, near the shopper's ZIP
 *   2. Open Prices: this exact barcode, anywhere in the U.S.
 *   3. Open Prices: the same kind of item (category), near the ZIP
 *   4. BLS average retail price for the region (staples only)
 *   5. Claude web research of local stores (only if an API key is configured)
 *   6. Open Prices: the same kind of item anywhere in the U.S. (last resort)
 */

const money = (n: number) => `$${n.toFixed(2)}`;
const round2 = (n: number) => Math.round(n * 100) / 100;

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Drop obvious outliers (bulk packs, typos) before averaging. */
function trimmed(obs: PriceObs[]) {
  if (obs.length < 4) return obs;
  const med = median(obs.map((o) => o.price));
  return obs.filter((o) => o.price >= med / 2.5 && o.price <= med * 2.5);
}

function summarizeObs(obs: PriceObs[]) {
  const clean = trimmed(obs);
  const prices = clean.map((o) => o.price);
  const stores = [...new Set(clean.map((o) => o.store))].slice(0, 3);
  return { estimate: round2(median(prices)), low: Math.min(...prices), high: Math.max(...prices), n: clean.length, stores };
}

/** The most specific Open Food Facts category for the product, e.g. "en:canned-peas". */
function bestCategory(p: Product | null): string | null {
  if (!p?.categories?.length) return null;
  const en = p.categories.filter((c) => c.startsWith("en:"));
  return en[en.length - 1] || null;
}

const pretty = (tag: string) => tag.replace(/^en:/, "").replace(/-/g, " ");

/** Turn a per-lb / per-gallon / per-dozen BLS price into a price for this package. */
function scaleBls(price: number, per: "lb" | "doz" | "gal", p: Product | null, name: string) {
  if (per === "lb" && p?.unit === "g" && p.grams) return { value: price * (p.grams / 453.6), note: `scaled to ${p.size || p.grams + " g"}` };
  if (per === "gal" && p?.unit === "ml" && p.grams) return { value: price * (p.grams / 3785.4), note: `scaled to ${p.size || p.grams + " ml"}` };
  if (per === "doz") {
    const count = Number((p?.size || name).match(/(\d+)\s*(ct|count|eggs|pk|pack)?/i)?.[1]);
    if (count && count !== 12 && count <= 60) return { value: price * (count / 12), note: `scaled to ${count} eggs` };
  }
  return { value: price, note: `per ${per === "doz" ? "dozen" : per === "gal" ? "gallon" : "pound"}` };
}

export async function runScout(q: ScoutQuery): Promise<ScoutReport> {
  const steps: ScoutStep[] = [];
  const barcode = q.barcode?.replace(/\D/g, "") || null;
  const zip = q.zip?.trim() || null;

  // Where is the shopper, and what is the item?
  const [place, product] = await Promise.all([
    zip ? geocodeZip(zip) : Promise.resolve(null as Place | null),
    barcode ? lookupProduct(barcode) : Promise.resolve(null as Product | null),
  ]);
  const itemName = product ? [product.brand && !product.name.toLowerCase().includes(product.brand.toLowerCase()) ? product.brand : "", product.name].filter(Boolean).join(" ") : q.name?.trim() || "";
  const area = place?.label || null;
  const nearWords = place ? `near ${place.label}` : "near you";

  if (!itemName && !barcode) {
    return finish({ item: "", estimate: null, confidence: null, source: null, summary: "Price Scout needs a barcode or an item name." });
  }
  if (zip && !place) steps.push({ source: "ZIP code lookup", result: `Couldn't find ZIP ${zip}, so searching nationally.`, found: false });

  const category = bestCategory(product) || (!product && q.name ? await categoryForName(q.name) : null);

  type Candidate = { estimate: number; low?: number; high?: number; confidence: Confidence; source: ScoutReport["source"]; summary: string };
  let pick: Candidate | null = null;

  // 1. Exact barcode, nearby
  if (barcode && place && !pick) {
    const obs = await openPrices({ product_code: product?.code || barcode, near: place, radiusKm: 40 });
    if (obs.length) {
      const s = summarizeObs(obs);
      pick = {
        estimate: s.estimate, low: s.low, high: s.high,
        confidence: s.n >= 3 ? "high" : "medium",
        source: { name: "Open Prices", detail: `${s.n} shopper-reported price${s.n > 1 ? "s" : ""} within 25 miles`, url: `https://prices.openfoodfacts.org/products/${product?.code || barcode}` },
        summary: `${s.n} shopper${s.n > 1 ? "s" : ""} reported this exact item ${nearWords}${s.stores.length ? ` (${s.stores.join(", ")})` : ""}.`,
      };
    }
    steps.push({ source: "Open Prices · this item nearby", result: obs.length ? `${obs.length} price report${obs.length > 1 ? "s" : ""} found` : "No reports within 25 miles", found: !!obs.length });
  }

  // 2. Exact barcode, anywhere in the U.S.
  if (barcode && !pick) {
    const obs = await openPrices({ product_code: product?.code || barcode });
    if (obs.length) {
      const s = summarizeObs(obs);
      pick = {
        estimate: s.estimate, low: s.low, high: s.high,
        confidence: s.n >= 3 ? "medium" : "low",
        source: { name: "Open Prices", detail: `${s.n} shopper-reported price${s.n > 1 ? "s" : ""} across the U.S.`, url: `https://prices.openfoodfacts.org/products/${product?.code || barcode}` },
        summary: `No local reports yet, so this is based on ${s.n} U.S. shopper report${s.n > 1 ? "s" : ""} for the same barcode.`,
      };
    }
    steps.push({ source: "Open Prices · this item, U.S.", result: obs.length ? `${obs.length} price report${obs.length > 1 ? "s" : ""} found` : "No U.S. reports for this barcode", found: !!obs.length });
  }

  // 3. Same kind of item, nearby
  if (category && place && !pick) {
    const obs = await openPrices({ category, near: place, radiusKm: 40 });
    if (obs.length >= 2) {
      const s = summarizeObs(obs);
      pick = {
        estimate: s.estimate, low: s.low, high: s.high, confidence: "low",
        source: { name: "Open Prices", detail: `${s.n} prices for similar ${pretty(category)} within 25 miles`, url: "https://prices.openfoodfacts.org" },
        summary: `Based on ${s.n} shopper-reported prices for similar ${pretty(category)} ${nearWords}. Brand and size may differ.`,
      };
    }
    steps.push({ source: `Open Prices · similar ${pretty(category)} nearby`, result: obs.length ? `${obs.length} price report${obs.length > 1 ? "s" : ""} found` : "None nearby", found: obs.length >= 2 });
  }

  // 4. Government average for staples
  const blsText = [itemName, category ? pretty(category) : ""].join(" ");
  if (!pick && matchBls(blsText)) {
    const b = await blsAverage(blsText, place?.state);
    if (b) {
      const scaled = scaleBls(b.price, b.per, product, itemName);
      pick = {
        estimate: round2(scaled.value), confidence: "medium",
        source: { name: "U.S. Bureau of Labor Statistics", detail: `${b.label}, ${b.area} average, ${b.period} (${scaled.note})`, url: `https://data.bls.gov/timeseries/${b.series}` },
        summary: `The government's average for ${b.label.toLowerCase()} in ${b.area} was ${money(b.price)} ${b.per === "doz" ? "a dozen" : b.per === "gal" ? "a gallon" : "a pound"} in ${b.period}.`,
      };
    }
    steps.push({ source: "BLS average retail prices", result: b ? `${b.label}: ${money(b.price)} per ${b.per} (${b.period})` : "No recent average published", found: !!b });
  }

  // 5. Claude web research (optional)
  if (!pick || pick.confidence === "low") {
    if (process.env.ANTHROPIC_API_KEY) {
      const w = await webResearch(product?.size ? `${itemName} ${product.size}` : itemName, place);
      if (w && (!pick || pick.confidence === "low")) {
        pick = {
          estimate: round2(w.price), confidence: "medium",
          source: { name: w.store ? `${w.store} (web)` : "Web research", detail: w.note || "Found by searching local store listings", url: w.url },
          summary: `Claude searched store listings ${nearWords} and found ${money(w.price)}${w.store ? ` at ${w.store}` : ""}.`,
        };
      }
      steps.push({ source: "Claude web research", result: w ? `${money(w.price)}${w.store ? ` at ${w.store}` : ""}` : "No credible listing found", found: !!w });
    } else {
      steps.push({ source: "Claude web research", result: "Not turned on (needs an Anthropic API key)", found: false });
    }
  }

  // 6. Same kind of item, anywhere in the U.S.
  if (category && !pick) {
    const obs = await openPrices({ category });
    if (obs.length >= 2) {
      const s = summarizeObs(obs);
      pick = {
        estimate: s.estimate, low: s.low, high: s.high, confidence: "low",
        source: { name: "Open Prices", detail: `${s.n} U.S. prices for similar ${pretty(category)}`, url: "https://prices.openfoodfacts.org" },
        summary: `Rough guide only: ${s.n} shopper-reported prices for similar ${pretty(category)} across the U.S.`,
      };
    }
    steps.push({ source: `Open Prices · similar ${pretty(category)}, U.S.`, result: obs.length ? `${obs.length} price report${obs.length > 1 ? "s" : ""} found` : "None found", found: obs.length >= 2 });
  }

  const sizeNote = product?.size ? ` (${product.size})` : "";
  const nice = itemName ? itemName.charAt(0).toUpperCase() + itemName.slice(1) : "This item";
  const label = `${nice}${sizeNote}`;
  if (!pick) {
    return finish({
      item: itemName, estimate: null, confidence: null, source: null,
      summary: `${label}: no public price data yet ${nearWords}. Once you confirm the shelf price, Annie's List will remember it.`,
    });
  }
  const range = pick.low !== undefined && pick.high !== undefined && pick.high - pick.low >= 0.05 ? ` Range ${money(pick.low)}–${money(pick.high)}.` : "";
  return finish({
    item: itemName,
    estimate: pick.estimate, low: pick.low, high: pick.high,
    confidence: pick.confidence, source: pick.source,
    summary: `${label}: about ${money(pick.estimate)} ${nearWords}. ${pick.summary}${range}`,
  });

  function finish(r: Pick<ScoutReport, "item" | "estimate" | "confidence" | "source" | "summary"> & { low?: number; high?: number }): ScoutReport {
    return {
      ok: r.estimate !== null,
      brand: product?.brand,
      size: product?.size,
      currency: "USD",
      area,
      steps,
      generatedAt: new Date().toISOString(),
      ...r,
    };
  }
}

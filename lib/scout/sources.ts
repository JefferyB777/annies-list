/**
 * Price Scout's tools. Each one asks a single public source a single question.
 * All responses are cached by Next/Vercel so repeat scans are instant and we
 * stay well inside every source's fair-use limits.
 */

const UA = "AnniesList/1.0 (grocery budget app; contact: jefferybjewelers@gmail.com)";
const DAY = 86400;

async function getJSON(url: string, revalidate: number, init: RequestInit = {}): Promise<any | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      ...init,
      headers: { "User-Agent": UA, Accept: "application/json", ...(init.headers || {}) },
      signal: ctrl.signal,
      next: { revalidate },
    } as RequestInit);
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/* ---------------- ZIP code → place + coordinates ---------------- */

export type Place = { zip: string; lat: number; lon: number; label: string; state: string };

export async function geocodeZip(zip: string): Promise<Place | null> {
  if (!/^\d{5}$/.test(zip)) return null;
  const j = await getJSON(`https://api.zippopotam.us/us/${zip}`, 30 * DAY);
  const p = j?.places?.[0];
  if (!p) return null;
  return {
    zip,
    lat: Number(p.latitude),
    lon: Number(p.longitude),
    label: `${p["place name"]}, ${p["state abbreviation"]}`,
    state: p["state abbreviation"],
  };
}

/* ---------------- Barcode → product (Open Food Facts) ---------------- */

export type Product = {
  code: string;
  name: string;
  brand?: string;
  size?: string;
  grams?: number; // net weight in grams, or volume in ml, when known
  unit?: "g" | "ml";
  categories: string[];
};

export async function lookupProduct(barcode: string): Promise<Product | null> {
  const codes = [barcode];
  if (barcode.length === 12) codes.push("0" + barcode);
  if (barcode.length === 13 && barcode.startsWith("0")) codes.push(barcode.slice(1));
  for (const code of codes) {
    const j = await getJSON(
      `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=code,product_name,brands,quantity,product_quantity,product_quantity_unit,categories_tags`,
      7 * DAY
    );
    const p = j?.product;
    if (j?.status !== 1 || !p?.product_name) continue;
    const unit = p.product_quantity_unit === "ml" ? "ml" : p.product_quantity_unit === "g" ? "g" : undefined;
    return {
      code: p.code || code,
      name: String(p.product_name).trim(),
      brand: (p.brands || "").split(",")[0].trim() || undefined,
      size: (p.quantity || "").trim() || undefined,
      grams: p.product_quantity ? Number(p.product_quantity) : undefined,
      unit,
      categories: Array.isArray(p.categories_tags) ? p.categories_tags : [],
    };
  }
  return null;
}

/* ---------------- Typed name → typical category ---------------- */

/** "a can of peas" → "peas"; remembers packaging words so "can" can favor canned categories. */
function cleanName(name: string) {
  const lower = name.toLowerCase();
  const packaging = (lower.match(/\b(can|canned|tin|frozen|bag|box|jar|bottle|carton)\b/) || [])[1] || null;
  const terms = lower
    .replace(/\b(a|an|the|of|some|one|1|can|cans|canned|tin|tins|bag|bags|box|boxes|jar|jars|bottle|bottles|carton|cartons|pack|package|dozen|doz|lb|lbs|oz|ct|count)\b/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { terms: terms || lower.trim(), packaging };
}

/** For items typed in by name ("can of peas"), find the Open Food Facts category most U.S. products with that name share. */
export async function categoryForName(name: string): Promise<string | null> {
  const { terms, packaging } = cleanName(name);
  const q = new URLSearchParams({
    q: `${terms} countries_tags:"en:united-states"`,
    page_size: "20",
    fields: "categories_tags",
  });
  const j = await getJSON(`https://search.openfoodfacts.org/search?${q}`, 7 * DAY);
  const hits: any[] = j?.hits || [];
  const counts = new Map<string, number>();
  for (const p of hits) {
    const en = (p.categories_tags || []).filter((c: string) => c.startsWith("en:"));
    const last = en[en.length - 1];
    if (!last) continue;
    let w = 1;
    if (packaging && last.includes(packaging === "can" || packaging === "tin" ? "canned" : packaging)) w += 1;
    counts.set(last, (counts.get(last) || 0) + w);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 2 ? best[0] : null;
}

/* ---------------- Open Prices (crowd-sourced shelf prices) ---------------- */

export type PriceObs = { price: number; date: string | null; store: string; city: string };

type OpenPricesFilter = { product_code?: string; category?: string; near?: Place; radiusKm?: number };

/** Prices in USD from the last ~18 months, newest first. */
export async function openPrices(f: OpenPricesFilter): Promise<PriceObs[]> {
  const q = new URLSearchParams({ currency: "USD", size: "50", order_by: "-date" });
  const since = new Date(Date.now() - 548 * DAY * 1000).toISOString().slice(0, 10);
  q.set("date__gte", since);
  if (f.product_code) q.set("product_code", f.product_code);
  if (f.category) q.set("product__categories_tags__contains", f.category);
  if (f.near) {
    q.set("lat", String(f.near.lat));
    q.set("lon", String(f.near.lon));
    q.set("radius_km", String(f.radiusKm ?? 40));
  }
  const j = await getJSON(`https://prices.openfoodfacts.org/api/v1/prices?${q}`, DAY);
  const items: any[] = j?.items || [];
  return items
    .filter((i) => typeof i.price === "number" && i.price > 0 && !i.price_per) // skip per-kg style prices
    .map((i) => ({
      price: i.price,
      date: i.date,
      store: i.location?.osm_name || i.location?.osm_brand || "a store",
      city: i.location?.osm_address_city || "",
    }));
}

/* ---------------- BLS average retail prices (government) ---------------- */

/** Staples the Bureau of Labor Statistics prices every month. */
const BLS_ITEMS: { words: RegExp; code: string; label: string; per: "lb" | "doz" | "gal"; }[] = [
  { words: /\beggs?\b/i, code: "708111", label: "Eggs, grade A large", per: "doz" },
  { words: /\bwhole milk\b|\bmilk\b/i, code: "709112", label: "Milk, whole", per: "gal" },
  { words: /\bwhite bread\b|\bbread\b/i, code: "702111", label: "Bread, white pan", per: "lb" },
  { words: /\bground beef\b|\bhamburger\b/i, code: "703112", label: "Ground beef", per: "lb" },
  { words: /\bchicken breast/i, code: "FF1101", label: "Chicken breast, boneless", per: "lb" },
  { words: /\bwhole chicken\b|\bchicken\b/i, code: "706111", label: "Chicken, whole", per: "lb" },
  { words: /\bbananas?\b/i, code: "711211", label: "Bananas", per: "lb" },
  { words: /\bcoffee\b/i, code: "717311", label: "Coffee, ground roast", per: "lb" },
  { words: /\brice\b/i, code: "701312", label: "Rice, white long grain", per: "lb" },
  { words: /\bbacon\b/i, code: "704111", label: "Bacon, sliced", per: "lb" },
  { words: /\bpotato(es)?\b/i, code: "712112", label: "Potatoes, white", per: "lb" },
  { words: /\bapples?\b/i, code: "711111", label: "Apples, Red Delicious", per: "lb" },
  { words: /\bcheddar\b/i, code: "710212", label: "Cheddar cheese", per: "lb" },
  { words: /\bbutter\b/i, code: "FS1101", label: "Butter, salted", per: "lb" },
  { words: /\btomato(es)?\b/i, code: "712311", label: "Tomatoes, field grown", per: "lb" },
  { words: /\boranges?\b/i, code: "711311", label: "Oranges, navel", per: "lb" },
  { words: /\bflour\b/i, code: "701111", label: "Flour, all purpose", per: "lb" },
  { words: /\bsugar\b/i, code: "715211", label: "Sugar, white", per: "lb" },
];

/** BLS area codes: Northeast urban = 0100, Midwest 0200, South 0300, West 0400, U.S. city average 0000. */
const NORTHEAST = new Set(["CT", "ME", "MA", "NH", "RI", "VT", "NJ", "NY", "PA"]);
const MIDWEST = new Set(["IL", "IN", "MI", "OH", "WI", "IA", "KS", "MN", "MO", "NE", "ND", "SD"]);
const WEST = new Set(["AZ", "CO", "ID", "MT", "NV", "NM", "UT", "WY", "AK", "CA", "HI", "OR", "WA"]);
export function blsRegion(state?: string): { code: string; label: string } {
  if (state && NORTHEAST.has(state)) return { code: "0100", label: "Northeast cities" };
  if (state && MIDWEST.has(state)) return { code: "0200", label: "Midwest cities" };
  if (state && WEST.has(state)) return { code: "0400", label: "West cities" };
  if (state) return { code: "0300", label: "South cities" };
  return { code: "0000", label: "U.S. cities" };
}

export type BlsResult = { price: number; per: "lb" | "doz" | "gal"; label: string; period: string; area: string; series: string };

/** Words that mean the item is a prepared product, not the raw staple BLS prices. */
const PROCESSED =
  /(soup|sauce|chips?|juice|cookie|cracker|cake|candy|chocolate|cereal|\bbar\b|snack|paste|ketchup|crumbs|peanut|almond|oat|noodle|pasta|frozen|dinner|seasoning|mix|drink|\btea\b|creamer|yogurt|ice cream|pudding|spread|nugget|tender|broth|stock|salad|bowl|wrap|pie|muffin|bagel|roll|bun|vinegar|wine|beer|baby|dog|cat)/i;

export function matchBls(text: string) {
  if (PROCESSED.test(text)) return null;
  return BLS_ITEMS.find((i) => i.words.test(text)) || null;
}

export async function blsAverage(text: string, state?: string): Promise<BlsResult | null> {
  const item = matchBls(text);
  if (!item) return null;
  const region = blsRegion(state);
  for (const area of [region, { code: "0000", label: "U.S. cities" }]) {
    const series = `APU${area.code}${item.code}`;
    const j = await getJSON(`https://api.bls.gov/publicAPI/v2/timeseries/data/${series}`, 7 * DAY);
    const row = j?.Results?.series?.[0]?.data?.[0];
    const value = row ? Number(row.value) : NaN;
    if (isFinite(value) && value > 0) {
      return { price: value, per: item.per, label: item.label, period: `${row.periodName} ${row.year}`, area: area.label, series };
    }
  }
  return null;
}

/* ---------------- Optional: Claude web research ---------------- */

export type WebResult = { price: number; store?: string; url?: string; title?: string; note?: string };

/**
 * Asks Claude (with web search) for a typical shelf price near the shopper.
 * Only runs when ANTHROPIC_API_KEY is set in Vercel's environment variables.
 */
export async function webResearch(item: string, place: Place | null): Promise<WebResult | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const where = place ? `${place.label} ${place.zip}` : "the United States";
  const prompt =
    `Find the current typical regular shelf price for this grocery item at stores near ${where}: "${item}". ` +
    `Prefer the stores' own websites or weekly ads (e.g. Stop & Shop, ShopRite, King Kullen, Walmart, Target, Costco, BJ's, Sam's Club, CVS). ` +
    `Use the package size named if there is one. Reply with ONLY one line of JSON, no other text: ` +
    `{"price": number, "store": string, "url": string, "note": string}. note = under 15 words on what the price is for. ` +
    `If you cannot find a credible price, reply {"price": null}.`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 45000);
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.SCOUT_MODEL || "claude-sonnet-5-5",
        max_tokens: 1024,
        tools: [
          {
            type: "web_search_20250305",
            name: "web_search",
            max_uses: 4,
            ...(place ? { user_location: { type: "approximate", city: place.label.split(",")[0], region: place.state, country: "US" } } : {}),
          },
        ],
        messages: [{ role: "user", content: prompt }],
      }),
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = await res.json();
    const blocks: any[] = data?.content || [];
    const text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("");
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]);
    if (typeof parsed.price !== "number" || !(parsed.price > 0)) return null;
    const cite = blocks.flatMap((b) => b.citations || []).find((c: any) => c.url);
    return {
      price: parsed.price,
      store: parsed.store,
      url: parsed.url || cite?.url,
      title: cite?.title,
      note: parsed.note,
    };
  } catch {
    return null;
  }
}

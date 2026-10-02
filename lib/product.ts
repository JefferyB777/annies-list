/**
 * Looks up a product name from its barcode using Open Food Facts
 * (free, public, no key). Non-food items (pharmacy, household) are often
 * missing — in that case Annie just types the name once and the app
 * remembers it from then on.
 */
export async function lookupProductName(barcode: string): Promise<string | null> {
  const candidates = [barcode];
  if (barcode.length === 12) candidates.push("0" + barcode); // UPC-A → EAN-13
  if (barcode.length === 13 && barcode.startsWith("0")) candidates.push(barcode.slice(1));

  for (const code of candidates) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4500);
      const res = await fetch(
        `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,brands,quantity`,
        { signal: ctrl.signal }
      );
      clearTimeout(t);
      if (!res.ok) continue;
      const data = await res.json();
      const p = data?.product;
      if (data?.status !== 1 || !p?.product_name) continue;
      const brand = (p.brands || "").split(",")[0].trim();
      const name = String(p.product_name).trim();
      const qty = (p.quantity || "").trim();
      const withBrand = brand && !name.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${name}` : name;
      return qty ? `${withBrand} (${qty})` : withBrand;
    } catch {
      // network hiccup or timeout — try the next form, then give up quietly
    }
  }
  return null;
}

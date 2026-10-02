import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { Budget, Item, NewItem, PriceStats } from "./types";

export interface DataStore {
  mode: "cloud" | "preview";
  init(): Promise<void>;
  getActiveBudget(): Promise<Budget | null>;
  createBudget(name: string, total: number): Promise<Budget>;
  updateBudgetTotal(id: string, total: number): Promise<void>;
  listItems(budgetId: string): Promise<Item[]>;
  addItem(item: NewItem): Promise<Item>;
  deleteItem(id: string): Promise<void>;
  /** Everything she has paid for this product, across every budget and store. */
  priceStats(productKey: string): Promise<PriceStats | null>;
}

export function summarize(rows: { price: number; store: string; name: string; created_at: string }[]): PriceStats | null {
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const low = sorted.reduce((m, r) => (r.price < m.price ? r : m), sorted[0]);
  const avg = sorted.reduce((s, r) => s + r.price, 0) / sorted.length;
  return {
    count: sorted.length,
    avg,
    last: sorted[0].price,
    lastStore: sorted[0].store,
    low: low.price,
    lowStore: low.store,
    name: sorted[0].name,
  };
}

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

/* ------------------------------------------------------------------ */
/* Preview mode: everything stays on this phone. Used until Supabase   */
/* keys are added, so the app can be tried right away.                 */
/* ------------------------------------------------------------------ */

type LocalShape = { budgets: (Budget & { active: boolean })[]; items: Item[] };
const LS_KEY = "annies-list:v1";

class LocalStore implements DataStore {
  mode = "preview" as const;
  private mem: LocalShape = { budgets: [], items: [] };

  private load(): LocalShape {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) this.mem = JSON.parse(raw);
    } catch {}
    return this.mem;
  }
  private save() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(this.mem));
    } catch {}
  }
  async init() {
    this.load();
  }
  async getActiveBudget() {
    const b = this.load().budgets.filter((b) => b.active).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    return b ? { id: b.id, name: b.name, total: b.total, created_at: b.created_at } : null;
  }
  async createBudget(name: string, total: number) {
    const s = this.load();
    s.budgets.forEach((b) => (b.active = false));
    const b = { id: uid(), name, total, created_at: new Date().toISOString(), active: true };
    s.budgets.push(b);
    this.save();
    return { id: b.id, name: b.name, total: b.total, created_at: b.created_at };
  }
  async updateBudgetTotal(id: string, total: number) {
    const b = this.load().budgets.find((b) => b.id === id);
    if (b) b.total = total;
    this.save();
  }
  async listItems(budgetId: string) {
    return this.load()
      .items.filter((i) => i.budget_id === budgetId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async addItem(item: NewItem) {
    const s = this.load();
    const full: Item = { ...item, id: uid(), created_at: new Date().toISOString() };
    s.items.push(full);
    this.save();
    return full;
  }
  async deleteItem(id: string) {
    const s = this.load();
    s.items = s.items.filter((i) => i.id !== id);
    this.save();
  }
  async priceStats(productKey: string) {
    return summarize(this.load().items.filter((i) => i.product_key === productKey));
  }
}

/* ------------------------------------------------------------------ */
/* Cloud mode: Supabase. Each phone gets an anonymous account on first */
/* open, so there is no sign-up for Annie now, and the same account    */
/* can be upgraded to email login in Phase two.                        */
/* ------------------------------------------------------------------ */

const num = (v: unknown) => (typeof v === "number" ? v : Number(v));
const toBudget = (r: any): Budget => ({ id: r.id, name: r.name, total: num(r.total), created_at: r.created_at });
const toItem = (r: any): Item => ({
  id: r.id,
  budget_id: r.budget_id,
  product_key: r.product_key,
  barcode: r.barcode,
  name: r.name,
  store: r.store,
  price: num(r.price),
  qty: r.qty,
  created_at: r.created_at,
});

class CloudStore implements DataStore {
  mode = "cloud" as const;
  constructor(private sb: SupabaseClient) {}

  async init() {
    const { data } = await this.sb.auth.getSession();
    if (!data.session) {
      const { error } = await this.sb.auth.signInAnonymously();
      if (error) throw new Error("Could not sign in: " + error.message);
    }
  }
  async getActiveBudget() {
    const { data, error } = await this.sb
      .from("budgets")
      .select("*")
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) throw error;
    return data?.[0] ? toBudget(data[0]) : null;
  }
  async createBudget(name: string, total: number) {
    const off = await this.sb.from("budgets").update({ active: false }).eq("active", true);
    if (off.error) throw off.error;
    const { data, error } = await this.sb.from("budgets").insert({ name, total, active: true }).select().single();
    if (error) throw error;
    return toBudget(data);
  }
  async updateBudgetTotal(id: string, total: number) {
    const { error } = await this.sb.from("budgets").update({ total }).eq("id", id);
    if (error) throw error;
  }
  async listItems(budgetId: string) {
    const { data, error } = await this.sb
      .from("items")
      .select("*")
      .eq("budget_id", budgetId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map(toItem);
  }
  async addItem(item: NewItem) {
    const { data, error } = await this.sb.from("items").insert(item).select().single();
    if (error) throw error;
    return toItem(data);
  }
  async deleteItem(id: string) {
    const { error } = await this.sb.from("items").delete().eq("id", id);
    if (error) throw error;
  }
  async priceStats(productKey: string) {
    const { data, error } = await this.sb
      .from("items")
      .select("price, store, name, created_at")
      .eq("product_key", productKey)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return summarize((data || []).map((r: any) => ({ ...r, price: num(r.price) })));
  }
}

export function makeStore(): DataStore {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url && key) return new CloudStore(createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } }));
  return new LocalStore();
}

export const previewStore = () => new LocalStore();

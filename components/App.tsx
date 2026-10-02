"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DataStore, makeStore, previewStore } from "@/lib/data";
import type { Budget, Item, NewItem } from "@/lib/types";
import { money, round2 } from "@/lib/money";
import Scanner from "./Scanner";
import AddItemSheet from "./AddItemSheet";

const DEFAULT_STORES = ["Sam's Club", "BJ's", "Stop & Shop", "King Kullen", "ShopRite", "CVS"];
const PREF_KEY = "annies-list:prefs";

type Prefs = { stores: string[]; current: string };

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (Array.isArray(p.stores) && p.stores.length) return p;
    }
  } catch {}
  return { stores: DEFAULT_STORES, current: DEFAULT_STORES[0] };
}
function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(p));
  } catch {}
}

type Flow = { kind: "none" } | { kind: "scan" } | { kind: "add"; barcode: string | null };

export default function App() {
  const [store, setStore] = useState<DataStore | null>(null);
  const [notice, setNotice] = useState("");
  const [budget, setBudget] = useState<Budget | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [prefs, setPrefs] = useState<Prefs>({ stores: DEFAULT_STORES, current: DEFAULT_STORES[0] });
  const [flow, setFlow] = useState<Flow>({ kind: "none" });
  const [menu, setMenu] = useState(false);
  const [toast, setToast] = useState("");

  // Start up: connect to the cloud (or preview mode), load the active budget.
  useEffect(() => {
    setPrefs(loadPrefs());
    (async () => {
      let s = makeStore();
      try {
        await s.init();
      } catch (e: any) {
        s = previewStore();
        await s.init();
        setNotice("Couldn't reach the cloud database, so this is saving on your phone for now.");
      }
      setStore(s);
      try {
        const b = await s.getActiveBudget();
        setBudget(b);
        if (b) setItems(await s.listItems(b.id));
      } catch (e: any) {
        setNotice(e?.message || "Something went wrong loading your budget.");
      }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const spent = useMemo(() => round2(items.reduce((s, i) => s + i.price * i.qty, 0)), [items]);
  const remaining = budget ? round2(budget.total - spent) : 0;
  const pct = budget && budget.total > 0 ? Math.min(1, spent / budget.total) : 0;
  const state = !budget ? "ok" : remaining < 0 ? "over" : remaining <= budget.total * 0.1 ? "low" : "ok";

  const byStore = useMemo(() => {
    const m = new Map<string, number>();
    items.forEach((i) => m.set(i.store, (m.get(i.store) || 0) + i.price * i.qty));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [items]);

  const setCurrentStore = (name: string) => {
    const p = { ...prefs, current: name };
    setPrefs(p);
    savePrefs(p);
  };
  const addStore = () => {
    const name = window.prompt("Store name")?.trim();
    if (!name) return;
    const stores = prefs.stores.includes(name) ? prefs.stores : [...prefs.stores, name];
    const p = { stores, current: name };
    setPrefs(p);
    savePrefs(p);
  };

  const startBudget = async (total: number, name = "Groceries") => {
    if (!store) return;
    const b = await store.createBudget(name, total);
    setBudget(b);
    setItems([]);
  };

  const handleAdd = useCallback(
    async (item: NewItem) => {
      if (!store) return;
      const saved = await store.addItem(item);
      setItems((prev) => [saved, ...prev]);
      setFlow({ kind: "none" });
      setToast(`Added ${saved.name.length > 28 ? saved.name.slice(0, 26) + "…" : saved.name}`);
    },
    [store]
  );

  const removeItem = async (it: Item) => {
    if (!store) return;
    if (!window.confirm(`Remove ${it.name}? This puts ${money(it.price * it.qty)} back in the budget.`)) return;
    try {
      await store.deleteItem(it.id);
      setItems((prev) => prev.filter((x) => x.id !== it.id));
    } catch (e: any) {
      setToast("Couldn't remove it — try again");
    }
  };

  const editTotal = async () => {
    if (!store || !budget) return;
    const v = window.prompt("Budget amount", String(budget.total));
    const n = v ? Number(v.replace(/[^0-9.]/g, "")) : NaN;
    if (!isFinite(n) || n <= 0) return;
    await store.updateBudgetTotal(budget.id, round2(n));
    setBudget({ ...budget, total: round2(n) });
    setMenu(false);
  };

  const newBudget = async () => {
    if (!budget) return;
    const v = window.prompt("Start a fresh budget. How much?", String(budget.total));
    const n = v ? Number(v.replace(/[^0-9.]/g, "")) : NaN;
    if (!isFinite(n) || n <= 0) return;
    await startBudget(round2(n));
    setMenu(false);
    setToast("New budget started — price history kept");
  };

  if (loading) {
    return (
      <main className="shell center">
        <Logo />
        <p className="muted">Getting your list ready…</p>
      </main>
    );
  }

  if (!budget) return <BudgetSetup notice={notice} onStart={startBudget} />;

  return (
    <main className="shell">
      <header className="topbar">
        <Logo />
        <button className="icon-btn" onClick={() => setMenu(true)} aria-label="Budget settings">
          <span aria-hidden>•••</span>
        </button>
      </header>

      {notice && <p className="notice">{notice}</p>}

      <section className={`hero hero-${state}`} aria-live="polite">
        <span className="mono eyebrow">{state === "over" ? "OVER BUDGET BY" : "LEFT TO SPEND"}</span>
        <div className="hero-number">{money(Math.abs(remaining))}</div>
        <div className="meter" aria-hidden>
          <span style={{ width: `${pct * 100}%` }} />
        </div>
        <div className="hero-sub">
          <span>
            <b>{money(spent)}</b> spent
          </span>
          <button className="hero-total" onClick={editTotal}>
            of {money(budget.total)}
          </button>
        </div>
      </section>

      <section className="stores" aria-label="Which store are you in?">
        <span className="mono eyebrow">SHOPPING AT</span>
        <div className="chips">
          {prefs.stores.map((s) => (
            <button
              key={s}
              className={`chip ${s === prefs.current ? "chip-on" : ""}`}
              onClick={() => setCurrentStore(s)}
              aria-pressed={s === prefs.current}
            >
              {s}
            </button>
          ))}
          <button className="chip chip-add" onClick={addStore}>
            + Store
          </button>
        </div>
      </section>

      {byStore.length > 1 && (
        <section className="split">
          {byStore.map(([s, amt]) => (
            <div key={s} className="split-row">
              <span>{s}</span>
              <span className="split-bar">
                <span style={{ width: `${(amt / spent) * 100}%` }} />
              </span>
              <span className="mono">{money(amt)}</span>
            </div>
          ))}
        </section>
      )}

      <section className="cart">
        <div className="cart-head">
          <h2>In the cart</h2>
          <span className="mono muted">{items.reduce((n, i) => n + i.qty, 0)} items</span>
        </div>
        {items.length === 0 ? (
          <div className="empty">
            <p>
              <b>Nothing yet.</b> Tap <i>Scan item</i>, point at a barcode, and confirm the shelf price. Every item comes
              off your {money(budget.total)}.
            </p>
          </div>
        ) : (
          <ul className="items">
            {items.map((it) => (
              <li key={it.id} className="item">
                <div className="item-main">
                  <span className="item-name">{it.name}</span>
                  <span className="item-meta">
                    {it.store}
                    {it.qty > 1 ? ` · ${it.qty} × ${money(it.price)}` : ""}
                  </span>
                </div>
                <span className="item-price mono">{money(it.price * it.qty)}</span>
                <button className="item-x" onClick={() => removeItem(it)} aria-label={`Remove ${it.name}`}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="actionbar">
        <button className="btn-primary btn-scan" onClick={() => setFlow({ kind: "scan" })}>
          <ScanIcon /> Scan item
        </button>
        <button className="btn-secondary" onClick={() => setFlow({ kind: "add", barcode: null })}>
          Type it in
        </button>
      </div>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}

      {flow.kind === "scan" && (
        <Scanner
          onClose={() => setFlow({ kind: "none" })}
          onDetected={(code) => setFlow({ kind: "add", barcode: code })}
          onTypeInstead={() => setFlow({ kind: "add", barcode: null })}
        />
      )}

      {flow.kind === "add" && store && (
        <AddItemSheet
          store={store}
          budgetId={budget.id}
          storeName={prefs.current}
          remaining={remaining}
          barcode={flow.barcode}
          onAdd={handleAdd}
          onCancel={() => setFlow({ kind: "none" })}
        />
      )}

      {menu && (
        <div className="sheet-wrap" role="dialog" aria-label="Budget settings">
          <div className="backdrop" onClick={() => setMenu(false)} />
          <div className="sheet">
            <div className="grabber" aria-hidden />
            <h3 className="sheet-title">Budget</h3>
            <button className="menu-row" onClick={editTotal}>
              <span>Change budget amount</span>
              <span className="mono muted">{money(budget.total)}</span>
            </button>
            <button className="menu-row" onClick={newBudget}>
              <span>Start a new budget</span>
              <span className="muted">clears the cart</span>
            </button>
            <p className="fine">
              {store?.mode === "cloud"
                ? "Saved to the cloud. Your price history carries over to every new budget."
                : "Preview mode: saving on this phone only. Your price history carries over to every new budget."}
            </p>
            <button className="btn-text btn-block" onClick={() => setMenu(false)}>
              Done
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function BudgetSetup({ onStart, notice }: { onStart: (n: number) => Promise<void>; notice: string }) {
  const [digits, setDigits] = useState("50000");
  const [busy, setBusy] = useState(false);
  const amount = digits ? parseInt(digits, 10) / 100 : 0;
  return (
    <main className="shell setup">
      <Logo />
      {notice && <p className="notice">{notice}</p>}
      <div className="setup-body">
        <h1>
          One budget.
          <br />
          Every store.
        </h1>
        <p className="lede">
          Set what you can spend. Scan as you shop — at Sam&apos;s, BJ&apos;s, the supermarket or CVS — and watch it
          count down.
        </p>
        <label className="field">
          <span className="field-label">My grocery budget</span>
          <input
            className="input-price input-hero"
            inputMode="numeric"
            value={amount ? money(amount) : ""}
            placeholder="$0.00"
            onChange={(e) => setDigits(e.target.value.replace(/\D/g, "").replace(/^0+/, "").slice(0, 7))}
            onFocus={(e) => e.currentTarget.select()}
          />
        </label>
        <div className="quick">
          {[200, 300, 500, 800].map((n) => (
            <button key={n} className="chip" onClick={() => setDigits(String(n * 100))}>
              ${n}
            </button>
          ))}
        </div>
      </div>
      <div className="actionbar">
        <button
          className="btn-primary btn-scan"
          disabled={amount <= 0 || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onStart(round2(amount));
            } finally {
              setBusy(false);
            }
          }}
        >
          Start with {money(amount)}
        </button>
      </div>
    </main>
  );
}

function Logo() {
  return (
    <div className="logo">
      <span className="logo-mark" aria-hidden>
        <svg viewBox="0 0 32 32" width="30" height="30">
          <rect x="1" y="1" width="30" height="30" rx="9" fill="var(--accent)" />
          <path d="M9 11h14M9 16h10M9 21h7" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
          <circle cx="23" cy="21" r="2.4" fill="#fff" />
        </svg>
      </span>
      <span className="logo-word">
        Annie&apos;s <b>List</b>
      </span>
    </div>
  );
}

function ScanIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
      <path d="M8 9v6M11 9v6M14 9v6M17 9v6" />
    </svg>
  );
}

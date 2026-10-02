"use client";

import { useEffect, useRef, useState } from "react";
import type { DataStore } from "@/lib/data";
import type { NewItem, PriceStats } from "@/lib/types";
import { money, priceSignal, productKeyFor, round2 } from "@/lib/money";
import { lookupProductName } from "@/lib/product";

type Props = {
  store: DataStore;
  budgetId: string;
  storeName: string;
  remaining: number;
  barcode: string | null;
  onAdd: (item: NewItem) => Promise<void>;
  onCancel: () => void;
};

/** Cents-style entry: typing 3, 4, 9 shows $3.49 — fast and one-handed. */
const centsToDollars = (digits: string) => (digits ? parseInt(digits, 10) / 100 : 0);

export default function AddItemSheet({ store, budgetId, storeName, remaining, barcode, onAdd, onCancel }: Props) {
  const [name, setName] = useState("");
  const [looking, setLooking] = useState(!!barcode);
  const [stats, setStats] = useState<PriceStats | null>(null);
  const [digits, setDigits] = useState("");
  const [pristine, setPristine] = useState(true); // first keystroke replaces a pre-filled price
  const [qty, setQty] = useState(1);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const priceRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // Barcode: check her own history first, then the public product database.
  useEffect(() => {
    if (!barcode) {
      setTimeout(() => nameRef.current?.focus(), 250);
      return;
    }
    let alive = true;
    (async () => {
      const s = await store.priceStats(barcode).catch(() => null);
      if (!alive) return;
      if (s) {
        setStats(s);
        setName(s.name);
        setDigits(String(Math.round(s.last * 100)));
        setLooking(false);
        setTimeout(() => priceRef.current?.focus(), 250);
        return;
      }
      const found = await lookupProductName(barcode);
      if (!alive) return;
      setLooking(false);
      if (found) {
        setName(found);
        setTimeout(() => priceRef.current?.focus(), 150);
      } else {
        setTimeout(() => nameRef.current?.focus(), 150);
      }
    })();
    return () => {
      alive = false;
    };
  }, [barcode, store]);

  // Typed-in items: once she stops typing a name, check if she's bought it before.
  useEffect(() => {
    if (barcode || name.trim().length < 2) return;
    const t = setTimeout(async () => {
      const s = await store.priceStats(productKeyFor(null, name)).catch(() => null);
      setStats(s);
      if (s && !digits) {
        setDigits(String(Math.round(s.last * 100)));
        setPristine(true);
      }
    }, 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, barcode, store]);

  const price = centsToDollars(digits);
  const lineTotal = round2(price * qty);
  const after = round2(remaining - lineTotal);
  const signal = priceSignal(price, stats, storeName);
  const canAdd = name.trim().length > 0 && price > 0 && !saving;

  const onPriceChange = (raw: string) => {
    let d = raw.replace(/\D/g, "");
    if (pristine && digits && d.length > digits.length) {
      // replace the pre-filled price with the newly typed digit
      d = d.slice(-1 * (d.length - digits.length));
    }
    setPristine(false);
    setDigits(d.replace(/^0+/, "").slice(0, 6));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canAdd) return;
    setSaving(true);
    setErr("");
    try {
      await onAdd({
        budget_id: budgetId,
        product_key: productKeyFor(barcode, name),
        barcode,
        name: name.trim(),
        store: storeName,
        price: round2(price),
        qty,
      });
    } catch (e: any) {
      setErr(e?.message || "Couldn't save that item. Try again.");
      setSaving(false);
    }
  };

  return (
    <div className="sheet-wrap" role="dialog" aria-label="Add item">
      <div className="backdrop" onClick={onCancel} />
      <form className="sheet" onSubmit={submit}>
        <div className="grabber" aria-hidden />
        <div className="sheet-head">
          <span className="mono eyebrow">{barcode ? `UPC ${barcode}` : "ADD BY NAME"}</span>
          <span className="store-pill">at {storeName}</span>
        </div>

        <label className="field">
          <span className="field-label">Item</span>
          <input
            ref={nameRef}
            className="input-lg"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={looking ? "Looking it up…" : "What is it?"}
            autoComplete="off"
          />
        </label>

        <div className="price-row">
          <label className="field price-field">
            <span className="field-label">Shelf price</span>
            <input
              ref={priceRef}
              className="input-price"
              inputMode="numeric"
              value={digits ? money(price) : ""}
              placeholder="$0.00"
              onChange={(e) => onPriceChange(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="Shelf price"
            />
          </label>
          <div className="field qty-field">
            <span className="field-label">Qty</span>
            <div className="stepper">
              <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Fewer">
                −
              </button>
              <span className="mono">{qty}</span>
              <button type="button" onClick={() => setQty((q) => Math.min(99, q + 1))} aria-label="More">
                +
              </button>
            </div>
          </div>
        </div>

        {(name.trim().length > 1 || stats) && !looking && (
          <div className={`signal signal-${signal.tone}`} role="status">
            <span className="signal-dot" aria-hidden />
            <div>
              <strong>{signal.title}</strong>
              {signal.detail && <p>{signal.detail}</p>}
            </div>
          </div>
        )}

        {err && <p className="error">{err}</p>}

        <button type="submit" className="btn-primary btn-block" disabled={!canAdd}>
          {price > 0 ? (
            <span>
              Add {money(lineTotal)} <span className="btn-sub">· leaves {money(after)}</span>
            </span>
          ) : (
            "Enter the shelf price"
          )}
        </button>
        <button type="button" className="btn-text btn-block" onClick={onCancel}>
          Cancel
        </button>
      </form>
    </div>
  );
}

"use client";

import { useState } from "react";
import type { ScoutReport } from "@/lib/scout/types";
import { money } from "@/lib/money";

/** Ask the Price Scout agent (server) for a typical local price. */
export async function fetchScout(q: { barcode?: string | null; name?: string | null; zip?: string | null }): Promise<ScoutReport | null> {
  const p = new URLSearchParams();
  if (q.barcode) p.set("barcode", q.barcode);
  else if (q.name) p.set("name", q.name.trim());
  if (q.zip) p.set("zip", q.zip);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 55000);
    const res = await fetch(`/api/scout?${p}`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    return (await res.json()) as ScoutReport;
  } catch {
    return null;
  }
}

const CONF_LABEL = { high: "Strong match", medium: "Good guide", low: "Rough guide" } as const;

type Props = {
  report: ScoutReport | null;
  loading: boolean;
  zip: string;
  shelfPrice: number;
  applied?: boolean;
  onUse: (price: number) => void;
  onSetZip: () => void;
};

export default function ScoutCard({ report, loading, zip, shelfPrice, applied, onUse, onSetZip }: Props) {
  const [open, setOpen] = useState(false);

  if (!zip) {
    return (
      <div className="scout scout-empty">
        <ScoutHead area={null} />
        <p>See what this usually costs near you.</p>
        <button type="button" className="scout-btn" onClick={onSetZip}>
          Add your ZIP code
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="scout" aria-busy="true">
        <ScoutHead area={null} />
        <p className="scout-working">
          <span className="scout-dots" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          Checking local prices…
        </p>
      </div>
    );
  }

  if (!report) return null;

  if (!report.ok || report.estimate === null) {
    return (
      <div className="scout scout-none">
        <ScoutHead area={report.area} />
        <p>No public price data for this one yet. Your confirmed price will be the first.</p>
      </div>
    );
  }

  const est = report.estimate;
  const diff = shelfPrice > 0 ? Math.round((shelfPrice - est) * 100) / 100 : 0;
  const pct = est > 0 ? diff / est : 0;
  const compare =
    shelfPrice <= 0
      ? null
      : Math.abs(pct) < 0.05
        ? { tone: "even", text: "Shelf price is right on the local typical." }
        : diff > 0
          ? { tone: "high", text: `Shelf is ${money(diff)} above typical.` }
          : { tone: "good", text: `Shelf is ${money(-diff)} below typical — nice.` };

  return (
    <div className="scout">
      <ScoutHead area={report.area} />
      <div className="scout-main">
        <div>
          <div className="scout-price">{money(est)}</div>
          <div className="scout-sub">
            typical{report.low !== undefined && report.high !== undefined && report.high - report.low >= 0.05
              ? ` · ${money(report.low)}–${money(report.high)}`
              : ""}
          </div>
        </div>
        {report.confidence && <span className={`scout-conf conf-${report.confidence}`}>{CONF_LABEL[report.confidence]}</span>}
      </div>

      {compare && <p className={`scout-compare cmp-${compare.tone}`}>{compare.text}</p>}
      {applied && <p className="scout-compare cmp-even">Filled in above. Change it if the shelf tag says different.</p>}

      {report.source && (
        <p className="scout-source">
          Source:{" "}
          {report.source.url ? (
            <a href={report.source.url} target="_blank" rel="noopener noreferrer">
              {report.source.name}
            </a>
          ) : (
            report.source.name
          )}{" "}
          · {report.source.detail}
        </p>
      )}

      <div className="scout-actions">
        {!applied && Math.abs(shelfPrice - est) >= 0.01 && (
          <button type="button" className="scout-btn" onClick={() => onUse(est)}>
            Use {money(est)}
          </button>
        )}
        <button type="button" className="scout-link" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "Hide report" : "See report"}
        </button>
      </div>

      {open && (
        <div className="scout-report">
          <p>{report.summary}</p>
          <ol>
            {report.steps.map((s, i) => (
              <li key={i} className={s.found ? "hit" : ""}>
                <b>{s.source}:</b> {s.result}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function ScoutHead({ area }: { area: string | null }) {
  return (
    <div className="scout-head">
      <span className="scout-badge" aria-hidden>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <circle cx="11" cy="11" r="6.5" />
          <path d="M16 16l4.5 4.5" />
        </svg>
      </span>
      <span className="mono scout-title">PRICE SCOUT</span>
      {area && <span className="scout-area">near {area}</span>}
    </div>
  );
}

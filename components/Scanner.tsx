"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  onDetected: (code: string) => void;
  onClose: () => void;
  onTypeInstead: () => void;
};

export default function Scanner({ onDetected, onClose, onTypeInstead }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"starting" | "scanning" | "denied" | "error">("starting");
  const [typed, setTyped] = useState("");
  const done = useRef(false);

  useEffect(() => {
    let controls: { stop: () => void } | null = null;
    let cancelled = false;

    (async () => {
      try {
        const [{ BrowserMultiFormatReader }, { DecodeHintType, BarcodeFormat }] = await Promise.all([
          import("@zxing/browser"),
          import("@zxing/library"),
        ]);
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.CODE_128,
        ]);
        const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120 });
        if (cancelled || !videoRef.current) return;
        controls = await reader.decodeFromConstraints(
          { audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } },
          videoRef.current,
          (result) => {
            if (!result || done.current) return;
            done.current = true;
            try {
              navigator.vibrate?.(60);
            } catch {}
            controls?.stop();
            onDetected(result.getText());
          }
        );
        if (cancelled) controls.stop();
        else setStatus("scanning");
      } catch (e: any) {
        if (cancelled) return;
        setStatus(e?.name === "NotAllowedError" ? "denied" : "error");
      }
    })();

    return () => {
      cancelled = true;
      controls?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitTyped = (e: React.FormEvent) => {
    e.preventDefault();
    const code = typed.replace(/\D/g, "");
    if (code.length >= 6) {
      done.current = true;
      onDetected(code);
    }
  };

  return (
    <div className="scanner" role="dialog" aria-label="Scan a barcode">
      <video ref={videoRef} className="scanner-video" playsInline muted />
      <div className="scanner-shade" />
      <div className="scanner-top">
        <button className="btn-ghost-light" onClick={onClose} aria-label="Close scanner">
          ✕ Close
        </button>
        <span className="mono scanner-tag">SCAN</span>
      </div>

      <div className="reticle" aria-hidden>
        <span className="laser" />
      </div>

      <div className="scanner-bottom">
        {status === "starting" && <p className="scanner-msg">Starting camera…</p>}
        {status === "scanning" && <p className="scanner-msg">Line up the barcode inside the box</p>}
        {status === "denied" && (
          <p className="scanner-msg">
            Camera access is off. Allow the camera for this site in your phone settings, or type the barcode below.
          </p>
        )}
        {status === "error" && <p className="scanner-msg">The camera couldn&apos;t start. Type the barcode below instead.</p>}

        <form className="typed-code" onSubmit={submitTyped}>
          <input
            inputMode="numeric"
            placeholder="Type barcode numbers"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            aria-label="Barcode number"
          />
          <button type="submit" className="btn-light" disabled={typed.replace(/\D/g, "").length < 6}>
            Use
          </button>
        </form>
        <button className="link-light" onClick={onTypeInstead}>
          No barcode? Add it by name
        </button>
      </div>
    </div>
  );
}

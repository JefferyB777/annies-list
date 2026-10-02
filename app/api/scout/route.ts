import { NextRequest, NextResponse } from "next/server";
import { runScout } from "@/lib/scout/agent";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/scout?barcode=041303001127&zip=11510
 * GET /api/scout?name=canned%20peas&zip=11510
 *
 * Returns a ScoutReport: item, estimated local price, source, confidence,
 * a one-paragraph summary, and every source checked.
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const barcode = p.get("barcode");
  const name = p.get("name");
  const zip = p.get("zip");

  if (!barcode && !name) {
    return NextResponse.json({ error: "Send a barcode or a name." }, { status: 400 });
  }
  if ((name && name.length > 120) || (barcode && barcode.length > 20) || (zip && zip.length > 10)) {
    return NextResponse.json({ error: "Input too long." }, { status: 400 });
  }

  const report = await runScout({ barcode, name, zip });
  return NextResponse.json(report, {
    headers: { "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400" },
  });
}

import { NextResponse } from "next/server";
import { dataSource } from "@/lib/datasource";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = url.searchParams.get("symbol") ?? "TXO";
  const quote = await dataSource.getQuote(symbol);
  return NextResponse.json(quote);
}

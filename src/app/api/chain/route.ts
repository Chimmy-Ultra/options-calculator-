import { NextResponse } from "next/server";
import { dataSource } from "@/lib/datasource";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const expiryId = url.searchParams.get("expiry") ?? "m";
  const data = await dataSource.getChain(expiryId);
  return NextResponse.json(data);
}

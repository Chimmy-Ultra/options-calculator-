import { NextResponse } from "next/server";
import { dataSource } from "@/lib/datasource";

export const dynamic = "force-dynamic";

export async function GET() {
  const expiries = await dataSource.getExpiries();
  return NextResponse.json({ expiries });
}

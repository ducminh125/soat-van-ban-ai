import { NextResponse } from "next/server";
import { getHistory, saveHistory } from "@/lib/history";
import type { StoredDocument } from "@/lib/types";

export async function GET(){
  return NextResponse.json(await getHistory());
}

export async function POST(req: Request){
  const doc = await req.json() as StoredDocument;
  await saveHistory(doc);
  return NextResponse.json({ ok: true });
}

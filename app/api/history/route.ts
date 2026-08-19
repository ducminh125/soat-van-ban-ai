import { NextResponse } from "next/server";
import { getHistory, saveHistory } from "@/lib/history";
import type { StoredDocument } from "@/lib/types";

export async function GET(){
  return NextResponse.json(await getHistory());
}

export async function POST(req: Request){
  try {
    const doc = await req.json() as StoredDocument;
    await saveHistory(doc);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("History API error:", error);
    return NextResponse.json({ ok: false, error: "Không thể lưu lịch sử" }, { status: 500 });
  }
}

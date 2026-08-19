import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  try {
    const { id } = await req.json();
    if (!id) {
      return NextResponse.json({ ok: false, error: "Thiếu id" }, { status: 400 });
    }

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      return NextResponse.json({ ok: false, error: "Chưa cấu hình Supabase" }, { status: 500 });
    }

    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const { error } = await supabase.from("review_history").delete().eq("id", id);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Delete history error:", error);
    return NextResponse.json({ ok: false, error: "Không thể xóa lịch sử" }, { status: 500 });
  }
}

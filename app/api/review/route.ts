import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const formData = await req.formData();
  const file = formData.get("file");

  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { error: "Chưa có file tải lên" },
      { status: 400 }
    );
  }

  return NextResponse.json({
    message: "Đã nhận file",
    filename: file.name,
    size: file.size,
    note: "API OpenAI cần được kết nối trong bước tiếp theo."
  });
}

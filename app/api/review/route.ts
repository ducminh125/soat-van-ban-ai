import { NextResponse } from "next/server";
import OpenAI from "openai";
import mammoth from "mammoth";
import pdf from "pdf-parse";
import { reviewPrompt } from "@/lib/ai/prompts";

export const runtime = "nodejs";

async function extractText(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const name = file.name.toLowerCase();

  if (name.endsWith(".docx")) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (name.endsWith(".pdf")) {
    const result = await pdf(buffer);
    return result.text;
  }

  return buffer.toString("utf-8");
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Chưa có file" }, { status: 400 });
    }

    const text = await extractText(file);

    if (!text.trim()) {
      return NextResponse.json({ error: "Không đọc được nội dung file" }, { status: 400 });
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({
        error: "Thiếu OPENAI_API_KEY trong Environment Variables"
      }, { status: 500 });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: reviewPrompt },
        { role: "user", content: text.slice(0, 30000) }
      ]
    });

    return NextResponse.json({
      filename: file.name,
      result: response.choices[0]?.message?.content || "Không có kết quả"
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

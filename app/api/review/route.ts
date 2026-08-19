import { NextResponse } from "next/server";
import OpenAI from "openai";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { reviewPrompt } from "../../../lib/ai/prompts";

export const runtime = "nodejs";
export const maxDuration = 60;

async function extractText(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const name = file.name.toLowerCase();

  if (name.endsWith(".docx")) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (name.endsWith(".pdf")) {
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    await parser.destroy();
    return result.text;
  }

  return buffer.toString("utf-8");
}

function parseAiJson(content: string) {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch {}
    }
    return {
      issues: [],
      facts: [],
      explanation: content
    };
  }
}

export async function POST(req: Request) {
  const start = Date.now();
  try {
    const form = await req.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Chưa có file tải lên" }, { status: 400 });
    }

    const text = await extractText(file);

    if (!text.trim()) {
      return NextResponse.json({ error: "Không đọc được nội dung file" }, { status: 400 });
    }

    if (!process.env.AI_API_KEY) {
      return NextResponse.json({ error: "Thiếu AI_API_KEY trên Vercel" }, { status: 500 });
    }

    const client = new OpenAI({
      apiKey: process.env.AI_API_KEY,
      baseURL: process.env.AI_BASE_URL || "https://api.shopaikey.com/v1",
      timeout: 50000
    });

    const completion = await client.chat.completions.create({
      model: process.env.AI_MODEL || "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: reviewPrompt },
        { role: "user", content: text.slice(0, 30000) }
      ]
    });

    const content = completion.choices[0]?.message?.content || "{}";
    const parsed = parseAiJson(content);

    return NextResponse.json({
      filename: file.name,
      issues: parsed.issues || [],
      facts: parsed.facts || [],
      result: parsed,
      elapsed: Date.now() - start
    });

  } catch (e) {
    console.error("REVIEW_ERROR", e);
    return NextResponse.json({
      error: e instanceof Error ? e.message : String(e),
      hint: "Kiểm tra AI_API_KEY, AI_BASE_URL và AI_MODEL trên Vercel"
    }, { status: 500 });
  }
}

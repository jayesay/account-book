import { NextResponse } from "next/server";
import {
  CATEGORIES,
  inferCategory,
  normalizeCategory,
} from "../../../lib/categories";
import { getSupabase } from "../../../lib/expenses";

type ExpenseRow = {
  id: number;
  description: string;
  category?: string | null;
};

const GEMINI_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
  "gemini-3.8-flash",
];

function extractJson(text: string): Array<{ id?: number; category?: string }> | null {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    return JSON.parse(text.slice(start, end + 1)) as Array<{
      id?: number;
      category?: string;
    }>;
  } catch {
    return null;
  }
}

async function classifyWithGemini(
  apiKey: string,
  rows: ExpenseRow[],
): Promise<Map<number, string>> {
  const prompt = `아래 지출을 식비, 교통, 쇼핑, 문화, 기타 중 하나로만 분류하세요.
JSON 배열만 반환하세요. 예: [{"id":1,"category":"식비"}]

데이터:
${JSON.stringify(rows.map((row) => ({ id: row.id, description: row.description })))}`;

  for (const modelName of GEMINI_MODELS) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.1,
              responseMimeType: "application/json",
            },
          }),
          signal: AbortSignal.timeout(15000),
        },
      );

      if (!response.ok) continue;

      const payload = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text =
        payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ??
        "";
      const parsed = extractJson(text);
      if (!parsed) continue;

      return new Map(
        parsed
          .filter((item) => Number.isFinite(Number(item.id)))
          .map((item) => [Number(item.id), normalizeCategory(item.category)]),
      );
    } catch {
      continue;
    }
  }

  return new Map();
}

export async function POST() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("expenses")
    .select("id, description, category");

  if (error) {
    return NextResponse.json({
      updated: 0,
      missingColumn: /category/i.test(error.message),
    });
  }

  const rows = (data ?? []) as ExpenseRow[];
  const missing = rows.filter((row) => !row.category);

  if (missing.length === 0) {
    return NextResponse.json({ updated: 0 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const classified = apiKey
    ? await classifyWithGemini(apiKey, missing)
    : new Map<number, string>();

  let updated = 0;

  for (const row of missing) {
    const category = classified.get(row.id) ?? inferCategory(row.description);
    const result = await supabase
      .from("expenses")
      .update({ category })
      .eq("id", row.id);

    if (!result.error) {
      updated += 1;
    }
  }

  return NextResponse.json({
    updated,
    categories: CATEGORIES,
  });
}

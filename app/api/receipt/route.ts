import { NextResponse } from "next/server";
import { normalizeCategory } from "../../../lib/categories";
import { getSupabase, insertExpense } from "../../../lib/expenses";

type ReceiptFields = {
  date?: string | null;
  amount?: number | null;
  store?: string | null;
  category?: string | null;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const GEMINI_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
];
const GEMINI_TIMEOUT_MS = 20000;

const RECEIPT_SCHEMA = {
  type: "object",
  properties: {
    date: {
      type: "string",
      description: "YYYY-MM-DD. 모르면 빈 값",
      nullable: true,
    },
    amount: {
      type: "integer",
      description: "결제 총액, 원 단위 정수",
      nullable: true,
    },
    store: {
      type: "string",
      description: "가게 또는 상호명",
      nullable: true,
    },
    category: {
      type: "string",
      enum: ["식비", "교통", "쇼핑", "문화", "기타"],
      description: "지출 카테고리",
      nullable: true,
    },
  },
  required: ["date", "amount", "store", "category"],
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isRetryableGeminiError(error: unknown) {
  return /503|429|high demand|unavailable|try again/i.test(errorMessage(error));
}

function userFacingGeminiError(error: unknown) {
  if (isRetryableGeminiError(error)) {
    return "AI 서버가 잠시 혼잡합니다. 잠시 후 다시 시도해 주세요.";
  }

  return "영수증을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

function seoulDate() {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Seoul",
  });
}

function extractJson(text: string): ReceiptFields | null {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  try {
    return JSON.parse(candidate.slice(start, end + 1)) as ReceiptFields;
  } catch {
    return null;
  }
}

function extractGeminiText(payload: {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
}) {
  const parts = payload.candidates?.[0]?.content?.parts ?? [];
  return parts.map((part) => part.text ?? "").join("").trim();
}

function buildReceiptPrompt() {
  return `이 이미지가 영수증이면 결제 정보를 추출하세요.

오늘 날짜(Asia/Seoul): ${seoulDate()}

규칙:
1. JSON만 반환하세요. 형식은 {"date":"YYYY-MM-DD"|null,"amount":정수|null,"store":"가게이름"|null,"category":"식비"|"교통"|"쇼핑"|"문화"|"기타"|null}
2. amount는 합계, 총액, TOTAL, 결제금액처럼 최종 결제 금액입니다. 부가세나 단품 가격이 아닙니다.
3. 금액은 원 단위 정수입니다. 예: 12,800원 → 12800
4. 날짜가 보이면 YYYY-MM-DD로 변환하세요. 연도가 없으면 올해를 사용하세요.
5. 날짜가 없으면 오늘 날짜를 사용하세요.
6. store는 가게/상호명입니다. 없으면 짧은 품목명으로 대체하세요.
7. category는 가게와 품목을 보고 식비, 교통, 쇼핑, 문화, 기타 중 하나로 분류하세요.
8. 영수증이 아니면 date, amount, store, category를 모두 null로 두세요.`;
}

async function generateReceiptJson(
  apiKey: string,
  mimeType: string,
  imageBase64: string,
) {
  let lastError: unknown;

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
            contents: [
              {
                role: "user",
                parts: [
                  {
                    inline_data: {
                      mime_type: mimeType,
                      data: imageBase64,
                    },
                  },
                  { text: buildReceiptPrompt() },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.1,
              responseMimeType: "application/json",
              responseSchema: RECEIPT_SCHEMA,
            },
          }),
          signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
        },
      );

      const rawText = await response.text();

      if (!response.ok) {
        const error = new Error(`Gemini ${modelName} ${response.status}: ${rawText}`);
        lastError = error;

        if (response.status === 404 || isRetryableGeminiError(error)) {
          continue;
        }

        throw error;
      }

      const text = extractGeminiText(
        JSON.parse(rawText) as Parameters<typeof extractGeminiText>[0],
      );

      if (!text) {
        lastError = new Error(`Gemini ${modelName} returned an empty response`);
        continue;
      }

      return text;
    } catch (error) {
      lastError = error;

      if (
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError")
      ) {
        continue;
      }

      if (isRetryableGeminiError(error)) {
        await sleep(400);
        continue;
      }
    }
  }

  throw lastError ?? new Error("Gemini request failed");
}

function formatConfirmation(
  date: string,
  amount: number,
  store: string,
  category: string,
) {
  const [, month, day] = date.split("-");

  return `${store}에서 ${Number(month)}월 ${Number(day)}일 ${amount.toLocaleString("ko-KR")}원(${category})을 저장했어요!`;
}

export async function POST(request: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY가 설정되지 않았습니다." },
        { status: 500 },
      );
    }

    const formData = await request.formData();
    const file = formData.get("image");

    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json(
        { error: "영수증 사진을 선택해 주세요." },
        { status: 400 },
      );
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: "JPG, PNG, WEBP, HEIC 이미지만 올릴 수 있습니다." },
        { status: 400 },
      );
    }

    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: "이미지 크기는 8MB 이하여야 합니다." },
        { status: 400 },
      );
    }

    const imageBase64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const parsed = extractJson(
      await generateReceiptJson(apiKey, file.type, imageBase64),
    );

    if (!parsed) {
      return NextResponse.json({
        reply: "영수증에서 정보를 읽지 못했어요. 더 선명한 사진으로 다시 시도해 주세요.",
        saved: false,
        expense: null,
        intent: "receipt",
      });
    }

    const amount = Number(parsed.amount);
    const store = parsed.store?.trim() || "영수증";
    const date = parsed.date?.trim() || seoulDate();

    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({
        reply: "영수증에서 결제 금액을 찾지 못했어요. 금액을 직접 말씀해 주세요.",
        saved: false,
        expense: null,
        intent: "receipt",
      });
    }

    if (!DATE_PATTERN.test(date)) {
      return NextResponse.json({
        reply: "영수증에서 날짜를 찾지 못했어요. 언제 결제하신 건가요?",
        saved: false,
        expense: null,
        intent: "receipt",
      });
    }

    const expense = {
      date,
      amount: Math.round(amount),
      description: store,
      category: normalizeCategory(parsed.category),
    };

    const supabase = getSupabase();
    const { error } = await insertExpense(supabase, expense);

    if (error) {
      console.error("Supabase insert error:", error);
      return NextResponse.json(
        { error: "지출 저장에 실패했습니다. 잠시 후 다시 시도해 주세요." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      reply: formatConfirmation(
        expense.date,
        expense.amount,
        expense.description,
        expense.category,
      ),
      saved: true,
      expense,
      intent: "receipt",
    });
  } catch (error) {
    console.error("Receipt vision error:", error);

    return NextResponse.json(
      { error: userFacingGeminiError(error) },
      { status: 500 },
    );
  }
}

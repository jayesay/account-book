import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

type ChatRole = "user" | "assistant";

type ChatRequest = {
  message?: string;
  history?: Array<{
    role?: ChatRole;
    content?: string;
  }>;
};

type ChatIntent = "save" | "query";

type ExpenseRow = {
  date: string;
  amount: number;
  description: string;
};

type ParsedExpense = ExpenseRow;

type GeminiExpense = {
  date?: string | null;
  amount?: number | null;
  description?: string | null;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const AMOUNT_PATTERN =
  /(?:\d{1,3}(?:,\d{3})+|\d+)\s*원|\d+\s*만\s*원?|\d+\s*천\s*원?/;
const QUESTION_PATTERN =
  /얼마|얼마나|뭐|어떻게|어디|언제|왜|누가|몇|어떤|가장|\?/;
const GEMINI_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
  "gemini-3.8-flash",
];
const GEMINI_TIMEOUT_MS = 12000;

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

  return "AI 응답을 가져오지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.";
}

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}

function classifyIntent(message: string): ChatIntent {
  const hasAmount = AMOUNT_PATTERN.test(message);
  const hasQuestion = QUESTION_PATTERN.test(message);

  if (hasQuestion) {
    return "query";
  }

  if (hasAmount) {
    return "save";
  }

  return "save";
}

function formatIso(year: number, month: number, day: number) {
  return [
    year,
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

function shiftIso(isoDate: string, offsetDays: number) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + offsetDays));

  return formatIso(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
}

function startOfWeekMonday(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay();
  const offset = weekday === 0 ? -6 : 1 - weekday;

  return shiftIso(isoDate, offset);
}

function dateContext() {
  const today = seoulDate();
  const thisWeekStart = startOfWeekMonday(today);
  const lastWeekStart = shiftIso(thisWeekStart, -7);
  const lastWeekEnd = shiftIso(thisWeekStart, -1);
  const thisMonthStart = `${today.slice(0, 7)}-01`;

  return {
    today,
    yesterday: seoulDate(-1),
    thisMonthStart,
    thisWeekStart,
    thisWeekEnd: today,
    lastWeekStart,
    lastWeekEnd,
  };
}

function seoulDate(offsetDays = 0) {
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Seoul",
  });
  const [year, month, day] = today.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + offsetDays));

  return [
    shifted.getUTCFullYear(),
    String(shifted.getUTCMonth() + 1).padStart(2, "0"),
    String(shifted.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function formatConfirmation(expense: ParsedExpense) {
  const [, month, day] = expense.date.split("-");

  return `${Number(month)}월 ${Number(day)}일 ${expense.description} ${expense.amount.toLocaleString("ko-KR")}원을 저장했어요!`;
}

function extractJson(text: string): GeminiExpense | null {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  try {
    return JSON.parse(candidate.slice(start, end + 1)) as GeminiExpense;
  } catch {
    return null;
  }
}

function buildPrompt(
  message: string,
  history: Array<{ role: ChatRole; content: string }>,
) {
  const today = seoulDate();
  const yesterday = seoulDate(-1);
  const recentHistory = history
    .slice(-8)
    .map((item) => `${item.role === "user" ? "사용자" : "AI"}: ${item.content}`)
    .join("\n");

  return `당신은 한국어 가계부 도우미입니다. 사용자 메시지에서 지출 정보만 추출하세요.

오늘 날짜(Asia/Seoul): ${today}
어제 날짜: ${yesterday}

규칙:
1. JSON만 반환하세요. 형식은 {"date":"YYYY-MM-DD"|null,"amount":정수|null,"description":"내용"|null}
2. 날짜가 없으면 오늘 날짜를 사용하세요. "어제"는 ${yesterday}를 사용하세요.
3. "2만원", "15,000원"처럼 적힌 금액은 정수 원으로 변환하세요. 예: 2만원 → 20000
4. 금액이 불명확하면 amount는 null로 두세요.
5. 날짜를 전혀 추정할 수 없으면 date는 null로 두세요.
6. 지출이 아니면 date, amount, description을 모두 null로 두세요.
7. description은 짧은 명사로 정리하세요. 예: "택시 탔는데" → "택시"

최근 대화:
${recentHistory || "(없음)"}

사용자 메시지:
${message}`;
}

function buildQueryPrompt(
  message: string,
  history: Array<{ role: ChatRole; content: string }>,
  expenses: ExpenseRow[],
) {
  const dates = dateContext();
  const recentHistory = history
    .slice(-8)
    .map((item) => `${item.role === "user" ? "사용자" : "AI"}: ${item.content}`)
    .join("\n");

  return `당신은 친절한 한국어 가계부 챗봇입니다. 아래 지출 데이터만 보고 사용자 질문에 답하세요.

오늘 날짜(Asia/Seoul): ${dates.today}
어제: ${dates.yesterday}
이번 달: ${dates.thisMonthStart} ~ ${dates.today}
이번 주(월~오늘): ${dates.thisWeekStart} ~ ${dates.thisWeekEnd}
지난주(월~일): ${dates.lastWeekStart} ~ ${dates.lastWeekEnd}

규칙:
1. 제공된 지출 데이터만 사용하세요. 없는 항목을 지어내지 마세요.
2. 금액은 원 단위로 계산하고, 답변에는 천 단위 쉼표를 사용하세요. 예: 20,000원
3. 식비는 점심, 저녁, 커피, 음료, 빵, 버거, 식당처럼 먹는 항목으로 묶어 추정하세요.
4. 데이터가 없으면 아직 기록이 없다고 말해 주세요.
5. 한두 문장으로 자연스럽고 친근하게 답하세요.
6. 합계가 필요하면 아래 계산된 요약 숫자를 그대로 사용하세요. 다시 더하지 마세요.
7. JSON만 반환하세요. 형식: {"reply":"답변"}

최근 대화:
${recentHistory || "(없음)"}

계산된 요약(JSON):
${JSON.stringify(expenseSummary(expenses))}

지출 데이터(JSON):
${JSON.stringify(expenses)}

사용자 질문:
${message}`;
}

async function fetchExpenses() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("expenses")
    .select("date, amount, description")
    .order("date", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []) as ExpenseRow[];
}

function sumAmount(expenses: ExpenseRow[]) {
  return expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0);
}

function inRange(expense: ExpenseRow, start: string, end: string) {
  return expense.date >= start && expense.date <= end;
}

function expenseSummary(expenses: ExpenseRow[]) {
  const dates = dateContext();
  const thisMonth = expenses.filter((item) =>
    inRange(item, dates.thisMonthStart, dates.today),
  );
  const yesterday = expenses.filter((item) => item.date === dates.yesterday);
  const lastWeek = expenses.filter((item) =>
    inRange(item, dates.lastWeekStart, dates.lastWeekEnd),
  );
  const thisWeek = expenses.filter((item) =>
    inRange(item, dates.thisWeekStart, dates.thisWeekEnd),
  );

  const totalsByDescription = new Map<string, number>();
  for (const item of expenses) {
    const key = item.description || "지출";
    totalsByDescription.set(key, (totalsByDescription.get(key) ?? 0) + Number(item.amount || 0));
  }

  const topItem = [...totalsByDescription.entries()].sort((a, b) => b[1] - a[1])[0];

  return {
    count: expenses.length,
    allTotal: sumAmount(expenses),
    thisMonthTotal: sumAmount(thisMonth),
    yesterdayTotal: sumAmount(yesterday),
    yesterdayItems: yesterday,
    thisWeekTotal: sumAmount(thisWeek),
    lastWeekTotal: sumAmount(lastWeek),
    topItem: topItem
      ? { description: topItem[0], amount: topItem[1] }
      : null,
  };
}

function toExpense(parsed: GeminiExpense): {
  expense: ParsedExpense | null;
  missing: "date" | "amount" | null;
} {
  const amount = Number(parsed.amount);
  const description = parsed.description?.trim() ?? "";
  const rawDate = parsed.date?.trim() || seoulDate();

  if (!Number.isFinite(amount) || amount <= 0) {
    return { expense: null, missing: "amount" };
  }

  if (!DATE_PATTERN.test(rawDate)) {
    return { expense: null, missing: "date" };
  }

  return {
    expense: {
      date: rawDate,
      amount: Math.round(amount),
      description: description || "지출",
    },
    missing: null,
  };
}

function askAgain(missing: "date" | "amount" | null) {
  if (missing === "date") {
    return "날짜를 파악하지 못했어요. 언제 지출하신 건가요? 예: 어제, 오늘";
  }

  if (missing === "amount") {
    return "금액을 파악하지 못했어요. 얼마를 쓰셨는지 알려주시겠어요? 예: 15,000원";
  }

  return "지출 내용을 다시 말씀해 주세요. 예: 오늘 점심 15,000원";
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    date: {
      type: "string",
      description: "YYYY-MM-DD. 모르면 빈 값",
      nullable: true,
    },
    amount: {
      type: "integer",
      description: "원 단위 정수. 모르면 null",
      nullable: true,
    },
    description: {
      type: "string",
      description: "짧은 지출 내용. 없으면 빈 값",
      nullable: true,
    },
  },
  required: ["date", "amount", "description"],
};

const QUERY_SCHEMA = {
  type: "object",
  properties: {
    reply: {
      type: "string",
      description: "사용자에게 보여줄 친근한 한국어 답변",
    },
  },
  required: ["reply"],
};

function extractGeminiText(payload: {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
}) {
  const parts = payload.candidates?.[0]?.content?.parts ?? [];
  return parts.map((part) => part.text ?? "").join("").trim();
}

async function generateGeminiJson(
  apiKey: string,
  prompt: string,
  schema: Record<string, unknown>,
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
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.1,
              responseMimeType: "application/json",
              responseSchema: schema,
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

      const text = extractGeminiText(JSON.parse(rawText) as Parameters<typeof extractGeminiText>[0]);

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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChatRequest;
    const message = body.message?.trim();

    if (!message) {
      return NextResponse.json(
        { error: "메시지를 입력해 주세요." },
        { status: 400 },
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY가 설정되지 않았습니다." },
        { status: 500 },
      );
    }

    const history = (body.history ?? [])
      .filter(
        (item): item is { role: ChatRole; content: string } =>
          (item.role === "user" || item.role === "assistant") &&
          Boolean(item.content?.trim()),
      )
      .map((item) => ({
        role: item.role,
        content: item.content.trim(),
      }));

    if (classifyIntent(message) === "query") {
      let expenses: ExpenseRow[] = [];

      try {
        expenses = await fetchExpenses();
      } catch (error) {
        console.error("Supabase select error:", error);
        return NextResponse.json(
          { error: "지출 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." },
          { status: 500 },
        );
      }

      const rawText = await generateGeminiJson(
        apiKey,
        buildQueryPrompt(message, history, expenses),
        QUERY_SCHEMA,
      );
      const parsed = extractJson(rawText) as { reply?: string } | null;
      const reply = parsed?.reply?.trim();

      return NextResponse.json({
        reply:
          reply ||
          "질문을 이해하지 못했어요. 예: 이번달 총 지출이 얼마야?",
        saved: false,
        expense: null,
        intent: "query",
      });
    }

    const rawText = await generateGeminiJson(
      apiKey,
      buildPrompt(message, history),
      RESPONSE_SCHEMA,
    );
    const parsed = extractJson(rawText);

    if (!parsed) {
      return NextResponse.json({
        reply: askAgain(null),
        saved: false,
        expense: null,
      });
    }

    const hasAnyField =
      Boolean(parsed.date?.trim()) ||
      Boolean(parsed.description?.trim()) ||
      Number(parsed.amount) > 0;

    if (!hasAnyField) {
      return NextResponse.json({
        reply:
          "지출을 기록하려면 날짜, 금액, 내용을 말씀해 주세요. 예: 어제 택시 2만원",
        saved: false,
        expense: null,
      });
    }

    const { expense, missing } = toExpense(parsed);

    if (!expense) {
      return NextResponse.json({
        reply: askAgain(missing),
        saved: false,
        expense: null,
      });
    }

    const supabase = getSupabase();
    const { error } = await supabase.from("expenses").insert(expense);

    if (error) {
      console.error("Supabase insert error:", error);
      const unreachable = /fetch failed|ENOTFOUND|ECONNREFUSED/i.test(
        `${error.message} ${error.details ?? ""}`,
      );

      return NextResponse.json(
        {
          error: unreachable
            ? "Supabase에 연결하지 못했습니다. .env.local의 프로젝트 URL을 확인해 주세요."
            : "지출 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      reply: formatConfirmation(expense),
      saved: true,
      expense,
      intent: "save",
    });
  } catch (error) {
    console.error("Gemini chat error:", error);

    return NextResponse.json(
      { error: userFacingGeminiError(error) },
      { status: 500 },
    );
  }
}

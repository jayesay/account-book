"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ExpenseBudget } from "./ExpenseBudget";
import { ExpenseCharts } from "./ExpenseCharts";
import { CATEGORIES, expenseCategory, type Category } from "../lib/categories";
import { supabase } from "../lib/supabase";

type Expense = {
  id: number;
  created_at: string;
  date: string;
  amount: number;
  description: string;
  category?: string | null;
};

type CategoryFilter = "전체" | Category;

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  imageUrl?: string;
};

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: { transcript: string };
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionErrorLike = {
  error: string;
};

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;

  const speechWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };

  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: "welcome",
    role: "assistant",
    content:
      "안녕하세요! 지출을 기록하거나 통계를 물어보세요.\n예: 오늘 점심 12,000원 썼어\n예: 이번달 총 지출이 얼마야?\n영수증 사진도 올릴 수 있어요. 카테고리는 자동으로 나눠 드려요.",
  },
];

export default function Home() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loadingExpenses, setLoadingExpenses] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [statusText, setStatusText] = useState("입력 중...");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("전체");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalTranscriptRef = useRef("");
  const sendMessageRef = useRef<(text: string) => Promise<void>>(async () => {});
  const listeningRef = useRef(false);

  async function fetchExpenses() {
    const { data, error } = await supabase
      .from("expenses")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error) {
      setExpenses(data ?? []);
    }
  }

  async function backfillCategories() {
    try {
      await fetch("/api/categorize", { method: "POST" });
      await fetchExpenses();
    } catch {
      // 컬럼이 아직 없으면 키워드 분류로 화면만 채웁니다.
    }
  }

  useEffect(() => {
    async function load() {
      setLoadingExpenses(true);
      await fetchExpenses();
      setLoadingExpenses(false);
      await backfillCategories();
    }

    void load();
  }, []);

  const [monthKey, setMonthKey] = useState("");

  useEffect(() => {
    setMonthKey(
      new Date().toLocaleDateString("en-CA", {
        timeZone: "Asia/Seoul",
      }).slice(0, 7),
    );
  }, []);

  const monthTotal = useMemo(() => {
    if (!monthKey) return 0;

    return expenses
      .filter((item) => item.date.startsWith(monthKey))
      .reduce((sum, item) => sum + item.amount, 0);
  }, [expenses, monthKey]);

  const filteredExpenses = useMemo(() => {
    if (categoryFilter === "전체") return expenses;

    return expenses.filter((item) => expenseCategory(item) === categoryFilter);
  }, [expenses, categoryFilter]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    if (recognitionRef.current && listeningRef.current) {
      listeningRef.current = false;
      setListening(false);
      recognitionRef.current.stop();
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setSending(true);
    setStatusText("입력 중...");
    setSpeechError(null);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          history: [...messages, userMessage]
            .slice(-8)
            .map(({ role, content }) => ({ role, content })),
        }),
      });

      const data = (await response.json()) as {
        reply?: string;
        error?: string;
        saved?: boolean;
      };

      if (!response.ok || !data.reply) {
        throw new Error(data.error || "응답에 실패했습니다.");
      }

      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: data.reply!,
        },
      ]);

      if (data.saved) {
        await fetchExpenses();
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "오류가 발생했습니다.";
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `죄송해요. ${message}`,
        },
      ]);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  sendMessageRef.current = sendMessage;

  useEffect(() => {
    const SpeechRecognition = getSpeechRecognitionCtor();
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.lang = "ko-KR";
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onresult = (event) => {
      let finalText = finalTranscriptRef.current;
      let interimText = "";

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result[0].transcript.trim();

        if (result.isFinal) {
          finalText = [finalText, transcript].filter(Boolean).join(" ");
        } else {
          interimText = transcript;
        }
      }

      finalTranscriptRef.current = finalText;
      setInput([finalText, interimText].filter(Boolean).join(" "));
    };

    recognition.onerror = (event) => {
      if (event.error === "aborted" || event.error === "no-speech") {
        return;
      }

      setSpeechError(
        event.error === "not-allowed"
          ? "마이크 권한을 허용해 주세요."
          : "음성 인식에 실패했습니다. 다시 시도해 주세요.",
      );
    };

    recognition.onend = () => {
      const shouldSend = listeningRef.current;
      listeningRef.current = false;
      setListening(false);

      const spoken = finalTranscriptRef.current.trim();
      if (shouldSend && spoken) {
        void sendMessageRef.current(spoken);
      }
    };

    recognitionRef.current = recognition;
    setSpeechSupported(true);

    return () => {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.abort();
      recognitionRef.current = null;
    };
  }, []);

  function toggleListening() {
    const recognition = recognitionRef.current;
    if (!recognition || sending) return;

    if (listeningRef.current) {
      recognition.stop();
      return;
    }

    setSpeechError(null);
    finalTranscriptRef.current = input.trim();
    listeningRef.current = true;
    setListening(true);

    try {
      recognition.start();
    } catch {
      listeningRef.current = false;
      setListening(false);
      setSpeechError("음성 인식을 시작할 수 없습니다.");
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await sendMessage(input);
  }

  async function uploadReceipt(file: File) {
    if (sending) return;

    if (file.size > 8 * 1024 * 1024) {
      setSpeechError("이미지 크기는 8MB 이하여야 합니다.");
      return;
    }

    const imageUrl = URL.createObjectURL(file);
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: "영수증 사진을 올렸어요",
      imageUrl,
    };

    setMessages((prev) => [...prev, userMessage]);
    setSending(true);
    setStatusText("영수증을 읽고 있어요...");
    setSpeechError(null);

    try {
      const body = new FormData();
      body.append("image", file);

      const response = await fetch("/api/receipt", {
        method: "POST",
        body,
      });

      const data = (await response.json()) as {
        reply?: string;
        error?: string;
        saved?: boolean;
      };

      if (!response.ok || !data.reply) {
        throw new Error(data.error || "영수증 인식에 실패했습니다.");
      }

      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: data.reply!,
        },
      ]);

      if (data.saved) {
        await fetchExpenses();
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "오류가 발생했습니다.";
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `죄송해요. ${message}`,
        },
      ]);
    } finally {
      setSending(false);
      setStatusText("입력 중...");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  function handleReceiptChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) {
      void uploadReceipt(file);
    }
  }

  return (
    <div className="flex h-dvh flex-col bg-[#fafafa]">
      <header className="shrink-0 border-b border-black/5 bg-white/80 px-4 py-4 backdrop-blur-sm sm:px-6">
        <div className="mx-auto w-full max-w-2xl">
          <h1 className="text-xl font-semibold tracking-[-0.03em] text-[#111] sm:text-2xl">
            AI 가계부 챗봇
          </h1>
          <p className="mt-1 text-sm text-[#6b6b6b]">
            말하거나 입력하고, 영수증 사진도 올려 보세요
          </p>
        </div>
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col">
        <section className="min-h-0 shrink-0 overflow-y-auto overscroll-contain px-4 pt-4 sm:max-h-[48vh] sm:px-6">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-medium text-[#6b6b6b]">저장된 지출</h2>
            {!loadingExpenses && filteredExpenses.length > 0 && (
              <p className="font-mono text-sm tabular-nums text-[#111]">
                {filteredExpenses
                  .reduce((sum, item) => sum + item.amount, 0)
                  .toLocaleString("ko-KR")}
                원
              </p>
            )}
          </div>

          {!loadingExpenses && <ExpenseBudget monthTotal={monthTotal} />}

          {!loadingExpenses && expenses.length > 0 && (
            <>
              <ExpenseCharts expenses={expenses} />
              <div className="mb-3 flex flex-wrap gap-1.5">
                {(["전체", ...CATEGORIES] as const).map((category) => {
                  const selected = categoryFilter === category;

                  return (
                    <button
                      key={category}
                      type="button"
                      onClick={() => setCategoryFilter(category)}
                      className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
                        selected
                          ? "bg-[#111] text-white"
                          : "bg-[#f2f2f2] text-[#6b6b6b] hover:bg-[#e8e8e8]"
                      }`}
                    >
                      {category}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <div className="max-h-28 overflow-y-auto overscroll-contain sm:max-h-36">
            {loadingExpenses ? (
              <p className="py-4 text-sm text-[#b0b0b0]">불러오는 중...</p>
            ) : expenses.length === 0 ? (
              <p className="rounded-2xl bg-[#f2f2f2] px-4 py-4 text-sm text-[#6b6b6b]">
                아직 저장된 지출이 없습니다
              </p>
            ) : filteredExpenses.length === 0 ? (
              <p className="rounded-2xl bg-[#f2f2f2] px-4 py-4 text-sm text-[#6b6b6b]">
                이 카테고리의 지출이 없습니다
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {filteredExpenses.map((item) => (
                  <li
                    key={item.id}
                    className="rounded-2xl bg-[#f2f2f2] px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[15px] font-medium text-[#111]">
                          {item.description}
                        </p>
                        <p className="mt-0.5 text-xs text-[#6b6b6b]">
                          {item.date}
                          <span className="ml-1.5 rounded-full bg-white px-1.5 py-0.5 text-[10px] text-[#6b6b6b]">
                            {expenseCategory(item)}
                          </span>
                        </p>
                      </div>
                      <p className="shrink-0 font-mono text-base font-medium tabular-nums text-[#111]">
                        {item.amount.toLocaleString("ko-KR")}
                        <span className="ml-0.5 font-sans text-xs font-normal text-[#6b6b6b]">
                          원
                        </span>
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="mt-4 flex min-h-0 flex-1 flex-col border-t border-black/5 bg-[#f7f7f7]">
          <div className="flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${
                  message.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-[15px] leading-relaxed sm:max-w-[75%] ${
                    message.role === "user"
                      ? "rounded-br-md bg-[#FEE500] text-[#191919]"
                      : "rounded-bl-md bg-white text-[#111] shadow-[0_1px_0_rgba(0,0,0,0.04)]"
                  }`}
                >
                  {message.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={message.imageUrl}
                      alt="올린 영수증"
                      className="mb-2 max-h-40 w-full rounded-xl object-cover"
                    />
                  )}
                  {message.content}
                </div>
              </div>
            ))}

            {sending && (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-bl-md bg-white px-4 py-3 text-[15px] text-[#6b6b6b]">
                  {statusText}
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          <form
            onSubmit={handleSubmit}
            className="shrink-0 border-t border-black/5 bg-white px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4"
          >
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                className="hidden"
                onChange={handleReceiptChange}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={sending}
                aria-label="영수증 사진 올리기"
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#f2f2f2] text-[#111] transition-colors hover:bg-[#e8e8e8] disabled:cursor-not-allowed disabled:opacity-35 sm:h-11 sm:w-11"
              >
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  className="h-5 w-5"
                  fill="currentColor"
                >
                  <path d="M19 5v14H5V5h14Zm0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2Zm-4.86 8.86-3 3.87L9 13.14 6 17h12l-3.86-5.14Z" />
                </svg>
              </button>
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={listening ? "듣고 있어요..." : "지출 기록 또는 질문"}
                disabled={sending}
                className="h-12 min-w-0 flex-1 rounded-full bg-[#f2f2f2] px-4 text-base text-[#111] outline-none placeholder:text-[#b0b0b0] focus:ring-2 focus:ring-[#111]/10 disabled:opacity-60 sm:h-11 sm:text-[15px]"
              />
              {speechSupported && (
                <button
                  type="button"
                  onClick={toggleListening}
                  disabled={sending}
                  aria-label={listening ? "음성 인식 중지" : "음성으로 입력"}
                  aria-pressed={listening}
                  className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition-colors sm:h-11 sm:w-11 ${
                    listening
                      ? "bg-[#e11d48] text-white"
                      : "bg-[#f2f2f2] text-[#111] hover:bg-[#e8e8e8]"
                  } disabled:cursor-not-allowed disabled:opacity-35`}
                >
                  <svg
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    className="h-5 w-5"
                    fill="currentColor"
                  >
                    <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V20H9v2h6v-2h-2v-2.08A7 7 0 0 0 19 11h-2Z" />
                  </svg>
                </button>
              )}
              <button
                type="submit"
                disabled={sending || !input.trim()}
                className="h-12 shrink-0 rounded-full bg-[#111] px-5 text-[15px] font-medium text-white transition-colors hover:bg-[#2a2a2a] disabled:cursor-not-allowed disabled:opacity-35 sm:h-11"
              >
                전송
              </button>
            </div>
            {speechError && (
              <p className="mt-2 px-2 text-sm text-[#e11d48]">{speechError}</p>
            )}
          </form>
        </section>
      </div>
    </div>
  );
}

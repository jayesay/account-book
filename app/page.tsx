"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

type Expense = {
  id: number;
  created_at: string;
  date: string;
  amount: number;
  description: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: "welcome",
    role: "assistant",
    content:
      "안녕하세요! 지출을 기록하거나 통계를 물어보세요.\n예: 오늘 점심 12,000원 썼어\n예: 이번달 총 지출이 얼마야?",
  },
];

export default function Home() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loadingExpenses, setLoadingExpenses] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function fetchExpenses() {
    const { data, error } = await supabase
      .from("expenses")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error) {
      setExpenses(data ?? []);
    }
  }

  useEffect(() => {
    async function load() {
      setLoadingExpenses(true);
      await fetchExpenses();
      setLoadingExpenses(false);
    }

    void load();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const text = input.trim();
    if (!text || sending) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setSending(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
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

  return (
    <div className="flex h-dvh flex-col bg-[#fafafa]">
      <header className="shrink-0 border-b border-black/5 bg-white/80 px-4 py-4 backdrop-blur-sm sm:px-6">
        <div className="mx-auto w-full max-w-2xl">
          <h1 className="text-xl font-semibold tracking-[-0.03em] text-[#111] sm:text-2xl">
            AI 가계부 챗봇
          </h1>
          <p className="mt-1 text-sm text-[#6b6b6b]">
            대화로 지출을 기록해 보세요
          </p>
        </div>
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col">
        <section className="shrink-0 px-4 pt-4 sm:px-6">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-medium text-[#6b6b6b]">저장된 지출</h2>
            {!loadingExpenses && expenses.length > 0 && (
              <p className="font-mono text-sm tabular-nums text-[#111]">
                {expenses
                  .reduce((sum, item) => sum + item.amount, 0)
                  .toLocaleString("ko-KR")}
                원
              </p>
            )}
          </div>

          <div className="max-h-40 overflow-y-auto overscroll-contain sm:max-h-48">
            {loadingExpenses ? (
              <p className="py-4 text-sm text-[#b0b0b0]">불러오는 중...</p>
            ) : expenses.length === 0 ? (
              <p className="rounded-2xl bg-[#f2f2f2] px-4 py-4 text-sm text-[#6b6b6b]">
                아직 저장된 지출이 없습니다
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {expenses.map((item) => (
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
                  {message.content}
                </div>
              </div>
            ))}

            {sending && (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-bl-md bg-white px-4 py-3 text-[15px] text-[#6b6b6b]">
                  입력 중...
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
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="지출 기록 또는 질문"
                disabled={sending}
                className="h-12 min-w-0 flex-1 rounded-full bg-[#f2f2f2] px-4 text-base text-[#111] outline-none placeholder:text-[#b0b0b0] focus:ring-2 focus:ring-[#111]/10 disabled:opacity-60 sm:h-11 sm:text-[15px]"
              />
              <button
                type="submit"
                disabled={sending || !input.trim()}
                className="h-12 shrink-0 rounded-full bg-[#111] px-5 text-[15px] font-medium text-white transition-colors hover:bg-[#2a2a2a] disabled:cursor-not-allowed disabled:opacity-35 sm:h-11"
              >
                전송
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}

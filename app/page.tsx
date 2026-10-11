"use client";

import { FormEvent, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type Expense = {
  id: number;
  created_at: string;
  date: string;
  amount: number;
  description: string;
};

export default function Home() {
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchExpenses() {
    setError(null);

    const { data, error: fetchError } = await supabase
      .from("expenses")
      .select("*")
      .order("created_at", { ascending: false });

    if (fetchError) {
      setError(fetchError.message);
      return;
    }

    setExpenses(data ?? []);
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      await fetchExpenses();
      setLoading(false);
    }

    void load();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsedAmount = Number(amount.replace(/,/g, ""));
    if (!date || !description.trim() || Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      return;
    }

    setSaving(true);
    setError(null);

    const { error: insertError } = await supabase.from("expenses").insert({
      date,
      amount: parsedAmount,
      description: description.trim(),
    });

    if (insertError) {
      setError(insertError.message);
      setSaving(false);
      return;
    }

    setDate("");
    setAmount("");
    setDescription("");
    await fetchExpenses();
    setSaving(false);
  }

  const total = expenses.reduce((sum, item) => sum + item.amount, 0);

  const inputClassName =
    "h-14 w-full min-w-0 rounded-xl bg-white px-4 text-lg text-[#111] outline-none transition placeholder:text-[#b0b0b0] focus:bg-white focus:ring-2 focus:ring-[#111]/10 sm:h-12 sm:text-base";

  return (
    <div className="min-h-full bg-[#fafafa]">
      <main className="mx-auto flex w-full max-w-xl flex-col px-5 py-14 sm:px-8 sm:py-20">
        <header className="mb-12 sm:mb-16">
          <h1 className="text-[2rem] font-semibold tracking-[-0.03em] text-[#111] sm:text-[2.25rem]">
            나의 스마트 가계부
          </h1>
          <p className="mt-3 text-base leading-relaxed text-[#6b6b6b] sm:text-[15px]">
            오늘 쓴 돈을 기록해 보세요
          </p>
        </header>

        <form onSubmit={handleSubmit} className="mb-14 rounded-2xl bg-[#f2f2f2] p-6 sm:mb-16 sm:p-8">
          <div className="flex flex-col gap-8 sm:gap-6">
            <label className="flex flex-col gap-2.5">
              <span className="text-[15px] font-medium text-[#6b6b6b] sm:text-sm">
                날짜
              </span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                className={inputClassName}
              />
            </label>

            <label className="flex flex-col gap-2.5">
              <span className="text-[15px] font-medium text-[#6b6b6b] sm:text-sm">
                금액
              </span>
              <div className="relative w-full">
                <input
                  type="number"
                  inputMode="numeric"
                  min="1"
                  step="1"
                  placeholder="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                  className={`${inputClassName} pr-12 font-mono tabular-nums`}
                />
                <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[15px] text-[#b0b0b0]">
                  원
                </span>
              </div>
            </label>

            <label className="flex flex-col gap-2.5">
              <span className="text-[15px] font-medium text-[#6b6b6b] sm:text-sm">
                내용
              </span>
              <input
                type="text"
                placeholder="예: 점심 식사, 교통비"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
                className={inputClassName}
              />
            </label>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="mt-10 h-14 w-full rounded-xl bg-[#111] text-lg font-medium text-white transition-colors hover:bg-[#2a2a2a] disabled:cursor-not-allowed disabled:opacity-40 sm:mt-8 sm:h-12 sm:text-[15px]"
          >
            {saving ? "저장 중..." : "저장하기"}
          </button>
        </form>

        {error && (
          <p className="mb-10 text-[15px] leading-relaxed text-[#111] sm:mb-12">
            {error}
          </p>
        )}

        <section className="flex w-full flex-col">
          <div className="mb-6 flex items-end justify-between gap-4 sm:mb-8">
            <h2 className="text-lg font-semibold tracking-[-0.02em] text-[#111] sm:text-base">
              지출 내역
            </h2>
            {!loading && expenses.length > 0 && (
              <p className="font-mono text-xl font-medium tabular-nums tracking-tight text-[#111] sm:text-lg">
                {total.toLocaleString("ko-KR")}
                <span className="ml-0.5 text-base font-sans font-normal text-[#6b6b6b] sm:text-sm">
                  원
                </span>
              </p>
            )}
          </div>

          {loading ? (
            <p className="py-16 text-[15px] text-[#b0b0b0]">불러오는 중...</p>
          ) : expenses.length === 0 ? (
            <p className="py-16 text-[15px] text-[#b0b0b0]">
              아직 저장된 지출이 없습니다
            </p>
          ) : (
            <ul className="flex w-full flex-col gap-3">
              {expenses.map((item) => (
                <li
                  key={item.id}
                  className="w-full rounded-2xl bg-[#f2f2f2] px-5 py-5 sm:px-6 sm:py-5"
                >
                  <div className="flex items-center justify-between gap-5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-lg font-medium tracking-[-0.01em] text-[#111] sm:text-[15px]">
                        {item.description}
                      </p>
                      <p className="mt-1.5 text-[15px] text-[#6b6b6b] sm:text-sm">
                        {item.date}
                      </p>
                    </div>
                    <p className="shrink-0 font-mono text-2xl font-medium tabular-nums tracking-tight text-[#111] sm:text-xl">
                      {item.amount.toLocaleString("ko-KR")}
                      <span className="ml-0.5 text-base font-sans font-normal text-[#6b6b6b] sm:text-sm">
                        원
                      </span>
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

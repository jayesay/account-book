"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "account-book-monthly-budget";

function currentMonthKey() {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Seoul",
  }).slice(0, 7);
}

function readBudget(monthKey: string) {
  if (typeof window === "undefined") return 0;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    return Number(parsed[monthKey]) || 0;
  } catch {
    return 0;
  }
}

function writeBudget(monthKey: string, amount: number) {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  const parsed = raw ? (JSON.parse(raw) as Record<string, number>) : {};
  parsed[monthKey] = amount;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
}

export function ExpenseBudget({ monthTotal }: { monthTotal: number }) {
  const [monthKey, setMonthKey] = useState("");
  const [budget, setBudget] = useState(0);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const key = currentMonthKey();
    const saved = readBudget(key);
    setMonthKey(key);
    setBudget(saved);
    setDraft(saved ? String(saved) : "");
    setEditing(saved === 0);
  }, []);

  const ratio = budget > 0 ? monthTotal / budget : 0;
  const percent = Math.round(ratio * 100);
  const warning = budget > 0 && ratio >= 0.8;
  const over = budget > 0 && ratio >= 1;

  const barColor = useMemo(() => {
    if (over) return "bg-[#e11d48]";
    if (warning) return "bg-[#f59e0b]";
    return "bg-[#111]";
  }, [over, warning]);

  function handleSave(event: FormEvent) {
    event.preventDefault();
    const amount = Number(draft.replace(/,/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) return;

    writeBudget(monthKey, Math.round(amount));
    setBudget(Math.round(amount));
    setEditing(false);
  }

  return (
    <div className="mb-3 rounded-2xl bg-[#f2f2f2] px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-[#6b6b6b]">이번 달 예산</p>
        {!editing && budget > 0 && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs text-[#6b6b6b] underline-offset-2 hover:underline"
          >
            수정
          </button>
        )}
      </div>

      {editing ? (
        <form onSubmit={handleSave} className="flex items-center gap-2">
          <input
            type="number"
            min="1"
            inputMode="numeric"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="예: 500000"
            className="h-9 min-w-0 flex-1 rounded-xl bg-white px-3 text-sm text-[#111] outline-none focus:ring-2 focus:ring-[#111]/10"
          />
          <button
            type="submit"
            className="h-9 shrink-0 rounded-xl bg-[#111] px-3 text-sm font-medium text-white"
          >
            설정
          </button>
        </form>
      ) : (
        <>
          <div className="mb-2 h-2 overflow-hidden rounded-full bg-white">
            <div
              className={`h-full rounded-full transition-[width] ${barColor}`}
              style={{ width: `${Math.min(percent, 100)}%` }}
            />
          </div>
          <p className="font-mono text-xs tabular-nums text-[#111]">
            {monthTotal.toLocaleString("ko-KR")} / {budget.toLocaleString("ko-KR")}원
            <span className="ml-1 font-sans text-[#6b6b6b]">({percent}%)</span>
          </p>
        </>
      )}

      {warning && (
        <p className={`mt-2 text-xs ${over ? "text-[#e11d48]" : "text-[#b45309]"}`}>
          {over
            ? "이번 달 예산을 초과했어요. 지출을 조금 줄여보는 게 좋겠어요."
            : "이번 달 예산을 80% 이상 썼어요. 남은 금액을 확인해 보세요."}
        </p>
      )}
    </div>
  );
}

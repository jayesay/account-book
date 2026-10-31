"use client";

import { expenseCategory } from "../lib/categories";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Expense = {
  date: string;
  amount: number;
  description: string;
  category?: string | null;
};

const CATEGORY_COLORS = ["#111111", "#FEE500", "#6b6b6b", "#c4c4c4", "#f59e0b"];

function lastSixMonths() {
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Seoul",
  });
  const [year, month] = today.split("-").map(Number);
  const months: string[] = [];

  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(year, month - 1 - offset, 1));
    months.push(
      `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`,
    );
  }

  return months;
}

function formatWon(value: number) {
  return `${value.toLocaleString("ko-KR")}원`;
}

export function ExpenseCharts({ expenses }: { expenses: Expense[] }) {
  const [mounted, setMounted] = useState(false);
  const [months, setMonths] = useState<string[]>([]);

  useEffect(() => {
    setMounted(true);
    setMonths(lastSixMonths());
  }, []);

  const monthlyData = useMemo(() => {
    const totals = new Map<string, number>();

    for (const item of expenses) {
      const key = item.date.slice(0, 7);
      totals.set(key, (totals.get(key) ?? 0) + item.amount);
    }

    return months.map((key) => {
      const [, month] = key.split("-");

      return {
        month: `${Number(month)}월`,
        total: totals.get(key) ?? 0,
      };
    });
  }, [expenses, months]);

  const categoryData = useMemo(() => {
    const totals = new Map<string, number>();

    for (const item of expenses) {
      const category = expenseCategory(item);
      totals.set(category, (totals.get(category) ?? 0) + item.amount);
    }

    return [...totals.entries()]
      .map(([name, value]) => ({ name, value }))
      .filter((item) => item.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [expenses]);

  if (!mounted) {
    return (
      <div className="mb-3 grid h-32 grid-cols-2 gap-2">
        <div className="rounded-2xl bg-[#f2f2f2]" />
        <div className="rounded-2xl bg-[#f2f2f2]" />
      </div>
    );
  }

  return (
    <div className="mb-3 grid grid-cols-2 gap-2">
      <div className="rounded-2xl bg-[#f2f2f2] px-2 pb-2 pt-3">
        <p className="mb-1 px-2 text-xs font-medium text-[#6b6b6b]">월별 지출</p>
        <div className="h-28">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthlyData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid stroke="#e5e5e5" vertical={false} />
              <XAxis
                dataKey="month"
                tick={{ fill: "#6b6b6b", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "#6b6b6b", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(value: number) =>
                  value >= 10000 ? `${Math.round(value / 10000)}만` : `${value}`
                }
              />
              <Tooltip
                cursor={{ fill: "rgba(0,0,0,0.04)" }}
                formatter={(value) => [formatWon(Number(value ?? 0)), "합계"]}
              />
              <Bar dataKey="total" fill="#111111" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-2xl bg-[#f2f2f2] px-2 pb-2 pt-3">
        <p className="mb-1 px-2 text-xs font-medium text-[#6b6b6b]">카테고리</p>
        <div className="h-28">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={categoryData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={24}
                outerRadius={40}
                paddingAngle={2}
              >
                {categoryData.map((entry, index) => (
                  <Cell
                    key={entry.name}
                    fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]}
                  />
                ))}
              </Pie>
              <Tooltip formatter={(value) => formatWon(Number(value ?? 0))} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex flex-wrap gap-x-2 gap-y-1 px-2">
          {categoryData.map((item, index) => (
            <span key={item.name} className="flex items-center gap-1 text-[10px] text-[#6b6b6b]">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: CATEGORY_COLORS[index % CATEGORY_COLORS.length] }}
              />
              {item.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

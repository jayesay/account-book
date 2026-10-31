import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { normalizeCategory, type Category } from "./categories";

export type ExpenseInsert = {
  date: string;
  amount: number;
  description: string;
  category: Category;
};

export function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}

export async function insertExpense(
  supabase: SupabaseClient,
  expense: ExpenseInsert,
) {
  const withCategory = await supabase.from("expenses").insert(expense);

  if (
    withCategory.error &&
    /category/i.test(`${withCategory.error.message} ${withCategory.error.details ?? ""}`)
  ) {
    const { category: _category, ...rest } = expense;
    return supabase.from("expenses").insert(rest);
  }

  return withCategory;
}

export function withCategory(
  date: string,
  amount: number,
  description: string,
  category?: string | null,
): ExpenseInsert {
  return {
    date,
    amount,
    description,
    category: normalizeCategory(category),
  };
}

export const CATEGORIES = ["식비", "교통", "쇼핑", "문화", "기타"] as const;

export type Category = (typeof CATEGORIES)[number];

export function normalizeCategory(value?: string | null): Category {
  if (value && (CATEGORIES as readonly string[]).includes(value)) {
    return value as Category;
  }

  return "기타";
}

export function inferCategory(description: string): Category {
  const text = description.toLowerCase();

  if (
    /점심|저녁|아침|커피|카페|버거|빵|티|밀크|휘낭시에|아메리카노|식당|치킨|피자|분식|맥플|음식/.test(
      text,
    )
  ) {
    return "식비";
  }

  if (/택시|버스|지하철|교통|주유/.test(text)) {
    return "교통";
  }

  if (/장보기|마트|쇼핑|볼펜|문구/.test(text)) {
    return "쇼핑";
  }

  if (/영화|공연|게임|문화|전시|책/.test(text)) {
    return "문화";
  }

  return "기타";
}

export function expenseCategory(expense: {
  category?: string | null;
  description: string;
}): Category {
  return expense.category
    ? normalizeCategory(expense.category)
    : inferCategory(expense.description);
}

import { describe, expect, it } from "vitest";
import {
  actualExpenseAverages,
  buildFinanceAlerts,
  buildFinanceForecast,
  buildIntegratedFinance,
  cardInvoiceMonthForEntry,
  cardInvoiceMonthForDate,
  cardLimitSummary,
  createCardFinanceInstallments,
  createFinanceInstallments,
  financeEntryWithInvoiceMonth,
  nextFinanceDate,
} from "./financeIntegration.js";

const today = "2026-10-18";

describe("cardInvoiceMonthForDate", () => {
  it("assigns purchases on or before closing to the correct due month", () => {
    const card = { closingDay: 25, dueDay: 5 };
    expect(cardInvoiceMonthForDate(card, "2026-10-25")).toBe("2026-11");
    expect(cardInvoiceMonthForDate(card, "2026-10-26")).toBe("2026-12");
  });

  it("handles due dates later than the closing day and short months", () => {
    const card = { closingDay: 31, dueDay: 15 };
    expect(cardInvoiceMonthForDate(card, "2026-02-28")).toBe("2026-03");
    expect(cardInvoiceMonthForDate(card, "2026-03-01")).toBe("2026-04");
  });

  it("uses the due month for closing-day boundaries and short months", () => {
    const card = { closingDay: 23, dueDay: 30 };
    expect([
      "2026-10-23", "2026-10-24", "2026-11-07", "2026-11-23", "2026-11-24",
    ].map((date) => cardInvoiceMonthForDate(card, date))).toEqual([
      "2026-10", "2026-11", "2026-11", "2026-11", "2026-12",
    ]);

    expect(cardInvoiceMonthForDate({ closingDay: 31, dueDay: 30 }, "2026-10-31")).toBe("2026-11");
    expect(cardInvoiceMonthForDate({ closingDay: 31, dueDay: 30 }, "2026-11-01")).toBe("2026-12");
    expect(cardInvoiceMonthForDate({ closingDay: 30, dueDay: 30 }, "2026-10-30")).toBe("2026-11");
    expect(cardInvoiceMonthForDate({ closingDay: 30, dueDay: 30 }, "2026-10-31")).toBe("2026-12");
  });

  it("recalculates the month when an edited transaction date changes", () => {
    const card = { closingDay: 23, dueDay: 30 };
    const savedEntry = financeEntryWithInvoiceMonth({
      date: "2026-11-07",
      invoiceMonth: "2027-01",
    }, card);

    expect(savedEntry.invoiceMonth).toBe("2026-11");
    expect(financeEntryWithInvoiceMonth({ date: "2026-11-07" }, card, "2027-01").invoiceMonth).toBe("2027-01");
  });

  it("generates consecutive invoice months for installments from the purchase cycle", () => {
    const card = { closingDay: 23, dueDay: 30 };
    const installments = createCardFinanceInstallments({
      id: "purchase-1200",
      date: "2026-11-07",
      amount: 1200,
      type: "saida",
      paymentMethod: "Crédito",
      status: "pago",
      cardId: "card-1",
      invoiceMonth: "2027-01",
    }, 4, card);

    expect(installments.map((entry) => entry.invoiceMonth)).toEqual([
      "2026-11", "2026-12", "2027-01", "2027-02",
    ]);
    expect(installments.map((entry) => entry.amount)).toEqual([300, 300, 300, 300]);
  });

  it("keeps installments consecutive when a short month clamps their dates", () => {
    const card = { closingDay: 30, dueDay: 30 };
    const installments = createCardFinanceInstallments({
      id: "purchase-short-month",
      date: "2027-01-30",
      amount: 900,
      type: "saida",
      paymentMethod: "Crédito",
      status: "pago",
      cardId: "card-1",
    }, 3, card);

    expect(installments.map((entry) => entry.date)).toEqual([
      "2027-01-30", "2027-02-28", "2027-03-30",
    ]);
    expect(installments.map((entry) => cardInvoiceMonthForEntry(card, entry, installments))).toEqual([
      "2027-02", "2027-03", "2027-04",
    ]);
  });
});

describe("cardLimitSummary", () => {
  it("counts all open invoice months and releases the limit when a bill is paid", () => {
    const card = { id: "card-1", limit: 5000, closingDay: 10, dueDay: 17, invoiceAmounts: {}, payments: [] };
    const purchase = (id, date, amount) => ({
      id, cardId: card.id, type: "saida", paymentMethod: "Crédito", status: "pago",
      date, amount, invoiceMonth: cardInvoiceMonthForDate(card, date),
    });
    const purchaseA = purchase("purchase-a", "2026-11-05", 300);
    const purchaseB = createFinanceInstallments({
      id: "purchase-b", date: "2026-11-08", amount: 1200, type: "saida",
      paymentMethod: "Crédito", status: "pago", cardId: card.id,
    }, 12).map((entry) => ({
      ...entry,
      invoiceMonth: cardInvoiceMonthForDate(card, entry.date),
    }));
    let finance = [purchaseA, ...purchaseB];
    const invoiceTotal = (month, entries) => (Number(card.invoiceAmounts[month]) || 0) + entries
      .filter((entry) => entry.cardId === card.id && entry.type === "saida"
        && entry.paymentMethod === "Crédito" && entry.status !== "cancelado"
        && (entry.invoiceMonth || cardInvoiceMonthForDate(card, entry.date)) === month)
      .reduce((total, entry) => total + Number(entry.amount || 0), 0);

    expect(invoiceTotal("2026-11", finance)).toBe(400);
    expect(cardLimitSummary(card, finance)).toEqual({
      limit: 5000, used: 1500, available: 3500, usedPercent: 30, overLimit: false,
    });

    const purchaseC = purchase("purchase-c", "2026-11-12", 500);
    finance = [...finance, purchaseC];
    expect(invoiceTotal("2026-11", finance)).toBe(400);
    expect(invoiceTotal("2026-12", finance)).toBe(600);
    expect(cardLimitSummary(card, finance)).toMatchObject({ used: 2000, available: 3000 });

    const paidCard = {
      ...card,
      payments: [{ id: "payment-1", invoiceMonth: "2026-11", date: "2026-11-17", amount: 400 }],
    };
    const paidSummary = cardLimitSummary(paidCard, finance);
    expect(paidSummary).toMatchObject({ used: 1600, available: 3400 });

    const canceledAndOtherCard = [
      ...finance,
      { ...purchase("canceled", "2026-11-05", 900), status: "cancelado" },
      { ...purchase("other-card", "2026-11-05", 900), cardId: "card-2" },
    ];
    expect(cardLimitSummary(paidCard, canceledAndOtherCard)).toEqual(paidSummary);
  });

  it("counts installment cents accurately and flags spending above the limit", () => {
    const card = { id: "card-1", limit: 5000, closingDay: 10, dueDay: 17, payments: [] };
    const installments = createFinanceInstallments({
      id: "purchase-cents", date: "2026-11-08", amount: 1000, type: "saida",
      paymentMethod: "Crédito", status: "pago", cardId: card.id,
    }, 3).map((entry) => ({
      ...entry,
      invoiceMonth: cardInvoiceMonthForDate(card, entry.date),
    }));
    expect(installments.map((entry) => entry.amount)).toEqual([333.33, 333.33, 333.34]);
    expect(cardLimitSummary(card, installments)).toMatchObject({ used: 1000, available: 4000 });

    const overLimitSummary = cardLimitSummary(card, [{
      cardId: card.id, type: "saida", paymentMethod: "Crédito", amount: 6000,
      date: "2026-11-05", status: "pago",
    }]);
    expect(overLimitSummary).toMatchObject({ used: 6000, available: -1000, overLimit: true });
  });

  it("includes the informed invoice balance and avoids percentages without a limit", () => {
    const card = { id: "card-1", limit: "", closingDay: 10, dueDay: 17, invoiceAmounts: { "2026-11": 250 } };
    expect(cardLimitSummary(card, [])).toEqual({
      limit: 0, used: 250, available: -250, usedPercent: 0, overLimit: true,
    });
  });
});

describe("buildIntegratedFinance", () => {
  it("supports itemized deductions while preserving legacy total deductions", () => {
    const itemized = buildFinanceForecast([], {
      grossSalary: 5000,
      extraIncome: 500,
      deductions: [{ id: "inss", amount: 450 }, { id: "health", amount: 150 }],
      allocations: [],
    }, "2026-10", 2);
    const legacy = buildFinanceForecast([], {
      grossSalary: 5000,
      extraIncome: 500,
      deductions: 600,
      allocations: [],
    }, "2026-10", 2);

    expect(itemized[1].expectedIncome).toBe(4900);
    expect(legacy[1].expectedIncome).toBe(4900);
  });

  it("converts a confirmed Wishlist purchase exactly once without changing manual transactions", () => {
    const purchase = { id: "buy-1", date: "2026-10-17", amount: 120, category: "Casa" };
    const manual = [{ id: "manual-1", date: "2026-10-01", type: "entrada", amount: 3000, status: "pago" }];
    const input = {
      finance: manual,
      shopping: [{ id: "wish-1", name: "Cadeira", category: "Casa", purchaseHistory: [purchase] }],
      today,
    };
    const first = buildIntegratedFinance(input);
    const refreshed = buildIntegratedFinance({ ...input, finance: first });
    expect(first).toHaveLength(2);
    expect(refreshed).toHaveLength(2);
    expect(refreshed[1]).toMatchObject({
      sourceRef: { type: "shopping", sourceId: "wish-1", eventId: "buy-1" },
      amount: 120, status: "pago", category: "Casa",
    });

  });

  it("keeps a unique purchased item's expense after it is archived", () => {
    const result = buildIntegratedFinance({
      today,
      shopping: [{
        id: "wish-unique",
        name: "Livro",
        kind: "desejo",
        purchaseClass: "unico",
        status: "comprado",
        archived: true,
        purchaseFrequency: "mensal",
        nextPurchaseDate: "2026-11-01",
        price: 80,
        purchaseHistory: [{ id: "unique-purchase", date: "2026-10-17", amount: 80 }],
      }],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      date: "2026-10-17",
      amount: 80,
      sourceRef: { type: "shopping", sourceId: "wish-unique", eventId: "unique-purchase" },
    });
  });

  it("does not create a financial amount for a Wishlist purchase without a price", () => {
    const result = buildIntegratedFinance({
      today,
      shopping: [{
        id: "wish-no-price", name: "Presente", kind: "desejo", status: "comprado", price: 0,
        purchaseHistory: [{ id: "gift-purchase", date: "2026-10-17", amount: null }],
      }],
    });

    expect(result).toEqual([]);
  });

  it("updates recurring Wishlist forecasts when the next purchase date changes", () => {
    const make = (nextPurchaseDate) => buildIntegratedFinance({
      today,
      shopping: [{
        id: "product-1", name: "Protetor", kind: "rotina", price: 75,
        purchaseFrequency: "trimestral", nextPurchaseDate,
      }],
    }).filter((entry) => entry.sourceKind === "previsao");
    expect(make("2026-11-01").map((entry) => entry.date)).toEqual(["2026-11-01", "2027-02-01", "2027-05-01", "2027-08-01"]);
    expect(make("2026-12-01")[0].date).toBe("2026-12-01");
  });

  it("continues recurring Wishlist forecasts after purchase and stops them when canceled", () => {
    const purchased = {
      id: "wish-1", name: "Filtro", price: 40, status: "comprado", purchaseFrequency: "mensal",
      nextPurchaseDate: "2026-11-17",
      purchaseHistory: [{ id: "purchase-1", date: "2026-10-17", amount: 40 }],
    };
    const recurring = buildIntegratedFinance({ today, shopping: [purchased] });
    expect(recurring.filter((entry) => entry.sourceKind === "previsao").map((entry) => entry.date).slice(0, 3))
      .toEqual(["2026-11-17", "2026-12-17", "2027-01-17"]);

    const canceled = buildIntegratedFinance({
      today,
      shopping: [{ ...purchased, id: "wish-2", status: "cancelada" }],
    });
    expect(canceled).toHaveLength(1);
    expect(canceled[0].status).toBe("pago");
  });

  it("imports procedure sessions and hobby spending history as real expenses", () => {
    const result = buildIntegratedFinance({
      today,
      beauty: [{ id: "proc-1", name: "Laser", cost: 250, history: [{ id: "session-1", date: "2026-10-10", cost: 240 }] }],
      hobbies: [{ id: "hobby-1", name: "Cerâmica", expenseHistory: [{ id: "expense-1", date: "2026-10-11", amount: 90 }] }],
    });
    expect(result).toHaveLength(2);
    expect(result.map((entry) => entry.status)).toEqual(["pago", "pago"]);
    expect(result.map((entry) => entry.expenseClass)).toEqual(["procedure", "hobby"]);
  });

  it("integrates separate scheduled receipts without counting a registered installment twice", () => {
    const plan = {
      netSalary: 1500,
      receipts: [
        { id: "salary-part-1", date: "2026-10-05", amount: 1000, frequency: "mensal" },
        { id: "salary-part-2", date: "2026-10-20", amount: 500, frequency: "mensal" },
      ],
      allocations: [],
    };
    const transactions = [{
      id: "income:salary-part-1:2026-10", type: "entrada", date: "2026-10-05",
      amount: 1000, status: "pago",
      sourceRef: { type: "receiptSchedule", sourceId: "salary-part-1", eventId: "2026-10" },
    }];

    const forecast = buildFinanceForecast(transactions, plan, "2026-10", 2);

    expect(forecast.map((entry) => entry.expectedIncome)).toEqual([1500, 1500]);
  });

  it("creates distinct forecasts for multiple hobby expenses and keeps actual expenses separate", () => {
    const result = buildIntegratedFinance({
      today,
      hobbies: [{
        id: "cheerleading", name: "Cheerleading",
        expenses: [
          { id: "monthly-fee", description: "Mensalidade", amount: 60, date: "2026-10-20", frequency: "mensal" },
          { id: "uniform", description: "Uniforme", amount: 150, date: "2026-11-02", frequency: "pontual" },
        ],
        expenseHistory: [{ id: "paid-entry", date: "2026-10-10", amount: 25, description: "Material" }],
      }],
    }).filter((entry) => entry.date.slice(0, 7) <= "2026-11");

    expect(result.map((entry) => [entry.desc, entry.date, entry.amount, entry.sourceKind])).toEqual([
      ["Material", "2026-10-10", 25, "registro"],
      ["Cheerleading · Mensalidade (previsto)", "2026-10-20", 60, "previsao"],
      ["Cheerleading · Mensalidade (previsto)", "2026-11-20", 60, "previsao"],
      ["Cheerleading · Uniforme (previsto)", "2026-11-02", 150, "previsao"],
    ]);
  });

  it("preserves distinct legacy history entries that do not have IDs", () => {
    const result = buildIntegratedFinance({
      today,
      beauty: [{
        id: "proc-legacy", name: "Consulta",
        history: [
          { date: "2026-10-10", cost: 120 },
          { date: "2026-10-10", cost: 180 },
        ],
      }],
    });
    expect(result.map((entry) => entry.amount)).toEqual([120, 180]);
    expect(new Set(result.map((entry) => entry.sourceRef.eventId)).size).toBe(2);
  });

  it("recalculates procedure schedules from the latest performed session", () => {
    const result = buildIntegratedFinance({
      today,
      beauty: [{
        id: "proc-1", name: "Manutenção", cost: 200, recurring: true,
        frequencyUnit: "meses", frequencyValue: 3,
        history: [{ id: "session-1", date: "2026-09-01", cost: 200 }],
      }],
    });
    expect(result.filter((entry) => entry.sourceKind === "previsao").map((entry) => entry.date))
      .toEqual(["2026-12-01", "2027-03-01", "2027-06-01", "2027-09-01"]);
  });
});

describe("finance forecast and controls", () => {
  it("separates monthly installments from original purchase totals", () => {
    const installments = createFinanceInstallments({
      id: "purchase-1", date: "2026-10-18", amount: 1000, type: "saida", status: "agendado",
    }, 3);
    expect(installments.map((entry) => entry.amount)).toEqual([333.33, 333.33, 333.34]);
    expect(installments.reduce((sum, entry) => sum + entry.amount, 0)).toBe(1000);
    expect(installments.map((entry) => entry.installmentGroup.totalAmount)).toEqual([1000, 1000, 1000]);
    expect(installments.map((entry) => entry.date)).toEqual(["2026-10-18", "2026-11-18", "2026-12-18"]);
  });

  it("does not mark a pending installment as paid just because its date is today", () => {
    const installments = createFinanceInstallments({
      id: "pending-purchase", date: "2026-10-18", amount: 300, type: "saida", status: "pendente",
    }, 3);
    expect(installments.map((entry) => entry.status)).toEqual(["agendado", "agendado", "agendado"]);
  });

  it("uses explicit salary assumptions and flags category limits and over-budget risk", () => {
    const transactions = [
      { date: "2026-10-05", type: "entrada", amount: 1000, status: "pago" },
      { date: "2026-10-10", type: "saida", amount: 850, category: "Lazer", status: "pago" },
      { date: "2026-10-25", type: "saida", amount: 300, category: "Moradia", status: "agendado" },
    ];
    const plan = {
      netSalary: 2000,
      allocations: [{ id: "fun", category: "Lazer", mode: "fixed", amount: 1000 }],
    };
    const forecast = buildFinanceForecast(transactions, plan, "2026-10", 3);
    const alerts = buildFinanceAlerts(transactions, plan, "2026-10", today);
    expect(forecast[1].expectedIncome).toBe(2000);
    expect(alerts.some((alert) => alert.message.includes("80%"))).toBe(true);
    expect(alerts.some((alert) => alert.id === "budget-risk")).toBe(true);
    expect(buildFinanceForecast(transactions, { netSalary: 0 }, "2026-10", 2)[1].expectedIncome).toBe(0);
  });

  it("alerts at 80%, 90% and 100% and recommends postponing optional estimates under budget pressure", () => {
    const transactions = [
      { date: "2026-10-05", type: "entrada", amount: 1000, status: "pago" },
      { date: "2026-10-10", type: "saida", amount: 640, category: "Casa", status: "pago" },
      { date: "2026-10-10", type: "saida", amount: 900, category: "Lazer", status: "pago" },
      { date: "2026-10-10", type: "saida", amount: 100, category: "Cursos", status: "pago" },
      { date: "2026-10-20", type: "saida", amount: 50, category: "Lazer", status: "projetado", sourceKind: "previsao", sourcePriority: "baixa" },
    ];
    const plan = {
      netSalary: 1000,
      allocations: [
        { id: "home", category: "Casa", mode: "fixed", amount: 800 },
        { id: "fun", category: "Lazer", mode: "fixed", amount: 1000 },
        { id: "courses", category: "Cursos", mode: "fixed", amount: 100 },
      ],
    };
    const alerts = buildFinanceAlerts(transactions, plan, "2026-10", today);
    expect(alerts.some((alert) => alert.id === "limit:home:80")).toBe(true);
    expect(alerts.some((alert) => alert.id === "limit:fun:90")).toBe(true);
    expect(alerts.some((alert) => alert.id === "limit:courses:100")).toBe(true);
    expect(alerts.some((alert) => alert.id === "postpone-optional-purchases")).toBe(true);
  });

  it("moves postponed forecasts and marks averages insufficient when real months are missing", () => {
    expect(nextFinanceDate("2026-10-18", "mensal")).toBe("2026-11-18");
    expect(nextFinanceDate("2026-10-18", "pontual")).toBe("");
    const averages = actualExpenseAverages([
      { date: "2026-10-10", type: "saida", amount: 250, status: "pago" },
      { date: "2026-10-11", type: "saida", amount: 900, status: "projetado" },
    ], today);
    expect(averages.monthly).toMatchObject({ value: 250, sufficient: true, months: 1 });
    expect(averages.quarterly).toMatchObject({ value: 250, sufficient: false, months: 1 });
    expect(averages.yearly.sufficient).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  actualExpenseAverages,
  buildFinanceAlerts,
  buildFinanceForecast,
  buildIntegratedFinance,
  createFinanceInstallments,
  nextFinanceDate,
} from "./financeIntegration.js";

const today = "2026-10-18";

describe("buildIntegratedFinance", () => {
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

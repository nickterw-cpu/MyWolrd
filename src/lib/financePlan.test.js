import { describe, expect, it } from "vitest";
import { allocationValue, summarizeFinanceMonth } from "./financePlan.js";

describe("allocationValue", () => {
  it("calculates fixed and percentage allocations", () => {
    expect(allocationValue({ mode: "percent", amount: 10 }, 3000)).toBe(300);
    expect(allocationValue({ mode: "fixed", amount: 250 }, 3000)).toBe(250);
  });
});

describe("summarizeFinanceMonth", () => {
  it("separates received, spent, pending commitments, protected reserves and future income", () => {
    const summary = summarizeFinanceMonth([
      { date: "2026-10-01", type: "entrada", amount: 3000, status: "pago" },
      { date: "2026-10-02", type: "entrada", amount: 400, status: "agendado" },
      { date: "2026-10-03", type: "saida", amount: 1200, status: "pago", expenseClass: "fixed" },
      { date: "2026-10-10", type: "saida", amount: 200, status: "agendado", expenseClass: "fixed" },
      { date: "2026-10-11", type: "saida", amount: 100, status: "pago", category: "Hobbies" },
      { date: "2026-10-12", type: "saida", amount: 90, status: "cancelado" },
      { date: "2026-11-01", type: "saida", amount: 300, status: "agendado" },
    ], {
      allocations: [
        { id: "reserve", category: "Reserva", mode: "percent", amount: 10, protected: true },
        { id: "hobbies", category: "Hobbies", mode: "fixed", amount: 150, protected: false },
      ],
    }, "2026-10");

    expect(summary).toMatchObject({
      receivedIncome: 3000,
      spent: 1300,
      commitments: 200,
      fixedSpent: 1200,
      fixedCommitments: 200,
      variableSpent: 100,
      reserved: 300,
      allocationTotal: 450,
      unallocated: 2550,
      available: 1200,
      projectedSpending: 1500,
    });
    expect(summary.byCategory[1]).toMatchObject({ category: "Hobbies", limit: 150, spent: 100, committed: 0, remaining: 50 });
  });

  it("does not create available cash from income that has not been received", () => {
    const summary = summarizeFinanceMonth([
      { date: "2026-10-20", type: "entrada", amount: 2500, status: "agendado" },
    ], { allocations: [] }, "2026-10");

    expect(summary.receivedIncome).toBe(0);
    expect(summary.available).toBe(0);
  });

  it("counts a paid commitment as spent instead of keeping it committed", () => {
    const paid = summarizeFinanceMonth([
      { date: "2026-10-05", type: "entrada", amount: 1000, status: "pago" },
      { date: "2026-10-10", type: "saida", amount: 200, plannedAmount: 180, status: "pago", expenseClass: "fixed", category: "Moradia" },
    ], { allocations: [] }, "2026-10");
    const pending = summarizeFinanceMonth([
      { date: "2026-10-05", type: "entrada", amount: 1000, status: "pago" },
      { date: "2026-10-10", type: "saida", amount: 200, plannedAmount: 180, status: "pendente", expenseClass: "fixed", category: "Moradia" },
    ], { allocations: [{ id: "housing", category: "Moradia", mode: "fixed", amount: 100 }] }, "2026-10");

    expect(paid).toMatchObject({ spent: 200, commitments: 0, available: 800 });
    expect(pending).toMatchObject({ spent: 0, commitments: 200, available: 800 });
    expect(pending.byCategory[0]).toMatchObject({ spent: 0, committed: 200, remaining: -100 });
  });

  it("keeps reserve and investment transfers out of consumption without deducting a protected goal twice", () => {
    const summary = summarizeFinanceMonth([
      { date: "2026-10-05", type: "entrada", amount: 3000, status: "pago" },
      { date: "2026-10-10", type: "saida", amount: 100, status: "pago", expenseClass: "variable", category: "Lazer" },
      { date: "2026-10-12", type: "saida", amount: 250, status: "pago", expenseClass: "investment", category: "Reserva" },
      { date: "2026-10-20", type: "saida", amount: 500, status: "pendente", expenseClass: "fixed", category: "Moradia" },
    ], {
      allocations: [{ id: "reserve", category: "Reserva", mode: "fixed", amount: 300, protected: true }],
    }, "2026-10");

    expect(summary).toMatchObject({
      spent: 100,
      commitments: 500,
      transferPaid: 250,
      reserved: 300,
      reservedRemaining: 50,
      available: 2100,
      projectedSpending: 600,
    });
  });
});

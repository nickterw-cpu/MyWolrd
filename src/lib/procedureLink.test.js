import { describe, expect, it } from "vitest";
import { financeEntriesForCard, isProcedureExpense, planInstallments, procedureTotal, syncCardFromFinance, syncFinanceFromCard } from "./procedureLink.js";

const today = "2026-11-24";
let n = 0;
const newId = () => `card${++n}`;

describe("procedureLink", () => {
  it("só reconhece Beleza + Procedimento", () => {
    expect(isProcedureExpense({ type: "saida", category: "Beleza", expenseClass: "procedure" })).toBe(true);
    expect(isProcedureExpense({ type: "saida", category: "beleza ", expenseClass: "procedure" })).toBe(true);
    expect(isProcedureExpense({ type: "saida", category: "Beleza", expenseClass: "variable" })).toBe(false);
    expect(isProcedureExpense({ type: "saida", category: "Saúde", expenseClass: "procedure" })).toBe(false);
  });

  it("cria um card só uma vez e atualiza valor e data", () => {
    const entry = { id: "f1", type: "saida", category: "Beleza", expenseClass: "procedure", amount: 300, date: "2026-11-20", desc: "Botox" };
    const once = syncCardFromFinance([], [entry], { today, newId });
    expect(once).toHaveLength(1);
    expect(once[0]).toMatchObject({ name: "Botox", cost: 300, dateDone: "2026-11-20", financeLink: { key: "f1" } });
    const twice = syncCardFromFinance(once, [{ ...entry, amount: 350, date: "2026-11-21" }], { today, newId });
    expect(twice).toHaveLength(1);
    expect(twice[0]).toMatchObject({ cost: 350, dateDone: "2026-11-21" });
  });

  it("usa o valor total das parcelas", () => {
    const group = (i) => ({ id: `g:${i}`, type: "saida", category: "Beleza", expenseClass: "procedure", amount: 100, date: "2026-11-01", desc: "Laser",
      installmentGroup: { id: "g", index: i, total: 3, totalAmount: 300, purchaseDate: "2026-11-01" } });
    const cards = syncCardFromFinance([], [group(1), group(2), group(3)], { today, newId });
    expect(cards[0]).toMatchObject({ cost: 300, financeLink: { key: "g", installments: 3, installmentAmount: 100 } });
  });

  it("leva valor e data do card ao lançamento", () => {
    const finance = [{ id: "f1", amount: 300, date: "2026-11-20" }, { id: "f2", amount: 10, date: "2026-11-20" }];
    const out = syncFinanceFromCard(finance, { cost: 320, dateDone: "2026-11-18", financeLink: { key: "f1" } });
    expect(out[0]).toMatchObject({ amount: 320, date: "2026-11-18" });
    expect(out[1]).toBe(finance[1]);
  });

  it("redistribui o valor entre parcelas", () => {
    const finance = [1, 2, 3].map((i) => ({ id: `g:${i}`, amount: 100, date: `2026-${String(10 + i).padStart(2, "0")}-05`,
      installmentGroup: { id: "g", index: i, total: 3, totalAmount: 300, purchaseDate: "2026-11-05" } }));
    const out = syncFinanceFromCard(finance, { cost: 400, dateDone: "2026-11-05", financeLink: { key: "g" } });
    expect(out.map((e) => e.amount)).toEqual([133.33, 133.33, 133.34]);
  });

  it("planeja parcelas já pagas nos meses anteriores", () => {
    const plan = planInstallments({ total: 500, count: 5, paidCount: 2, purchaseDate: "2026-11-10", firstInvoiceMonth: "2026-09" });
    expect(plan.map((p) => p.invoiceMonth)).toEqual(["2026-09", "2026-10", "2026-11", "2026-12", "2027-01"]);
    expect(plan.map((p) => p.date)).toEqual(["2026-09-10", "2026-10-10", "2026-11-10", "2026-12-10", "2027-01-10"]);
    expect(plan.map((p) => p.paid)).toEqual([true, true, false, false, false]);
    expect(plan.reduce((s, p) => s + p.amount, 0)).toBeCloseTo(500);
  });
});

describe("procedimento criado na aba", () => {
  it("valor total calculado ou manual", () => {
    expect(procedureTotal({ cost: 200, plannedSessions: 3 })).toBe(600);
    expect(procedureTotal({ cost: 200, plannedSessions: 3, totalCost: 500, totalCostManual: true })).toBe(500);
    expect(procedureTotal({ cost: 150 })).toBe(150);
  });

  it("gera um lançamento com o total ou um por sessão", () => {
    let k = 0;
    const newId = () => `e${++k}`;
    const card = { id: "b1", name: "Jato de plasma", cost: 200, plannedSessions: 3, scheduledDate: "2026-12-01",
      gcalSessions: [{ start: "2026-12-15T10:00" }] };
    const one = financeEntriesForCard(card, { mode: "total", today, newId });
    expect(one.entries).toHaveLength(1);
    expect(one.entries[0]).toMatchObject({ amount: 600, category: "Beleza", expenseClass: "procedure", date: "2026-12-01", status: "agendado" });
    const many = financeEntriesForCard(card, { mode: "sessions", today, newId });
    expect(many.entries.map((e) => [e.date, e.amount])).toEqual([["2026-12-01", 200], ["2026-12-15", 200], ["2027-01-14", 200]]);
    expect(many.link).toMatchObject({ key: "sessions:b1", origin: "beauty", mode: "sessions", installments: 3 });
  });
});

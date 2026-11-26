import { describe, expect, it } from "vitest";
import { investmentGoalFor, monthInvestments, setDefaultInvestmentGoal, setMonthInvestmentGoal } from "./investmentGoals.js";
import { monthGroups } from "./monthGroups.js";

const card = { id: "c1", name: "Nubank", closingDay: 3, dueDay: 10 };
const salary = { id: "s", type: "entrada", status: "pago", amount: 5000, date: "2026-11-05" };
const pix = { id: "p1", type: "saida", status: "pago", paymentMethod: "Pix", amount: 150, date: "2026-11-10" };

describe("meta de investimento mensal", () => {
  it("padrão vale a partir do mês em que foi definido; mês específico vale só para ele", () => {
    let goals = setDefaultInvestmentGoal({}, 500, "2026-11");
    goals = setMonthInvestmentGoal(goals, "2026-12", 800);
    expect(investmentGoalFor(goals, "2026-10")).toEqual({ amount: null, source: "none" });
    expect(investmentGoalFor(goals, "2026-11")).toEqual({ amount: 500, source: "default" });
    expect(investmentGoalFor(goals, "2026-12")).toEqual({ amount: 800, source: "month" });
    expect(investmentGoalFor(goals, "2027-01")).toEqual({ amount: 500, source: "default" });
  });
  it("mudar o padrão depois não muda os meses anteriores", () => {
    let goals = setDefaultInvestmentGoal({}, 500, "2026-11");
    goals = setDefaultInvestmentGoal(goals, 700, "2027-02");
    expect(investmentGoalFor(goals, "2026-12").amount).toBe(500);
    expect(investmentGoalFor(goals, "2027-02").amount).toBe(700);
    goals = setDefaultInvestmentGoal(goals, 650, "2027-02");
    expect(goals.defaults).toHaveLength(2);
    expect(investmentGoalFor(goals, "2027-03").amount).toBe(650);
  });
  it("limpar a meta de um mês volta ao padrão", () => {
    let goals = setMonthInvestmentGoal(setDefaultInvestmentGoal({}, 500, "2026-11"), "2026-12", 800);
    goals = setMonthInvestmentGoal(goals, "2026-12", null);
    expect(investmentGoalFor(goals, "2026-12")).toEqual({ amount: 500, source: "default" });
  });
});

describe("investimentos do mês", () => {
  const goals = setDefaultInvestmentGoal({}, 500, "2026-11");
  const aporte = { id: "a1", name: "Tesouro Selic", amount: 200, date: "2026-11-12", institution: "Nubank", status: "ativo" };

  it("sem aportes: falta a meta inteira", () => {
    expect(monthInvestments([], [], goals, "2026-11")).toMatchObject({ goal: 500, invested: 0, remaining: 500, exceeded: 0, committed: 500 });
  });
  it("aporte de 200: investido 200, falta 300, comprometido 500", () => {
    const m = monthInvestments([aporte], [], goals, "2026-11");
    expect(m).toMatchObject({ invested: 200, remaining: 300, committed: 500 });
    expect(m.items).toHaveLength(1);
  });
  it("passar da meta: falta 0 e mostra o excedente", () => {
    expect(monthInvestments([{ ...aporte, amount: 650 }], [], goals, "2026-11")).toMatchObject({ invested: 650, remaining: 0, exceeded: 150, committed: 650 });
  });
  it("sem meta: comprometido é só o investido", () => {
    expect(monthInvestments([aporte], [], {}, "2026-11")).toMatchObject({ goal: null, invested: 200, remaining: 0, committed: 200 });
  });
  it("lançamento de investimento em Finanças conta como aporte", () => {
    const transfer = { id: "t1", type: "saida", status: "pago", expenseClass: "investment", amount: 100, date: "2026-11-20", desc: "Corretora" };
    expect(monthInvestments([aporte], [transfer], goals, "2026-11")).toMatchObject({ invested: 300, remaining: 200 });
  });
  it("o mesmo aporte em Finanças e em Investimentos conta uma vez só (vínculo ou mesma data e valor)", () => {
    const same = { id: "t2", type: "saida", status: "pago", expenseClass: "investment", amount: 200, date: "2026-11-12" };
    expect(monthInvestments([aporte], [same], goals, "2026-11").invested).toBe(200);
    const linked = { ...same, id: "t3", date: "2026-11-11" };
    expect(monthInvestments([{ ...aporte, financeEntryId: "t3" }], [linked], goals, "2026-11").invested).toBe(200);
  });
  it("ignora outros meses, transferências não pagas e canceladas", () => {
    const list = [
      { id: "x1", type: "saida", status: "agendado", expenseClass: "investment", amount: 90, date: "2026-11-25" },
      { id: "x2", type: "saida", status: "cancelado", expenseClass: "investment", amount: 90, date: "2026-11-25" },
    ];
    expect(monthInvestments([{ ...aporte, date: "2026-10-30" }], list, goals, "2026-11").invested).toBe(0);
  });
});

describe("investimentos nos grupos do mês", () => {
  const goals = setDefaultInvestmentGoal({}, 500, "2026-11");
  it("total comprometido soma a meta (investido + falta) e o disponível cai só o investido", () => {
    const aporte = { id: "a1", name: "CDB", amount: 200, date: "2026-11-12" };
    const inv = monthInvestments([aporte], [], goals, "2026-11");
    const g = monthGroups([salary, pix], [card], "2026-11", { receivedIncome: 5000, investments: inv });
    expect(g.investments.total).toBe(500);
    expect(g.total).toBe(650);
    expect(g.expensesTotal).toBe(150);
    expect(g.available).toBe(4650);
  });
  it("transferência para investimento em Finanças não é somada duas vezes", () => {
    const transfer = { id: "t1", type: "saida", status: "pago", expenseClass: "investment", amount: 200, date: "2026-11-12" };
    const inv = monthInvestments([{ id: "a1", amount: 200, date: "2026-11-12" }], [transfer], goals, "2026-11");
    const g = monthGroups([salary, transfer], [card], "2026-11", { receivedIncome: 5000, investments: inv });
    expect(g.total).toBe(500);
    expect(g.available).toBe(4800);
  });
  it("sem investimentos informados, nada muda", () => {
    const g = monthGroups([pix], [card], "2026-11", { receivedIncome: 5000 });
    expect(g.investments.total).toBe(0);
    expect(g.total).toBe(150);
    expect(g.available).toBe(4850);
  });
});

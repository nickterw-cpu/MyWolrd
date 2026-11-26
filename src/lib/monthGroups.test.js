import { describe, expect, it } from "vitest";
import { isCreditEntry, isPlannedEntry, monthGroups } from "./monthGroups.js";

const card = { id: "c1", name: "Nubank", closingDay: 3, dueDay: 10 };
const income = { receivedIncome: 5000 };
const pix = { id: "p1", type: "saida", status: "pago", paymentMethod: "Pix", amount: 150, date: "2026-11-10", category: "Mercado" };
const credit = { id: "k1", type: "saida", status: "pago", paymentMethod: "Crédito", cardId: "c1", amount: 500, date: "2026-11-12", category: "Casa" };

describe("monthGroups", () => {
  it("pix pago de 150 entra em gasto e reduz disponível; crédito de 500 não", () => {
    const nov = monthGroups([pix, credit], [card], "2026-11", income);
    expect(nov.spent.total).toBe(150);
    expect(nov.available).toBe(4850);
    expect(nov.credit.total).toBe(0);
    const dez = monthGroups([pix, credit], [card], "2026-12", income);
    expect(dez.credit.total).toBe(500);
    expect(dez.credit.count).toBe(1);
    expect(dez.spent.total).toBe(0);
  });

  it("agendado fora do cartão vai para scheduled", () => {
    const boleto = { id: "b1", type: "saida", status: "agendado", paymentMethod: "Boleto", amount: 80, date: "2026-11-25" };
    const nov = monthGroups([boleto], [card], "2026-11", income);
    expect(nov.scheduled.total).toBe(80);
    expect(nov.spent.total).toBe(0);
    expect(nov.planned.total).toBe(0);
  });

  it("previsto vai para planned no mês da data e soma no total", () => {
    const lash = { id: "l1", type: "saida", status: "previsto", paymentMethod: "Pix", amount: 140, date: "2026-12-05" };
    const all = [pix, credit, lash];
    expect(monthGroups(all, [card], "2026-11", income).planned.total).toBe(0);
    const dez = monthGroups(all, [card], "2026-12", income);
    expect(dez.planned.total).toBe(140);
    expect(dez.total).toBe(dez.spent.total + dez.scheduled.total + dez.credit.total + dez.planned.total);
    expect(dez.total).toBe(640);
  });

  it("previsto no crédito soma em toCard e não em credit", () => {
    const lash = { id: "l1", type: "saida", status: "previsto", paymentMethod: "Crédito", cardId: "c1", amount: 140, date: "2026-12-05" };
    const dez = monthGroups([lash], [card], "2026-12", income);
    expect(dez.credit.total).toBe(0);
    expect(dez.planned.total).toBe(140);
    expect(dez.toCard).toBe(140);
  });

  it("fatura paga vira uma linha em spent", () => {
    const paid = { ...card, invoices: { "2026-12": { month: "2026-12", status: "paga" } }, invoiceAmounts: { "2026-12": 50 } };
    const dez = monthGroups([credit], [paid], "2026-12", income);
    expect(dez.credit.total).toBe(0);
    expect(dez.spent.lines).toHaveLength(1);
    expect(dez.spent.lines[0].amount).toBe(550);
    expect(dez.spent.total).toBe(550);
  });

  it("fatura com pagamento parcial continua em credit", () => {
    const partial = { ...card, invoiceAmounts: { "2026-12": 50 }, payments: [{ id: "x", invoiceMonth: "2026-12", amount: 100, date: "2026-12-10" }] };
    const dez = monthGroups([credit], [partial], "2026-12", income);
    expect(dez.credit.total).toBe(550);
    expect(dez.spent.total).toBe(0);
  });

  it("estimativa integrada conta como previsto", () => {
    const est = { id: "source:shopping:w:forecast", type: "saida", sourceKind: "previsao", status: "projetado", amount: 90, date: "2026-11-20" };
    expect(monthGroups([est], [card], "2026-11", income).planned.total).toBe(90);
  });

  it("cada lista soma exatamente o seu total", () => {
    const a = { ...pix, id: "a", amount: 0.1 };
    const b = { ...pix, id: "b", amount: 0.2 };
    const nov = monthGroups([a, b], [card], "2026-11", income);
    expect(nov.spent.total).toBe(0.3);
    expect(nov.spent.count).toBe(2);
  });

  it("ignora cancelados, entradas e transferências para reserva", () => {
    const list = [{ ...pix, id: "c", status: "cancelado" }, { ...pix, id: "e", type: "entrada" }, { ...pix, id: "r", expenseClass: "reserve" }];
    expect(monthGroups(list, [card], "2026-11", income).total).toBe(0);
  });

  it("usa a renda prevista quando nada foi recebido", () => {
    const nov = monthGroups([pix], [card], "2026-11", { receivedIncome: 0, expectedIncome: 3000 });
    expect(nov).toMatchObject({ base: 3000, baseSource: "expected", available: 2850 });
  });

  it("classifica previsto e crédito", () => {
    expect(isPlannedEntry({ status: "previsto" })).toBe(true);
    expect(isPlannedEntry({ sourceKind: "previsao" })).toBe(true);
    expect(isPlannedEntry({ status: "agendado" })).toBe(false);
    expect(isCreditEntry({ cardId: "c1" })).toBe(true);
    expect(isCreditEntry({ cardId: "c1", paymentMethod: "Pix" })).toBe(false);
    expect(isCreditEntry({ paymentMethod: "Crédito" })).toBe(false);
  });
});

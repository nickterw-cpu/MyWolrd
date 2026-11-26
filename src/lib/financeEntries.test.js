import { describe, expect, it } from "vitest";
import { applyCardInvoiceChanges, financeEntriesForProcedure, financeSettingsFromEntries, financeSettingsSignature, materializeFinanceEntries } from "./financeEntries.js";
import { syncCardFromFinance } from "./procedureLink.js";

const today = "2026-11-25";
let n = 0;
const newId = () => `id${++n}`;
const card = { id: "c1", name: "Nubank", closingDay: 3, dueDay: 10 };
const form = { type: "saida", category: "Beleza", expenseClass: "procedure", desc: "Laser", amount: 1000, date: "2026-11-20",
  status: "pago", paymentMethod: "Crédito", cardId: "c1" };

describe("materializeFinanceEntries", () => {
  it("à vista no crédito vai para a fatura calculada pelo cartão", () => {
    const { entries } = materializeFinanceEntries({ ...form, installmentsCount: 1 }, { card, today, newId, entryId: "f1" });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: "f1", amount: 1000, invoiceMonth: "2026-12", invoiceMonthExplicit: false });
  });
  it("parcelado com parcelas pagas nos meses anteriores", () => {
    const { entries, payments } = materializeFinanceEntries({ ...form, installmentsCount: 5, paidCount: 2 }, { card, today, newId, groupId: "g" });
    expect(entries.map((e) => [e.invoiceMonth, e.status])).toEqual([
      ["2026-09", "pago"], ["2026-10", "pago"], ["2026-11", "agendado"], ["2026-12", "agendado"], ["2027-01", "agendado"]]);
    expect(entries[0].installmentGroup).toMatchObject({ id: "g", total: 5, paidCount: 2 });
    expect(payments.map((p) => [p.invoiceMonth, p.amount, p.installmentEntryId])).toEqual([["2026-09", 200, "g:1"], ["2026-10", 200, "g:2"]]);
  });
  it("fora do crédito não tem fatura", () => {
    const { entries } = materializeFinanceEntries({ ...form, paymentMethod: "Pix", installmentsCount: 3, invoiceMonth: "2026-12" }, { card, today, newId });
    expect(entries).toHaveLength(1);
    expect(entries[0].invoiceMonth).toBeUndefined();
    expect(entries[0].cardId).toBe("");
  });
});

describe("configuração a partir dos lançamentos", () => {
  it("recupera parcelas e assinatura igual", () => {
    const { entries } = materializeFinanceEntries({ ...form, installmentsCount: 5, paidCount: 2 }, { card, today, newId, groupId: "g" });
    const settings = financeSettingsFromEntries(entries);
    expect(settings).toMatchObject({ paymentMethod: "Crédito", cardId: "c1", installmentsCount: 5, paidCount: 2, firstInvoiceMonth: "2026-09" });
    expect(financeSettingsSignature(settings)).toBe(financeSettingsSignature({ ...settings }));
    expect(financeSettingsSignature({ ...settings, installmentsCount: 6 })).not.toBe(financeSettingsSignature(settings));
  });
  it("atualiza faturas e pagamentos automáticos", () => {
    const { entries, payments } = materializeFinanceEntries({ ...form, installmentsCount: 3, paidCount: 1 }, { card, today, newId, groupId: "g2" });
    const cards = applyCardInvoiceChanges([card], { entries, payments, today });
    expect(Object.keys(cards[0].invoices)).toEqual(["2026-10", "2026-11", "2026-12"]);
    expect(cards[0].payments).toHaveLength(1);
    const cleared = applyCardInvoiceChanges(cards, { removedIds: entries.map((e) => e.id), today });
    expect(cleared[0].payments).toHaveLength(0);
  });
});

describe("procedimento → Finanças", () => {
  const proc = { id: "b1", name: "Laser", cost: 300, plannedSessions: 3, dateDone: "2026-11-20" };
  it("pacote parcelado no cartão", () => {
    const r = financeEntriesForProcedure(proc, { mode: "total", settings: { paymentMethod: "Crédito", cardId: "c1", installmentsCount: 3 }, creditCards: [card], today, newId });
    expect(r.entries.map((e) => [e.amount, e.invoiceMonth, e.category, e.expenseClass])).toEqual([
      [300, "2026-12", "Beleza", "procedure"], [300, "2027-01", "Beleza", "procedure"], [300, "2027-02", "Beleza", "procedure"]]);
    expect(r.link).toMatchObject({ origin: "beauty", mode: "total", installments: 3 });
  });
  it("por sessão no cartão, cada sessão na fatura da sua data", () => {
    const r = financeEntriesForProcedure({ ...proc, scheduledDate: "2026-12-15" }, { mode: "sessions", settings: { paymentMethod: "Crédito", cardId: "c1" }, creditCards: [card], today, newId });
    expect(r.entries.map((e) => [e.date, e.amount, e.invoiceMonth, e.installmentGroup.kind, e.status])).toEqual([
      ["2026-11-20", 300, "2026-12", "sessions", "pago"], ["2026-12-15", 300, "2027-01", "sessions", "previsto"], ["2027-01-14", 300, "2027-02", "sessions", "previsto"]]);
  });
  it("lançamento refeito continua no mesmo card", () => {
    const beauty = [{ id: "b1", name: "Laser", financeLink: { key: "old", origin: "beauty", mode: "total" } }];
    const entries = [{ id: "new1", type: "saida", category: "Beleza", expenseClass: "procedure", amount: 900, date: "2026-11-20", desc: "Laser" }];
    const out = syncCardFromFinance(beauty, entries, { today, newId, previousKey: "old" });
    expect(out).toHaveLength(1);
    expect(out[0].financeLink).toMatchObject({ key: "new1", origin: "beauty" });
  });
});

describe("procedimento futuro nasce previsto", () => {
  it("financeEntriesForProcedure com data futura nasce previsto", () => {
    const r = financeEntriesForProcedure({ id: "bf", name: "Lash", cost: 140, scheduledDate: "2026-12-05" }, { today, newId, settings: { paymentMethod: "Pix" } });
    expect(r.entries[0].status).toBe("previsto");
    const s = financeEntriesForProcedure({ id: "bs", name: "Laser", cost: 100, plannedSessions: 2, dateDone: "2026-11-20", scheduledDate: "2026-12-20" },
      { mode: "sessions", today, newId, settings: { paymentMethod: "Pix" } });
    expect(s.entries.map((e) => e.status)).toEqual(["pago", "previsto"]);
  });
});

describe("previsto parcelado no crédito", () => {
  it("todas as parcelas continuam previstas e sem pagamentos automáticos", () => {
    const { entries, payments } = materializeFinanceEntries({ ...form, status: "previsto", amount: 300, date: "2026-12-05", installmentsCount: 3, paidCount: 1 },
      { card, today, newId, groupId: "gp" });
    expect(entries.map((e) => e.status)).toEqual(["previsto", "previsto", "previsto"]);
    expect(payments).toEqual([]);
  });
});

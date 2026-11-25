import { describe, expect, it } from "vitest";
import {
  buildCardInvoices, monthInstallments,
  cardInvoiceDueDate,
  defaultInvoicePaymentDate,
  ensureInvoiceRecord,
  invoiceStatus,
} from "./cardInvoices.js";
import { cardInvoiceMonthForEntry, financeEntryWithInvoiceMonth } from "./financeIntegration.js";

const card = { id: "c1", name: "Nubank", closingDay: 20, dueDay: 30, limit: 5000 };

describe("faturas do cartão", () => {
  it("lançamento com data de pagamento 30/11 entra na fatura de novembro", () => {
    const entry = financeEntryWithInvoiceMonth(
      { id: "t1", type: "saida", paymentMethod: "Crédito", cardId: "c1", amount: 120, date: "2026-11-25", status: "pago" },
      card,
      "2026-11",
    );
    const saved = { ...entry, invoiceMonthExplicit: true, invoiceDueDate: "2026-11-30" };
    expect(cardInvoiceMonthForEntry(card, saved, [saved])).toBe("2026-11");
    const invoices = buildCardInvoices(card, [saved]);
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ month: "2026-11", total: 120, status: "aberta" });
    expect(invoices[0].purchases.map((p) => p.id)).toEqual(["t1"]);
  });

  it("cria o registro da fatura só quando ainda não existe", () => {
    const withRecord = ensureInvoiceRecord(card, "2026-11", "2026-11-23");
    expect(withRecord.invoices["2026-11"]).toEqual({ month: "2026-11", status: "aberta", createdAt: "2026-11-23" });
    expect(ensureInvoiceRecord(withRecord, "2026-11", "2026-12-01")).toBe(withRecord);
  });

  it("mantém faturas registradas no histórico mesmo sem lançamentos", () => {
    const withRecord = ensureInvoiceRecord(card, "2026-09", "2026-09-01");
    const invoices = buildCardInvoices(withRecord, []);
    expect(invoices.map((invoice) => invoice.month)).toEqual(["2026-09"]);
    expect(invoices[0].total).toBe(0);
  });

  it("ordena o histórico do mês mais recente para o mais antigo e calcula status pago", () => {
    const entries = [
      { id: "a", type: "saida", paymentMethod: "Crédito", cardId: "c1", amount: 50, date: "2026-10-02", invoiceMonth: "2026-10", invoiceMonthExplicit: true },
      { id: "b", type: "saida", paymentMethod: "Crédito", cardId: "c1", amount: 80, date: "2026-11-02", invoiceMonth: "2026-11", invoiceMonthExplicit: true },
      { id: "x", type: "saida", paymentMethod: "Crédito", cardId: "outro", amount: 999, date: "2026-11-02" },
    ];
    const paidCard = { ...card, payments: [{ id: "p", invoiceMonth: "2026-10", amount: 50, date: "2026-10-30" }] };
    const invoices = buildCardInvoices(paidCard, entries);
    expect(invoices.map((invoice) => [invoice.month, invoice.total, invoice.status])).toEqual([
      ["2026-11", 80, "aberta"],
      ["2026-10", 50, "paga"],
    ]);
  });

  it("respeita o status marcado manualmente", () => {
    expect(invoiceStatus({ status: "paga" }, 100, 0)).toBe("paga");
    expect(invoiceStatus(undefined, 100, 100)).toBe("paga");
    expect(invoiceStatus(undefined, 0, 0)).toBe("aberta");
  });

  it("calcula a data de pagamento padrão pelo fechamento e vencimento", () => {
    expect(cardInvoiceDueDate(card, "2026-11")).toBe("2026-11-30");
    expect(cardInvoiceDueDate({ ...card, dueDay: 31 }, "2026-11")).toBe("2026-11-30");
    expect(defaultInvoicePaymentDate(card, "2026-11-15")).toBe("2026-11-30");
    expect(defaultInvoicePaymentDate(card, "2026-11-25")).toBe("2026-12-30");
    expect(defaultInvoicePaymentDate({ id: "sem-dias" }, "2026-11-25")).toBe("2026-11-25");
  });
});

describe("monthInstallments", () => {
  const card = { id: "c1", closingDay: 3, dueDay: 10 };
  const M = (base, i) => { const [y, m] = base.split("-").map(Number); return new Date(Date.UTC(y, m - 1 + i, 1)).toISOString().slice(0, 7); };
  const group = (g, total, amount, dateBase, invBase, paid, extra = {}) => Array.from({ length: total }, (_, k) => ({
    id: `${g}:${k + 1}`, type: "saida", amount, date: `${M(dateBase, k)}-20`, invoiceMonth: M(invBase, k), invoiceMonthExplicit: true,
    status: k < paid ? "pago" : "agendado", paymentMethod: "Crédito", cardId: "c1",
    installmentGroup: { id: g, index: k + 1, total, totalAmount: amount * total }, ...extra }));
  const finance = [
    ...group("ga", 5, 300, "2026-10", "2026-11", 1),
    ...group("gb", 5, 100, "2026-09", "2026-09", 2),
    ...group("gp", 3, 200, "2026-11", "2026-12", 0, { category: "Beleza", expenseClass: "procedure" }),
    { id: "x", type: "saida", amount: 999, date: "2026-11-02", cardId: "c1", paymentMethod: "Crédito", invoiceMonth: "2026-11", invoiceMonthExplicit: true },
    { id: "s:1", type: "saida", amount: 50, date: "2026-11-02", cardId: "c1", paymentMethod: "Crédito", invoiceMonth: "2026-11", invoiceMonthExplicit: true,
      installmentGroup: { id: "s", index: 1, total: 2, kind: "sessions" } },
  ];
  it("usa o mês da fatura, conta pagas e a pagar e bate com as parcelas da fatura", () => {
    const nov = monthInstallments([card], finance, "2026-11");
    expect(nov.items.map((e) => e.id)).toEqual(["ga:1", "gb:3"]);
    expect(nov).toMatchObject({ total: 400, count: 2 });
    const invoiceParcels = buildCardInvoices(card, finance).find((i) => i.month === "2026-11").purchases.filter((e) => e.installmentGroup && e.installmentGroup.kind !== "sessions");
    expect(invoiceParcels.reduce((t, e) => t + e.amount, 0)).toBe(nov.total);
  });
  it("outubro, dezembro e procedimento parcelado", () => {
    expect(monthInstallments([card], finance, "2026-10")).toMatchObject({ total: 100, count: 1 });
    const dez = monthInstallments([card], finance, "2026-12");
    expect(dez).toMatchObject({ total: 600, count: 3 });
    expect(dez.items.some((e) => e.id === "gp:1")).toBe(true);
    expect(monthInstallments([card], finance, "2027-08")).toMatchObject({ total: 0, count: 0 });
  });
});

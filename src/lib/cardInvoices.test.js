import { describe, expect, it } from "vitest";
import {
  buildCardInvoices,
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

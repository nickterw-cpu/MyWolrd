import { cardInvoiceMonthForDate, cardInvoiceMonthForEntry } from "./financeIntegration.js";

// Uma fatura é identificada por cartão + mês de pagamento (AAAA-MM).

function validDay(value) {
  const day = Number(value);
  return Number.isInteger(day) && day >= 1 && day <= 31;
}

function validDate(date) {
  return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date);
}

function cents(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

export function cardInvoiceDueDate(card, month) {
  if (!/^\d{4}-\d{2}$/.test(month || "")) return "";
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const day = validDay(card?.dueDay) ? Number(card.dueDay) : lastDay;
  return `${month}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

// Data de pagamento sugerida para uma compra: o vencimento da fatura calculada pelo fechamento.
// Sem dias de fechamento/vencimento cadastrados, usa a própria data da compra.
export function defaultInvoicePaymentDate(card, purchaseDate) {
  if (!validDate(purchaseDate)) return "";
  if (!validDay(card?.closingDay) || !validDay(card?.dueDay)) return purchaseDate;
  return cardInvoiceDueDate(card, cardInvoiceMonthForDate(card, purchaseDate));
}

export function ensureInvoiceRecord(card, month, today) {
  if (!card || !/^\d{4}-\d{2}$/.test(month || "") || card.invoices?.[month]) return card;
  return {
    ...card,
    invoices: { ...(card.invoices || {}), [month]: { month, status: "aberta", createdAt: today } },
  };
}

export function invoiceStatus(record, total, paid) {
  if (record?.status === "paga") return "paga";
  return total > 0 && paid >= total - 0.005 ? "paga" : "aberta";
}

// Previsto no crédito ainda não aconteceu: aparece só na prévia da fatura, fora do total e do limite.
const isPlannedCardEntry = (entry, card) => entry.cardId === card?.id && entry.type === "saida" && entry.status === "previsto"
  && (!entry.paymentMethod || entry.paymentMethod === "Crédito");

export function isCardPurchase(entry, card) {
  return entry.cardId === card?.id && entry.type === "saida" && entry.status !== "cancelado" && entry.status !== "previsto"
    && (!entry.paymentMethod || entry.paymentMethod === "Crédito");
}

export function buildCardInvoices(card, finance = []) {
  if (!card) return [];
  const list = Array.isArray(finance) ? finance : [];
  const byMonth = new Map();
  const bucket = (month) => {
    if (!byMonth.has(month)) byMonth.set(month, { month, purchases: [], planned: [] });
    return byMonth.get(month);
  };
  Object.keys(card.invoices || {}).forEach(bucket);
  Object.keys(card.invoiceAmounts || {}).forEach((month) => { if (cents(card.invoiceAmounts[month]) > 0) bucket(month); });
  (Array.isArray(card.payments) ? card.payments : []).forEach((payment) => { if (payment.invoiceMonth) bucket(payment.invoiceMonth); });
  list.forEach((entry) => {
    if (!isCardPurchase(entry, card)) return;
    const month = cardInvoiceMonthForEntry(card, entry, list);
    if (month) bucket(month).purchases.push({ ...entry, targetInvoiceMonth: month });
  });
  list.forEach((entry) => {
    if (!isPlannedCardEntry(entry, card)) return;
    const month = cardInvoiceMonthForEntry(card, entry, list);
    if (month) bucket(month).planned.push({ ...entry, targetInvoiceMonth: month });
  });

  return [...byMonth.values()]
    .filter((invoice) => /^\d{4}-\d{2}$/.test(invoice.month))
    .map((invoice) => {
      const informedCents = Math.max(0, cents(card.invoiceAmounts?.[invoice.month]));
      const purchasesCents = invoice.purchases.reduce((sum, entry) => sum + cents(entry.amount), 0);
      const payments = (Array.isArray(card.payments) ? card.payments : []).filter((payment) => payment.invoiceMonth === invoice.month);
      const paidCents = payments.reduce((sum, payment) => sum + cents(payment.amount), 0);
      const total = (informedCents + purchasesCents) / 100;
      const paid = paidCents / 100;
      const record = card.invoices?.[invoice.month];
      return {
        month: invoice.month,
        purchases: invoice.purchases.sort((a, b) => String(a.date).localeCompare(String(b.date))),
        planned: invoice.planned.sort((a, b) => String(a.date).localeCompare(String(b.date))),
        plannedTotal: invoice.planned.reduce((sum, entry) => sum + cents(entry.amount), 0) / 100,
        informed: informedCents / 100,
        total,
        payments,
        paid,
        remaining: Math.max(0, (informedCents + purchasesCents - paidCents) / 100),
        dueDate: cardInvoiceDueDate(card, invoice.month),
        record,
        status: invoiceStatus(record, total, paid),
      };
    })
    .sort((a, b) => b.month.localeCompare(a.month));
}

// Parcelas do mês (caixa de resumo): as mesmas compras e o mesmo mês de fatura que buildCardInvoices usa,
// só das compras parceladas, somando todos os cartões. Pagas e a pagar.
export function monthInstallments(cards = [], finance = [], month) {
  const list = Array.isArray(finance) ? finance : [];
  const items = [];
  (Array.isArray(cards) ? cards : []).forEach((card) => {
    list.forEach((entry) => {
      if (!isCardPurchase(entry, card) || !entry.installmentGroup || entry.installmentGroup.kind === "sessions") return;
      if (cardInvoiceMonthForEntry(card, entry, list) === month) items.push({ ...entry, targetInvoiceMonth: month });
    });
  });
  items.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const totalCents = items.reduce((sum, entry) => sum + cents(entry.amount), 0);
  return { items, total: totalCents / 100, count: items.length };
}

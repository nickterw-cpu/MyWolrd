// Grupos do mês da visão mensal de Finanças (8ª rodada). Cada lançamento cai em UM grupo:
// A. Gasto do mês: pago fora do crédito + faturas pagas (uma linha por fatura);
// B. Agendados/Pendentes: fora do crédito, lançado e ainda não pago;
// C. Parcelas do mês: compras no crédito da fatura do mês ainda aberta (+ saldo informado à mão);
// D. Gastos previstos: status "Previsto" e estimativas automáticas.
import { buildCardInvoices } from "./cardInvoices.js";

const cents = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : 0;
};

export function isPlannedEntry(entry) {
  return !!entry && (entry.status === "previsto" || entry.sourceKind === "previsao");
}

export function isCreditEntry(entry) {
  return !!entry && !!entry.cardId && (!entry.paymentMethod || entry.paymentMethod === "Crédito");
}

const isPaid = (entry) => !entry.status || entry.status === "pago";

function relevant(entry) {
  return !!entry && entry.type === "saida" && entry.status !== "cancelado"
    && entry.expenseClass !== "reserve" && entry.expenseClass !== "investment";
}

function group(items = [], lines = []) {
  const totalCents = items.reduce((sum, entry) => sum + cents(entry.amount), 0)
    + lines.reduce((sum, line) => sum + cents(line.amount), 0);
  return { items, lines, total: totalCents / 100, count: items.length + lines.length };
}

export function monthGroups(finance, cards, month, { receivedIncome = 0, expectedIncome = 0 } = {}) {
  const list = Array.isArray(finance) ? finance : [];
  const inMonth = (entry) => typeof entry.date === "string" && entry.date.slice(0, 7) === month;
  const own = list.filter((entry) => relevant(entry) && inMonth(entry));

  const spentItems = own.filter((entry) => !isPlannedEntry(entry) && !isCreditEntry(entry) && isPaid(entry));
  const scheduledItems = own.filter((entry) => !isPlannedEntry(entry) && !isCreditEntry(entry) && !isPaid(entry));
  const plannedItems = own.filter(isPlannedEntry);

  // crédito: a fatura do mês decide (paga → uma linha no gasto; aberta → as compras ficam em C)
  const spentLines = [];
  const creditItems = [];
  const creditLines = [];
  (Array.isArray(cards) ? cards : []).forEach((card) => {
    const invoice = buildCardInvoices(card, list).find((entry) => entry.month === month);
    if (!invoice) return;
    const purchases = invoice.purchases.filter((entry) => relevant(entry) && !isPlannedEntry(entry));
    const informedCents = cents(invoice.informed);
    const name = card.name || "do cartão";
    if (invoice.status === "paga") {
      const totalCents = purchases.reduce((sum, entry) => sum + cents(entry.amount), 0) + informedCents;
      if (totalCents > 0) spentLines.push({ label: `Fatura ${name} paga`, amount: totalCents / 100, cardId: card.id, month });
      return;
    }
    creditItems.push(...purchases);
    if (informedCents > 0) creditLines.push({ label: `Fatura ${name}: saldo informado à mão`, amount: informedCents / 100, cardId: card.id, month });
  });

  const spent = group(spentItems, spentLines);
  const scheduled = group(scheduledItems);
  const credit = group(creditItems, creditLines);
  const planned = group(plannedItems);
  const plannedCreditCents = plannedItems.filter(isCreditEntry).reduce((sum, entry) => sum + cents(entry.amount), 0);
  const totalCents = Math.round(spent.total * 100) + Math.round(scheduled.total * 100)
    + Math.round(credit.total * 100) + Math.round(planned.total * 100);

  const received = Number(receivedIncome) > 0 ? Number(receivedIncome) : 0;
  const expected = Number(expectedIncome) > 0 ? Number(expectedIncome) : 0;
  const base = received > 0 ? received : expected;
  return {
    spent, scheduled, credit, planned,
    total: totalCents / 100,
    toCard: (Math.round(credit.total * 100) + plannedCreditCents) / 100,
    available: Math.round((base - spent.total) * 100) / 100,
    base,
    baseSource: received > 0 ? "received" : expected > 0 ? "expected" : "none",
  };
}

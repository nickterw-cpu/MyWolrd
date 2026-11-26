// Grupos do mês da visão mensal de Finanças (8ª rodada). Cada lançamento cai em UM grupo:
// A. Gasto do mês: pago fora do crédito + faturas pagas (uma linha por fatura);
// B. Agendados/Pendentes: fora do crédito, lançado e ainda não pago;
// C. Parcelas do mês: compras no crédito da fatura do mês ainda aberta (+ saldo informado à mão);
// D. Gastos previstos: status "Previsto" e estimativas automáticas.
// E. Investimentos (opcional, vindo da aba Investimentos): a meta do mês (investido + o que falta).
//    No Disponível sai só o que já foi investido.
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

export function monthGroups(finance, cards, month, { receivedIncome = 0, expectedIncome = 0, investments = null } = {}) {
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
    // todas as compras reais da fatura (o mesmo total da tela de Fatura), sem os previstos
    const purchases = invoice.purchases.filter((entry) => !isPlannedEntry(entry));
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

  // compras no crédito de um cartão que foi excluído: não têm fatura, ficam no crédito pelo mês da compra
  const cardIds = new Set((Array.isArray(cards) ? cards : []).map((card) => card.id));
  creditItems.push(...own.filter((entry) => !isPlannedEntry(entry) && isCreditEntry(entry) && !cardIds.has(entry.cardId)));

  const spent = group(spentItems, spentLines);
  const scheduled = group(scheduledItems);
  const credit = group(creditItems, creditLines);
  const planned = group(plannedItems);
  const plannedCreditCents = plannedItems.filter(isCreditEntry).reduce((sum, entry) => sum + cents(entry.amount), 0);
  const expensesCents = Math.round(spent.total * 100) + Math.round(scheduled.total * 100)
    + Math.round(credit.total * 100) + Math.round(planned.total * 100);
  const invested = group(investments?.items || [], investments && investments.remaining > 0
    ? [{ label: "Falta investir (meta do mês)", amount: investments.remaining }] : []);
  const investedOutCents = (investments?.items || []).reduce((sum, entry) => sum + cents(entry.amount), 0);
  const totalCents = expensesCents + Math.round(invested.total * 100);

  const received = Number(receivedIncome) > 0 ? Number(receivedIncome) : 0;
  const expected = Number(expectedIncome) > 0 ? Number(expectedIncome) : 0;
  const base = received > 0 ? received : expected;
  return {
    spent, scheduled, credit, planned,
    investments: { ...invested, goal: investments?.goal ?? null, goalSource: investments?.goalSource || "none",
      invested: investedOutCents / 100, remaining: investments?.remaining || 0, exceeded: investments?.exceeded || 0, progress: investments?.progress ?? null },
    expensesTotal: expensesCents / 100,
    total: totalCents / 100,
    toCard: (Math.round(credit.total * 100) + plannedCreditCents) / 100,
    available: Math.round(base * 100 - Math.round(spent.total * 100) - investedOutCents) / 100,
    base,
    baseSource: received > 0 ? "received" : expected > 0 ? "expected" : "none",
  };
}

// Meses com movimento: datas dos lançamentos e meses das faturas dos cartões (uma fatura paga pode
// cair num mês sem nenhum lançamento datado nele).
export function monthsWithActivity(finance, cards) {
  const list = Array.isArray(finance) ? finance : [];
  const months = new Set(list.filter((entry) => entry && entry.status !== "cancelado" && typeof entry.date === "string")
    .map((entry) => entry.date.slice(0, 7)));
  (Array.isArray(cards) ? cards : []).forEach((card) => {
    buildCardInvoices(card, list).forEach((invoice) => {
      if (invoice.total > 0 || invoice.purchases.length) months.add(invoice.month);
    });
  });
  return [...months].filter((month) => /^\d{4}-\d{2}$/.test(month)).sort();
}

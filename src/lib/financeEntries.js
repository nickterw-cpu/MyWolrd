// "Ficha de lançamento": transforma o formulário (novo, edição ou financeiro do procedimento)
// nos lançamentos reais, com parcelas nas faturas certas. Usado por Finanças e Procedimentos.
import { cardInvoiceMonthForDate } from "./financeIntegration.js";
import { ensureInvoiceRecord } from "./cardInvoices.js";
import { cardLinkedDate, planInstallments, procedureSessionCount, procedureSessionDates, procedureTotal, shiftMonth } from "./procedureLink.js";

const FORM_ONLY_KEYS = [
  "installmentsCount", "recurringEnabled", "recurringMonths", "_editScope", "paidCount", "amountMode",
  "firstInvoiceMonth", "_original", "_structural",
];

export function isCreditForm(form) {
  return form?.type === "saida" && form.paymentMethod === "Crédito" && !!form.cardId;
}

// Mês da fatura da 1ª parcela: o escolhido, ou (com parcelas já pagas) voltando a partir do mês atual,
// ou a fatura informada, ou o cálculo pelo fechamento do cartão.
export function defaultFirstInvoiceMonth(form, card, today) {
  const paid = Math.max(0, Number(form.paidCount) || 0);
  if (form.firstInvoiceMonth) return form.firstInvoiceMonth;
  if (paid > 0) return shiftMonth(today.slice(0, 7), -paid);
  if (form.invoiceMonthExplicit && form.invoiceMonth) return form.invoiceMonth;
  return cardInvoiceMonthForDate(card, form.date) || "";
}

export function materializeFinanceEntries(form, { card, today, newId, groupId, entryId }) {
  const base = { ...form };
  FORM_ONLY_KEYS.forEach((key) => delete base[key]);
  delete base.installmentGroup;
  const total = Math.round((Number(form.amount) || 0) * 100) / 100;
  const credit = isCreditForm(form);
  const count = credit ? Math.max(1, Math.floor(Number(form.installmentsCount) || 1)) : 1;
  if (!credit) {
    delete base.invoiceMonth; delete base.invoiceMonthExplicit; delete base.invoiceDueDate; base.cardId = "";
  }
  if (count === 1) {
    const entry = { ...base, id: entryId || newId(), amount: total, plannedAmount: Number(form.plannedAmount) || total };
    if (credit) {
      const explicit = !!(form.firstInvoiceMonth || (form.invoiceMonthExplicit && form.invoiceMonth));
      entry.invoiceMonth = defaultFirstInvoiceMonth(form, card, today);
      entry.invoiceMonthExplicit = explicit;
      if (!explicit || form.firstInvoiceMonth) delete entry.invoiceDueDate;
    }
    return { entries: [entry], payments: [] };
  }
  const paid = Math.min(count - 1, Math.max(0, Math.floor(Number(form.paidCount) || 0)));
  const start = defaultFirstInvoiceMonth(form, card, today);
  const gid = groupId || `installments:${newId()}`;
  delete base.invoiceDueDate;
  const plan = planInstallments({ total, count, paidCount: paid, purchaseDate: form.date, firstInvoiceMonth: start });
  const entries = plan.map((p) => ({
    ...base,
    id: `${gid}:${p.index}`,
    amount: p.amount,
    plannedAmount: p.amount,
    date: p.date,
    invoiceMonth: p.invoiceMonth,
    invoiceMonthExplicit: true,
    installmentGroup: { id: gid, index: p.index, total: p.total, totalAmount: total, purchaseDate: form.date, paidCount: paid },
    status: p.paid || (paid === 0 && p.index === 1 && form.status === "pago" && p.date <= today)
      ? "pago" : form.status === "cancelado" ? "cancelado" : "agendado",
  }));
  // parcelas já pagas: o pagamento fica registrado na fatura do mês para não virar dívida
  const payments = entries.filter((entry, index) => index < paid).map((entry) => ({
    id: newId(), invoiceMonth: entry.invoiceMonth, date: entry.date, amount: entry.amount, auto: true, installmentEntryId: entry.id,
  }));
  return { entries, payments };
}

// Faturas dos cartões: cria o registro do mês, tira pagamentos automáticos de parcelas removidas e põe os novos.
export function applyCardInvoiceChanges(cards, { entries = [], payments = [], removedIds = [], today }) {
  const removed = new Set(removedIds);
  let changed = false;
  const next = (cards || []).map((card) => {
    let current = card;
    const before = current.payments || [];
    const kept = before.filter((payment) => !removed.has(payment.installmentEntryId));
    const added = payments.filter((payment) => entries.some((entry) => entry.cardId === card.id && entry.id === payment.installmentEntryId));
    if (kept.length !== before.length || added.length) current = { ...current, payments: [...kept, ...added] };
    entries.filter((entry) => entry.cardId === card.id && entry.paymentMethod === "Crédito" && entry.invoiceMonth)
      .forEach((entry) => { current = ensureInvoiceRecord(current, entry.invoiceMonth, today); });
    if (current !== card) changed = true;
    return current;
  });
  return changed ? next : cards;
}

// Configuração de pagamento a partir dos lançamentos que já existem (para preencher a ficha).
export function financeSettingsFromEntries(entries) {
  const sorted = [...(entries || [])].sort((a, b) => (Number(a.installmentGroup?.index) || 0) - (Number(b.installmentGroup?.index) || 0));
  const first = sorted[0];
  if (!first) return null;
  const group = first.installmentGroup && first.installmentGroup.kind !== "sessions" ? first.installmentGroup : null;
  const credit = first.paymentMethod === "Crédito" && !!first.cardId;
  return {
    paymentMethod: first.paymentMethod || "",
    cardId: credit ? first.cardId : "",
    accountId: credit ? "" : first.accountId || "",
    status: first.status || "",
    installmentsCount: group ? Number(group.total) || sorted.length : 1,
    paidCount: group ? Number(group.paidCount) || 0 : 0,
    firstInvoiceMonth: credit && group ? first.invoiceMonth || "" : "",
    invoiceMonth: credit && !group && first.invoiceMonthExplicit ? first.invoiceMonth || "" : "",
    invoiceMonthExplicit: !!(credit && !group && first.invoiceMonthExplicit),
    invoiceDueDate: credit && !group && first.invoiceMonthExplicit ? first.invoiceDueDate || "" : "",
  };
}

export function financeSettingsSignature(settings, extra = "") {
  const s = settings || {};
  const credit = s.paymentMethod === "Crédito";
  return JSON.stringify([
    s.paymentMethod || "", credit ? s.cardId || "" : "", credit ? "" : s.accountId || "",
    credit ? Number(s.installmentsCount) || 1 : 1, credit ? Number(s.paidCount) || 0 : 0,
    credit ? s.firstInvoiceMonth || (s.invoiceMonthExplicit ? s.invoiceMonth || "" : "") : "",
    Number(s.installmentsCount) > 1 && credit ? "" : s.status || "", extra,
  ]);
}

// ---------- procedimento → lançamentos (mesma ficha) ----------

export function procedureFinanceForm(card, settings = {}, today) {
  const date = cardLinkedDate(card) || procedureSessionDates(card, 1, today)[0] || today;
  return {
    type: "saida", category: "Beleza", expenseClass: "procedure", desc: card.name || "Procedimento", link: "",
    amount: procedureTotal(card), date,
    status: settings.status || (date <= today ? "pago" : "agendado"),
    paymentMethod: settings.paymentMethod ?? "Pix",
    cardId: settings.cardId || "", accountId: settings.accountId || "",
    installmentsCount: Number(settings.installmentsCount) || 1,
    paidCount: Number(settings.paidCount) || 0,
    firstInvoiceMonth: settings.firstInvoiceMonth || "",
  };
}

export function procedureSignatureExtra(card, mode) {
  return mode === "sessions" ? `sessions:${procedureSessionCount(card)}` : "total";
}

// mode "total": um lançamento (à vista ou parcelado); "sessions": um lançamento por sessão, na data de cada uma.
export function financeEntriesForProcedure(card, { mode = "total", settings = {}, creditCards = [], today, newId, origin = "beauty" }) {
  const form = procedureFinanceForm(card, settings, today);
  const cc = (creditCards || []).find((c) => c.id === form.cardId);
  const count = procedureSessionCount(card);
  if (mode === "sessions" && count > 1) {
    const gid = `sessions:${card.id}`;
    const dates = procedureSessionDates(card, count, today);
    const per = Math.round((form.amount / count) * 100) / 100;
    const entries = dates.map((date, index) => {
      const amount = index === count - 1 ? Math.round((form.amount - per * (count - 1)) * 100) / 100 : per;
      const [entry] = materializeFinanceEntries({
        // cada sessão: paga se a data já passou, a pagar se ainda vai acontecer
        ...form, amount, date, status: date <= today ? "pago" : "agendado",
        installmentsCount: 1, paidCount: 0, firstInvoiceMonth: "",
      }, { card: cc, today, newId, entryId: `${gid}:${index + 1}` }).entries;
      return { ...entry, installmentGroup: { id: gid, index: index + 1, total: count, totalAmount: form.amount, purchaseDate: dates[0], kind: "sessions" } };
    });
    return { entries, payments: [], link: { key: gid, installments: count, installmentAmount: entries[count - 1].amount, origin, mode: "sessions" } };
  }
  const { entries, payments } = materializeFinanceEntries(form, { card: cc, today, newId });
  const grouped = entries.length > 1;
  return {
    entries, payments,
    link: { key: grouped ? entries[0].installmentGroup.id : entries[0].id, installments: grouped ? entries.length : 0,
      installmentAmount: grouped ? entries[entries.length - 1].amount : 0, origin, mode: "total" },
  };
}

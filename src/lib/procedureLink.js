// Vínculo entre lançamentos de Finanças (Beleza + Procedimento) e cards de
// Procedimentos estéticos, e plano de parcelas com parcelas já pagas.

function shiftMonthsDate(date, months) {
  const [year, month, day] = date.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

export function shiftMonth(month, delta) {
  return shiftMonthsDate(`${month}-01`, delta).slice(0, 7);
}

export function monthsBetween(fromMonth, toMonth) {
  const [fy, fm] = fromMonth.split("-").map(Number);
  const [ty, tm] = toMonth.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

const normalize = (text) => String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

export function isProcedureExpense(entry) {
  return !!entry && entry.type === "saida" && normalize(entry.category) === "beleza" && entry.expenseClass === "procedure";
}

export function financeLinkKey(entry) {
  return entry?.installmentGroup?.id || entry?.id || "";
}

export function linkedCardFor(beauty, entry) {
  const key = financeLinkKey(entry);
  return key ? (beauty || []).find((item) => item.financeLink?.key === key) : undefined;
}

export function groupEntries(finance, entry) {
  const key = entry?.installmentGroup?.id;
  if (!key) return entry ? [entry] : [];
  return (finance || []).filter((item) => item.installmentGroup?.id === key)
    .sort((a, b) => Number(a.installmentGroup.index) - Number(b.installmentGroup.index));
}

const round2 = (n) => Math.round(n * 100) / 100;

// Cria ou atualiza o card vinculado ao lançamento (ou ao grupo de parcelas).
// entries: o lançamento único, ou todas as parcelas do grupo.
export function syncCardFromFinance(beauty, entries, { today, newId, previousKey = "" }) {
  const list = Array.isArray(beauty) ? beauty : [];
  if (!entries.length) return list;
  const first = entries[0];
  const key = financeLinkKey(first);
  // lançamento refeito (ex.: virou parcelado): o card continua o mesmo, só troca a chave do vínculo
  const existing = list.find((item) => item.financeLink?.key === key)
    || (previousKey ? list.find((item) => item.financeLink?.key === previousKey) : undefined);
  const isGroup = !!first.installmentGroup;
  const total = round2(entries.reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0));
  const date = (isGroup && first.installmentGroup.purchaseDate) || first.date || today;
  const link = {
    key,
    installments: isGroup ? Number(first.installmentGroup.total) || entries.length : 0,
    installmentAmount: isGroup ? Number(entries[entries.length - 1].amount) || 0 : 0,
  };
  const dateFields = date > today ? { scheduledDate: date, dateDone: "" } : { dateDone: date };
  if (!existing) {
    return [{
      id: newId(), name: first.desc || "Procedimento", cost: total, totalCost: total, totalCostManual: true, history: [],
      procStatus: date > today ? "quero" : "jafiz", ...dateFields,
      region: "", degree: "", placeId: "", bodyArea: "", category: "", goal: "", image: "",
      professional: "", clinic: "", instagram: "", priority: "alta", plannedSessions: "", nextExpenseDate: "",
      recurring: false, frequencyUnit: "meses", frequencyValue: "", result: "", notes: "", link: "",
      financeLink: link, financeAuto: true,
    }, ...list];
  }
  const sameDate = (existing.dateDone || existing.scheduledDate) === date;
  // valor total do card acompanha o lançamento; o valor por sessão só muda nos cards criados por Finanças sem sessões
  const patch = { ...existing, totalCost: total, totalCostManual: true, financeLink: { ...existing.financeLink, ...link, key } };
  if (existing.financeLink?.origin !== "beauty" && procedureSessionCount(existing) === 1) patch.cost = total;
  if (existing.financeLink?.origin === "beauty") { patch.financeLink.origin = "beauty"; patch.financeLink.mode = existing.financeLink.mode; }
  if (!sameDate) {
    Object.assign(patch, date > today
      ? { scheduledDate: date, dateDone: "" }
      : { dateDone: date, scheduledDate: existing.dateDone ? existing.scheduledDate || "" : "" });
  }
  if (!existing.userEdited && first.desc) patch.name = first.desc;
  if (JSON.stringify(patch) === JSON.stringify(existing)) return list;
  return list.map((item) => item.id === existing.id ? patch : item);
}

// "Registrar em Finanças" desmarcado na ficha: só vale se a ficha já conhecia o vínculo
// (uma ficha aberta antes de um vínculo automático não pode apagar o lançamento criado depois).
export function financeUnregisterRequested(formData) {
  return formData?.financeRegister === false && !!formData?.financeLink?.key;
}

export function cardLinkedDate(card) {
  return card?.dateDone || card?.scheduledDate || "";
}

// Sessões do procedimento (mínimo 1) e valor total: calculado (valor por sessão × sessões) ou informado à mão.
export function procedureSessionCount(card) {
  const n = Math.floor(Number(card?.plannedSessions));
  return n > 0 ? n : 1;
}

export function procedureTotal(card) {
  if (card?.totalCostManual && Number(card.totalCost) > 0) return round2(Number(card.totalCost));
  return round2((Number(card?.cost) || 0) * procedureSessionCount(card));
}

// Datas das sessões conhecidas (agenda, agendada no app, última realização); completa com +30 dias.
export function procedureSessionDates(card, count, today) {
  const known = Array.from(new Set([
    ...(card.gcalSessions || []).map((session) => String(session.start || "").slice(0, 10)),
    card.scheduledDate, card.dateDone,
  ].filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date || "")))).sort();
  const dates = known.slice(0, count);
  while (dates.length < count) {
    const last = dates[dates.length - 1] || today;
    const d = new Date(`${last}T00:00:00Z`);
    if (dates.length) d.setUTCDate(d.getUTCDate() + 30);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

// Lançamentos de Finanças para um procedimento criado na aba Procedimentos (Beleza + Procedimento).
// mode "total": um lançamento com o valor total; "sessions": um lançamento por sessão, na data de cada uma.
export function financeEntriesForCard(card, { mode = "total", today, newId }) {
  const total = procedureTotal(card);
  const base = {
    type: "saida", category: "Beleza", expenseClass: "procedure", desc: card.name || "Procedimento",
    paymentMethod: "", accountId: "", cardId: "", link: "",
  };
  const statusFor = (date) => (date <= today ? "pago" : "agendado");
  const count = procedureSessionCount(card);
  if (mode !== "sessions" || count <= 1) {
    const date = cardLinkedDate(card) || procedureSessionDates(card, 1, today)[0];
    const id = newId();
    return {
      entries: [{ ...base, id, amount: total, plannedAmount: total, date, status: statusFor(date) }],
      link: { key: id, installments: 0, installmentAmount: 0, origin: "beauty", mode: "total" },
    };
  }
  const groupId = `sessions:${card.id}`;
  const dates = procedureSessionDates(card, count, today);
  const per = round2(total / count);
  const entries = dates.map((date, index) => {
    const amount = index === count - 1 ? round2(total - per * (count - 1)) : per;
    return {
      ...base, id: `${groupId}:${index + 1}`, amount, plannedAmount: amount, date, status: statusFor(date),
      installmentGroup: { id: groupId, index: index + 1, total: count, totalAmount: total, purchaseDate: dates[0], kind: "sessions" },
    };
  });
  return { entries, link: { key: groupId, installments: count, installmentAmount: entries[count - 1].amount, origin: "beauty", mode: "sessions" } };
}

// Leva valor e data do card para o lançamento (ou parcelas) vinculados.
export function syncFinanceFromCard(finance, card) {
  const key = card?.financeLink?.key;
  const list = Array.isArray(finance) ? finance : [];
  if (!key) return list;
  const linked = list.filter((entry) => financeLinkKey(entry) === key);
  if (!linked.length) return list;
  const total = procedureTotal(card);
  const date = cardLinkedDate(card);
  if (!linked[0].installmentGroup) {
    const entry = linked[0];
    if (Number(entry.amount) === total && (!date || entry.date === date)) return list;
    return list.map((item) => item.id === entry.id
      ? { ...item, amount: total > 0 ? total : item.amount, plannedAmount: total > 0 ? total : item.plannedAmount, ...(date ? { date } : {}) }
      : item);
  }
  const sorted = [...linked].sort((a, b) => Number(a.installmentGroup.index) - Number(b.installmentGroup.index));
  const count = sorted.length;
  const currentTotal = round2(sorted.reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0));
  const purchaseDate = sorted[0].installmentGroup.purchaseDate || sorted[0].date;
  const amountChanged = total > 0 && total !== currentTotal;
  const delta = date && date !== purchaseDate ? monthsBetween(purchaseDate.slice(0, 7), date.slice(0, 7)) : 0;
  const dateChanged = !!date && date !== purchaseDate;
  if (!amountChanged && !dateChanged) return list;
  const per = round2(total / count);
  const updates = new Map(sorted.map((entry, index) => {
    let next = { ...entry, installmentGroup: { ...entry.installmentGroup } };
    if (amountChanged) {
      const amount = index === count - 1 ? round2(total - per * (count - 1)) : per;
      next.amount = amount; next.plannedAmount = amount; next.installmentGroup.totalAmount = total;
    }
    if (dateChanged) {
      next.installmentGroup.purchaseDate = date;
      next.date = shiftMonthsDate(entry.date, delta);
      if (index === 0 && !entry.installmentGroup.purchaseDate) next.date = date;
      if (next.invoiceMonth) next.invoiceMonth = shiftMonth(next.invoiceMonth, delta);
    }
    return [entry.id, next];
  }));
  return list.map((item) => updates.get(item.id) || item);
}

// Plano de parcelas: paidCount parcelas já pagas ficam nos meses anteriores,
// a parcela seguinte na fatura do mês de referência e as demais depois.
export function planInstallments({ total, count, paidCount = 0, purchaseDate, firstInvoiceMonth }) {
  const n = Math.max(1, Math.floor(Number(count) || 1));
  const paid = Math.min(n - 1, Math.max(0, Math.floor(Number(paidCount) || 0)));
  const amountTotal = round2(Number(total) || 0);
  const per = round2(amountTotal / n);
  return Array.from({ length: n }, (_, i) => {
    const amount = i === n - 1 ? round2(amountTotal - per * (n - 1)) : per;
    return {
      index: i + 1,
      total: n,
      amount,
      invoiceMonth: firstInvoiceMonth ? shiftMonth(firstInvoiceMonth, i) : "",
      date: shiftMonthsDate(purchaseDate, i - paid),
      paid: i < paid,
    };
  });
}

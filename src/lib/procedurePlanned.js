// Procedimentos agendados → gastos previstos (8ª rodada). Idempotente: rodar de novo não muda nada.
import { financeEntriesForProcedure } from "./financeEntries.js";
import { financeLinkKey, procedureTotal } from "./procedureLink.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Próxima data da sessão: agendada no app, próxima do Google Agenda, datas antigas (prevista/planejada).
export function procedureNextDate(card, today) {
  const future = (date) => DATE.test(date || "") && date > today;
  if (future(card.scheduledDate)) return card.scheduledDate;
  const gcal = (card.gcalSessions || []).map((session) => String(session.start || "").slice(0, 10)).filter(future).sort()[0];
  if (gcal) return gcal;
  if (future(card.plannedDate)) return card.plannedDate;
  if (future(card.nextExpenseDate)) return card.nextExpenseDate;
  return "";
}

const isCredit = (entry) => !!entry.cardId && (!entry.paymentMethod || entry.paymentMethod === "Crédito");
const round2 = (value) => Math.round(value * 100) / 100;

export function reprocessProcedurePlanned(beauty, finance, { today, newId, creditCards = [] }) {
  const cards = Array.isArray(beauty) ? beauty : [];
  let list = Array.isArray(finance) ? finance : [];
  const report = { converted: [], created: [], skipped: [] };
  let beautyChanged = false;
  let financeChanged = false;
  const nextBeauty = cards.map((card) => {
    if (!card || card.archived) return card;
    const status = String(card.procStatus || "").toLowerCase();
    if (status === "nunca" || status.startsWith("paus")) return card;
    const next = procedureNextDate(card, today);
    if (!next) return card;
    if (card.financeLink?.key) {
      // 1) vinculado: lançamentos futuros ainda "agendado/pendente" passam a previsto
      const ids = new Set(list.filter((entry) => financeLinkKey(entry) === card.financeLink.key
        && ["agendado", "pendente"].includes(entry.status) && entry.date > today
        && !(isCredit(entry) && (entry.installmentGroup?.purchaseDate || entry.date) <= today)).map((entry) => entry.id));
      if (!ids.size) return card;
      const amount = list.filter((entry) => ids.has(entry.id)).reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
      list = list.map((entry) => (ids.has(entry.id) ? { ...entry, status: "previsto" } : entry));
      financeChanged = true;
      report.converted.push({ id: card.id, name: card.name || "Sem nome", date: next, amount: round2(amount) });
      return card;
    }
    if (card.financeRegister === false) return card;
    if (!(procedureTotal(card) > 0)) {
      report.skipped.push({ id: card.id, name: card.name || "Sem nome", reason: "sem valor informado" });
      return card;
    }
    // 2) sem vínculo: cria o lançamento previsto na data da próxima sessão
    const mode = Number(card.plannedSessions) > 1 && card.financeMode === "sessions" ? "sessions" : "total";
    const settings = { paymentMethod: "Pix", ...(card.financeSettings || {}) };
    const dated = { ...card, scheduledDate: next, dateDone: "" };
    const generated = financeEntriesForProcedure(dated, { mode, settings, creditCards, today, newId });
    list = [...generated.entries, ...list];
    financeChanged = true;
    beautyChanged = true;
    report.created.push({ id: card.id, name: card.name || "Sem nome", date: next, amount: procedureTotal(card) });
    return { ...card, financeLink: generated.link, financeRegister: true };
  });
  return {
    beauty: beautyChanged ? nextBeauty : beauty,
    finance: financeChanged ? list : finance,
    cards: creditCards,
    report,
    changed: beautyChanged || financeChanged,
  };
}

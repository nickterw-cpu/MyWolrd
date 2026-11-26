// Meta de investimento mensal e o que já foi investido no mês (fonte única: aba Investimentos).
// goals = { defaults: [{ from: "AAAA-MM", amount }], months: { "AAAA-MM": amount } }
// O padrão vale a partir do mês em que foi definido; mudar o padrão depois não mexe nos meses anteriores.

const cents = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : 0;
};
const inMonth = (date, month) => typeof date === "string" && date.slice(0, 7) === month;

export function investmentGoalFor(goals, month) {
  const months = goals?.months || {};
  if (months[month] !== undefined && months[month] !== null && months[month] !== "") {
    return { amount: cents(months[month]) / 100, source: "month" };
  }
  const defaults = (goals?.defaults || []).filter((item) => item.from <= month).sort((a, b) => a.from.localeCompare(b.from));
  const current = defaults[defaults.length - 1];
  if (current && current.amount !== null && current.amount !== "" && current.amount !== undefined) {
    return { amount: cents(current.amount) / 100, source: "default" };
  }
  return { amount: null, source: "none" };
}

export function setDefaultInvestmentGoal(goals, amount, fromMonth) {
  const defaults = (goals?.defaults || []).filter((item) => item.from !== fromMonth);
  const value = amount === null || amount === "" ? null : cents(amount) / 100;
  return { ...(goals || {}), defaults: [...defaults, { from: fromMonth, amount: value }].sort((a, b) => a.from.localeCompare(b.from)) };
}

export function setMonthInvestmentGoal(goals, month, amount) {
  const months = { ...(goals?.months || {}) };
  if (amount === null || amount === "" || amount === undefined) delete months[month];
  else months[month] = cents(amount) / 100;
  return { ...(goals || {}), months };
}

// Lançamento de Finanças que já é um aporte: transferência para investimento, paga.
function isInvestmentTransfer(entry) {
  return !!entry && entry.type === "saida" && entry.expenseClass === "investment"
    && (!entry.status || entry.status === "pago");
}

export function monthInvestments(investments, finance, goals, month) {
  const aportes = (Array.isArray(investments) ? investments : []).filter((item) => item && inMonth(item.date, month) && cents(item.amount) > 0);
  const transfers = (Array.isArray(finance) ? finance : []).filter((entry) => isInvestmentTransfer(entry) && inMonth(entry.date, month));
  // o mesmo aporte não conta duas vezes: vínculo explícito ou mesma data e mesmo valor
  const linkedIds = new Set(aportes.map((item) => item.financeEntryId).filter(Boolean));
  const freeAportes = aportes.filter((item) => !item.financeEntryId);
  const matched = new Set();
  const ownTransfers = transfers.filter((entry) => {
    if (linkedIds.has(entry.id)) return false;
    const twin = freeAportes.find((item) => !matched.has(item.id) && item.date === entry.date && cents(item.amount) === cents(entry.amount));
    if (twin) { matched.add(twin.id); return false; }
    return true;
  });
  const items = [
    ...aportes.map((item) => ({
      id: `investment:${item.id}`, investmentId: item.id, type: "saida", desc: item.name || "Aporte",
      category: item.institution || "Investimento", date: item.date, amount: cents(item.amount) / 100, notes: item.notes || "",
    })),
    ...ownTransfers,
  ];
  const investedCents = items.reduce((sum, item) => sum + cents(item.amount), 0);
  const goal = investmentGoalFor(goals, month);
  const goalCents = goal.amount === null ? 0 : cents(goal.amount);
  return {
    goal: goal.amount, goalSource: goal.source, items,
    invested: investedCents / 100,
    remaining: Math.max(0, goalCents - investedCents) / 100,
    exceeded: goal.amount === null ? 0 : Math.max(0, investedCents - goalCents) / 100,
    committed: Math.max(goalCents, investedCents) / 100,
    progress: goalCents > 0 ? Math.min(1, investedCents / goalCents) : null,
  };
}

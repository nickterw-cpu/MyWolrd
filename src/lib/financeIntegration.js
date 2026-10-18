import { protectedAmountRemaining } from "./financePlan.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_INTERVALS = {
  mensal: 1,
  monthly: 1,
  trimestral: 3,
  trimestralmente: 3,
  quarterly: 3,
  semestral: 6,
  semestralmente: 6,
  semiannual: 6,
  anual: 12,
  anualmente: 12,
  annual: 12,
};

function validDate(date) {
  return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)
    && !Number.isNaN(Date.parse(`${date}T00:00:00Z`));
}

function dateMonth(date) {
  return date.slice(0, 7);
}

function shiftMonths(date, months) {
  const [year, month, day] = date.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

function shiftDays(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function positiveAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function formatBRL(amount) {
  return amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function frequencyMonths(frequency) {
  const normalized = String(frequency || "").trim().toLowerCase();
  if (MONTH_INTERVALS[normalized]) return MONTH_INTERVALS[normalized];
  const everyMonths = normalized.match(/(?:a cada|cada)\s*(\d+)\s*(?:mes|mês)/);
  if (everyMonths) return Number(everyMonths[1]);
  return 0;
}

export function nextFinanceDate(date, frequency, durationDays = 0) {
  if (!validDate(date)) return "";
  const days = positiveAmount(durationDays);
  if (days) return shiftDays(date, days);
  const months = frequencyMonths(frequency);
  return months ? shiftMonths(date, months) : "";
}

export function createFinanceInstallments(transaction, count) {
  const total = positiveAmount(transaction.amount);
  const numberOfInstallments = Math.floor(Number(count));
  if (!total || numberOfInstallments < 1) return [];
  const perInstallment = Math.round((total / numberOfInstallments) * 100) / 100;
  const groupId = transaction.installmentGroup?.id || `installments:${transaction.id || transaction.date}`;
  let allocated = 0;
  return Array.from({ length: numberOfInstallments }, (_, index) => {
    const amount = index === numberOfInstallments - 1
      ? Math.round((total - allocated) * 100) / 100
      : perInstallment;
    allocated += amount;
    return {
      ...transaction,
      id: `${groupId}:${index + 1}`,
      amount,
      date: shiftMonths(transaction.date, index),
      installmentGroup: {
        id: groupId,
        index: index + 1,
        total: numberOfInstallments,
        totalAmount: total,
      },
      status: index === 0 && transaction.status === "pago"
        && transaction.date <= new Date().toISOString().slice(0, 10)
        ? "pago"
        : transaction.status === "cancelado" ? "cancelado" : "agendado",
    };
  });
}

function sourceRecord(sourceType, source, event, type, expenseClass) {
  const amount = positiveAmount(event.amount ?? event.cost ?? event.value);
  if (!amount || !validDate(event.date)) return null;
  const isProjection = event.status === "projetado";
  return {
    id: `source:${sourceType}:${source.id}:${event.id}`,
    sourceRef: { type: sourceType, sourceId: source.id, eventId: event.id },
    sourceLabel: source.name || source.title || source.desc || "Item integrado",
    sourceKind: isProjection ? "previsao" : "registro",
    type: "saida",
    expenseClass,
    category: event.category || source.category || (
      sourceType === "beauty" ? "Procedimentos" : sourceType === "hobbies" ? "Hobbies" : "Compras pessoais"
    ),
    desc: event.description || event.desc || source.name || source.title || "Despesa integrada",
    date: event.date,
    amount,
    plannedAmount: isProjection ? amount : undefined,
    status: isProjection ? "projetado" : "pago",
    sourcePriority: event.priority || source.priority || "media",
  };
}

function stableHistoryEvent(event, index) {
  return { ...event, id: event.id || `legacy:${event.date || "sem-data"}:${index}` };
}

function projectedRecord(sourceType, source, date, amount, category, priority, expenseClass, suffix) {
  return sourceRecord(sourceType, source, {
    id: `forecast:${suffix}:${date}`,
    date,
    amount,
    category,
    priority,
    status: "projetado",
    description: `${source.name || source.title || "Despesa"} (previsto)`,
  }, "saida", expenseClass);
}

function generateWishlistRecords(shopping, fromDate, untilDate) {
  const result = [];
  shopping.forEach((item) => {
    const history = Array.isArray(item.purchaseHistory) ? item.purchaseHistory : [];
    history.forEach((purchase, index) => {
      const record = sourceRecord("shopping", item, stableHistoryEvent(purchase, index), "saida", "one_time");
      if (record) result.push(record);
    });

    if (item.archived) return;
    const recurring = frequencyMonths(item.purchaseFrequency || item.frequency);
    const intervalDays = positiveAmount(item.productDurationDays);
    const repeatMonths = recurring;
    const isWish = item.kind !== "rotina";
    const wishStatus = String(item.status || "").trim().toLowerCase();
    const routineStatus = String(item.status || "").trim().toLowerCase();
    const canceledWish = isWish && wishStatus.startsWith("cancel");
    const endedRoutine = !isWish && (
      routineStatus.startsWith("cancel") || routineStatus.startsWith("descontinu")
    );
    if (canceledWish || endedRoutine) return;

    const latestPurchase = history.filter((entry) => validDate(entry.date))
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    let nextDate = item.nextPurchaseDate || item.desiredDate || "";
    if (latestPurchase && (repeatMonths || intervalDays)) {
      const afterPurchase = intervalDays
        ? shiftDays(latestPurchase.date, intervalDays)
        : shiftMonths(latestPurchase.date, repeatMonths);
      if (!validDate(nextDate) || nextDate <= latestPurchase.date) nextDate = afterPurchase;
    } else if (latestPurchase && validDate(nextDate) && nextDate <= latestPurchase.date) {
      nextDate = "";
    }
    if (!validDate(nextDate)) return;
    const amount = positiveAmount(item.price);
    if (!amount) return;
    const repeats = repeatMonths > 0 || intervalDays > 0;
    if (isWish && wishStatus === "comprado" && !repeats) return;
    let date = nextDate;
    let count = 0;
    while (date <= untilDate && count < 24) {
      if (date >= fromDate) {
        const record = projectedRecord(
          "shopping", item, date, amount, item.category, item.priority, "one_time", "purchase",
        );
        if (record) result.push(record);
      }
      if (!repeats) break;
      date = intervalDays ? shiftDays(date, intervalDays) : shiftMonths(date, repeatMonths);
      count += 1;
    }
  });
  return result;
}

function generateProcedureRecords(beauty, fromDate, untilDate) {
  const result = [];
  beauty.forEach((procedure) => {
    const history = Array.isArray(procedure.history) ? procedure.history : [];
    history.forEach((entry, index) => {
      const record = sourceRecord("beauty", procedure, stableHistoryEvent(entry, index), "saida", "procedure");
      if (record) result.push(record);
    });
    const status = String(procedure.procStatus || "").trim().toLowerCase();
    if (procedure.archived || status === "nunca" || status.startsWith("paus")) return;
    const interval = procedure.frequencyUnit === "dias"
      ? { days: Number(procedure.frequencyValue) }
      : { months: Number(procedure.frequencyValue) };
    const priorDates = history.map((entry) => entry.date).filter(validDate);
    const lastDate = priorDates.sort().at(-1) || procedure.dateDone;
    if (!validDate(procedure.nextExpenseDate) && (!procedure.recurring || !validDate(lastDate)
      || !positiveAmount(procedure.frequencyValue))) return;
    const repeats = !!procedure.recurring && positiveAmount(procedure.frequencyValue) > 0;
    let date = procedure.nextExpenseDate || (
      interval.days ? shiftDays(lastDate, interval.days) : shiftMonths(lastDate, interval.months)
    );
    const remainingSessions = positiveAmount(procedure.plannedSessions)
      ? Math.max(0, Number(procedure.plannedSessions) - history.length)
      : Infinity;
    let count = 0;
    while (date <= untilDate && count < 24 && count < remainingSessions) {
      if (date >= fromDate) {
        const record = projectedRecord(
          "beauty", procedure, date, procedure.cost, procedure.category || "Procedimentos",
          procedure.priority || "alta", "procedure", "session",
        );
        if (record) result.push(record);
      }
      if (!repeats) break;
      date = interval.days ? shiftDays(date, interval.days) : shiftMonths(date, interval.months);
      count += 1;
    }
  });
  return result;
}

function generateHobbyRecords(hobbies, fromDate, untilDate) {
  const result = [];
  hobbies.forEach((hobby) => {
    const history = Array.isArray(hobby.expenseHistory) ? hobby.expenseHistory : [];
    history.forEach((entry, index) => {
      const record = sourceRecord("hobbies", hobby, stableHistoryEvent(entry, index), "saida", "hobby");
      if (record) result.push(record);
    });
    const status = String(hobby.status || "").trim().toLowerCase();
    if (hobby.archived || status.startsWith("cancel") || status.startsWith("conclu") || status.startsWith("paus")) return;
    const interval = frequencyMonths(hobby.expenseFrequency);
    if (!validDate(hobby.nextExpenseDate) || !positiveAmount(hobby.cost)) return;
    let date = hobby.nextExpenseDate;
    let count = 0;
    while (date <= untilDate && count < 24) {
      if (date >= fromDate) {
        const record = projectedRecord(
          "hobbies", hobby, date, hobby.cost, hobby.category || "Hobbies",
          hobby.priority || "media", "hobby", "expense",
        );
        if (record) result.push(record);
      }
      if (!interval) break;
      date = shiftMonths(date, interval);
      count += 1;
    }
  });
  return result;
}

export function buildIntegratedFinance({ finance = [], shopping = [], beauty = [], hobbies = [], today }) {
  const currentDate = validDate(today) ? today : new Date().toISOString().slice(0, 10);
  const fromDate = `${dateMonth(currentDate)}-01`;
  const untilDate = shiftMonths(fromDate, 12);
  const existing = new Set(finance.map((transaction) =>
    transaction.sourceRef ? `${transaction.sourceRef.type}:${transaction.sourceRef.sourceId}:${transaction.sourceRef.eventId}` : "",
  ));
  const integrated = [
    ...generateWishlistRecords(shopping, currentDate, untilDate),
    ...generateProcedureRecords(beauty, currentDate, untilDate),
    ...generateHobbyRecords(hobbies, currentDate, untilDate),
  ];
  const unique = new Map();
  integrated.forEach((transaction) => {
    const key = `${transaction.sourceRef.type}:${transaction.sourceRef.sourceId}:${transaction.sourceRef.eventId}`;
    if (!existing.has(key)) unique.set(key, transaction);
  });
  return [...finance, ...unique.values()];
}

export function buildFinanceForecast(transactions, plan, fromMonth, horizonMonths = 12) {
  const expectedIncome = positiveAmount(plan?.netSalary)
    || Math.max(0, positiveAmount(plan?.grossSalary) + positiveAmount(plan?.extraIncome) - positiveAmount(plan?.deductions));
  const priorities = (transaction) => String(transaction.sourcePriority || "").toLowerCase();
  return Array.from({ length: horizonMonths }, (_, offset) => {
    const [year, month] = fromMonth.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1 + offset, 1));
    const key = date.toISOString().slice(0, 7);
    const entries = transactions.filter((transaction) => transaction.date?.slice(0, 7) === key
      && transaction.status !== "cancelado");
    const incomeReceived = entries.filter((transaction) => transaction.type === "entrada"
      && (!transaction.status || transaction.status === "pago"))
      .reduce((sum, transaction) => sum + positiveAmount(transaction.amount), 0);
    const committedIncome = entries.filter((transaction) => transaction.type === "entrada"
      && transaction.status && transaction.status !== "pago")
      .reduce((sum, transaction) => sum + positiveAmount(transaction.amount), 0);
    const expenses = entries.filter((transaction) => transaction.type === "saida");
    const actualSpent = expenses.filter((transaction) => !transaction.status || transaction.status === "pago")
      .reduce((sum, transaction) => sum + positiveAmount(transaction.amount), 0);
    const committed = expenses.filter((transaction) => transaction.status && transaction.status !== "pago"
      && transaction.sourceKind !== "previsao")
      .reduce((sum, transaction) => sum + positiveAmount(transaction.amount), 0);
    const estimated = expenses.filter((transaction) => transaction.sourceKind === "previsao")
      .reduce((sum, transaction) => sum + positiveAmount(transaction.amount), 0);
    const optionalEstimate = expenses.filter((transaction) => transaction.sourceKind === "previsao"
      && ["baixa", "low", "opcional"].includes(priorities(transaction)))
      .reduce((sum, transaction) => sum + positiveAmount(transaction.amount), 0);
    const salary = offset === 0 ? 0 : expectedIncome;
    const allocations = Array.isArray(plan?.allocations) ? plan.allocations.filter((allocation) => allocation.protected) : [];
    const transfers = expenses.filter((transaction) => transaction.expenseClass === "reserve" || transaction.expenseClass === "investment");
    const protectedRemaining = (income) => protectedAmountRemaining(allocations, income, transfers);
    const modeledIncome = incomeReceived + committedIncome + salary;
    const plannedReserve = protectedRemaining(modeledIncome);
    const probableReserve = protectedRemaining(modeledIncome);
    const attentionReserve = protectedRemaining(incomeReceived + committedIncome);
    return {
      month: key,
      actualSpent,
      committed,
      estimated,
      expectedIncome: modeledIncome,
      plannedBalance: modeledIncome - actualSpent - committed - estimated - plannedReserve,
      probableBalance: modeledIncome - actualSpent - committed - estimated + optionalEstimate - probableReserve,
      attentionBalance: incomeReceived + committedIncome - actualSpent - committed - estimated - attentionReserve,
    };
  });
}

export function buildFinanceAlerts(transactions, plan, month, today) {
  const allMonthEntries = transactions.filter((transaction) => transaction.date?.slice(0, 7) === month
    && transaction.status !== "cancelado");
  const monthEntries = allMonthEntries.filter((transaction) => transaction.type === "saida");
  const plannedByCategory = new Map();
  const limits = Array.isArray(plan?.allocations) ? plan.allocations : [];
  const expectedMonthlyIncome = positiveAmount(plan?.netSalary)
    || Math.max(0, positiveAmount(plan?.grossSalary) + positiveAmount(plan?.extraIncome) - positiveAmount(plan?.deductions));
  monthEntries.forEach((transaction) => plannedByCategory.set(transaction.category || "Sem categoria",
    (plannedByCategory.get(transaction.category || "Sem categoria") || 0) + positiveAmount(transaction.amount)));
  const alerts = [];
  limits.forEach((allocation) => {
    const limit = allocation.mode === "percent"
      ? expectedMonthlyIncome * positiveAmount(allocation.amount) / 100
      : positiveAmount(allocation.amount);
    if (!limit) return;
    const planned = plannedByCategory.get(allocation.category) || 0;
    [80, 90, 100].filter((threshold) => planned / limit * 100 >= threshold).forEach((threshold) => {
      alerts.push({
        id: `limit:${allocation.id}:${threshold}`,
        level: threshold === 100 ? "alto" : "aviso",
        message: `Gastos, compromissos e previsões de ${allocation.category || "Categoria"} representam ${threshold}% do limite.`,
      });
    });
  });
  const allocationPlan = limits.reduce((sum, allocation) => sum + (
    allocation.mode === "percent"
      ? expectedMonthlyIncome * positiveAmount(allocation.amount) / 100
      : positiveAmount(allocation.amount)
  ), 0);
  if (expectedMonthlyIncome > 0 && allocationPlan > expectedMonthlyIncome) {
    alerts.push({
      id: "allocation-over-budget",
      level: "alto",
      message: `As alocações superam o líquido mensal previsto em ${formatBRL(allocationPlan - expectedMonthlyIncome)}.`,
    });
  }
  const soon = transactions.filter((transaction) => transaction.type === "saida"
    && transaction.sourceKind === "previsao"
    && transaction.date >= today && transaction.date <= shiftDays(today, 30));
  soon.forEach((transaction) => alerts.push({
    id: `due:${transaction.id}`,
    level: "aviso",
    message: `${transaction.sourceLabel}: compra ou despesa prevista para ${transaction.date}.`,
  }));
  if (expectedMonthlyIncome > 0) {
    soon.filter((transaction) => positiveAmount(transaction.amount) >= expectedMonthlyIncome * 0.25)
      .forEach((transaction) => alerts.push({
        id: `large:${transaction.id}`,
        level: "aviso",
        message: `${transaction.sourceLabel}: despesa prevista elevada (25% ou mais do líquido informado).`,
      }));
  }
  const knownIncome = allMonthEntries.filter((transaction) => transaction.type === "entrada"
    && (!transaction.status || transaction.status === "pago"))
    .reduce((sum, transaction) => sum + positiveAmount(transaction.amount), 0);
  const fixedAndPlanned = monthEntries.filter((transaction) => transaction.type === "saida"
    && transaction.status !== "cancelado").reduce((sum, transaction) => sum + positiveAmount(transaction.amount), 0);
  if (knownIncome > 0 && fixedAndPlanned > knownIncome) {
    alerts.push({ id: "budget-risk", level: "alto", message: "Os gastos e compromissos deste mês superam a renda já recebida." });
  }
  const optionalEstimates = monthEntries.filter((transaction) =>
    transaction.sourceKind === "previsao"
    && ["baixa", "low", "opcional"].includes(String(transaction.sourcePriority || "").toLowerCase()));
  if (optionalEstimates.length > 0 && (
    (knownIncome > 0 && fixedAndPlanned > knownIncome)
    || (expectedMonthlyIncome > 0 && allocationPlan > expectedMonthlyIncome)
  )) {
    alerts.push({
      id: "postpone-optional-purchases",
      level: "aviso",
      message: "Para reduzir o risco de ultrapassar o orçamento, considere adiar compras opcionais previstas. Despesas reais continuam liberadas para registro.",
    });
  }
  const protectedTarget = limits.filter((allocation) => allocation.protected).reduce((sum, allocation) => sum + (
    allocation.mode === "percent"
      ? knownIncome * positiveAmount(allocation.amount) / 100
      : positiveAmount(allocation.amount)
  ), 0);
  const spendingRoom = knownIncome - fixedAndPlanned;
  if (protectedTarget > 0 && spendingRoom < protectedTarget) {
    alerts.push({ id: "protected-goal-risk", level: "alto", message: "Os compromissos atuais podem reduzir o valor disponível para suas metas protegidas." });
  }
  return alerts;
}

export function actualExpenseAverages(transactions, today, windowMonths = 12) {
  const month = dateMonth(today);
  const months = Array.from({ length: windowMonths }, (_, index) => {
    const [year, monthNumber] = month.split("-").map(Number);
    return new Date(Date.UTC(year, monthNumber - 1 - index, 1)).toISOString().slice(0, 7);
  });
  const totals = new Map(months.map((key) => [key, 0]));
  transactions.filter((transaction) => transaction.type === "saida"
    && (!transaction.status || transaction.status === "pago")
    && !["reserve", "investment"].includes(transaction.expenseClass)
    && totals.has(transaction.date?.slice(0, 7)))
    .forEach((transaction) => totals.set(transaction.date.slice(0, 7),
      totals.get(transaction.date.slice(0, 7)) + positiveAmount(transaction.amount)));
  const recordedMonths = [...totals.values()].filter((amount) => amount > 0).length;
  const average = (count) => {
    const keys = months.slice(0, count);
    const available = keys.filter((key) => totals.get(key) > 0);
    return available.length < count
      ? { value: available.length ? available.reduce((sum, key) => sum + totals.get(key), 0) / available.length : 0, sufficient: false, months: available.length }
      : { value: keys.reduce((sum, key) => sum + totals.get(key), 0) / count, sufficient: true, months: count };
  };
  return {
    monthly: average(1),
    quarterly: average(3),
    yearly: average(12),
    recordedMonths,
  };
}

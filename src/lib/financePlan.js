function amountOf(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function isTransfer(tx) {
  return tx.expenseClass === "reserve" || tx.expenseClass === "investment";
}

export function protectedAmountRemaining(allocations, income, transfers) {
  const targets = new Map();
  allocations.filter((allocation) => allocation.protected === true).forEach((allocation) => {
    const category = allocation.category || "";
    targets.set(category, (targets.get(category) || 0) + allocationValue(allocation, income));
  });
  const transferred = new Map();
  transfers.filter((tx) => tx.status !== "cancelado").forEach((tx) => {
    const category = tx.category || "";
    transferred.set(category, (transferred.get(category) || 0) + amountOf(tx.amount));
  });
  return [...targets].reduce((total, [category, target]) =>
    total + Math.max(0, target - (transferred.get(category) || 0)), 0);
}

export function allocationValue(allocation, receivedIncome) {
  const amount = amountOf(allocation.amount);
  return allocation.mode === "percent" ? receivedIncome * amount / 100 : amount;
}

const sumOf = (list) => list.reduce((total, tx) => total + amountOf(tx.amount), 0);

export function summarizeFinanceMonth(transactions, plan, month) {
  // Cada número sai da soma de uma lista: as mesmas listas alimentam o detalhe dos blocos.
  const monthTransactions = transactions.filter((tx) =>
    typeof tx.date === "string"
    && tx.date.slice(0, 7) === month
    && tx.status !== "cancelado");
  const paid = (tx) => !tx.status || tx.status === "pago";
  const pending = (tx) => tx.status && tx.status !== "pago" && tx.status !== "cancelado";
  const projected = (tx) => tx.sourceKind === "previsao";
  const incomeList = monthTransactions.filter((tx) => tx.type === "entrada" && paid(tx));
  const receivedIncome = sumOf(incomeList);
  const expenses = monthTransactions.filter((tx) => tx.type === "saida");
  const consumptionExpenses = expenses.filter((tx) => !isTransfer(tx));
  const plannedExpenses = expenses.filter(projected);
  const spentList = consumptionExpenses.filter(paid);
  const spent = sumOf(spentList);
  const commitmentList = expenses.filter((tx) => pending(tx) && !projected(tx));
  const commitments = sumOf(commitmentList);
  const fixedSpentList = spentList.filter((tx) => tx.expenseClass === "fixed");
  const fixedSpent = sumOf(fixedSpentList);
  const variableSpentList = spentList.filter((tx) => tx.expenseClass !== "fixed");
  const fixedCommitmentList = consumptionExpenses.filter((tx) => pending(tx) && tx.expenseClass === "fixed");
  const fixedCommitments = sumOf(fixedCommitmentList);
  const transfers = expenses.filter(isTransfer);
  const transferPaidList = transfers.filter(paid);
  const transferPaid = sumOf(transferPaidList);
  const transferCommitmentList = transfers.filter((tx) => pending(tx) && !projected(tx));
  const transferCommitments = sumOf(transferCommitmentList);
  const variableSpent = sumOf(variableSpentList);
  const variableCommitmentList = commitmentList.filter((tx) => !isTransfer(tx) && tx.expenseClass !== "fixed");
  const variableCommitments = sumOf(variableCommitmentList);
  const consumptionCommitmentList = commitmentList.filter((tx) => !isTransfer(tx));
  const estimatedPurchases = sumOf(plannedExpenses);
  const allocations = Array.isArray(plan?.allocations) ? plan.allocations : [];
  const allocationTotal = allocations.reduce((total, allocation) =>
    total + allocationValue(allocation, receivedIncome), 0);
  const reserved = allocations
    .filter((allocation) => allocation.protected === true)
    .reduce((total, allocation) => total + allocationValue(allocation, receivedIncome), 0);
  const reservedRemaining = protectedAmountRemaining(allocations, receivedIncome, transfers);
  const categoryLimits = new Map();
  allocations.forEach((allocation) => {
    const category = allocation.category || "Sem categoria";
    const current = categoryLimits.get(category) || { id: allocation.id, category, limit: 0 };
    current.limit += allocationValue(allocation, receivedIncome);
    categoryLimits.set(category, current);
  });
  const byCategory = [...categoryLimits.values()].map((allocation) => {
    const { category, limit } = allocation;
    const categoryTransactions = expenses.filter((tx) => (tx.category || "Sem categoria") === category);
    const categorySpent = categoryTransactions
      .filter((tx) => !tx.status || tx.status === "pago")
      .reduce((total, tx) => total + amountOf(tx.amount), 0);
    const categoryCommitted = categoryTransactions
      .filter((tx) => pending(tx) && !projected(tx))
      .reduce((total, tx) => total + amountOf(tx.amount), 0);
    const categoryPlanned = categoryTransactions
      .filter(projected)
      .reduce((total, tx) => total + amountOf(tx.amount), 0);
    return {
      id: allocation.id || category,
      category,
      limit,
      spent: categorySpent,
      committed: categoryCommitted,
      planned: categoryPlanned,
      remaining: limit - categorySpent - categoryCommitted - categoryPlanned,
    };
  });

  // Previsão de gastos: já pago + pendentes de consumo (cartão, fixas/recorrentes e outras) + estimativas.
  const isCard = (tx) => tx.paymentMethod === "Crédito" || !!tx.cardId;
  const isFixedOrRecurring = (tx) => tx.expenseClass === "fixed" || tx.expenseClass === "recurring" || !!tx.recurringId;
  const protectedLines = [];
  {
    const targets = new Map();
    allocations.filter((allocation) => allocation.protected === true).forEach((allocation) => {
      const category = allocation.category || "";
      targets.set(category, (targets.get(category) || 0) + allocationValue(allocation, receivedIncome));
    });
    targets.forEach((target, category) => {
      const done = sumOf(transfers.filter((tx) => tx.status !== "cancelado" && (tx.category || "") === category));
      const remaining = Math.max(0, target - done);
      if (remaining > 0) protectedLines.push({ label: `${category || "Sem categoria"}: meta ${target.toFixed(2)} − transferido ${done.toFixed(2)}`, amount: remaining, category, target, done });
    });
  }
  const lists = {
    income: incomeList,
    spent: spentList,
    commitments: commitmentList,
    fixedSpent: fixedSpentList,
    variableSpent: variableSpentList,
    fixedCommitments: fixedCommitmentList,
    variableCommitments: variableCommitmentList,
    transferPaid: transferPaidList,
    transferCommitments: transferCommitmentList,
    estimated: plannedExpenses,
    projectedSpending: {
      paid: spentList,
      card: consumptionCommitmentList.filter(isCard),
      fixed: consumptionCommitmentList.filter((tx) => !isCard(tx) && isFixedOrRecurring(tx)),
      pending: consumptionCommitmentList.filter((tx) => !isCard(tx) && !isFixedOrRecurring(tx)),
      estimated: plannedExpenses,
    },
    protectedLines,
  };

  return {
    lists,
    receivedIncome,
    spent,
    commitments,
    estimatedPurchases,
    fixedSpent,
    fixedCommitments,
    variableSpent,
    variableCommitments,
    reserved,
    reservedRemaining,
    transferPaid,
    transferCommitments,
    allocationTotal,
    unallocated: receivedIncome - allocationTotal,
    available: receivedIncome - spent - commitments - transferPaid - reservedRemaining,
    projectedSpending: spent + sumOf(consumptionCommitmentList) + estimatedPurchases,
    byCategory,
  };
}

function previousMonth(month, back) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - back, 1));
  return d.toISOString().slice(0, 7);
}

export const SPENDING_LEVELS = {
  none: { mood: "neutral", color: "#B9AFA3", label: "sem dados" },
  good: { mood: "happy", color: "#3E9A5A", label: "ótimo" },
  watch: { mood: "neutral", color: "#E3B22E", label: "equilibrado" },
  aboveAverage: { mood: "neutral", color: "#E3B22E", label: "atenção" },
  high: { mood: "neutral", color: "#D9532F", label: "atenção" },
  over: { mood: "sad", color: "#A1493C", label: "passou" },
  noIncome: { mood: "sad", color: "#A1493C", label: "atenção" },
};

// Gasto do mês com tudo (pago, a pagar, cartão, parcelas e saldo de fatura informado à mão),
// comparado com a renda do mês. As listas são as mesmas dos blocos de Finanças.
export function monthSpendingStatus(transactions, plan, month, { cards = [], expectedIncome = 0 } = {}) {
  const summary = summarizeFinanceMonth(transactions, plan, month);
  const P = summary.lists.projectedSpending;
  const invoiceLines = (Array.isArray(cards) ? cards : [])
    .map((card) => ({ label: `Fatura ${card.name || "do cartão"} (saldo informado à mão)`, amount: amountOf(card.invoiceAmounts?.[month]) }))
    .filter((line) => line.amount > 0);
  const groups = [
    { key: "paid", label: "Já pago", items: P.paid },
    { key: "card", label: "Cartão de crédito e parcelas (a pagar)", items: P.card, lines: invoiceLines },
    { key: "fixed", label: "Contas fixas/recorrentes (a pagar)", items: P.fixed },
    { key: "pending", label: "Outras despesas a pagar", items: P.pending },
  ];
  const spent = groups.reduce((total, group) => total + sumOf(group.items) + (group.lines || []).reduce((t, line) => t + line.amount, 0), 0);
  const receivedIncome = summary.receivedIncome;
  const expected = amountOf(expectedIncome);
  const base = receivedIncome > 0 ? receivedIncome : expected;
  const baseSource = receivedIncome > 0 ? "received" : expected > 0 ? "expected" : "none";
  const available = base - spent;
  const pct = base > 0 ? spent / base : null;

  const history = [1, 2, 3].map((back) => {
    const m = previousMonth(month, back);
    const s = summarizeFinanceMonth(transactions, plan, m);
    const informed = (Array.isArray(cards) ? cards : []).reduce((t, card) => t + amountOf(card.invoiceAmounts?.[m]), 0);
    return s.spent + sumOf(s.lists.projectedSpending.card) + sumOf(s.lists.projectedSpending.fixed) + sumOf(s.lists.projectedSpending.pending) + informed;
  }).filter((value) => value > 0);
  const average = history.length ? history.reduce((t, v) => t + v, 0) / history.length : 0;

  const pctText = pct === null ? "" : `${Math.round(pct * 100)}%`;
  let level; let message; let rule;
  if (spent <= 0 && base <= 0) {
    level = "none"; message = "Sem lançamentos neste mês ainda."; rule = "Nenhum gasto e nenhuma renda no mês.";
  } else if (base <= 0) {
    level = "noIncome"; message = "Há gastos no mês, mas nenhuma renda registrada ainda."; rule = "Existe gasto, mas não há renda recebida nem renda prevista no Planejamento.";
  } else if (pct > 1) {
    level = "over"; message = `Você passou do orçamento: os gastos somam ${pctText} da renda do mês.`; rule = "Gasto do mês maior que 100% da renda do mês.";
  } else if (pct >= 0.85) {
    level = "high"; message = `Atenção, gastos altos: ${pctText} da renda do mês já foi usada.`; rule = "Gasto do mês entre 85% e 100% da renda do mês.";
  } else if (average > 0 && spent > average * 1.25) {
    level = "aboveAverage"; message = `Atenção: você está gastando ${Math.round((spent / average - 1) * 100)}% acima da média dos últimos meses.`;
    rule = "Gasto do mês abaixo de 85% da renda, mas mais de 25% acima da média dos 3 meses anteriores.";
  } else if (pct >= 0.6) {
    level = "watch"; message = `Gastos dentro do orçamento, mas de olho: ${pctText} da renda usada.`; rule = "Gasto do mês entre 60% e 85% da renda do mês.";
  } else {
    level = "good"; message = `Você está economizando bem: ${pctText} da renda usada até agora.`; rule = "Gasto do mês abaixo de 60% da renda do mês (e sem estar muito acima da média).";
  }
  return { ...SPENDING_LEVELS[level], level, message, rule, spent, base, baseSource, receivedIncome, expectedIncome: expected, available, pct, average, groups };
}

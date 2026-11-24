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

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

export function summarizeFinanceMonth(transactions, plan, month) {
  const monthTransactions = transactions.filter((tx) =>
    typeof tx.date === "string"
    && tx.date.slice(0, 7) === month
    && tx.status !== "cancelado");
  const receivedIncome = monthTransactions
    .filter((tx) => tx.type === "entrada" && (!tx.status || tx.status === "pago"))
    .reduce((total, tx) => total + amountOf(tx.amount), 0);
  const expenses = monthTransactions.filter((tx) => tx.type === "saida");
  const consumptionExpenses = expenses.filter((tx) => !isTransfer(tx));
  const paid = (tx) => !tx.status || tx.status === "pago";
  const pending = (tx) => tx.status && tx.status !== "pago" && tx.status !== "cancelado";
  const projected = (tx) => tx.sourceKind === "previsao";
  const plannedExpenses = expenses.filter(projected);
  const spent = consumptionExpenses
    .filter(paid)
    .reduce((total, tx) => total + amountOf(tx.amount), 0);
  const commitments = expenses
    .filter((tx) => pending(tx) && !projected(tx))
    .reduce((total, tx) => total + amountOf(tx.amount), 0);
  const fixedSpent = consumptionExpenses
    .filter((tx) => paid(tx) && tx.expenseClass === "fixed")
    .reduce((total, tx) => total + amountOf(tx.amount), 0);
  const fixedCommitments = consumptionExpenses
    .filter((tx) => pending(tx) && tx.expenseClass === "fixed")
    .reduce((total, tx) => total + amountOf(tx.amount), 0);
  const transfers = expenses.filter(isTransfer);
  const transferPaid = transfers
    .filter(paid)
    .reduce((total, tx) => total + amountOf(tx.amount), 0);
  const transferCommitments = transfers
    .filter((tx) => pending(tx) && !projected(tx))
    .reduce((total, tx) => total + amountOf(tx.amount), 0);
  const variableSpent = spent - fixedSpent;
  const variableCommitments = commitments - fixedCommitments - transferCommitments;
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

  return {
    receivedIncome,
    spent,
    commitments,
    estimatedPurchases: plannedExpenses.reduce((total, tx) => total + amountOf(tx.amount), 0),
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
    projectedSpending: spent + commitments - transferCommitments + plannedExpenses.reduce((total, tx) => total + amountOf(tx.amount), 0),
    byCategory,
  };
}

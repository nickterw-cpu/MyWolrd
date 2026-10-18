function amountOf(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function isTransfer(tx) {
  return tx.expenseClass === "reserve" || tx.expenseClass === "investment";
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
  const pending = (tx) => tx.status && tx.status !== "pago";
  const spent = consumptionExpenses
    .filter(paid)
    .reduce((total, tx) => total + amountOf(tx.amount), 0);
  const commitments = expenses
    .filter(pending)
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
    .filter(pending)
    .reduce((total, tx) => total + amountOf(tx.amount), 0);
  const variableSpent = spent - fixedSpent;
  const variableCommitments = commitments - fixedCommitments - transferCommitments;
  const allocations = Array.isArray(plan?.allocations) ? plan.allocations : [];
  const allocationTotal = allocations.reduce((total, allocation) =>
    total + allocationValue(allocation, receivedIncome), 0);
  const reserved = allocations
    .filter((allocation) => allocation.protected === true)
    .reduce((total, allocation) => total + allocationValue(allocation, receivedIncome), 0);
  const reservedRemaining = allocations
    .filter((allocation) => allocation.protected === true)
    .reduce((total, allocation) => {
      const alreadyReserved = transfers
        .filter((tx) => tx.category === allocation.category)
        .reduce((sum, tx) => sum + amountOf(tx.amount), 0);
      return total + Math.max(0, allocationValue(allocation, receivedIncome) - alreadyReserved);
    }, 0);
  const byCategory = allocations.map((allocation) => {
    const limit = allocationValue(allocation, receivedIncome);
    const categoryTransactions = expenses.filter((tx) => tx.category === allocation.category);
    const categorySpent = categoryTransactions
      .filter((tx) => !tx.status || tx.status === "pago")
      .reduce((total, tx) => total + amountOf(tx.amount), 0);
    const categoryCommitted = categoryTransactions
      .filter((tx) => tx.status && tx.status !== "pago")
      .reduce((total, tx) => total + amountOf(tx.amount), 0);
    return {
      id: allocation.id,
      category: allocation.category || "Sem categoria",
      limit,
      spent: categorySpent,
      committed: categoryCommitted,
      remaining: limit - categorySpent - categoryCommitted,
    };
  });

  return {
    receivedIncome,
    spent,
    commitments,
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
    projectedSpending: spent + commitments - transferCommitments,
    byCategory,
  };
}

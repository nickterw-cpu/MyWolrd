# Grupos do mês e gastos previstos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A visão mensal de Finanças passa a separar Gasto do mês, Agendados/Pendentes, Parcelas do mês (crédito) e Gastos previstos, com Total comprometido; status "Previsto" com Efetivar; procedimentos agendados viram previstos vinculados.

**Architecture:** Uma função pura `monthGroups` (novo `src/lib/monthGroups.js`) decide o grupo de cada lançamento e é a única fonte de números para caixa, panda, blocos, gráficos e Dashboard. "Previsto" é um status de lançamento; as libs de fatura/limite/previsão passam a reconhecê-lo. O reprocessamento de procedimentos é outra função pura e idempotente, chamada pelo App ao carregar.

**Tech Stack:** React 18 (App.jsx único), Vite, Vitest, Playwright (verificação manual), Supabase (dados JSON por chave).

**Spec:** `docs/superpowers/specs/2026-11-26-financas-grupos-design.md`

## Global Constraints

- Manter design e identidade visual; funcionar em celular, tablet e computador.
- Não apagar dados; só mudar status de lançamentos de procedimentos futuros e criar lançamentos previstos conforme o spec.
- Toda soma em centavos para listas e blocos baterem exatamente.
- Textos em português, mesmo tom dos atuais.
- Ao terminar: `npm run build:central`, commit e push direto na `main` (CLAUDE.md).

## Review Focus

- Lançamento no crédito com status "pago" (comprado e marcado pago no form): continua em C até a fatura ser paga, nunca em A → teste em Task 1.
- Fatura paga com saldo informado à mão: a linha de fatura paga usa o total (compras + informado) → teste em Task 1.
- Previsto no crédito parcelado: nenhuma parcela entra em C nem no limite do cartão → testes em Task 2.
- Procedimento vinculado já pago antecipadamente com data futura: continua pago (A ou C), não vira previsto → teste em Task 4.
- Reprocessamento rodando duas vezes: zero mudanças na segunda → teste em Task 4.

---

### Task 1: Grupos do mês (`monthGroups`)

**Files:**
- Create: `src/lib/monthGroups.js`
- Test: `src/lib/monthGroups.test.js`

**Interfaces:**
- Consumes: `buildCardInvoices(card, finance)`, `isCardPurchase(entry, card)` de `src/lib/cardInvoices.js` (já existem).
- Produces:
  - `isPlannedEntry(entry): boolean` — `status === "previsto"` ou `sourceKind === "previsao"`.
  - `isCreditEntry(entry): boolean` — `!!entry.cardId && (!entry.paymentMethod || entry.paymentMethod === "Crédito")`.
  - `monthGroups(finance, cards, month, { receivedIncome = 0, expectedIncome = 0 } = {})` → `{ spent, scheduled, credit, planned, total, toCard, available, base, baseSource }`, onde `spent|scheduled|credit|planned` = `{ items: Entry[], lines: {label, amount, cardId?, month?}[], total: number, count: number }`; `toCard: number` (= credit.total + soma dos previstos no crédito); `available = base − spent.total`; `base` = recebida se > 0, senão prevista; `baseSource: "received"|"expected"|"none"`.
  - Regras exatas no spec (tabela "Os grupos"). Exclui `type !== "saida"`, `status === "cancelado"`, `expenseClass` em `reserve|investment`.

- [ ] **Step 1: Write the failing tests** (`describe("monthGroups")`):
  - `pix pago de 150 entra em gasto e reduz disponível; crédito de 500 não`: finance = [Pix 150 pago 2026-11-10, crédito 500 pago 2026-11-12 cardId c1 (fatura 2026-12 pelo fechamento dia 3)], card {id c1, closingDay 3, dueDay 10}, renda 5000 → nov: `spent.total 150`, `available 4850`, `credit.total 0`; dez: `credit.total 500`, `credit.count 1`.
  - `agendado fora do cartão vai para scheduled`: boleto 80 status agendado nov → `scheduled.total 80`, não em spent/planned.
  - `previsto vai para planned no mês da data e soma no total`: lash 140 status previsto 2026-12-05 Pix → dez `planned.total 140`, nov `planned.total 0`; total dez = spent+scheduled+credit+planned.
  - `previsto no crédito soma em toCard e não em credit`: previsto 140 crédito c1 → `credit.total 0`, `toCard` inclui 140.
  - `fatura paga vira uma linha em spent`: card com `invoices: {"2026-12": {status: "paga"}}` e `invoiceAmounts: {"2026-12": 50}` → dez `credit.total 0`, `spent.lines[0].amount 550` (500+50), `spent.total` inclui 550.
  - `fatura com pagamento parcial continua em credit`: payments 100 em 2026-12 sem status paga → dez `credit.total 550`.
  - `estimativa integrada conta como previsto`: `{sourceKind:"previsao", status:"projetado", amount 90}` → planned.
  - `cada lista soma exatamente o seu total` (centavos): valores 0.1+0.2.

- [ ] **Step 2: Run** `npx vitest run src/lib/monthGroups.test.js` → FAIL (módulo não existe).
- [ ] **Step 3: Implement** `monthGroups` em `src/lib/monthGroups.js` (cents internamente; C e linha de fatura paga vêm de `buildCardInvoices` por cartão, usando `invoice.status`).
- [ ] **Step 4: Run** `npx vitest run src/lib/monthGroups.test.js` → PASS.
- [ ] **Step 5: Commit** `git add src/lib/monthGroups* && git commit -m "Finanças: grupos do mês"`

### Task 2: Status "Previsto" nas libs existentes

**Files:**
- Modify: `src/lib/cardInvoices.js` (`isCardPurchase`, `buildCardInvoices`)
- Modify: `src/lib/financeIntegration.js` (`cardLimitSummary`, `buildFinanceForecast`, `buildFinanceAlerts`, `generateProcedureRecords`)
- Modify: `src/lib/financePlan.js` (`summarizeFinanceMonth`: `projected` usa `isPlannedEntry`; `pending` exclui previsto)
- Modify: `App.jsx` (LIST_REGISTRY.financeStatus defaults + `reconcileLists` requiredDefaults garantindo `previsto`)
- Test: `src/lib/cardInvoices.test.js`, `src/lib/financeIntegration.test.js`, `src/lib/financePlan.test.js`

**Interfaces:**
- Consumes: `isPlannedEntry` (Task 1).
- Produces: `buildCardInvoices(...)` → cada fatura ganha `planned: Entry[]` e `plannedTotal: number` (previstos no crédito daquele mês de fatura); `purchases`/`total` excluem previstos. `isCardPurchase` retorna false para previsto. `generateProcedureRecords` ignora procedimentos com `financeLink`.

- [ ] **Step 1: Tests:** `previsto no crédito não entra no total da fatura nem no limite` (buildCardInvoices total 0, planned length 1, plannedTotal 140; cardLimitSummary used 0); `previsto não é compromisso` (summarizeFinanceMonth: commitments 0, estimatedPurchases 140); `procedimento vinculado não gera estimativa` (buildIntegratedFinance com beauty `{plannedDate futuro, cost 100, financeLink:{key:"x"}}` → nenhuma `sourceKind:"previsao"`).
- [ ] **Step 2: Run** `npx vitest run` → os novos falham.
- [ ] **Step 3: Implement** as mudanças listadas; "previsto" em financeStatus defaults `{ id: "previsto", name: "Previsto" }` e em `requiredDefaults` de `reconcileLists`.
- [ ] **Step 4: Run** `npx vitest run` → tudo PASS (testes antigos inclusive).
- [ ] **Step 5: Commit** `"Finanças: status Previsto nas faturas, limite e previsões"`

### Task 3: Frase do panda e status do mês pelos grupos

**Files:**
- Modify: `src/lib/financePlan.js` (`monthSpendingStatus`)
- Test: `src/lib/financePlan.test.js` (bloco `monthSpendingStatus` reescrito)

**Interfaces:**
- Consumes: `monthGroups` (Task 1).
- Produces: `monthSpendingStatus(finance, plan, month, { cards, expectedIncome })` → mesmo formato atual (`level, mood, color, label, message, rule, base, baseSource, pct, average`) com `spent` = **Total comprometido**, mais `groups` = resultado de `monthGroups` (substitui o array atual), `available` = `groups.available`. `pct = total / base`. Média dos 3 meses anteriores usa o Total comprometido de cada mês. Mensagens e faixas iguais às atuais; o texto da conta diz "total comprometido".

- [ ] **Step 1: Tests:** reescrever os 5 casos existentes com as novas regras + `valor alto no cartão muda a frase` (crédito 4500 com renda 5000 e Pix 1000 → total 5500, level `over`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run` → PASS.
- [ ] **Step 5: Commit** `"Finanças: frase do mês usa o total comprometido"`

### Task 4: Procedimentos → previstos (geração e reprocessamento)

**Files:**
- Modify: `src/lib/financeEntries.js` (`financeEntriesForProcedure`: data da compra > hoje → status `"previsto"` em todas as entradas)
- Create: `src/lib/procedurePlanned.js`
- Test: `src/lib/procedurePlanned.test.js`, `src/lib/financeEntries.test.js`

**Interfaces:**
- Consumes: `financeEntriesForProcedure`, `procedureTotal` (procedureLink.js), `financeLinkKey`.
- Produces:
  - `procedureNextDate(card, today): string` — primeira data > hoje entre `scheduledDate`, próxima `gcalSessions[].start`, `plannedDate`, `nextExpenseDate`; "" se nenhuma.
  - `reprocessProcedurePlanned(beauty, finance, { today, newId, creditCards }) → { beauty, finance, cards, report: { converted: {id,name,date,amount}[], created: [...], skipped: {id,name,reason}[] }, changed: boolean }` — regras 1–3 do spec. `changed` false quando nada muda (mesmas referências de `beauty`/`finance`). Card criado usa `financeSettings` do card ou `{ paymentMethod: "Pix" }`, `financeRegister: true`. Pula `financeRegister === false`, arquivados, `procedureTotal(card) <= 0` (motivo "sem valor"), sem data futura (não reporta), e lançamentos no crédito cuja `installmentGroup.purchaseDate`/`date` ≤ hoje.

- [ ] **Step 1: Tests:** `financeEntriesForProcedure com data futura nasce previsto`; `vinculado agendado futuro vira previsto`; `sem vínculo com sessão agendada cria previsto vinculado`; `sessão do Google conta como data`; `sem valor fica em skipped`; `pago antecipado continua pago`; `segunda execução não muda nada (changed false)`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run` → PASS.
- [ ] **Step 5: Commit** `"Procedimentos agendados viram gastos previstos"`

### Task 5: Visão mensal (caixa, ordem, blocos, gráficos, Efetivar, Fatura)

**Files:**
- Modify: `App.jsx` — `FinanceView` (caixa, `detailFor`, ordem dos gráficos, alerta de vencidos, Efetivar), `FinanceRow` (botão Efetivar e tom suave para previsto), `CategoryExpenseChart` + `expenseCategoryData` (seletor de grupo), `financeChartMonths`/`FinanceChartContent` (saídas = A), aba Fatura (bloco "Prévia" com `invoice.planned`), `FinanceModal` (prop `initialStatus` para Efetivar).

**Interfaces:**
- Consumes: `monthGroups`, `monthSpendingStatus` (Tasks 1, 3), `buildCardInvoices(...).planned` (Task 2).
- Produces:
  - `expenseCategoryData(finance, month, { group = "all", cards = [] })` com `group` ∈ `"all"|"spent"|"scheduled"|"credit"|"planned"`, usando `monthGroups` (linhas de fatura paga entram como categoria "Fatura do cartão"). `categoryDetail` com o mesmo `group`.
  - `settings.categoryChartGroup` guarda a escolha (padrão `"all"`).
  - Caixa: 5 itens (Gasto do mês, Disponível, Parcelas do mês, Gastos previstos, Total comprometido), cada um abre `FinanceDetailModal` com os itens/linhas do grupo; Total abre 4 grupos + nota "vai cair no cartão". Barra: 4 segmentos (cores: efetivo `#5C7A56`, agendado `#B4781F`, crédito `#3F6C9E`, previsto `#A99BC0`) com largura = parte ÷ base.
  - Blocos: mapeamento da tabela do spec.
  - Ordem: panda → caixa → Gastos por categoria → Finanças: últimos meses → blocos.

- [ ] **Step 1:** Implementar; `npx vite build` sem erros.
- [ ] **Step 2:** Verificação no navegador (harness com dados fictícios) dos testes 1, 2, 3, 5 e 6 do pedido: números da caixa = soma das listas em out/nov/dez; Efetivar move o lash de previstos para gasto sem duplicar; prévia da fatura de dezembro mostra o lash previsto; gráficos logo abaixo da caixa (celular e desktop).
- [ ] **Step 3: Commit** `"Visão mensal com grupos, previstos e Efetivar"`

### Task 6: Ligações no App, Dashboard e entrega

**Files:**
- Modify: `App.jsx` — efeito de reprocessamento após carregar (`reprocessProcedurePlanned`, grava finance/beauty/cards só se `changed`, guarda `settings.plannedReportV8` na primeira execução com conteúdo), aviso fechável do relatório na visão mensal, `BeautyView.save` (gera previsto para data futura via Task 4), Dashboard (`overallMood` e gráfico de categorias já usam as funções novas).

- [ ] **Step 1:** Implementar; `npx vitest run` e `npx vite build` sem erros.
- [ ] **Step 2:** Navegador: teste 4 do pedido (coloração, raiz, lash lift de dezembro com sessão agendada/Google/data antiga aparecem em previstos de dezembro; sem valor aparece no relatório como "fora"); recarregar duas vezes não duplica.
- [ ] **Step 3:** `npm run build:central`, commit e `git push origin main`.

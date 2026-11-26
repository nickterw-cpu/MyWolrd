# Finanças: grupos do mês e gastos previstos (8ª rodada)

## Intenção (o porquê)

A visão mensal de Finanças mistura dinheiro que já saiu da conta, compras no cartão e coisas só planejadas, e por isso o "Gasto no mês", o "Disponível" e a frase do panda não refletem a realidade. A usuária quer ver separado, sem nunca somar duas vezes:

- o que já saiu da conta;
- o que está lançado e ainda não foi pago fora do cartão;
- o que está no cartão;
- o que só está planejado.

Ela também quer o total comprometido do mês. Os procedimentos estéticos agendados (coloração, raiz, lash lift de dezembro) precisam aparecer nesse planejamento.

## Objetivos

- Quatro grupos separados por mês, com uma única regra de cálculo usada em toda a visão mensal: caixa de resumo, panda, blocos, listas e gráficos. O Dashboard também usa a mesma regra, porque mostra o panda e o gráfico de categorias.
- Status novo **"Previsto"** para qualquer despesa planejada, com botão **Efetivar**.
- Procedimentos agendados com valor viram lançamentos **previstos** vinculados ao card, inclusive os que já existem (reprocessados uma vez, sem duplicar).
- Todo número clicável abre a lista que o compõe, e o total da lista é exatamente o número.

## Não objetivos

- Não mudar renda, reservas/investimentos, planejamento por categoria (limites), cenários de 3/6/12 meses nem as regras de parcelas e faturas já existentes, exceto onde está descrito aqui.
- Não alterar os dados salvos além do reprocessamento descrito e do status das entradas de procedimento futuras.

## Anti-objetivos (seria falha mesmo funcionando)

- Um valor aparecer em dois grupos ao mesmo tempo.
- Lista de um bloco somar diferente do número do bloco.
- Previsto contar como gasto real, ou reduzir o "Disponível".
- Reprocessar procedimentos duplicando lançamentos.

## Os grupos (mês M = mês visualizado)

Base: lançamentos de Finanças (inclusive os integrados de Wishlist, Procedimentos e Hobbies), de saída, não cancelados, fora as transferências para reserva/investimento (que seguem nos blocos próprios, como hoje).

"Crédito" é o que a tela de Fatura já considera compra do cartão: tem cartão e forma de pagamento Crédito, ou cartão sem forma de pagamento gravada.

| Grupo | Entra | Mês |
|---|---|---|
| **A. Gasto do mês** | (1) status Pago fora do crédito; (2) **faturas pagas**: uma linha "Fatura <cartão> (<mês>) paga" com o total da fatura | data do lançamento; para fatura, o mês da fatura |
| **B. Agendados/Pendentes** | status diferente de Pago, Previsto e Cancelado, fora do crédito | data do lançamento |
| **C. Parcelas do mês (crédito)** | todas as compras no crédito (parceladas ou à vista, inclusive de procedimentos) da fatura do mês **ainda aberta** (não paga), mais o saldo de fatura informado à mão dessa fatura | mês da fatura (mesma regra da tela de Fatura) |
| **D. Gastos previstos** | status **Previsto** (qualquer forma de pagamento) e as Estimativas automáticas que já existem (Wishlist, Hobbies; Procedimentos sem vínculo) | data prevista |

- **Total comprometido = A + B + C + D**, com as quatro partes visíveis ("R$ 150 gastos + R$ 80 agendados + R$ 500 crédito + R$ 140 previstos = R$ 870").
- **Vai cair no cartão = C + previstos no crédito** (parte de D com forma de pagamento Crédito).
- **Disponível = renda do mês − A.** A renda do mês é a recebida; se nada foi recebido, a renda prevista no Planejamento, como hoje.
- **Fatura paga** = status "paga" na tela de Fatura (marcada como paga ou pagamentos ≥ total). Fatura com pagamento parcial conta como aberta: tudo fica em C até ficar paga.
- **Sem dupla contagem:** cada lançamento está em um único grupo, decidido pelo status e pela forma de pagamento. Um lançamento no crédito nunca entra em A diretamente, só pela linha da fatura paga, que substitui as compras dela em C.

## Status "Previsto" e Efetivar

- "Previsto" entra na lista de status (ao lado de Pago, Pendente, Agendado e Cancelado) e é adicionado também para quem já tem a lista salva.
- **Novo lançamento:** ao escolher Previsto, os campos são os mesmos da ficha única (data prevista, valor estimado, categoria, forma de pagamento prevista, e cartão + fatura prevista se for crédito; parcelado também é permitido).
- **Na Fatura:** previstos no crédito **não** entram no total real da fatura nem no limite usado. Eles aparecem na fatura do mês em que cairiam como "Prévia" (tom mais suave, selo "previsto"), com um "Total previsto da fatura" à parte.
- **Efetivar:** botão em cada previsto (lista de lançamentos, lista de "Gastos previstos" e prévia da fatura). Abre a ficha do mesmo lançamento já com status Pago e data de hoje, para conferir valor final, data e forma de pagamento. Ao salvar, o status muda e o lançamento passa a contar em A, B ou C. É o mesmo lançamento, então não duplica.
- **Previsto vencido** (data passou e não foi efetivado): alerta discreto na visão mensal, com a lista e as ações Efetivar, Ajustar data (abre a ficha) e Cancelar (status Cancelado).

## Procedimentos → previstos

- **Regra contínua:** todo procedimento com valor e uma sessão futura, ainda não pago, tem lançamento **previsto** vinculado. O vínculo e a sincronização da 6ª rodada continuam iguais (valor/data nos dois sentidos, excluir pergunta, nunca duplica).
- **Data da sessão futura**, nesta ordem: sessão agendada no app; próxima sessão do Google Agenda; data prevista ou planejada antiga (ocultas desde a 5ª rodada, mas ainda guardadas). Vale só se for depois de hoje.
- **Status:** lançamentos gerados para procedimentos com data depois de hoje nascem **Previsto** (antes nasciam "Agendado"). Quando a data passa, continuam previstos, com o alerta de vencido, até Efetivar.
- **Estimativas antigas:** procedimentos com vínculo deixam de gerar a "Estimativa" automática antiga, para não duplicar com o lançamento previsto.
- **Reprocessamento (roda a cada carregamento e é idempotente):**
  1. Procedimento com vínculo, data futura e lançamentos não pagos com status Agendado ou Pendente: o status passa para Previsto. Ficam de fora os lançamentos no crédito de compras já feitas (data da compra no passado).
  2. Procedimento sem vínculo, com valor, sessão futura e sem "Registrar em Finanças" desligado: cria o lançamento previsto vinculado, com a forma de pagamento da ficha ou Pix, e liga "Registrar em Finanças".
  3. Procedimentos com sessão futura mas sem valor ficam de fora.
- **Relatório:** a primeira vez que o reprocessamento roda, o resultado fica salvo e aparece num aviso que pode ser fechado na visão mensal: quais foram reprocessados (nome, data, valor) e quais ficaram de fora e por quê.

## Visão mensal: caixa, ordem e blocos

- **Caixa de resumo** (abaixo do panda): Gasto do mês | Disponível | Parcelas do mês | Gastos previstos | Total comprometido.
  - O Total comprometido mostra as quatro partes e a linha "vai cair no cartão".
  - Cada bloco abre a sua lista, e o Total comprometido abre a lista com os 4 grupos e subtotais.
  - Cada grupo tem um ícone e uma cor discretos: efetivo, agendado, crédito, previsto.
  - O Disponível mostra "—" e o aviso de renda quando não há renda.
- **Barra:** Total comprometido ÷ renda do mês, com quatro trechos coloridos (A, B, C e D) na proporção de cada um. Os rótulos de faixa continuam os da frase.
- **Panda e frase:** comparam o **Total comprometido** com a renda do mês, com as mesmas faixas de hoje (>100%, 85–100%, acima da média, 60–85%, <60%). O "como é calculado" mostra os 4 grupos.
- **Ordem:** panda → caixa → **gráfico de Gastos por categoria** → **gráfico Finanças: últimos meses** → blocos e demais seções, como hoje.
- **Gráfico por categoria:** seletor "Tudo comprometido | Gasto do mês | Agendados | Crédito | Previstos", com padrão "Tudo comprometido". O título diz qual grupo está sendo mostrado. O Dashboard usa o mesmo gráfico e o mesmo seletor.
- **Gráfico últimos meses:** as saídas de cada mês passam a ser o **Gasto do mês (A)**, com legenda dizendo isso. As entradas continuam como a renda recebida.
- **Blocos** (os nomes continuam; o cálculo passa a usar os grupos):

| Bloco | Passa a ser |
|---|---|
| Renda efetivamente recebida | igual |
| Gastos efetivamente realizados | = A |
| Saldo após gastos de consumo | = Disponível (renda − A) |
| Despesas fixas pendentes | parte de B com classificação Fixo |
| Outras despesas pendentes | o resto de B |
| Gastos fixos realizados / variáveis realizados | A dividido por classificação (a linha "fatura paga" conta como variável) |
| Previsão de gastos do mês | = Total comprometido (4 grupos) |
| Despesas estimadas (não realizadas) | = D |
| Disponível sem comprometer metas | renda − Total comprometido − transferências feitas − reserva protegida pendente |
| Percentual da renda… | Total comprometido ÷ renda |
| Parcelas com vencimento no mês | = C |
| Fatura do cartão, Parcelas futuras, Valor original parcelado, Lançamentos no mês, Reservas | iguais |

- O Planejamento (limites por categoria) e os cenários continuam como estão. Os previstos entram onde hoje entram as "Estimativas".

## Abordagens consideradas

1. **Previsto como status de lançamento de verdade** (escolhida): tudo é lançamento, Efetivar é editar o mesmo lançamento, o vínculo com o procedimento é o mesmo da 6ª rodada, e a dupla contagem fica impossível por construção.
2. Previstos calculados sem guardar: não mexe em dados, mas Efetivar e editar viram operações em dois lugares, e o vínculo fica frágil.
3. Misto (manuais guardados, de procedimentos calculados): junta os problemas da 2 justamente no caso que motivou o pedido.

## Decidido com a usuária

- Os quatro grupos e as definições acima.
- Fatura paga conta no Gasto do mês.
- O panda compara o Total comprometido com a renda.
- Abordagem 1.

## Decisões minhas (para conferir)

- **Pagamento parcial:** fatura com pagamento parcial conta como aberta.
- **Estimativas automáticas:** as de Wishlist e Hobbies continuam e contam como previstos.
- **Status de procedimentos futuros:** procedimentos com data futura nascem Previsto, e os já vinculados com status Agendado ou Pendente passam a Previsto. Os no crédito de compra já feita ficam fora dessa mudança.
- **Gráfico por categoria:** o padrão do seletor é "Tudo comprometido".
- **Gráfico de meses:** as saídas passam a ser o Gasto do mês.
- **Mapeamento dos blocos:** como na tabela acima.

## Para quem constrói

- Centralizar os grupos numa função pura (biblioteca de finanças), testada, usada pela caixa, pelo panda, pelos blocos, pelos gráficos e pelo Dashboard.
- Pontos que hoje tratam "não pago" como compromisso precisam reconhecer Previsto: resumo do mês, previsão, alertas, faturas e limite do cartão.
- Testes obrigatórios (os 6 do pedido) mais testes unitários de cada grupo, de fatura paga ou aberta, de efetivar e do reprocessamento idempotente.

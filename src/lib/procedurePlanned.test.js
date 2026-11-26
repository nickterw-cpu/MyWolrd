import { describe, expect, it } from "vitest";
import { procedureNextDate, reprocessProcedurePlanned } from "./procedurePlanned.js";

const today = "2026-11-26";
let n = 0;
const newId = () => `n${++n}`;
const run = (beauty, finance) => reprocessProcedurePlanned(beauty, finance, { today, newId, creditCards: [] });

describe("procedureNextDate", () => {
  it("usa sessão agendada, depois Google, depois datas antigas; só datas futuras", () => {
    expect(procedureNextDate({ scheduledDate: "2026-12-05" }, today)).toBe("2026-12-05");
    expect(procedureNextDate({ gcalSessions: [{ start: "2026-11-01T10:00" }, { start: "2026-12-09T14:00" }] }, today)).toBe("2026-12-09");
    expect(procedureNextDate({ plannedDate: "2026-12-20" }, today)).toBe("2026-12-20");
    expect(procedureNextDate({ nextExpenseDate: "2026-12-21" }, today)).toBe("2026-12-21");
    expect(procedureNextDate({ scheduledDate: "2026-11-01" }, today)).toBe("");
  });
});

describe("reprocessProcedurePlanned", () => {
  it("vinculado agendado futuro vira previsto", () => {
    const beauty = [{ id: "b1", name: "Coloração", cost: 200, scheduledDate: "2026-12-05", financeLink: { key: "f1", origin: "beauty" } }];
    const finance = [{ id: "f1", type: "saida", category: "Beleza", expenseClass: "procedure", amount: 200, date: "2026-12-05", status: "agendado", paymentMethod: "Pix" }];
    const out = run(beauty, finance);
    expect(out.changed).toBe(true);
    expect(out.finance[0].status).toBe("previsto");
    expect(out.report.converted).toEqual([{ id: "b1", name: "Coloração", date: "2026-12-05", amount: 200 }]);
  });

  it("sem vínculo com sessão agendada cria previsto vinculado", () => {
    const beauty = [{ id: "b2", name: "Raiz", cost: 120, scheduledDate: "2026-12-10", dateDone: "2026-10-01" }];
    const out = run(beauty, []);
    expect(out.finance).toHaveLength(1);
    expect(out.finance[0]).toMatchObject({ status: "previsto", date: "2026-12-10", amount: 120, category: "Beleza", expenseClass: "procedure", paymentMethod: "Pix" });
    expect(out.beauty[0].financeLink.key).toBe(out.finance[0].id);
    expect(out.beauty[0].financeRegister).toBe(true);
    expect(out.report.created).toEqual([{ id: "b2", name: "Raiz", date: "2026-12-10", amount: 120 }]);
  });

  it("sessão do Google conta como data", () => {
    const beauty = [{ id: "b3", name: "Lash lift", cost: 140, gcalSessions: [{ key: "k", start: "2026-12-12T09:00" }] }];
    const out = run(beauty, []);
    expect(out.finance[0]).toMatchObject({ status: "previsto", date: "2026-12-12", amount: 140 });
  });

  it("sem valor fica em skipped", () => {
    const out = run([{ id: "b4", name: "Sobrancelha", cost: "", scheduledDate: "2026-12-03" }], []);
    expect(out.finance).toHaveLength(0);
    expect(out.report.skipped).toEqual([{ id: "b4", name: "Sobrancelha", reason: "sem valor informado" }]);
  });

  it("pago antecipado continua pago e registro desligado é respeitado", () => {
    const beauty = [
      { id: "b5", name: "Botox", cost: 900, scheduledDate: "2026-12-05", financeLink: { key: "f5", origin: "beauty" } },
      { id: "b6", name: "Peeling", cost: 300, scheduledDate: "2026-12-06", financeRegister: false, financeOptOut: true },
    ];
    const finance = [{ id: "f5", type: "saida", amount: 900, date: "2026-11-20", status: "pago", paymentMethod: "Pix" }];
    const out = run(beauty, finance);
    expect(out.finance[0].status).toBe("pago");
    expect(out.finance).toHaveLength(1);
    expect(out.changed).toBe(false);
  });

  it("parcelas no crédito de compra já feita não mudam", () => {
    const beauty = [{ id: "b7", name: "Laser", cost: 600, scheduledDate: "2026-12-05", financeLink: { key: "g", origin: "beauty" } }];
    const finance = [{ id: "g:2", type: "saida", amount: 300, date: "2026-12-20", status: "agendado", paymentMethod: "Crédito", cardId: "c1",
      installmentGroup: { id: "g", index: 2, total: 2, purchaseDate: "2026-11-20" } }];
    expect(run(beauty, finance).finance[0].status).toBe("agendado");
  });

  it("segunda execução não muda nada", () => {
    const beauty = [{ id: "b8", name: "Raiz", cost: 120, scheduledDate: "2026-12-10" }];
    const first = run(beauty, []);
    const second = run(first.beauty, first.finance);
    expect(second.changed).toBe(false);
    expect(second.beauty).toBe(first.beauty);
    expect(second.finance).toBe(first.finance);
  });
});

describe("conversão só no primeiro carregamento", () => {
  it("sem convertExisting, lançamento vinculado agendado (efetivado) não volta a previsto", () => {
    const beauty = [{ id: "b9", name: "Coloração", cost: 200, scheduledDate: "2026-12-05", financeLink: { key: "f9", origin: "beauty" } }];
    const finance = [{ id: "f9", type: "saida", amount: 200, date: "2026-12-05", status: "agendado", paymentMethod: "Boleto" }];
    const out = reprocessProcedurePlanned(beauty, finance, { today, newId, creditCards: [], convertExisting: false });
    expect(out.changed).toBe(false);
    expect(out.finance[0].status).toBe("agendado");
  });
});

describe("previstos que ficavam de fora (9ª rodada)", () => {
  const today = "2026-11-26";
  let n = 0; const newId = () => `id${++n}`;
  const lash = { id: "lash", name: "Lash lifting", procStatus: "quero", cost: 140, scheduledDate: "2026-12-05", history: [], financeRegister: false };

  it("card com 'Registrar em Finanças' gravado como desmarcado sem você ter escolhido ganha o previsto", () => {
    const r = reprocessProcedurePlanned([lash], [], { today, newId, convertExisting: false });
    expect(r.finance).toHaveLength(1);
    expect(r.finance[0]).toMatchObject({ status: "previsto", amount: 140, date: "2026-12-05" });
    expect(r.beauty[0].financeRegister).toBe(true);
    expect(r.report.created.map((c) => c.name)).toEqual(["Lash lifting"]);
  });
  it("quem desmarcou de propósito continua fora", () => {
    const r = reprocessProcedurePlanned([{ ...lash, financeOptOut: true }], [], { today, newId, convertExisting: false });
    expect(r.finance).toHaveLength(0);
    expect(r.report.skipped[0]).toMatchObject({ name: "Lash lifting", reason: "\"Registrar em Finanças\" desmarcado por você" });
  });
  it("data futura informada como data do procedimento também vale", () => {
    const card = { ...lash, scheduledDate: "", dateDone: "2026-12-12" };
    expect(procedureNextDate(card, today)).toBe("2026-12-12");
  });
  it("lista quem ficou de fora por não ter data futura", () => {
    const card = { id: "c", name: "Coloração", procStatus: "quero", cost: 200, history: [] };
    const r = reprocessProcedurePlanned([card], [], { today, newId, convertExisting: false, reportMissingDate: true });
    expect(r.finance).toHaveLength(0);
    expect(r.report.skipped[0]).toMatchObject({ name: "Coloração", reason: "sem data de sessão futura" });
  });
  it("rodar de novo não duplica", () => {
    const first = reprocessProcedurePlanned([lash], [], { today, newId, convertExisting: false });
    const again = reprocessProcedurePlanned(first.beauty, first.finance, { today, newId, convertExisting: false });
    expect(again.changed).toBe(false);
    expect(again.finance).toHaveLength(1);
  });
});

describe("relatório: procedimentos que já estavam vinculados", () => {
  it("lista os vinculados com sessão futura e o status dos lançamentos", () => {
    const card = { id: "r", name: "Raiz", cost: 120, scheduledDate: "2026-12-20", financeLink: { key: "fr" } };
    const finance = [{ id: "fr", type: "saida", status: "previsto", amount: 120, date: "2026-12-20" }];
    const r = reprocessProcedurePlanned([card], finance, { today: "2026-11-26", newId: () => "x", convertExisting: false });
    expect(r.changed).toBe(false);
    expect(r.report.linked).toEqual([{ id: "r", name: "Raiz", date: "2026-12-20", amount: 120, status: "previsto" }]);
  });
});

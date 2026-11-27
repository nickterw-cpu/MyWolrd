import { describe, expect, it } from "vitest";
import { findDuplicateName, normalizeOptionName, remapField, unifyListOptions } from "./listDedupe.js";

const SYSTEM = [{ id: "pago", name: "Pago" }, { id: "pendente", name: "Pendente" }, { id: "agendado", name: "Agendado" }, { id: "previsto", name: "Previsto" }, { id: "cancelado", name: "Cancelado" }];

describe("nome de opção", () => {
  it("ignora maiúsculas, acentos e espaços nas pontas", () => {
    expect(normalizeOptionName("  Prévisto ")).toBe(normalizeOptionName("previsto"));
    expect(normalizeOptionName("Recebido")).not.toBe(normalizeOptionName("Previsto"));
  });
  it("acha nome repetido, menos na própria linha", () => {
    const rows = [{ id: "a", name: "Pago" }, { id: "b", name: "Previsto" }];
    expect(findDuplicateName(rows, " previsto", 0)).toBe(true);
    expect(findDuplicateName(rows, "Previsto", 1)).toBe(false);
    expect(findDuplicateName(rows, "Recebido", 0)).toBe(false);
  });
});

describe("unificar opções", () => {
  it("dois Previsto viram um só, com o identificador do sistema", () => {
    const list = [...SYSTEM.slice(0, 3), { id: "cancelado", name: "Cancelado" }, { id: "u1", name: "Recebido" }, { id: "u2", name: "Previsto" }, { id: "previsto", name: "Previsto" }];
    const r = unifyListOptions(list, SYSTEM, { alignSystem: true });
    expect(r.options.map((o) => o.name)).toEqual(["Pago", "Pendente", "Agendado", "Cancelado", "Recebido", "Previsto"]);
    expect(r.options.find((o) => o.name === "Previsto").id).toBe("previsto");
    expect(r.remap).toEqual({ u2: "previsto" });
    expect(r.merged).toEqual([{ name: "Previsto", from: ["u2"], to: "previsto" }]);
  });
  it("Previsto criado pela usuária (sem o do sistema) passa a usar o identificador do sistema", () => {
    const r = unifyListOptions([{ id: "pago", name: "Pago" }, { id: "x9", name: "previsto " }], SYSTEM, { alignSystem: true });
    expect(r.options).toEqual([{ id: "pago", name: "Pago" }, { id: "previsto", name: "Previsto" }]);
    expect(r.remap).toEqual({ x9: "previsto" });
  });
  it("lista sem repetição não muda", () => {
    const r = unifyListOptions(SYSTEM, SYSTEM, { alignSystem: true });
    expect(r.options).toBe(SYSTEM);
    expect(r.remap).toEqual({});
  });
  it("sem alinhar ao sistema, mantém o primeiro", () => {
    const r = unifyListOptions([{ id: "a", name: "Quero" }, { id: "b", name: "quero" }], []);
    expect(r.options).toEqual([{ id: "a", name: "Quero" }]);
    expect(r.remap).toEqual({ b: "a" });
  });
});

describe("mover os itens", () => {
  it("troca o status dos itens e conta quantos foram movidos, sem tocar nos outros", () => {
    const items = [{ id: 1, status: "u2" }, { id: 2, status: "pago" }, { id: 3, status: "u2" }];
    const r = remapField(items, "status", { u2: "previsto" });
    expect(r.items.map((i) => i.status)).toEqual(["previsto", "pago", "previsto"]);
    expect(r.moved).toBe(2);
    expect(r.items[1]).toBe(items[1]);
  });
  it("respeita o filtro e campos aninhados", () => {
    const items = [{ financeSettings: { status: "u2" } }, { kind: "x", financeSettings: { status: "u2" } }];
    const r = remapField(items, "financeSettings.status", { u2: "previsto" }, (it) => it.kind !== "x");
    expect(r.items[0].financeSettings.status).toBe("previsto");
    expect(r.items[1].financeSettings.status).toBe("u2");
    expect(r.moved).toBe(1);
  });
  it("nada para mover devolve a mesma lista", () => {
    const items = [{ status: "pago" }];
    expect(remapField(items, "status", { u2: "previsto" }).items).toBe(items);
  });
});

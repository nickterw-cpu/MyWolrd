import { describe, expect, it } from "vitest";
import { cleanSelfCareTitle, isSelfCareEvent, syncSelfCareSessions, titlesMatch } from "./selfCareSync.js";

let n = 0;
const newId = () => `new${++n}`;
const ev = (over) => ({ id: "cal1:abc@google.com_0_2026-12-01T14:00", calId: "cal1", calName: "Pessoal", t: "Botox [Self care]", s: "2026-12-01T14:00", e: "2026-12-01T15:00", loc: "Clínica Bela", ...over });

describe("selfCareSync", () => {
  it("reconhece a agenda Self care ou a marcação no título", () => {
    expect(isSelfCareEvent(ev({}))).toBe(true);
    expect(isSelfCareEvent(ev({ t: "Botox", calName: "Self Care" }))).toBe(true);
    expect(isSelfCareEvent(ev({ t: "Limpeza #selfcare" }))).toBe(true);
    expect(isSelfCareEvent(ev({ t: "Dentista" }))).toBe(false);
  });

  it("limpa o título e compara nomes parecidos", () => {
    expect(cleanSelfCareTitle("Self care: Botox")).toBe("Botox");
    expect(cleanSelfCareTitle("Botox [Self care]")).toBe("Botox");
    expect(titlesMatch("Depilação a laser", "Laser - Self care")).toBe(true);
    expect(titlesMatch("Botox", "Botox testa")).toBe(true);
    expect(titlesMatch("Pé", "Pedicure")).toBe(false);
  });

  it("vincula ao card existente e não duplica ao rodar de novo", () => {
    const beauty = [{ id: "b1", name: "Botox", history: [] }];
    const once = syncSelfCareSessions(beauty, [ev({})], { newId });
    expect(once).toHaveLength(1);
    expect(once[0].gcalSessions).toHaveLength(1);
    expect(once[0].gcalSessions[0]).toMatchObject({ start: "2026-12-01T14:00", loc: "Clínica Bela" });
    const twice = syncSelfCareSessions(once, [ev({})], { newId });
    expect(twice).toBe(once);
  });

  it("acompanha mudança de horário e exclusão no Google", () => {
    const beauty = syncSelfCareSessions([{ id: "b1", name: "Botox", history: [] }], [ev({})], { newId });
    const moved = syncSelfCareSessions(beauty, [ev({ id: "cal1:abc@google.com_0_2026-12-03T10:00", s: "2026-12-03T10:00" })], { newId });
    expect(moved[0].gcalSessions).toHaveLength(1);
    expect(moved[0].gcalSessions[0].start).toBe("2026-12-03T10:00");
    const removed = syncSelfCareSessions(moved, [], { newId });
    expect(removed[0].gcalSessions).toEqual([]);
    expect(removed[0].name).toBe("Botox");
  });

  it("cria card novo quando não acha correspondência e remove se o evento sumir", () => {
    const created = syncSelfCareSessions([{ id: "b1", name: "Botox", history: [] }], [ev({ id: "cal1:xyz_0_2026-12-05T09:00", t: "Self care - Massagem", s: "2026-12-05T09:00" })], { newId });
    expect(created).toHaveLength(2);
    expect(created[0]).toMatchObject({ name: "Massagem", clinic: "Clínica Bela", gcalAuto: true });
    const gone = syncSelfCareSessions(created, [], { newId });
    expect(gone.map((c) => c.name)).toEqual(["Botox"]);
  });

  it("ignora eventos sem a marcação", () => {
    const beauty = [{ id: "b1", name: "Botox", history: [] }];
    expect(syncSelfCareSessions(beauty, [ev({ t: "Botox" })], { newId })).toBe(beauty);
  });
});

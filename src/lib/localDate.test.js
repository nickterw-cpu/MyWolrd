import { describe, expect, it } from "vitest";
import { localDateStr } from "./localDate.js";

describe("localDateStr", () => {
  it("mantém o dia local quando UTC já avançou para o dia seguinte", () => {
    process.env.TZ = "America/Sao_Paulo";
    const lateEvening = new Date("2026-10-11T02:30:00.000Z");
    expect(lateEvening.getDate()).toBe(10);
    expect(localDateStr(lateEvening)).toBe("2026-10-10");
  });

  it("formata mês e dia com dois dígitos", () => {
    expect(localDateStr(new Date(2026, 0, 2, 12))).toBe("2026-01-02");
  });
});

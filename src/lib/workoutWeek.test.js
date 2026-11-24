import { describe, expect, it } from "vitest";
import { countInWeek, numericGoalProgress, weekStartOf, weeklyMessage, weeklyStreak } from "./workoutWeek.js";

describe("workoutWeek", () => {
  it("começa a semana na segunda-feira", () => {
    expect(weekStartOf("2026-11-24")).toBe("2026-11-23"); // terça
    expect(weekStartOf("2026-11-29")).toBe("2026-11-23"); // domingo
    expect(weekStartOf("2026-11-23")).toBe("2026-11-23");
  });

  it("conta só os treinos da semana", () => {
    const done = { "2026-11-22": true, "2026-11-23": true, "2026-11-25": true, "2026-11-30": true, "2026-11-24": false };
    expect(countInWeek(done, "2026-11-24")).toBe(2);
  });

  it("conta semanas seguidas com a meta e não quebra na semana em andamento", () => {
    const done = {
      "2026-11-09": true, "2026-11-10": true,
      "2026-11-16": true, "2026-11-18": true,
      "2026-11-23": true,
    };
    expect(weeklyStreak(done, 2, "2026-11-24")).toBe(2);
    expect(weeklyStreak({ ...done, "2026-11-24": true }, 2, "2026-11-24")).toBe(3);
    expect(weeklyStreak(done, 3, "2026-11-24")).toBe(0);
  });

  it("escolhe a mensagem conforme a semana", () => {
    expect(weeklyMessage(0, 4, 0)).toMatch(/recomeçar hoje/);
    expect(weeklyMessage(2, 4, 0)).toBe("Você já começou, continue assim!");
    expect(weeklyMessage(3, 4, 0)).toBe("Você foi 3 vezes treinar essa semana, continue assim!");
    expect(weeklyMessage(4, 4, 5)).toMatch(/batida.*5 semanas/);
  });

  it("calcula progresso numérico para subir ou descer", () => {
    expect(numericGoalProgress(0, 2, 4)).toBe(50);
    expect(numericGoalProgress(100, 95, 90)).toBe(50);
    expect(numericGoalProgress(100, 80, 90)).toBe(100);
    expect(numericGoalProgress("", 1, 2)).toBe(50);
    expect(numericGoalProgress(0, "", 2)).toBe(null);
  });
});

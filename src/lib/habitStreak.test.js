import { describe, expect, it } from "vitest";
import { habitStreak } from "./habitStreak.js";

describe("habitStreak", () => {
  it("counts completed days in chronological order across a month boundary", () => {
    const log = Object.fromEntries(
      ["2026-01-27", "2026-01-28", "2026-01-29", "2026-01-30", "2026-01-31", "2026-02-01", "2026-02-02"]
        .map((date) => [date, true]),
    );

    expect(habitStreak(log, "2026-02-02")).toBe(7);
  });

  it("counts while historical days are marked from left to right", () => {
    const dates = ["2026-01-27", "2026-01-28", "2026-01-29", "2026-01-30", "2026-01-31", "2026-02-01", "2026-02-02"];
    const log = {};

    dates.forEach((date, index) => {
      log[date] = true;
      expect(habitStreak(log, "2026-02-02")).toBe(index + 1);
    });
  });

  it("keeps yesterday's active streak when today is not checked yet", () => {
    expect(habitStreak({ "2026-01-31": true, "2026-02-01": true }, "2026-02-02")).toBe(2);
  });

  it("starts a streak with today's completion and stops at the first missed day", () => {
    expect(habitStreak({
      "2026-02-01": true,
      "2026-02-02": true,
      "2026-02-04": true,
    }, "2026-02-04")).toBe(1);
  });
});

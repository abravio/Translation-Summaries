import { describe, expect, it } from "vitest";
import { clampLevel, suggestedLevelDelta, tapsPer100 } from "@/lib/level";

describe("level math", () => {
  it("clamps outside [1, 10]", () => {
    expect(clampLevel(0)).toBe(1);
    expect(clampLevel(11)).toBe(10);
    expect(clampLevel(5.4)).toBe(5);
  });

  it("computes taps per 100 words", () => {
    expect(tapsPer100(0, 100)).toBe(0);
    expect(tapsPer100(5, 100)).toBe(5);
    expect(tapsPer100(3, 50)).toBe(6);
    expect(tapsPer100(0, 0)).toBe(0);
  });

  it("nudges level from tap rate", () => {
    expect(suggestedLevelDelta(0, 150)).toBe(2); // no taps → jump up 2
    expect(suggestedLevelDelta(2, 150)).toBe(1); // ~1.3/100 → +1
    expect(suggestedLevelDelta(6, 150)).toBe(0); // 4/100 → hold
    expect(suggestedLevelDelta(12, 150)).toBe(-1); // 8/100 → -1
    expect(suggestedLevelDelta(30, 150)).toBe(-2); // 20/100 → -2
  });
});

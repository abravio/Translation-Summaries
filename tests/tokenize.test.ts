import { describe, expect, it } from "vitest";
import { detokenize, surfaceTokenize, lookupKey } from "@/lib/tokenize";

describe("surfaceTokenize", () => {
  it("splits words and preserves punctuation", () => {
    const tokens = surfaceTokenize("Hola, mundo!");
    expect(tokens.map((t) => t.t)).toEqual(["Hola", ",", "mundo", "!"]);
    expect(tokens.map((t) => t.w)).toEqual([true, false, true, false]);
  });

  it("handles Spanish diacritics", () => {
    const tokens = surfaceTokenize("El niño corrió rápidamente.");
    const words = tokens.filter((t) => t.w).map((t) => t.t);
    expect(words).toEqual(["El", "niño", "corrió", "rápidamente"]);
  });

  it("round-trips via detokenize", () => {
    const original = "Hola, mundo! ¿Cómo estás?";
    const tokens = surfaceTokenize(original);
    expect(detokenize(tokens).trim()).toBe(original);
  });
});

describe("lookupKey", () => {
  it("lowercases and trims", () => {
    expect(lookupKey("  Correr ")).toBe("correr");
    expect(lookupKey("NIÑO")).toBe("niño");
  });
});

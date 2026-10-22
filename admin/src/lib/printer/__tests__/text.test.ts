import { describe, expect, it } from "vitest";
import { splitGraphemes, wrapText } from "../text";

const tenPerCharacter = (text: string) => text.length * 10;

describe("splitGraphemes", () => {
  it("keeps a Devanagari consonant and matra in one cluster", () => {
    expect(splitGraphemes("कि")).toEqual(["कि"]);
    expect(splitGraphemes("कि").join("")).toBe("कि");
  });
});

describe("wrapText", () => {
  it("breaks on spaces before breaking words", () => {
    expect(wrapText("RAM KUMAR YADAV", 90, tenPerCharacter)).toEqual([
      "RAM KUMAR",
      "YADAV",
    ]);
  });

  it("breaks an over-long word on grapheme boundaries", () => {
    expect(wrapText("ABCDEFGHIJ", 45, tenPerCharacter)).toEqual([
      "ABCD",
      "EFGH",
      "IJ",
    ]);
  });

  it("preserves explicit paragraph breaks", () => {
    expect(wrapText("A\nB", 100, tenPerCharacter)).toEqual(["A", "B"]);
  });

  it("collapses whitespace and trims the result", () => {
    expect(wrapText("  RAM   KUMAR  ", 200, tenPerCharacter)).toEqual([
      "RAM KUMAR",
    ]);
    expect(wrapText("   ", 200, tenPerCharacter)).toEqual([]);
  });

  it("continues normally after a broken long word", () => {
    expect(
      wrapText("ABCDEFGHIJ Z", 45, tenPerCharacter),
    ).toEqual(["ABCD", "EFGH", "IJ Z"]);
  });
});

/**
 * Grapheme-aware line wrapping for the raster slip.
 *
 * Canvas measures UTF-16 code units, but Devanagari breaks badly if you slice
 * a cluster (e.g. a consonant + matra) in half. `Intl.Segmenter` keeps
 * grapheme clusters together; `Array.from` is the fallback for old engines.
 *
 * The measurement function is injected so this stays a pure, testable module:
 * the renderer passes `ctx.measureText`, tests pass a character-width stub.
 */

interface GraphemeSegmenter {
  segment(input: string): Iterable<{ segment: string }>;
}

let cachedSegmenter: GraphemeSegmenter | null | undefined;

function graphemeSegmenter(): GraphemeSegmenter | null {
  if (cachedSegmenter !== undefined) return cachedSegmenter;
  try {
    if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
      cachedSegmenter = new Intl.Segmenter(undefined, {
        granularity: "grapheme",
      }) as GraphemeSegmenter;
      return cachedSegmenter;
    }
  } catch {
    // Old ICU / locked-down runtime: fall through to code points.
  }
  cachedSegmenter = null;
  return null;
}

export function splitGraphemes(text: string): string[] {
  const segmenter = graphemeSegmenter();
  if (!segmenter) return Array.from(text);
  return Array.from(segmenter.segment(text), (part) => part.segment);
}

/**
 * Wrap `text` to `maxWidth` using `measure` for the current font.
 *
 * Explicit newlines become separate paragraphs. Words are broken only when a
 * single word cannot fit; a break always lands on a grapheme boundary. Returns
 * [] for whitespace-only input.
 */
export function wrapText(
  text: string,
  maxWidth: number,
  measure: (text: string) => number,
): string[] {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];
  if (maxWidth <= 0) return [normalized];

  const lines: string[] = [];

  for (const paragraph of normalized.split("\n")) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    let current = "";
    const flush = () => {
      if (current.trim()) lines.push(current.trimEnd());
      current = "";
    };

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (measure(candidate) <= maxWidth) {
        current = candidate;
        continue;
      }

      if (current) flush();

      if (measure(word) <= maxWidth) {
        current = word;
        continue;
      }

      // A single word wider than the column: break by grapheme.
      let piece = "";
      for (const grapheme of splitGraphemes(word)) {
        const next = piece + grapheme;
        if (piece && measure(next) > maxWidth) {
          lines.push(piece);
          piece = grapheme;
        } else {
          piece = next;
        }
      }
      current = piece;
    }

    flush();
  }

  return lines;
}

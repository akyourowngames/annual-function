// Pure, dependency-free text helpers so they can be unit-tested under plain
// `node --test` (knowledge.ts itself pulls the DB + unpdf, which tests can't).

export function chunkText(input: string, size = 1200, overlap = 200): string[] {
  const text = input
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) return [];
  if (text.length <= size) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + size, text.length);
    if (end < text.length) {
      const window = text.slice(start, end);
      const cut = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf(". "));
      if (cut > size * 0.4) end = start + cut + 1;
    }
    const piece = text.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= text.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

// Significant words for retrieval. Drops punctuation and very short tokens
// (English/Hindi stop words like "is", "the", "me" add matches, not signal).
export function keywords(input: string, minLength = 3): string[] {
  return [
    ...new Set(
      input
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter((w) => w.length >= minLength),
    ),
  ].slice(0, 12);
}

// Build an OR tsquery ("backup | generator") so a natural-language question
// matches documents that contain SOME of its words. An AND query (the default
// for plainto/websearch) returns nothing for "where is the backup generator?".
export function orTsQuery(input: string): string {
  return keywords(input, 3)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean)
    .join(" | ");
}

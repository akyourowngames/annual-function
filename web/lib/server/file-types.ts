// Pure format detection + light text cleaning for uploaded knowledge files.
// Dependency-free so it is unit-testable under plain `node --test`; the heavy
// extractors (unpdf, mammoth, word-extractor) live in knowledge.ts.
export type DocKind = "pdf" | "docx" | "doc" | "html" | "rtf" | "text";

const EXTENSIONS: Record<string, DocKind> = {
  pdf: "pdf",
  docx: "docx",
  doc: "doc",
  html: "html",
  htm: "html",
  rtf: "rtf",
  txt: "text",
  text: "text",
  md: "text",
  markdown: "text",
  csv: "text",
  tsv: "text",
  log: "text",
  json: "text",
  xml: "text",
  yaml: "text",
  yml: "text",
};

export const ACCEPTED_EXTENSIONS = Object.keys(EXTENSIONS).map((e) => `.${e}`);

export function extensionOf(filename: string): string {
  const match = /\.([A-Za-z0-9]+)\s*$/.exec(filename.trim());
  return match ? match[1].toLowerCase() : "";
}

export function detectKind(filename: string, mime?: string | null): DocKind | null {
  const byExtension = EXTENSIONS[extensionOf(filename)];
  if (byExtension) return byExtension;
  const type = (mime || "").toLowerCase().split(";")[0].trim();
  if (type === "application/pdf") return "pdf";
  if (type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    return "docx";
  if (type === "application/msword") return "doc";
  if (type === "text/html") return "html";
  if (type === "application/rtf" || type === "text/rtf") return "rtf";
  if (type.startsWith("text/")) return "text";
  return null;
}

export function cleanHtml(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|table|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function cleanRtf(input: string): string {
  return input
    .replace(/\\par[d]?/gi, "\n")
    .replace(/\\'[0-9a-f]{2}/gi, " ")
    .replace(/\\[a-z]+-?\d* ?/gi, "")
    .replace(/[{}]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

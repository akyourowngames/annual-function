// Convert the model's light Markdown into each channel's native formatting.
// Pure + dependency-free so it is unit-testable under plain `node --test`.
//
// Telegram renders HTML (parse_mode=HTML); WhatsApp uses *bold*/_italic_.
// Without this, families see literal "**bold**" and stray "#" headings.

function escapeHtml(input: string): string {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Pull code spans/blocks out before formatting so their contents are untouched,
// then put them back at the end.
function makeStash() {
  const stash: string[] = [];
  return {
    keep: (html: string) => `\u0000${stash.push(html) - 1}\u0000`,
    restore: (text: string) => text.replace(/\u0000(\d+)\u0000/g, (_m, i) => stash[Number(i)] ?? ""),
  };
}

function protectCode(text: string, stash: ReturnType<typeof makeStash>, fenced: (code: string) => string, inline: (code: string) => string) {
  return text
    .replace(/```[a-zA-Z0-9]*\n?([\s\S]*?)```/g, (_m, code) => stash.keep(fenced(String(code).replace(/\n$/, ""))))
    .replace(/`([^`\n]+)`/g, (_m, code) => stash.keep(inline(String(code))));
}

export function toTelegramHtml(input: string): string {
  const stash = makeStash();
  let text = escapeHtml(input.replace(/\r\n/g, "\n"));
  text = protectCode(text, stash, (c) => `<pre>${c}</pre>`, (c) => `<code>${c}</code>`);
  text = text.replace(/^[ \t]*#{1,6}[ \t]*(.+?)[ \t]*$/gm, "<b>$1</b>"); // headings
  text = text.replace(/\*\*([^*\n]+?)\*\*/g, "<b>$1</b>"); // **bold**
  text = text.replace(/__([^_\n]+?)__/g, "<b>$1</b>"); // __bold__
  text = text.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, "$1<i>$2</i>"); // *italic*
  text = text.replace(/(^|[^_])_([^_\n]+?)_(?!_)/g, "$1<i>$2</i>"); // _italic_
  text = text.replace(/^[ \t]*[-*•][ \t]+/gm, "• "); // bullets
  text = text.replace(/\*\*/g, "").replace(/^[ \t]*#{1,6}[ \t]*/gm, "");
  return stash.restore(text).trim();
}

export function toWhatsappMarkup(input: string): string {
  const stash = makeStash();
  let text = input.replace(/\r\n/g, "\n");
  text = protectCode(text, stash, (c) => "```" + c + "```", (c) => "`" + c + "`");
  text = text.replace(/^[ \t]*#{1,6}[ \t]*(.+?)[ \t]*$/gm, "*$1*"); // headings
  text = text.replace(/\*\*([^*\n]+?)\*\*/g, "*$1*"); // **bold** -> *bold*
  text = text.replace(/__([^_\n]+?)__/g, "*$1*");
  text = text.replace(/^[ \t]*[-*•][ \t]+/gm, "• "); // bullets
  text = text.replace(/\*\*/g, "").replace(/^[ \t]*#{1,6}[ \t]*/gm, "");
  return stash.restore(text).trim();
}

// Plain, unmarked text for fallbacks and channels with no formatting.
export function stripMarkdown(input: string): string {
  const stash = makeStash();
  let text = input.replace(/\r\n/g, "\n");
  text = protectCode(text, stash, (c) => c, (c) => c);
  text = text.replace(/^[ \t]*#{1,6}[ \t]*/gm, "");
  text = text.replace(/\*\*([^*\n]+?)\*\*/g, "$1");
  text = text.replace(/__([^_\n]+?)__/g, "$1");
  text = text.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, "$1$2");
  text = text.replace(/(^|[^_])_([^_\n]+?)_(?!_)/g, "$1$2");
  text = text.replace(/^[ \t]*[-*•][ \t]+/gm, "• ");
  text = text.replace(/\*\*/g, "");
  return stash.restore(text).trim();
}

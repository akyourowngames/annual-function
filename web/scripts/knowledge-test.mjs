import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chunkText, keywords, orTsQuery } from "../lib/server/chunk.ts";
import { detectKind, extensionOf, cleanHtml, cleanRtf } from "../lib/server/file-types.ts";

describe("chunkText", () => {
  it("returns one chunk for short text", () => {
    assert.deepEqual(chunkText("hello world"), ["hello world"]);
  });
  it("returns nothing for blank input", () => {
    assert.deepEqual(chunkText("   \n\n  "), []);
  });
  it("normalizes whitespace", () => {
    assert.deepEqual(chunkText("a\t\t b   c\r\n\r\n\r\n\r\nd"), ["a b c\n\nd"]);
  });
  it("splits long text into overlapping chunks bounded by size", () => {
    const sentence = "The annual function will begin at five in the evening. ";
    const text = sentence.repeat(120);
    const chunks = chunkText(text, 1000, 150);
    assert.ok(chunks.length > 3, `expected several chunks, got ${chunks.length}`);
    for (const c of chunks) assert.ok(c.length <= 1000, `chunk too long: ${c.length}`);
    assert.ok(chunks.join(" ").includes("begin at five"));
  });
});

describe("retrieval query building", () => {
  it("extracts significant keywords and drops short filler words", () => {
    assert.deepEqual(keywords("Where is the backup generator?"), ["where", "the", "backup", "generator"]);
    assert.deepEqual(keywords("a ab abc abcd"), ["abc", "abcd"]);
  });
  it("builds an OR tsquery so natural questions match on any keyword", () => {
    assert.equal(orTsQuery("Where is the backup generator?"), "where | the | backup | generator");
  });
  it("returns an empty tsquery for questions with no significant words", () => {
    assert.equal(orTsQuery("a b c"), "");
  });
});

describe("file type detection", () => {
  it("detects by extension, case-insensitively", () => {
    assert.equal(extensionOf("Program v2.PDF"), "pdf");
    assert.equal(detectKind("Program.PDF"), "pdf");
    assert.equal(detectKind("notes.docx"), "docx");
    assert.equal(detectKind("old.doc"), "doc");
    assert.equal(detectKind("page.html"), "html");
    assert.equal(detectKind("page.htm"), "html");
    assert.equal(detectKind("info.rtf"), "rtf");
    assert.equal(detectKind("data.csv"), "text");
    assert.equal(detectKind("data.json"), "text");
    assert.equal(detectKind("readme.md"), "text");
  });
  it("falls back to the mime type", () => {
    assert.equal(detectKind("upload", "application/pdf"), "pdf");
    assert.equal(
      detectKind("upload", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
      "docx",
    );
    assert.equal(detectKind("upload", "application/msword"), "doc");
    assert.equal(detectKind("upload", "text/plain; charset=utf-8"), "text");
  });
  it("rejects unsupported types", () => {
    assert.equal(detectKind("photo.png", "image/png"), null);
    assert.equal(detectKind("movie.mp4"), null);
  });
  it("cleans html into readable text", () => {
    const out = cleanHtml("<h1>Hello</h1><script>evil()</script><p>World &amp; all</p>");
    assert.match(out, /Hello/);
    assert.match(out, /World & all/);
    assert.doesNotMatch(out, /evil|[<>]/);
  });
  it("strips rtf control words", () => {
    assert.match(cleanRtf("{\\rtf1\\ansi Hello \\b world\\b0}"), /Hello\s+world/);
  });
});

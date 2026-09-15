import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isSupportedImageMime,
  photoExtension,
  photoPath,
  sanitizeCaption,
} from "../lib/server/photo-utils.ts";
import { parseTelegramMedia } from "../lib/server/telegram/handler.ts";

describe("photo helpers", () => {
  it("accepts only supported image types", () => {
    assert.equal(isSupportedImageMime("image/jpeg"), true);
    assert.equal(isSupportedImageMime("image/png; charset=binary"), true);
    assert.equal(isSupportedImageMime("application/pdf"), false);
    assert.equal(isSupportedImageMime("video/mp4"), false);
  });
  it("maps mime to a file extension", () => {
    assert.equal(photoExtension("image/png"), "png");
    assert.equal(photoExtension("image/webp"), "webp");
    assert.equal(photoExtension("image/heic"), "heic");
    assert.equal(photoExtension("image/jpeg"), "jpg");
    assert.equal(photoExtension(""), "jpg");
  });
  it("builds a date-partitioned storage path", () => {
    assert.equal(
      photoPath("telegram", "abc", "jpg", new Date("2026-09-15T10:00:00Z")),
      "telegram/2026-09/abc.jpg",
    );
    assert.equal(
      photoPath("we ird!", "x", "png", new Date("2026-01-02T00:00:00Z")),
      "weird/2026-01/x.png",
    );
  });
  it("sanitizes captions", () => {
    assert.equal(sanitizeCaption("  hello   world \n"), "hello world");
    assert.equal(sanitizeCaption(""), null);
    assert.equal(sanitizeCaption(undefined), null);
    assert.equal(sanitizeCaption("x".repeat(400)).length, 300);
  });
});

describe("telegram media parsing", () => {
  const chat = { id: 424242 };
  it("reads the largest photo", () => {
    const r = parseTelegramMedia({
      message: { chat, caption: " stage lights ", photo: [{ file_id: "a" }, { file_id: "b" }] },
    });
    assert.deepEqual(r, { chatId: "424242", fileId: "b", caption: " stage lights ", mime: "image/jpeg" });
  });
  it("reads image documents", () => {
    const r = parseTelegramMedia({ message: { chat, document: { file_id: "d", mime_type: "image/png" } } });
    assert.equal(r?.mime, "image/png");
    assert.equal(r?.fileId, "d");
  });
  it("ignores non-image documents, stickers, and empty updates", () => {
    assert.equal(
      parseTelegramMedia({ message: { chat, document: { file_id: "d", mime_type: "application/pdf" } } }),
      null,
    );
    assert.equal(parseTelegramMedia({ message: { chat, sticker: { file_id: "s" } } }), null);
    assert.equal(parseTelegramMedia({}), null);
  });
  it("does not treat a text message as media", () => {
    assert.equal(parseTelegramMedia({ message: { chat, text: "hi" } }), null);
  });
});

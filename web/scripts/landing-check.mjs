import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "@playwright/test";
const base =
  process.argv[2] || process.env.TEST_BASE_URL || "http://127.0.0.1:3000";
fs.mkdirSync("artifacts", { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors = [];
async function revealAll(page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += 600) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 85));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(850);
}
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base, { waitUntil: "networkidle", timeout: 90000 });
  await page.getByRole("heading", { level: 1 }).waitFor();
  await page.getByText("19 Dec 2026", { exact: true }).first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  const hero = page.locator(".theatre-art");
  await hero.evaluate((img) => img.decode());
  await page.screenshot({ path: "artifacts/landing-desktop-hero.png" });
  await revealAll(page);
  await page.screenshot({
    path: "artifacts/landing-desktop-full.png",
    fullPage: true,
  });
  assert.equal(
    await page
      .getByRole("button", { name: "Turn surprise sounds on" })
      .getAttribute("aria-pressed"),
    "false",
  );
  await page.getByRole("button", { name: "Turn surprise sounds on" }).click();
  await page.getByRole("button", { name: "Turn surprise sounds off" }).click();
  for (const n of ["first", "second", "third"])
    await page
      .getByRole("button", { name: `Discover the ${n} hidden star` })
      .click();
  await page
    .getByRole("status")
    .getByText(/All three stars/)
    .waitFor();
  assert.match(await page.locator(".star-counter").innerText(), /3 of 3/);
  await page
    .getByRole("button", { name: "Discover the third hidden star" })
    .click();
  assert.match(await page.locator(".star-counter").innerText(), /3 of 3/);
  const programme = page.locator(".programme-item").nth(1);
  await programme.getByRole("button").click();
  assert.equal(
    await programme.getByRole("button").getAttribute("aria-expanded"),
    "true",
  );
  assert.equal(await programme.locator(".programme-reveal").isVisible(), true);
  await page.getByText("What should we wear?", { exact: true }).click();
  await page
    .locator(".play-faq[open]")
    .getByText("Formal / Ethnic", { exact: true })
    .waitFor();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Add to my calendar" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  assert.match(
    fs.readFileSync(path, "utf8"),
    /DTSTART;TZID=Asia\/Kolkata:20261219T170000/,
  );
  assert.equal(
    (await page.request.put(base + "/api/landing", { data: {} })).status(),
    401,
  );
  console.log(
    "PASS desktop: event data, demo guests, star hunt, optional sound, programme, FAQ, calendar, protected editor",
  );
  for (const width of [390, 320, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(base, { waitUntil: "networkidle" });
    await revealAll(page);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      `Overflow at ${width}px`,
    );
    if (width === 390) {
      await page.screenshot({
        path: "artifacts/landing-mobile-full.png",
        fullPage: true,
      });
      await page.screenshot({ path: "artifacts/landing-mobile-hero.png" });
      await page
        .getByRole("button", { name: "Open menu", exact: true })
        .click();
      await page
        .getByRole("navigation", { name: "Mobile landing navigation" })
        .getByRole("link", { name: "Our guests" })
        .click();
      assert.equal(
        await page
          .getByRole("navigation", { name: "Mobile landing navigation" })
          .count(),
        0,
      );
      const deck = page.locator(".feeling-grid");
      assert.ok(
        await deck.evaluate((el) => el.scrollWidth > el.clientWidth),
        "Mobile cards are swipeable",
      );
      await page.locator(".mobile-invitation-dock").getByRole("link").click();
      await page
        .getByRole("textbox", { name: "Invitation code", exact: true })
        .waitFor();
      assert.match(page.url(), /\/portal$/);
    }
    console.log(`PASS ${width}px responsive layout`);
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(base, { waitUntil: "networkidle" });
  assert.equal(await page.locator(".reveal-ready:not(.revealed)").count(), 0);
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    "PASS reduced motion and no browser runtime errors. Landing checks complete.",
  );
} finally {
  await browser.close();
}

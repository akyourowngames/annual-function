// Verify rendered pages from the running dev server.
const BASE = "http://localhost:3000";
let failures = 0;
async function page(path, mustContain) {
  const res = await fetch(BASE + path);
  const html = await res.text();
  const ok = res.status === 200 && mustContain.every((s) => html.includes(s));
  console.log(ok ? `PASS  GET ${path}` : `FAIL  GET ${path} (${res.status})`);
  if (!ok) {
    failures++;
    for (const s of mustContain) {
      if (!html.includes(s)) console.log(`      missing: "${s}"`);
    }
  }
}

await page("/", [
  "ANNUAL FUNCTION 2026",
  "Invitation Code",
  "View Invitation",
]);
await page("/admin", ["Admin"]);

console.log(failures === 0 ? "PAGES OK" : `${failures} PAGE FAILURES`);
process.exit(failures === 0 ? 0 : 1);

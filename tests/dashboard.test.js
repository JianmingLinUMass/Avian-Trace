import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

test("dashboard imports without a browser and its page dependencies resolve", async () => {
  assert.equal(typeof (await import("../frontend/dashboard/dashboard.js")).mountDashboard, "function");
  const html = await readFile(new URL("../frontend/dashboard.html", import.meta.url), "utf8");
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (!match[1].includes(":")) await stat(new URL("../frontend/" + match[1], import.meta.url));
  }
  assert.ok(html.includes('src="pages/dashboard.js"'));
});

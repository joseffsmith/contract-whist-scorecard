// One-off export of the old InstantDB data for POST /admin/import.
// Not imported by anything; delete it after the cutover.
//
// The InstantDB app is publicly readable, so no admin token is needed. This
// runs the real client query in a headless browser, which needs Playwright and
// a Chromium that are NOT dependencies of this repo. Install them somewhere
// (e.g. `npm i --no-save playwright`, or use a Chromium you already have) and:
//
//   CHROMIUM_PATH=/usr/bin/chromium node server/scripts/export-instant.mjs out.json
//
// Then send the file to the new server (IMPORT_TOKEN set, database empty):
//
//   curl -X POST -H "x-import-token: $IMPORT_TOKEN" \
//     -H "content-type: application/json" --data-binary @out.json \
//     https://joseffsmith.uk/contract-whist/api/admin/import

import fs from "node:fs";
import { chromium } from "playwright";

const OUT = process.argv[2];
if (!OUT) {
  console.error("Usage: node export-instant.mjs <out.json>");
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const page = await browser.newPage();
await page.goto("https://joseffsmith.uk/contract-whist/");

const data = await page.evaluate(async () => {
  const { init } = await import(
    "https://cdn.jsdelivr.net/npm/@instantdb/core@1.0.14/+esm"
  );
  const db = init({ appId: "33fdf866-9fcb-4721-a84d-ca1dba1f0ab0" });
  return await new Promise((resolve) =>
    db.subscribeQuery(
      {
        players: {},
        games: {
          playersOrders: { player: {} },
          rounds: { turns: { player: {} } },
        },
      },
      (result) => {
        if (result.error) resolve({ error: String(result.error.message) });
        else if (result.data) resolve(result.data);
      }
    )
  );
});
await browser.close();

if (data.error) {
  console.error("Export failed:", data.error);
  process.exit(1);
}

fs.writeFileSync(OUT, JSON.stringify(data));

const games = data.games ?? [];
const sum = (f) => games.reduce((n, g) => n + f(g), 0);
console.log(`Wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
console.log(`  players: ${data.players?.length ?? 0}`);
console.log(
  `  games:   ${games.length} (${
    games.filter((g) => g.deletedAt).length
  } deleted)`
);
console.log(`  seats:   ${sum((g) => g.playersOrders?.length ?? 0)}`);
console.log(`  rounds:  ${sum((g) => g.rounds?.length ?? 0)}`);
console.log(
  `  turns:   ${sum((g) =>
    (g.rounds ?? []).reduce((n, r) => n + (r.turns?.length ?? 0), 0)
  )}`
);

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(path, "utf8");

test("package uses exact, dependency-free scripts", async () => {
  const pkg = JSON.parse(await read("package.json"));
  assert.equal(pkg.packageManager, undefined);
  assert.deepEqual(Object.keys(pkg.dependencies ?? {}), []);
  assert.deepEqual(Object.keys(pkg.devDependencies ?? {}), []);
  assert.match(pkg.scripts.build, /^node /);
});

test("production entrypoint references local app assets", async () => {
  const html = await read("index.html");
  assert.match(html, /src\/styles\.css/);
  assert.match(html, /src\/app\.js/);
  assert.match(html, /vendor\/d3\.v7\.min\.js/);
  assert.match(html, /vendor\/topojson-client\.min\.js/);
  assert.doesNotMatch(html, /<x-dc|data-dc-script|support\.js/);
});

test("snapshot data has renderable articles", async () => {
  const global = JSON.parse(await read("data/snapshot-global.json"));
  const countries = JSON.parse(await read("data/snapshot-countries.json"));
  const daily = JSON.parse(await read("data/snapshot-daily.json"));
  assert.ok(global.articles.length >= 20);
  assert.ok(global.articles[0].article);
  assert.ok(global.articles[0].views > 0);
  assert.ok(Object.keys(countries.countries).length >= 10);
  assert.ok(Object.keys(daily.series).length >= 5);
});

test("cloudflare config targets dist assets", async () => {
  const wrangler = await read("wrangler.toml");
  assert.match(wrangler, /directory = "\.\/dist"/);
  assert.match(wrangler, /not_found_handling = "single-page-application"/);
});

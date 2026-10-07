const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./history.js");

const header = "date,strategy,signal,filled,gross_return_pct,cost_pct";
const rows = Array.from({ length: 27 }, (_, i) => {
  const date = `2026-01-${String(i + 1).padStart(2, "0")}`;
  return ["打板", "波段", "趋势"].map((strategy, j) => `${date},${strategy},1,${i % 5 === 0 && j === 0 ? 0 : 1},${i % 5 === 0 && j === 0 ? 0 : (i + j) % 3 === 0 ? -4 : 7},${i % 5 === 0 && j === 0 ? 0 : .1}`).join("\n");
});
const sample = `${header}\n${rows.join("\n")}`;
const settings = {
  totalMax: 1, fixed: [.2, .2, .2], uncertainty: [.05, .05, .05],
  strategies: Array.from({ length: 3 }, () => ({ max: .5 })),
  execution: { fill: 1, entrySlip: 0, exitBlock: 0, gapLoss: 0, rebalanceCost: .001, hold: [1, 2, 3] }
};

test("CSV parser groups dates, subtracts costs, and retains unfilled opportunities", () => {
  const data = H.parse(`\uFEFF${header}\r\n2026-01-01,"打板",1,0,0,0\r\n2026-01-01,波段,1,1,10,0.1\r\n`);
  assert.equal(data.days.length, 1);
  assert.deepEqual(data.days[0].returns, [0, .099, 0]);
  assert.equal(data.stats[0].signals, 1);
  assert.equal(data.stats[0].fills, 0);
  assert.equal(data.stats[1].meanCost, .001);
  const carried = H.parse(`${header},held\n2026-01-01,波段,0,0,4,0.1,1`);
  assert.equal(carried.days[0].returns[1], .039);
  assert.equal(carried.stats[1].fills, 0);
  assert.equal(carried.stats[1].active, 1);
  assert.throws(() => H.parse(`${header}\n2026-01-01,打板,0,1,10,0`), /成交须先有信号/);
  assert.throws(() => H.parse(`${header}\n2026-01-01,打板,1,0,10,0`), /未成交/);
  assert.throws(() => H.parse(`${header}\n2026-01-01,打板,1,1,10,0\n2026-01-01,打板,1,1,10,0`), /重复/);
});

test("walk-forward sizes each day from prior dates only", () => {
  const data = H.parse(sample), baseline = H.walkForward(data, settings, 10000, 20, 20);
  assert.equal(baseline.trades, 7);
  assert.equal(baseline.results[0].example.length, 8);
  const changed = H.parse(sample.replace("2026-01-27,趋势,1,1,7,0.1", "2026-01-27,趋势,1,1,-50,0.1"));
  const rerun = H.walkForward(changed, settings, 10000, 20, 20);
  for (let policy = 0; policy < 3; policy++) {
    assert.deepEqual(baseline.results[policy].example.slice(0, -1), rerun.results[policy].example.slice(0, -1));
    assert.deepEqual(baseline.results[policy].example.at(-1).weights, rerun.results[policy].example.at(-1).weights);
  }
  assert.throws(() => H.walkForward(H.parse(`${header}\n2026-01-01,打板,1,1,10,0`), settings, 10000), /至少需要/);
});

test("historical bankruptcy stays at zero with no later positions", () => {
  const changed = sample.replace("2026-01-21,打板,1,0,0,0", "2026-01-21,打板,1,1,-100,0");
  const noOtherAssets = { ...settings, fixed: [1, 0, 0], strategies: settings.strategies.map((strategy, i) => ({ ...strategy, max: i ? 0 : 1 })) };
  const result = H.walkForward(H.parse(changed), noOtherAssets, 10000, 20, 20).results[0];
  assert.equal(result.wealth, 0);
  assert.deepEqual(result.example.slice(2).map(point => point.weights), Array(6).fill([0, 0, 0]));
});

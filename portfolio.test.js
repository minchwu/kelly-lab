const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("./sim.js");
const P = require("./portfolio.js");

const config = {
  mode: "market", kellyMethod: "robust", trades: 12, runs: 5, seed: 2047, initial: 10000,
  cap: .05, superMultiplier: 1.25, cost: .001, slippage: .005, trailCoverage: .3,
  tightStop: .03, variation: .1, tailProbability: .02, tailLoss: .6, winRateMargin: .05,
  signalAccuracy: .7, states: [
    { p: .6, win: .1, loss: .055, stay: .65 },
    { p: .42, win: .08, loss: .065, stay: .78 },
    { p: .32, win: .06, loss: .08, stay: .9 }
  ]
};
const settings = {
  totalMax: .8, ambiguity: .15, fixed: [.1, .2, .2], strategies: [
    { p: [.6, .42, .32], win: [.1, .08, .06], loss: [.055, .065, .08], tailLoss: .6, max: .4 },
    { p: [.62, .52, .4], win: [.07, .07, .07], loss: [.05, .05, .05], tailLoss: .35, max: .4 },
    { p: [.58, .5, .38], win: [.1, .1, .1], loss: [.065, .065, .065], tailLoss: .25, max: .4 }
  ]
};

test("joint Kelly weights obey individual and total limits", () => {
  for (const probabilities of [[1, 0, 0], [.2, .3, .5], [0, 0, 1]]) {
    for (const robust of [false, true]) {
      const weights = P.optimize(config, settings, probabilities, robust);
      assert.ok(weights.every((w, i) => w >= 0 && w <= settings.strategies[i].max + 1e-10));
      assert.ok(weights.reduce((a, b) => a + b, 0) <= settings.totalMax + 1e-10);
      const rows = P.scenarios(config, settings, probabilities);
      assert.ok(P.growth(weights, rows) >= P.growth([0, 0, 0], rows) - .02);
    }
  }
});

test("portfolio paths are reproducible and allocation changes do not resample returns", () => {
  const a = P.simulate(config, settings), b = P.simulate(config, settings);
  assert.deepEqual(a, b);
  const changed = P.simulate(config, { ...settings, fixed: [.2, .2, .2] });
  assert.notDeepEqual(a.results[0].finals, changed.results[0].finals);
  assert.deepEqual(a.results[1].finals, changed.results[1].finals);
  assert.equal(a.results[0].example.length, config.trades + 1);
  assert.equal(a.results[0].finals.length, config.runs);
});

test("signal accuracy changes beliefs but leaves the hidden market returns unchanged", () => {
  const low = S.generate({ ...config, signalAccuracy: .4 });
  const high = S.generate({ ...config, signalAccuracy: .9 });
  assert.deepEqual(low.map(path => path.events.map(e => [e.state, e.r, e.tail])), high.map(path => path.events.map(e => [e.state, e.r, e.tail])));
  assert.notDeepEqual(low[0].events.map(e => e.probabilities), high[0].events.map(e => e.probabilities));
});

test("strategy-specific downside ranges reduce scenario growth without changing center inputs", () => {
  const uncertain = { ...settings, uncertainty: [.1, .08, .06], execution: { fill: .7, entrySlip: .005, exitBlock: .2, gapLoss: .05, hold: [1, 3, 5], rebalanceCost: .001 } };
  const center = P.scenarios(config, uncertain, [.5, .3, .2]);
  const adverse = P.scenarios(config, uncertain, P.stressProbabilities([.5, .3, .2], uncertain.ambiguity), true);
  const weights = [.3, .2, .2];
  assert.ok(P.growth(weights, adverse) < P.growth(weights, center));
  assert.ok(Math.abs(center.reduce((sum, row) => sum + row.chance, 0) - 1) < 1e-10);
  assert.ok(Math.abs(adverse.reduce((sum, row) => sum + row.chance, 0) - 1) < 1e-10);
});

test("an unfilled board order stays in cash and held positions pay rebalance cost", () => {
  const model = { ...settings, execution: { fill: 0, entrySlip: 0, exitBlock: 0, gapLoss: 0, rebalanceCost: .01, hold: [1, 3, 1] } };
  const account = { holdings: [0, 0, 0], remaining: [0, 0, 0] };
  const first = P.applyTarget(account, [.2, .3, 0], model, false, [-.1, 0, 0]);
  assert.equal(first.weights[0], 0);
  assert.ok(Math.abs(first.turnoverCost - .003) < 1e-10);
  assert.ok(Math.abs(first.wealthFactor - .997) < 1e-10);
  assert.equal(account.remaining[1], 2);
  const second = P.applyTarget(account, [0, 0, .3], model, false, [0, 0, 0]);
  assert.ok(second.weights[1] > .29);
  assert.equal(account.remaining[1], 1);
});

test("a ruined portfolio stops trading and keeps zero allocation", () => {
  const doomed = P.simulate(
    { ...config, trades: 3, runs: 1, cost: 0, tailProbability: 1, tailLoss: 1 },
    { ...settings, totalMax: 1, fixed: [1, 0, 0], strategies: settings.strategies.map((strategy, i) => ({ ...strategy, max: 1, tailLoss: i ? strategy.tailLoss : 1 })), execution: { fill: 1, entrySlip: 0, exitBlock: 0, gapLoss: 0, rebalanceCost: 0, hold: [1, 1, 1] } }
  );
  const fixed = doomed.results[0];
  assert.equal(fixed.finals[0], 0);
  assert.equal(fixed.attempts, 1);
  assert.deepEqual(fixed.example.slice(2).map(point => point.weights), [[0, 0, 0], [0, 0, 0]]);
});

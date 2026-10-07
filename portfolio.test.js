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

const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("./sim.js");

const base = {
  mode: "basic", p: .6, win: .15, stop: .1, trades: 8, initial: 1000, runs: 20,
  seed: 42, cap: .05, superMultiplier: 1.5, cost: .002, slippage: .02,
  trailCoverage: .3, tightStop: .03, variation: .2
};
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

test("Kelly reference uses capital returns and distinguishes allocation from account risk", () => {
  const config = { ...base, cost: 0, slippage: 0, trailCoverage: 0, variation: 0 };
  const ref = S.reference(config);
  close(ref.allocation, 10 / 3);
  close(ref.risk, 1 / 3);
  close(ref.b, 1.5);
  assert.equal(S.kelly(.4, .1, .1), 0);
});

test("full capital allocation loses ten percent on a ten percent stock loss", () => {
  const config = { ...base, cap: .5, cost: 0, slippage: 0, trailCoverage: 0, variation: 0 };
  const events = [{ r: -.1, estimated: S.reference(config).allocation, estimatedLoss: .1, state: 1 }];
  const result = S.evaluate(config, [{ events }]);
  const allin = result.strategies.find(r => r.id === "allin");
  close(allin.finals[0], 900);
  assert.equal(allin.ruinRate, 0);
  assert.equal(allin.example[1].f, 1);
  close(allin.example[1].risk, .1);
});

test("planned risk cap sizes allocation while fixed risk one percent uses stop distance", () => {
  const config = { ...base, cost: 0, slippage: 0, trailCoverage: 0, variation: 0 };
  const event = { r: .15, estimated: S.reference(config).allocation, estimatedLoss: .1, state: 1 };
  const result = S.evaluate(config, [{ events: [event] }]);
  close(result.strategies.find(r => r.id === "fixed").example[1].f, .1);
  close(result.strategies.find(r => r.id === "full").example[1].f, .5);
  close(result.strategies.find(r => r.id === "allin").example[1].f, 1);
});

test("tightened stop limits covered losing trades, with execution slippage added afterward", () => {
  const noSlip = { ...base, cost: 0, slippage: 0, variation: 0 };
  close(S.drawOutcome({ ...noSlip, trailCoverage: 0 }, { loss: .1 }, false, () => 0), -.1);
  close(S.drawOutcome({ ...noSlip, trailCoverage: 1 }, { loss: .1 }, false, () => 0), -.03);
  close(S.drawOutcome({ ...noSlip, trailCoverage: 0, slippage: .02 }, { loss: .1 }, false, () => .5), -.11);
});

test("same seed produces the same net stock returns when position limits change", () => {
  const first = S.generate(base), second = S.generate({ ...base, cap: .2 });
  assert.deepEqual(first, second);
  const low = S.evaluate(base, first), high = S.evaluate({ ...base, cap: .2 }, first);
  assert.notEqual(low.strategies.find(r => r.id === "full").q50, high.strategies.find(r => r.id === "full").q50);
});

test("posterior mean sets size while each path draws one possible true win rate", () => {
  const config = { ...base, mode: "estimate", history: 0, wins: 0 };
  const ref = S.reference(config), paths = S.generate(config);
  assert.equal(ref.p, .5);
  close(ref.posterior.low, .025);
  close(ref.posterior.high, .975);
  assert.equal(new Set(paths[0].events.map(e => e.estimated)).size, 1);
  assert.notEqual(paths[0].trueP, paths[1].trueP);
  close(paths[0].events[0].estimated, ref.allocation);
});

test("market state changes use only observed state inputs for allocation", () => {
  const config = { ...base, mode: "market", states: [
    { p: .75, win: .18, loss: .08, stay: 0 },
    { p: .6, win: .15, loss: .1, stay: 0 },
    { p: .35, win: .08, loss: .12, stay: 0 }
  ] };
  const path = S.generate({ ...config, runs: 1 })[0];
  assert.equal(path.events[0].state, 1);
  for (const event of path.events) close(event.estimated, S.reference(config, event.state).allocation);
});

test("zero trades preserve funds and produce an empty growth sample", () => {
  const result = S.simulate({ ...base, trades: 0 });
  for (const r of result.strategies) { assert.equal(r.q50, base.initial); assert.equal(r.dd95, 0); assert.equal(r.ruinRate, 0); }
  assert.equal(result.growth.sampleCount, 0);
});

test("only a total stock loss can ruin an unlevered full allocation", () => {
  const config = { ...base, cap: .5 };
  const estimated = S.reference(config).allocation, estimatedLoss = S.reference(config).loss;
  const events = [{ r: -1, estimated, estimatedLoss, state: 1 }, { r: .15, estimated, estimatedLoss, state: 1 }];
  const result = S.evaluate(config, [{ events }]);
  const allin = result.strategies.find(r => r.id === "allin");
  assert.equal(allin.finals[0], 0);
  assert.equal(allin.example[2].f, 0);
  assert.equal(allin.example[2].r, null);
});

test("growth sweep comes from realized net stock returns", () => {
  const data = S.growthCurve([.15, -.1]);
  close(data.values[0].growth, 0);
  close(data.values[50].growth, (Math.log(1.15) + Math.log(.9)) / 2);
  assert.equal(data.best.allocation, 1);
});

test("streaming and stored scenarios agree for all seven strategies", () => {
  const streamed = S.simulate(base), stored = S.evaluate(base, S.generate(base));
  assert.equal(streamed.strategies.length, 7);
  for (let i = 0; i < 7; i++) assert.deepEqual(streamed.strategies[i].finals, stored.strategies[i].finals);
  assert.deepEqual(streamed.growth, stored.growth);
});

test("long paths remain bounded in memory and heatmap probabilities remain valid", () => {
  const config = { ...base, trades: 10000, runs: 20 };
  const result = S.simulate(config);
  assert.equal(result.strategies[0].example.length, 10001);
  assert.equal(result.strategies[0].finals.length, 20);
  const heat = S.sensitivity({ ...base, trades: 300 }, "drawdown");
  assert.ok(heat.cells.flat().every(x => Number.isFinite(x) && x >= 0 && x <= 1));
});

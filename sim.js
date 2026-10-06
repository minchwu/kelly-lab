(function (root) {
  "use strict";
  const { rng, beta, betaQuantile } = root.KellyRandom || require("./random.js");
  const clamp = (x, low, high) => Math.min(high, Math.max(low, x));
  function kelly(p, gain, loss) {
    return gain <= 0 || loss <= 0 ? 0 : Math.max(0, (p * gain - (1 - p) * loss) / (gain * loss));
  }
  function quantile(values, q) {
    if (!values.length) return NaN;
    const sorted = [...values].sort((a, b) => a - b), index = (sorted.length - 1) * q, i = Math.floor(index);
    return sorted[i] + (sorted[Math.min(i + 1, sorted.length - 1)] - sorted[i]) * (index - i);
  }
  const strategies = [
    { id: "fixed", name: "固定风险 1%", factor: null, color: "#246b9b", dash: [] },
    { id: "eighth", name: "1/8 凯利", factor: .125, color: "#57a6bd", dash: [3, 4] },
    { id: "quarter", name: "1/4 凯利", factor: .25, color: "#147d69", dash: [9, 4] },
    { id: "half", name: "半凯利", factor: .5, color: "#b67500", dash: [11, 3, 2, 3] },
    { id: "full", name: "全凯利", factor: 1, color: "#c33e3e", dash: [] },
    { id: "super", name: "超凯利", factor: "super", color: "#8a4bb0", dash: [6, 3] },
    { id: "allin", name: "100% 满仓", factor: "allin", color: "#253644", dash: [2, 3] }
  ];
  // Deterministic midpoint quadrature mirrors drawOutcome's bounded variation,
  // tightened-stop mixture, slippage and cost; no future outcome enters sizing.
  function outcomeGrid(config, state) {
    const wins = [], losses = [], n = 9, slipSteps = 5;
    for (let i = 0; i < n; i++) {
      const variation = 1 + (2 * (i + .5) / n - 1) * config.variation;
      wins.push({ r: Math.max(-1, state.win * variation - config.cost), weight: 1 / n });
      for (let j = 0; j < slipSteps; j++) {
        const slip = (j + .5) / slipSteps * config.slippage;
        losses.push({ r: -Math.min(1, state.loss * variation + slip + config.cost), weight: (1 - config.trailCoverage) / (n * slipSteps) });
        for (let k = 0; k < n; k++) {
          const tightVariation = 1 + (2 * (k + .5) / n - 1) * config.variation;
          const tight = Math.min(state.loss * variation, config.tightStop * tightVariation);
          losses.push({ r: -Math.min(1, tight + slip + config.cost), weight: config.trailCoverage / (n * n * slipSteps) });
        }
      }
    }
    return { wins, losses };
  }
  function practicalKelly(p, grid) {
    const derivative = amount => p * grid.wins.reduce((sum, x) => sum + x.weight * x.r / (1 + amount * x.r), 0) + (1 - p) * grid.losses.reduce((sum, x) => sum + x.weight * x.r / (1 + amount * x.r), 0);
    if (derivative(0) <= 0) return 0;
    if (derivative(1 - 1e-12) >= 0) return 1;
    let lo = 0, hi = 1;
    for (let i = 0; i < 42; i++) { const mid = (lo + hi) / 2; if (derivative(mid) > 0) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }
  function stateParams(config, stateIndex = 1) {
    return config.mode === "market" ? config.states[stateIndex] : { p: config.p, win: config.win, loss: config.stop };
  }
  function reference(config, stateIndex = 1) {
    const state = stateParams(config, stateIndex);
    let p = state.p, posterior;
    if (config.mode === "estimate") {
      const a = config.wins + 1, b = config.history - config.wins + 1;
      p = a / (a + b);
      posterior = { a, b, low: betaQuantile(.025, a, b), high: betaQuantile(.975, a, b) };
    }
    const tight = Math.min(state.loss, config.tightStop);
    const gain = state.win - config.cost;
    const loss = state.loss * (1 - config.trailCoverage) + tight * config.trailCoverage + config.slippage / 2 + config.cost;
    const allocation = kelly(p, gain, loss);
    const practical = practicalKelly(p, outcomeGrid(config, state));
    const selected = config.kellyMethod === "twoPoint" ? allocation : practical;
    return { p, gain, loss, b: gain > 0 ? gain / loss : 0, allocation, practical, selected, risk: allocation * loss, posterior };
  }
  function maxLoss(config) {
    const states = config.mode === "market" ? config.states : [stateParams(config)];
    return Math.min(1, Math.max(...states.map(s => s.loss * (1 + config.variation) + config.slippage + config.cost)));
  }
  function drawOutcome(config, state, won, random) {
    const variation = 1 + (2 * random() - 1) * config.variation;
    if (won) return Math.max(-1, state.win * variation - config.cost);
    let loss = state.loss * variation;
    if (random() < config.trailCoverage) {
      const tightened = config.tightStop * (1 + (2 * random() - 1) * config.variation);
      loss = Math.min(loss, tightened);
    }
    return -Math.min(1, loss + random() * config.slippage + config.cost);
  }
  function* scenarioIterator(config) {
    const random = rng(config.seed), refs = config.mode === "market" ? [0, 1, 2].map(i => reference(config, i)) : [reference(config)];
    for (let run = 0; run < config.runs; run++) {
      const trueP = config.mode === "estimate" ? beta(refs[0].posterior.a, refs[0].posterior.b, random) : config.p;
      let marketState = 1;
      const events = [];
      for (let i = 0; i < config.trades; i++) {
        const state = stateParams(config, marketState), estimate = refs[config.mode === "market" ? marketState : 0];
        const won = random() < (config.mode === "market" ? state.p : trueP);
        events.push({ r: drawOutcome(config, state, won, random), won, state: marketState, estimated: estimate.selected, estimatedLoss: estimate.loss });
        if (config.mode === "market" && random() > state.stay) {
          const other = [0, 1, 2].filter(x => x !== marketState);
          marketState = other[random() < .5 ? 0 : 1];
        }
      }
      yield { events, trueP };
    }
  }
  function generate(config) { return [...scenarioIterator(config)]; }
  function allocation(strategy, event, config) {
    if (strategy.id === "allin") return 1;
    const expectedLoss = event.estimatedLoss;
    const cap = Math.min(1, config.cap / expectedLoss);
    if (strategy.id === "fixed") return Math.min(cap, .01 / expectedLoss);
    const factor = strategy.id === "super" ? config.superMultiplier : strategy.factor;
    return Math.min(cap, factor * event.estimated);
  }
  function growthCurve(samples) {
    const values = [];
    for (let i = 0; i <= 50; i++) {
      const allocation = i / 50;
      let total = 0;
      for (const r of samples) {
        const multiplier = 1 + allocation * r;
        if (multiplier <= 0) { total = -Infinity; break; }
        total += Math.log(multiplier);
      }
      values.push({ allocation, growth: samples.length ? total / samples.length : 0 });
    }
    const best = values.reduce((a, b) => b.growth > a.growth ? b : a, values[0]);
    return { values, best, sampleCount: samples.length };
  }
  function finalHistogram(finals, initial, bins = 20) {
    const positive = finals.filter(x => x > 0 && Number.isFinite(x));
    const logs = positive.map(x => Math.log(x / initial)).sort((a, b) => a - b);
    const zero = finals.length - positive.length;
    if (!logs.length) return { bars: [], smooth: [], zero, leftTail: 0, rightTail: 0, total: finals.length, lo: 0, hi: 0 };
    let lo = quantile(logs, .01), hi = quantile(logs, .99);
    if (hi - lo < .02) { const center = (hi + lo) / 2; lo = center - .1; hi = center + .1; }
    const counts = Array(bins).fill(0);
    let leftTail = 0, rightTail = 0;
    for (const x of logs) {
      if (x < lo) leftTail++;
      else if (x > hi) rightTail++;
      else counts[Math.min(bins - 1, Math.floor((x - lo) / (hi - lo) * bins))]++;
    }
    const bars = counts.map((count, i) => ({ x: lo + (i + .5) / bins * (hi - lo), probability: count / finals.length, count }));
    const smooth = bars.map((bar, i) => {
      let weighted = 0, weights = 0;
      for (let j = 0; j < bins; j++) { const weight = Math.exp(-.5 * ((i - j) / 1.15) ** 2); weighted += bars[j].probability * weight; weights += weight; }
      return { x: bar.x, probability: weighted / weights };
    });
    const mean = logs.reduce((sum, x) => sum + x, 0) / logs.length;
    const variance = logs.reduce((sum, x) => sum + (x - mean) ** 2, 0) / logs.length;
    const sigma = Math.sqrt(variance), binWidth = (hi - lo) / bins;
    const lognormal = logs.length >= 5 && sigma > 1e-8 ? Array.from({ length: bins * 4 + 1 }, (_, i) => {
      const x = lo + i / (bins * 4) * (hi - lo), z = (x - mean) / sigma;
      return { x, probability: Math.exp(-z * z / 2) / (sigma * Math.sqrt(2 * Math.PI)) * binWidth * positive.length / finals.length };
    }) : [];
    return { bars, smooth, lognormal, zero, leftTail, rightTail, total: finals.length, lo, hi };
  }
  function evaluate(config, scenarios) {
    const results = strategies.map(strategy => ({ ...strategy, name: strategy.id === "super" ? `${config.superMultiplier}×凯利` : strategy.name, example: null, finals: [], drawdowns: [], halvings: 0, ruins: 0, clipped: false }));
    const sampleRandom = rng(config.seed + 73471), samples = [];
    let run = 0, seen = 0, exampleWins = 0, exampleLongestLoss = 0, exampleLossStreak = 0;
    for (const scenario of scenarios) {
      const states = results.map(() => ({ logWealth: Math.log(config.initial), logPeak: Math.log(config.initial), worst: 0, halved: false, ruined: false, path: run === 0 ? [{ wealth: config.initial, drawdown: 0, r: null, f: 0, risk: 0, state: 1 }] : null }));
      for (const event of scenario.events) {
        if (run === 0) { if (event.won) { exampleWins++; exampleLossStreak = 0; } else { exampleLossStreak++; exampleLongestLoss = Math.max(exampleLongestLoss, exampleLossStreak); } }
        seen++;
        if (samples.length < 50000) samples.push(event.r);
        else { const index = Math.floor(sampleRandom() * seen); if (index < samples.length) samples[index] = event.r; }
        states.forEach((state, i) => {
          const result = results[i];
          if (state.ruined) { if (state.path) state.path.push({ wealth: 0, drawdown: 1, r: null, f: 0, risk: 0, state: event.state }); return; }
          const f = allocation(result, event, config), multiplier = 1 + f * event.r;
          if (multiplier <= 0) { state.logWealth = -Infinity; state.ruined = true; }
          else state.logWealth += Math.log(multiplier);
          state.logPeak = Math.max(state.logPeak, state.logWealth);
          const drawdown = state.ruined ? 1 : 1 - Math.exp(state.logWealth - state.logPeak);
          state.worst = Math.max(state.worst, drawdown);
          if (state.logWealth < Math.log(config.initial / 2)) state.halved = true;
          if (state.logWealth > 700) result.clipped = true;
          if (state.path) state.path.push({ wealth: state.ruined ? 0 : Math.exp(Math.min(state.logWealth, 700)), drawdown, r: event.r, f, risk: f * event.estimatedLoss, state: event.state });
        });
      }
      states.forEach((state, i) => {
        const result = results[i];
        result.finals.push(!scenario.events.length ? config.initial : state.ruined ? 0 : Math.exp(Math.min(state.logWealth, 700)));
        result.drawdowns.push(state.worst);
        if (state.halved) result.halvings++;
        if (state.ruined) result.ruins++;
        if (state.path) result.example = state.path;
      });
      run++;
    }
    results.forEach(result => {
      result.q05 = quantile(result.finals, .05); result.q50 = quantile(result.finals, .5); result.q95 = quantile(result.finals, .95);
      result.mean = result.finals.length ? result.finals.reduce((sum, value) => sum + value, 0) / result.finals.length : NaN;
      result.dd50 = quantile(result.drawdowns, .5); result.dd95 = quantile(result.drawdowns, .95);
      result.halfRate = result.halvings / run; result.ruinRate = result.ruins / run;
    });
    const ref = reference(config);
    return { strategies: results, cap: config.cap, reference: ref, theoretical: ref.risk, theoreticalAllocation: ref.allocation, exampleWins, exampleLongestLoss, growth: growthCurve(samples) };
  }
  function simulate(config) { return evaluate(config, scenarioIterator(config)); }
  function sensitivity(config, metric) {
    const ref = reference(config), random = rng(config.seed + 98123), cells = [];
    const state = stateParams(config, 1), wins = [], losses = [];
    for (let i = 0; i < 256; i++) { wins.push(drawOutcome(config, state, true, random)); losses.push(drawOutcome(config, state, false, random)); }
    const pMin = clamp(ref.p - .25, .01, .65), pMax = clamp(ref.p + .25, .35, .99);
    for (let y = 0; y < 11; y++) {
      const actual = pMax - y * (pMax - pMin) / 10, row = [];
      for (let x = 0; x < 11; x++) {
        const estimate = pMin + x * (pMax - pMin) / 10;
        const amount = Math.min(1, config.cap / ref.loss, config.kellyMethod === "twoPoint" ? kelly(estimate, ref.gain, ref.loss) : practicalKelly(estimate, outcomeGrid(config, state)));
        if (metric === "growth") {
          const winGrowth = wins.reduce((sum, r) => sum + Math.log1p(amount * r), 0) / wins.length;
          const lossGrowth = losses.reduce((sum, r) => sum + Math.log1p(amount * r), 0) / losses.length;
          row.push(actual * winGrowth + (1 - actual) * lossGrowth);
        } else {
          let severe = 0;
          for (let k = 0; k < 48; k++) {
            let logW = 0, logPeak = 0, bad = false;
            for (let t = 0; t < Math.min(config.trades, 300); t++) {
              const source = random() < actual ? wins : losses;
              logW += Math.log1p(amount * source[Math.floor(random() * source.length)]);
              logPeak = Math.max(logPeak, logW);
              if (logW <= logPeak + Math.log(.5)) bad = true;
            }
            if (bad) severe++;
          }
          row.push(severe / 48);
        }
      }
      cells.push(row);
    }
    return { cells, pMin, pMax };
  }
  root.KellySim = { rng, beta, betaQuantile, kelly, practicalKelly, outcomeGrid, finalHistogram, quantile, strategies, reference, maxLoss, drawOutcome, generate, allocation, evaluate, simulate, sensitivity, growthCurve };
  if (typeof module !== "undefined") module.exports = root.KellySim;
})(typeof window !== "undefined" ? window : globalThis);

(function (root) {
  "use strict";
  const S = root.KellySim || require("./sim.js");
  const policies = [
    { id: "fixed", name: "固定配置", color: "#246b9b", dash: [] },
    { id: "signal", name: "信号概率配置", color: "#147d69", dash: [] },
    { id: "stress", name: "审慎情景配置", color: "#b67500", dash: [8, 4] },
    { id: "oracle", name: "真实状态已知 · 事后参照", color: "#9b578b", dash: [3, 4] }
  ];
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  function stressProbabilities(probabilities, shift) {
    const transfer = Math.min(shift, probabilities[0]);
    return [probabilities[0] - transfer, probabilities[1], probabilities[2] + transfer];
  }
  function scenarios(config, settings, probabilities) {
    const rows = [];
    for (let state = 0; state < 3; state++) {
      for (let bits = 0; bits < 8; bits++) {
        const chance = settings.strategies.reduce((q, strategy, i) => q * ((bits & (1 << i)) ? strategy.p[state] : 1 - strategy.p[state]), probabilities[state] * (1 - config.tailProbability));
        const returns = settings.strategies.map((strategy, i) => (bits & (1 << i)) ? strategy.win[state] - config.cost : -strategy.loss[state] - config.cost);
        if (chance > 0) rows.push({ chance, returns });
      }
    }
    if (config.tailProbability > 0) rows.push({ chance: config.tailProbability, returns: settings.strategies.map(strategy => -strategy.tailLoss) });
    return rows;
  }
  function growth(weights, rows) {
    let total = 0;
    for (const row of rows) {
      const multiple = 1 + weights.reduce((sum, weight, i) => sum + weight * row.returns[i], 0);
      if (multiple <= 0) return -Infinity;
      total += row.chance * Math.log(multiple);
    }
    return total;
  }
  function optimize(config, settings, probabilities, robust = false) {
    const base = scenarios(config, settings, probabilities);
    const adverse = robust ? scenarios(config, settings, stressProbabilities(probabilities, settings.ambiguity)) : null;
    const score = weights => adverse ? Math.min(growth(weights, base), growth(weights, adverse)) : growth(weights, base);
    let weights = [0, 0, 0], best = score(weights);
    for (const step of [.2, .1, .05, .02, .005]) {
      for (let pass = 0; pass < 16; pass++) {
        let changed = false;
        for (let i = 0; i < 3; i++) for (const direction of [-1, 1]) {
          const candidate = weights.slice();
          candidate[i] = clamp(candidate[i] + direction * step, 0, settings.strategies[i].max);
          if (candidate.reduce((a, b) => a + b, 0) > settings.totalMax + 1e-10) continue;
          const value = score(candidate);
          if (value > best + 1e-12) { weights = candidate; best = value; changed = true; }
        }
        for (let from = 0; from < 3; from++) for (let to = 0; to < 3; to++) {
          if (from === to || weights[from] + 1e-10 < step || weights[to] + step > settings.strategies[to].max + 1e-10) continue;
          const candidate = weights.slice(); candidate[from] -= step; candidate[to] += step;
          const value = score(candidate);
          if (value > best + 1e-12) { weights = candidate; best = value; changed = true; }
        }
        if (!changed) break;
      }
    }
    return weights;
  }
  function simulate(config, settings) {
    const market = { ...config, mode: "market" }, random = S.rng(config.seed + 482991);
    const cache = new Map(), oracle = [0, 1, 2].map(state => {
      const known = [0, 0, 0]; known[state] = 1;
      return optimize(config, settings, known);
    });
    const results = policies.map(policy => ({ ...policy, finals: [], drawdowns: [], example: null }));
    let run = 0;
    for (const path of S.scenarioIterator(market)) {
      const accounts = results.map(() => ({ logWealth: Math.log(config.initial), peak: Math.log(config.initial), worst: 0, path: run === 0 ? [{ wealth: config.initial, drawdown: 0, weights: [0, 0, 0] }] : null }));
      for (const event of path.events) {
        const returns = settings.strategies.map((strategy, i) => {
          if (event.tail) return -strategy.tailLoss;
          if (i === 0) return event.r;
          return random() < strategy.p[event.state] ? strategy.win[event.state] - config.cost : -strategy.loss[event.state] - config.cost;
        });
        const bucket = event.probabilities.map(p => Math.round(p * 20)), key = bucket.join(":");
        if (!cache.has(key)) {
          const total = bucket.reduce((a, b) => a + b, 0), belief = bucket.map(x => x / total);
          cache.set(key, { signal: optimize(config, settings, belief), stress: optimize(config, settings, belief, true) });
        }
        const allocations = [settings.fixed, cache.get(key).signal, cache.get(key).stress, oracle[event.state]];
        accounts.forEach((account, i) => {
          const weights = allocations[i];
          const factor = 1 + weights.reduce((sum, weight, j) => sum + weight * returns[j], 0);
          account.logWealth = factor <= 0 ? -Infinity : account.logWealth + Math.log(factor);
          account.peak = Math.max(account.peak, account.logWealth);
          const drawdown = Number.isFinite(account.logWealth) ? 1 - Math.exp(account.logWealth - account.peak) : 1;
          account.worst = Math.max(account.worst, drawdown);
          if (account.path) account.path.push({ wealth: Number.isFinite(account.logWealth) ? Math.exp(Math.min(account.logWealth, 700)) : 0, drawdown, weights: weights.slice(), state: event.state, signal: event.signal, probabilities: event.probabilities });
        });
      }
      accounts.forEach((account, i) => {
        results[i].finals.push(Number.isFinite(account.logWealth) ? Math.exp(Math.min(account.logWealth, 700)) : 0);
        results[i].drawdowns.push(account.worst);
        if (account.path) results[i].example = account.path;
      });
      run++;
    }
    results.forEach(result => {
      result.q05 = S.quantile(result.finals, .05);
      result.q50 = S.quantile(result.finals, .5);
      result.q95 = S.quantile(result.finals, .95);
      result.dd50 = S.quantile(result.drawdowns, .5);
      result.dd95 = S.quantile(result.drawdowns, .95);
    });
    return { results, runs: run };
  }
  root.KellyPortfolio = { policies, stressProbabilities, scenarios, growth, optimize, simulate };
  if (typeof module !== "undefined") module.exports = root.KellyPortfolio;
})(typeof window !== "undefined" ? window : globalThis);

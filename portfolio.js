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
  function execution(settings) {
    return { fill: 1, entrySlip: 0, exitBlock: 0, gapLoss: 0, rebalanceCost: 0, hold: [1, 1, 1], ...settings.execution };
  }
  function stressProbabilities(probabilities, shift) {
    const transfer = Math.min(shift, probabilities[0]);
    return [probabilities[0] - transfer, probabilities[1], probabilities[2] + transfer];
  }
  function scenarios(config, settings, probabilities, adverse = false) {
    const rows = [];
    const rules = execution(settings), uncertainty = settings.uncertainty || [0, 0, 0];
    for (let state = 0; state < 3; state++) {
      const p = settings.strategies.map((strategy, i) => clamp(strategy.p[state] - (adverse ? uncertainty[i] : 0), 0, 1));
      const board = settings.strategies[0];
      const boardOutcomes = [
        { chance: 1 - rules.fill, value: 0 },
        { chance: rules.fill * p[0], value: board.win[state] - config.cost - rules.entrySlip },
        { chance: rules.fill * (1 - p[0]) * (1 - rules.exitBlock), value: -Math.min(1, board.loss[state] + config.cost + rules.entrySlip) },
        { chance: rules.fill * (1 - p[0]) * rules.exitBlock, value: -Math.min(1, board.loss[state] + config.cost + rules.entrySlip + rules.gapLoss) }
      ];
      for (const outcome of boardOutcomes) for (let bits = 0; bits < 4; bits++) {
        const chance = [1, 2].reduce((q, i) => q * ((bits & (1 << (i - 1))) ? p[i] : 1 - p[i]), probabilities[state] * (1 - config.tailProbability) * outcome.chance);
        const returns = [outcome.value, ...[1, 2].map(i => (bits & (1 << (i - 1))) ? settings.strategies[i].win[state] - config.cost : -settings.strategies[i].loss[state] - config.cost)];
        if (chance > 0) rows.push({ chance, returns });
      }
    }
    if (config.tailProbability > 0) {
      if (rules.fill < 1) rows.push({ chance: config.tailProbability * (1 - rules.fill), returns: [0, ...settings.strategies.slice(1).map(strategy => -strategy.tailLoss)] });
      if (rules.fill > 0) rows.push({ chance: config.tailProbability * rules.fill, returns: [-Math.min(1, settings.strategies[0].tailLoss + rules.entrySlip), ...settings.strategies.slice(1).map(strategy => -strategy.tailLoss)] });
    }
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
  function coordinateOptimize(settings, score) {
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
  function optimize(config, settings, probabilities, robust = false) {
    const base = scenarios(config, settings, probabilities);
    const adverse = robust ? scenarios(config, settings, stressProbabilities(probabilities, settings.ambiguity), true) : null;
    const score = weights => adverse ? Math.min(growth(weights, base), growth(weights, adverse)) : growth(weights, base);
    return coordinateOptimize(settings, score);
  }
  function applyTarget(account, desired, settings, filled, returns) {
    const rules = execution(settings), weights = [0, 0, 0], locked = [false, false, false];
    for (let i = 1; i < 3; i++) {
      locked[i] = account.remaining[i] > 0;
      if (locked[i]) { weights[i] = Math.min(account.holdings[i], settings.strategies[i].max); account.remaining[i]--; }
    }
    const lockedSum = weights[1] + weights[2];
    if (lockedSum > settings.totalMax) { const scale = settings.totalMax / lockedSum; weights[1] *= scale; weights[2] *= scale; }
    const free = [0, 1, 2].filter(i => !locked[i]);
    const capacity = Math.max(0, settings.totalMax - weights.reduce((a, b) => a + b, 0));
    const requested = free.map(i => Math.min(desired[i], settings.strategies[i].max));
    const total = requested.reduce((a, b) => a + b, 0), factor = total > capacity && total > 0 ? capacity / total : 1;
    free.forEach((i, index) => { weights[i] = requested[index] * factor; });
    for (let i = 1; i < 3; i++) if (!locked[i] && Math.abs(weights[i] - account.holdings[i]) > 1e-10 && weights[i] > 0) account.remaining[i] = Math.max(0, rules.hold[i] - 1);
    const turnoverCost = rules.rebalanceCost * (Math.abs(weights[1] - account.holdings[1]) + Math.abs(weights[2] - account.holdings[2]));
    if (!filled) weights[0] = 0;
    const wealthFactor = 1 + weights.reduce((sum, weight, i) => sum + weight * returns[i], 0) - turnoverCost;
    account.holdings = wealthFactor > 0 ? [0, weights[1] * (1 + returns[1]) / wealthFactor, weights[2] * (1 + returns[2]) / wealthFactor] : [0, 0, 0];
    return { weights, turnoverCost, wealthFactor, orderedBoard: desired[0] > 0 };
  }
  function simulate(config, settings) {
    const market = { ...config, mode: "market" }, random = S.rng(config.seed + 482991), executionRandom = S.rng(config.seed + 94123), rules = execution(settings);
    const cache = new Map(), oracle = [0, 1, 2].map(state => {
      const known = [0, 0, 0]; known[state] = 1;
      return optimize(config, settings, known);
    });
    const results = policies.map(policy => ({ ...policy, finals: [], drawdowns: [], example: null, attempts: 0, fills: 0, blocked: 0 }));
    let run = 0;
    for (const path of S.scenarioIterator(market)) {
      const accounts = results.map(() => ({ logWealth: Math.log(config.initial), peak: Math.log(config.initial), worst: 0, holdings: [0, 0, 0], remaining: [0, 0, 0], path: run === 0 ? [{ wealth: config.initial, drawdown: 0, weights: [0, 0, 0] }] : null }));
      for (const event of path.events) {
        const filled = executionRandom() < rules.fill, exitBlocked = executionRandom() < rules.exitBlock;
        const returns = settings.strategies.map((strategy, i) => {
          if (i === 0) return !filled ? 0 : Math.max(-1, event.r - rules.entrySlip - (!event.tail && !event.won && exitBlocked ? rules.gapLoss : 0));
          if (event.tail) return -strategy.tailLoss;
          return random() < strategy.p[event.state] ? strategy.win[event.state] - config.cost : -strategy.loss[event.state] - config.cost;
        });
        const bucket = event.probabilities.map(p => Math.round(p * 20)), key = bucket.join(":");
        if (!cache.has(key)) {
          const total = bucket.reduce((a, b) => a + b, 0), belief = bucket.map(x => x / total);
          cache.set(key, { signal: optimize(config, settings, belief), stress: optimize(config, settings, belief, true) });
        }
        const allocations = [settings.fixed, cache.get(key).signal, cache.get(key).stress, oracle[event.state]];
        accounts.forEach((account, i) => {
          if (account.logWealth === -Infinity) {
            if (account.path) account.path.push({ wealth: 0, drawdown: 1, weights: [0, 0, 0], state: event.state, signal: event.signal, probabilities: event.probabilities, filled: false, exitBlocked: false, turnoverCost: 0 });
            return;
          }
          const realized = applyTarget(account, allocations[i], settings, filled, returns);
          if (realized.orderedBoard) { results[i].attempts++; if (filled) results[i].fills++; if (filled && !event.tail && !event.won && exitBlocked) results[i].blocked++; }
          account.logWealth = realized.wealthFactor <= 0 ? -Infinity : account.logWealth + Math.log(realized.wealthFactor);
          account.peak = Math.max(account.peak, account.logWealth);
          const drawdown = Number.isFinite(account.logWealth) ? 1 - Math.exp(account.logWealth - account.peak) : 1;
          account.worst = Math.max(account.worst, drawdown);
          if (account.path) account.path.push({ wealth: Number.isFinite(account.logWealth) ? Math.exp(Math.min(account.logWealth, 700)) : 0, drawdown, weights: realized.weights.slice(), state: event.state, signal: event.signal, probabilities: event.probabilities, filled, exitBlocked, turnoverCost: realized.turnoverCost });
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
  root.KellyPortfolio = { policies, stressProbabilities, scenarios, growth, coordinateOptimize, optimize, applyTarget, simulate };
  if (typeof module !== "undefined") module.exports = root.KellyPortfolio;
})(typeof window !== "undefined" ? window : globalThis);

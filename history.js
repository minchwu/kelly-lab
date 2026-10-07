(function (root) {
  "use strict";
  const P = root.KellyPortfolio || require("./portfolio.js");
  const names = ["打板", "波段", "趋势"];
  const aliases = { "打板": 0, board: 0, "波段": 1, swing: 1, wave: 1, "趋势": 2, trend: 2 };
  function csvRows(source) {
    const text = source.replace(/^\uFEFF/, ""), rows = [];
    let row = [], cell = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quoted) {
        if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (char === '"') quoted = false;
        else cell += char;
      } else if (char === '"') {
        if (cell.length) throw new Error("CSV 引号只能出现在字段开头。");
        quoted = true;
      } else if (char === ",") { row.push(cell); cell = ""; }
      else if (char === "\n") { row.push(cell.replace(/\r$/, "")); if (row.some(x => x.trim())) rows.push(row); row = []; cell = ""; }
      else cell += char;
    }
    if (quoted) throw new Error("CSV 引号未闭合。");
    row.push(cell.replace(/\r$/, ""));
    if (row.some(x => x.trim())) rows.push(row);
    return rows;
  }
  function parse(source) {
    const rows = csvRows(source);
    if (!rows.length) throw new Error("CSV 文件为空。");
    const header = rows.shift().map(x => x.trim().toLowerCase());
    const required = ["date", "strategy", "signal", "filled", "gross_return_pct", "cost_pct"];
    if (required.some(key => !header.includes(key))) throw new Error(`CSV 需要列：${required.join(", ")}。`);
    const records = [], seen = new Set();
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index], line = index + 2;
      if (row.length !== header.length) throw new Error(`第 ${line} 行列数与表头不一致。`);
      const get = key => row[header.indexOf(key)].trim();
      const date = get("date"), strategyName = get("strategy"), strategy = aliases[strategyName.toLowerCase()];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error(`第 ${line} 行日期须为有效的 YYYY-MM-DD。`);
      if (strategy === undefined) throw new Error(`第 ${line} 行策略须为打板、波段或趋势。`);
      const signal = get("signal"), filled = get("filled"), held = header.includes("held") ? get("held") : "0";
      if (!["0", "1"].includes(signal) || !["0", "1"].includes(filled) || !["0", "1"].includes(held) || (filled === "1" && signal !== "1") || (held === "1" && strategy === 0)) throw new Error(`第 ${line} 行 signal / filled / held 须为 0 或 1；成交须先有信号，续持只适用于波段和趋势。`);
      if (!get("gross_return_pct") || !get("cost_pct")) throw new Error(`第 ${line} 行收益和成本不能为空。`);
      const gross = Number(get("gross_return_pct")), cost = Number(get("cost_pct"));
      if (!Number.isFinite(gross) || gross < -100 || gross > 500 || !Number.isFinite(cost) || cost < 0 || cost > 10) throw new Error(`第 ${line} 行收益须为 -100%–500%，成本须为 0%–10%。`);
      if (filled === "0" && held === "0" && (gross !== 0 || cost !== 0)) throw new Error(`第 ${line} 行未成交且未续持时，收益和成本应为 0。`);
      const key = `${date}:${strategy}`;
      if (seen.has(key)) throw new Error(`第 ${line} 行与已有的 ${date} / ${names[strategy]} 记录重复。`);
      seen.add(key);
      records.push({ date, strategy, signal: signal === "1", filled: filled === "1", held: held === "1", gross: gross / 100, cost: cost / 100, net: filled === "1" || held === "1" ? Math.max(-1, (gross - cost) / 100) : 0 });
    }
    const byDate = new Map();
    for (const record of records) {
      if (!byDate.has(record.date)) byDate.set(record.date, { date: record.date, returns: [0, 0, 0], signals: [false, false, false], filled: [false, false, false] });
      const day = byDate.get(record.date);
      day.returns[record.strategy] = record.net;
      day.signals[record.strategy] = record.signal;
      day.filled[record.strategy] = record.filled;
    }
    const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    const stats = names.map((name, strategy) => {
      const own = records.filter(r => r.strategy === strategy), completed = own.filter(r => r.filled || r.held);
      const wins = completed.filter(r => r.net > 0), losses = completed.filter(r => r.net < 0);
      const mean = list => list.length ? list.reduce((sum, r) => sum + r, 0) / list.length : 0;
      return { name, signals: own.filter(r => r.signal).length, fills: own.filter(r => r.filled).length, active: completed.length, fillRate: own.some(r => r.signal) ? own.filter(r => r.filled).length / own.filter(r => r.signal).length : 0,
        winRate: wins.length + losses.length ? wins.length / (wins.length + losses.length) : 0,
        meanWin: mean(wins.map(r => r.net)), meanLoss: -mean(losses.map(r => r.net)), meanCost: mean(completed.map(r => r.cost)) };
    });
    const sharedLossDays = days.filter(day => day.returns.filter(r => r < 0).length >= 2).length;
    return { records, days, stats, sharedLossDays };
  }
  function adverseRows(rows, uncertainty) {
    const wins = [0, 1, 2].map(i => rows.filter(row => row.returns[i] > 0).map(row => row.returns[i]));
    const losses = [0, 1, 2].map(i => rows.filter(row => row.returns[i] < 0).map(row => -row.returns[i]));
    const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    const haircut = wins.map((values, i) => uncertainty[i] * (mean(values) + mean(losses[i])) / Math.max(values.length / rows.length, 1 / rows.length));
    return rows.map(row => ({ chance: row.chance, returns: row.returns.map((value, i) => value > 0 ? Math.max(-1, value - haircut[i]) : value) }));
  }
  function walkForward(dataset, settings, initial, lookback = 60, warmup = 20) {
    const { days } = dataset;
    if (!Number.isInteger(lookback) || lookback < 20 || lookback > 120 || !Number.isInteger(warmup) || warmup < 20 || warmup > 250) throw new Error("历史窗口须为 20–120 期，预热期须为 20–250 期。");
    if (days.length <= warmup) throw new Error(`至少需要 ${warmup + 1} 个不同日期；当前只有 ${days.length} 个。`);
    const policies = [
      { id: "fixed", name: "固定配置", color: "#246b9b", dash: [] },
      { id: "empirical", name: "仅用过去数据", color: "#147d69", dash: [] },
      { id: "robust", name: "历史不利情景", color: "#b67500", dash: [8, 4] }
    ];
    const results = policies.map(policy => ({ ...policy, wealth: initial, peak: initial, maxDrawdown: 0, holdings: [0, 0, 0], remaining: [0, 0, 0], example: [{ wealth: initial, drawdown: 0, weights: [0, 0, 0] }] }));
    for (let index = warmup; index < days.length; index++) {
      const prior = days.slice(Math.max(0, index - lookback), index), rows = prior.map(day => ({ chance: 1 / prior.length, returns: day.returns }));
      const stressed = adverseRows(rows, settings.uncertainty || [0, 0, 0]);
      const center = P.coordinateOptimize(settings, weights => P.growth(weights, rows));
      const robust = P.coordinateOptimize(settings, weights => Math.min(P.growth(weights, rows), P.growth(weights, stressed)));
      const targets = [settings.fixed, center, robust], day = days[index];
      results.forEach((result, i) => {
        if (result.wealth <= 0) {
          result.example.push({ wealth: 0, drawdown: 1, weights: [0, 0, 0], date: day.date });
          return;
        }
        const applied = P.applyTarget(result, targets[i], settings, day.filled[0], day.returns);
        result.wealth = applied.wealthFactor <= 0 ? 0 : result.wealth * applied.wealthFactor;
        result.peak = Math.max(result.peak, result.wealth);
        const drawdown = result.peak ? 1 - result.wealth / result.peak : 1;
        result.maxDrawdown = Math.max(result.maxDrawdown, drawdown);
        result.example.push({ wealth: result.wealth, drawdown, weights: applied.weights, date: day.date });
      });
    }
    return { results, trades: days.length - warmup, start: days[warmup].date, end: days.at(-1).date, lookback, warmup };
  }
  root.KellyHistory = { csvRows, parse, adverseRows, walkForward };
  if (typeof module !== "undefined") module.exports = root.KellyHistory;
})(typeof window !== "undefined" ? window : globalThis);

(function () {
  "use strict";
  const S = window.KellySim, P = window.KellyPortfolio, H = window.KellyHistory, C = window.KellyCharts, $ = id => document.getElementById(id);
  const defaults = { mode: "basic", kellyMethod: "robust", p: .42, win: .10, b: 10 / 7, stop: .07, trades: 240, initial: 10000, runs: 500, seed: 2047, cap: .05, superMultiplier: 1.25, history: 100, wins: 42, cost: .001, slippage: .005, trailCoverage: .3, tightStop: .03, variation: .1, tailProbability: .02, tailLoss: .6, winRateMargin: .05, signalAccuracy: .7, states: [{ p: .60, win: .10, loss: .055, stay: .65 }, { p: .42, win: .08, loss: .065, stay: .78 }, { p: .32, win: .06, loss: .08, stay: .90 }] };
  const presets = {
    small: { p: .55, win: .12, stop: .1, history: 100, wins: 55, states: [{ p: .64, win: .15, loss: .08, stay: .8 }, { p: .54, win: .12, loss: .1, stay: .72 }, { p: .4, win: .08, loss: .12, stay: .84 }] },
    high: { p: .75, win: .08, stop: .1, history: 100, wins: 75, states: [{ p: .81, win: .1, loss: .08, stay: .8 }, { p: .74, win: .08, loss: .1, stay: .72 }, { p: .62, win: .06, loss: .12, stay: .84 }] },
    low: { p: .36, win: .22, stop: .08, history: 100, wins: 36, states: [{ p: .44, win: .27, loss: .07, stay: .8 }, { p: .35, win: .22, loss: .08, stay: .72 }, { p: .25, win: .16, loss: .1, stay: .84 }] },
    over: { p: .6, win: .08, stop: .1, history: 20, wins: 15, states: [{ p: .58, win: .11, loss: .09, stay: .8 }, { p: .48, win: .08, loss: .1, stay: .72 }, { p: .35, win: .06, loss: .13, stay: .88 }] }
  };
  const portfolioDefaults = { totalMax: 1, ambiguity: .15, uncertainty: [.05, .04, .04], fixed: [.15, .25, .25], max: [.5, .5, .5], execution: { fill: .7, entrySlip: .005, exitBlock: .08, gapLoss: .05, rebalanceCost: .001, hold: [1, 3, 5] }, wave: { p: [.62, .52, .4], win: .07, loss: .05, tailLoss: .35 }, trend: { p: [.58, .5, .38], win: .1, loss: .065, tailLoss: .25 } };
  let config = structuredClone(defaults), portfolio = structuredClone(portfolioDefaults), portfolioResults = null, historyData = null, historyResults = null, results = null, heatData = null, scale = "log", metric = "growth", hover = null, timer = null, focused = "full";
  const visibility = Object.fromEntries(S.strategies.map(x => [x.id, true]));
  const percent = v => `${(v * 100).toFixed(1)}%`;
  const money = v => !Number.isFinite(v) ? "—" : v >= Math.exp(700) ? "≥¥1.01×10³⁰⁴" : v >= 1e12 ? `¥${v.toExponential(2)}` : `¥${v.toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`;
  const specs = {
    p: ["胜率 p", 1, 99, 1, "%", 100], win: ["平均盈利", .5, 100, .5, "%", 100], stop: ["计划亏损 / 止损", .5, 50, .5, "%", 100], b: ["毛盈亏比 b", .05, 200, .05, "倍", 1], history: ["历史交易笔数", 0, 2000, 1, "笔", 1], wins: ["其中盈利笔数", 0, 2000, 1, "笔", 1],
    trades: ["交易次数", 0, 20000, 1, "笔", 1], initial: ["初始资金", 1000, 10000000, 1000, "元", 1], runs: ["重复模拟次数", 20, 5000, 10, "次", 1], seed: ["随机种子", 0, 4294967295, 1, "", 1], cap: ["每笔计划账户风险上限", .5, 50, .5, "%", 100], superMultiplier: ["超凯利倍数", 1.05, 3, .05, "倍", 1], cost: ["往返交易成本", 0, 2, .05, "%", 100], slippage: ["亏损执行额外滑点上限", 0, 20, .5, "%", 100], trailCoverage: ["亏损单止损收紧覆盖率", 0, 100, 1, "%", 100], tightStop: ["收紧后亏损幅度", .1, 50, .1, "%", 100], variation: ["盈亏幅度波动", 0, 50, 1, "%", 100], tailProbability: ["单笔极端事件概率", 0, 20, .1, "%", 100], tailLoss: ["极端事件标的净跌幅", 1, 100, 1, "%", 100], winRateMargin: ["胜率不利情景范围", 0, 30, .5, "百分点", 100], signalAccuracy: ["交易前信号准确率", 34, 100, 1, "%", 100]
  };
  const stateNames = ["顺风", "普通", "逆风"];
  function portfolioModel() {
    return { totalMax: portfolio.totalMax, ambiguity: portfolio.ambiguity, uncertainty: portfolio.uncertainty, execution: portfolio.execution, fixed: portfolio.fixed,
      strategies: [
        { p: config.states.map(s => s.p), win: config.states.map((_, i) => S.reference(config, i).gain + config.cost), loss: config.states.map((_, i) => S.reference(config, i).loss - config.cost), tailLoss: config.tailLoss, max: portfolio.max[0] },
        ...["wave", "trend"].map((key, i) => ({ p: portfolio[key].p, win: Array(3).fill(portfolio[key].win), loss: Array(3).fill(portfolio[key].loss), tailLoss: portfolio[key].tailLoss, max: portfolio.max[i + 1] }))
      ] };
  }
  function portfolioInput(key, label, value, min, max, step = 1) {
    return `<label><span>${label}</span><span class="portfolio-number"><input data-pf="${key}" type="number" min="${min}" max="${max}" step="${step}" value="${+(value * 100).toFixed(2)}" aria-label="${label}"><em>%</em></span></label>`;
  }
  function portfolioCountInput(key, label, value, min, max) {
    return `<label><span>${label}</span><span class="portfolio-number"><input data-pf="${key}" type="number" min="${min}" max="${max}" step="1" value="${value}" aria-label="${label}"><em>期</em></span></label>`;
  }
  function buildPortfolioControls() {
    $("portfolioControls").innerHTML = `<div class="portfolio-limits">${portfolioInput("totalMax", "总买入仓位上限", portfolio.totalMax, 10, 100)}${portfolioInput("ambiguity", "顺风概率不利偏移", portfolio.ambiguity, 0, 50)}</div><div class="portfolio-grid"><div class="portfolio-grid-head"><span>策略</span><span>顺风胜率</span><span>普通胜率</span><span>逆风胜率</span><span>平均盈利</span><span>平均亏损</span><span>共同冲击损失</span><span>胜率误差范围</span><span>单项上限</span><span>固定配置</span></div>${["打板", "波段", "趋势"].map((name, i) => {
      const strategy = i === 0 ? { p: config.states.map(s => s.p), win: config.states[1].win, loss: config.states[1].loss, tailLoss: config.tailLoss } : portfolio[i === 1 ? "wave" : "trend"];
      const key = i === 1 ? "wave" : "trend";
      return `<div class="portfolio-grid-row"><strong>${name}</strong>${strategy.p.map((p, state) => i === 0 ? `<span class="portfolio-linked">${percent(p)}</span>` : portfolioInput(`${key}.p.${state}`, `${name}${stateNames[state]}胜率`, p, 1, 99)).join("")}${i === 0 ? `<span class="portfolio-linked">随市场状态</span><span class="portfolio-linked">随市场状态</span><span class="portfolio-linked">${percent(config.tailLoss)}</span>` : portfolioInput(`${key}.win`, `${name}平均盈利`, strategy.win, .5, 50, .5) + portfolioInput(`${key}.loss`, `${name}平均亏损`, strategy.loss, .5, 50, .5) + portfolioInput(`${key}.tailLoss`, `${name}共同冲击损失`, strategy.tailLoss, 1, 100)}${portfolioInput(`uncertainty.${i}`, `${name}胜率误差范围`, portfolio.uncertainty[i], 0, 30)}${portfolioInput(`max.${i}`, `${name}单项上限`, portfolio.max[i], 0, 100)}${portfolioInput(`fixed.${i}`, `${name}固定配置`, portfolio.fixed[i], 0, 100)}</div>`;
    }).join("")}</div><div class="portfolio-execution"><h3>执行与持仓假设</h3><div class="portfolio-execution-fields">${portfolioInput("execution.fill", "打板信号成交率", portfolio.execution.fill, 0, 100)}${portfolioInput("execution.entrySlip", "打板入场价差", portfolio.execution.entrySlip, 0, 10, .1)}${portfolioInput("execution.exitBlock", "亏损单退出受阻概率", portfolio.execution.exitBlock, 0, 50)}${portfolioInput("execution.gapLoss", "退出受阻额外亏损", portfolio.execution.gapLoss, 0, 50)}${portfolioCountInput("execution.hold.1", "波段最短持仓", portfolio.execution.hold[1], 1, 20)}${portfolioCountInput("execution.hold.2", "趋势最短持仓", portfolio.execution.hold[2], 1, 40)}${portfolioInput("execution.rebalanceCost", "调仓成本", portfolio.execution.rebalanceCost, 0, 2, .05)}</div></div>`;
    $("portfolioControls").querySelectorAll("[data-pf]").forEach(input => input.addEventListener("input", e => {
      const path = e.target.dataset.pf.split(".");
      let target = portfolio;
      for (let i = 0; i < path.length - 1; i++) target = target[path[i]];
      target[path.at(-1)] = e.target.value === "" ? NaN : Number(e.target.value) / (e.target.dataset.pf.startsWith("execution.hold") ? 1 : 100);
      schedule();
    }));
  }
  function validatePortfolio() {
    const model = portfolioModel();
    const values = [portfolio.totalMax, portfolio.ambiguity, ...portfolio.uncertainty, ...portfolio.max, ...portfolio.fixed, portfolio.execution.fill, portfolio.execution.entrySlip, portfolio.execution.exitBlock, portfolio.execution.gapLoss, portfolio.execution.rebalanceCost, ...model.strategies.flatMap(s => [...s.p, ...s.win, ...s.loss, s.tailLoss])];
    if (values.some(x => !Number.isFinite(x) || x < 0 || x > 1)) return "组合参数须在 0%–100% 之间。";
    if (portfolio.totalMax < .1 || portfolio.ambiguity > .5) return "总仓位上限至少 10%，不利偏移最多 50 个百分点。";
    if (portfolio.uncertainty.some(v => v > .3)) return "各策略胜率误差范围最多 30 个百分点。";
    if (portfolio.execution.entrySlip > .1 || portfolio.execution.exitBlock > .5 || portfolio.execution.gapLoss > .5 || portfolio.execution.rebalanceCost > .02 || !Number.isInteger(portfolio.execution.hold[1]) || !Number.isInteger(portfolio.execution.hold[2]) || portfolio.execution.hold[1] < 1 || portfolio.execution.hold[1] > 20 || portfolio.execution.hold[2] < 1 || portfolio.execution.hold[2] > 40) return "执行参数超出显示范围；持仓期必须为有效整数。";
    if (portfolio.fixed.some((x, i) => x > portfolio.max[i]) || portfolio.fixed.reduce((a, b) => a + b, 0) > portfolio.totalMax + 1e-10) return "固定配置须满足单项上限和总买入仓位上限。";
    if (model.strategies.some(s => s.p.some(p => p < .01 || p > .99) || s.win.some(v => v < .005) || s.loss.some(v => v < .005) || s.tailLoss < .01) || [portfolio.wave, portfolio.trend].some(s => s.win > .5 || s.loss > .5)) return "策略胜率需为 1%–99%；波段与趋势的平均盈亏幅度为 0.5%–50%，共同冲击损失至少 1%。";
    return "";
  }
  function get(key) { if (key.startsWith("states.")) { const [, i, field] = key.split("."); return config.states[+i][field]; } return config[key]; }
  function set(key, value) { if (key.startsWith("states.")) { const [, i, field] = key.split("."); config.states[+i][field] = value; } else config[key] = value; }
  function field(key, label, min, max, step, unit, factor, slider = true) {
    const shown = +(get(key) * factor).toFixed(4);
    const rangeStep = key === "win" || key === "b" ? "any" : step;
    return `<label class="field"><span>${label}</span><div class="range-row">${slider ? `<input type="range" data-key="${key}" min="${min}" max="${max}" step="${rangeStep}" value="${shown}" aria-label="${label}">` : "<span></span>"}<span class="number-wrap"><input type="number" data-key="${key}" min="${min}" max="${max}" step="${step}" value="${shown}" aria-label="${label}"><em>${unit}</em></span></div><small>范围 ${min}–${max}${unit}</small></label>`;
  }
  function buildFields() {
    $("basicFields").innerHTML = field("p", ...specs.p) + field("win", ...specs.win) + field("stop", ...specs.stop) + field("b", ...specs.b) + `<p class="field-hint">平均盈利 ÷ 计划亏损；改动任一项会同步更新</p>`;
    $("estimateFields").innerHTML = field("history", ...specs.history) + field("wins", ...specs.wins) + field("win", ...specs.win) + field("stop", ...specs.stop) + field("b", ...specs.b);
    $("marketFields").innerHTML = field("signalAccuracy", ...specs.signalAccuracy) + `<p class="field-hint">信号在交易前出现；准确率指信号与隐藏真实状态一致的概率，误判时等概率指向另两种状态。</p>` + config.states.map((state, i) => `<div class="state-group"><h3>${stateNames[i]}状态</h3>${field(`states.${i}.p`, "胜率", 1, 99, 1, "%", 100)}${field(`states.${i}.win`, "平均盈利", .5, 100, .5, "%", 100)}${field(`states.${i}.loss`, "平均亏损", .5, 50, .5, "%", 100)}${field(`states.${i}.stay`, "持续倾向", 0, 99, 1, "%", 100)}<p class="field-hint">本状态在下一笔继续保持的概率；否则等概率转入另两种状态。</p></div>`).join("");
    $("commonFields").innerHTML = `<label class="field"><span>凯利计算方法</span><select data-key="kellyMethod" aria-label="凯利计算方法"><option value="twoPoint" ${config.kellyMethod === "twoPoint" ? "selected" : ""}>经典两点（忽略尾部风险定仓）</option><option value="distribution" ${config.kellyMethod === "distribution" ? "selected" : ""}>分布凯利（含尾部事件）</option><option value="robust" ${config.kellyMethod === "robust" ? "selected" : ""}>稳健分布凯利（尾部 + 不利胜率情景）</option></select><small>方法只改变定仓；三种方法的交易结果均含设定的尾部事件</small></label>` + field("trades", ...specs.trades) + `<p class="field-hint">默认约为一年 240 个交易日、每天一笔；实际交易频率可修改</p>` + field("initial", ...specs.initial) + field("runs", ...specs.runs) + `<p class="field-hint">交易次数 × 重复次数最多 500 万笔；增加重复次数仅降低抽样噪声</p>` + field("seed", ...specs.seed, false) + `<p class="field-hint">种子固定可复现同一批随机路径；换种子不改变设定的胜率或盈亏分布</p>` + field("cap", ...specs.cap) + `<p class="field-hint">按常规估计亏损控制；极端事件可能突破计划风险</p>` + field("superMultiplier", ...specs.superMultiplier) + field("cost", ...specs.cost) + field("slippage", ...specs.slippage) + field("trailCoverage", ...specs.trailCoverage) + field("tightStop", ...specs.tightStop) + field("variation", ...specs.variation) + `<div class="divider"></div><h3 class="risk-heading">尾部风险与估计误差</h3>` + field("tailProbability", ...specs.tailProbability) + field("tailLoss", ...specs.tailLoss) + field("winRateMargin", ...specs.winRateMargin) + `<p class="field-hint">稳健方法在估计胜率 ± 此范围中取较差端点定仓；这是用户压力假设，不是统计可信区间。模拟的真实胜率不因该范围改变。</p>`;
    document.querySelectorAll("[data-key]").forEach(input => input.addEventListener("input", onField));
    document.querySelectorAll("#modeTabs button").forEach(button => button.classList.toggle("active", button.dataset.mode === config.mode));
    ["basic", "estimate", "market"].forEach(m => $(`${m}Fields`).classList.toggle("hidden", config.mode !== m));
  }
  function onField(event) {
    const input = event.target, key = input.dataset.key;
    if (key === "kellyMethod") { config.kellyMethod = input.value; schedule(); return; }
    const value = Number(input.value), factor = key.startsWith("states.") ? 100 : specs[key][5];
    set(key, input.value === "" ? NaN : value / factor);
    document.querySelectorAll(`[data-key="${key}"]`).forEach(peer => { if (peer !== input) peer.value = input.value; });
    if (key === "b") config.win = config.b * config.stop;
    else if (key === "win" || key === "stop") config.b = config.win / config.stop;
    const linked = key === "b" ? "win" : key === "win" || key === "stop" ? "b" : null;
    if (linked) document.querySelectorAll(`[data-key="${linked}"]`).forEach(peer => { peer.value = Number.isFinite(config[linked]) ? +(config[linked] * specs[linked][5]).toFixed(4) : ""; });
    $("preset").value = "custom";
    schedule();
  }
  function validate() {
    const keys = config.mode === "basic" ? ["p", "win", "stop", "b"] : config.mode === "estimate" ? ["history", "wins", "win", "stop", "b"] : [];
    const common = ["trades", "initial", "runs", "seed", "cap", "superMultiplier", "cost", "slippage", "trailCoverage", "tightStop", "variation", "tailProbability", "tailLoss", "winRateMargin", "signalAccuracy"];
    for (const key of [...keys, ...common]) { const s = specs[key], v = get(key) * s[5]; if (!Number.isFinite(v) || v < s[1] - 1e-8 || v > s[2] + 1e-8 || (["history", "wins", "trades", "runs", "seed", "initial"].includes(key) && !Number.isInteger(v))) return `${s[0]}请输入 ${s[1]}–${s[2]}${s[4]}范围内的有效值。`; }
    if (config.wins > config.history && config.mode === "estimate") return "盈利笔数不能超过历史交易笔数。";
    if (config.trades * config.runs > 5000000) return "单次最多处理 500 万笔交易结果；请降低交易次数或重复模拟次数。";
    if (config.mode === "market") for (let i = 0; i < 3; i++) for (const [name, min, max] of [["p", .01, .99], ["win", .005, 1], ["loss", .005, .5], ["stay", 0, .99]]) { const v = config.states[i][name]; if (!Number.isFinite(v) || v < min - 1e-8 || v > max + 1e-8) return `${stateNames[i]}状态的${name}超出有效范围。`; }
    return "";
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(update, 120); }
  function update() {
    const error = validate(), notice = $("validation");
    if (error) { notice.className = "notice error"; notice.textContent = error; return; }
    results = S.simulate(config);
    heatData = S.sensitivity(config, metric);
    $("portfolioPanel").classList.toggle("hidden", config.mode !== "market");
    $("historyPanel").classList.toggle("hidden", config.mode !== "market");
    if (config.mode === "market") {
      const linked = $("portfolioControls").querySelectorAll(".portfolio-linked");
      config.states.forEach((state, i) => { if (linked[i]) linked[i].textContent = percent(state.p); });
      if (linked[5]) linked[5].textContent = percent(config.tailLoss);
      const portfolioError = validatePortfolio();
      $("portfolioStatus").textContent = portfolioError || "配置只使用交易前信息；固定种子下各规则共享相同市场与策略结果。";
      portfolioResults = portfolioError ? null : P.simulate(config, portfolioModel());
    } else portfolioResults = null;
    notice.className = "notice";
    const messages = [];
    if (results.reference.selected <= 0) messages.push("当前方法下估计的边际对数增长不为正，凯利策略选择 0% 观望；固定风险 1% 与满仓仍承担风险。");
    if (config.cost >= (config.mode === "market" ? Math.min(...config.states.map(s => s.win)) : config.win) * (1 - config.variation)) messages.push("部分盈利交易的毛收益可能低于往返成本，扣费后也可能出现净亏损。");
    if (config.trades === 0) messages.push("交易次数为 0，各策略资金保持初始值，回撤为 0。");
    if (results.theoreticalAllocation > 1) messages.push("两点公式的无约束理论仓位超过 100%，这只表示需要杠杆才能实现；模拟中的所有策略仍按无杠杆和计划风险上限收敛。");
    if (config.mode === "market" && config.states.some((_, i) => S.reference(config, i).selected === 0)) messages.push("部分状态在当前定仓方法下选择 0% 观望；请查看各状态解的对照表。");
    if (results.reference.selected * results.reference.loss * config.superMultiplier > config.cap) messages.push("超凯利仓位可能触及计划账户风险上限。");
    if (config.kellyMethod === "twoPoint" && config.tailProbability > 0) messages.push("经典两点方法定仓时忽略极端事件，但模拟结果仍计入这些损失。");
    if (config.trailCoverage > 0 && config.mode !== "market" && config.tightStop >= config.stop) messages.push("收紧后亏损不小于计划止损，动态止损不会减少这类亏损。");
    if (results.strategies.some(s => s.clipped)) messages.push("极端路径的图表金额已截断显示；回撤仍按对数资金计算。");
    notice.textContent = messages.join(" ") || "七种策略使用相同净涨跌幅；固定种子可复现。实际亏损可因滑点超出计划风险。";
    if (messages.length) notice.classList.add("warning");
    render();
    updateHistory();
  }
  function render() {
    const first = config.mode === "market" && config.trades ? results.strategies[0].example[1] : null;
    const bucket = first?.probabilities.map(p => Math.round(p * 100)), bucketTotal = bucket?.reduce((a, b) => a + b, 0);
    const ref = first ? S.marketReference(config, bucket.map(x => x / bucketTotal), config.states.map((_, i) => S.reference(config, i)), config.states.map(state => S.outcomeGrid(config, state))) : results.reference;
    results.displayReference = ref;
    const fullAllocation = S.allocation({ id: "full", factor: 1 }, { estimated: ref.selected, estimatedLoss: ref.loss }, config);
    const methodName = { twoPoint: "经典两点", distribution: "分布", robust: "稳健分布" }[config.kellyMethod];
    $("kellyLabel").textContent = `${methodName}凯利模型买入占比${config.mode === "market" ? " · 示例路径首笔信号" : ""}`;
    $("kellyValue").textContent = percent(ref.selected);
    $("kellyContext").textContent = `经典两点 ${percent(ref.allocation)} · 含尾部分布 ${percent(ref.practical)} · 单策略不利胜率情景 ${percent(ref.robust)} · 计划风险约束后全凯利 ${percent(fullAllocation)}${config.mode === "estimate" ? " · 按历史后验定仓" : ""}`;
    $("stateDiagnostics").classList.toggle("hidden", config.mode !== "market");
    $("probabilityPanel").classList.toggle("hidden", config.mode !== "market");
    if (config.mode === "market") $("stateDiagnostics").innerHTML = `<h3>交易前状态判断</h3><p>${first ? `首笔信号：${stateNames[first.signal]}；估计概率：顺风 ${percent(first.probabilities[0])}、普通 ${percent(first.probabilities[1])}、逆风 ${percent(first.probabilities[2])}。事后真实状态：${stateNames[first.state]}。` : "零交易，无交易前信号。"}</p><div class="state-table-wrap"><table><thead><tr><th>假设单一状态</th><th>两点</th><th>含尾部分布</th><th>稳健</th></tr></thead><tbody>${config.states.map((_, i) => { const stateRef = S.reference(config, i); return `<tr><td>${stateNames[i]}</td><td>${percent(stateRef.allocation)}</td><td>${percent(stateRef.practical)}</td><td>${percent(stateRef.robust)}</td></tr>`; }).join("")}</tbody></table></div><p>上表是单一状态条件参考；实际按交易前概率混合求解。两点列可能超过 100%，表示需要杠杆的理论值；分布列最多搜索到无杠杆边界。</p>`;
    $("posterior").classList.toggle("hidden", config.mode !== "estimate");
    if (config.mode === "estimate") $("posterior").innerHTML = `胜率后验 Beta(${ref.posterior.a}, ${ref.posterior.b})<br><strong>估计 ${percent(ref.p)}</strong> · 95% 可信区间 ${percent(ref.posterior.low)}–${percent(ref.posterior.high)}`;
    $("runCount").textContent = `${config.runs} 次`;
    $("summaryBody").innerHTML = results.strategies.map(r => `<tr><td><i class="strategy-dot" style="--color:${r.color}"></i>${r.name}</td><td>${money(r.q50)}</td><td><span class="stat-pair">${percent(r.dd50)}<small>${percent(r.dd95)}</small></span></td><td><span class="stat-pair">${percent(r.halfRate)}<small>${percent(r.ruinRate)}</small></span></td></tr>`).join("");
    $("distributionStats").innerHTML = results.strategies.map(r => `<tr class="${focused === r.id ? "selected" : ""}"><td><i class="strategy-dot" style="--color:${r.color}"></i>${r.name}</td><td>${money(r.mean)}</td><td>${money(r.q05)}</td><td>${money(r.q50)}</td><td>${money(r.q95)}</td><td>${percent(r.halfRate)}</td><td>${percent(r.ruinRate)}</td></tr>`).join("");
    $("legend").innerHTML = results.strategies.map(r => `<button type="button" data-strategy="${r.id}" class="${visibility[r.id] ? "" : "off"} ${focused === r.id ? "focused" : ""}" aria-pressed="${visibility[r.id]}" title="显示或隐藏${r.name}"><svg width="25" height="8" aria-hidden="true"><line x1="1" y1="4" x2="24" y2="4" stroke="${r.color}" stroke-width="3" ${r.dash.length ? `stroke-dasharray="${r.dash.join(" ")}"` : ""}/></svg>${r.name}</button>`).join("");
    $("legend").querySelectorAll("button").forEach(b => b.addEventListener("click", () => { visibility[b.dataset.strategy] = !visibility[b.dataset.strategy]; renderPathCharts(); renderLegend(); }));
    const gross = config.mode === "market" && first ? { win: config.states.reduce((sum, state, i) => sum + first.probabilities[i] * state.win, 0), loss: config.states.reduce((sum, state, i) => sum + first.probabilities[i] * state.loss, 0) } : config.mode === "market" ? config.states[1] : { win: config.win, loss: config.stop };
    $("workedExample").textContent = `${config.mode === "market" && first ? "首笔交易前概率加权参照" : "当前参照"}：胜率 ${percent(ref.p)}，平均盈利 ${percent(gross.win)}，计划亏损 ${percent(gross.loss)}，毛盈亏比 ${(gross.win / gross.loss).toFixed(2)}。计入止损收紧、预期滑点和成本后，估计普通盈利 ${percent(ref.gain)}、普通亏损 ${percent(ref.loss)}。另设每笔 ${percent(config.tailProbability)} 概率净跌 ${percent(config.tailLoss)}；${config.trades} 笔中的预期事件数为 ${(config.trades * config.tailProbability).toFixed(1)}，仅是情景参数的算术结果。`;
    $("positionExample").textContent = `仓位是买入金额占账户资金比例。当前${methodName}解 ${percent(ref.selected)}，计划账户风险上限 ${percent(config.cap)}，实际全凯利买入 ${percent(fullAllocation)}。极端事件可突破计划止损；满仓遇标的净跌 ${percent(config.tailLoss)} 时，账户也约跌 ${percent(config.tailLoss)}。`;
    $("pathInsight").textContent = config.trades ? `首条路径：${config.trades} 笔中判定盈利 ${results.exampleWins} 笔（${percent(results.exampleWins / config.trades)}），极端事件 ${results.exampleTailEvents} 笔，最长连续亏损 ${results.exampleLongestLoss} 笔。${config.mode === "market" ? "状态有持续性；仓位只依据信号更新后的概率。" : config.mode === "estimate" ? "本路径真实胜率由后验抽取后固定。" : "每笔普通输赢独立抽样，连续亏损仍可能发生。"}` : "零交易：资金保持初始值。";
    $("focusStrategy").innerHTML = results.strategies.map(r => `<option value="${r.id}">${r.name}</option>`).join("");
    $("focusStrategy").value = focused;
    $("growthBest").textContent = results.growth.sampleCount ? `样本内峰值 ${percent(results.growth.best.allocation)} 仓位` : "暂无交易样本";
    $("growthMethod").textContent = `青绿实线为同批模拟结果的经验增长；灰色虚线为忽略尾部事件的理想两点模型。青绿圆点为样本峰值，琥珀色点划线为当前${methodName}模型解，红色虚线为${config.mode === "market" ? "示例路径首笔" : "当前"}全凯利实际仓位。模型解与实际执行仓位可能因风险上限而不同。`;
    $("heatDescription").textContent = config.mode === "market" ? "以普通状态及当前执行假设为参照，横轴按全凯利估计仓位" : "以当前盈亏幅度、动态止损、滑点和成本为参照，横轴按全凯利估计仓位";
    $("heatLegend").innerHTML = `<div class="heat-legend"></div><div class="heat-legend-label"><span>${metric === "growth" ? "较低增长" : "较高风险"}</span><span>${metric === "growth" ? "较高增长" : "较低风险"}</span></div>`;
    renderCharts();
    renderPortfolio();
  }
  function renderPortfolio() {
    if (!portfolioResults || config.mode !== "market") { $("portfolioSummary").innerHTML = ""; $("portfolioExecutionStats").textContent = ""; return; }
    $("portfolioSummary").innerHTML = portfolioResults.results.map(r => `<tr><td><i class="strategy-dot" style="--color:${r.color}"></i>${r.name}</td><td>${money(r.q05)}</td><td>${money(r.q50)}</td><td>${money(r.q95)}</td><td>${percent(r.dd50)} / ${percent(r.dd95)}</td></tr>`).join("");
    const signal = portfolioResults.results[1];
    $("portfolioExecutionStats").textContent = `信号概率配置：打板下单 ${signal.attempts} 次，成交 ${signal.fills} 次（${signal.attempts ? percent(signal.fills / signal.attempts) : "—"}），亏损单退出受阻 ${signal.blocked} 次。未成交的订单不承担该笔打板盈亏。`;
    $("portfolioLegend").innerHTML = portfolioResults.results.map(r => `<span><i style="--color:${r.color}"></i>${r.name}</span>`).join("") + `<span class="portfolio-allocation-key">打板 · 波段 · 趋势 · 现金</span>`;
    C.lineChart($("portfolioEquity"), portfolioResults.results.map(r => ({ ...r, visible: true, focused: r.id === "signal" })), config, "equity", scale, null);
    C.allocationChart($("portfolioAllocation"), portfolioResults.results[1].example, config.trades);
  }
  function updateHistory() {
    if (config.mode !== "market" || !historyData) return;
    const modelError = validatePortfolio();
    if (modelError) { $("historyStatus").textContent = modelError; historyResults = null; renderHistory(); return; }
    try {
      historyResults = H.walkForward(historyData, portfolioModel(), config.initial, Number($("historyWindow").value), Number($("historyWarmup").value));
      $("historyStatus").textContent = `${historyData.days.length} 个日期 · ${historyData.records.length} 条记录 · 至少两种策略同日亏损 ${historyData.sharedLossDays} 天。检验区间 ${historyResults.start} 至 ${historyResults.end}，共 ${historyResults.trades} 期。`;
    } catch (error) { historyResults = null; $("historyStatus").textContent = error.message; }
    renderHistory();
  }
  function renderHistory() {
    $("historyChartFrame").classList.toggle("hidden", !historyResults);
    if (!historyData) { $("historyStats").innerHTML = ""; $("historySummary").innerHTML = ""; return; }
    $("historyStats").innerHTML = `<table><thead><tr><th>全样本诊断</th><th>信号</th><th>成交</th><th>持仓期</th><th>成交率</th><th>净盈利期率</th><th>平均净盈利</th><th>平均净亏损</th><th>平均成本</th></tr></thead><tbody>${historyData.stats.map(s => `<tr><td>${s.name}</td><td>${s.signals}</td><td>${s.fills}</td><td>${s.active}</td><td>${percent(s.fillRate)}</td><td>${percent(s.winRate)}</td><td>${percent(s.meanWin)}</td><td>${percent(s.meanLoss)}</td><td>${percent(s.meanCost)}</td></tr>`).join("")}</tbody></table>`;
    if (!historyResults) { $("historySummary").innerHTML = ""; const canvas = $("historyChart"), context = canvas.getContext("2d"); context.clearRect(0, 0, canvas.width, canvas.height); return; }
    $("historySummary").innerHTML = `<table><thead><tr><th>逐期检验规则</th><th>期末资金</th><th>区间收益</th><th>最大回撤</th></tr></thead><tbody>${historyResults.results.map(r => `<tr><td><i class="strategy-dot" style="--color:${r.color}"></i>${r.name}</td><td>${money(r.wealth)}</td><td>${percent(r.wealth / config.initial - 1)}</td><td>${percent(r.maxDrawdown)}</td></tr>`).join("")}</tbody></table>`;
    C.lineChart($("historyChart"), historyResults.results.map(r => ({ ...r, visible: true, focused: r.id === "empirical" })), { initial: config.initial, trades: historyResults.trades }, "equity", scale, null);
  }
  function renderLegend() { $("legend").querySelectorAll("button").forEach(b => { b.classList.toggle("off", !visibility[b.dataset.strategy]); b.classList.toggle("focused", focused === b.dataset.strategy); b.setAttribute("aria-pressed", visibility[b.dataset.strategy]); }); }
  function renderPathCharts() {
    if (!results) return;
    const rows = results.strategies.map(r => ({ ...r, visible: visibility[r.id], focused: focused === r.id }));
    C.lineChart($("equityChart"), rows, config, "equity", scale, hover);
    C.lineChart($("riskChart"), rows, config, "risk", scale, hover);
    C.lineChart($("drawdownChart"), rows, config, "drawdown", scale, hover);
    if (config.mode === "market") C.probabilityChart($("probabilityChart"), results.strategies[0].example, config.trades, hover);
    const full = results.strategies.find(r => r.id === "full");
    const index = config.trades ? Math.max(1, hover || 1) : 0;
    $("riskReadout").textContent = `${config.trades ? `第 ${index} 笔` : "零交易"} · 全凯利买入 ${percent(full.example[index].f)} · 计划风险 ${percent(full.example[index].risk)}`;
  }
  function renderCharts() {
    renderPathCharts();
    C.distribution($("distributionChart"), results.strategies, config.initial);
    renderHistogram();
    const full = results.strategies.find(r => r.id === "full");
    C.growthChart($("growthChart"), { ...results.growth, ideal: results.ideal }, { full: full.example[config.trades ? 1 : 0].f, current: results.displayReference.selected });
    C.heatmap($("heatChart"), heatData, metric);
  }
  function renderHistogram() {
    if (!results) return;
    const strategy = results.strategies.find(r => r.id === focused), data = S.finalHistogram(strategy.finals, config.initial);
    C.histogramOverlay($("histogramOverlayChart"), results.strategies.map(r => ({ data: S.finalHistogram(r.finals, config.initial), color: r.color, dash: r.dash, focused: r.id === focused })));
    C.histogram($("histogramChart"), data, strategy.color, config.initial);
    $("histogramCount").textContent = `${strategy.name} · ${data.total} 次`;
    $("histogramNote").textContent = `最终金额为零或数值下溢 ${data.zero} 次（${percent(data.zero / data.total)}）；绘图区间外较低 ${data.leftTail} 次、较高 ${data.rightTail} 次，均计入统计。柱状图按最终资金的对数等宽分组；对数正态线仅对正资金样本做矩估计，并按全部模拟次数缩放，不包含零值。全部路径都计入，未剔除失败样本。`;
  }
  function showTip(event) {
    if (!results) return;
    const canvas = event.currentTarget, box = canvas.getBoundingClientRect(), x = event.clientX - box.left, left = 54, right = box.width - 13;
    if (x < left || x > right) { hideTip(); return; }
    const next = Math.max(0, Math.min(config.trades, Math.round((x - left) / (right - left) * config.trades)));
    const currentTip = canvas === $("riskChart") ? $("riskTip") : $("equityTip");
    if (hover === next && !currentTip.classList.contains("hidden")) return;
    hover = next;
    const rows = results.strategies.filter(r => visibility[r.id]);
    const sample = rows[0]?.example[hover], eventText = !hover ? "起点" : !sample ? "未选择曲线" : sample.r === null ? "已归零，未再交易" : `${sample.tail ? "极端事件 · " : ""}标的净涨跌 ${sample.r >= 0 ? "+" : ""}${percent(sample.r)}`;
    const tip = canvas === $("riskChart") ? $("riskTip") : $("equityTip");
    $("riskTip").classList.add("hidden"); $("equityTip").classList.add("hidden");
    tip.innerHTML = `<strong>第 ${hover} 笔 · ${eventText}</strong>${config.mode === "market" && sample?.probabilities ? `<span>交易前信号 ${stateNames[sample.signal]} · 估计顺/普/逆 ${sample.probabilities.map(percent).join(" / ")}<br>事后真实状态 ${stateNames[sample.state]}</span>` : ""}` + rows.map(r => { const d = r.example[hover]; return `<span style="color:${r.color}">${r.name} · 买入 ${percent(d.f)} · 计划风险 ${percent(d.risk)}<br>本笔账户 ${d.r === null ? "—" : `${d.f * d.r >= 0 ? "+" : ""}${percent(d.f * d.r)}`} · ${money(d.wealth)} · 回撤 ${percent(d.drawdown)}</span>`; }).join("");
    tip.classList.remove("hidden"); tip.style.left = `${Math.max(4, Math.min(x + 12, box.width - 235))}px`; tip.style.top = `${Math.max(5, Math.min(event.clientY - box.top - 55, box.height - 28))}px`;
    renderPathCharts();
  }
  function hideTip() { hover = null; $("equityTip").classList.add("hidden"); $("riskTip").classList.add("hidden"); renderPathCharts(); }
  $("modeTabs").addEventListener("click", e => { const m = e.target.dataset.mode; if (!m) return; config.mode = m; buildFields(); update(); });
  $("scaleTabs").addEventListener("click", e => { const s = e.target.dataset.scale; if (!s) return; scale = s; $("scaleTabs").querySelectorAll("button").forEach(b => b.classList.toggle("active", b.dataset.scale === s)); renderCharts(); renderPortfolio(); renderHistory(); });
  $("heatMetric").addEventListener("change", e => { metric = e.target.value; heatData = S.sensitivity(config, metric); render(); });
  $("focusStrategy").addEventListener("change", e => { focused = e.target.value; renderLegend(); renderPathCharts(); renderHistogram(); });
  $("preset").addEventListener("change", e => { if (e.target.value === "custom") return; const p = presets[e.target.value]; Object.assign(config, structuredClone(p)); config.b = config.win / config.stop; buildFields(); update(); });
  $("historyFile").addEventListener("change", async event => {
    const file = event.target.files[0];
    if (!file) return;
    try { historyData = H.parse(await file.text()); updateHistory(); }
    catch (error) { historyData = null; historyResults = null; $("historyStatus").textContent = error.message; renderHistory(); }
  });
  ["historyWindow", "historyWarmup"].forEach(id => $(id).addEventListener("change", updateHistory));
  $("reset").addEventListener("click", () => { config = structuredClone(defaults); portfolio = structuredClone(portfolioDefaults); historyData = null; historyResults = null; $("historyFile").value = ""; $("historyWindow").value = "60"; $("historyWarmup").value = "20"; $("historyStatus").textContent = "尚未导入历史记录。"; renderHistory(); scale = "log"; metric = "growth"; hover = null; focused = "full"; Object.keys(visibility).forEach(k => visibility[k] = true); $("preset").value = "custom"; $("heatMetric").value = "growth"; $("scaleTabs").querySelectorAll("button").forEach(b => b.classList.toggle("active", b.dataset.scale === "log")); buildFields(); buildPortfolioControls(); update(); });
  ["equityChart", "riskChart"].forEach(id => { $(id).addEventListener("mousemove", showTip); $(id).addEventListener("mouseleave", hideTip); });
  window.addEventListener("resize", () => { clearTimeout(timer); timer = setTimeout(() => { renderCharts(); renderPortfolio(); renderHistory(); }, 70); });
  const requestedMode = new URLSearchParams(location.search).get("mode");
  if (["basic", "estimate", "market"].includes(requestedMode)) config.mode = requestedMode;
  buildFields(); buildPortfolioControls(); update();
})();

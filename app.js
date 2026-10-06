(function () {
  "use strict";
  const S = window.KellySim, C = window.KellyCharts, $ = id => document.getElementById(id);
  const defaults = { mode: "basic", kellyMethod: "distribution", p: .6, win: .15, b: 1.5, stop: .1, trades: 200, initial: 10000, runs: 300, seed: 2026, cap: .05, superMultiplier: 1.5, history: 100, wins: 60, cost: .002, slippage: .02, trailCoverage: .3, tightStop: .03, variation: .2, states: [{ p: .72, win: .18, loss: .08, stay: .8 }, { p: .6, win: .15, loss: .1, stay: .72 }, { p: .43, win: .1, loss: .12, stay: .84 }] };
  const presets = {
    small: { p: .55, win: .12, stop: .1, history: 100, wins: 55, states: [{ p: .64, win: .15, loss: .08, stay: .8 }, { p: .54, win: .12, loss: .1, stay: .72 }, { p: .4, win: .08, loss: .12, stay: .84 }] },
    high: { p: .75, win: .08, stop: .1, history: 100, wins: 75, states: [{ p: .81, win: .1, loss: .08, stay: .8 }, { p: .74, win: .08, loss: .1, stay: .72 }, { p: .62, win: .06, loss: .12, stay: .84 }] },
    low: { p: .36, win: .22, stop: .08, history: 100, wins: 36, states: [{ p: .44, win: .27, loss: .07, stay: .8 }, { p: .35, win: .22, loss: .08, stay: .72 }, { p: .25, win: .16, loss: .1, stay: .84 }] },
    over: { p: .6, win: .08, stop: .1, history: 20, wins: 15, states: [{ p: .58, win: .11, loss: .09, stay: .8 }, { p: .48, win: .08, loss: .1, stay: .72 }, { p: .35, win: .06, loss: .13, stay: .88 }] }
  };
  let config = structuredClone(defaults), results = null, heatData = null, scale = "log", metric = "growth", hover = null, timer = null, focused = "full";
  const visibility = Object.fromEntries(S.strategies.map(x => [x.id, true]));
  const percent = v => `${(v * 100).toFixed(1)}%`;
  const money = v => !Number.isFinite(v) ? "—" : v >= Math.exp(700) ? "≥¥1.01×10³⁰⁴" : v >= 1e12 ? `¥${v.toExponential(2)}` : `¥${v.toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`;
  const specs = {
    p: ["胜率 p", 1, 99, 1, "%", 100], win: ["平均盈利", .5, 100, .5, "%", 100], stop: ["计划亏损 / 止损", .5, 50, .5, "%", 100], b: ["毛盈亏比 b", .05, 200, .05, "倍", 1], history: ["历史交易笔数", 0, 2000, 1, "笔", 1], wins: ["其中盈利笔数", 0, 2000, 1, "笔", 1],
    trades: ["交易次数", 0, 10000, 1, "笔", 1], initial: ["初始资金", 1000, 10000000, 1000, "元", 1], runs: ["重复模拟次数", 20, 1000, 10, "次", 1], seed: ["随机种子", 0, 4294967295, 1, "", 1], cap: ["每笔计划账户风险上限", .5, 50, .5, "%", 100], superMultiplier: ["超凯利倍数", 1.05, 3, .05, "倍", 1], cost: ["往返交易成本", 0, 2, .05, "%", 100], slippage: ["亏损执行额外滑点上限", 0, 20, .5, "%", 100], trailCoverage: ["亏损单止损收紧覆盖率", 0, 100, 1, "%", 100], tightStop: ["收紧后亏损幅度", .1, 50, .1, "%", 100], variation: ["盈亏幅度波动", 0, 50, 1, "%", 100]
  };
  const stateNames = ["顺风", "普通", "逆风"];
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
    $("marketFields").innerHTML = config.states.map((state, i) => `<div class="state-group"><h3>${stateNames[i]}状态</h3>${field(`states.${i}.p`, "胜率", 1, 99, 1, "%", 100)}${field(`states.${i}.win`, "平均盈利", .5, 100, .5, "%", 100)}${field(`states.${i}.loss`, "平均亏损", .5, 50, .5, "%", 100)}${field(`states.${i}.stay`, "持续倾向", 0, 99, 1, "%", 100)}</div>`).join("");
    $("commonFields").innerHTML = `<label class="field"><span>凯利计算方法</span><select data-key="kellyMethod" aria-label="凯利计算方法"><option value="twoPoint" ${config.kellyMethod === "twoPoint" ? "selected" : ""}>两点凯利（平均盈亏）</option><option value="distribution" ${config.kellyMethod === "distribution" ? "selected" : ""}>多点 / 分布凯利（执行分布）</option></select><small>分布凯利会把波动、收紧止损、滑点和成本纳入求解</small></label>` + field("trades", ...specs.trades) + field("initial", ...specs.initial) + field("runs", ...specs.runs) + `<p class="field-hint">交易次数 × 重复次数最多 300 万笔</p>` + field("seed", ...specs.seed, false) + field("cap", ...specs.cap) + `<p class="field-hint">按估计亏损控制；跳空滑点可能使实际亏损超出上限</p>` + field("superMultiplier", ...specs.superMultiplier) + field("cost", ...specs.cost) + field("slippage", ...specs.slippage) + field("trailCoverage", ...specs.trailCoverage) + field("tightStop", ...specs.tightStop) + field("variation", ...specs.variation);
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
    const common = ["trades", "initial", "runs", "seed", "cap", "superMultiplier", "cost", "slippage", "trailCoverage", "tightStop", "variation"];
    for (const key of [...keys, ...common]) { const s = specs[key], v = get(key) * s[5]; if (!Number.isFinite(v) || v < s[1] - 1e-8 || v > s[2] + 1e-8 || (["history", "wins", "trades", "runs", "seed", "initial"].includes(key) && !Number.isInteger(v))) return `${s[0]}请输入 ${s[1]}–${s[2]}${s[4]}范围内的有效值。`; }
    if (config.wins > config.history && config.mode === "estimate") return "盈利笔数不能超过历史交易笔数。";
    if (config.trades * config.runs > 3000000) return "单次最多处理 300 万笔交易结果；请降低交易次数或重复模拟次数。";
    if (config.mode === "market") for (let i = 0; i < 3; i++) for (const [name, min, max] of [["p", .01, .99], ["win", .005, 1], ["loss", .005, .5], ["stay", 0, .99]]) { const v = config.states[i][name]; if (!Number.isFinite(v) || v < min - 1e-8 || v > max + 1e-8) return `${stateNames[i]}状态的${name}超出有效范围。`; }
    return "";
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(update, 120); }
  function update() {
    const error = validate(), notice = $("validation");
    if (error) { notice.className = "notice error"; notice.textContent = error; return; }
    results = S.simulate(config);
    heatData = S.sensitivity(config, metric);
    notice.className = "notice";
    const messages = [];
    if (results.reference.practical <= 0) messages.push("扣除执行成本后当前估计无正优势，实际凯利仓位为 0；固定风险 1% 与满仓仍承担风险。");
    if (config.cost >= (config.mode === "market" ? Math.min(...config.states.map(s => s.win)) : config.win) * (1 - config.variation)) messages.push("部分盈利交易的毛收益可能低于往返成本，扣费后也可能出现净亏损。");
    if (config.trades === 0) messages.push("交易次数为 0，各策略资金保持初始值，回撤为 0。");
    if (results.theoreticalAllocation > 1) messages.push("理论凯利买入占比超过 100%，普通策略按无杠杆上限和计划风险上限收敛。");
    if (config.mode === "market" && config.states.some((_, i) => S.reference(config, i).allocation === 0)) messages.push("部分市场状态扣费后无正优势，该状态凯利仓位为 0。");
    if (results.reference.practical * results.reference.loss * config.superMultiplier > config.cap) messages.push("超凯利仓位可能触及计划账户风险上限。");
    if (config.trailCoverage > 0 && config.mode !== "market" && config.tightStop >= config.stop) messages.push("收紧后亏损不小于计划止损，动态止损不会减少这类亏损。");
    if (results.strategies.some(s => s.clipped)) messages.push("极端路径的图表金额已截断显示；回撤仍按对数资金计算。");
    notice.textContent = messages.join(" ") || "七种策略使用相同净涨跌幅；固定种子可复现。实际亏损可因滑点超出计划风险。";
    if (messages.length) notice.classList.add("warning");
    render();
  }
  function render() {
    const ref = results.reference;
    const fullAllocation = S.allocation({ id: "full", factor: 1 }, { estimated: ref.selected, estimatedLoss: ref.loss }, config);
    $("kellyValue").textContent = percent(results.theoretical);
    $("kellyContext").textContent = `当前${config.kellyMethod === "twoPoint" ? "两点" : "分布"}凯利买入 ${percent(ref.selected)} · 两点参照 ${percent(ref.allocation)} · 分布参照 ${percent(ref.practical)} · 实际全凯利买入 ${percent(fullAllocation)}${config.mode === "estimate" ? " · 按历史估计" : config.mode === "market" ? " · 普通状态" : ""}`;
    $("posterior").classList.toggle("hidden", config.mode !== "estimate");
    if (config.mode === "estimate") $("posterior").innerHTML = `胜率后验 Beta(${ref.posterior.a}, ${ref.posterior.b})<br><strong>估计 ${percent(ref.p)}</strong> · 95% 可信区间 ${percent(ref.posterior.low)}–${percent(ref.posterior.high)}`;
    $("runCount").textContent = `${config.runs} 次`;
    $("summaryBody").innerHTML = results.strategies.map(r => `<tr><td><i class="strategy-dot" style="--color:${r.color}"></i>${r.name}</td><td>${money(r.q50)}</td><td><span class="stat-pair">${percent(r.dd50)}<small>${percent(r.dd95)}</small></span></td><td><span class="stat-pair">${percent(r.halfRate)}<small>${percent(r.ruinRate)}</small></span></td></tr>`).join("");
    $("distributionStats").innerHTML = results.strategies.map(r => `<tr class="${focused === r.id ? "selected" : ""}"><td><i class="strategy-dot" style="--color:${r.color}"></i>${r.name}</td><td>${money(r.mean)}</td><td>${money(r.q05)}</td><td>${money(r.q50)}</td><td>${money(r.q95)}</td><td>${percent(r.halfRate)}</td><td>${percent(r.ruinRate)}</td></tr>`).join("");
    $("legend").innerHTML = results.strategies.map(r => `<button type="button" data-strategy="${r.id}" class="${visibility[r.id] ? "" : "off"} ${focused === r.id ? "focused" : ""}" aria-pressed="${visibility[r.id]}" title="显示或隐藏${r.name}"><svg width="25" height="8" aria-hidden="true"><line x1="1" y1="4" x2="24" y2="4" stroke="${r.color}" stroke-width="3" ${r.dash.length ? `stroke-dasharray="${r.dash.join(" ")}"` : ""}/></svg>${r.name}</button>`).join("");
    $("legend").querySelectorAll("button").forEach(b => b.addEventListener("click", () => { visibility[b.dataset.strategy] = !visibility[b.dataset.strategy]; renderPathCharts(); renderLegend(); }));
    const gross = config.mode === "market" ? config.states[1] : { win: config.win, loss: config.stop };
    $("workedExample").textContent = `当前参照：胜率 ${percent(ref.p)}，平均盈利 ${percent(gross.win)}，计划亏损 ${percent(gross.loss)}，毛盈亏比 ${(gross.win / gross.loss).toFixed(2)}。计入止损收紧、预期滑点和成本后，估计单笔净盈利 ${percent(ref.gain)}、平均净亏损 ${percent(ref.loss)}。`;
    $("positionExample").textContent = `仓位是买入金额占账户资金比例。当前${config.kellyMethod === "twoPoint" ? "两点" : "分布"}凯利买入 ${percent(ref.selected)}，两点参照账户风险 ${percent(ref.risk)}；实际仓位再受 ${percent(config.cap)} 计划风险上限约束。满仓时标的净跌 10%，账户约跌 10%；滑点可使亏损扩大。`;
    $("pathInsight").textContent = config.trades ? `首条路径：${config.trades} 笔中判定盈利 ${results.exampleWins} 笔（${percent(results.exampleWins / config.trades)}），最长连续亏损 ${results.exampleLongestLoss} 笔。${config.mode === "market" ? "状态有持续性，可能出现连续逆风。" : config.mode === "estimate" ? "本路径真实胜率由后验抽取后固定。" : "每笔输赢独立抽样，连续亏损仍可能发生。"} 当前参照假设每笔持仓净涨跌的均值约 ${percent(ref.p * ref.gain - (1 - ref.p) * ref.loss)}；若优势不能长期维持，复利曲线会明显改变。` : "零交易：资金保持初始值。";
    $("focusStrategy").innerHTML = results.strategies.map(r => `<option value="${r.id}">${r.name}</option>`).join("");
    $("focusStrategy").value = focused;
    $("growthBest").textContent = results.growth.sampleCount ? `样本内峰值 ${percent(results.growth.best.allocation)} 仓位` : "暂无交易样本";
    $("growthMethod").textContent = `按同批模拟结果中 ${results.growth.sampleCount.toLocaleString("zh-CN")} 笔持仓净涨跌幅计算${config.trades * config.runs > 50000 ? "（随机抽样）" : ""}；含止损、滑点和成本。青绿虚线为样本峰值，红色虚线为${config.mode === "market" ? "示例路径首笔" : "当前"}全凯利受约束后的买入占比。${ref.allocation > 1 ? "按平均盈亏计算的无约束凯利买入占比超出无杠杆范围，图中 0–100% 区间可能持续上升。" : ""}`;
    $("heatDescription").textContent = config.mode === "market" ? "以普通状态及当前执行假设为参照，横轴按全凯利估计仓位" : "以当前盈亏幅度、动态止损、滑点和成本为参照，横轴按全凯利估计仓位";
    $("heatLegend").innerHTML = `<div class="heat-legend"></div><div class="heat-legend-label"><span>${metric === "growth" ? "较低增长" : "较高风险"}</span><span>${metric === "growth" ? "较高增长" : "较低风险"}</span></div>`;
    renderCharts();
  }
  function renderLegend() { $("legend").querySelectorAll("button").forEach(b => { b.classList.toggle("off", !visibility[b.dataset.strategy]); b.classList.toggle("focused", focused === b.dataset.strategy); b.setAttribute("aria-pressed", visibility[b.dataset.strategy]); }); }
  function renderPathCharts() {
    if (!results) return;
    const rows = results.strategies.map(r => ({ ...r, visible: visibility[r.id], focused: focused === r.id }));
    C.lineChart($("equityChart"), rows, config, "equity", scale, hover);
    C.lineChart($("riskChart"), rows, config, "risk", scale, hover);
    C.lineChart($("drawdownChart"), rows, config, "drawdown", scale, hover);
    const full = results.strategies.find(r => r.id === "full");
    const index = config.trades ? Math.max(1, hover || 1) : 0;
    $("riskReadout").textContent = `${config.trades ? `第 ${index} 笔` : "零交易"} · 全凯利买入 ${percent(full.example[index].f)} · 计划风险 ${percent(full.example[index].risk)}`;
  }
  function renderCharts() {
    renderPathCharts();
    C.distribution($("distributionChart"), results.strategies, config.initial);
    renderHistogram();
    const full = results.strategies.find(r => r.id === "full");
    C.growthChart($("growthChart"), results.growth, { full: full.example[config.trades ? 1 : 0].f });
    C.heatmap($("heatChart"), heatData, metric);
  }
  function renderHistogram() {
    if (!results) return;
    const strategy = results.strategies.find(r => r.id === focused), data = S.finalHistogram(strategy.finals, config.initial);
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
    const sample = rows[0]?.example[hover], eventText = !hover ? "起点" : !sample ? "未选择曲线" : sample.r === null ? "已归零，未再交易" : `标的净涨跌 ${sample.r >= 0 ? "+" : ""}${percent(sample.r)}`;
    const tip = canvas === $("riskChart") ? $("riskTip") : $("equityTip");
    $("riskTip").classList.add("hidden"); $("equityTip").classList.add("hidden");
    tip.innerHTML = `<strong>第 ${hover} 笔 · ${eventText}</strong>` + rows.map(r => { const d = r.example[hover]; return `<span style="color:${r.color}">${r.name} · 买入 ${percent(d.f)} · 计划风险 ${percent(d.risk)}<br>本笔账户 ${d.r === null ? "—" : `${d.f * d.r >= 0 ? "+" : ""}${percent(d.f * d.r)}`} · ${money(d.wealth)} · 回撤 ${percent(d.drawdown)}</span>`; }).join("");
    tip.classList.remove("hidden"); tip.style.left = `${Math.max(4, Math.min(x + 12, box.width - 235))}px`; tip.style.top = `${Math.max(5, Math.min(event.clientY - box.top - 55, box.height - 28))}px`;
    renderPathCharts();
  }
  function hideTip() { hover = null; $("equityTip").classList.add("hidden"); $("riskTip").classList.add("hidden"); renderPathCharts(); }
  $("modeTabs").addEventListener("click", e => { const m = e.target.dataset.mode; if (!m) return; config.mode = m; buildFields(); update(); });
  $("scaleTabs").addEventListener("click", e => { const s = e.target.dataset.scale; if (!s) return; scale = s; $("scaleTabs").querySelectorAll("button").forEach(b => b.classList.toggle("active", b.dataset.scale === s)); renderCharts(); });
  $("heatMetric").addEventListener("change", e => { metric = e.target.value; heatData = S.sensitivity(config, metric); render(); });
  $("focusStrategy").addEventListener("change", e => { focused = e.target.value; renderLegend(); renderPathCharts(); renderHistogram(); });
  $("preset").addEventListener("change", e => { if (e.target.value === "custom") return; const p = presets[e.target.value]; Object.assign(config, structuredClone(p)); config.b = config.win / config.stop; buildFields(); update(); });
  $("reset").addEventListener("click", () => { config = structuredClone(defaults); scale = "log"; metric = "growth"; hover = null; focused = "full"; Object.keys(visibility).forEach(k => visibility[k] = true); $("preset").value = "custom"; $("heatMetric").value = "growth"; $("scaleTabs").querySelectorAll("button").forEach(b => b.classList.toggle("active", b.dataset.scale === "log")); buildFields(); update(); });
  ["equityChart", "riskChart"].forEach(id => { $(id).addEventListener("mousemove", showTip); $(id).addEventListener("mouseleave", hideTip); });
  window.addEventListener("resize", () => { clearTimeout(timer); timer = setTimeout(renderCharts, 70); });
  buildFields(); update();
})();

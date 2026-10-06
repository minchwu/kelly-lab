(function (root) {
  "use strict";
  const fmt = n => n >= 1e12 ? n.toExponential(1) : Number(n).toLocaleString("zh-CN", { notation: "compact", maximumFractionDigits: 1 });
  function setup(canvas) { const dpr = Math.min(devicePixelRatio || 1, 2), w = canvas.clientWidth, h = canvas.clientHeight; canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); const ctx = canvas.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h); return { ctx, w, h }; }
  function text(ctx, value, x, y, align = "left", color = "#718083", size = 10) { ctx.fillStyle = color; ctx.font = `${size}px Microsoft YaHei, sans-serif`; ctx.textAlign = align; ctx.fillText(value, x, y); }
  function grid(ctx, x0, y0, x1, y1, rows = 4) { ctx.strokeStyle = "#e9eeee"; ctx.lineWidth = 1; for (let i = 0; i <= rows; i++) { const y = y0 + (y1 - y0) * i / rows; ctx.beginPath(); ctx.moveTo(x0, y + .5); ctx.lineTo(x1, y + .5); ctx.stroke(); } }
  function drawSeries(ctx, path, kind, xp, yp, width) {
    const value = d => kind === "equity" ? d.wealth : kind === "risk" ? d.f : d.drawdown;
    const first = kind === "risk" && path.length > 1 ? 1 : 0;
    const stride = Math.max(1, Math.floor((path.length - first) / Math.max(1, width)));
    let started = false;
    const plot = i => { const x = xp(i), y = yp(value(path[i])); started ? ctx.lineTo(x, y) : ctx.moveTo(x, y); started = true; };
    ctx.beginPath();
    for (let start = first; start < path.length; start += stride) {
      const end = Math.min(path.length, start + stride);
      let low = start, high = start;
      for (let i = start + 1; i < end; i++) { if (value(path[i]) < value(path[low])) low = i; if (value(path[i]) > value(path[high])) high = i; }
      const indices = [...new Set([start, low, high, end - 1])].sort((a, b) => a - b);
      indices.forEach(plot);
    }
    ctx.stroke();
  }
  function lineChart(canvas, results, config, kind, scale, hover) {
    const { ctx, w, h } = setup(canvas), active = results.filter(r => r.visible);
    const left = 54, right = w - 13, top = 18, bottom = h - 29, trades = config.trades;
    grid(ctx, left, top, right, bottom);
    let min = kind === "equity" ? config.initial : 0;
    let max = kind === "equity" ? config.initial : .05;
    active.forEach(r => r.example.forEach(d => { const v = kind === "equity" ? d.wealth : kind === "risk" ? d.f : d.drawdown; min = Math.min(min, v); max = Math.max(max, v); }));
    if (kind === "equity") { min = Math.max(1e-8, min * .92); max *= 1.08; if (max <= min) max = min * 1.1; }
    const transform = v => kind === "equity" && scale === "log" ? Math.log(Math.max(v, 1e-8)) : v;
    const lo = transform(min), hi = transform(max);
    const xp = i => left + (right - left) * (trades ? i / trades : 0);
    const yp = v => bottom - (transform(v) - lo) / (hi - lo || 1) * (bottom - top);
    for (let i = 0; i <= 4; i++) { const frac = 1 - i / 4; const val = kind === "equity" && scale === "log" ? Math.exp(lo + frac * (hi - lo)) : min + frac * (max - min); text(ctx, kind === "equity" ? fmt(val) : `${(val * 100).toFixed(0)}%`, left - 8, top + i * (bottom - top) / 4 + 3, "right"); }
    for (let i = 0; i <= 4; i++) text(ctx, String(Math.round(trades * i / 4)), xp(trades * i / 4), h - 8, "center");
    if (kind === "equity") { ctx.strokeStyle = "#b6c9c0"; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(left, yp(config.initial)); ctx.lineTo(right, yp(config.initial)); ctx.stroke(); ctx.setLineDash([]); }
    active.filter(r => !r.focused).concat(active.filter(r => r.focused)).forEach(r => { ctx.strokeStyle = r.color; ctx.globalAlpha = r.focused ? 1 : .66; ctx.lineWidth = r.focused ? 3 : 1.65; ctx.setLineDash(r.dash || []); drawSeries(ctx, r.example, kind, xp, yp, right - left); ctx.setLineDash([]); ctx.globalAlpha = 1; });
    if (hover !== null && hover !== undefined) { const x = xp(hover); ctx.strokeStyle = "#6b817e"; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke(); ctx.setLineDash([]); active.forEach(r => { const d = r.example[hover]; if (!d) return; ctx.fillStyle = r.color; ctx.beginPath(); ctx.arc(x, yp(kind === "equity" ? d.wealth : kind === "risk" ? d.f : d.drawdown), 3.5, 0, Math.PI * 2); ctx.fill(); }); }
    return { left, right, trades };
  }
  function distribution(canvas, results, initial) {
    const { ctx, w, h } = setup(canvas), left = Math.min(126, w * .3), origin = left + 16, right = w - 24, top = 29, bottom = h - 29;
    const all = results.flatMap(r => r.finals), nonzero = all.filter(v => Number.isFinite(v) && v > 0);
    const min = Math.max(1e-8, Math.min(initial * .5, ...nonzero)), max = Math.max(initial * 1.5, ...nonzero);
    const lo = Math.log(min), hi = Math.log(max), xp = v => v <= 0 ? left : origin + (Math.log(Math.max(v, min)) - lo) / (hi - lo || 1) * (right - origin);
    grid(ctx, origin, top, right, bottom, 4);
    text(ctx, "0", left, h - 7, "center");
    for (let i = 0; i <= 4; i++) text(ctx, fmt(Math.exp(lo + i * (hi - lo) / 4)), origin + i * (right - origin) / 4, h - 7, "center");
    results.forEach((r, index) => {
      const y = top + (index + .5) * (bottom - top) / results.length;
      text(ctx, r.name, left - 9, y + 4, "right", "#36474a", w < 480 ? 9 : 11);
      ctx.fillStyle = r.color + "65";
      r.finals.forEach((v, i) => { const jitter = ((i * 17 % 13) - 6) * 1.5; ctx.beginPath(); ctx.arc(xp(v), y + jitter, 2, 0, Math.PI * 2); ctx.fill(); });
      ctx.strokeStyle = r.color; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(xp(r.q05), y); ctx.lineTo(xp(r.q95), y); ctx.stroke();
      [r.q05, r.q50, r.q95].forEach((v, i) => { ctx.fillStyle = i === 1 ? "#fff" : r.color; ctx.strokeStyle = r.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(xp(v), y, i === 1 ? 5 : 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); });
    });
    text(ctx, "最终资金 · 对数横轴", right, 13, "right");
  }
  function histogram(canvas, data, color, initial) {
    const { ctx, w, h } = setup(canvas), left = 54, right = w - 18, top = 25, bottom = h - 34;
    grid(ctx, left, top, right, bottom);
    if (!data.bars.length) { text(ctx, "无正资金结果；归零次数见图下说明", left + 12, (top + bottom) / 2); return; }
    const max = Math.max(.05, ...data.bars.map(x => x.probability), ...data.smooth.map(x => x.probability), ...data.lognormal.map(x => x.probability)) * 1.18;
    const xp = x => left + (x - data.lo) / (data.hi - data.lo) * (right - left);
    const yp = p => bottom - p / max * (bottom - top);
    for (let i = 0; i <= 4; i++) { const multiple = Math.exp(data.lo + i * (data.hi - data.lo) / 4); text(ctx, `${(max * (4 - i) / 4 * 100).toFixed(0)}%`, left - 7, top + i * (bottom - top) / 4 + 3, "right"); text(ctx, `${multiple >= 1e4 || multiple < .01 ? multiple.toExponential(1) : multiple.toFixed(1)}×`, xp(data.lo + i * (data.hi - data.lo) / 4), h - 10, "center"); }
    const bw = (right - left) / data.bars.length;
    data.bars.forEach((bar, i) => { ctx.fillStyle = color + "9c"; ctx.fillRect(left + i * bw + 1, yp(bar.probability), Math.max(1, bw - 2), bottom - yp(bar.probability)); });
    ctx.strokeStyle = "#142b34"; ctx.lineWidth = 2.4; ctx.beginPath();
    data.smooth.forEach((point, i) => i ? ctx.lineTo(xp(point.x), yp(point.probability)) : ctx.moveTo(xp(point.x), yp(point.probability)));
    ctx.stroke();
    if (data.lognormal.length) { ctx.strokeStyle = "#8a4bb0"; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.beginPath(); data.lognormal.forEach((point, i) => i ? ctx.lineTo(xp(point.x), yp(point.probability)) : ctx.moveTo(xp(point.x), yp(point.probability))); ctx.stroke(); ctx.setLineDash([]); }
    if (data.lo < 0 && data.hi > 0) { ctx.strokeStyle = "#788a8d"; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(xp(0), top); ctx.lineTo(xp(0), bottom); ctx.stroke(); ctx.setLineDash([]); }
    text(ctx, "每个区间的模拟比例", left, 14);
    text(ctx, "最终资金 / 初始资金 · 对数横轴", right, 14, "right");
  }
  function growthChart(canvas, data, markers) {
    const { ctx, w, h } = setup(canvas), left = 61, right = w - 22, top = 21, bottom = h - 33;
    const finite = data.values.map(d => d.growth).filter(Number.isFinite);
    let min = Math.min(0, ...finite), max = Math.max(0, ...finite);
    const pad = Math.max(.001, (max - min) * .12);
    min -= pad; max += pad;
    const xp = allocation => left + allocation * (right - left);
    const yp = growth => bottom - (growth - min) / (max - min) * (bottom - top);
    grid(ctx, left, top, right, bottom);
    for (let i = 0; i <= 4; i++) {
      const value = max - (max - min) * i / 4;
      text(ctx, `${(value * 100).toFixed(2)}%`, left - 8, top + i * (bottom - top) / 4 + 3, "right");
      text(ctx, `${i * 25}%`, xp(i / 4), h - 9, "center");
    }
    ctx.strokeStyle = "#abbfba"; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(left, yp(0)); ctx.lineTo(right, yp(0)); ctx.stroke(); ctx.setLineDash([]);
    for (const [allocation, color] of data.sampleCount ? [[markers.full, "#c95752"], [data.best.allocation, "#277e72"]] : []) {
      ctx.strokeStyle = color; ctx.setLineDash([3, 5]); ctx.beginPath(); ctx.moveTo(xp(allocation), top); ctx.lineTo(xp(allocation), bottom); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.strokeStyle = "#277e72"; ctx.lineWidth = 2.5; ctx.beginPath();
    let started = false;
    data.values.forEach(point => {
      if (!Number.isFinite(point.growth)) { started = false; return; }
      started ? ctx.lineTo(xp(point.allocation), yp(point.growth)) : ctx.moveTo(xp(point.allocation), yp(point.growth));
      started = true;
    });
    ctx.stroke();
    if (data.sampleCount) { ctx.fillStyle = "#277e72"; ctx.beginPath(); ctx.arc(xp(data.best.allocation), yp(data.best.growth), 5, 0, Math.PI * 2); ctx.fill(); }
    text(ctx, "每笔平均对数增长", left, 13, "left");
  }
  function color(value, min, max, metric) {
    const t = Math.max(0, Math.min(1, (value - min) / (max - min || 1)));
    const red = [201, 87, 82], middle = [241, 230, 203], green = [74, 141, 129];
    const a = t < .5 ? red : middle, b = t < .5 ? middle : green, f = t < .5 ? t * 2 : (t - .5) * 2;
    const rgb = a.map((v, i) => Math.round(v + (b[i] - v) * f));
    return `rgb(${rgb.join(",")})`;
  }
  function heatmap(canvas, data, metric) {
    const { ctx, w, h } = setup(canvas), left = 39, right = w - 12, top = 12, bottom = h - 28, cw = (right - left) / 11, ch = (bottom - top) / 11;
    const vals = data.cells.flat(), min = metric === "growth" ? Math.min(-.015, ...vals) : 0, max = metric === "growth" ? Math.max(.015, ...vals) : 1;
    data.cells.forEach((row, y) => row.forEach((v, x) => { ctx.fillStyle = color(metric === "drawdown" ? 1 - v : v, metric === "drawdown" ? 0 : min, metric === "drawdown" ? 1 : max, metric); ctx.fillRect(left + x * cw + .5, top + y * ch + .5, cw - 1, ch - 1); }));
    for (let i = 0; i <= 10; i += 2) { const p = data.pMin + (data.pMax - data.pMin) * i / 10; text(ctx, `${(p * 100).toFixed(0)}%`, left + (i + .5) * cw, h - 7, "center", "#68787b", 9); const q = data.pMax - (data.pMax - data.pMin) * i / 10; text(ctx, `${(q * 100).toFixed(0)}%`, left - 4, top + (i + .5) * ch + 3, "right", "#68787b", 9); }
    return { left, top, cw, ch };
  }
  root.KellyCharts = { lineChart, distribution, histogram, growthChart, heatmap };
})(window);

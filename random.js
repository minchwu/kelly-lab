(function (root) {
  "use strict";
  const EPS = 1e-9;
  function rng(seed) {
    let x = Number(seed) >>> 0;
    return () => { x = (x + 0x6D2B79F5) | 0; let t = Math.imul(x ^ x >>> 15, 1 | x); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function normal(random) { return Math.sqrt(-2 * Math.log(Math.max(EPS, random()))) * Math.cos(2 * Math.PI * random()); }
  function gamma(shape, random) {
    if (shape < 1) return gamma(shape + 1, random) * Math.pow(Math.max(EPS, random()), 1 / shape);
    const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
    while (true) { const z = normal(random), v = Math.pow(1 + c * z, 3); if (v <= 0) continue; const u = random(); if (u < 1 - .0331 * z ** 4 || Math.log(u) < z * z / 2 + d * (1 - v + Math.log(v))) return d * v; }
  }
  function beta(a, b, random) { const x = gamma(a, random), y = gamma(b, random); return x / (x + y); }
  function logGamma(z) {
    const p = [.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.3234287776531, -176.6150291621406, 12.507343278686905, -.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7];
    if (z < .5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
    z -= 1; let x = p[0]; for (let i = 1; i < p.length; i++) x += p[i] / (z + i);
    const t = z + 7.5; return .5 * Math.log(2 * Math.PI) + (z + .5) * Math.log(t) - t + Math.log(x);
  }
  function betaFraction(a, b, x) {
    const tiny = 1e-30; let c = 1, d = 1 - (a + b) * x / (a + 1); if (Math.abs(d) < tiny) d = tiny; d = 1 / d; let h = d;
    for (let m = 1; m <= 220; m++) {
      const m2 = 2 * m;
      let aa = m * (b - m) * x / ((a + m2 - 1) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny; c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny; d = 1 / d; h *= d * c;
      aa = -(a + m) * (a + b + m) * x / ((a + m2) * (a + m2 + 1));
      d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny; c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny; d = 1 / d; const delta = d * c; h *= delta; if (Math.abs(delta - 1) < 1e-12) break;
    }
    return h;
  }
  function betaCdf(x, a, b) {
    if (x <= 0) return 0; if (x >= 1) return 1;
    const factor = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log1p(-x));
    return x < (a + 1) / (a + b + 2) ? factor * betaFraction(a, b, x) / a : 1 - factor * betaFraction(b, a, 1 - x) / b;
  }
  function betaQuantile(q, a, b) { let lo = 0, hi = 1; for (let i = 0; i < 54; i++) { const mid = (lo + hi) / 2; if (betaCdf(mid, a, b) < q) lo = mid; else hi = mid; } return (lo + hi) / 2; }
  root.KellyRandom = { rng, beta, betaQuantile };
  if (typeof module !== "undefined") module.exports = root.KellyRandom;
})(typeof window !== "undefined" ? window : globalThis);

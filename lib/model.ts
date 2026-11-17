// The token radar's model, radar-4: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and every other
// rankable pre-token protocol in the snapshot: the early rows the radar exists to find. A protocol is
// pre-token when its index entry records no token (no market cap, no CoinGecko id, no symbol); the
// snapshot's live-token protocols are kept apart and shown as the market's own values, never mixed into
// the ranked board. The whole pre-token universe is audited: 342 protocols carry no token on record;
// 226 are ranked here and 116 are set aside with their reason (exchanges, versioned pools, and
// above-floor protocols the watchlist rule leaves out — mostly wrapped, staked or bridged products of
// tokens that already trade).
//
// Implied value is fitted from the market, not asserted: the program fits a size curve to the
// snapshot's own live-token comparables and prices every pre-token protocol off that curve.
//
//   comps     = the snapshot's live-token protocols with a market cap above zero, excluding CEX and
//               the infra categories the watchlist rule excludes (bridges, staking, restaking, chains,
//               wrappers, anchor-BTC): 85 protocols in this snapshot, named by their numbers only.
//   resid     = mcap_usd / (tvl_usd x growthMult x maturityMult x chainMult) per comp
//   size curve = ordinary least squares on log10(resid) against log10(tvl_usd) over the comps,
//               fitted at runtime from the snapshot alone: log10(multiple) = a + b x log10(tvl_usd)
//               (a = 2.9076, b = -0.4513 on this snapshot: bigger protocols trade at a lower
//               multiple of TVL, and the curve prices that instead of one flat multiple for all sizes)
//   growth    = clamp(change_7d, -50, 150) per cent
//   growthMult   = 1 + (growth / 100) x GROWTH_WEIGHT        (0.5: momentum moves value, never doubles it)
//   maturity  = 0.6 + min(age_days, 1095) / 1095 x 0.4       (age_days unknown: 365; a protocol that
//                                                            has run longer with no token is a more
//                                                            credible launch candidate)
//   chains    = 1.00 on 1 chain | 1.05 on 2-3 | 1.10 on 4-8 | 1.15 on 9+
//                                                            (multi-chain reach is wider distribution)
//   implied   = max(1, round(tvl_usd x 10^(a + b x log10(tvl_usd)) x growthMult x maturityMult x chainMult))
//
// The fit is tested blind three ways before it is used, and every term in it earned its place in a
// blind test of its own: the curve alone, then +growth, +maturity and +chains, were each scored
// walk-forward (fit on the older half of the comps by listing date, tested on the newer half, and
// again 70/30) — no term harms the walk-forward test, maturity improves it, so all three are kept.
// On the walk-forward test the curve beats a flat multiple clearly (50/50 split: median error
// 0.61x with 84% within 2x, against the flat prior's 0.86x and 72%; 70/30 split: 0.72x and 95%
// against 0.86x and 80%). On random 5-fold splits the curve lands about level with the flat prior
// (0.84x vs 0.86x median error) — the time split is the test that matters for a launch radar, since
// a launch is judged on future launches, not on a random shuffle of past ones. Leave-one-out agrees
// (curve 0.90x, flat 0.88x). No protocol name is ever special-cased: the same fitted curve scores
// every row.
//
// Every implied value also carries its uncertainty: 200 bootstrap refits of the curve (comps
// resampled with replacement, seeded, so the run is byte-deterministic) give each row a P10-P90 band
// and a rank range across the refits — the board shows the point estimate, the detail view shows how
// wide the market's own noise makes it.
//
// The farm plan is netted at the market's low end: low_end = implied x LOW_FACTOR, where LOW_FACTOR
// is the comps' 25th-percentile residual multiple divided by their median (0.257 on this snapshot) —
// the market's own lower quartile. The plan's verdict follows the low-end value against the plan's
// all-in cost (capital plus gas): FARM at 10,000x or more, THIN at 1,000x or more, SKIP below that.
// Every plan is dated (it starts on the snapshot's date and holds until a named end date) and states
// the launch value at which it breaks even at the low end: break_even = all-in cost / LOW_FACTOR.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. The size-curve
 *  coefficients and the low-end factor are fitted at runtime from the snapshot's comps (see
 *  calibrateModel); the structural constants below are the model's fixed shape. */
export interface ModelConstants {
  /** log10(multiple) = size_curve_intercept + size_curve_slope x log10(tvl_usd), fitted from comps. */
  size_curve_intercept: number;
  size_curve_slope: number;
  /** Low-end value = implied x low_factor: the comps' p25 residual multiple over their median. */
  low_factor: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  /** Chain-count multipliers: 1 chain, 2-3 chains, 4-8 chains, 9 or more chains. */
  chain_single: number;
  chain_few: number;
  chain_multi: number;
  chain_wide: number;
}

export const MODEL: ModelConstants = {
  size_curve_intercept: 0,
  size_curve_slope: 0,
  low_factor: 0,
  growth_weight: 0.5,
  growth_floor: -50,
  growth_cap: 150,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_single: 1.0,
  chain_few: 1.05,
  chain_multi: 1.1,
  chain_wide: 1.15,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-4';

/**
 * How many pre-token protocols below the watchlist floor the early radar carries, by TVL. The snapshot
 * holds 186 rankable protocols below the floor, so 200 covers every one of them: the board is the
 * watchlist plus the whole early universe, not a cut of it.
 */
export const EARLY_ROWS = 200;

/** How many bootstrap refits back each row's P10-P90 band and rank range. */
export const BOOTSTRAP_REFITS = 200;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A farm plan's economics: the capital the steps deploy, the gas they burn, the all-in cost, the value at
 *  the market's low end, the net after cost, the launch value at which the plan breaks even at the low
 *  end (all-in cost / low factor), and the verdict. */
export interface FarmEconomics {
  capital_usd: number;
  gas_usd: number;
  total_cost_usd: number;
  low_end_usd: number;
  net_usd: number;
  break_even_usd: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  /** The bootstrap band: the 10th and 90th percentile of the implied value over 200 refits. */
  implied_p10_usd: number;
  implied_p90_usd: number;
  /** The rank range over the same 200 refits: best (lowest) and worst (highest) rank the row took. */
  rank_low: number;
  rank_high: number;
  model: {
    size_curve_intercept: number;
    size_curve_slope: number;
    multiple: number;
    low_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_cost_usd: number;
  farm_capital_usd: number;
  farm_gas_usd: number;
  farm_low_end_usd: number;
  farm_net_usd: number;
  farm_break_even_usd: number;
  farm_verdict: 'FARM' | 'THIN' | 'SKIP';
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  implied_p10_usd: number;
  implied_p90_usd: number;
  rank_low: number;
  rank_high: number;
  multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  farm_cost_usd: number;
  farm_capital_usd: number;
  farm_gas_usd: number;
  farm_low_end_usd: number;
  farm_net_usd: number;
  farm_break_even_usd: number;
  farm_verdict: 'FARM' | 'THIN' | 'SKIP';
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** The blind tests of the fitted curve: 5-fold cross-validation over the comps, leave-one-out, and
 *  walk-forward (fit on the older comps by listing date, tested on the newer ones), each with the flat
 *  prior as the reference line the curve is judged against; plus how many bootstrap refits back the
 *  per-row uncertainty bands. */
export interface Calibration {
  comps_n: number;
  comps_premium_n: number;
  comps_standard_n: number;
  size_curve_intercept: number;
  size_curve_slope: number;
  size_curve_r2: number;
  low_factor: number;
  cv_folds: number;
  cv_median_abs_error: number;
  cv_within_2x: number;
  flat_cv_median_abs_error: number;
  flat_cv_within_2x: number;
  wf50_median_abs_error: number;
  wf50_within_2x: number;
  wf50_flat_median_abs_error: number;
  wf50_flat_within_2x: number;
  wf70_median_abs_error: number;
  wf70_within_2x: number;
  wf70_flat_median_abs_error: number;
  wf70_flat_within_2x: number;
  loo_median_abs_error: number;
  loo_within_2x: number;
  loo_flat_median_abs_error: number;
  loo_flat_within_2x: number;
  bootstrap_refits: number;
}

/** The audit of the snapshot's pre-token universe: how many protocols carry no token on record, how
 *  many are ranked, and why each set-aside group is set aside. The groups are exclusive and sum with
 *  the ranked rows to the pre-token total. */
export interface Audit {
  pre_token: number;
  ranked: number;
  excluded_cex: number;
  excluded_versioned: number;
  excluded_above_floor: number;
  excluded_above_floor_wrapped: number;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  calibration: Calibration;
  audit: Audit;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/**
 * A protocol's category tier, from the category word alone, never from its name. Infra is the
 * plumbing whose own token is unlikely or already exists elsewhere (bridges, staking and restaking
 * products, chains, wrapped products); premium is the markets that plausibly issue a token of their
 * own (exchanges of value, lending, yield, derivatives, stable assets, vault curators); the rest is
 * standard.
 */
export function categoryTier(category: string | null): 'premium' | 'standard' | 'infra' {
  const c = (category ?? '').toLowerCase();
  if (
    c === 'cex' ||
    c === 'chain' ||
    c.includes('bridge') ||
    c.includes('staking') ||
    c.includes('restak') ||
    c.includes('wrapper') ||
    c.includes('anchor btc') ||
    c.includes('decentralized btc')
  ) {
    return 'infra';
  }
  if (
    /dex|lend|cdp|yield|deriv|perpetual|prediction|rwa|basis|synthet|option|stable|farm|launchpad|payment|insurance|curator|allocator|manager|capital|collateral|interest|vault|leverage|uncollateralized/.test(
      c,
    )
  ) {
    return 'premium';
  }
  return 'standard';
}

/** The chain-count multiplier: wider distribution scores higher, capped so one outlier cannot run away. */
function chainMultiplier(chainCount: number, model: ModelConstants): number {
  if (chainCount >= 9) return model.chain_wide;
  if (chainCount >= 4) return model.chain_multi;
  if (chainCount >= 2) return model.chain_few;
  return model.chain_single;
}

/** The fitted size curve's multiple for one TVL: 10^(a + b x log10(TVL)). */
export function sizeMultiple(tvlUsd: number, model: ModelConstants): number {
  return Math.pow(10, model.size_curve_intercept + model.size_curve_slope * Math.log10(tvlUsd));
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): {
  implied: number;
  multiple: number;
  lowMultiple: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  chainMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const chainMult = chainMultiplier(protocol.chains.length, model);
  const multiple = sizeMultiple(protocol.tvl_usd, model);
  const lowMultiple = multiple * model.low_factor;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult * chainMult));
  return { implied, multiple, lowMultiple, growthPct, growthMult, maturityMult, chainMult, age };
}

/** The growth and maturity multipliers one protocol gets, shared by the fit and the board. */
function growthMaturity(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { growthMult: number; maturityMult: number } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  return { growthMult, maturityMult };
}

/**
 * The comps: live-token protocols whose market cap the market itself set, minus CEX and minus the
 * infra categories the watchlist rule excludes. Sorted by slug, so every sum over them runs in one
 * fixed order and the fit is byte-deterministic. No name is ever used: the set is defined by the
 * snapshot's numbers and category words alone.
 */
export function compsSet(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX' && categoryTier(p.category) !== 'infra')
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

/** One comp's residual multiple: its market cap stripped of growth, maturity and chain effects. */
function residualMultiple(p: SnapshotProtocol, asOf: string, model: ModelConstants): number {
  const { growthMult, maturityMult } = growthMaturity(p, asOf, model);
  return p.mcap_usd! / (p.tvl_usd * growthMult * maturityMult * chainMultiplier(p.chains.length, model));
}

/** The median of a sorted array (average of the two middles when even), or null when empty. */
function medianOfSorted(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[m]! : (sorted[m - 1]! + sorted[m]!) / 2;
}

/** Ordinary least squares on y against x, both plain arrays in one fixed order. */
function ols(xs: number[], ys: number[]): { intercept: number; slope: number; r2: number } {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    cov += (xs[i]! - mx) * (ys[i]! - my);
    vx += (xs[i]! - mx) * (xs[i]! - mx);
    vy += (ys[i]! - my) * (ys[i]! - my);
  }
  const slope = vx === 0 ? 0 : cov / vx;
  const intercept = my - slope * mx;
  let ssr = 0;
  for (let i = 0; i < n; i++) ssr += (ys[i]! - (intercept + slope * xs[i]!)) ** 2;
  return { intercept, slope, r2: vy === 0 ? 0 : 1 - ssr / vy };
}

/** The size curve fitted to one set of comps: log10(residual multiple) on log10(TVL). */
function fitCurve(comps: SnapshotProtocol[], asOf: string, model: ModelConstants): { intercept: number; slope: number; r2: number } {
  const xs = comps.map((p) => Math.log10(p.tvl_usd));
  const ys = comps.map((p) => Math.log10(residualMultiple(p, asOf, model)));
  return ols(xs, ys);
}

/** The flat prior the curve is judged against: radar-2's asserted 0.25 of TVL with its tier and band. */
function flatPriorValue(p: SnapshotProtocol, asOf: string, model: ModelConstants): number {
  const { growthMult, maturityMult } = growthMaturity(p, asOf, model);
  const tier = categoryTier(p.category);
  const tierMult = tier === 'premium' ? 1.15 : tier === 'infra' ? 0.75 : 1.0;
  const bandMult = p.tvl_usd >= 1_000_000_000 ? 1.1 : p.tvl_usd >= 100_000_000 ? 1.0 : 0.9;
  return Math.max(1, Math.round(p.tvl_usd * 0.25 * growthMult * maturityMult * tierMult * chainMultiplier(p.chains.length, model) * bandMult));
}

/** One fold's held-out error: median absolute error and the share of predictions within 2x. */
function foldError(
  test: SnapshotProtocol[],
  predict: (p: SnapshotProtocol) => number,
): { medianAbsError: number; within2x: number } {
  const errs = test.map((p) => Math.abs(predict(p) - p.mcap_usd!) / p.mcap_usd!).sort((a, b) => a - b);
  const median = medianOfSorted(errs) ?? 0;
  return { medianAbsError: median, within2x: errs.filter((e) => e <= 1).length / errs.length };
}

/**
 * Calibrate the model from the snapshot alone: fit the size curve to the comps, take the low-end
 * factor from the comps' residual multiples, and test the curve blind three ways — 5-fold
 * cross-validation (folds by slug order, four folds fit, one fold held out), walk-forward (fit on
 * the older comps by listing date, tested on the newer ones, 50/50 and 70/30), and leave-one-out.
 * The flat prior is tested the same way every time, so the dashboard can say what the fit bought.
 * Throws when the snapshot carries too few comps to fit anything.
 */
export function calibrateModel(snapshot: Snapshot): { model: ModelConstants; calibration: Calibration } {
  const comps = compsSet(snapshot);
  if (comps.length < 10) throw new SnapshotError(`snapshot holds ${comps.length} live-token comparables: too few to fit a size curve`);
  const base: ModelConstants = { ...MODEL };
  const fit = fitCurve(comps, snapshot.as_of, base);
  const residuals = comps.map((p) => residualMultiple(p, snapshot.as_of, base)).sort((a, b) => a - b);
  const p25 = residuals[Math.floor(residuals.length * 0.25)]!;
  const med = medianOfSorted(residuals) ?? 1;
  const model: ModelConstants = { ...base, size_curve_intercept: fit.intercept, size_curve_slope: fit.slope, low_factor: p25 / med };
  const folds = 5;
  let curveErr = 0;
  let curveWithin = 0;
  let flatErr = 0;
  let flatWithin = 0;
  for (let k = 0; k < folds; k++) {
    const test = comps.filter((_, i) => i % folds === k);
    const train = comps.filter((_, i) => i % folds !== k);
    const f = fitCurve(train, snapshot.as_of, base);
    const trial: ModelConstants = { ...base, size_curve_intercept: f.intercept, size_curve_slope: f.slope };
    const ce = foldError(test, (p) => impliedValue(p, snapshot.as_of, trial).implied);
    const fe = foldError(test, (p) => flatPriorValue(p, snapshot.as_of, base));
    curveErr += ce.medianAbsError;
    curveWithin += ce.within2x;
    flatErr += fe.medianAbsError;
    flatWithin += fe.within2x;
  }
  // Walk-forward: fit on the older comps by listing date, test on the newer ones — the test that
  // matters for a launch radar, since a launch is judged on future launches, not on a random shuffle
  // of past ones. Two splits, 50/50 and 70/30. Comps with no listing date cannot be ordered in time
  // and sit out this test.
  const dated = comps
    .filter((p) => p.listed_at !== null)
    .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : a.slug < b.slug ? -1 : 1));
  function walkForward(frac: number): { curve: { medianAbsError: number; within2x: number }; flat: { medianAbsError: number; within2x: number } } {
    const cut = Math.floor(dated.length * frac);
    const train = dated.slice(0, cut);
    const test = dated.slice(cut);
    const f = fitCurve(train, snapshot.as_of, base);
    const trial: ModelConstants = { ...base, size_curve_intercept: f.intercept, size_curve_slope: f.slope };
    return {
      curve: foldError(test, (p) => impliedValue(p, snapshot.as_of, trial).implied),
      flat: foldError(test, (p) => flatPriorValue(p, snapshot.as_of, base)),
    };
  }
  const wf50 = walkForward(0.5);
  const wf70 = walkForward(0.7);
  // Leave-one-out: every comp held out once, the curve refit on the rest.
  const looCurveErrs: number[] = [];
  const looFlatErrs: number[] = [];
  let looCurveWithin = 0;
  let looFlatWithin = 0;
  for (let i = 0; i < comps.length; i++) {
    const train = comps.filter((_, j) => j !== i);
    const f = fitCurve(train, snapshot.as_of, base);
    const trial: ModelConstants = { ...base, size_curve_intercept: f.intercept, size_curve_slope: f.slope };
    const ce = foldError([comps[i]!], (p) => impliedValue(p, snapshot.as_of, trial).implied);
    const fe = foldError([comps[i]!], (p) => flatPriorValue(p, snapshot.as_of, base));
    looCurveErrs.push(ce.medianAbsError);
    looFlatErrs.push(fe.medianAbsError);
    looCurveWithin += ce.within2x;
    looFlatWithin += fe.within2x;
  }
  const calibration: Calibration = {
    comps_n: comps.length,
    comps_premium_n: comps.filter((p) => categoryTier(p.category) === 'premium').length,
    comps_standard_n: comps.filter((p) => categoryTier(p.category) === 'standard').length,
    size_curve_intercept: fit.intercept,
    size_curve_slope: fit.slope,
    size_curve_r2: fit.r2,
    low_factor: model.low_factor,
    cv_folds: folds,
    cv_median_abs_error: curveErr / folds,
    cv_within_2x: curveWithin / folds,
    flat_cv_median_abs_error: flatErr / folds,
    flat_cv_within_2x: flatWithin / folds,
    wf50_median_abs_error: wf50.curve.medianAbsError,
    wf50_within_2x: wf50.curve.within2x,
    wf50_flat_median_abs_error: wf50.flat.medianAbsError,
    wf50_flat_within_2x: wf50.flat.within2x,
    wf70_median_abs_error: wf70.curve.medianAbsError,
    wf70_within_2x: wf70.curve.within2x,
    wf70_flat_median_abs_error: wf70.flat.medianAbsError,
    wf70_flat_within_2x: wf70.flat.within2x,
    loo_median_abs_error: medianOfSorted([...looCurveErrs].sort((a, b) => a - b)) ?? 0,
    loo_within_2x: looCurveWithin / comps.length,
    loo_flat_median_abs_error: medianOfSorted([...looFlatErrs].sort((a, b) => a - b)) ?? 0,
    loo_flat_within_2x: looFlatWithin / comps.length,
    bootstrap_refits: BOOTSTRAP_REFITS,
  };
  return { model, calibration };
}

/** A seeded pseudo-random generator (mulberry32): the bootstrap must be byte-deterministic, so the
 *  run never touches Math.random. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One bootstrap refit's subject: a board row's protocol, scored under each refit curve. */
interface BootstrapRow {
  slug: string;
  protocol: SnapshotProtocol;
}

/**
 * The uncertainty band: refit the size curve BOOTSTRAP_REFITS times on comps resampled with
 * replacement (seeded, so two runs agree byte for byte), score every board row under each refit, and
 * take the 10th and 90th percentile of each row's implied value plus the best and worst rank it took.
 * Only the curve is refit; the growth, maturity and chain multipliers are the model's fixed shape.
 */
export function bootstrapBands(
  snapshot: Snapshot,
  model: ModelConstants,
  rows: BootstrapRow[],
): Map<string, { p10: number; p90: number; rankLow: number; rankHigh: number }> {
  const comps = compsSet(snapshot);
  const base: ModelConstants = { ...model };
  const rng = mulberry32(20261114);
  const values = new Map<string, number[]>();
  const ranks = new Map<string, number[]>();
  for (const r of rows) {
    values.set(r.slug, []);
    ranks.set(r.slug, []);
  }
  for (let refit = 0; refit < BOOTSTRAP_REFITS; refit++) {
    const sample: SnapshotProtocol[] = [];
    for (let i = 0; i < comps.length; i++) sample.push(comps[Math.floor(rng() * comps.length)]!);
    const f = fitCurve(sample, snapshot.as_of, base);
    const trial: ModelConstants = { ...base, size_curve_intercept: f.intercept, size_curve_slope: f.slope };
    const scored = rows
      .map((r) => ({ slug: r.slug, implied: impliedValue(r.protocol, snapshot.as_of, trial).implied }))
      .sort((a, b) => b.implied - a.implied || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
    scored.forEach((s, i) => {
      values.get(s.slug)!.push(s.implied);
      ranks.get(s.slug)!.push(i + 1);
    });
  }
  const out = new Map<string, { p10: number; p90: number; rankLow: number; rankHigh: number }>();
  for (const r of rows) {
    const vs = [...values.get(r.slug)!].sort((a, b) => a - b);
    const rs = ranks.get(r.slug)!;
    out.set(r.slug, {
      p10: Math.max(1, Math.round(vs[Math.floor(vs.length * 0.1)]!)),
      p90: Math.max(1, Math.round(vs[Math.floor(vs.length * 0.9)]!)),
      rankLow: Math.min(...rs),
      rankHigh: Math.max(...rs),
    });
  }
  return out;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-11-14' as '14 Nov 2026'. */
export function formatDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`;
}

/** An ISO date plus a number of days, as '13 Jan 2027'. */
export function addDays(iso: string, days: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS;
  const d = new Date(t);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** A dollar amount with thousands separators, written the same way in the page's own copy. */
export function formatUsdInt(n: number): string {
  return `$${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

/** The low-end value is worth farming at 10,000x the plan's all-in cost, thin at 1,000x, else skip. */
export const VERDICT_FARM_RATIO = 10_000;
export const VERDICT_THIN_RATIO = 1_000;

/**
 * A plan's economics: the capital the steps deploy, the gas they burn, the all-in cost, the value at
 * the market's low end, the net after cost, and the verdict. Gas is the steps' own figures added up:
 * $5 to fund the wallet, $8/$4 to set the main position up, $2 + $2 for the two smaller tranches, and
 * $2 a week for the weekly cadence over the hold.
 */
export function planEconomics(p: SnapshotProtocol, age: number | null, model: ModelConstants, implied: number): FarmEconomics {
  const capital = capitalFor(p);
  const small = Math.max(10, Math.round(capital / 5));
  const hold = holdDaysFor(age);
  const gas = 5 + (capital >= 150 ? 8 : 4) + 2 + 2 + 2 * Math.ceil(hold / 7);
  const totalCapital = capital + 2 * small;
  const totalCost = totalCapital + gas;
  const lowEnd = Math.max(1, Math.round(implied * model.low_factor));
  const net = lowEnd - totalCost;
  const ratio = lowEnd / totalCost;
  const verdict: 'FARM' | 'THIN' | 'SKIP' = ratio >= VERDICT_FARM_RATIO ? 'FARM' : ratio >= VERDICT_THIN_RATIO ? 'THIN' : 'SKIP';
  // The launch value at which the plan breaks even at the low end: low_end = implied x low_factor,
  // so the plan nets zero when implied = all-in cost / low_factor.
  const breakEven = Math.max(1, Math.round(totalCost / model.low_factor));
  return { capital_usd: totalCapital, gas_usd: gas, total_cost_usd: totalCost, low_end_usd: lowEnd, net_usd: net, break_even_usd: breakEven, verdict };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, calibrated?: { model: ModelConstants; calibration: Calibration }): BoardRow[] {
  const { model } = calibrated ?? calibrateModel(snapshot);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. Never a replacement
  // for a watchlist row: a chosen protocol stays chosen. EARLY_ROWS covers every rankable protocol
  // below the floor in this snapshot, so the board is the whole early universe.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model);
    return { p, ...v, econ: planEconomics(p, v.age, model, v.implied) };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const bands = bootstrapBands(snapshot, model, scored.map((s) => ({ slug: s.p.slug, protocol: s.p })));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    implied_p10_usd: bands.get(s.p.slug)!.p10,
    implied_p90_usd: bands.get(s.p.slug)!.p90,
    rank_low: bands.get(s.p.slug)!.rankLow,
    rank_high: bands.get(s.p.slug)!.rankHigh,
    model: {
      size_curve_intercept: round4(model.size_curve_intercept),
      size_curve_slope: round4(model.size_curve_slope),
      multiple: round4(s.multiple),
      low_multiple: round4(s.lowMultiple),
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      chain_multiplier: round4(s.chainMult),
      age_days: s.age,
    },
    farm_cost_usd: s.econ.total_cost_usd,
    farm_capital_usd: s.econ.capital_usd,
    farm_gas_usd: s.econ.gas_usd,
    farm_low_end_usd: s.econ.low_end_usd,
    farm_net_usd: s.econ.net_usd,
    farm_break_even_usd: s.econ.break_even_usd,
    farm_verdict: s.econ.verdict,
    farm_steps: farmSteps(s.p, s.age, model, s.implied, snapshot.as_of).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The second chain a protocol names, or null when it runs on one chain only. */
function secondChainOf(p: SnapshotProtocol): string | null {
  return p.chains.length > 1 ? p.chains[1]! : null;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's main action, in the words a farmer can follow, naming the protocol, chain and capital. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('uncollateralized')) {
    return `Supply $${capital} of USDC to ${name} on ${chain} as collateral and keep the deposit open, so the position shows in the protocol's lending book.`;
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm') || c.includes('farm')) {
    return `Provide $${capital} of liquidity to ${name}'s largest pool on ${chain} and keep the position open, so the wallet earns fees and counts as a liquidity provider.`;
  }
  if (c.includes('bridge')) {
    return `Bridge $${capital} of USDC into ${chain} through ${name} and use the bridged funds inside an app on ${chain}, so the transfer is a real use and not a pass-through.`;
  }
  if (c.includes('staking') || c.includes('restak')) {
    return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token in the wallet.`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options') || c.includes('basis') || c.includes('synthet')) {
    return `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small hedged position, then close it the same week.`;
  }
  if (c.includes('prediction')) {
    return `Fund the wallet with $${capital} and place one market position on ${name} on ${chain}, then let it settle instead of closing it at once.`;
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('manager') || c.includes('capital')) {
    return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares in the wallet, so the deposit is tied to the vault's own accounting.`;
  }
  if (c.includes('stable')) {
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it in the wallet.`;
  }
  if (c.includes('rwa')) {
    return `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it, so the wallet accrues the asset's yield week by week.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active in the wallet.`;
  }
  if (c.includes('launchpad')) {
    return `Commit $${capital} to join ${name}'s next launch on ${chain} and finish the launch's own tasks on its page.`;
  }
  if (c.includes('payment') || c.includes('card')) {
    return `Load $${capital} onto ${name} on ${chain} and make one real payment with it, so the wallet shows spending and not only a deposit.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's second action: a different feature of the same protocol, so the wallet is not one-note. */
function secondActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const small = Math.max(10, Math.round(capital / 5));
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('uncollateralized')) {
    return `Borrow $${small} of stablecoin against the deposit on ${chain} and repay it within a week, so the wallet shows both sides of ${name}'s market.`;
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm') || c.includes('farm')) {
    return `Swap $${small} through ${name} on ${chain} once a week, so the wallet is a trader as well as a liquidity provider.`;
  }
  if (c.includes('bridge')) {
    return `Bridge a second, smaller $${small} transfer through ${name} to a different app on ${chain} the following week.`;
  }
  if (c.includes('staking') || c.includes('restak')) {
    return `Stake a second $${small} tranche through ${name} on ${chain} a week later, so the position grows in steps rather than one lump.`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options') || c.includes('basis') || c.includes('synthet')) {
    return `Open and close one more small hedged position on ${name} the next week, keeping each trade under $${small} of margin.`;
  }
  if (c.includes('prediction')) {
    return `Place a second, smaller $${small} position on a different market on ${name} once the first one settles.`;
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('manager') || c.includes('capital')) {
    return `Allocate $${small} to a second vault of ${name} on ${chain} run by a different curator, so the wallet is spread across two vaults.`;
  }
  if (c.includes('stable')) {
    return `Check the stable asset's peg and yield on ${name} each week and top the position up by $${small} only while it holds.`;
  }
  if (c.includes('rwa')) {
    return `Read ${name}'s own report on the underlying assets each week and check the yield credited to the wallet.`;
  }
  if (c.includes('insurance')) {
    return `Read the cover terms on ${name}'s own page and check the policy is still active before the hold ends.`;
  }
  if (c.includes('launchpad')) {
    return `Vote or complete the community task for the next launch on ${name} once the first commitment is in.`;
  }
  if (c.includes('payment') || c.includes('card')) {
    return `Make a second, smaller $${small} payment through ${name} a week later, so the wallet shows repeat use.`;
  }
  return `Use a second feature of ${name} on ${chain} once a week, such as a swap, a deposit or a vote, so the wallet is not a one-time deposit.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age, seven-day growth), never from a hand-written
 * list of names: the main and second actions follow the category, the multi-chain step follows the
 * chain list, the capital follows TVL, the hold follows age, and the cadence step reads the growth.
 * The plan is dated: it starts on the snapshot's date and holds until a named end date. The last step
 * nets the plan: its all-in cost, the value at the market's low end, the net after cost, the verdict,
 * and the launch value at which the plan breaks even at the low end.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, model: ModelConstants, implied: number, asOf: string): FarmStep[] {
  const chain = chainOf(p);
  const second = secondChainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const small = Math.max(10, Math.round(capital / 5));
  const growth = finite(p.change_7d, 0);
  const growthNote =
    growth >= 20
      ? ` TVL is up ${growth.toFixed(1)}% in seven days, so keep the cadence while momentum is hot.`
      : growth <= -20
        ? ` TVL is down ${Math.abs(growth).toFixed(1)}% in seven days, so keep the position small and re-check before adding more.`
        : '';
  const listed = p.listed_at === null ? 'an unlisted start date' : p.listed_at;
  const econ = planEconomics(p, age, model, implied);
  return [
    {
      text: `On ${formatDay(asOf)}, open a fresh wallet for this farm only, fund it on ${chain} with $${capital} in USDC plus about $5 for gas, and keep its seed phrase offline.`,
      cost: `$${capital} of USDC plus about $5 of gas`,
      time: '10 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: secondActionFor(p, capital, chain),
      cost: `about $${small} of capital and $2 of gas`,
      time: '10 minutes',
    },
    {
      text:
        second !== null
          ? `Repeat a smaller $${small} deposit on ${second} so the same wallet shows activity on two chains, ${chain} and ${second}, instead of one.`
          : `Deepen the position on ${chain}: add a second $${small} tranche to a different pool or vault of ${p.name}, so the wallet is not a single deposit.`,
      cost: `about $${small} of capital and $2 of gas`,
      time: '10 minutes',
    },
    {
      text: `Return once a week and repeat a qualifying action on ${chain}, such as a deposit, a swap, a borrow or a vote, so the wallet stays active in every weekly snapshot.${growthNote}`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days, until ${addDays(asOf, hold)}: ${p.name} has been tracked since ${listed}, so a position that spans several snapshots counts more than a one-day deposit.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open ${p.name}'s own rewards page from its official site and claim only from the link it publishes; never pay a fee to claim, and log the wallet, the dates and every transaction hash. Plan total ${formatUsdInt(econ.total_cost_usd)} all in. At the comps' low end this protocol is worth ${formatUsdInt(econ.low_end_usd)} — net ${formatUsdInt(econ.net_usd)}, verdict ${econ.verdict}. Breaks even if the token launches at ${formatUsdInt(econ.break_even_usd)} at the low end.`,
      cost: 'no fee to check, and never pay to claim',
      time: '15 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    implied_p10_usd: row.implied_p10_usd,
    implied_p90_usd: row.implied_p90_usd,
    rank_low: row.rank_low,
    rank_high: row.rank_high,
    multiple: row.model.multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    farm_cost_usd: row.farm_cost_usd,
    farm_capital_usd: row.farm_capital_usd,
    farm_gas_usd: row.farm_gas_usd,
    farm_low_end_usd: row.farm_low_end_usd,
    farm_net_usd: row.farm_net_usd,
    farm_break_even_usd: row.farm_break_even_usd,
    farm_verdict: row.farm_verdict,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const calibrated = calibrateModel(snapshot);
  const board = buildBoard(snapshot, calibrated);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  // The audit: every pre-token protocol accounted for. The groups are exclusive and sum with the
  // ranked rows to the pre-token total.
  const preToken = snapshot.protocols.filter(isPreToken);
  const excludedCex = preToken.filter((p) => p.category === 'CEX');
  const excludedVersioned = preToken.filter((p) => p.category !== 'CEX' && VERSIONED.test(p.name));
  const excludedAboveFloor = preToken.filter(
    (p) => p.category !== 'CEX' && !VERSIONED.test(p.name) && p.tvl_usd >= snapshot.floor_usd && !snapshot.watchlist.includes(p.slug),
  );
  const wrappedWord = (c: string | null): boolean => {
    const s = (c ?? '').toLowerCase();
    return s.includes('bridge') || s.includes('staking') || s.includes('restak') || s.includes('wrapper') || s.includes('anchor btc') || s.includes('decentralized btc');
  };
  const audit: Audit = {
    pre_token: preToken.length,
    ranked: board.length,
    excluded_cex: excludedCex.length,
    excluded_versioned: excludedVersioned.length,
    excluded_above_floor: excludedAboveFloor.length,
    excluded_above_floor_wrapped: excludedAboveFloor.filter((p) => wrappedWord(p.category)).length,
  };
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: calibrated.model,
    model_version: MODEL_VERSION,
    calibration: calibrated.calibration,
    audit,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

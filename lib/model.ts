// The token radar's model, radar-4: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds
// every rankable pre-token protocol below the watchlist floor: the early rows the radar exists to
// find. A protocol is pre-token when its record carries no token (no market cap, no CoinGecko id,
// no symbol). Protocols that record no token but are wrapped, staked, bridged or versioned products
// are counted apart and never ranked as launches of their own: their token already trades through
// another protocol. The live-token protocols are kept apart too and shown as the market's own values,
// never mixed into the ranked board: they are the cohort the model's multiples come from.
// Radar-4 fixes radar-3's early loop, which ranked 48 such products (bridges, liquid-staking and
// restaking records, wrapped/staked names, one exchange product) as launches of their own even
// though the watchlist's own rule and this file's exclusion rule both set them aside.
//
// Implied value follows only from the snapshot's own figures, through one function of TVL, the
// protocol's category, its seven-day growth, its age with no token, and how many chains it runs on:
//
//   ratio        = the category's median market-cap-per-TVL among the snapshot's own token-having
//                  protocols, winsorized to [0.01, 1.0] and used only when the category has at
//                  least four live tokens; thinner categories use the global median. The median is
//                  shrunk toward the global median (k = 5) and the result clamped to [0.05, 1.0]
//   growthMult   = 1 + clamp(change_7d, -60, 120) / 100 x 0.5
//   maturityMult = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age unknown: 365 days)
//   chainMult    = 1 + 0.02 x min(chains - 1, 4)
//   implied      = max(1, round(tvl_usd x ratio x growthMult x maturityMult x chainMult))
//
// The category multiples are computed from this snapshot at run time, never from a hand-kept list:
// a category with few live tokens leans on the global median, and an outlying median is capped.
// No protocol name is ever special-cased: the same function scores every row.

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

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  ratio_shrink_k: number;
  ratio_floor: number;
  ratio_cap: number;
  ratio_min_live: number;
  ratio_winsor_low: number;
  ratio_winsor_high: number;
  chain_step: number;
  chain_max: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  ratio_shrink_k: 5,
  ratio_floor: 0.05,
  ratio_cap: 1.0,
  ratio_min_live: 4,
  ratio_winsor_low: 0.01,
  ratio_winsor_high: 1.0,
  chain_step: 0.02,
  chain_max: 4,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-4';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 12;

/** One category's multiple: where it came from, so the dashboard can show the derivation. */
export interface CategoryRatio {
  category: string;
  live_count: number;
  median_ratio: number;
  ratio: number;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
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
  model: {
    category_ratio: number;
    ratio_live_count: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
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

/** Why a pre-token protocol above the floor is not ranked as a launch of its own. */
export interface ExclusionCount {
  reason: string;
  count: number;
}

/** Everything the dashboard needs: the board, the live set, the multiples and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  excluded_size: number;
  excluded: ExclusionCount[];
  ratios: CategoryRatio[];
  global_median: number;
  categories: string[];
  chains: string[];
  /** Compact rows: [rank, slug, name, categoryIdx, chainIdxs, tvl, change7d, ageDays, implied,
   *  onWatchlist]. Category -1 means the snapshot names none. The page recomputes the model's
   *  multipliers from these figures and the category ratios, and checks the implied value. */
  rows: (number | string | number[] | null)[][];
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

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whole words that mark a wrapped or staked product of a token that already trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Exchange names a protocol name must not begin with (the watchlist's own rule). */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

/** Categories that are a wrapped, staked or bridged product by definition. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token and set aside by no exclusion rule —
 *  not an exchange, not a versioned pool, not a bridge, staking or wrapped product of a token
 *  that already trades. The watchlist's own rule and this function are the same rule, so a
 *  watchlist row always passes and an early row passes only when it is a launch of its own. */
export function isRankable(p: SnapshotProtocol): boolean {
  return exclusionReason(p) === null;
}

/** The reason a pre-token protocol is set aside instead of ranked, or null when it is rankable. */
export function exclusionReason(p: SnapshotProtocol): string | null {
  if (!isPreToken(p)) return 'already trades';
  if (p.category === 'CEX') return 'exchange product';
  if (VERSIONED.test(p.name)) return 'versioned pool of another protocol';
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return 'bridge, staking or exchange product';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped or staked product';
  if (EXCHANGE_PREFIX.test(p.name)) return 'exchange product';
  return null;
}

/** The median of sorted numbers, or null when there are none. */
function medianOf(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Every category's multiple, derived from the snapshot's own token-having protocols.
 *  One protocol's ratio is winsorized to [winsor_low, winsor_high] first, so a single token
 *  with a market cap far above its TVL cannot set a category. A category's median is used only
 *  when at least ratio_min_live live tokens carry it; thinner categories use the global median. */
export function categoryRatios(snapshot: Snapshot, model: ModelConstants = MODEL): { ratios: CategoryRatio[]; globalMedian: number } {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p)) continue;
    if (p.mcap_usd === null || p.tvl_usd === null || p.tvl_usd <= 0 || p.mcap_usd <= 0) continue;
    const ratio = Math.min(model.ratio_winsor_high, Math.max(model.ratio_winsor_low, p.mcap_usd / p.tvl_usd));
    all.push(ratio);
    const key = p.category ?? 'Other';
    const list = byCategory.get(key);
    if (list) list.push(ratio);
    else byCategory.set(key, [ratio]);
  }
  all.sort((a, b) => a - b);
  const globalMedian = medianOf(all) ?? 0.2;
  const ratios: CategoryRatio[] = [];
  for (const [category, values] of byCategory) {
    if (values.length < model.ratio_min_live) continue;
    values.sort((a, b) => a - b);
    const median = medianOf(values) ?? globalMedian;
    const shrunk = (values.length * median + model.ratio_shrink_k * globalMedian) / (values.length + model.ratio_shrink_k);
    const ratio = Math.min(model.ratio_cap, Math.max(model.ratio_floor, shrunk));
    ratios.push({ category, live_count: values.length, median_ratio: Math.round(median * 10000) / 10000, ratio: Math.round(ratio * 10000) / 10000 });
  }
  ratios.sort((a, b) => b.ratio - a.ratio || (a.category < b.category ? -1 : 1));
  return { ratios, globalMedian };
}

/** The multiple one protocol's category carries, or the global median when its category has none. */
export function ratioFor(category: string | null, ratios: CategoryRatio[], globalMedian: number, model: ModelConstants = MODEL): { ratio: number; liveCount: number } {
  const found = category === null ? undefined : ratios.find((r) => r.category === category);
  if (found) return { ratio: found.ratio, liveCount: found.live_count };
  const ratio = Math.min(model.ratio_cap, Math.max(model.ratio_floor, globalMedian));
  return { ratio: Math.round(ratio * 10000) / 10000, liveCount: 0 };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The four multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  ratios: CategoryRatio[],
  globalMedian: number,
  model: ModelConstants = MODEL,
): { implied: number; ratio: number; ratioLiveCount: number; growthPct: number; growthMult: number; maturityMult: number; chainMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const { ratio, liveCount } = ratioFor(protocol.category, ratios, globalMedian, model);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const chainMult = 1 + model.chain_step * Math.min(Math.max(protocol.chains.length - 1, 0), model.chain_max);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * ratio * growthMult * maturityMult * chainMult));
  return { implied, ratio, ratioLiveCount: liveCount, growthPct, growthMult: round4(growthMult), maturityMult: round4(maturityMult), chainMult: round4(chainMult), age };
}

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

/** Chains where one transaction costs cents rather than dollars, by the chain's own fees. */
const CHEAP_CHAINS = new Set([
  'Base', 'Arbitrum', 'Optimism', 'Polygon', 'Binance', 'Solana', 'Avalanche', 'zkSync', 'Linea',
  'Blast', 'Scroll', 'Mantle', 'Gnosis', 'Fantom', 'Celo', 'Moonbeam', 'Berachain', 'Sonic', 'Hyperliquid',
  'Sei', 'Sui', 'Aptos', 'TON', 'Starknet', 'Abstract', 'Unichain', 'Ink', 'Mode', 'Fraxtal',
]);

/** What one transaction costs on the cheapest chain this protocol runs on. */
function gasFor(p: SnapshotProtocol): { setup: string; weekly: string } {
  if (p.chains.length === 0) return { setup: 'about $1 of gas', weekly: 'about $1 of gas a week' };
  if (p.chains.some((c) => CHEAP_CHAINS.has(c))) return { setup: 'about $0.30 of gas', weekly: 'about $0.30 of gas a week' };
  if (p.chains.includes('Ethereum')) return { setup: 'about $5 of gas', weekly: 'about $3 of gas a week' };
  return { setup: 'about $1 of gas', weekly: 'about $1 of gas a week' };
}

/** The category's main action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('yield')) return `Deposit $${capital} of USDC into ${name}'s main yield strategy on ${chain} and keep the shares.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('index')) return `Buy $${capital} of ${name}'s index token on ${chain} and hold it.`;
  if (c.includes('privacy')) return `Deposit $${capital} of USDC into ${name}'s shielded pool on ${chain} and keep the note.`;
  if (c.includes('ai agent') || c.includes('ai agents')) return `Spend $${capital} using ${name}'s agent service on ${chain} and keep the receipts.`;
  if (c.includes('nft')) return `Mint or buy one NFT through ${name} on ${chain} and hold it in the farm wallet.`;
  if (c.includes('gaming')) return `Buy $${capital} of the in-game asset on ${name} and play one session on ${chain}.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's second action: a different verb, so the plan is two real positions, not one repeated. */
function secondActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow $${Math.round(capital / 2)} against the supply on ${name} and repay it within the week, so the wallet shows both sides.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Swap at least $10 through ${name}'s main pool on ${chain} once a week, so the wallet shows trading volume as well as liquidity.`;
  if (c.includes('yield')) return `Claim the strategy's rewards once a month and restake them into the same vault on ${chain}.`;
  if (c.includes('bridge')) return `Bridge a smaller amount back through ${name} after a week, so the wallet shows a round trip.`;
  if (c.includes('staking') || c.includes('restak')) return `Delegate or restake the receipt token once, so the wallet holds a staking position and a receipt.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Close the first position after a week and open a fresh one, so the activity stays current.`;
  if (c.includes('prediction')) return `Settle the first position and place a second one on a different market on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Move a quarter of the vault shares into a second ${name} vault on ${chain} after two weeks.`;
  if (c.includes('stable')) return `Use the minted stable asset in a lending market on ${chain} for one week, then return it.`;
  if (c.includes('rwa')) return `Check the yield accrual on the asset once a month and keep the holding past the first payout.`;
  if (c.includes('insurance')) return `Extend the cover by one month before it lapses, so the policy never gaps.`;
  if (c.includes('index')) return `Rebalance the index holding once a month, selling the top weight and buying the lowest.`;
  if (c.includes('privacy')) return `Make one shielded transfer from the pool after a week, so the note is used and not only held.`;
  if (c.includes('ai agent') || c.includes('ai agents')) return `Run a second paid task through ${name} a week later and keep both receipts.`;
  if (c.includes('nft')) return `List the NFT for one week, then delist it, so the wallet shows a marketplace action.`;
  if (c.includes('gaming')) return `Play a second session a week later and keep the earned asset in the farm wallet.`;
  return `Make a second, smaller deposit of $${Math.round(capital / 2)} into ${name} on ${chain} a week later.`;
}

/** The category's weekly action: a different verb from the first two positions, so the plan
 *  stays active week after week instead of repeating one action. */
function weeklyActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Top up the supply on ${name} by $10 once a week, or make one small borrow, so the wallet stays active.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Make one swap of at least $10 through ${name}'s main pool on ${chain} once a week, so the wallet shows trading volume.`;
  if (c.includes('yield')) return `Check ${name}'s strategy rewards once a week and harvest any amount above $5 back into the same vault.`;
  if (c.includes('bridge')) return `Bridge a small amount through ${name} once a week, so the wallet shows a steady flow.`;
  if (c.includes('staking') || c.includes('restak')) return `Check the staking rewards on ${name} once a week and restake anything the position earned.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Open or close one small position on ${name} once a week, so the activity stays current.`;
  if (c.includes('prediction')) return `Place one small market position on ${name} once a week.`;
  if (c.includes('curator') || c.includes('allocator')) return `Check the ${name} vault's performance once a week and top it up by $10 when it grows.`;
  if (c.includes('stable')) return `Mint or redeem a small amount of the stable asset through ${name} once a week.`;
  if (c.includes('rwa')) return `Check the yield accrual on the ${name} asset once a week and keep the holding past each payout.`;
  if (c.includes('insurance')) return `Check the ${name} cover once a week so the policy never lapses unnoticed.`;
  if (c.includes('index')) return `Check the ${name} index weights once a week and rebalance only when one weight drifts far.`;
  if (c.includes('privacy')) return `Check the shielded balance on ${name} once a week and make one shielded transfer a month.`;
  if (c.includes('ai agent') || c.includes('ai agents')) return `Run one small paid task through ${name} once a week and keep the receipt.`;
  if (c.includes('nft')) return `Check the ${name} collection floor once a week and keep the NFT listed or held as the plan says.`;
  if (c.includes('gaming')) return `Play one short session on ${name} once a week and keep the earned asset in the farm wallet.`;
  return `Make one small deposit of $10 into ${name} on ${chain} once a week, so the wallet stays active.`;
}

/** How long the hold lasts, and why this protocol earns that window: its age with no token
 *  and its 7-day TVL move, both from its own record. */
function holdReason(p: SnapshotProtocol, age: number | null, hold: number): string {
  const ageText = age === null ? 'an unknown age' : `${age} days`;
  const growthText =
    p.change_7d === null ? 'by an unknown amount' : `${p.change_7d >= 0 ? '+' : ''}${p.change_7d.toFixed(1)}%`;
  return (
    `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot: ` +
    `${p.name} has run ${ageText} with no token and its TVL moved ${growthText} in 7 days, so a quick in-and-out leaves no trace.`
  );
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age, 7-day growth), never from a hand-written list of names:
 * the wallet step names its chain and the capital it must hold, the two positions and the weekly action each use the category's
 * own verb, the hold step states the protocol's own age and TVL move, the claim step names the protocol, and the log step records its position.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(p);
  return [
    {
      text: `Use a fresh wallet on ${chain}, funded with the $${capital} you plan to farm with, and keep its seed phrase offline.`,
      cost: 'nothing but the wallet',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and ${gas.setup}`,
      time: '15 minutes to set up',
    },
    {
      text: secondActionFor(p, capital, chain),
      cost: `about $${Math.round(capital / 2)} of capital and ${gas.setup}`,
      time: '10 minutes',
    },
    {
      text: weeklyActionFor(p, capital, chain),
      cost: gas.weekly,
      time: '10 minutes a week',
    },
    {
      text: holdReason(p, age, hold),
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open ${p.name}'s own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the ${p.name} position — the wallet, the dates and every transaction on ${chain} — in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
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

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; ratios: CategoryRatio[]; globalMedian: number; excluded: ExclusionCount[] } {
  const { ratios, globalMedian } = categoryRatios(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every rankable pre-token protocol below the watchlist floor. Never a replacement
  // for a watchlist row: a chosen protocol stays chosen. Rankable here is the exclusion rule itself,
  // so a bridge, staking or wrapped product below the floor is set aside with the rest, never ranked
  // as a launch of its own.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd) chosen.set(p.slug, p);
  }
  // What is set aside, and why: counted from the snapshot, for the dashboard to state.
  const excludedMap = new Map<string, number>();
  for (const p of snapshot.protocols) {
    if (chosen.has(p.slug)) continue;
    const reason = exclusionReason(p);
    if (reason !== null) excludedMap.set(reason, (excludedMap.get(reason) ?? 0) + 1);
  }
  const excluded: ExclusionCount[] = [...excludedMap.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || (a.reason < b.reason ? -1 : 1));

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, ratios, globalMedian, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const board: BoardRow[] = scored.map((s, i) => ({
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
    model: {
      category_ratio: s.ratio,
      ratio_live_count: s.ratioLiveCount,
      growth_pct: s.growthPct,
      growth_multiplier: s.growthMult,
      maturity_multiplier: s.maturityMult,
      chain_multiplier: s.chainMult,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
  return { board, ratios, globalMedian, excluded };
}

/** A board row's compact form for data.js: one array, columns fixed by position. */
export function radarRow(row: BoardRow, categoryIdx: number, chainIdxs: number[], onWatchlist: boolean): (number | string | number[] | null)[] {
  return [
    row.rank,
    row.slug,
    row.name,
    categoryIdx,
    chainIdxs,
    row.tvl_usd,
    row.change_7d,
    row.age_days,
    row.implied_value_usd,
    onWatchlist ? 1 : 0,
  ];
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { board, ratios, globalMedian, excluded } = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const categories: string[] = [];
  const chains: string[] = [];
  const catIndex = new Map<string, number>();
  const chainIndex = new Map<string, number>();
  for (const r of board) {
    if (r.category !== null && !catIndex.has(r.category)) {
      catIndex.set(r.category, categories.length);
      categories.push(r.category);
    }
    for (const c of r.chains) {
      if (!chainIndex.has(c)) {
        chainIndex.set(c, chains.length);
        chains.push(c);
      }
    }
  }
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    excluded_size: excluded.reduce((n, e) => n + e.count, 0),
    excluded,
    ratios,
    global_median: Math.round(globalMedian * 10000) / 10000,
    categories,
    chains,
    rows: board.map((r) => radarRow(r, r.category === null ? -1 : catIndex.get(r.category)!, r.chains.map((c) => chainIndex.get(c)!), snapshot.watchlist.includes(r.slug))),
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

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network.
 *  Rows are arrays in this column order: rank, slug, name, category index (-1: none), chain indices,
 *  TVL, 7d change, age in days, implied value, on the watchlist (1) or not (0). Categories and
 *  chains are listed once, in DATA.categories/chains; the page recomputes the model's multipliers
 *  from the category ratios in DATA.ratios and the constants in DATA.model. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

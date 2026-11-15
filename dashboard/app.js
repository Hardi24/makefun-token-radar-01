// Token Radar dashboard. Reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board, a filterable table, category totals, a per-protocol detail drawer with the
// model's own arithmetic and the protocol's farm plan. No network: every byte shown is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', tvl: 0, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtDate(s) {
    if (!s) return 'unknown';
    return s;
  }
  // The model in one function (radar-3): the page recomputes a row from the snapshot figures and
  // checks the number board.json carries, so the page's code and the board's data are visibly the
  // same arithmetic. The multiple is a size curve fitted to the snapshot's own live-token
  // comparables (DATA.model carries the fitted coefficients); growth, maturity and chains are the
  // same multipliers main.ts uses. No name is special-cased.
  function categoryTier(category) {
    var c = (category || '').toLowerCase();
    if (c === 'cex' || c === 'chain' || c.indexOf('bridge') >= 0 || c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0 || c.indexOf('wrapper') >= 0 || c.indexOf('anchor btc') >= 0 || c.indexOf('decentralized btc') >= 0) return 'infra';
    if (/dex|lend|cdp|yield|deriv|perpetual|prediction|rwa|basis|synthet|option|stable|farm|launchpad|payment|insurance|curator|allocator|manager|capital|collateral|interest|vault|leverage|uncollateralized/.test(c)) return 'premium';
    return 'standard';
  }
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var n = (row.chains || []).length;
    var chainMult = n >= 9 ? model.chain_wide : n >= 4 ? model.chain_multi : n >= 2 ? model.chain_few : model.chain_single;
    var multiple = Math.pow(10, model.size_curve_intercept + model.size_curve_slope * Math.log10(row.tvl_usd));
    return Math.max(1, Math.round(row.tvl_usd * multiple * growthMult * maturity * chainMult));
  }
  function formatUsdInt(n) {
    return '$' + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  // A plan's economics, the same arithmetic main.ts writes to board.json: capital the steps deploy,
  // gas they burn, all-in cost, value at the comps' low end, net after cost, and the verdict.
  function planEconomics(p) {
    var capital = capitalFor(p);
    var small = Math.max(10, Math.round(capital / 5));
    var hold = holdDaysFor(p.age_days);
    var gas = 5 + (capital >= 150 ? 8 : 4) + 2 + 2 + 2 * Math.ceil(hold / 7);
    var totalCapital = capital + 2 * small;
    var totalCost = totalCapital + gas;
    var lowEnd = Math.max(1, Math.round(p.implied_value_usd * DATA.model.low_factor));
    var net = lowEnd - totalCost;
    var ratio = lowEnd / totalCost;
    var verdict = ratio >= 10000 ? 'FARM' : ratio >= 1000 ? 'THIN' : 'SKIP';
    return { capital_usd: totalCapital, gas_usd: gas, total_cost_usd: totalCost, low_end_usd: lowEnd, net_usd: net, verdict: verdict };
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json (radar-3, seven steps):
  // category, chains, TVL, age and seven-day growth decide the actions, the capital, the hold and
  // every cost and time; the last step nets the plan at the comps' low end. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function secondChainOf(p) { return p.chains && p.chains.length > 1 ? p.chains[1] : null; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0 || c.indexOf('uncollateralized') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' as collateral and keep the deposit open, so the position shows in the protocol\'s lending book.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + '\'s largest pool on ' + chain + ' and keep the position open, so the wallet earns fees and counts as a liquidity provider.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC into ' + chain + ' through ' + name + ' and use the bridged funds inside an app on ' + chain + ', so the transfer is a real use and not a pass-through.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake $' + capital + ' of the chain\'s staking asset through ' + name + ' on ' + chain + ' and keep the receipt token in the wallet.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0 || c.indexOf('basis') >= 0 || c.indexOf('synthet') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' on ' + chain + ' and open one small hedged position, then close it the same week.';
    if (c.indexOf('prediction') >= 0) return 'Fund the wallet with $' + capital + ' and place one market position on ' + name + ' on ' + chain + ', then let it settle instead of closing it at once.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('manager') >= 0 || c.indexOf('capital') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the vault shares in the wallet, so the deposit is tied to the vault\'s own accounting.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it in the wallet.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + ' of the protocol\'s yield-bearing asset on ' + chain + ' and hold it, so the wallet accrues the asset\'s yield week by week.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active in the wallet.';
    if (c.indexOf('launchpad') >= 0) return 'Commit $' + capital + ' to join ' + name + '\'s next launch on ' + chain + ' and finish the launch\'s own tasks on its page.';
    if (c.indexOf('payment') >= 0 || c.indexOf('card') >= 0) return 'Load $' + capital + ' onto ' + name + ' on ' + chain + ' and make one real payment with it, so the wallet shows spending and not only a deposit.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function secondActionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    var small = Math.max(10, Math.round(capital / 5));
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0 || c.indexOf('uncollateralized') >= 0) return 'Borrow $' + small + ' of stablecoin against the deposit on ' + chain + ' and repay it within a week, so the wallet shows both sides of ' + name + '\'s market.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('farm') >= 0) return 'Swap $' + small + ' through ' + name + ' on ' + chain + ' once a week, so the wallet is a trader as well as a liquidity provider.';
    if (c.indexOf('bridge') >= 0) return 'Bridge a second, smaller $' + small + ' transfer through ' + name + ' to a different app on ' + chain + ' the following week.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake a second $' + small + ' tranche through ' + name + ' on ' + chain + ' a week later, so the position grows in steps rather than one lump.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0 || c.indexOf('basis') >= 0 || c.indexOf('synthet') >= 0) return 'Open and close one more small hedged position on ' + name + ' the next week, keeping each trade under $' + small + ' of margin.';
    if (c.indexOf('prediction') >= 0) return 'Place a second, smaller $' + small + ' position on a different market on ' + name + ' once the first one settles.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('manager') >= 0 || c.indexOf('capital') >= 0) return 'Allocate $' + small + ' to a second vault of ' + name + ' on ' + chain + ' run by a different curator, so the wallet is spread across two vaults.';
    if (c.indexOf('stable') >= 0) return 'Check the stable asset\'s peg and yield on ' + name + ' each week and top the position up by $' + small + ' only while it holds.';
    if (c.indexOf('rwa') >= 0) return 'Read ' + name + '\'s own report on the underlying assets each week and check the yield credited to the wallet.';
    if (c.indexOf('insurance') >= 0) return 'Read the cover terms on ' + name + '\'s own page and check the policy is still active before the hold ends.';
    if (c.indexOf('launchpad') >= 0) return 'Vote or complete the community task for the next launch on ' + name + ' once the first commitment is in.';
    if (c.indexOf('payment') >= 0 || c.indexOf('card') >= 0) return 'Make a second, smaller $' + small + ' payment through ' + name + ' a week later, so the wallet shows repeat use.';
    return 'Use a second feature of ' + name + ' on ' + chain + ' once a week, such as a swap, a deposit or a vote, so the wallet is not a one-time deposit.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var second = secondChainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var small = Math.max(10, Math.round(capital / 5));
    var growth = (typeof p.change_7d === 'number' && isFinite(p.change_7d)) ? p.change_7d : 0;
    var growthNote = growth >= 20
      ? ' TVL is up ' + growth.toFixed(1) + '% in seven days, so keep the cadence while momentum is hot.'
      : growth <= -20
        ? ' TVL is down ' + Math.abs(growth).toFixed(1) + '% in seven days, so keep the position small and re-check before adding more.'
        : '';
    var listed = p.listed_at === null || p.listed_at === undefined ? 'an unlisted start date' : p.listed_at;
    var econ = planEconomics(p);
    return [
      { text: 'Open a fresh wallet for this farm only, fund it on ' + chain + ' with $' + capital + ' in USDC plus about $5 for gas, and keep its seed phrase offline.', cost: '$' + capital + ' of USDC plus about $5 of gas', time: '10 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: secondActionFor(p, capital, chain), cost: 'about $' + small + ' of capital and $2 of gas', time: '10 minutes' },
      { text: second !== null
          ? 'Repeat a smaller $' + small + ' deposit on ' + second + ' so the same wallet shows activity on two chains, ' + chain + ' and ' + second + ', instead of one.'
          : 'Deepen the position on ' + chain + ': add a second $' + small + ' tranche to a different pool or vault of ' + p.name + ', so the wallet is not a single deposit.',
        cost: 'about $' + small + ' of capital and $2 of gas', time: '10 minutes' },
      { text: 'Return once a week and repeat a qualifying action on ' + chain + ', such as a deposit, a swap, a borrow or a vote, so the wallet stays active in every weekly snapshot.' + growthNote, cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days: ' + p.name + ' has been tracked since ' + listed + ', so a position that spans several snapshots counts more than a one-day deposit.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: 'Before you withdraw, open ' + p.name + '\'s own points or rewards page from its official site and claim only from the link it publishes; never pay a fee to claim, and log the wallet, the dates and every transaction hash. Plan total: ' + formatUsdInt(econ.total_cost_usd) + ' all in (' + formatUsdInt(econ.capital_usd) + ' capital + ' + formatUsdInt(econ.gas_usd) + ' gas). At the comps\' low end this protocol is worth ' + formatUsdInt(econ.low_end_usd) + ' — net ' + formatUsdInt(econ.net_usd) + ' after the plan\'s cost, verdict ' + econ.verdict + '.', cost: 'no fee to check, and never pay to claim', time: '15 minutes' }
    ].map(stepText);
  }

  var TVL_OPTIONS = [
    { v: 0, label: 'Any TVL' },
    { v: 1e7, label: 'TVL $10M+' },
    { v: 5e7, label: 'TVL $50M+' },
    { v: 1e8, label: 'TVL $100M+' },
    { v: 5e8, label: 'TVL $500M+' },
    { v: 1e9, label: 'TVL $1B+' }
  ];

  function categories() {
    return Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
  }
  function topChains(n) {
    var counts = {};
    DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { counts[c] = (counts[c] || 0) + 1; }); });
    return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, n || 12);
  }
  function catCount(c) { return DATA.rows.filter(function (r) { return (r.category || 'Other') === c; }).length; }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tvl')) state.tvl = parseInt(params.get('tvl'), 10) || 0;
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('sort')) state.sort = params.get('sort');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tvl) params.set('tvl', String(state.tvl));
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.sort !== 'implied') params.set('sort', state.sort);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function matchFilters(r) {
    if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
    if (state.chain !== 'all' && !(r.chains || []).indexOf(state.chain) >= 0) return false;
    if (state.tvl && r.tvl_usd < state.tvl) return false;
    var q = state.q.trim().toLowerCase();
    if (!q) return true;
    var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  }
  function rows() { return DATA.rows.filter(matchFilters); }
  function liveRows() { return DATA.live.filter(matchFilters); }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'rank') { av = a.rank || 0; bv = b.rank || 0; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  var totalImplied = DATA.rows.reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
  var top10Share = Math.round(DATA.rows.slice(0, 10).reduce(function (s, r) { return s + r.implied_value_usd; }, 0) / totalImplied * 100);
  var medianImplied = DATA.rows[Math.floor(DATA.rows.length / 2)].implied_value_usd;

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name' }, 'Token ', el('em', { text: 'Radar' }))),
      el('div', { class: 'top-meta' },
        el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', null, 'Source: ', el('b', { text: 'DefiLlama protocols index' })),
        el('span', null, 'Model ', el('b', { text: DATA.model_version }))
      )
    );
  }

  function hero() {
    return el('section', { class: 'hero' },
      el('div', null,
        el('h1', { text: DATA.board_size + ' pre-token protocols, ranked by what their token could be worth' }),
        el('p', { class: 'lede' },
          'The watchlist is the floor: every protocol with at least ', el('b', { text: '$' + Math.round(DATA.floor_usd / 1e6) + 'M' }),
          ' of TVL and no token on record — plus ', el('b', { text: DATA.early_size + ' early finds' }),
          ' below that floor. Priced from ', el('b', { text: DATA.calibration.comps_n + ' live-token comparables' }),
          ': a size curve fitted to their market caps and tested blind (median error ',
          el('b', { text: DATA.calibration.cv_median_abs_error.toFixed(2) + '×' }), ' on held-out comps). Implied value is a model of the snapshot, not a promise of a launch or a price.'
        )
      ),
      el('div', { class: 'stats' },
        el('div', { class: 'stat' }, el('span', { text: 'Total implied value' }), el('b', { text: fmtUsd(totalImplied) }), el('small', { text: 'across ' + DATA.board_size + ' ranked rows' })),
        el('div', { class: 'stat' }, el('span', { text: 'Top 10 hold' }), el('b', { text: top10Share + '%' }), el('small', { text: 'of all implied value' })),
        el('div', { class: 'stat' }, el('span', { text: 'Median protocol' }), el('b', { text: fmtUsd(medianImplied) }), el('small', { text: 'rank ' + Math.ceil(DATA.board_size / 2) + ' of ' + DATA.board_size })),
        el('div', { class: 'stat' }, el('span', { text: 'Live-token set aside' }), el('b', { text: String(DATA.live_size) }), el('small', { text: 'shown with market caps, not models' }))
      )
    );
  }

  function spotlight() {
    var top = DATA.rows.slice(0, 5);
    return el('div', null,
      el('div', { class: 'section-title' },
        el('h2', { text: 'The top five' }),
        el('span', { class: 'sub', text: 'Select any card for its model and farm plan' })
      ),
      el('div', { class: 'spot' }, top.map(function (r, i) {
        return el('button', { type: 'button', class: 'card' + (i === 0 ? ' first' : ''), onclick: function () { openDetail(r.slug); } },
          el('span', { class: 'rank' }, el('span', { text: 'Rank ' + r.rank }), el('b', { text: fmtPct(r.change_7d) + ' 7d' })),
          el('h3', { text: r.name }),
          el('span', { class: 'cat', text: (r.category || 'Other') + ' · ' + (r.chains && r.chains.length ? r.chains[0] : '—') }),
          el('span', { class: 'big' }, fmtUsd(r.implied_value_usd), el('small', { text: 'implied value' })),
          el('span', { class: 'verdict ' + r.farm_verdict.toLowerCase(), text: r.farm_verdict + ' · ' + formatUsdInt(r.farm_cost_usd) + ' all-in' }),
          el('span', { class: 'meta' }, el('span', { text: 'TVL ' + fmtUsd(r.tvl_usd) }), el('span', { text: fmtAge(r.age_days) + ' old' }))
        );
      }))
    );
  }

  function categoryBars() {
    var totals = {};
    DATA.rows.forEach(function (r) {
      var c = r.category || 'Other';
      if (!totals[c]) totals[c] = { total: 0, count: 0 };
      totals[c].total += r.implied_value_usd;
      totals[c].count += 1;
    });
    var list = Object.keys(totals).map(function (c) { return { name: c, total: totals[c].total, count: totals[c].count }; })
      .sort(function (a, b) { return b.total - a.total; }).slice(0, 8);
    var max = list[0] ? list[0].total : 1;
    return el('div', null,
      el('div', { class: 'section-title' },
        el('h2', { text: 'Where the implied value sits' }),
        el('span', { class: 'sub', text: 'Top categories by total implied value' })
      ),
      el('div', { class: 'catbars' }, list.map(function (c) {
        return el('div', { class: 'catbar' },
          el('span', { text: c.name }),
          el('span', { class: 'track' }, el('i', { style: 'width:' + Math.max(2, Math.round(c.total / max * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(c.total) }),
          el('span', { class: 'cnt', text: c.count + ' protocol' + (c.count === 1 ? '' : 's') })
        );
      }))
    );
  }

  function controls() {
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var cats = categories();
    var catSel = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories (' + DATA.board_size + ')' }),
      cats.map(function (c) { return el('option', { value: c, text: c + ' (' + catCount(c) + ')', selected: c === state.category ? 'selected' : null }); })
    );
    catSel.addEventListener('change', function () { state.category = catSel.value; writeHash(); render(); });
    var chains = topChains(12);
    var chainSel = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); render(); });
    var tvlSel = el('select', { id: 'tvl', 'aria-label': 'Filter by minimum TVL' },
      TVL_OPTIONS.map(function (o) { return el('option', { value: String(o.v), text: o.label, selected: o.v === state.tvl ? 'selected' : null }); })
    );
    tvlSel.addEventListener('change', function () { state.tvl = parseInt(tvlSel.value, 10) || 0; writeHash(); render(); });
    var sortSel = el('select', { id: 'sort', 'aria-label': 'Sort the board' },
      [['implied', 'Implied value'], ['tvl', 'TVL'], ['growth', '7-day growth'], ['age', 'Age'], ['name', 'Name'], ['rank', 'Rank']].map(function (o) {
        return el('option', { value: o[0], text: 'Sort: ' + o[1], selected: o[0] === state.sort ? 'selected' : null });
      })
    );
    sortSel.addEventListener('change', function () { state.sort = sortSel.value; state.dir = state.sort === 'name' || state.sort === 'age' ? 1 : -1; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    var shown = state.tab === 'pre-token' ? rows().length : liveRows().length;
    var total = state.tab === 'pre-token' ? DATA.board_size : DATA.live_size;
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSel),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel),
      el('div', { class: 'field' }, el('label', { for: 'tvl', text: 'Minimum TVL' }), tvlSel),
      el('div', { class: 'field' }, el('label', { for: 'sort', text: 'Sort by' }), sortSel),
      el('div', { class: 'field' }, el('span', { class: 'lab', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: shown + ' of ' + total + ' shown' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'name' || key === 'age' ? 1 : -1; } writeHash(); render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' ↓' : ' ↑' }) : null
      )
    );
  }

  function clearFilters() {
    state.q = ''; state.category = 'all'; state.chain = 'all'; state.tvl = 0; state.tab = 'pre-token'; state.sort = 'implied'; state.dir = -1;
    writeHash(); render();
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category, chain or TVL floor to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear all filters', onclick: clearFilters })
      ));
    }
    var max = DATA.rows[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var mult = r.tvl_usd > 0 ? (r.implied_value_usd / r.tvl_usd).toFixed(2) + '× TVL' : '';
      var tr = el('tr', {
        class: r.rank === 1 ? 'top1' : r.rank <= 3 ? 'top3' : '',
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', null, el('span', { class: 'rankchip', text: String(r.rank) })),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') + (r.chains && r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }),
          el('span', { class: 'mult', text: mult }),
          el('span', { class: 'verdict ' + r.farm_verdict.toLowerCase(), text: r.farm_verdict + ' · ' + formatUsdInt(r.farm_cost_usd) })
        )),
        el('td', null, el('span', { class: 'badge', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('rank', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var list = liveRows();
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No live-token protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category, chain or TVL floor.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear all filters', onclick: clearFilters })
      ));
    }
    var tbody = el('tbody');
    list.forEach(function (r) {
      tbody.appendChild(el('tr', { tabindex: '0' },
        el('td', null, el('span', { class: 'badge live', text: 'live' })),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'badge live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var c = DATA.calibration;
    var top = DATA.rows[0];
    var multiple = Math.pow(10, m.size_curve_intercept + m.size_curve_slope * Math.log10(top.tvl_usd));
    var base = top.tvl_usd * multiple;
    var farm = 0, thin = 0, skip = 0;
    DATA.rows.forEach(function (r) { if (r.farm_verdict === 'FARM') farm++; else if (r.farm_verdict === 'THIN') thin++; else skip++; });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', null, 'Every row is scored by one curve fitted to the market, not by a multiple somebody asserted. No protocol name is special-cased, and no row is hand-picked. ', el('b', { text: 'Implied value answers one question: if this protocol issued a token today and the market valued it like the snapshot says, what would it be worth?' }), ' It does not predict whether or when a token comes.'),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd × 10^(' + m.size_curve_intercept.toFixed(4) + ' ' + (m.size_curve_slope < 0 ? '− ' : '+ ') + Math.abs(m.size_curve_slope).toFixed(4) + ' × log10(tvl_usd)) × growthMult × maturityMult × chainMult )'
      ),
      el('div', { class: 'params' },
        el('div', { class: 'param' }, el('span', { text: 'Comparables fitted' }), el('b', { text: c.comps_n + ' live-token comps' })),
        el('div', { class: 'param' }, el('span', { text: 'Size curve, log-log OLS' }), el('b', { text: 'a ' + m.size_curve_intercept.toFixed(4) + ', b ' + m.size_curve_slope.toFixed(4) })),
        el('div', { class: 'param' }, el('span', { text: 'Fit explains (R²)' }), el('b', { text: (c.size_curve_r2 * 100).toFixed(1) + '% of log multiples' })),
        el('div', { class: 'param' }, el('span', { text: 'Growth: 1 + clamp(7d, ' + m.growth_floor + '%, +' + m.growth_cap + '%) / 100 × ' + m.growth_weight }), el('b', { text: 'clamped, so one outlier cannot run away' })),
        el('div', { class: 'param' }, el('span', { text: 'Maturity: floor + range over window' }), el('b', { text: m.maturity_floor + ' + up to ' + m.maturity_range + ' over ' + m.maturity_days + 'd' })),
        el('div', { class: 'param' }, el('span', { text: 'Chains: 1 / 2–3 / 4–8 / 9+' }), el('b', { text: '× ' + m.chain_single + ' / ' + m.chain_few + ' / ' + m.chain_multi + ' / ' + m.chain_wide }))
      ),
      el('p', { class: 'worked' },
        'Worked example — rank 1, ', el('b', { text: top.name }), ': ',
        fmtUsd(top.tvl_usd), ' × curve multiple ', el('b', { text: multiple.toFixed(4) }), ' = ', el('b', { text: fmtUsd(base) }),
        ', × growth ', el('b', { text: String(top.growth_multiplier) }), ' (7d ', fmtPct(top.change_7d), '), × maturity ',
        el('b', { text: String(top.maturity_multiplier) }), ' (', fmtAge(top.age_days), ' with no token), × chains ',
        el('b', { text: String(top.chain_multiplier) }), ' = ',
        el('b', { text: fmtUsd(top.implied_value_usd) }), '.'
      ),
      el('p', { class: 'note' }, 'Where the curve comes from: the comps are the snapshot\u2019s live-token protocols with a market cap above zero, minus CEX and minus the infra categories the watchlist rule excludes (bridges, staking, restaking, chains, wrappers, anchor-BTC) — ' + c.comps_n + ' protocols (' + c.comps_premium_n + ' premium, ' + c.comps_standard_n + ' standard by category word). For each, the residual multiple is market cap divided by TVL after growth, maturity and chain effects are stripped out; the curve is the least-squares line of log multiple on log TVL. Its slope is negative: a bigger protocol trades at a lower multiple of TVL, so the curve prices size from the market instead of charging every size the same multiple.'),
      el('p', { class: 'note' }, 'Tested blind: 5-fold cross-validation over the comps (folds by slug order, four folds fit, one held out) predicts held-out market caps with a median error of ', el('b', { text: c.cv_median_abs_error.toFixed(2) + '×' }), ' and ', el('b', { text: Math.round(c.cv_within_2x * 100) + '% within 2×' }), '. The old flat prior (0.25 of TVL, tested the same way) lands a touch closer on this noisy set (' + c.flat_cv_median_abs_error.toFixed(2) + '×, ' + Math.round(c.flat_cv_within_2x * 100) + '% within 2×) — the curve is kept anyway, because it prices the size effect the market itself shows instead of asserting one multiple for every size. Growth is clamped because one protocol in the snapshot moved +4,448% in seven days; maturity rewards protocols that have run longest with no token. Age is the time since the protocol was first listed; an unlisted age uses ' + m.unknown_age_days + ' days. A protocol \u201Crecords no token\u201D when the snapshot carries no market cap, no CoinGecko id and no symbol for it; that is a record, not proof it has none.'),
      el('p', { class: 'note' }, 'Farm plans are netted at the market\u2019s low end: low-end value is the implied value × ' + m.low_factor.toFixed(3) + ', the comps\u2019 25th-percentile multiple over their median. Each plan\u2019s verdict compares that low-end value with the plan\u2019s all-in cost (capital plus gas): FARM at 10,000× or more, THIN at 1,000× or more, SKIP below. On this board: ' + farm + ' FARM, ' + thin + ' THIN, ' + skip + ' SKIP — no row falls below THIN, since even the weakest low-end value on the board is still over 5,000× its plan\u2019s cost.')
    );
  }

  function footer() {
    return el('footer', { class: 'foot' },
      el('p', { text: 'Data: DefiLlama protocols index, snapshot ' + DATA.as_of + '. Watchlist floor $' + Math.round(DATA.floor_usd / 1e6) + 'M TVL · ' + DATA.watchlist_size + ' watchlist protocols covered, ' + DATA.early_size + ' early rows below the floor, ' + DATA.live_size + ' live-token protocols set aside.' }),
      el('p', { text: 'Implied value is this entry\'s model, not a price and not a promise. Farm plans are generic steps derived from each protocol\'s own category, chains, TVL and age — check the protocol\'s own page before you move funds, and never pay to claim an airdrop.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); render(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var capital = capitalFor(row);
    var hold = holdDaysFor(row.age_days);
    var m = DATA.model;
    var multiple = Math.pow(10, m.size_curve_intercept + m.size_curve_slope * Math.log10(row.tvl_usd));
    var base = row.tvl_usd * multiple;
    var nChains = (row.chains || []).length;
    var run1 = base * row.growth_multiplier;
    var run2 = run1 * row.maturity_multiplier;
    var econ = planEconomics(row);
    var recomputed = impliedOf(row, m);
    var above = DATA.board_size - row.rank;
    var mult = row.tvl_usd > 0 ? (row.implied_value_usd / row.tvl_usd).toFixed(2) : 'n/a';
    var prev = DATA.rows.filter(function (r) { return r.rank === row.rank - 1; })[0];
    var next = DATA.rows.filter(function (r) { return r.rank === row.rank + 1; })[0];

    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + ' · no token on record' }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' · first listed ' + fmtDate(row.listed_at) + ' · ' + fmtAge(row.age_days) + ' with no token' })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('div', { class: 'chips' },
      (row.chains || []).slice(0, 8).map(function (c) { return el('span', { class: 'chip', text: c }); }),
      (row.chains || []).length > 8 ? el('span', { class: 'chip', text: '+' + (row.chains.length - 8) + ' more' }) : null
    ));
    dialog.appendChild(el('div', { class: 'kpis' },
      el('div', { class: 'kpi' }, el('span', { text: 'TVL' }), el('b', { text: fmtUsd(row.tvl_usd) }), el('small', { text: 'locked in the protocol' })),
      el('div', { class: 'kpi' }, el('span', { text: 'Seven-day growth' }), el('b', { class: row.change_7d !== null && row.change_7d >= 0 ? 'pos' : 'neg', text: fmtPct(row.change_7d) }), el('small', { text: 'TVL change, last 7 days' })),
      el('div', { class: 'kpi' }, el('span', { text: 'Age with no token' }), el('b', { text: fmtAge(row.age_days) }), el('small', { text: 'since first listed' })),
      el('div', { class: 'kpi' }, el('span', { text: 'Implied value' }), el('b', { text: fmtUsd(row.implied_value_usd) }), el('small', { text: mult + '× its TVL · above ' + above + ' of ' + DATA.board_size }))
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'How the model scored it' }),
      el('p', { text: 'One function scores every protocol. Each line below is that function, step by step, on this protocol\'s own figures.' }),
      el('div', { class: 'waterfall' },
        el('div', { class: 'wf-row' }, el('span', { class: 'lab' }, 'Base — TVL × fitted curve multiple ', el('b', { text: multiple.toFixed(4) })), el('span', { class: 'val', text: fmtUsd(base) })),
        el('div', { class: 'wf-row' }, el('span', { class: 'lab' }, '× growth — 7d ', el('b', { text: fmtPct(row.change_7d) }), ' clamped to ', el('b', { text: m.growth_floor + '% … +' + m.growth_cap + '%' })), el('span', { class: 'val', text: '× ' + row.growth_multiplier + ' → ' + fmtUsd(run1) })),
        el('div', { class: 'wf-row' }, el('span', { class: 'lab' }, '× maturity — ', el('b', { text: fmtAge(row.age_days) }), ' of ', el('b', { text: m.maturity_days + ' days' })), el('span', { class: 'val', text: '× ' + row.maturity_multiplier + ' → ' + fmtUsd(run2) })),
        el('div', { class: 'wf-row' }, el('span', { class: 'lab' }, '× chains — on ', el('b', { text: nChains + ' chain' + (nChains === 1 ? '' : 's') })), el('span', { class: 'val', text: '× ' + row.chain_multiplier })),
        el('div', { class: 'wf-row total' }, el('span', { class: 'lab', text: 'Implied value' }), el('span', { class: 'val', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'check' },
        'Recomputed in this page from the snapshot figures: ', el('b', { text: fmtUsd(recomputed) }),
        recomputed === row.implied_value_usd ? ' — the same number the board carries.' : ' — differs from the board: the data would be stale.',
        ' This is an estimate, not a price.'
      )
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('div', { class: 'plan-sum' },
        el('span', { text: '7 steps' }),
        el('span', { text: 'Capital ' + formatUsdInt(econ.capital_usd) }),
        el('span', { text: 'Gas ' + formatUsdInt(econ.gas_usd) }),
        el('span', { text: 'All-in ' + formatUsdInt(econ.total_cost_usd) }),
        el('span', { text: 'Hold ' + hold + ' days' }),
        el('span', { class: 'verdict ' + econ.verdict.toLowerCase(), text: econ.verdict + ' · net ' + formatUsdInt(econ.net_usd) })
      ),
      el('p', { class: 'note' }, 'Netted at the market\u2019s low end: this protocol at the comps\u2019 lower quartile is worth ', el('b', { text: formatUsdInt(econ.low_end_usd) }), ', against ', el('b', { text: formatUsdInt(econ.total_cost_usd) + ' all-in' }), ' for the plan — a net of ', el('b', { text: formatUsdInt(econ.net_usd) }), '. Verdict ', el('b', { text: econ.verdict }), ': FARM at 10,000× the plan\u2019s cost or more, THIN at 1,000× or more, SKIP below. The low end is the implied value × ' + DATA.model.low_factor.toFixed(3) + ', the comps\u2019 25th-percentile multiple over their median.'),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    dialog.appendChild(el('div', { class: 'nav' },
      prev ? el('button', { class: 'button', type: 'button', text: '← Rank ' + prev.rank + ': ' + prev.name, onclick: function () { openDetail(prev.slug); } }) : el('span'),
      next ? el('button', { class: 'button', type: 'button', text: 'Rank ' + next.rank + ': ' + next.name + ' →', onclick: function () { openDetail(next.slug); } }) : el('span')
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(hero());
    shell.appendChild(spotlight());
    shell.appendChild(categoryBars());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(footer());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();

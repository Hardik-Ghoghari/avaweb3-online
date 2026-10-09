/**
 * Letty Trading — Admin Backend (pure Node.js, no npm deps)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const store = require('./store');

const PORT = process.env.PORT || 3847;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin098';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'ccweb3@admin.com';
const tokens = new Map();
const PUBLIC_DIR = path.join(__dirname, 'public');
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');

function makeToken() { return crypto.randomBytes(24).toString('hex'); }

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 12 * 1024 * 1024) { reject(new Error('Body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function send(res, status, data, extraHeaders) {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  const headers = Object.assign({
    'Content-Type': typeof data === 'string' ? 'text/html; charset=utf-8' : 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  }, extraHeaders || {});
  res.writeHead(status, headers);
  res.end(body);
}

function getToken(req, body) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  const u = new URL(req.url, 'http://localhost');
  if (u.searchParams.get('token')) return u.searchParams.get('token');
  if (body && body.token) return body.token;
  return null;
}

function requireAdmin(req, body) {
  const token = getToken(req, body);
  const entry = tokens.get(token);
  return entry && entry.exp >= Date.now();
}

function mime(p) {
  const ext = path.extname(p).toLowerCase();
  return ({'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon'}[ext] || 'application/octet-stream');
}

function serveStatic(req, res, urlPath) {
  let rel = urlPath.replace(/^\/admin\/?/, '') || 'index.html';
  rel = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'Forbidden' });
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    const idx = path.join(PUBLIC_DIR, 'index.html');
    if (fs.existsSync(idx)) return send(res, 200, fs.readFileSync(idx, 'utf8'), { 'Content-Type': 'text/html; charset=utf-8' });
    return send(res, 404, { error: 'Not found' });
  }
  const buf = fs.readFileSync(file);
  res.writeHead(200, { 'Content-Type': mime(file), 'Access-Control-Allow-Origin': '*' });
  res.end(buf);
}

function applyDecision(id, approve, reviewer, note, reason) {
  const s = store.get();
  const r = s.requests.find((x) => String(x.id) === String(id));
  if (!r) return { error: 'Not found', status: 404 };
  if (r.status !== 'review') return { error: 'Already decided', status: 400 };
  if (approve && r.type === 'withdraw' && (s.config.blacklist || []).includes(r.addr))
    return { error: 'Address is blocked', status: 400 };
  const need = store.riskScore(r, s).usd >= s.config.dualApproval ? 2 : 1;
  const approvals = r.approvals || [];
  if (approve) {
    if (!approvals.includes(reviewer || 'Reviewer A')) approvals.push(reviewer || 'Reviewer A');
    if (approvals.length < need) {
      store.mutate((st) => { st.requests.find((y) => y.id === r.id).approvals = approvals; });
      store.addAudit(reviewer || 'admin', `Partial approval (${approvals.length}/${need}) on ${r.id}`);
      return { ok: true, partial: true, approvals: approvals.length, need };
    }
  }
  store.mutate((st) => {
    const x = st.requests.find((y) => y.id === r.id);
    x.status = approve ? 'completed' : 'rejected';
    x.approvals = approvals; x.decidedAt = Date.now();
    x.decisionNote = note || ''; x.rejectReason = approve ? '' : reason || '';
    const u = st.users.find((usr) => usr.id === x.userId);
    if (u && approve) {
      u.balances = u.balances || {};
      if (x.type === 'deposit') {
        u.balances[x.asset] = (u.balances[x.asset] || 0) + x.amount;
        if (x.asset === 'USDT') u.balanceUsdt = (u.balanceUsdt || 0) + x.amount;
      } else {
        u.balances[x.asset] = Math.max(0, (u.balances[x.asset] || 0) - x.amount);
        if (x.asset === 'USDT') u.balanceUsdt = Math.max(0, (u.balanceUsdt || 0) - x.amount);
      }
    }
  });
  const kind = r.type === 'deposit' ? 'deposit' : 'withdrawal';
  store.addAudit(reviewer || 'admin', (approve ? 'Approved ' : 'Rejected ') + kind + ' ' + r.id);
  store.addUserNotif(r.userId, approve ? (r.type === 'deposit' ? 'Deposit approved' : 'Withdrawal approved') : kind + ' rejected', `${r.amount} ${r.asset}`);
  return { ok: true, status: approve ? 'completed' : 'rejected' };
}


const CRYPTO_IDS = {
  BTC: 'bitcoin', ETH: 'ethereum', BNB: 'binancecoin', SOL: 'solana', XRP: 'ripple',
  DOGE: 'dogecoin', ADA: 'cardano', AVAX: 'avalanche-2', DOT: 'polkadot', LINK: 'chainlink',
  MATIC: 'matic-network', LTC: 'litecoin', UNI: 'uniswap', ATOM: 'cosmos', NEAR: 'near',
  APT: 'aptos', ARB: 'arbitrum', OP: 'optimism', SUI: 'sui', PEPE: 'pepe',
  SHIB: 'shiba-inu', TRX: 'tron', TON: 'the-open-network', ICP: 'internet-computer',
  XLM: 'stellar', BCH: 'bitcoin-cash', FIL: 'filecoin', INJ: 'injective-protocol',
  RENDER: 'render-token', IMX: 'immutable-x'
};
const STOCK_SYMBOLS = [
  'AAPL','MSFT','NVDA','TSLA','AMZN','GOOGL','META','NFLX','AMD','INTC',
  'BABA','JPM','V','MA','DIS','PYPL','COIN','PLTR','SOFI','NIO','CRM','ORCL','BA','UBER'
];
// Yahoo Finance commodity / metal symbols → app tickers
const COMMODITY_YAHOO = {
  WTI: 'CL=F',      // WTI Crude Oil
  BRENT: 'BZ=F',    // Brent Crude
  NG: 'NG=F',       // Natural Gas
  HO: 'HO=F',       // Heating Oil
  RB: 'RB=F',       // RBOB Gasoline
  GCL: 'CL=F',      // alias crude
  ETHANOL: 'EH=F',  // Ethanol futures if available
};
const METAL_YAHOO = {
  XAU: 'GC=F',
  XAG: 'SI=F',
  XPT: 'PL=F',
  XPD: 'PA=F',
  HG: 'HG=F',
  ALI: 'ALI=F',
  ZNC: 'ZNC=F',
  NI: 'NI=F',
  SN: 'SN=F',
  PB: 'PB=F',
};
let priceCache = { at: 0, data: {} };

function httpGetJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? require('https') : require('http');
    const req = lib.get(url, { headers: { 'User-Agent': 'LettyTrading/1.0', Accept: 'application/json' }, timeout: timeoutMs || 12000 }, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        try {
          if (res.statusCode >= 400) return reject(new Error('HTTP ' + res.statusCode));
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}


// Map app symbols → Yahoo Finance chart symbols
const YAHOO_SYMBOL = Object.assign({},
  Object.fromEntries(Object.keys(CRYPTO_IDS || {}).map((s) => [s, s + '-USD'])),
  Object.fromEntries((STOCK_SYMBOLS || []).map((s) => [s, s])),
  METAL_YAHOO || {},
  COMMODITY_YAHOO || {},
  {
    BTC: 'BTC-USD', ETH: 'ETH-USD', BNB: 'BNB-USD', SOL: 'SOL-USD', XRP: 'XRP-USD',
    DOGE: 'DOGE-USD', ADA: 'ADA-USD', AVAX: 'AVAX-USD', DOT: 'DOT-USD', LINK: 'LINK-USD',
    MATIC: 'MATIC-USD', LTC: 'LTC-USD', UNI: 'UNI-USD', ATOM: 'ATOM-USD', NEAR: 'NEAR-USD',
    APT: 'APT-USD', ARB: 'ARB-USD', OP: 'OP-USD', SUI: 'SUI-USD', PEPE: 'PEPE-USD',
    SHIB: 'SHIB-USD', TRX: 'TRX-USD', TON: 'TON-USD', ICP: 'ICP-USD', XLM: 'XLM-USD',
    BCH: 'BCH-USD', FIL: 'FIL-USD', INJ: 'INJ-USD', RENDER: 'RENDER-USD', IMX: 'IMX-USD',
  }
);

const OHLC_RANGES = {
  '1d':  { interval: '5m',  range: '1d' },
  '3d':  { interval: '15m', range: '5d' },
  '1w':  { interval: '1h',  range: '5d' },
  '1m':  { interval: '1d',  range: '1mo' },
  '6m':  { interval: '1d',  range: '6mo' },
  '1y':  { interval: '1d',  range: '1y' },
  'all': { interval: '1wk', range: 'max' },
};

const ohlcCache = {};

async function fetchOHLC(symbol, rangeKey) {
  const key = symbol + '|' + rangeKey;
  const now = Date.now();
  if (ohlcCache[key] && now - ohlcCache[key].at < 120000) return ohlcCache[key].data;

  const cfg = OHLC_RANGES[rangeKey] || OHLC_RANGES['1d'];
  let candles = [];

  // 1) Binance for major crypto (USDT pairs)
  const BINANCE = {
    BTC:'BTCUSDT',ETH:'ETHUSDT',BNB:'BNBUSDT',SOL:'SOLUSDT',XRP:'XRPUSDT',
    DOGE:'DOGEUSDT',ADA:'ADAUSDT',AVAX:'AVAXUSDT',DOT:'DOTUSDT',LINK:'LINKUSDT',
    MATIC:'MATICUSDT',LTC:'LTCUSDT',UNI:'UNIUSDT',ATOM:'ATOMUSDT',NEAR:'NEARUSDT',
    APT:'APTUSDT',ARB:'ARBUSDT',OP:'OPUSDT',SUI:'SUIUSDT',PEPE:'PEPEUSDT',
    SHIB:'SHIBUSDT',TRX:'TRXUSDT',TON:'TONUSDT',ICP:'ICPUSDT',XLM:'XLMUSDT',
    BCH:'BCHUSDT',FIL:'FILUSDT',INJ:'INJUSDT'
  };
  const bInterval = {
    '1d':'5m','3d':'15m','1w':'1h','1m':'4h','6m':'1d','1y':'1d','all':'1w'
  };
  const bLimit = { '1d':288,'3d':288,'1w':168,'1m':180,'6m':180,'1y':365,'all':500 };

  if (BINANCE[symbol]) {
    try {
      const url =
        'https://api.binance.com/api/v3/klines?symbol=' +
        BINANCE[symbol] +
        '&interval=' +
        (bInterval[rangeKey] || '5m') +
        '&limit=' +
        (bLimit[rangeKey] || 200);
      const data = await httpGetJson(url, 12000);
      if (Array.isArray(data)) {
        candles = data.map((k) => ({
          t: k[0],
          o: +k[1],
          h: +k[2],
          l: +k[3],
          c: +k[4],
        })).filter((x) => isFinite(x.o) && isFinite(x.c));
      }
    } catch (e) {
      console.error('binance ohlc', e.message);
    }
  }

  // 2) Yahoo Finance fallback
  if (candles.length < 5) {
    try {
      const ysym = YAHOO_SYMBOL[symbol] || symbol + '-USD';
      const url =
        'https://query1.finance.yahoo.com/v8/finance/chart/' +
        encodeURIComponent(ysym) +
        '?interval=' +
        cfg.interval +
        '&range=' +
        cfg.range;
      const data = await httpGetJson(url, 15000);
      const result = data && data.chart && data.chart.result && data.chart.result[0];
      if (result) {
        const ts = result.timestamp || [];
        const q = (result.indicators && result.indicators.quote && result.indicators.quote[0]) || {};
        const opens = q.open || [], highs = q.high || [], lows = q.low || [], closes = q.close || [];
        const yCandles = [];
        for (let i = 0; i < ts.length; i++) {
          const o = opens[i], h = highs[i], l = lows[i], c = closes[i];
          if (o == null || c == null) continue;
          if (![o, h, l, c].every((x) => isFinite(+x))) continue;
          yCandles.push({ t: ts[i] * 1000, o: +o, h: +h, l: +l, c: +c });
        }
        if (yCandles.length >= 5) candles = yCandles;
      }
    } catch (e) {
      console.error('yahoo ohlc', e.message);
    }
  }

  // 3) Coinbase candles for majors
  if (candles.length < 5) {
    const CB = { BTC:'BTC-USD', ETH:'ETH-USD', SOL:'SOL-USD', LINK:'LINK-USD', LTC:'LTC-USD', DOGE:'DOGE-USD', ADA:'ADA-USD', XRP:'XRP-USD' };
    if (CB[symbol]) {
      try {
        // Coinbase granularity seconds: 300=5m, 900=15m, 3600=1h, 86400=1d
        const gran = { '1d':300,'3d':900,'1w':3600,'1m':21600,'6m':86400,'1y':86400,'all':86400 }[rangeKey] || 3600;
        const end = Math.floor(Date.now() / 1000);
        const span = { '1d':86400,'3d':3*86400,'1w':7*86400,'1m':30*86400,'6m':180*86400,'1y':365*86400,'all':730*86400 }[rangeKey] || 86400;
        const start = end - span;
        const url =
          'https://api.exchange.coinbase.com/products/' +
          CB[symbol] +
          '/candles?granularity=' +
          gran +
          '&start=' +
          new Date(start * 1000).toISOString() +
          '&end=' +
          new Date(end * 1000).toISOString();
        const data = await httpGetJson(url, 12000);
        if (Array.isArray(data)) {
          // Coinbase returns [time, low, high, open, close, volume] newest first
          candles = data
            .map((k) => ({ t: k[0] * 1000, o: +k[3], h: +k[2], l: +k[1], c: +k[4] }))
            .filter((x) => isFinite(x.o) && isFinite(x.c))
            .sort((a, b) => a.t - b.t);
        }
      } catch (e) {
        console.error('coinbase ohlc', e.message);
      }
    }
  }

  // 4) Synthetic fallback from last known live price so chart never blank
  if (candles.length < 5) {
    let base = null;
    try {
      const live = await fetchLivePrices();
      if (live && live[symbol]) base = +live[symbol];
    } catch (e) {}
    if (!base || !isFinite(base)) base = 100;
    const count = { '1d':48,'3d':72,'1w':84,'1m':60,'6m':90,'1y':120,'all':150 }[rangeKey] || 60;
    const stepMs = {
      '1d':30*60*1000,'3d':60*60*1000,'1w':2*3600*1000,'1m':12*3600*1000,
      '6m':2*86400000,'1y':3*86400000,'all':7*86400000
    }[rangeKey] || 3600000;
    const vol = 0.004;
    let p = base * (1 - vol * count * 0.15);
    candles = [];
    const t0 = Date.now() - count * stepMs;
    for (let i = 0; i < count; i++) {
      const o = p;
      const drift = (Math.random() - 0.48) * vol;
      p = Math.max(base * 0.2, p * (1 + drift));
      const h = Math.max(o, p) * (1 + Math.random() * vol * 0.5);
      const l = Math.min(o, p) * (1 - Math.random() * vol * 0.5);
      candles.push({ t: t0 + i * stepMs, o, h, l, c: p });
    }
    // pin last close near live
    candles[candles.length - 1].c = base;
    candles[candles.length - 1].h = Math.max(candles[candles.length - 1].h, base);
    candles[candles.length - 1].l = Math.min(candles[candles.length - 1].l, base);
  }

  if (rangeKey === '3d' && candles.length) {
    const cut = Date.now() - 3 * 86400000;
    const f = candles.filter((x) => x.t >= cut);
    if (f.length > 5) candles = f;
  }

  const payload = { symbol, range: rangeKey, interval: cfg.interval, candles, count: candles.length };
  ohlcCache[key] = { at: now, data: payload };
  return payload;
}

async function fetchLivePrices() {
  const now = Date.now();
  if (now - priceCache.at < 15000 && Object.keys(priceCache.data).length) {
    return priceCache.data;
  }
  const out = {};

  // Crypto – CoinCap (primary), CoinGecko + Coinbase fallbacks
  try {
    const data = await httpGetJson('https://api.coincap.io/v2/assets?limit=100', 12000);
    const list = (data && data.data) || [];
    const byId = {};
    list.forEach((a) => { byId[a.id] = a; byId[String(a.symbol || '').toUpperCase()] = a; });
    for (const [sym, id] of Object.entries(CRYPTO_IDS)) {
      const a = byId[id] || byId[sym];
      if (a && a.priceUsd != null) out[sym] = +a.priceUsd;
    }
  } catch (e) {
    console.error('coincap', e.message);
  }
  if (Object.keys(out).filter((k) => CRYPTO_IDS[k]).length < 5) {
    try {
      const ids = Object.values(CRYPTO_IDS).join(',');
      const url = 'https://api.coingecko.com/api/v3/simple/price?ids=' + encodeURIComponent(ids) + '&vs_currencies=usd';
      const data = await httpGetJson(url, 12000);
      for (const [sym, id] of Object.entries(CRYPTO_IDS)) {
        if (data[id] && data[id].usd != null) out[sym] = +data[id].usd;
      }
    } catch (e) {
      console.error('coingecko', e.message);
    }
  }
  // Coinbase spot for majors if still thin
  const cbMap = { BTC: 'BTC-USD', ETH: 'ETH-USD', SOL: 'SOL-USD', LINK: 'LINK-USD', DOGE: 'DOGE-USD', ADA: 'ADA-USD', XRP: 'XRP-USD', LTC: 'LTC-USD', BCH: 'BCH-USD', AVAX: 'AVAX-USD', DOT: 'DOT-USD', UNI: 'UNI-USD', ATOM: 'ATOM-USD', NEAR: 'NEAR-USD', FIL: 'FIL-USD', ICP: 'ICP-USD', XLM: 'XLM-USD' };
  const missing = Object.keys(cbMap).filter((s) => out[s] == null);
  await Promise.all(
    missing.slice(0, 12).map(async (sym) => {
      try {
        const data = await httpGetJson('https://api.coinbase.com/v2/prices/' + cbMap[sym] + '/spot', 8000);
        const p = data && data.data && data.data.amount;
        if (p != null) out[sym] = +p;
      } catch (e) {}
    })
  );

  // Stocks – Yahoo Finance chart (last close / regular market price)
  await Promise.all(
    STOCK_SYMBOLS.map(async (sym) => {
      try {
        const url =
          'https://query1.finance.yahoo.com/v8/finance/chart/' +
          encodeURIComponent(sym) +
          '?interval=1m&range=1d';
        const data = await httpGetJson(url, 10000);
        const meta = data && data.chart && data.chart.result && data.chart.result[0] && data.chart.result[0].meta;
        if (meta) {
          const p = meta.regularMarketPrice || meta.previousClose;
          if (p != null && isFinite(+p)) out[sym] = +p;
        }
      } catch (e) {
        /* skip symbol */
      }
    })
  );

  // Metals – Yahoo Finance futures / spot proxies
  await Promise.all(
    Object.entries(METAL_YAHOO).map(async ([sym, ysym]) => {
      try {
        const url =
          'https://query1.finance.yahoo.com/v8/finance/chart/' +
          encodeURIComponent(ysym) +
          '?interval=1m&range=1d';
        const data = await httpGetJson(url, 10000);
        const meta = data && data.chart && data.chart.result && data.chart.result[0] && data.chart.result[0].meta;
        if (meta) {
          const p = meta.regularMarketPrice || meta.previousClose;
          if (p != null && isFinite(+p) && +p > 0) out[sym] = +p;
        }
      } catch (e) {
        /* skip */
      }
    })
  );
  // Fallback: gold/silver via other Yahoo symbols if futures failed
  if (out.XAU == null) {
    try {
      const data = await httpGetJson('https://query1.finance.yahoo.com/v8/finance/chart/XAUUSD=X?interval=1m&range=1d', 8000);
      const meta = data && data.chart && data.chart.result && data.chart.result[0] && data.chart.result[0].meta;
      const p = meta && (meta.regularMarketPrice || meta.previousClose);
      if (p) out.XAU = +p;
    } catch (e) {}
  }
  if (out.XAG == null) {
    try {
      const data = await httpGetJson('https://query1.finance.yahoo.com/v8/finance/chart/XAGUSD=X?interval=1m&range=1d', 8000);
      const meta = data && data.chart && data.chart.result && data.chart.result[0] && data.chart.result[0].meta;
      const p = meta && (meta.regularMarketPrice || meta.previousClose);
      if (p) out.XAG = +p;
    } catch (e) {}
  }
  // ETF / alternative proxies for industrial metals when futures missing
  const metalFallback = { HG: 'CPER', ALI: 'JJU', ZNC: 'ZINC', NI: 'JJN', SN: 'JJT', PB: 'LIT' };
  await Promise.all(
    Object.entries(metalFallback).map(async ([sym, ysym]) => {
      if (out[sym] != null) return;
      try {
        const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(ysym) + '?interval=1d&range=5d';
        const data = await httpGetJson(url, 8000);
        const meta = data && data.chart && data.chart.result && data.chart.result[0] && data.chart.result[0].meta;
        const p = meta && (meta.regularMarketPrice || meta.previousClose);
        if (p != null && isFinite(+p) && +p > 0) out[sym] = +p;
      } catch (e) {}
    })
  );

  
  // Energy commodities – Yahoo Finance futures
  await Promise.all(
    Object.entries(COMMODITY_YAHOO).map(async ([sym, ysym]) => {
      try {
        const url =
          'https://query1.finance.yahoo.com/v8/finance/chart/' +
          encodeURIComponent(ysym) +
          '?interval=1m&range=1d';
        const data = await httpGetJson(url, 10000);
        const meta = data && data.chart && data.chart.result && data.chart.result[0] && data.chart.result[0].meta;
        if (meta) {
          const p = meta.regularMarketPrice || meta.previousClose;
          if (p != null && isFinite(+p) && +p > 0) out[sym] = +p;
        }
      } catch (e) {}
    })
  );
  // Spot-style fallbacks
  if (out.WTI == null) {
    try {
      const data = await httpGetJson('https://query1.finance.yahoo.com/v8/finance/chart/CL=F?interval=1d&range=5d', 8000);
      const meta = data && data.chart && data.chart.result && data.chart.result[0] && data.chart.result[0].meta;
      const p = meta && (meta.regularMarketPrice || meta.previousClose);
      if (p) out.WTI = +p;
    } catch (e) {}
  }
  if (out.NG == null) {
    try {
      const data = await httpGetJson('https://query1.finance.yahoo.com/v8/finance/chart/NG=F?interval=1d&range=5d', 8000);
      const meta = data && data.chart && data.chart.result && data.chart.result[0] && data.chart.result[0].meta;
      const p = meta && (meta.regularMarketPrice || meta.previousClose);
      if (p) out.NG = +p;
    } catch (e) {}
  }

  if (Object.keys(out).length) {
    priceCache = { at: now, data: out };
  }
  return Object.keys(out).length ? out : priceCache.data;
}

async function handleApi(req, res, pathname) {
  const method = req.method;
  let body = {};
  if (method !== 'GET' && method !== 'OPTIONS' && method !== 'HEAD') {
    try { body = await readBody(req); } catch (e) { return send(res, 400, { error: e.message }); }
  }

  if (pathname === '/api/health' && method === 'GET')
    return send(res, 200, { ok: true, service: 'letty-trading-backend', time: Date.now() });

  if (pathname === '/api/admin/login' && method === 'POST') {
    const email = String(body.email || body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    const s = store.get();
    const accounts = s.adminAccounts || [{ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }];
    const ok = accounts.some((a) => (a.email || '').toLowerCase() === email && a.password === password)
      || (password === ADMIN_PASSWORD && (!email || email === ADMIN_EMAIL || email === 'admin'));
    if (!ok) return send(res, 401, { error: 'Invalid email or password' });
    const token = makeToken();
    tokens.set(token, { exp: Date.now() + 12 * 3600 * 1000, email: email || ADMIN_EMAIL });
    store.addAudit('admin', 'Admin logged in: ' + (email || ADMIN_EMAIL));
    return send(res, 200, { token, expiresIn: 12 * 3600, email: email || ADMIN_EMAIL });
  }
  if (pathname === '/api/admin/logout' && method === 'POST') {
    const t = getToken(req, body); if (t) tokens.delete(t);
    return send(res, 200, { ok: true });
  }

  if (pathname.startsWith('/api/admin/') && pathname !== '/api/admin/login') {
    if (!requireAdmin(req, body)) return send(res, 401, { error: 'Unauthorized' });
  }

  // Overview
  if (pathname === '/api/admin/overview' && method === 'GET') {
    const s = store.get();
    const pendingReqs = s.requests.filter((r) => r.status === 'review').length;
    const pendingKyc = s.kycSubmissions.filter((k) => k.status === 'pending').length + s.users.filter((u) => u.kyc === 'Pending').length;
    const feeRate = (s.config.fee || 0.1) / 100;
    const vol = 48.2e6 + Math.sin(Date.now() / 6e4) * 8e5;
    const custody = s.users.reduce((a, u) => a + (u.balanceUsdt || 0), 0);
    return send(res, 200, {
      cards: [
        { label: '24h volume', value: Math.round(vol).toLocaleString() + ' USDT' },
        { label: 'Registered users', value: String(12480 + s.users.length) },
        { label: 'Active (24h)', value: '3,912' },
        { label: 'Fees earned (24h)', value: Math.round(vol * feeRate).toLocaleString() + ' USDT' },
        { label: 'Assets under custody', value: Math.round(18.6e6 + custody).toLocaleString() + ' USDT' },
        { label: 'Pending reviews', value: String(pendingReqs + pendingKyc) },
      ],
      welcomeBonus: s.welcomeBonus,
      adminNotifications: s.adminNotifications.slice(0, 40),
      pendingRequests: pendingReqs, pendingKyc,
    });
  }
  if (pathname === '/api/admin/notifications/read-all' && method === 'POST') {
    store.mutate((s) => s.adminNotifications.forEach((n) => (n.read = true)));
    return send(res, 200, { ok: true });
  }

  // Welcome bonus
  if (pathname === '/api/admin/welcome-bonus/approve' && method === 'POST') {
    const s = store.get();
    if (!s.welcomeBonus || s.welcomeBonus.status !== 'pending') return send(res, 400, { error: 'No pending welcome bonus' });
    const userId = s.welcomeBonus.userId || 'U-0001';
    const amount = s.welcomeBonus.amount || 100;
    store.mutate((st) => {
      st.welcomeBonus.status = 'approved';
      const u = st.users.find((x) => x.id === userId);
      if (u) { u.balanceUsdt = (u.balanceUsdt || 0) + amount; u.balances = u.balances || {}; u.balances.USDT = (u.balances.USDT || 0) + amount; }
    });
    store.addUserNotif(userId, 'Welcome bonus approved', `You received ${amount} USDT welcome bonus`);
    store.addAudit('admin', `Approved welcome bonus ${amount} USDT for ${userId}`);
    return send(res, 200, { ok: true, credited: amount, userId });
  }
  if (pathname === '/api/admin/welcome-bonus/reject' && method === 'POST') {
    const s = store.get();
    if (!s.welcomeBonus || s.welcomeBonus.status !== 'pending') return send(res, 400, { error: 'No pending welcome bonus' });
    const userId = s.welcomeBonus.userId || 'U-0001';
    store.mutate((st) => { st.welcomeBonus.status = 'rejected'; });
    store.addUserNotif(userId, 'Welcome bonus rejected', 'Your welcome bonus request was declined');
    store.addAudit('admin', `Rejected welcome bonus for ${userId}`);
    return send(res, 200, { ok: true });
  }

  // Requests list
  if (pathname === '/api/admin/requests' && method === 'GET') {
    const s = store.get();
    const u = new URL(req.url, 'http://localhost');
    const list = s.requests.filter((r) => r.status === 'review' || u.searchParams.get('all') === '1')
      .map((r) => ({ ...r, risk: store.riskScore(r, s) }))
      .sort((a, b) => b.risk.score - a.risk.score);
    return send(res, 200, { requests: list });
  }
  const reqMatch = pathname.match(/^\/api\/admin\/requests\/([^/]+)(?:\/(approve|reject|request-info))?$/);
  if (reqMatch) {
    const id = decodeURIComponent(reqMatch[1]);
    const action = reqMatch[2];
    if (!action && method === 'GET') {
      const s = store.get();
      const r = s.requests.find((x) => String(x.id) === String(id));
      if (!r) return send(res, 404, { error: 'Not found' });
      return send(res, 200, { request: r, risk: store.riskScore(r, s), user: s.users.find((u) => u.id === r.userId) || null });
    }
    if (action === 'approve' && method === 'POST') {
      const result = applyDecision(id, true, body.reviewer, body.note);
      return send(res, result.error ? result.status || 400 : 200, result);
    }
    if (action === 'reject' && method === 'POST') {
      const result = applyDecision(id, false, body.reviewer, body.note, body.reason);
      return send(res, result.error ? result.status || 400 : 200, result);
    }
    if (action === 'request-info' && method === 'POST') {
      const s = store.get();
      const r = s.requests.find((x) => String(x.id) === String(id));
      if (!r) return send(res, 404, { error: 'Not found' });
      store.mutate((st) => { st.requests.find((y) => y.id === r.id).infoRequested = true; });
      store.addAudit(body.reviewer || 'admin', `Requested more info on ${r.id}`);
      store.addUserNotif(r.userId, 'More information required', `Regarding your ${r.type} of ${r.amount} ${r.asset}`);
      return send(res, 200, { ok: true });
    }
  }

  if (pathname === '/api/admin/addresses/allow' && method === 'POST') {
    if (!body.addr) return send(res, 400, { error: 'addr required' });
    store.mutate((s) => {
      s.config.blacklist = (s.config.blacklist || []).filter((x) => x !== body.addr);
      s.config.allowlist = s.config.allowlist || [];
      if (!s.config.allowlist.includes(body.addr)) s.config.allowlist.push(body.addr);
    });
    store.addAudit('admin', `Allowed address ${body.addr.slice(0, 12)}…`);
    return send(res, 200, { ok: true });
  }
  if (pathname === '/api/admin/addresses/block' && method === 'POST') {
    if (!body.addr) return send(res, 400, { error: 'addr required' });
    store.mutate((s) => {
      s.config.allowlist = (s.config.allowlist || []).filter((x) => x !== body.addr);
      s.config.blacklist = s.config.blacklist || [];
      if (!s.config.blacklist.includes(body.addr)) s.config.blacklist.push(body.addr);
    });
    store.addAudit('admin', `Blocked address ${body.addr.slice(0, 12)}…`);
    return send(res, 200, { ok: true });
  }

  // Users
  if (pathname === '/api/admin/users' && method === 'GET') {
    const s = store.get();
    return send(res, 200, { users: s.users.map((u) => ({ id: u.id, name: u.name, email: u.email, kyc: u.kyc, tier: u.tier, country: u.country, balanceUsdt: u.balanceUsdt, balances: u.balances || {} })) });
  }
  const userMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)(?:\/(balance|kyc))?$/);
  if (userMatch) {
    const uid = decodeURIComponent(userMatch[1]);
    const sub = userMatch[2];
    const s = store.get();
    const u = s.users.find((x) => x.id === uid);
    if (!u) return send(res, 404, { error: 'Not found' });
    if (!sub && method === 'GET') return send(res, 200, { user: u });
    if (sub === 'balance' && method === 'PATCH') {
      if (!body.asset || body.amount == null || !isFinite(+body.amount) || +body.amount < 0)
        return send(res, 400, { error: 'Valid asset and non-negative amount required' });
      store.mutate((st) => {
        const usr = st.users.find((x) => x.id === uid);
        usr.balances = usr.balances || {};
        usr.balances[body.asset] = +body.amount;
        if (body.asset === 'USDT') usr.balanceUsdt = +body.amount;
      });
      store.addAudit('admin', `Set ${uid} ${body.asset} balance to ${body.amount}`);
      return send(res, 200, { ok: true });
    }
    if (sub === 'kyc' && method === 'PATCH') {
      if (!['Verified', 'Rejected', 'Pending', 'Unverified'].includes(body.status))
        return send(res, 400, { error: 'Invalid status' });
      store.mutate((st) => { st.users.find((x) => x.id === uid).kyc = body.status; });
      store.addAudit('admin', `KYC ${body.status.toLowerCase()} for ${uid}`);
      store.addUserNotif(uid, body.status === 'Verified' ? 'KYC approved' : 'KYC declined', body.status === 'Verified' ? 'Your identity is verified.' : 'Please check your KYC status.');
      return send(res, 200, { ok: true });
    }
  }

  // KYC queue
  if (pathname === '/api/admin/kyc' && method === 'GET') {
    const s = store.get();
    const queue = [
      ...s.kycSubmissions.filter((k) => k.status === 'pending'),
      ...s.users.filter((u) => u.kyc === 'Pending' && !s.kycSubmissions.some((k) => k.userId === u.id && k.status === 'pending'))
        .map((u) => ({ id: 'KYC-' + u.id, userId: u.id, name: u.name, country: u.country, documentType: '(demo)', status: 'pending', submittedAt: null, idImage: null, selfieImage: null })),
    ];
    return send(res, 200, { submissions: queue });
  }
  const kycMatch = pathname.match(/^\/api\/admin\/kyc\/([^/]+)(?:\/(approve|reject))?$/);
  if (kycMatch) {
    const kid = decodeURIComponent(kycMatch[1]);
    const action = kycMatch[2];
    const s = store.get();
    if (!action && method === 'GET') {
      let sub = s.kycSubmissions.find((k) => k.id === kid || k.userId === kid);
      if (!sub) {
        const u = s.users.find((x) => x.id === kid);
        if (u) sub = { id: 'KYC-' + u.id, userId: u.id, name: u.name, country: u.country, documentType: '(demo)', status: u.kyc === 'Pending' ? 'pending' : String(u.kyc).toLowerCase(), submittedAt: null, idImage: null, selfieImage: null };
      }
      if (!sub) return send(res, 404, { error: 'Not found' });
      return send(res, 200, { submission: sub });
    }
    let userId = kid;
    const sub = s.kycSubmissions.find((k) => k.id === kid || k.userId === kid);
    if (sub) userId = sub.userId;
    if (action === 'approve' && method === 'POST') {
      store.mutate((st) => {
        const u = st.users.find((x) => x.id === userId); if (u) u.kyc = 'Verified';
        const k = st.kycSubmissions.find((x) => x.id === kid || x.userId === userId);
        if (k) { k.status = 'verified'; k.reviewNote = body.note || ''; }
      });
      store.addAudit('admin', `KYC approved for ${userId}`);
      store.addUserNotif(userId, 'KYC approved', 'Your identity is verified. Withdrawals are enabled.');
      return send(res, 200, { ok: true });
    }
    if (action === 'reject' && method === 'POST') {
      store.mutate((st) => {
        const u = st.users.find((x) => x.id === userId); if (u) u.kyc = 'Rejected';
        const k = st.kycSubmissions.find((x) => x.id === kid || x.userId === userId);
        if (k) { k.status = 'rejected'; k.reviewNote = body.note || ''; k.rejectReason = body.reason || 'Other'; }
      });
      store.addAudit('admin', `KYC declined for ${userId}`);
      store.addUserNotif(userId, 'KYC declined', body.reason || 'Please resubmit your documents.');
      return send(res, 200, { ok: true });
    }
  }

  // Contracts
  if (pathname === '/api/admin/contracts/plans' && method === 'GET')
    return send(res, 200, { plans: store.get().config.contractPlans });
  if (pathname === '/api/admin/contracts/plans' && method === 'PUT') {
    store.mutate((st) => {
      for (const [id, rate] of Object.entries(body.rates || {})) {
        const v = +rate; if (!isFinite(v) || v < 0 || v > 100) continue;
        if (st.config.contractPlans[id]) st.config.contractPlans[id].rate = v;
      }
    });
    store.addAudit('admin', 'Updated all contract plan interest rates');
    return send(res, 200, { ok: true, plans: store.get().config.contractPlans });
  }
  const planMatch = pathname.match(/^\/api\/admin\/contracts\/plans\/([^/]+)$/);
  if (planMatch && method === 'PUT') {
    const id = decodeURIComponent(planMatch[1]);
    const v = +body.rate;
    if (!isFinite(v) || v < 0 || v > 100) return send(res, 400, { error: 'Rate must be 0–100' });
    const s = store.get();
    if (!s.config.contractPlans[id]) return send(res, 404, { error: 'Unknown plan' });
    store.mutate((st) => { st.config.contractPlans[id].rate = v; });
    store.addAudit('admin', `Updated ${s.config.contractPlans[id].name || id} rate to ${v}%`);
    return send(res, 200, { ok: true, plan: store.get().config.contractPlans[id] });
  }

  // Wallets
  if (pathname === '/api/admin/wallets' && method === 'GET') {
    const s = store.get();
    return send(res, 200, { depositAddresses: s.config.depositAddresses, usdtNetworkAddresses: s.config.usdtNetworkAddresses });
  }
  const depMatch = pathname.match(/^\/api\/admin\/wallets\/deposit\/([^/]+)$/);
  if (depMatch && method === 'PUT') {
    const asset = decodeURIComponent(depMatch[1]).toUpperCase();
    if (!body.address) return send(res, 400, { error: 'address required' });
    if (/[<>]/.test(body.address)) return send(res, 400, { error: 'Address contains unsupported characters' });
    store.mutate((s) => { s.config.depositAddresses[asset] = body.address.trim(); });
    store.addAudit('admin', `Updated deposit wallet for ${asset}`);
    return send(res, 200, { ok: true });
  }
  const usdtMatch = pathname.match(/^\/api\/admin\/wallets\/usdt\/([^/]+)$/);
  if (usdtMatch && method === 'PUT') {
    const network = decodeURIComponent(usdtMatch[1]).toUpperCase();
    if (!['ERC20', 'TRC20', 'BEP20'].includes(network)) return send(res, 400, { error: 'Invalid network' });
    if (!body.address) return send(res, 400, { error: 'address required' });
    store.mutate((s) => {
      s.config.usdtNetworkAddresses[network] = body.address.trim();
      if (network === 'ERC20' && !s.config.depositAddresses.USDT) s.config.depositAddresses.USDT = body.address.trim();
    });
    store.addAudit('admin', `Updated USDT ${network} address`);
    return send(res, 200, { ok: true });
  }

  // Trading
  if (pathname === '/api/admin/trading' && method === 'GET') {
    const s = store.get();
    return send(res, 200, { fee: s.config.fee, maxLeverage: s.config.maxLeverage, reviewThreshold: s.config.reviewThreshold, dualApproval: s.config.dualApproval, mode: s.config.mode, halt: s.config.halt });
  }
  if (pathname === '/api/admin/trading' && method === 'PUT') {
    store.mutate((s) => {
      if (body.fee != null) s.config.fee = Math.max(0, +body.fee);
      if (body.maxLeverage != null) s.config.maxLeverage = +body.maxLeverage;
      if (body.reviewThreshold != null) s.config.reviewThreshold = Math.max(0, +body.reviewThreshold);
      if (body.dualApproval != null) s.config.dualApproval = Math.max(s.config.reviewThreshold, +body.dualApproval);
      if (body.mode && ['normal', 'win', 'lose'].includes(body.mode)) s.config.mode = body.mode;
    });
    const c = store.get().config;
    store.addAudit('admin', `Settings: fee ${c.fee}%, maxlev ${c.maxLeverage}x, mode ${c.mode}`);
    return send(res, 200, { ok: true, config: c });
  }
  if (pathname === '/api/admin/trading/halt' && method === 'POST') {
    if (!body.market) return send(res, 400, { error: 'market required' });
    let halted;
    store.mutate((s) => { s.config.halt = s.config.halt || {}; s.config.halt[body.market] = !s.config.halt[body.market]; halted = s.config.halt[body.market]; });
    store.addAudit('admin', (halted ? 'Halted ' : 'Resumed ') + body.market);
    return send(res, 200, { ok: true, market: body.market, halted });
  }

  // Support
  if (pathname === '/api/admin/support/threads' && method === 'GET') {
    const threads = {};
    (store.get().chat || []).forEach((m) => { const k = m.userId || 'U-0001'; (threads[k] = threads[k] || []).push(m); });
    const list = Object.keys(threads).map((id) => {
      const ms = threads[id]; const last = ms[ms.length - 1];
      return { userId: id, count: ms.length, lastAt: last.t, preview: (last.text || '').slice(0, 60) };
    });
    return send(res, 200, { threads: list });
  }
  const chatMatch = pathname.match(/^\/api\/admin\/support\/([^/]+)$/);
  if (chatMatch) {
    const userId = decodeURIComponent(chatMatch[1]);
    if (method === 'GET') {
      return send(res, 200, { messages: (store.get().chat || []).filter((m) => (m.userId || 'U-0001') === userId) });
    }
    if (method === 'POST') {
      if (!body.text && !body.file) return send(res, 400, { error: 'text or file required' });
      const msg = { id: 'M-' + Date.now(), t: Date.now(), from: 'admin', userId, text: body.text || '', file: body.file || null };
      store.mutate((s) => s.chat.push(msg));
      store.addUserNotif(userId, 'Support reply', (body.text || 'Attachment').slice(0, 80));
      return send(res, 200, { ok: true, message: msg });
    }
  }

  if (pathname === '/api/admin/audit' && method === 'GET')
    return send(res, 200, { log: store.get().auditLog.slice(0, 100) });

  // Public
  if (pathname === '/api/public/config' && method === 'GET') {
    const s = store.get();
    return send(res, 200, { fee: s.config.fee, maxLeverage: s.config.maxLeverage, mode: s.config.mode, halt: s.config.halt, depositAddresses: s.config.depositAddresses, usdtNetworkAddresses: s.config.usdtNetworkAddresses, contractPlans: s.config.contractPlans });
  }
  if (pathname === '/api/public/deposit' && method === 'POST') {
    if (!body.asset || !(+body.amount > 0) || +body.amount > 1e6) return send(res, 400, { error: 'Invalid amount' });
    const id = 'D-' + Date.now();
    const row = { id, type: 'deposit', userId: body.userId || 'U-0001', asset: body.asset, amount: +body.amount, network: body.network || '', addr: body.addr || '', status: 'review', approvals: [], createdAt: Date.now(), infoRequested: false };
    store.mutate((s) => s.requests.unshift(row));
    store.addAdminNotif('Deposit request', `${body.amount} ${body.asset} from ${row.userId}`);
    store.addAudit(row.userId, `Deposit requested: ${body.amount} ${body.asset}`);
    return send(res, 200, { ok: true, id, status: 'review' });
  }
  if (pathname === '/api/public/withdraw' && method === 'POST') {
    if (!body.addr) return send(res, 400, { error: 'Destination address required' });
    if (!(+body.amount > 0)) return send(res, 400, { error: 'Invalid amount' });
    const s = store.get();
    if ((s.config.blacklist || []).includes(body.addr)) return send(res, 400, { error: 'Address blocked' });
    const user = s.users.find((u) => u.id === (body.userId || 'U-0001'));
    if (user && user.kyc !== 'Verified') return send(res, 403, { error: 'Complete KYC first' });
    const id = 'W-' + Date.now();
    const row = { id, type: 'withdraw', userId: body.userId || 'U-0001', asset: body.asset, amount: +body.amount, network: body.network || '', addr: body.addr, status: 'review', approvals: [], createdAt: Date.now(), infoRequested: false };
    store.mutate((st) => st.requests.unshift(row));
    store.addAdminNotif('Withdrawal request', `${body.amount} ${body.asset} from ${row.userId}`);
    store.addAudit(row.userId, `Withdrawal requested: ${body.amount} ${body.asset}`);
    return send(res, 200, { ok: true, id, status: 'review' });
  }
  if (pathname === '/api/public/kyc' && method === 'POST') {
    if (!body.name || !body.country) return send(res, 400, { error: 'Name and country required' });
    if (!body.phone) return send(res, 400, { error: 'Phone number required' });
    if (!body.address) return send(res, 400, { error: 'Home address required' });
    if (!body.idImage || !body.selfieImage) return send(res, 400, { error: 'Both images required' });
    const userId = body.userId || 'U-0001';
    const id = 'KYC-' + userId + '-' + Date.now();
    store.mutate((s) => {
      s.kycSubmissions.unshift({ id, userId, name: body.name, country: body.country, phone: body.phone || '', address: body.address || '', documentType: body.documentType || 'Passport', status: 'pending', submittedAt: Date.now(), idImage: body.idImage, selfieImage: body.selfieImage });
      const u = s.users.find((x) => x.id === userId); if (u) u.kyc = 'Pending';
    });
    store.addAdminNotif('KYC submission', `${body.name} (${userId})`);
    store.addAudit(userId, 'KYC submitted');
    return send(res, 200, { ok: true, id, status: 'pending' });
  }
  if (pathname === '/api/public/welcome-bonus' && method === 'POST') {
    const userId = body.userId || 'U-0001';
    const s = store.get();
    if (s.welcomeBonus.status === 'pending') return send(res, 400, { error: 'Bonus already pending' });
    if (s.welcomeBonus.status === 'approved' && s.welcomeBonus.userId === userId) return send(res, 400, { error: 'Bonus already received' });
    store.mutate((st) => { st.welcomeBonus = { status: 'pending', userId, amount: 100, requestedAt: Date.now() }; });
    store.addAdminNotif('Welcome bonus request', `${userId} requested 100 USDT`);
    store.addAudit(userId, 'Welcome bonus claimed');
    return send(res, 200, { ok: true, status: 'pending' });
  }
  if (pathname === '/api/public/chat' && method === 'POST') {
    const userId = body.userId || 'U-0001';
    if (!body.text && !body.file) return send(res, 400, { error: 'text or file required' });
    const msg = { id: 'M-' + Date.now(), t: Date.now(), from: 'user', userId, text: body.text || '', file: body.file || null };
    store.mutate((s) => s.chat.push(msg));
    store.addAdminNotif('Customer message', (body.text || 'Attachment').slice(0, 80));
    return send(res, 200, { ok: true, message: msg });
  }
  const pubChat = pathname.match(/^\/api\/public\/chat\/([^/]+)$/);
  if (pubChat && method === 'GET')
    return send(res, 200, { messages: (store.get().chat || []).filter((m) => (m.userId || 'U-0001') === pubChat[1]) });
  const pubUser = pathname.match(/^\/api\/public\/user\/([^/]+)$/);
  if (pubUser && method === 'GET') {
    const u = store.get().users.find((x) => x.id === pubUser[1]);
    if (!u) return send(res, 404, { error: 'Not found' });
    return send(res, 200, { id: u.id, name: u.name, email: u.email, kyc: u.kyc, balanceUsdt: u.balanceUsdt, balances: u.balances });
  }
  const pubNotif = pathname.match(/^\/api\/public\/notifications\/([^/]+)$/);
  if (pubNotif && method === 'GET')
    return send(res, 200, { notifications: store.get().userNotifications[pubNotif[1]] || [] });
  const pubWb = pathname.match(/^\/api\/public\/welcome-bonus\/([^/]+)$/);
  if (pubWb && method === 'GET') {
    const wb = store.get().welcomeBonus;
    return send(res, 200, { status: wb.status || 'none', amount: wb.amount || 100, requestedAt: wb.requestedAt });
  }
  const pubKyc = pathname.match(/^\/api\/public\/kyc\/([^/]+)$/);
  if (pubKyc && method === 'GET') {
    const s = store.get();
    const u = s.users.find((x) => x.id === pubKyc[1]);
    const sub = s.kycSubmissions.find((k) => k.userId === pubKyc[1]);
    return send(res, 200, { status: u ? u.kyc : 'Unverified', submission: sub ? { id: sub.id, status: sub.status, submittedAt: sub.submittedAt, rejectReason: sub.rejectReason } : null });
  }




  // User's deposit/withdraw request statuses (for live frontend sync)
  if (pathname.match(/^\/api\/public\/requests\/[^/]+$/) && method === 'GET') {
    const userId = decodeURIComponent(pathname.split('/').pop());
    const s = store.get();
    const list = (s.requests || [])
      .filter((r) => r.userId === userId)
      .slice(0, 40)
      .map((r) => ({
        id: r.id,
        type: r.type,
        asset: r.asset,
        amount: r.amount,
        status: r.status,
        network: r.network || '',
        createdAt: r.createdAt,
        infoRequested: !!r.infoRequested,
      }));
    return send(res, 200, { requests: list });
  }



  // ---- Loans ----
  if (pathname === '/api/public/loan' && method === 'POST') {
    const userId = body.userId || 'U-4738165';
    const amount = +body.amount;
    const creditScore = String(body.creditScore || '').trim();
    const address = String(body.address || '').trim();
    if (!(amount > 0)) return send(res, 400, { error: 'Invalid amount' });
    if (!creditScore) return send(res, 400, { error: 'Credit score required' });
    if (!address) return send(res, 400, { error: 'House address required' });
    if (!body.termsAccepted) return send(res, 400, { error: 'Terms must be accepted' });
    const id = 'LN-' + Date.now();
    const loan = {
      id,
      userId,
      amount,
      creditScore,
      address,
      apr: 31,
      card: body.card || null,
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    store.mutate((s) => {
      s.loans = s.loans || [];
      // one pending at a time per user
      const existing = s.loans.find((l) => l.userId === userId && l.status === 'pending');
      if (existing) {
        Object.assign(existing, loan, { id: existing.id });
      } else {
        s.loans.unshift(loan);
      }
    });
    store.addAdminNotif('Loan request', userId + ' requested ' + amount + ' USDT loan');
    store.addAudit(userId, 'Loan requested: ' + amount + ' USDT');
    return send(res, 200, { ok: true, id, status: 'pending' });
  }
  const pubLoan = pathname.match(/^\/api\/public\/loan\/([^/]+)$/);
  if (pubLoan && method === 'GET') {
    const userId = decodeURIComponent(pubLoan[1]);
    const s = store.get();
    const loan = (s.loans || []).find((l) => l.userId === userId && (l.status === 'pending' || l.status === 'approved' || l.status === 'rejected'));
    // prefer latest
    const list = (s.loans || []).filter((l) => l.userId === userId).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return send(res, 200, { loan: list[0] || null, loans: list.slice(0, 10) });
  }

  if (pathname === '/api/admin/loans' && method === 'GET') {
    const s = store.get();
    return send(res, 200, { loans: (s.loans || []).slice(0, 100) });
  }
  const adminLoan = pathname.match(/^\/api\/admin\/loans\/([^/]+)\/(approve|reject)$/);
  if (adminLoan && method === 'POST') {
    const id = decodeURIComponent(adminLoan[1]);
    const action = adminLoan[2];
    const s = store.get();
    const loan = (s.loans || []).find((l) => l.id === id);
    if (!loan) return send(res, 404, { error: 'Not found' });
    if (loan.status !== 'pending') return send(res, 400, { error: 'Already processed' });
    if (action === 'approve') {
      store.mutate((st) => {
        const L = st.loans.find((x) => x.id === id);
        L.status = 'approved';
        L.updatedAt = Date.now();
        const u = st.users.find((x) => x.id === L.userId);
        if (u) {
          u.balances = u.balances || { USDT: 0 };
          u.balances.USDT = (u.balances.USDT || 0) + (+L.amount || 0);
          u.balanceUsdt = u.balances.USDT;
        }
      });
      store.addUserNotif(loan.userId, 'Loan approved', loan.amount + ' USDT has been credited to your account.');
      store.addAudit('admin', 'Loan approved ' + id + ' for ' + loan.userId + ' amount ' + loan.amount);
      store.addAdminNotif('Loan approved', id + ' · ' + loan.amount + ' USDT');
      return send(res, 200, { ok: true, status: 'approved' });
    }
    store.mutate((st) => {
      const L = st.loans.find((x) => x.id === id);
      L.status = 'rejected';
      L.updatedAt = Date.now();
      L.rejectReason = body.reason || '';
    });
    store.addUserNotif(loan.userId, 'Loan declined', 'Your loan request was not approved.');
    store.addAudit('admin', 'Loan rejected ' + id);
    return send(res, 200, { ok: true, status: 'rejected' });
  }


  // ---- User auth ----
  if (pathname === '/api/public/register' && method === 'POST') {
    try {
      const user = store.registerUser({ email: body.email, password: body.password, name: body.name });
      const token = store.createSession(user.id);
      return send(res, 200, { ok: true, token, user: store.publicUser(user) });
    } catch (e) {
      return send(res, 400, { error: e.message || 'Register failed' });
    }
  }
  if (pathname === '/api/public/login' && method === 'POST') {
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const user = store.findUserByEmail(email);
    if (!user || user.password !== password) return send(res, 401, { error: 'Invalid email or password' });
    const token = store.createSession(user.id);
    store.addAudit(user.id, 'User logged in');
    return send(res, 200, { ok: true, token, user: store.publicUser(user) });
  }
  if (pathname === '/api/public/me' && method === 'GET') {
    const auth = req.headers['authorization'] || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : (body && body.token) || '';
    const user = store.userFromToken(token);
    if (!user) return send(res, 401, { error: 'Unauthorized' });
    return send(res, 200, { user: store.publicUser(user) });
  }
  if (pathname === '/api/public/logout' && method === 'POST') {
    const auth = req.headers['authorization'] || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : body.token || '';
    if (token) store.mutate((s) => { if (s.sessions) delete s.sessions[token]; });
    return send(res, 200, { ok: true });
  }

  // Password reset (user)
  if (pathname === '/api/public/password-reset/request' && method === 'POST') {
    const email = String(body.email || '').trim().toLowerCase();
    if (!email) return send(res, 400, { error: 'Email required' });
    const s = store.get();
    let user = s.users.find((u) => (u.email || '').toLowerCase() === email);
    // Always respond success-style to avoid email enumeration, but create code if user exists or demo user
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const exp = Date.now() + 30 * 60 * 1000;
    store.mutate((st) => {
      st.passwordResets = st.passwordResets || {};
      st.passwordResets[email] = { code, exp, userId: user ? user.id : 'U-0001' };
      if (!user && email) {
        // allow reset for profile email of demo app user
        st.passwordResets[email].userId = 'U-0001';
      }
    });
    store.addAudit('system', 'Password reset requested for ' + email);
    // Demo: return code so UI can work without email delivery
    return send(res, 200, { ok: true, message: 'Reset code generated', code, expiresIn: 1800 });
  }
  if (pathname === '/api/public/password-reset/confirm' && method === 'POST') {
    const email = String(body.email || '').trim().toLowerCase();
    const code = String(body.code || body.token || '').trim();
    const newPassword = String(body.newPassword || body.password || '');
    if (!email || !code) return send(res, 400, { error: 'Email and code required' });
    if (!newPassword || newPassword.length < 4) return send(res, 400, { error: 'Password too short' });
    const s = store.get();
    const entry = (s.passwordResets || {})[email];
    if (!entry || entry.code !== code) return send(res, 400, { error: 'Invalid reset code' });
    if (entry.exp < Date.now()) return send(res, 400, { error: 'Reset code expired' });
    store.mutate((st) => {
      const u = st.users.find((x) => x.id === entry.userId) || st.users.find((x) => (x.email || '').toLowerCase() === email);
      if (u) {
        u.password = newPassword;
        u.email = u.email || email;
      } else {
        // create / update placeholder
        st.users.push({
          id: entry.userId || 'U-0001',
          name: 'User',
          email,
          password: newPassword,
          kyc: 'Unverified',
          tier: 'Tier 0',
          country: 'N/A',
          balanceUsdt: 0,
          balances: { USDT: 0 },
          role: 'user',
        });
      }
      delete st.passwordResets[email];
    });
    store.addAudit('system', 'Password reset completed for ' + email);
    store.addUserNotif(entry.userId || 'U-0001', 'Password reset', 'Your password was changed successfully.');
    return send(res, 200, { ok: true, message: 'Password updated' });
  }

  // Admin: set user password
  if (pathname.match(/^\/api\/admin\/users\/[^/]+\/password$/) && method === 'POST') {
    const uid = decodeURIComponent(pathname.split('/')[4]);
    const newPassword = String(body.newPassword || body.password || '');
    if (!newPassword || newPassword.length < 4) return send(res, 400, { error: 'Password too short' });
    const s = store.get();
    const u = s.users.find((x) => x.id === uid);
    if (!u) return send(res, 404, { error: 'Not found' });
    store.mutate((st) => {
      st.users.find((x) => x.id === uid).password = newPassword;
    });
    store.addAudit('admin', 'Password reset for ' + uid);
    store.addUserNotif(uid, 'Password updated', 'An administrator reset your password.');
    return send(res, 200, { ok: true });
  }


  if (pathname === '/api/public/ohlc' && method === 'GET') {
    try {
      const u = new URL(req.url, 'http://localhost');
      const symbol = (u.searchParams.get('symbol') || 'BTC').toUpperCase();
      const range = u.searchParams.get('range') || '1d';
      if (!OHLC_RANGES[range]) return send(res, 400, { error: 'Invalid range', allowed: Object.keys(OHLC_RANGES) });
      const data = await fetchOHLC(symbol, range);
      return send(res, 200, { ok: true, ...data });
    } catch (e) {
      console.error('ohlc', e.message);
      return send(res, 502, { error: 'Failed to fetch OHLC', detail: e.message });
    }
  }

  // Live market prices (crypto via CoinGecko, stocks via Yahoo)
  if (pathname === '/api/public/prices' && method === 'GET') {
    try {
      const prices = await fetchLivePrices();
      return send(res, 200, { ok: true, prices, updatedAt: Date.now() });
    } catch (e) {
      console.error('price fetch', e.message);
      return send(res, 502, { error: 'Failed to fetch live prices', detail: e.message });
    }
  }
  return send(res, 404, { error: 'Not found' });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, '');
  try {
    const u = new URL(req.url, 'http://localhost');
    const pathname = u.pathname;
    if (pathname === '/admin' || pathname === '/admin/' || pathname.startsWith('/admin/'))
      return serveStatic(req, res, pathname === '/admin' ? '/admin/' : pathname);
    if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname);
    // User trading frontend
    if (pathname === '/kraken-logo.png' || pathname.endsWith('.png') || pathname.endsWith('.svg') || pathname.endsWith('.ico') || pathname.endsWith('.css') || pathname.endsWith('.js')) {
      const file = path.join(FRONTEND_DIR, path.basename(pathname));
      if (fs.existsSync(file) && file.startsWith(FRONTEND_DIR)) {
        const buf = fs.readFileSync(file);
        res.writeHead(200, { 'Content-Type': mime(file), 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=3600' });
        return res.end(buf);
      }
    }
    if (pathname === '/' || pathname === '/index.html') {
      const fe = path.join(FRONTEND_DIR, 'index.html');
      if (fs.existsSync(fe)) return send(res, 200, fs.readFileSync(fe, 'utf8'), { 'Content-Type': 'text/html; charset=utf-8' });
    }
    if (pathname === '/admin' || pathname === '/admin/') {
      return serveStatic(req, res, '/admin/');
    }
    send(res, 404, { error: 'Not found' });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'Internal server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Letty Trading admin backend on http://localhost:${PORT}`);
  console.log(`Admin UI: http://localhost:${PORT}/admin/`);
  console.log(`Admin: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log(`Test user: test@gmail.com / test123 (UID 4738165)`);
});

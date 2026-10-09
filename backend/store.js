/**
 * Simple JSON file persistence for Letty Trading admin backend.
 * All mutable admin state lives here.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');

const defaultContractPlans = {
  annual: { name: 'Annual', short: 'YR', rate: 18, days: 365 },
  sixmonth: { name: '6 Month', short: '6M', rate: 9, days: 180 },
  monthly: { name: 'Monthly', short: 'MO', rate: 1.5, days: 30 },
  weekly: { name: 'Weekly', short: 'WK', rate: 0.346, days: 7 },
  daily: { name: 'Daily', short: 'DY', rate: 0.0493, days: 1 },
};

function defaultStore() {
  const now = Date.now();
  return {
    nextUid: 4738166,
    sessions: {},
    adminAccounts: [
      { email: 'ccweb3@admin.com', password: 'admin098', name: 'CC Web3 Admin' },
    ],
    users: [
      {
        id: 'U-4738165',
        uid: '4738165',
        name: 'Test User',
        email: 'test@gmail.com',
        password: 'test123',
        kyc: 'Unverified',
        tier: 'Tier 0',
        country: 'N/A',
        balanceUsdt: 10000,
        balances: { USDT: 10000, BTC: 0, ETH: 0, XRP: 0, SOL: 0 },
        role: 'user',
        welcome: 'none',
        createdAt: now,
      },
      {
        id: 'U-1042',
        name: 'Alice M.',
        email: 'alice@example.com',
        kyc: 'Verified',
        tier: 'Tier 2',
        country: 'SG',
        balanceUsdt: 48210,
        balances: { USDT: 48210 },
        role: 'user',
      },
      {
        id: 'U-1043',
        name: 'Budi S.',
        email: 'budi@example.com',
        kyc: 'Pending',
        tier: 'Tier 0',
        country: 'ID',
        balanceUsdt: 1200,
        balances: { USDT: 1200 },
        role: 'user',
      },
      {
        id: 'U-1044',
        name: 'Chen W.',
        email: 'chen@example.com',
        kyc: 'Verified',
        tier: 'Tier 3',
        country: 'HK',
        balanceUsdt: 212400,
        balances: { USDT: 212400 },
        role: 'user',
      },
      {
        id: 'U-1045',
        name: 'Dara P.',
        email: 'dara@example.com',
        kyc: 'Pending',
        tier: 'Tier 1',
        country: 'KH',
        balanceUsdt: 3300,
        balances: { USDT: 3300 },
        role: 'user',
      },
      {
        id: 'U-1046',
        name: 'Elena V.',
        email: 'elena@example.com',
        kyc: 'Rejected',
        tier: 'Tier 0',
        country: 'N/A',
        balanceUsdt: 0,
        balances: { USDT: 0 },
        role: 'user',
      },
      {
        id: 'U-1047',
        name: 'Farid K.',
        email: 'farid@example.com',
        kyc: 'Verified',
        tier: 'Tier 1',
        country: 'AE',
        balanceUsdt: 9100,
        balances: { USDT: 9100 },
        role: 'user',
      },
    ],
    requests: [
      {
        id: 'D-8001',
        type: 'deposit',
        userId: 'U-1045',
        asset: 'USDT',
        amount: 2500,
        network: 'TRC20',
        addr: 'SX' + Math.random().toString(36).slice(2, 28),
        status: 'review',
        approvals: [],
        createdAt: now - 180000,
        infoRequested: false,
      },
      {
        id: 'W-9001',
        type: 'withdraw',
        userId: 'U-1044',
        asset: 'USDT',
        amount: 18000,
        network: '',
        addr: 'SXa1b2c3d4e5f6g7h8j9k2m3n4p',
        status: 'review',
        approvals: [],
        createdAt: now - 720000,
        infoRequested: false,
      },
      {
        id: 'W-9002',
        type: 'withdraw',
        userId: 'U-1042',
        asset: 'BTC',
        amount: 0.45,
        network: '',
        addr: 'SX0000000000000000000000dead',
        status: 'review',
        approvals: [],
        createdAt: now - 300000,
        infoRequested: false,
      },
      {
        id: 'W-9003',
        type: 'withdraw',
        userId: 'U-1047',
        asset: 'ETH',
        amount: 6,
        network: '',
        addr: 'SXq7w8e9r2t3y4u5i6o7p8a9s2',
        status: 'review',
        approvals: [],
        createdAt: now - 90000,
        infoRequested: false,
      },
      {
        id: 'W-9004',
        type: 'withdraw',
        userId: 'U-1043',
        asset: 'USDT',
        amount: 2500,
        network: '',
        addr: 'SXz9x8c7v6b5n4m3k2j9h8g7f6',
        status: 'review',
        approvals: [],
        createdAt: now - 45000,
        infoRequested: false,
      },
    ],
    kycSubmissions: [],
    welcomeBonus: { status: 'none', userId: null, amount: 100, requestedAt: null },
    config: {
      fee: 0.1,
      maxLeverage: 200,
      reviewThreshold: 5000,
      dualApproval: 20000,
      mode: 'normal',
      halt: {},
      depositAddresses: {
        USDT: '',
        BTC: '',
        ETH: '',
        XRP: '',
        SOL: '',
      },
      usdtNetworkAddresses: {
        ERC20: '',
        TRC20: '',
        BEP20: '',
      },
      contractPlans: { ...JSON.parse(JSON.stringify(defaultContractPlans)) },
      blacklist: ['SX0000000000000000000000dead'],
      allowlist: [],
    },
    chat: [],
    adminNotifications: [],
    userNotifications: {},
    auditLog: [],
    passwordResets: {},
    loans: [],
    prices: {
      BTC: 65000,
      ETH: 3200,
      BNB: 580,
      SOL: 150,
      XRP: 0.55,
      DOGE: 0.15,
      ADA: 0.45,
      AAPL: 190,
      MSFT: 420,
      NVDA: 120,
      TSLA: 250,
      AMZN: 180,
      GOOGL: 170,
      XAU: 2350,
      XAG: 28,
      XPT: 980,
      XPD: 1000,
      SMX: 12.5,
      NOVA: 0.84,
      ARC: 230,
    },
  };
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load() {
  ensureDir();
  if (!fs.existsSync(STORE_PATH)) {
    const s = defaultStore();
    fs.writeFileSync(STORE_PATH, JSON.stringify(s, null, 2));
    return s;
  }
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const data = JSON.parse(raw);
    // merge missing config keys from defaults
    const def = defaultStore();
    data.config = Object.assign({}, def.config, data.config || {});
    data.config.contractPlans = Object.assign(
      {},
      def.config.contractPlans,
      (data.config && data.config.contractPlans) || {}
    );
    data.config.depositAddresses = Object.assign(
      {},
      def.config.depositAddresses,
      (data.config && data.config.depositAddresses) || {}
    );
    data.config.usdtNetworkAddresses = Object.assign(
      {},
      def.config.usdtNetworkAddresses,
      (data.config && data.config.usdtNetworkAddresses) || {}
    );
    data.users = data.users || def.users;
    data.nextUid = data.nextUid || def.nextUid || 4738165;
    data.sessions = data.sessions || {};
    data.adminAccounts = data.adminAccounts || def.adminAccounts || [{ email: 'ccweb3@admin.com', password: 'admin098', name: 'CC Web3 Admin' }];
    // Ensure test user exists
    if (!data.users.find((u) => (u.email || '').toLowerCase() === 'test@gmail.com')) {
      data.users.unshift({
        id: 'U-4738165', uid: '4738165', name: 'Test User', email: 'test@gmail.com', password: 'test123',
        kyc: 'Unverified', tier: 'Tier 0', country: 'N/A', balanceUsdt: 10000,
        balances: { USDT: 10000 }, role: 'user', welcome: 'none', createdAt: Date.now(),
      });
    } else {
      const tu = data.users.find((u) => (u.email || '').toLowerCase() === 'test@gmail.com');
      if (tu && !tu.password) tu.password = 'test123';
    }
    if (!data.adminAccounts.find((a) => a.email === 'ccweb3@admin.com')) {
      data.adminAccounts.push({ email: 'ccweb3@admin.com', password: 'admin098', name: 'CC Web3 Admin' });
    }
    data.requests = data.requests || [];
    data.kycSubmissions = data.kycSubmissions || [];
    data.chat = data.chat || [];
    data.adminNotifications = data.adminNotifications || [];
    data.userNotifications = data.userNotifications || {};
    data.auditLog = data.auditLog || [];
    data.passwordResets = data.passwordResets || {};
    data.loans = data.loans || [];
    data.welcomeBonus = data.welcomeBonus || def.welcomeBonus;
    data.prices = Object.assign({}, def.prices, data.prices || {});
    return data;
  } catch (e) {
    console.error('Failed to load store, using defaults', e.message);
    return defaultStore();
  }
}

function save(data) {
  ensureDir();
  const tmp = STORE_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, STORE_PATH);
}

let cache = null;

function get() {
  if (!cache) cache = load();
  return cache;
}

function set(data) {
  cache = data;
  save(data);
}

function mutate(fn) {
  const data = get();
  const result = fn(data);
  save(data);
  return result;
}

function addAudit(actor, message) {
  mutate((s) => {
    s.auditLog.unshift({ t: Date.now(), actor, message });
    s.auditLog = s.auditLog.slice(0, 200);
  });
}

function addAdminNotif(title, body) {
  mutate((s) => {
    s.adminNotifications.unshift({
      id: 'N-' + Date.now(),
      t: Date.now(),
      title,
      body,
      read: false,
    });
    s.adminNotifications = s.adminNotifications.slice(0, 100);
  });
}

function addUserNotif(userId, title, body) {
  mutate((s) => {
    if (!s.userNotifications[userId]) s.userNotifications[userId] = [];
    s.userNotifications[userId].unshift({
      id: 'UN-' + Date.now(),
      t: Date.now(),
      title,
      body,
      read: false,
    });
    s.userNotifications[userId] = s.userNotifications[userId].slice(0, 50);
  });
}

function riskScore(req, store) {
  const flags = [];
  let score = 0;
  const price = req.asset === 'USDT' ? 1 : store.prices[req.asset] || 1;
  const usd = req.amount * price;

  if (usd >= store.config.dualApproval) {
    flags.push('Very large amount (dual approval)');
    score += 40;
  } else if (usd >= store.config.reviewThreshold) {
    flags.push('Above review threshold');
    score += 20;
  }

  if (req.type === 'deposit') {
    if (usd >= 100000) {
      flags.push('Large deposit');
      score += 10;
    }
  } else {
    if ((store.config.blacklist || []).includes(req.addr)) {
      flags.push('Address on blocklist');
      score += 60;
    } else if ((store.config.allowlist || []).includes(req.addr)) {
      flags.push('Address on allowlist');
    } else {
      const prior = (store.requests || []).some(
        (t) =>
          t.type === 'withdraw' &&
          t.addr === req.addr &&
          t.status === 'completed'
      );
      if (!prior) {
        flags.push('New destination address');
        score += 15;
      }
    }
  }

  const user = (store.users || []).find((u) => u.id === req.userId);
  if (user && user.kyc !== 'Verified') {
    flags.push('KYC ' + String(user.kyc).toLowerCase());
    score += 30;
  }

  score = Math.min(100, score);
  const level = score >= 60 ? 'High' : score >= 30 ? 'Medium' : 'Low';
  return { score, flags, usd, level };
}


function cryptoRandom() {
  return require('crypto').randomBytes(24).toString('hex');
}

function findUserByEmail(email) {
  const s = get();
  return (s.users || []).find((u) => (u.email || '').toLowerCase() === String(email || '').toLowerCase());
}

function createSession(userId) {
  const token = cryptoRandom();
  mutate((s) => {
    s.sessions = s.sessions || {};
    s.sessions[token] = { userId, createdAt: Date.now() };
  });
  return token;
}

function userFromToken(token) {
  if (!token) return null;
  const s = get();
  const sess = (s.sessions || {})[token];
  if (!sess) return null;
  return (s.users || []).find((u) => u.id === sess.userId) || null;
}

function registerUser({ email, password, name }) {
  email = String(email || '').trim().toLowerCase();
  password = String(password || '');
  name = String(name || '').trim() || email.split('@')[0];
  if (!email || !password) throw new Error('Email and password required');
  if (password.length < 4) throw new Error('Password too short');
  if (findUserByEmail(email)) throw new Error('Email already registered');
  let user;
  mutate((s) => {
    const uidNum = s.nextUid || 4738165;
    s.nextUid = uidNum + 1;
    user = {
      id: 'U-' + uidNum,
      uid: String(uidNum),
      name,
      email,
      password,
      kyc: 'Unverified',
      tier: 'Tier 0',
      country: 'N/A',
      balanceUsdt: 0,
      balances: { USDT: 0 },
      role: 'user',
      welcome: 'none',
      createdAt: Date.now(),
    };
    s.users.push(user);
  });
  addAudit(user.id, 'Registered ' + email);
  return user;
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    uid: u.uid || (u.id || '').replace(/^U-/, ''),
    name: u.name,
    email: u.email,
    kyc: u.kyc,
    tier: u.tier,
    country: u.country,
    balanceUsdt: u.balanceUsdt,
    balances: u.balances || { USDT: u.balanceUsdt || 0 },
    welcome: u.welcome || 'none',
    role: u.role || 'user',
  };
}

module.exports = {
  get,
  set: typeof set === 'function' ? set : mutate,
  mutate,
  save: typeof save === 'function' ? save : (typeof set === 'function' ? set : () => {}),
  addAudit,
  addAdminNotif,
  addUserNotif,
  riskScore,
  defaultContractPlans,
  findUserByEmail,
  createSession,
  userFromToken,
  registerUser,
  publicUser,
  STORE_PATH: typeof STORE_PATH !== 'undefined' ? STORE_PATH : require('path').join(__dirname, 'data', 'store.json'),
};

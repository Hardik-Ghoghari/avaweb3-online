# CC Web3 — Letty Trading 
> Live: https://avaweb3.online

The original page mixed a full **Admin Center** into the browser app. That admin UI is **removed** from the user site. All admin features now run on a **Node.js backend** with its own control panel.

## Layout

```

  frontend/index.html     # User trading app (no Admin menu)
  backend/
    server.js             # Pure Node HTTP API (no npm install needed)
    store.js              # JSON file persistence + risk scoring
    public/index.html     # Admin Center UI
    data/store.json       # Created at runtime
  README.md
```

## Run the backend

```bash
cd backend
node server.js
# → http://localhost:3847
# Admin UI: http://localhost:3847/admin/
# Password: admin123   (override: ADMIN_PASSWORD=secret node server.js)
```

No `npm install` required — only Node.js built-ins.

## Admin features (all migrated)

| Section | Features |
|---------|----------|
| **Overview** | Volume/users/fees cards, admin notifications, welcome-bonus approve/reject |
| **Requests** | Deposit & withdrawal queue, risk score/flags, dual approval, approve/reject/request-info, allow/block addresses |
| **Users & KYC** | User list, edit balances, set KYC status, review KYC documents |
| **Contracts** | Interest rates for Annual / 6M / Monthly / Weekly / Daily plans |
| **Wallets** | Per-asset deposit addresses + USDT ERC20 / TRC20 / BEP20 |
| **Trading** | Fee %, max leverage, outcome mode (normal/win/lose), halt/resume markets |
| **Support** | Customer chat threads, admin replies |
| **Audit log** | Timestamped actor + event history |

## Public API (for wiring the user app later)

- `GET  /api/public/config`
- `POST /api/public/deposit`
- `POST /api/public/withdraw`
- `POST /api/public/kyc`
- `POST /api/public/chat`
- `POST /api/public/welcome-bonus`
- `GET  /api/public/user/:id`
- `GET  /api/public/notifications/:id`

## User frontend

Open `frontend/index.html` in a browser. Trading, contracts, deposits, KYC, and chat still use localStorage simulation. The **Admin** sidebar item and panel are gone.Branding updated to CC Web3. No Admin menu in user app.



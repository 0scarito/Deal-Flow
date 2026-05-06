# Deal Tracker — Chamfeuil Capital

A commission tracking web application for managing deals, invoicing (UF, Running, Perf fees), clients, suppliers, and brokers.

## Project Structure

```
dealflow/
├── index.html    # App HTML — structure and modals
├── style.css     # All styles (CSS variables, layout, components)
├── app.js        # All JavaScript logic (DB layer + app)
└── README.md
```

## Running the App

Simply open `index.html` in a browser — no build step required.

> **Note:** The app uses `localStorage` as its database by default. Data persists in the browser but is not shared between devices.

## Switching to Supabase (Production)

The database layer is isolated at the top of `app.js`. Replace the `lsGet / lsSave / sbGet / sbInsert / sbUpdate / sbDelete` functions with your Supabase client calls.

```js
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
```

## Features

- **Synthèse** — KPI dashboard, deal pipeline, monthly revenue chart
- **Deals** — Full deal list with filters, CSV import/export
- **Facturation** — UF, Running (quarterly), and Performance fees invoicing with PDF generation
- **Graphiques** — Charts by supplier, currency, billing status
- **Commissions** — Commission breakdown by seller (Audrey / David)
- **Clients / Fournisseurs / Brokers** — Reference data management

## Dependencies (CDN, no install needed)

- [Chart.js 4.4.1](https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js)
- [DM Sans + DM Mono](https://fonts.google.com) via Google Fonts

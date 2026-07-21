# CPO (Cost Per Order) — talabat LS
# Last Updated: 21 July 2026

## What This App Does
Store-level Cost Per Order (CPO) + Picker Utilization Rate (UTR) tracking.
Data comes from 2 Google Sheets (Orders + Attendance).
Also includes a Cost Optimizer tab that evaluates cost-reduction options per store.

---

## Architecture (TWO deployment options)

### Option A — Google Apps Script (GAS) — CURRENT
- **Backend**: `Code.gs` — all data reading, computation, caching, auth
- **Frontend**: `Dashboard.html` — single HTML file with embedded CSS + JS
- **Cache**: Google Drive JSON files (CPO_Cache folder) — no size limit
- **Archive**: Google Drive JSON files (CPO_Data_Archive folder) — monthly snapshots
- **Config/Users**: PropertiesService — vendor rates, employee costs, working days, users
- **Limit**: PropertiesService 500KB hard cap — `cpo_precomp_done` and `cpo_fetch_log` moved to Drive

### Option B — GitHub Pages + GitHub Actions — MIGRATION TARGET
- **Compute**: `scripts/compute.py` — Python script, runs on GitHub Actions schedule (2×/day)
- **Hosting**: GitHub Pages — serves `index.html` (= Dashboard.html + static shim)
- **Data**: `data/*.json` — committed to repo by Actions after each compute run
- **Config**: `config/app_config.json` (vendor rates, costs, optimizer), `config/users.json`
- **Auth**: `config/users.json` — email → role lookup; login prompt in browser
- **No server**: the `google.script.run` shim in `index.html` intercepts all GAS calls → `fetch('data/...')`
- **Secrets**: GitHub Secret `GOOGLE_CREDENTIALS_JSON` — service account JSON for Sheets API

**Static shim design**: When `google` is undefined (GitHub Pages), a JS Proxy intercepts every `google.script.run.METHOD()` call. Reads map to `fetch('data/METHOD.json')`; writes (Refresh, Settings edits) return a static "not supported" response. The dashboard UI is identical — only the data layer changes.

---

## Google Sheet IDs
- Orders: `1mDnzwA0fycVbo-1hIxvKzoLoi5U8pv12I6Fazq8CKOI`
- Attendance: `1LRlCJbv7nnabo_doQ2VAP4jMl80fF-ZpLcsqIE6FO9w`
- Master Data: `10swg2HotxTSmIMPGQt6AxARFQyfTbvt7504tFjysmGs`

## Sheet Tabs
- Orders: `MTD Order`, `Weekly Order`, `Monthly Order`
- Attendance: `MTD Know`, `Weekly Know`, `Monthly Know`
- Master: `Master Data Champions`
- Hourly Orders: `Sheet2` (vendorId + hourly columns 0–23)
- Hourly GMV: separate tab (same structure as hourly orders)
- Store Timing: `Sheet3` (vendorId, open datetime string, close datetime string)

---

## Data Flow
1. **Refresh** button → reads all sheets → saves to Drive (CPO_Cache folder) + saves date lists to PropertiesService + saves MTD sync info
2. **Startup** (`getInitialData`) → reads date lists from PropertiesService (instant) + reads pre-computed MTD from Drive + loads config from PropertiesService
3. **Tab click** → checks `APP.cache` (browser memory) first → if missing, checks pre-computed Drive file → if missing, computes live from Drive data
4. **Fetch All Data** → admin only → batches: 1 month/batch, 2 weeks/batch, 3 daily/batch → saves to Drive → marks done in PropertiesService `cpo_precomp_done`
5. **Scheduled Auto-Fetch** → GAS time-based trigger runs `scheduledFetch()` at configured hours (default twice daily) — runs full 4-step refresh + all CPO batches server-side regardless of browser state

---

## Key Calculations

### CPO (Cost Per Order)
- **Picker CPO** = Total Picker Cost ÷ Total Orders
- **Loaded CPO** = (Picker Cost + Champion Allocation + Supervisor Allocation) ÷ Total Orders
- Picker Cost = (Vendor Monthly Rate ÷ Working Days) × Days Present
- Champion allocation split equally across stores they manage
- Supervisor allocation split across all stores under their champions

### UTR (Picker Utilization Rate) — orders per hour
- **Formula**: Total Orders ÷ (Total Days Present × Vendor Hours/Day)
- Example: 600 orders ÷ (12 days × 10 hrs) = 5.0 orders/hr
- Higher = better productivity
- Each vendor has its own hours/day setting (default 10)

### MTD Valid Date Rule
- A date is ONLY included if BOTH total orders > 0 AND total attendance > 0
- Dates where either source is 0 = skipped (data not yet available)
- This handles T-1 timing difference between order and attendance data sources
- "Data updated till" banner shows last valid date (both sources non-zero)

### Working Days defaults
- February: 24 days
- 31-day months: 27 days
- 30-day months: 26 days
- Overrides configurable in Settings → Working Days

---

## Performance Architecture

### Startup (~5-15 seconds)
- Date lists: PropertiesService (instant)
- Config: PropertiesService (instant)
- MTD summary: Drive read + compute (or pre-computed Drive file if Fetch All done)
- Archived months: NOT loaded on startup — lazy loaded when Historical tab opened

### Tab Switch
1. Check `APP.cache` (browser memory) → instant if already computed this session
2. Check `cpo_precomp_done` in PropertiesService → if done key exists, read from Drive (~2-3s)
3. Compute live from Drive cached data (~5-10s)
4. Result saved to `APP.cache` → next click on same date = instant

### After "Fetch All Data" (Admin)
- Every date pre-computed and saved to Drive
- All users get instant tab switches (~2-3s Drive read only, no computation)
- Past months/weeks NEVER recomputed (marked done in `cpo_precomp_done`)
- Future dates skipped (no data yet)
- Current month always recomputed (data still changing)

### Drive Folder Caching
- `_cacheFolder` variable caches the folder object per GAS execution
- Prevents repeated Drive folder searches on every read/write

### Config Loading Optimization
- `computeCPO()` loads all config ONCE before the store loop
- Builds `vendorRateMap` dictionary (vendor name → rate + hours)
- No repeated PropertiesService reads per picker/store

---

## Branding
- Orange: `#FF5A00`
- Burgundy: `#411517`
- Cream: `#F4EDE3`

---

## Rules — DO NOT CHANGE WITHOUT EXPLICIT REQUEST
- DO NOT change data structure or arrangement unless explicitly asked
- DO NOT rewrite full files — make surgical edits only
- Auto-fill admin login credentials on login page
- Never hardcode thresholds — always read from `APP.optimizerConfig`

---

## Navigation Tabs
- **Dashboard** — MTD / Daily / Weekly / Monthly with filters
- **Historical & Trends** — trend line charts (daily/weekly/monthly) + date range calculator
- **Store Map** — CPO-colored map markers per store (uses lat/lng from master data)
- **Cost Optimizer** — ranked cost reduction options per store (see section below)
- **Settings** — Vendor Rates, Employee Costs, Working Days, Optimizer Config, Fetch All Data (admin), User Access (admin), Email Reports (admin)

---

## Dashboard Features
- Period buttons: MTD (summary), Daily (date picker + Compute button), Weekly (date picker + Compute button), Monthly (date picker + Compute button)
- Filters: Chain, City, Supervisor, 3PL, Type (Picker / Picker+Scanner / All)
- KPI cards with ⓘ hover tooltips explaining each metric
- Table: sortable, searchable, export CSV
- MTD sync banner: shows "Data updated till YYYY-MM-DD"
- Columns: Vendor ID, Store, Chain, City, 3PL, Supervisor, Champion, Pickers, Orders, Present Days, Picker Cost, CPO Picker, CPO Full, UTR

---

## Historical & Trends Features
- View: Daily / Weekly / Monthly trend
- Metric: CPO / UTR / Both (dual Y-axis)
- Filters: Chain, Store, From date, To date, Type
- Compute button → fetches missing dates one at a time, caches results
- Line chart + data table + CSV export
- Includes archived months (lazy loaded from Drive)

---

## Cost Optimizer Tab

### Purpose
Evaluates cost-reduction options per store based on current MTD data. Shows ALL options — viable and not-viable — with specific reasons.

### How it works
- `calcAllOptions(store)` — unified engine that evaluates all combinations per store
- `renderStoreOptions(result)` — renders ranked option cards per store
- `renderOptimizerView()` — main view; iterates all flagged/all stores

### Options evaluated (ranked by net saving, highest first)

**1. Headcount reduction**
- `minPickers = ceil(peakHourlyOrders / utrThreshold)` — NOT always 1
- If `minPickers >= currentPickers` → not viable (with specific peak/threshold numbers)
- Saving = `pickersReduced × avgPickerCost`
- Reliever cost = `minPickers × (weekdayWorkDays/6) × dailyRate` (day-offs are weekday-only)
- Net = saving − reliever cost

**2. Trim low-volume edges + headcount reduction**
- Only shown if trimming actually eliminates OT on top of headcount saving (otherwise duplicate of option 1 — suppressed)
- Edge hours trimmed: hours where avg orders < `edgeOrderThreshold` AND GMV < `edgeGMVThreshold`
- Snap to :00/:30: open snaps UP, close snaps DOWN
- After trim, recalculate `minPickersTrim = ceil(peakInTrimmedWindow / utrThreshold)`
- OT eliminated = hours beyond `contractHrs + 1` in trimmed window

**3. Trim low-volume edges — reduce OT only (keep headcount)**
- When trimming eliminates OT but headcount can't be reduced
- Only viable if trim actually removes OT hours

**4. Store closure**
- Requires same-chain store within `proximityRadiusKm` (configurable, default 5 km)
- Uses `haversineKm()` for distance, `getNearestSameChain()` for lookup
- `getNearestSameChain` returns `{storeName, vendorId, km, minDrive}`
- `calcClosureScenario` also finds nearest store regardless of radius (for not-viable reason)
- **Nearby store extra cost**: looks up nearby store in `APP.allData`, calculates new load (`nearbyOPD + closedOPD`), computes extra pickers needed (`ceil(newLoad / (utrThr × contractHrs))`), adds extra cost to breakdown
- Net saving = this store cost saved − extra manpower at nearby store

### Not-viable display
Every option that can't be applied is shown in a "Not applicable" section with a specific reason including actual numbers — e.g.:
- "Peak hour 7pm has 8 orders — minimum 2 pickers needed at UTR threshold 5, already at 2"
- "No same-chain store within 5 km (nearest: Union Coop Al Twar, 7.2 km away)"
- "All hours are above the 1 order/hr threshold — no edges to trim"

### Key design decisions
- Reliever cost always shown as separate line (not bundled into picker cost)
- Picker day-offs are weekday-only (Mon–Fri) — `_weekdaysOnly(wDays)` helper
- UTR threshold is binary per hour — any single hour > threshold means that many pickers must be present
- No pre-named option frames — label describes what the combination achieves
- Chain CPO impact shown for headcount and closure options
- Trim+headcount option suppressed when it produces same saving as headcount-only

### Optimizer config (stored in PropertiesService `cpo_config_optimizer`)
- `actionThreshold` — CPO above this = flagged (default 4.0)
- `criticalThreshold` — CPO above this = critical (default 20.0)
- `otUTRThreshold` — max orders/hr per picker (default 5)
- `edgeOrderThreshold` — avg orders/hr below this = low-volume edge (default 1)
- `edgeGMVThreshold` — avg GMV/hr below this = low-volume edge (default 50)
- `proximityRadiusKm` — max km for store closure coverage (default 5)
- `otMultiplier` — OT pay rate multiplier (default 1.5)
- `weekdayDayOffOnly` — 1 = day-offs Mon–Fri only (default 1)

### Master data required for optimizer
- `APP.masterData` — keyed by vendorId, includes `lat`, `lng`, `chainName`, `storeName`
- Lat/lng loaded from Master Data sheet (columns configured in backend)
- Used for: haversine distance, nearest store lookup

### Hourly data (loaded separately from CPO data)
- `APP.hourlyOrders` — `{vendorId: {0..23: avgOrders}}`
- `APP.hourlyGMV` — `{vendorId: {0..23: avgGMV}}`
- `APP.storeTiming` — `{vendorId: {openHr, closeHr}}` — snapped to :00/:30
- Access via: `_getStoreHourly(vid)`, `_getStourlyGMV(vid)`, `_getStoreTiming(vid)`
- Loaded on Refresh and on scheduled auto-fetch

---

## Settings — Vendor Rates
- Fields: Vendor Name, Base Rate (AED/month), Hours/Day, Start Month, Start Year
- Edit button pre-fills form, Save updates rate + hours
- Used for: CPO calculation (rate) and UTR calculation (hours/day)
- Effective date support — rates can change over time

## Settings — Fetch All Data (Admin Only)
- Gets batch plan from server (instant — reads PropertiesService only, no Drive)
- Skips future dates (no data), skips past dates already done
- Batches: 1 month/batch, 2 weeks/batch, 3 daily/batch
- Sequential execution — each batch completes before next starts
- Progress bar shows real batch count (e.g. "Batch 3/12: 2026-07-15")
- After each batch, marks keys done in `cpo_precomp_done` PropertiesService key
- **Run in Background** button: calls `triggerFetchNow()` → GAS one-shot trigger fires in ~10s server-side (browser tab does not need to stay open)
- **Auto-schedule**: `setupAutoFetch(hour1, hour2)` creates two daily GAS time-based triggers; hours saved in `cpo_auto_fetch_hours`; `disableAutoFetch()` removes them

## Settings — Optimizer (Admin Only)
- Configure all optimizer thresholds (see Optimizer config section above)
- No hardcoded values anywhere — always read from config

---

## Scheduled Auto-Fetch (`scheduledFetch` in Code.gs)
Runs server-side via GAS trigger — no browser required. Steps:
1. Full sheet refresh (orders, attendance, master) — same as clicking Refresh
2. Reload hourly orders data (`loadHourlyOrderData`)
3. Reload hourly GMV data (`loadHourlyGMVData`)
4. Reload store timing data (`loadStoreTimingData` — Sheet3)
5. Run all pending CPO compute batches (up to 5-minute budget)

Functions:
- `scheduledFetch()` — main function called by trigger
- `setupAutoFetch(h1, h2)` — creates two daily triggers, saves hours to PropertiesService
- `disableAutoFetch()` — removes all `scheduledFetch` triggers
- `getAutoFetchConfig()` — returns `{hours, activeTriggers}` for UI display
- `triggerFetchNow()` — creates one-shot trigger firing in 10s (background fetch)

PropertiesService key: `cpo_auto_fetch_hours` → JSON array `[hour1, hour2]`

---

## User Roles
- **Admin**: Full access — settings, users, email triggers, all data
- **Manager**: View all stores and data
- **Supervisor**: View only their assigned stores (filtered by supervisorName)
- **Viewer**: Limited read-only
- **Revoked**: No access

---

## PropertiesService Keys (what's stored)
- `cpo_config_vendor_rates` — vendor rates array with hoursPerDay
- `cpo_config_employee_costs` — Champion + City Supervisor monthly costs
- `cpo_config_working_days` — working day overrides per month/year
- `cpo_config_email_settings` — weekly/monthly email trigger config
- `cpo_config_optimizer` — optimizer thresholds (see Optimizer config section)
- `cpo_users` — user list with roles
- `cpo_timestamp` — last refresh timestamp
- `cpo_dates_mtd/weekly/monthly` — date arrays (saved on Refresh)
- `cpo_sync_date` — last MTD valid date (both orders + attend > 0)
- `cpo_precomputed` — 'true' if Fetch All Data completed
- `cpo_precomp_timestamp` — when Fetch All last ran
- `cpo_precomp_done` — JSON object of completed precomp keys
- `cpo_auto_fetch_hours` — JSON array [hour1, hour2] for auto-schedule

---

## Drive Files (CPO_Cache folder)
- `cpo_cache_master.json` — master data (store→champion/supervisor/lat/lng mapping)
- `cpo_cache_orders_mtd.json` — MTD order data
- `cpo_cache_orders_weekly.json` — weekly order data
- `cpo_cache_orders_monthly.json` — monthly order data
- `cpo_cache_attend_mtd.json` — MTD attendance data
- `cpo_cache_attend_weekly.json` — weekly attendance data
- `cpo_cache_attend_monthly.json` — monthly attendance data
- `cpo_cache_precomp_mtd_N.json` — pre-computed CPO for MTD date index N
- `cpo_cache_precomp_weekly_N.json` — pre-computed CPO for weekly date index N
- `cpo_cache_precomp_monthly_N.json` — pre-computed CPO for monthly date index N
- `cpo_cache_precomp_mtd_summary.json` — pre-computed MTD summary
- `cpo_cache_hourly_orders.json` — hourly orders per store (from Sheet2)
- `cpo_cache_hourly_gmv.json` — hourly GMV per store
- `cpo_cache_store_timing.json` — store open/close hours (from Sheet3)

## Drive Files (CPO_Data_Archive folder)
- `cpo_monthly_YYYY-MM.json` — monthly snapshot saved on each Refresh

---

## Admin Workflow (every refresh cycle)
1. Click **Refresh** in app (~2-3 min) — reads sheets, saves to Drive, saves date lists
2. Go to **Settings → Fetch All Data** → click button — computes all missing dates in batches
3. Share link — all users get fast access

Alternatively: set up auto-fetch in Settings → Fetch All Data → Auto-schedule (runs steps 1+2 automatically at configured hours).

## After Fetch All Data
- Past months/weeks: instant forever (pre-computed, never recomputed)
- Current month daily: recomputed on next Fetch All (data still changing)
- New month/week: computed on next Fetch All, then cached forever

---

## Store Timing Logic (Sheet3)
- Raw open/close come as datetime strings (e.g. "2026-07-01 08:45:00")
- `_extractTimeHours()` parses to decimal hours (8.75 = 8:45am)
- `_snapHalf(h, 'up')` → snaps open time UP to nearest :00 or :30
- `_snapHalf(h, 'down')` → snaps close time DOWN to nearest :00 or :30
- `_trimEdgeHours(snOpen, snClose, hourly, gmv, orderThr, gmvThr)` → removes low-volume edge hours from both ends, returns `{open, close, trimStart[], trimEnd[]}`

---

## OT Model Calculation
- `totalShiftHrs = contractHrs + 1` (1 hr break added to contract hours)
- `otHrs = max(0, activeStoreHrs - totalShiftHrs)` rounded to nearest 0.5
- OT cost = `otHrs × otMultiplier × hourlyRate × pickers × workDays`
- `hourlyRate = monthRate / (wDays × contractHrs)`

---

## Known Limitations
- GAS execution limit: 6 minutes per call — handled by batch approach and 5-min budget in `scheduledFetch`
- PropertiesService total: 500KB — only small config/metadata stored there now
- Drive: 15GB free — no meaningful limit for this app
- `getDailyTrendData()` still computes all MTD dates in one call — may timeout if MTD has many dates. Consider deprecating or batching.
- Hourly data loaded into `APP.hourlyOrders` / `APP.hourlyGMV` / `APP.storeTiming` on startup — if not available, optimizer shows "No hourly data" for affected options

---

## Files in This Folder

### GAS (Option A)
- `Code.gs` — full GAS backend
- `Dashboard.html` — full frontend (also serves as static app with shim)
- `CLAUDE.md` — this file
- `management-brief-email.html` — management email template
- `presentation/` — PowerPoint generation scripts

### GitHub Pages (Option B)
- `index.html` — copy of Dashboard.html, served by GitHub Pages
- `scripts/compute.py` — Python CPO computation engine (ports Code.gs logic)
- `scripts/requirements.txt` — Python dependencies
- `scripts/credentials.json` — LOCAL ONLY, never commit (service account key)
- `.github/workflows/compute.yml` — GitHub Actions: runs compute.py 2×/day, commits data/
- `config/app_config.json` — vendor rates, employee costs, working days, optimizer config
- `config/users.json` — user list with roles (email → role)
- `data/` — output JSON files committed by Actions (meta, MTD, daily, weekly, monthly, hourly, timing)
- `.gitignore` — excludes scripts/credentials.json

---

## GitHub Pages Setup Steps (one-time)
1. Create GitHub repo, push this folder
2. Create a Google Cloud service account → download JSON key → save as `scripts/credentials.json` locally (never commit)
3. Share all 4 Google Sheets with the service account email (Viewer role)
4. Add GitHub Secret `GOOGLE_CREDENTIALS_JSON` = contents of credentials.json
5. Go to repo Settings → Pages → Source: `main` branch, root folder → Save
6. Update `config/app_config.json` with real vendor rates and employee costs
7. Update `config/users.json` with all user emails and roles
8. Trigger Actions manually once to populate `data/` folder
9. Access at `https://YOUR-ORG.github.io/REPO-NAME/`

## GitHub Pages — What Works vs GAS
| Feature | GAS | GitHub Pages |
|---|---|---|
| View dashboard | ✅ | ✅ |
| All periods (MTD/Daily/Weekly/Monthly) | ✅ | ✅ |
| Cost Optimizer | ✅ | ✅ |
| Historical & Trends | ✅ | ✅ |
| Auto data refresh | Refresh button (admin) | GitHub Actions (scheduled) |
| Settings — view config | ✅ | ✅ (read from config/) |
| Settings — edit config | ✅ | ❌ (read-only in static mode) |
| User management | ✅ | Edit config/users.json manually |
| Email reports | ✅ | ❌ (no server) |

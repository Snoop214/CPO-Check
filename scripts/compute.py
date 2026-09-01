"""
talabat LS — CPO Compute Script
Reads Google Sheets → computes CPO/UTR → writes JSON files to data/
Run by GitHub Actions on schedule, or locally for testing.
"""
import json, os, math, re, sys, calendar, glob
from datetime import datetime, date, timedelta
from dateutil.relativedelta import relativedelta
import gspread
from google.oauth2.service_account import Credentials

# ── Sheet IDs ────────────────────────────────────────────────────
SHEET_IDS = {
    'orders':         '1mDnzwA0fycVbo-1hIxvKzoLoi5U8pv12I6Fazq8CKOI',
    'attendance':     '1LRlCJbv7nnabo_doQ2VAP4jMl80fF-ZpLcsqIE6FO9w',  # legacy MTD/Weekly/Monthly Know tabs — no longer read, kept for reference only
    'attendance_log': '1_6EI-J9_QRTo1HHl1nUoHRzo8vXZnPUQYRLBk5m0grg',  # "Daily Attendance" — flat per-shift log, replaces the 3 Know tabs above
    'master':         '10swg2HotxTSmIMPGQt6AxARFQyfTbvt7504tFjysmGs',
    'hourly':         '1n4GopL6gSsSw_sauMkHKVfcF6IDYI84skyGMdfC4hqA',
}
# Sheet tabs for hourly/timing sheet:
# Sheet1 = Hourly GMV (Chain ID, Chain Name, Vendor ID, Vendor Name, then cols 0-23 = GMV per hour)
# Sheet2 = Hourly Orders (Chain ID, Chain Name, Vendor ID, Vendor Name, then cols 0-23 = avg daily orders per hour)
# Sheet3 = Store timing (Vendor ID, Vendor Name, Day of Week, Schedule End, Schedule Start, Shift Hours)
ORDER_TABS  = {'mtd': 'MTD Order',  'weekly': 'Weekly order',  'monthly': 'Monthly order'}

DATA_DIR   = os.path.join(os.path.dirname(__file__), '..', 'data')
CONFIG_DIR = os.path.join(os.path.dirname(__file__), '..', 'config')

# Attendance is archived one calendar day at a time under data/daily_attendance/
# so weekly/monthly totals are built by SUMMING already-archived days rather than
# re-reading the live "Daily Attendance" sheet for old dates. The live sheet is
# only expected to hold a rolling window (~40-50 days); once a day is archived
# and older than FREEZE_DAYS, it is never overwritten again — this is what stops
# a past month from silently going to zero if the live sheet's window moves on.
DAILY_ARCHIVE_DIR = os.path.join(DATA_DIR, 'daily_attendance')
FREEZE_DAYS = 3
# A picker doesn't get paid for 1 hour if they clock in >30min after their
# scheduled start, or clock out >30min before their scheduled end (either
# trigger, capped at 1 hour deducted per day, never 2).
LATE_EARLY_THRESHOLD_MIN = 30

SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets.readonly',
    'https://www.googleapis.com/auth/drive.readonly',
]

# ── Auth ─────────────────────────────────────────────────────────
def get_client():
    creds_json = os.environ.get('GOOGLE_CREDENTIALS_JSON')
    if creds_json:
        info = json.loads(creds_json)
    else:
        # Local dev: put credentials.json next to this script
        path = os.path.join(os.path.dirname(__file__), 'credentials.json')
        with open(path) as f:
            info = json.load(f)
    creds = Credentials.from_service_account_info(info, scopes=SCOPES)
    return gspread.authorize(creds)

# ── Config ───────────────────────────────────────────────────────
def load_config():
    path = os.path.join(CONFIG_DIR, 'app_config.json')
    with open(path) as f:
        return json.load(f)

def save_json(filename, obj):
    os.makedirs(DATA_DIR, exist_ok=True)
    path = os.path.join(DATA_DIR, filename)
    with open(path, 'w') as f:
        json.dump(obj, f, separators=(',', ':'))
    print(f'  saved {filename}')

# ── Helpers ──────────────────────────────────────────────────────
# Known misspellings/variants in the ops attendance sheet that don't match
# the vendor name spelling used in config/app_config.json's vendor_rates.
DEPT_ALIASES = {
    'truemax': 'trumax',  # attendance sheet spells it "Truemax"; vendor config uses "Trumax"
}

def normalize_dept(s):
    nd = re.sub(r'\s+', ' ', str(s or '').strip().lower())
    return DEPT_ALIASES.get(nd, nd)

def normalize_date(v):
    if isinstance(v, (datetime, date)):
        return v.strftime('%Y-%m-%d')
    s = str(v).strip()
    if re.match(r'^\d{4}-\d{2}-\d{2}$', s): return s
    if re.match(r'^\d{4}-\d{2}$', s): return s + '-01'
    return s

def _parse_dt(s):
    """Parse a 'YYYY-MM-DD H:MM:SS' (or date-only) string into a datetime.
    Returns None for blank/unparseable values (e.g. Absent rows have no
    actual clock times)."""
    s = str(s).strip()
    if not s:
        return None
    for fmt in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%d %H:%M', '%Y-%m-%d'):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None

def find_col(headers, names):
    hl = [str(h).strip().lower() for h in headers]
    for n in names:
        try: return hl.index(n)
        except ValueError: pass
    return -1

def _period_date_range(period, target_date, year, month):
    """Return (start,end) inclusive calendar-date strings that this period's
    single date label actually spans. Weekly/Monthly attendance data only
    gives one aggregate total per label (e.g. '2026-06-01' for the whole
    month, or a week-ending date for a week) — so a literal `target_date ==
    holiday_date` check almost never matches. This reconstructs the real
    span so we can tell whether a holiday falls inside it."""
    if period == 'monthly':
        last_day = calendar.monthrange(year, month)[1]
        return f'{year}-{month:02d}-01', f'{year}-{month:02d}-{last_day:02d}'
    if period == 'weekly':
        # Sheet labels are "week ending" dates (see 'Scheduled End Time Week').
        try:
            end = datetime.strptime(str(target_date)[:10], '%Y-%m-%d').date()
            start = end - timedelta(days=6)
            return start.isoformat(), end.isoformat()
        except (ValueError, TypeError):
            return target_date, target_date
    # Daily / per-day MTD calls already use a real single calendar day.
    return target_date, target_date

def get_working_days(month, year, overrides):
    key = f'{year}-{month:02d}'
    if key in overrides:
        return int(overrides[key])
    if month == 2: return 24
    days_in_month = 31 if month in (1,3,5,7,8,10,12) else 30
    return 27 if days_in_month == 31 else 26

def resolve_effective_rate(rates, month, year, dept_norm):
    """Find the most recent vendor rate effective for this month/year."""
    target = year * 12 + month
    best = None
    best_start = -1
    for r in rates:
        nm = normalize_dept(r.get('vendorName', ''))
        if nm != dept_norm: continue
        start = r.get('effectiveStartYear', 2020) * 12 + r.get('effectiveStartMonth', 1)
        end_y = r.get('effectiveEndYear')
        end_m = r.get('effectiveEndMonth')
        end = (end_y * 12 + end_m) if (end_y and end_m) else 999999
        if start <= target <= end and start > best_start:
            best = r
            best_start = start
    return best

def resolve_effective_emp(emp_costs, month, year, role):
    target = year * 12 + month
    best = None
    best_start = -1
    for e in emp_costs:
        if str(e.get('role', '')).strip().lower() != role.lower(): continue
        start = e.get('effectiveStartYear', 2020) * 12 + e.get('effectiveStartMonth', 1)
        end_y = e.get('effectiveEndYear')
        end_m = e.get('effectiveEndMonth')
        end = (end_y * 12 + end_m) if (end_y and end_m) else 999999
        if start <= target <= end and start > best_start:
            best = e
            best_start = start
    return best

# ── Sheet Readers ────────────────────────────────────────────────
def find_date_row(data):
    for r in range(min(5, len(data))):
        for c, v in enumerate(data[r]):
            s = str(v).strip()
            if re.match(r'^\d{4}-\d{2}', s) or isinstance(v, (datetime, date)):
                return r, c
    return None, None

def extract_dates(data, date_row, start_col):
    dates = []
    for c in range(start_col, len(data[date_row])):
        s = normalize_date(data[date_row][c])
        if s and re.match(r'^\d{4}', s):
            dates.append((c, s))
    return dates

def read_order_data(gc, period):
    print(f'  reading orders {period}...')
    sh = gc.open_by_key(SHEET_IDS['orders'])
    ws = sh.worksheet(ORDER_TABS[period])
    data = ws.get_all_values()
    if len(data) < 3: return {'dates': [], 'stores': {}}

    date_row, start_col = find_date_row(data)
    if date_row is None: return {'dates': [], 'stores': {}}
    dates = extract_dates(data, date_row, start_col)

    hr = date_row + 1
    if hr >= len(data): hr = 1
    headers = data[hr]
    c_chain_id   = find_col(headers, ['chain id'])
    c_chain_name = find_col(headers, ['chain name'])
    c_vid        = find_col(headers, ['vendor id'])
    c_vname      = find_col(headers, ['vendor name (english)', 'vendor name'])

    stores = {}
    for row in data[hr + 1:]:
        vid = str(row[c_vid]).strip() if c_vid >= 0 else ''
        if not vid or vid.lower() == 'undefined': continue
        values = []
        for col, _ in dates:
            try: values.append(float(str(row[col]).replace(',', '')) if col < len(row) else 0)
            except: values.append(0)
        stores[vid] = {
            'chainId':   str(row[c_chain_id]).strip()   if c_chain_id >= 0 and c_chain_id < len(row) else '',
            'chainName': str(row[c_chain_name]).strip() if c_chain_name >= 0 and c_chain_name < len(row) else '',
            'vendorName':str(row[c_vname]).strip()      if c_vname >= 0 and c_vname < len(row) else '',
            'values':    values,
        }
    return {'dates': [d for _, d in dates], 'stores': stores}

def read_daily_attendance_log(gc):
    """Read the flat 'Daily Attendance' shift-log sheet — one row per employee
    per scheduled shift/day, with Status (Absent/On Leave/Present - On Time/
    Present - Late/Scheduled) and scheduled + actual clock-in/out datetimes.
    Groups rows by calendar day. This single sheet replaces the old MTD Know /
    Weekly Know / Monthly Know pivot tabs.

    Also flags the late-start/early-leave pay deduction per shift: no pay for
    1 hour if actual clock-in is >30min after Scheduled Start Time, OR actual
    clock-out is >30min before Scheduled End Time Time (either trigger, never
    both stacked — capped at 1 hour)."""
    print('  reading daily attendance log...')
    sh = gc.open_by_key(SHEET_IDS['attendance_log'])
    ws = sh.get_worksheet(0)
    data = ws.get_all_values()
    if len(data) < 2:
        return {}
    headers = data[0]
    c_name    = find_col(headers, ['employee name'])
    c_type    = find_col(headers, ['user type'])
    c_dept    = find_col(headers, ['department', 'dept', '3pl'])
    c_sid     = find_col(headers, ['shopper id'])
    c_bid     = find_col(headers, ['shift branch id'])
    c_status  = find_col(headers, ['status'])
    c_ci_time = find_col(headers, ['actual clockin time'])
    c_co_time = find_col(headers, ['actual clockout time'])
    c_sch_end = find_col(headers, ['scheduled end time time'])
    c_sch_str = find_col(headers, ['scheduled start time'])

    by_date = {}
    for row in data[1:]:
        def g(ci):
            return str(row[ci]).strip() if 0 <= ci < len(row) else ''
        bid = g(c_bid)
        sid = g(c_sid)
        if not bid or not sid:
            continue
        sched_start = _parse_dt(g(c_sch_str))
        if sched_start is None:
            continue
        shift_date = sched_start.strftime('%Y-%m-%d')

        status = g(c_status).lower()
        present = 1 if status.startswith('present') else 0
        deduction = 0
        if present:
            actual_in  = _parse_dt(g(c_ci_time))
            actual_out = _parse_dt(g(c_co_time))
            sched_end  = _parse_dt(g(c_sch_end))
            late_min  = (actual_in - sched_start).total_seconds() / 60 if actual_in else 0
            early_min = (sched_end - actual_out).total_seconds() / 60 if (actual_out and sched_end) else 0
            if late_min > LATE_EARLY_THRESHOLD_MIN or early_min > LATE_EARLY_THRESHOLD_MIN:
                deduction = 1

        by_date.setdefault(shift_date, []).append({
            'vendorId':   bid,
            'shopperId':  sid,
            'name':       g(c_name),
            'userType':   g(c_type) or 'Picker',
            'department': g(c_dept),
            'present':    present,
            'deduction':  deduction,
        })
    print(f'    {len(data) - 1} rows -> {len(by_date)} distinct days')
    return by_date

def archive_daily_attendance(by_date):
    """Write/refresh per-day archive files under data/daily_attendance/. Days
    older than FREEZE_DAYS are never overwritten once archived — this is what
    keeps a past month's numbers from silently going to zero if the live
    sheet's rolling window later moves past that date. Days without an
    existing file are always written regardless of age, so a gap left by a
    previously-failed run self-heals as long as the live sheet still shows it."""
    os.makedirs(DAILY_ARCHIVE_DIR, exist_ok=True)
    today = date.today()
    written, frozen = 0, 0
    for d, records in by_date.items():
        try:
            d_date = datetime.strptime(d, '%Y-%m-%d').date()
        except ValueError:
            continue
        path = os.path.join(DAILY_ARCHIVE_DIR, f'{d}.json')
        age_days = (today - d_date).days
        if os.path.exists(path) and age_days > FREEZE_DAYS:
            frozen += 1
            continue
        with open(path, 'w') as f:
            json.dump({'date': d, 'records': records}, f, separators=(',', ':'))
        written += 1
    print(f'  attendance archive: wrote/refreshed {written} days, {frozen} already-frozen days left untouched')

def load_archived_days(start_date, end_date):
    """Load archived daily records for [start_date, end_date] inclusive.
    Missing days are simply absent from the result."""
    out = {}
    if not os.path.isdir(DAILY_ARCHIVE_DIR):
        return out
    d = datetime.strptime(start_date, '%Y-%m-%d').date()
    end = datetime.strptime(end_date, '%Y-%m-%d').date()
    while d <= end:
        ds = d.isoformat()
        path = os.path.join(DAILY_ARCHIVE_DIR, f'{ds}.json')
        if os.path.exists(path):
            with open(path) as f:
                out[ds] = json.load(f).get('records', [])
        d += timedelta(days=1)
    return out

def build_attend_struct(archived_by_date, date_labels, period):
    """Turn archived daily records into the same {'dates','byStore'} shape
    compute_cpo already expects, so compute_cpo's per-picker logic barely has
    to change. 'values' and 'deductions' are parallel arrays aligned to
    date_labels (the same date axis the orders sheet already uses):
      - period == 'mtd': each label is one calendar day; value is that day's
        present flag (0/1, capped — a person can't be >1 present on one day).
      - period in ('weekly','monthly'): each label is a period-end/period-
        start marker; value is the SUM of present-days across that whole
        period (matches how the old Weekly/Monthly Know tabs pre-aggregated)."""
    by_store = {}
    for i, label in enumerate(date_labels):
        if period == 'mtd':
            day_list = [label]
        elif period == 'weekly':
            end = datetime.strptime(label[:10], '%Y-%m-%d').date()
            day_list = [(end - timedelta(days=k)).isoformat() for k in range(6, -1, -1)]
        else:  # monthly
            y, m = int(label[:4]), int(label[5:7])
            last_day = calendar.monthrange(y, m)[1]
            day_list = [f'{y}-{m:02d}-{d:02d}' for d in range(1, last_day + 1)]

        for ds in day_list:
            for rec in archived_by_date.get(ds, []):
                vid, sid = rec['vendorId'], rec['shopperId']
                store = by_store.setdefault(vid, {})
                pk = store.setdefault(sid, {
                    'shopperId': sid, 'name': rec['name'], 'userType': rec['userType'],
                    'department': rec['department'],
                    'values': [0] * len(date_labels), 'deductions': [0] * len(date_labels),
                })
                if period == 'mtd':
                    pk['values'][i]     = min(1, pk['values'][i] + rec['present'])
                    pk['deductions'][i] = min(1, pk['deductions'][i] + (rec['present'] and rec['deduction']))
                else:
                    pk['values'][i]     += rec['present']
                    pk['deductions'][i] += (rec['present'] and rec['deduction'])

    return {
        'dates': date_labels,
        'byStore': {vid: list(pk_map.values()) for vid, pk_map in by_store.items()},
        'isMonthly': period == 'monthly',
    }

def read_master_data(gc):
    print('  reading master data...')
    sh = gc.open_by_key(SHEET_IDS['master'])
    ws = sh.worksheet('Master Data Champions')
    data = ws.get_all_values()
    if len(data) < 2: return {}
    headers = [str(c).strip().lower().replace(' ', '_') for c in data[0]]

    def col(names):
        for n in names:
            try: return headers.index(n)
            except ValueError: pass
        return -1

    c = {
        'name':       col(['name', 'champion', 'champion_name']),
        'supervisor': col(['supervisor', 'supervisor_name']),
        'emirates':   col(['emirates', 'emirate', 'city']),
        'chainName':  col(['chain_name', 'chain_nam', 'chain']),
        'vendorId':   col(['vendor_id']),
        'vendorName': col(['vendor_name', 'vendor_nam', 'store_name', 'location_name']),
        'lat':        col(['latitude', 'lat']),
        'lng':        col(['longitude', 'lng', 'long']),
    }
    master = {}
    for row in data[1:]:
        vid = str(row[c['vendorId']]).strip() if c['vendorId'] >= 0 else ''
        if not vid or vid.lower() == 'undefined': continue
        def g(k): return str(row[c[k]]).strip() if c[k] >= 0 and c[k] < len(row) else ''
        try: lat = float(g('lat')) if g('lat') else None
        except: lat = None
        try: lng = float(g('lng')) if g('lng') else None
        except: lng = None
        master[vid] = {
            'champion':  g('name'), 'supervisor': g('supervisor'),
            'emirates':  g('emirates'), 'chainName': g('chainName'),
            'storeName': g('vendorName'), 'lat': lat, 'lng': lng,
        }
    return master

def read_hourly_data(gc):
    """Read hourly orders, GMV and store timing from the hourly sheet.
    Sheet1 = Avg daily orders per hour, Sheet2 = GMV per hour, Sheet3 = store timing.
    Columns: Chain ID, Chain Name, Vendor ID, Vendor Name, then hour 0..23
    """
    print('  reading hourly data...')
    try:
        sh = gc.open_by_key(SHEET_IDS['hourly'])
        sheets = {ws.title: ws for ws in sh.worksheets()}

        def read_hourly_tab(tab_name):
            if tab_name not in sheets:
                print(f'    tab {tab_name} not found')
                return {}
            data = sheets[tab_name].get_all_values()
            # Row 0: header labels, Row 1: hour numbers (0-23), data from row 2
            if len(data) < 3: return {}
            # Find vendor id column
            header_row = [str(c).strip().lower() for c in data[1]]
            c_vid = find_col(header_row, ['vendor id', 'vendorid', 'vendor_id'])
            if c_vid < 0:
                header_row = [str(c).strip().lower() for c in data[0]]
                c_vid = find_col(header_row, ['vendor id', 'vendorid', 'vendor_id'])
                data_start = 1
            else:
                data_start = 2

            # Find hour columns — row that has 0,1,2...23
            hour_col_map = {}
            for r in range(min(3, len(data))):
                for ci, val in enumerate(data[r]):
                    try:
                        h = int(str(val).strip())
                        if 0 <= h <= 23:
                            hour_col_map[h] = ci
                    except: pass
                if len(hour_col_map) >= 20: break

            result = {}
            for row in data[data_start:]:
                vid = str(row[c_vid]).strip() if c_vid >= 0 and c_vid < len(row) else ''
                if not vid or not vid.isdigit(): continue
                hourly = {}
                for h, ci in hour_col_map.items():
                    if ci < len(row):
                        try: hourly[h] = float(str(row[ci]).replace(',', '')) if row[ci].strip() else 0
                        except: hourly[h] = 0
                result[vid] = hourly
            print(f'    {tab_name}: {len(result)} stores')
            return result

        orders_hourly = read_hourly_tab('Sheet1')
        gmv_hourly    = read_hourly_tab('Sheet2')

        # Sheet3 = store timing: Vendor ID, Vendor Name, Day of Week, Schedule End Time, Schedule Start Time, Shift Duration
        timing = {}
        if 'Sheet3' in sheets:
            data = sheets['Sheet3'].get_all_values()
            if len(data) >= 2:
                # Find header row
                for hr in range(min(3, len(data))):
                    hl = [str(c).strip().lower() for c in data[hr]]
                    c_vid   = find_col(hl, ['vendor id', 'vendorid'])
                    c_day   = find_col(hl, ['local schedule start at day of week', 'day of week'])
                    c_start = find_col(hl, ['local schedule start at time', 'schedule start', 'start time', 'open'])
                    c_end   = find_col(hl, ['local schedule ends at time', 'schedule end', 'end time', 'close'])
                    if c_vid >= 0 and (c_start >= 0 or c_end >= 0):
                        data_start = hr + 1
                        break
                else:
                    c_vid, c_day, c_start, c_end, data_start = 0, 3, 5, 4, 1

                def extract_hr(s):
                    m = re.search(r'(\d{1,2}):(\d{2})', str(s))
                    if m: return int(m.group(1)) + int(m.group(2)) / 60
                    return None

                def snap(h, direction):
                    base = int(h)
                    half = base + 0.5
                    if direction == 'up':
                        if h <= base: return base
                        if h <= half: return half
                        return base + 1
                    else:
                        if h >= base + 0.5: return base + 0.5
                        return base

                # Accumulate every day-of-week row per store (not just the first) — merge
                # split-shift rows for the same day by widening to their combined span.
                day_spans = {}
                for row in data[data_start:]:
                    vid = str(row[c_vid]).strip() if c_vid < len(row) else ''
                    if not vid or not vid.isdigit(): continue
                    day = str(row[c_day]).strip() if c_day >= 0 and c_day < len(row) else ''
                    op_raw = row[c_start] if c_start >= 0 and c_start < len(row) else ''
                    cl_raw = row[c_end]   if c_end   >= 0 and c_end   < len(row) else ''
                    op = extract_hr(op_raw)
                    cl = extract_hr(cl_raw)
                    if op is None or cl is None: continue
                    key = day if day else '_default'
                    spans = day_spans.setdefault(vid, {})
                    if key in spans:
                        prev_op, prev_cl = spans[key]
                        spans[key] = (min(prev_op, op), max(prev_cl, cl))
                    else:
                        spans[key] = (op, cl)

                for vid, spans in day_spans.items():
                    by_day = {}
                    best_day, best_dur = None, -1
                    for day, (op, cl) in spans.items():
                        sn_open, sn_close = snap(op, 'up'), snap(cl, 'down')
                        by_day[day] = {'openHr': sn_open, 'closeHr': sn_close}
                        dur = sn_close - sn_open
                        if dur > best_dur:
                            best_dur, best_day = dur, day
                    entry = {'openHr': by_day[best_day]['openHr'], 'closeHr': by_day[best_day]['closeHr']}
                    if best_day != '_default':
                        entry['byDay'] = by_day
                    timing[vid] = entry
                print(f'    Sheet3 timing: {len(timing)} stores')

        return {'orders': orders_hourly, 'gmv': gmv_hourly, 'timing': timing}
    except Exception as e:
        print(f'  warning: hourly data failed — {e}')
        import traceback; traceback.print_exc()
        return {'orders': {}, 'gmv': {}, 'timing': {}}

# ── CPO Engine ───────────────────────────────────────────────────
def compute_cpo(period, date_index, orders, attend, master, cfg, is_mtd=False):
    dates      = orders.get('dates', [])
    attend_dates = attend.get('dates', [])
    if not dates: return {'error': 'No dates'}

    ref_date = dates[0] if is_mtd else (dates[date_index] if date_index < len(dates) else dates[0])
    dp = ref_date[:7].split('-')
    year, month = int(dp[0]), int(dp[1])

    work_days_overrides = {o['key']: o['days'] for o in cfg.get('working_days', [])} if isinstance(cfg.get('working_days'), list) else cfg.get('working_days', {})
    work_days = get_working_days(month, year, work_days_overrides)

    vendor_rates  = cfg.get('vendor_rates', [])
    emp_costs     = cfg.get('employee_costs', [])
    opt_cfg       = cfg.get('optimizer', {})
    holiday_dates = {h['date'] for h in cfg.get('holidays', [])}
    ramadan_cfg   = cfg.get('ramadan', {})
    ramadan_start = ramadan_cfg.get('start', '')
    ramadan_end   = ramadan_cfg.get('end',   '')
    ramadan_set   = {dl for dl in dates if ramadan_start and ramadan_end and ramadan_start <= dl <= ramadan_end}

    champ_entry = resolve_effective_emp(emp_costs, month, year, 'Champion')
    sup_entry   = resolve_effective_emp(emp_costs, month, year, 'City Supervisor')
    champ_cost  = champ_entry['baseCost'] if champ_entry else 0
    sup_cost    = sup_entry['baseCost']   if sup_entry   else 0

    # Build vendor rate map
    vendor_map = {}
    for r in vendor_rates:
        nm = normalize_dept(r.get('vendorName', ''))
        vr = resolve_effective_rate(vendor_rates, month, year, nm)
        if vr and nm not in vendor_map:
            ot_m = vr.get('otMultiplier', 1.5)
            vendor_map[nm] = {
                'rate':           vr.get('baseRate', 2750),
                'hours':          vr.get('hoursPerDay', 10),
                'ot_mult':        ot_m,
                'ramadan_hours':  vr.get('ramadanHours', vr.get('hoursPerDay', 10)),
                'ramadan_ot':     vr.get('ramadanOT', False),
                'holiday_ot':     vr.get('holidayOT', True),
                'holiday_ot_mult': vr.get('holidayOTMult', ot_m),
            }

    attend_date_map = {d: i for i, d in enumerate(attend_dates)}

    # MTD valid date set: only dates where BOTH orders > 0 AND attendance > 0
    valid_date_set = set()
    if is_mtd:
        order_stores = orders.get('stores', {})
        attend_stores = attend.get('byStore', {})
        for di, dl in enumerate(dates):
            a_idx = attend_date_map.get(dl)
            if a_idx is None: continue
            total_o = sum(s['values'][di] for s in order_stores.values() if di < len(s['values']))
            if total_o == 0: continue
            total_a = 0
            for pickers in attend_stores.values():
                for pk in pickers:
                    total_a += pk['values'][a_idx] if a_idx < len(pk['values']) else 0
                if total_a > 0: break
            if total_a > 0:
                valid_date_set.add(dl)

    # Champion/supervisor allocation maps
    champ_store_count = {}
    sup_champions = {}
    for vid, m in master.items():
        champ = m.get('champion', '')
        sup   = m.get('supervisor', '')
        if champ: champ_store_count[champ] = champ_store_count.get(champ, 0) + 1
        if sup and champ:
            if sup not in sup_champions: sup_champions[sup] = set()
            sup_champions[sup].add(champ)

    all_ids = set(orders.get('stores', {}).keys()) | set(attend.get('byStore', {}).keys())
    results = []

    for vendor_id in all_ids:
        so = orders.get('stores', {}).get(vendor_id)
        sp = attend.get('byStore', {}).get(vendor_id)
        mi = master.get(vendor_id, {})

        # Total orders
        total_orders = 0
        if so:
            if is_mtd:
                total_orders = sum(so['values'][di] for di, dl in enumerate(dates) if dl in valid_date_set and di < len(so['values']))
            elif date_index < len(so.get('values', [])):
                total_orders = so['values'][date_index]

        picker_cost = 0
        picker_count = 0
        total_present = 0
        total_hours = 0
        total_deduction_days = 0
        total_deduction_cost = 0
        dept_set = set()
        picker_days_list = []
        daily_counts = {}
        by_vendor = {}  # vendor name -> {cost, pickerCount, presentDays} -- true per-vendor
                        # attribution (built from the same per-picker loop below), used for
                        # vendor-level rollups so multi-vendor stores don't get double-counted.

        if sp:
            for pk in sp:
                if str(pk.get('userType', 'Picker')).strip().lower() != 'picker': continue
                dept = normalize_dept(pk.get('department', ''))
                vm = vendor_map.get(dept, {'rate': 2750, 'hours': 10})
                rate, v_hours = vm['rate'], vm['hours']

                present = 0
                hol_days = 0
                ram_days = 0
                deduction_days = 0
                if is_mtd:
                    for di, dl in enumerate(dates):
                        if dl not in valid_date_set: continue
                        a_idx = attend_date_map.get(dl)
                        if a_idx is not None and a_idx < len(pk['values']):
                            day_val = pk['values'][a_idx]
                            if day_val > 0:
                                if dl in holiday_dates:
                                    hol_days += day_val
                                elif dl in ramadan_set:
                                    ram_days += day_val
                                else:
                                    present += day_val
                                daily_counts[dl] = daily_counts.get(dl, 0) + 1
                                ded_arr = pk.get('deductions', [])
                                if a_idx < len(ded_arr):
                                    deduction_days += ded_arr[a_idx]
                else:
                    target_date = dates[date_index] if date_index < len(dates) else None
                    a_idx = attend_date_map.get(target_date)
                    if a_idx is not None and a_idx < len(pk['values']):
                        day_val = pk['values'][a_idx]
                        if day_val > 0:
                            p_start, p_end = _period_date_range(period, target_date, year, month)
                            holidays_in_period = [h for h in holiday_dates if p_start <= h <= p_end]
                            if holidays_in_period:
                                # Weekly/Monthly totals don't tell us which specific days
                                # were worked, so assume any active picker also worked the
                                # holiday(s) in this period, capped at their actual presence.
                                hol_days = min(len(holidays_in_period), day_val)
                                present  = day_val - hol_days
                            elif target_date in ramadan_set:
                                ram_days = day_val
                            else:
                                present = day_val
                            ded_arr = pk.get('deductions', [])
                            if a_idx < len(ded_arr):
                                deduction_days = ded_arr[a_idx]

                total_p = present + hol_days + ram_days
                if total_p > 0:
                    daily_rate = rate / work_days
                    ot_mult    = vm.get('ot_mult', 1.5)
                    hol_extra  = hol_days * daily_rate * (vm.get('holiday_ot_mult', ot_mult) - 1) if vm.get('holiday_ot', True) else 0
                    ram_extra  = 0
                    hr_rate    = daily_rate / v_hours if v_hours > 0 else 0
                    if ram_days > 0 and vm.get('ramadan_ot'):
                        r_hrs     = vm.get('ramadan_hours', v_hours)
                        ram_extra = ram_days * max(0, r_hrs - v_hours) * hr_rate * ot_mult
                    # Late-start/early-leave rule: no pay for 1 hour on any day that
                    # triggered it (never more than 1 hour/day, and never more days
                    # of deduction than days actually present).
                    deduction_days = min(deduction_days, total_p)
                    deduction_cost = deduction_days * hr_rate
                    this_cost      = daily_rate * total_p + hol_extra + ram_extra - deduction_cost
                    picker_cost   += this_cost
                    picker_count  += 1
                    total_present += total_p
                    total_hours   += total_p * v_hours
                    total_deduction_days += deduction_days
                    total_deduction_cost += deduction_cost
                    dept_set.add(dept)
                    picker_days_list.append({'days': total_p, 'dept': dept, 'rate': rate, 'hours': v_hours})
                    bv = by_vendor.setdefault(dept, {'cost': 0, 'pickerCount': 0, 'presentDays': 0})
                    bv['cost']        += this_cost
                    bv['pickerCount'] += 1
                    bv['presentDays'] += total_p

        max_daily_pickers = 1
        if is_mtd and daily_counts:
            max_daily_pickers = max(daily_counts.values())
        elif not is_mtd:
            max_daily_pickers = picker_count

        # Reliever detection
        max_picker_days = max((p['days'] for p in picker_days_list), default=0)
        period_days_rel = max_picker_days if max_picker_days > 0 else work_days
        rel_thr = opt_cfg.get('relieverAttendancePct', 25)
        relievers = [p for p in picker_days_list if period_days_rel > 0 and p['days'] / period_days_rel < rel_thr / 100]
        reliever_info = {
            'hasReliever':       len(picker_days_list) >= 2 and len(relievers) > 0,
            'relieverCount':     len(relievers),
            'regularPickerCount': len(picker_days_list) - len(relievers),
        }

        chain_name  = (so or {}).get('chainName', '') or mi.get('chainName', '')
        vendor_name = (so or {}).get('vendorName', '') or mi.get('storeName', '') or vendor_id
        champion    = mi.get('champion', '')
        supervisor  = mi.get('supervisor', '')
        city        = mi.get('emirates', '')

        # Allocations
        period_days_alloc = len(valid_date_set) if is_mtd else (1 if period == 'mtd' else (7 if period == 'weekly' else work_days))
        champ_alloc = (champ_cost / champ_store_count[champion]) * (period_days_alloc / work_days) if champion and champ_store_count.get(champion) else 0
        sup_total   = sum(champ_store_count.get(c, 0) for c in sup_champions.get(supervisor, set()))
        sup_alloc   = (sup_cost / sup_total) * (period_days_alloc / work_days) if supervisor and sup_total > 0 else 0

        loaded_cost = picker_cost + champ_alloc + sup_alloc
        picker_cpo  = picker_cost / total_orders if total_orders > 0 else 0
        loaded_cpo  = loaded_cost / total_orders if total_orders > 0 else 0
        utr         = total_orders / total_hours if total_hours > 0 and total_orders > 0 else 0

        if total_orders > 0 or picker_count > 0:
            results.append({
                'vendorId': vendor_id, 'storeName': vendor_name,
                'chain': chain_name, 'city': city,
                'supervisor': supervisor, 'champion': champion,
                'dept3pl': ', '.join(sorted(dept_set)),
                'pickerCount': picker_count, 'maxDailyPickers': max_daily_pickers,
                'presentDays': round(total_present, 2),
                'orders': round(total_orders, 1),
                'pickerCost':  round(picker_cost),
                'pickerCPO':   round(picker_cpo, 2),
                'loadedCost':  round(loaded_cost),
                'loadedCPO':   round(loaded_cpo, 2),
                'champAlloc':  round(champ_alloc),
                'supAlloc':    round(sup_alloc),
                'utr':         round(utr, 1),
                'lateEarlyDeductionDays': round(total_deduction_days, 2),
                'lateEarlyDeductionCost': round(total_deduction_cost),
                'relieverInfo': reliever_info,
                'byVendor': {v: {'cost': round(d['cost']), 'pickerCount': d['pickerCount'],
                                  'presentDays': round(d['presentDays'], 2)}
                             for v, d in by_vendor.items()},
            })

    # MTD last valid date
    mtd_last_date = dates[0] if dates else ''
    if is_mtd:
        for dl in reversed(dates):
            if dl in valid_date_set:
                mtd_last_date = dl
                break

    results.sort(key=lambda x: -x['orders'])
    return {
        'period': period, 'dateIndex': date_index,
        'dateLabel': f'MTD ({dates[0]} to {mtd_last_date})' if is_mtd else (dates[date_index] if date_index < len(dates) else ''),
        'dates': dates, 'month': month, 'year': year,
        'workingDays': work_days, 'totalStores': len(results), 'data': results,
        'syncDate': mtd_last_date if is_mtd else None,
    }

# ── Main ─────────────────────────────────────────────────────────
def main():
    print('CPO Compute starting...')
    gc  = get_client()
    cfg = load_config()

    # 1. Read all raw data from Sheets
    print('Reading Sheets...')
    master = read_master_data(gc)
    raw = {}
    for period in ('mtd', 'weekly', 'monthly'):
        raw[period] = {'orders': read_order_data(gc, period)}

    # Attendance: one flat shift-log sheet + a permanent per-day archive,
    # instead of the old MTD/Weekly/Monthly Know pivot tabs. The live sheet
    # only needs to hold a rolling window (~40-50 days) — everything older
    # is safe because it's already frozen in data/daily_attendance/.
    attendance_log = read_daily_attendance_log(gc)
    archive_daily_attendance(attendance_log)
    archive_files = glob.glob(os.path.join(DAILY_ARCHIVE_DIR, '*.json'))
    known_days = sorted(os.path.splitext(os.path.basename(f))[0] for f in archive_files)
    archived_by_date = load_archived_days(known_days[0], known_days[-1]) if known_days else {}

    for period in ('mtd', 'weekly', 'monthly'):
        date_labels = raw[period]['orders'].get('dates', [])
        raw[period]['attend'] = build_attend_struct(archived_by_date, date_labels, period)

    hourly_data = read_hourly_data(gc)

    # 2. Save raw cache files (for archive/debug)
    save_json('raw_master.json', master)
    for period in ('mtd', 'weekly', 'monthly'):
        save_json(f'raw_orders_{period}.json', raw[period]['orders'])
        save_json(f'raw_attend_{period}.json', raw[period]['attend'])
    save_json('hourly.json',     hourly_data['orders'])
    save_json('hourly_gmv.json', hourly_data['gmv'])
    save_json('timing.json',     hourly_data['timing'])

    # 3. Compute MTD summary
    print('Computing MTD...')
    mtd_result = compute_cpo('mtd', -1, raw['mtd']['orders'], raw['mtd']['attend'], master, cfg, is_mtd=True)
    save_json('cpo_mtd_summary.json', mtd_result)

    # 4. Compute all daily dates
    dates_mtd = raw['mtd']['orders'].get('dates', [])
    print(f'Computing {len(dates_mtd)} daily dates...')
    for i, dl in enumerate(dates_mtd):
        r = compute_cpo('mtd', i, raw['mtd']['orders'], raw['mtd']['attend'], master, cfg, is_mtd=False)
        save_json(f'cpo_daily_{dl}.json', r)

    # 5. Compute all weekly dates
    dates_weekly = raw['weekly']['orders'].get('dates', [])
    print(f'Computing {len(dates_weekly)} weekly dates...')
    for i, dl in enumerate(dates_weekly):
        r = compute_cpo('weekly', i, raw['weekly']['orders'], raw['weekly']['attend'], master, cfg, is_mtd=False)
        save_json(f'cpo_weekly_{dl[:10]}.json', r)

    # 6. Compute all monthly dates
    dates_monthly = raw['monthly']['orders'].get('dates', [])
    print(f'Computing {len(dates_monthly)} monthly dates...')
    for i, dl in enumerate(dates_monthly):
        r = compute_cpo('monthly', i, raw['monthly']['orders'], raw['monthly']['attend'], master, cfg, is_mtd=False)
        save_json(f'cpo_monthly_{dl[:7]}.json', r)

    # 7. Write meta file — date lists, sync info, timestamp
    # Merge with any existing historical JSON files in data/ so old weeks/months
    # are never lost when the Google Sheet only returns recent data.
    # (glob and re are already imported at module level — no local import here,
    # since a local `import glob` would shadow the module-level one for the
    # ENTIRE function, breaking the earlier glob.glob() call above.)
    def _collect_existing(pattern):
        found = set()
        for f in glob.glob(os.path.join(DATA_DIR, pattern)):
            m = re.search(r'(\d{4}-\d{2}-\d{2})', os.path.basename(f))
            if m:
                found.add(m.group(1))
        return sorted(found)

    existing_weekly  = _collect_existing('cpo_weekly_*.json')
    existing_monthly = _collect_existing('cpo_monthly_*.json')
    all_weekly  = sorted(set(existing_weekly)  | set(d[:10] for d in dates_weekly))
    all_monthly = sorted(set(d[:7]+'-01' for d in existing_monthly) | set(d[:10] for d in dates_monthly))

    now = datetime.utcnow().isoformat() + 'Z'
    meta = {
        'timestamp': now,
        'syncDate':  mtd_result.get('syncDate'),
        'dates': {
            'mtd':     dates_mtd,
            'weekly':  all_weekly,
            'monthly': all_monthly,
        },
    }
    save_json('meta.json', meta)

    print(f'Done. {len(dates_mtd) + len(dates_weekly) + len(dates_monthly) + 1} files written.')

if __name__ == '__main__':
    main()

"""
talabat LS — CPO Compute Script
Reads Google Sheets → computes CPO/UTR → writes JSON files to data/
Run by GitHub Actions on schedule, or locally for testing.
"""
import json, os, math, re, sys
from datetime import datetime, date
from dateutil.relativedelta import relativedelta
import gspread
from google.oauth2.service_account import Credentials

# ── Sheet IDs ────────────────────────────────────────────────────
SHEET_IDS = {
    'orders':     '1mDnzwA0fycVbo-1hIxvKzoLoi5U8pv12I6Fazq8CKOI',
    'attendance': '1LRlCJbv7nnabo_doQ2VAP4jMl80fF-ZpLcsqIE6FO9w',
    'master':     '10swg2HotxTSmIMPGQt6AxARFQyfTbvt7504tFjysmGs',
    'hourly':     '1n4GopL6gSsSw_sauMkHKVfcF6IDYI84skyGMdfC4hqA',
}
# Sheet tabs for hourly/timing sheet:
# Sheet1 = Hourly GMV (Chain ID, Chain Name, Vendor ID, Vendor Name, then cols 0-23 = GMV per hour)
# Sheet2 = Hourly Orders (Chain ID, Chain Name, Vendor ID, Vendor Name, then cols 0-23 = avg daily orders per hour)
# Sheet3 = Store timing (Vendor ID, Vendor Name, Day of Week, Schedule End, Schedule Start, Shift Hours)
ORDER_TABS  = {'mtd': 'MTD Order',  'weekly': 'Weekly Order',  'monthly': 'Monthly Order'}
ATTEND_TABS = {'mtd': 'MTD Know',   'weekly': 'Weekly Know',   'monthly': 'Monthly Know'}

DATA_DIR   = os.path.join(os.path.dirname(__file__), '..', 'data')
CONFIG_DIR = os.path.join(os.path.dirname(__file__), '..', 'config')

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
def normalize_dept(s):
    return re.sub(r'\s+', ' ', str(s or '').strip().lower())

def normalize_date(v):
    if isinstance(v, (datetime, date)):
        return v.strftime('%Y-%m-%d')
    s = str(v).strip()
    if re.match(r'^\d{4}-\d{2}-\d{2}$', s): return s
    if re.match(r'^\d{4}-\d{2}$', s): return s + '-01'
    return s

def find_col(headers, names):
    hl = [str(h).strip().lower() for h in headers]
    for n in names:
        try: return hl.index(n)
        except ValueError: pass
    return -1

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

def read_attendance_data(gc, period):
    print(f'  reading attendance {period}...')
    sh = gc.open_by_key(SHEET_IDS['attendance'])
    ws = sh.worksheet(ATTEND_TABS[period])
    data = ws.get_all_values()
    if len(data) < 3: return {'dates': [], 'byStore': {}, 'isMonthly': period == 'monthly'}

    date_row, start_col = find_date_row(data)
    if date_row is None: return {'dates': [], 'byStore': {}, 'isMonthly': period == 'monthly'}
    dates = extract_dates(data, date_row, start_col)

    hr = date_row + 1
    if hr >= len(data): hr = 1
    headers = data[hr]
    c_name  = find_col(headers, ['employee name'])
    c_type  = find_col(headers, ['user type'])
    c_dept  = find_col(headers, ['department', 'dept', '3pl'])
    c_sid   = find_col(headers, ['shopper id'])
    c_bid   = find_col(headers, ['shift branch id'])

    by_store = {}
    for row in data[hr + 1:]:
        bid = str(row[c_bid]).strip() if c_bid >= 0 and c_bid < len(row) else ''
        sid = str(row[c_sid]).strip() if c_sid >= 0 and c_sid < len(row) else ''
        if not bid or not sid: continue
        values = []
        for col, _ in dates:
            try:
                raw = float(str(row[col]).replace(',', '')) if col < len(row) else 0
            except: raw = 0
            if period == 'mtd' and raw >= 1: raw = 1
            values.append(raw)
        if bid not in by_store: by_store[bid] = []
        by_store[bid].append({
            'shopperId':  sid,
            'name':       str(row[c_name]).strip()  if c_name >= 0 and c_name < len(row) else '',
            'userType':   str(row[c_type]).strip()  if c_type >= 0 and c_type < len(row) else 'Picker',
            'department': str(row[c_dept]).strip()  if c_dept >= 0 and c_dept < len(row) else '',
            'values':     values,
        })
    return {'dates': [d for _, d in dates], 'byStore': by_store, 'isMonthly': period == 'monthly'}

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
    Sheet1 = GMV per hour, Sheet2 = Avg daily orders per hour, Sheet3 = store timing.
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

        orders_hourly = read_hourly_tab('Sheet2')
        gmv_hourly    = read_hourly_tab('Sheet1')

        # Sheet3 = store timing: Vendor ID, Vendor Name, Day of Week, Schedule End Time, Schedule Start Time, Shift Duration
        timing = {}
        if 'Sheet3' in sheets:
            data = sheets['Sheet3'].get_all_values()
            if len(data) >= 2:
                # Find header row
                for hr in range(min(3, len(data))):
                    hl = [str(c).strip().lower() for c in data[hr]]
                    c_vid   = find_col(hl, ['vendor id', 'vendorid'])
                    c_start = find_col(hl, ['local schedule start at time', 'schedule start', 'start time', 'open'])
                    c_end   = find_col(hl, ['local schedule ends at time', 'schedule end', 'end time', 'close'])
                    if c_vid >= 0 and (c_start >= 0 or c_end >= 0):
                        data_start = hr + 1
                        break
                else:
                    c_vid, c_start, c_end, data_start = 0, 5, 4, 1

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

                seen = set()
                for row in data[data_start:]:
                    vid = str(row[c_vid]).strip() if c_vid < len(row) else ''
                    if not vid or not vid.isdigit() or vid in seen: continue
                    seen.add(vid)
                    op_raw = row[c_start] if c_start >= 0 and c_start < len(row) else ''
                    cl_raw = row[c_end]   if c_end   >= 0 and c_end   < len(row) else ''
                    op = extract_hr(op_raw)
                    cl = extract_hr(cl_raw)
                    if op is not None and cl is not None:
                        timing[vid] = {'openHr': snap(op, 'up'), 'closeHr': snap(cl, 'down')}
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

    vendor_rates = cfg.get('vendor_rates', [])
    emp_costs    = cfg.get('employee_costs', [])
    opt_cfg      = cfg.get('optimizer', {})

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
            vendor_map[nm] = {
                'rate':  vr.get('baseRate', 2750),
                'hours': vr.get('hoursPerDay', 10),
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
        dept_set = set()
        picker_days_list = []
        daily_counts = {}

        if sp:
            for pk in sp:
                if str(pk.get('userType', 'Picker')).strip().lower() != 'picker': continue
                dept = normalize_dept(pk.get('department', ''))
                vm = vendor_map.get(dept, {'rate': 2750, 'hours': 10})
                rate, v_hours = vm['rate'], vm['hours']

                present = 0
                if is_mtd:
                    for di, dl in enumerate(dates):
                        if dl not in valid_date_set: continue
                        a_idx = attend_date_map.get(dl)
                        if a_idx is not None and a_idx < len(pk['values']):
                            day_val = pk['values'][a_idx]
                            present += day_val
                            if day_val > 0:
                                daily_counts[dl] = daily_counts.get(dl, 0) + 1
                else:
                    target_date = dates[date_index] if date_index < len(dates) else None
                    a_idx = attend_date_map.get(target_date)
                    if a_idx is not None and a_idx < len(pk['values']):
                        present = pk['values'][a_idx]

                if present > 0:
                    picker_cost += (rate / work_days) * present
                    picker_count += 1
                    total_present += present
                    total_hours += present * v_hours
                    dept_set.add(dept)
                    picker_days_list.append({'days': present, 'dept': dept, 'rate': rate, 'hours': v_hours})

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
        period_days_alloc = len(dates) if is_mtd else (1 if period == 'mtd' else (7 if period == 'weekly' else work_days))
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
                'relieverInfo': reliever_info,
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
        raw[period] = {
            'orders': read_order_data(gc, period),
            'attend': read_attendance_data(gc, period),
        }
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
    now = datetime.utcnow().isoformat() + 'Z'
    meta = {
        'timestamp': now,
        'syncDate':  mtd_result.get('syncDate'),
        'dates': {
            'mtd':     dates_mtd,
            'weekly':  dates_weekly,
            'monthly': dates_monthly,
        },
    }
    save_json('meta.json', meta)

    print(f'Done. {len(dates_mtd) + len(dates_weekly) + len(dates_monthly) + 1} files written.')

if __name__ == '__main__':
    main()

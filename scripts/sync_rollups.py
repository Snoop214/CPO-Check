"""
talabat LS — CPO Rollup Sync
Reads the Weekly/Monthly per-store CPO files already produced by compute.py
(data/cpo_weekly_*.json, data/cpo_monthly_*.json) and rolls them up into
Chain-level and Vendor(3PL)-level tables, written into 4 filterable tabs of
the "CPO Working Sheet" Google Sheet:
    Chain Weekly | Chain Monthly | Vendor Weekly | Vendor Monthly

Run after compute.py in the same GitHub Actions job (reuses the same
GOOGLE_CREDENTIALS_JSON service account, which must be shared as Editor on
the CPO Working Sheet).

No Daily/MTD rollups — weekly and monthly only, per requirement.

Vendor-level note: pickerCost/pickerCount/presentDays are attributed
per-vendor exactly (built from compute.py's per-picker loop — see
`byVendor` on each store row). Orders cannot be split per-vendor at the
source (Order sheet is store-level only, not per-picker), so for the rare
store serviced by more than one 3PL, that store's full order count is
credited to each of its vendors. This only affects a handful of
multi-vendor stores; it's a known approximation, not a bug.
"""
import glob, json, os, re

import gspread
from google.oauth2.service_account import Credentials

# Needs write access (compute.py's own get_client() is read-only, since it
# never writes) -- separate scopes/client here rather than widening
# compute.py's credentials beyond what it actually needs.
WRITE_SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
]

def get_write_client():
    creds_json = os.environ.get('GOOGLE_CREDENTIALS_JSON')
    if creds_json:
        info = json.loads(creds_json)
    else:
        path = os.path.join(os.path.dirname(__file__), 'credentials.json')
        with open(path) as f:
            info = json.load(f)
    creds = Credentials.from_service_account_info(info, scopes=WRITE_SCOPES)
    return gspread.authorize(creds)

ROLLUP_SHEET_ID = '1_U-fuU39uJHr-1GQqAJ6guh00zPV9KkTfSZzFIQBuxI'  # "CPO Working Sheet"
DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data')

CHAIN_HEADER  = ['Period', 'Period Type', 'Chain', 'Stores', 'Pickers', 'Present Days',
                  'Orders', 'Picker Cost (AED)', 'Picker CPO', 'Loaded Cost (AED)', 'Loaded CPO']
VENDOR_HEADER = ['Period', 'Period Type', 'Vendor (3PL)', 'Stores', 'Pickers', 'Present Days',
                  'Orders*', 'Cost (AED)', 'CPO']


def load_period_files(pattern, label_from_name):
    files = sorted(glob.glob(os.path.join(DATA_DIR, pattern)))
    out = []
    for f in files:
        base = os.path.basename(f)
        label = label_from_name(base)
        if not label:
            continue
        try:
            d = json.load(open(f))
        except Exception as e:
            print(f'  skip {base}: {e}')
            continue
        out.append((label, d.get('data', [])))
    return out


def build_chain_rows(period_label, period_type, store_rows):
    agg = {}
    for r in store_rows:
        chain = (r.get('chain') or 'Unknown').strip() or 'Unknown'
        a = agg.setdefault(chain, {'stores': 0, 'pickers': 0, 'presentDays': 0.0,
                                     'orders': 0.0, 'pickerCost': 0, 'loadedCost': 0})
        a['stores']      += 1
        a['pickers']     += r.get('pickerCount', 0)
        a['presentDays'] += r.get('presentDays', 0) or 0
        a['orders']      += r.get('orders', 0) or 0
        a['pickerCost']  += r.get('pickerCost', 0) or 0
        a['loadedCost']  += r.get('loadedCost', 0) or 0
    rows = []
    for chain in sorted(agg):
        a = agg[chain]
        picker_cpo = a['pickerCost'] / a['orders'] if a['orders'] else 0
        loaded_cpo = a['loadedCost'] / a['orders'] if a['orders'] else 0
        rows.append([period_label, period_type, chain, a['stores'], a['pickers'],
                     round(a['presentDays'], 1), round(a['orders'], 1),
                     round(a['pickerCost']), round(picker_cpo, 2),
                     round(a['loadedCost']), round(loaded_cpo, 2)])
    return rows


def build_vendor_rows(period_label, period_type, store_rows):
    agg = {}
    for r in store_rows:
        bv = r.get('byVendor') or {}
        if not bv:
            continue
        store_orders = r.get('orders', 0) or 0
        for vendor, d in bv.items():
            vendor = (vendor or 'Unknown').strip() or 'Unknown'
            a = agg.setdefault(vendor, {'stores': set(), 'pickers': 0, 'presentDays': 0.0,
                                          'cost': 0, 'orders': 0.0})
            a['stores'].add(r.get('vendorId'))
            a['pickers']     += d.get('pickerCount', 0)
            a['presentDays'] += d.get('presentDays', 0) or 0
            a['cost']        += d.get('cost', 0) or 0
            a['orders']      += store_orders  # see module docstring re: multi-vendor stores
    rows = []
    for vendor in sorted(agg):
        a = agg[vendor]
        cpo = a['cost'] / a['orders'] if a['orders'] else 0
        rows.append([period_label, period_type, vendor, len(a['stores']), a['pickers'],
                     round(a['presentDays'], 1), round(a['orders'], 1),
                     round(a['cost']), round(cpo, 2)])
    return rows


def write_tab(sh, title, header, rows):
    print(f'  writing {title}: {len(rows)} rows')
    try:
        ws = sh.worksheet(title)
        ws.clear()
    except gspread.WorksheetNotFound:
        ws = sh.add_worksheet(title=title, rows=str(len(rows) + 20), cols=str(len(header) + 2))
    ws.update(values=[header] + rows, value_input_option='USER_ENTERED')
    try:
        ws.set_basic_filter()
    except Exception as e:
        print(f'  (filter not applied on {title}: {e})')
    try:
        ws.freeze(rows=1)
    except Exception as e:
        print(f'  (freeze not applied on {title}: {e})')


def main():
    print('Rollup sync starting...')
    gc = get_write_client()
    sh = gc.open_by_key(ROLLUP_SHEET_ID)

    weekly = load_period_files('cpo_weekly_*.json',
                                lambda b: (m.group(1) if (m := re.match(r'cpo_weekly_(\d{4}-\d{2}-\d{2})\.json', b)) else None))
    monthly = load_period_files('cpo_monthly_*.json',
                                 lambda b: (m.group(1) if (m := re.match(r'cpo_monthly_(\d{4}-\d{2})\.json', b)) else None))

    chain_weekly, chain_monthly = [], []
    vendor_weekly, vendor_monthly = [], []

    for label, rows in weekly:
        chain_weekly  += build_chain_rows(label, 'Weekly', rows)
        vendor_weekly += build_vendor_rows(label, 'Weekly', rows)
    for label, rows in monthly:
        chain_monthly  += build_chain_rows(label, 'Monthly', rows)
        vendor_monthly += build_vendor_rows(label, 'Monthly', rows)

    write_tab(sh, 'Chain Weekly',   CHAIN_HEADER,  chain_weekly)
    write_tab(sh, 'Chain Monthly',  CHAIN_HEADER,  chain_monthly)
    write_tab(sh, 'Vendor Weekly',  VENDOR_HEADER, vendor_weekly)
    write_tab(sh, 'Vendor Monthly', VENDOR_HEADER, vendor_monthly)

    print('Rollup sync done.')


if __name__ == '__main__':
    main()

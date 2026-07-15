// ============================================================
// talabat LS — CPO Check
// Standalone GAS Web App
// ============================================================

var ORDER_SHEET_ID = '1mDnzwA0fycVbo-1hIxvKzoLoi5U8pv12I6Fazq8CKOI';
var ATTENDANCE_SHEET_ID = '1LRlCJbv7nnabo_doQ2VAP4jMl80fF-ZpLcsqIE6FO9w';
var MASTER_DATA_SHEET_ID = '10swg2HotxTSmIMPGQt6AxARFQyfTbvt7504tFjysmGs';

var ORDER_TABS = { mtd: 'MTD Order', weekly: 'Weekly Order', monthly: 'Monthly Order' };
var ATTEND_TABS = { mtd: 'MTD Know', weekly: 'Weekly Know', monthly: 'Monthly Know' };

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Dashboard')
    .setTitle('talabat LS — CPO Check')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ============================================================
// CONFIG CRUD (PropertiesService with effective dating)
// ============================================================
function saveConfig(configType, entries) {
  PropertiesService.getScriptProperties().setProperty('cpo_config_' + configType, JSON.stringify(entries));
  return { success: true };
}

function loadConfig(configType) {
  var val = PropertiesService.getScriptProperties().getProperty('cpo_config_' + configType);
  return val ? JSON.parse(val) : [];
}

function loadAllConfig() {
  var types = ['vendor_rates', 'employee_costs', 'working_days', 'email_settings'];
  var props = PropertiesService.getScriptProperties();
  var result = {};
  var hasAny = false;
  for (var i = 0; i < types.length; i++) {
    var val = props.getProperty('cpo_config_' + types[i]);
    if (val) { result[types[i]] = JSON.parse(val); hasAny = true; }
    else { result[types[i]] = []; }
  }
  if (!hasAny) { initDefaultConfig(); return loadAllConfig(); }
  return result;
}

function addConfigEntry(configType, entry) {
  var entries = loadConfig(configType);
  entry.id = configType.substring(0, 2) + '_' + new Date().getTime() + '_' + Math.floor(Math.random() * 1000);
  entries.push(entry);
  saveConfig(configType, entries);
  return entries;
}

function updateConfigEntry(configType, entryId, updatedFields) {
  var entries = loadConfig(configType);
  for (var i = 0; i < entries.length; i++) {
    if (entries[i].id === entryId) {
      var keys = Object.keys(updatedFields);
      for (var j = 0; j < keys.length; j++) entries[i][keys[j]] = updatedFields[keys[j]];
      break;
    }
  }
  saveConfig(configType, entries);
  return entries;
}

function deleteConfigEntry(configType, entryId) {
  var entries = loadConfig(configType);
  var filtered = [];
  for (var i = 0; i < entries.length; i++) {
    if (entries[i].id !== entryId) filtered.push(entries[i]);
  }
  saveConfig(configType, filtered);
  return filtered;
}

function initDefaultConfig() {
  var props = PropertiesService.getScriptProperties();
  var vendorRates = [
    { id: 'vr_krh', vendorName: 'KRH', baseRate: 2750, effectiveStartMonth: 1, effectiveStartYear: 2025, effectiveEndMonth: null, effectiveEndYear: null },
    { id: 'vr_transguard', vendorName: 'Transguard', baseRate: 2574, effectiveStartMonth: 1, effectiveStartYear: 2025, effectiveEndMonth: null, effectiveEndYear: null },
    { id: 'vr_wesource', vendorName: 'WeSource', baseRate: 2780, effectiveStartMonth: 1, effectiveStartYear: 2025, effectiveEndMonth: null, effectiveEndYear: null },
    { id: 'vr_zone', vendorName: 'Zone', baseRate: 2780, effectiveStartMonth: 1, effectiveStartYear: 2025, effectiveEndMonth: null, effectiveEndYear: null },
    { id: 'vr_trumax', vendorName: 'Trumax', baseRate: 2780, effectiveStartMonth: 1, effectiveStartYear: 2025, effectiveEndMonth: null, effectiveEndYear: null },
    { id: 'vr_sanket', vendorName: 'Sanket', baseRate: 2750, effectiveStartMonth: 1, effectiveStartYear: 2025, effectiveEndMonth: null, effectiveEndYear: null },
    { id: 'vr_mtm', vendorName: 'MTM', baseRate: 2780, effectiveStartMonth: 1, effectiveStartYear: 2025, effectiveEndMonth: null, effectiveEndYear: null },
    { id: 'vr_jumbo', vendorName: 'Jumbo', baseRate: 2780, effectiveStartMonth: 1, effectiveStartYear: 2025, effectiveEndMonth: null, effectiveEndYear: null }
  ];
  props.setProperty('cpo_config_vendor_rates', JSON.stringify(vendorRates));

  var empCosts = [
    { id: 'ec_champion', role: 'Champion', baseCost: 6400, effectiveStartMonth: 1, effectiveStartYear: 2025, effectiveEndMonth: null, effectiveEndYear: null },
    { id: 'ec_supervisor', role: 'City Supervisor', baseCost: 8500, effectiveStartMonth: 1, effectiveStartYear: 2025, effectiveEndMonth: null, effectiveEndYear: null }
  ];
  props.setProperty('cpo_config_employee_costs', JSON.stringify(empCosts));
  props.setProperty('cpo_config_working_days', '[]');

  var emailSettings = [
    { id: 'es_weekly', type: 'weekly', enabled: true, dayOfWeek: 0, subject: 'Weekly CPO Performance Report', effectiveStartMonth: 1, effectiveStartYear: 2025, effectiveEndMonth: null, effectiveEndYear: null },
    { id: 'es_monthly', type: 'monthly', enabled: true, dayOfMonth: 1, subject: 'Monthly CPO Performance Report', effectiveStartMonth: 1, effectiveStartYear: 2025, effectiveEndMonth: null, effectiveEndYear: null }
  ];
  props.setProperty('cpo_config_email_settings', JSON.stringify(emailSettings));
  return { success: true };
}

// ============================================================
// EFFECTIVE DATE RESOLUTION
// ============================================================
function resolveEffectiveEntry(entries, month, year, matchField, matchValue) {
  var target = year * 12 + month;
  var best = null, bestStart = -1;
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    if (matchField && e[matchField] !== matchValue) continue;
    var start = e.effectiveStartYear * 12 + e.effectiveStartMonth;
    var end = (e.effectiveEndMonth === null || e.effectiveEndYear === null) ? Infinity : e.effectiveEndYear * 12 + e.effectiveEndMonth;
    if (target >= start && target <= end && start > bestStart) { best = e; bestStart = start; }
  }
  return best;
}

function getActiveRate(vendorName, month, year) {
  var entries = loadConfig('vendor_rates');
  var norm = normalizeDept(vendorName);
  for (var i = 0; i < entries.length; i++) {
    if (normalizeDept(entries[i].vendorName) === norm) entries[i]._norm = norm;
  }
  var match = resolveEffectiveEntry(entries, month, year, '_norm', norm);
  return match ? match.baseRate : 0;
}

function getActiveEmployeeCost(role, month, year) {
  var entries = loadConfig('employee_costs');
  var match = resolveEffectiveEntry(entries, month, year, 'role', role);
  return match ? match.baseCost : 0;
}

function getWorkingDays(month, year) {
  var entries = loadConfig('working_days');
  for (var i = 0; i < entries.length; i++) {
    if (entries[i].month === month && entries[i].year === year) return entries[i].workingDays;
  }
  var calDays = new Date(year, month, 0).getDate();
  return month === 2 ? 24 : (calDays === 31 ? 27 : 26);
}

function normalizeDept(dept) {
  if (!dept) return 'Other';
  var d = dept.trim().toUpperCase();
  if (d === 'KRH') return 'KRH';
  if (d === 'TRANSGUARD') return 'Transguard';
  if (d === 'TRUEMAX' || d === 'TRUMAX') return 'Trumax';
  if (d === 'WESOURCE') return 'WeSource';
  if (d === 'SANKET') return 'Sanket';
  if (d === 'ZONE') return 'Zone';
  if (d === 'MTM') return 'MTM';
  if (d === 'JUMBO') return 'Jumbo';
  return dept.trim();
}

// ============================================================
// DATA READERS
// ============================================================
function findHeaderRow(data, keywords) {
  for (var r = 0; r < Math.min(5, data.length); r++) {
    for (var c = 0; c < data[r].length; c++) {
      var v = String(data[r][c]).trim().toLowerCase();
      for (var k = 0; k < keywords.length; k++) {
        if (v === keywords[k]) return r;
      }
    }
  }
  return 1;
}

function findCol(headers, names) {
  for (var n = 0; n < names.length; n++) {
    for (var c = 0; c < headers.length; c++) {
      if (String(headers[c]).trim().toLowerCase() === names[n]) return c;
    }
  }
  return -1;
}

function findDateRow(data) {
  for (var r = 0; r < Math.min(5, data.length); r++) {
    for (var c = 0; c < data[r].length; c++) {
      var v = data[r][c];
      if (v instanceof Date) return { row: r, startCol: c };
      var s = String(v).trim();
      if (/^\d{4}-\d{2}(-\d{2})?$/.test(s)) return { row: r, startCol: c };
    }
  }
  return null;
}

function extractDates(data, dateInfo) {
  var dates = [];
  for (var c = dateInfo.startCol; c < data[dateInfo.row].length; c++) {
    var v = data[dateInfo.row][c];
    var s;
    if (v instanceof Date) {
      try { s = Utilities.formatDate(v, 'Asia/Dubai', 'yyyy-MM-dd'); } catch (e) { s = ''; }
    } else {
      s = String(v).trim();
    }
    if (s && /^\d{4}/.test(s)) dates.push({ col: c, label: s });
  }
  return dates;
}

function readOrderData(period) {
  var tabName = ORDER_TABS[period];
  var ss = SpreadsheetApp.openById(ORDER_SHEET_ID);
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) return { dates: [], stores: {} };
  var data = sheet.getDataRange().getValues();
  if (data.length < 3) return { dates: [], stores: {} };

  var dateInfo = findDateRow(data);
  if (!dateInfo) return { dates: [], stores: {} };
  var dates = extractDates(data, dateInfo);

  var headerRow = dateInfo.row + 1;
  if (headerRow >= data.length) headerRow = 1;
  var headers = data[headerRow];

  var colChainId = findCol(headers, ['chain id']);
  var colChainName = findCol(headers, ['chain name']);
  var colVendorId = findCol(headers, ['vendor id']);
  var colVendorName = findCol(headers, ['vendor name (english)', 'vendor name']);

  var stores = {};
  for (var r = headerRow + 1; r < data.length; r++) {
    var row = data[r];
    var vendorId = colVendorId >= 0 ? String(row[colVendorId]).trim() : '';
    if (!vendorId || vendorId === 'undefined' || vendorId === '') continue;

    var values = [];
    for (var d = 0; d < dates.length; d++) {
      var raw = row[dates[d].col];
      var num = parseFloat(String(raw).replace(/,/g, '')) || 0;
      values.push(num);
    }

    stores[vendorId] = {
      chainId: colChainId >= 0 ? String(row[colChainId]).trim() : '',
      chainName: colChainName >= 0 ? String(row[colChainName]).trim() : '',
      vendorName: colVendorName >= 0 ? String(row[colVendorName]).trim() : '',
      values: values
    };
  }

  return { dates: dates.map(function (d) { return d.label; }), stores: stores };
}

function readAttendanceData(period) {
  var tabName = ATTEND_TABS[period];
  var ss = SpreadsheetApp.openById(ATTENDANCE_SHEET_ID);
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) return { dates: [], byStore: {} };
  var data = sheet.getDataRange().getValues();
  if (data.length < 3) return { dates: [], byStore: {} };

  var dateInfo = findDateRow(data);
  if (!dateInfo) return { dates: [], byStore: {} };
  var dates = extractDates(data, dateInfo);

  var headerRow = dateInfo.row + 1;
  if (headerRow >= data.length) headerRow = 1;
  var headers = data[headerRow];

  var colName = findCol(headers, ['employee name']);
  var colType = findCol(headers, ['user type']);
  var colDept = findCol(headers, ['department', 'dept', '3pl']);
  var colShopperId = findCol(headers, ['shopper id']);
  var colBranchId = findCol(headers, ['shift branch id']);

  var byStore = {};
  for (var r = headerRow + 1; r < data.length; r++) {
    var row = data[r];
    var branchId = colBranchId >= 0 ? String(row[colBranchId]).trim() : '';
    var shopperId = colShopperId >= 0 ? String(row[colShopperId]).trim() : '';
    if (!branchId || !shopperId) continue;

    var values = [];
    for (var d = 0; d < dates.length; d++) {
      var raw = row[dates[d].col];
      var num = parseFloat(String(raw).replace(/,/g, '')) || 0;
      if (period === 'mtd' && num >= 1) num = 1;
      values.push(num);
    }

    if (!byStore[branchId]) byStore[branchId] = [];
    byStore[branchId].push({
      shopperId: shopperId,
      name: colName >= 0 ? String(row[colName]).trim() : '',
      userType: colType >= 0 ? String(row[colType]).trim() : 'Picker',
      department: colDept >= 0 ? String(row[colDept]).trim() : '',
      values: values
    });
  }

  return { dates: dates.map(function (d) { return d.label; }), byStore: byStore };
}

function readMasterData() {
  var ss = SpreadsheetApp.openById(MASTER_DATA_SHEET_ID);
  var sheet = ss.getSheetByName('Master Data Champions');
  if (!sheet) return {};
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return {};

  var h = data[0].map(function (c) { return String(c).trim().toLowerCase().replace(/\s+/g, '_'); });
  var cols = {
    name: findCol([data[0]], ['Name']) >= 0 ? findCol([data[0]], ['Name']) : idx(h, ['name', 'champion', 'champion_name']),
    supervisor: idx(h, ['supervisor', 'supervisor_name']),
    emirates: idx(h, ['emirates', 'emirate', 'city']),
    chainId: idx(h, ['chain_id']),
    chainName: idx(h, ['chain_name', 'chain_nam', 'chain']),
    vendorId: idx(h, ['vendor_id']),
    vendorName: idx(h, ['vendor_name', 'vendor_nam', 'store_name', 'location_name']),
    pickers: idx(h, ['pickers', 'picker_count', 'no._of_pickers'])
  };

  var master = {};
  for (var i = 1; i < data.length; i++) {
    var vid = cols.vendorId >= 0 ? String(data[i][cols.vendorId]).trim() : '';
    if (!vid || vid === 'undefined') continue;
    master[vid] = {
      champion: cols.name >= 0 ? String(data[i][cols.name]).trim() : '',
      supervisor: cols.supervisor >= 0 ? String(data[i][cols.supervisor]).trim() : '',
      emirates: cols.emirates >= 0 ? String(data[i][cols.emirates]).trim() : '',
      chainId: cols.chainId >= 0 ? String(data[i][cols.chainId]).trim() : '',
      chainName: cols.chainName >= 0 ? String(data[i][cols.chainName]).trim() : '',
      storeName: cols.vendorName >= 0 ? String(data[i][cols.vendorName]).trim() : ''
    };
  }
  return master;
}

function idx(headers, candidates) {
  for (var i = 0; i < candidates.length; i++) {
    var ix = headers.indexOf(candidates[i]);
    if (ix >= 0) return ix;
  }
  return -1;
}

// ============================================================
// CACHING
// ============================================================
function refreshAllData() {
  var props = PropertiesService.getScriptProperties();
  var master = readMasterData();
  props.setProperty('cpo_master', JSON.stringify(master));

  var periods = ['mtd', 'weekly', 'monthly'];
  for (var i = 0; i < periods.length; i++) {
    var p = periods[i];
    var orders = readOrderData(p);
    var attend = readAttendanceData(p);
    props.setProperty('cpo_orders_' + p, JSON.stringify(orders));
    props.setProperty('cpo_attend_' + p, JSON.stringify(attend));
  }

  props.setProperty('cpo_timestamp', new Date().toISOString());
  return { success: true, timestamp: new Date().toISOString() };
}

function getCachedData(key) {
  var val = PropertiesService.getScriptProperties().getProperty('cpo_' + key);
  return val ? JSON.parse(val) : null;
}

function getLastRefreshTime() {
  return PropertiesService.getScriptProperties().getProperty('cpo_timestamp') || null;
}

// ============================================================
// CPO CALCULATION ENGINE
// ============================================================
function computeCPO(period, dateIndex, userTypes) {
  if (!userTypes) userTypes = ['Picker'];

  var master = getCachedData('master');
  var orders = getCachedData('orders_' + period);
  var attend = getCachedData('attend_' + period);

  if (!master || !orders || !attend) {
    refreshAllData();
    master = getCachedData('master');
    orders = getCachedData('orders_' + period);
    attend = getCachedData('attend_' + period);
  }
  if (!orders || !attend) return { error: 'No data available. Please refresh.' };

  var dates = orders.dates || [];
  if (dates.length === 0) return { error: 'No date columns found in order data.' };

  var isMTDSummary = (period === 'mtd' && dateIndex === -1);
  var refDate = isMTDSummary ? dates[0] : (dates[dateIndex] || dates[0]);
  var dateParts = refDate.split('-');
  var month = parseInt(dateParts[1]) || new Date().getMonth() + 1;
  var year = parseInt(dateParts[0]) || new Date().getFullYear();
  var workDays = getWorkingDays(month, year);
  if (workDays <= 0) workDays = 26;

  var config = loadAllConfig();
  var champCost = getActiveEmployeeCost('Champion', month, year);
  var supCost = getActiveEmployeeCost('City Supervisor', month, year);

  var champStoreCount = {};
  var supChampions = {};
  var vendorIds = Object.keys(master);
  for (var vi = 0; vi < vendorIds.length; vi++) {
    var m = master[vendorIds[vi]];
    if (m.champion) {
      if (!champStoreCount[m.champion]) champStoreCount[m.champion] = 0;
      champStoreCount[m.champion]++;
    }
    if (m.supervisor) {
      if (!supChampions[m.supervisor]) supChampions[m.supervisor] = {};
      if (m.champion) supChampions[m.supervisor][m.champion] = 1;
    }
  }

  var allStoreIds = {};
  var sKeys = Object.keys(orders.stores || {});
  for (var s = 0; s < sKeys.length; s++) allStoreIds[sKeys[s]] = 1;
  var aKeys = Object.keys(attend.byStore || {});
  for (var a = 0; a < aKeys.length; a++) allStoreIds[aKeys[a]] = 1;

  var results = [];
  var storeIds = Object.keys(allStoreIds);
  for (var si = 0; si < storeIds.length; si++) {
    var vendorId = storeIds[si];
    var storeOrders = orders.stores ? orders.stores[vendorId] : null;
    var storePickers = attend.byStore ? attend.byStore[vendorId] : null;
    var masterInfo = master[vendorId] || {};

    var totalOrders = 0;
    if (storeOrders) {
      if (isMTDSummary) {
        for (var di = 0; di < (storeOrders.values || []).length; di++) {
          totalOrders += (storeOrders.values[di] || 0);
        }
      } else {
        totalOrders = (storeOrders.values && storeOrders.values[dateIndex]) ? storeOrders.values[dateIndex] : 0;
      }
    }

    var pickerCost = 0;
    var pickerCount = 0;
    var totalPresent = 0;
    var deptSet = {};

    if (storePickers) {
      for (var pi = 0; pi < storePickers.length; pi++) {
        var picker = storePickers[pi];
        var ut = (picker.userType || 'Picker').trim();
        var matched = false;
        for (var ui = 0; ui < userTypes.length; ui++) {
          if (ut.toLowerCase() === userTypes[ui].toLowerCase()) { matched = true; break; }
        }
        if (!matched) continue;

        var dept = normalizeDept(picker.department);
        var rate = getActiveRate(dept, month, year);
        var present = 0;

        if (isMTDSummary) {
          for (var di2 = 0; di2 < (picker.values || []).length; di2++) {
            present += (picker.values[di2] || 0);
          }
        } else {
          present = (picker.values && picker.values[dateIndex]) ? picker.values[dateIndex] : 0;
        }

        if (present > 0) {
          var cost = (rate / workDays) * present;
          pickerCost += cost;
          pickerCount++;
          totalPresent += present;
          deptSet[dept] = 1;
        }
      }
    }

    var chainName = (storeOrders && storeOrders.chainName) ? storeOrders.chainName : (masterInfo.chainName || '');
    var vendorName = (storeOrders && storeOrders.vendorName) ? storeOrders.vendorName : (masterInfo.storeName || vendorId);
    var champion = masterInfo.champion || '';
    var supervisor = masterInfo.supervisor || '';
    var city = masterInfo.emirates || '';

    var periodDays = isMTDSummary ? dates.length : (period === 'mtd' ? 1 : (period === 'weekly' ? 7 : workDays));
    var champAlloc = 0;
    if (champion && champStoreCount[champion] > 0) {
      champAlloc = (champCost / champStoreCount[champion]) * (periodDays / workDays);
    }
    var supAlloc = 0;
    if (supervisor && supChampions[supervisor]) {
      var supStoreTotal = 0;
      var supCh = Object.keys(supChampions[supervisor]);
      for (var sc = 0; sc < supCh.length; sc++) {
        supStoreTotal += (champStoreCount[supCh[sc]] || 0);
      }
      if (supStoreTotal > 0) supAlloc = (supCost / supStoreTotal) * (periodDays / workDays);
    }

    var loadedCost = pickerCost + champAlloc + supAlloc;
    var pickerCPO = totalOrders > 0 ? pickerCost / totalOrders : 0;
    var loadedCPO = totalOrders > 0 ? loadedCost / totalOrders : 0;

    if (totalOrders > 0 || pickerCount > 0) {
      results.push({
        vendorId: vendorId,
        storeName: vendorName,
        chain: chainName,
        city: city,
        supervisor: supervisor,
        champion: champion,
        dept3pl: Object.keys(deptSet).join(', '),
        pickerCount: pickerCount,
        presentDays: Math.round(totalPresent * 100) / 100,
        orders: totalOrders,
        pickerCost: Math.round(pickerCost),
        pickerCPO: Math.round(pickerCPO * 100) / 100,
        loadedCost: Math.round(loadedCost),
        loadedCPO: Math.round(loadedCPO * 100) / 100,
        champAlloc: Math.round(champAlloc),
        supAlloc: Math.round(supAlloc)
      });
    }
  }

  results.sort(function (a, b) { return b.orders - a.orders; });

  return {
    period: period,
    dateIndex: dateIndex,
    dateLabel: isMTDSummary ? 'MTD (' + dates[0] + ' to ' + dates[dates.length - 1] + ')' : (dates[dateIndex] || ''),
    dates: dates,
    month: month,
    year: year,
    workingDays: workDays,
    totalStores: results.length,
    data: results
  };
}

function getAvailablePeriods() {
  var result = {};
  var periods = ['mtd', 'weekly', 'monthly'];
  for (var i = 0; i < periods.length; i++) {
    var p = periods[i];
    var orders = getCachedData('orders_' + p);
    result[p] = orders ? (orders.dates || []) : [];
  }
  result.timestamp = getLastRefreshTime();
  return result;
}

function getInitialData() {
  var timestamp = getLastRefreshTime();
  if (!timestamp) {
    refreshAllData();
    timestamp = getLastRefreshTime();
  }

  var periods = getAvailablePeriods();
  var config = loadAllConfig();

  var defaultPeriod = 'mtd';
  var defaultDateIndex = -1;
  var cpo = computeCPO(defaultPeriod, defaultDateIndex, ['Picker']);

  var user = getCurrentUser();

  return {
    periods: periods,
    config: config,
    cpo: cpo,
    timestamp: timestamp,
    user: user
  };
}

// ============================================================
// ACCESS CONTROL
// ============================================================
function loadUsers() {
  var val = PropertiesService.getScriptProperties().getProperty('cpo_users');
  return val ? JSON.parse(val) : [];
}

function saveUsers(users) {
  PropertiesService.getScriptProperties().setProperty('cpo_users', JSON.stringify(users));
  return { success: true };
}

function addUser(email, role, supervisorName) {
  var users = loadUsers();
  email = email.toLowerCase().trim();
  for (var i = 0; i < users.length; i++) {
    if (users[i].email === email) return { error: 'User already exists' };
  }
  var user = { email: email, role: role, supervisorName: supervisorName || '', status: 'active', addedAt: new Date().toISOString(), lastInvite: new Date().toISOString() };
  users.push(user);
  saveUsers(users);
  sendWelcomeEmail_(email, role, supervisorName);
  return { success: true };
}

function updateUserRole(email, role, supervisorName) {
  var users = loadUsers();
  email = email.toLowerCase().trim();
  var found = false;
  for (var i = 0; i < users.length; i++) {
    if (users[i].email === email) {
      var oldRole = users[i].role;
      users[i].role = role;
      users[i].supervisorName = supervisorName || '';
      users[i].updatedAt = new Date().toISOString();
      found = true;
      saveUsers(users);
      if (oldRole !== role) sendRoleChangeEmail_(email, role, supervisorName);
      return { success: true };
    }
  }
  if (!found) return { error: 'User not found' };
}

function revokeUser(email) {
  var users = loadUsers();
  email = email.toLowerCase().trim();
  for (var i = 0; i < users.length; i++) {
    if (users[i].email === email) {
      users[i].status = 'revoked';
      users[i].revokedAt = new Date().toISOString();
      saveUsers(users);
      sendRevokedEmail_(email);
      return { success: true };
    }
  }
  return { error: 'User not found' };
}

function reinstateUser(email) {
  var users = loadUsers();
  email = email.toLowerCase().trim();
  for (var i = 0; i < users.length; i++) {
    if (users[i].email === email) {
      users[i].status = 'active';
      delete users[i].revokedAt;
      users[i].updatedAt = new Date().toISOString();
      saveUsers(users);
      sendReinstateEmail_(email, users[i].role, users[i].supervisorName);
      return { success: true };
    }
  }
  return { error: 'User not found' };
}

function removeUser(email) {
  var users = loadUsers();
  email = email.toLowerCase().trim();
  var filtered = [];
  for (var i = 0; i < users.length; i++) {
    if (users[i].email !== email) filtered.push(users[i]);
  }
  saveUsers(filtered);
  return { success: true };
}

function resendInvite(email) {
  var users = loadUsers();
  email = email.toLowerCase().trim();
  for (var i = 0; i < users.length; i++) {
    if (users[i].email === email) {
      users[i].lastInvite = new Date().toISOString();
      saveUsers(users);
      sendWelcomeEmail_(email, users[i].role, users[i].supervisorName);
      return { success: true };
    }
  }
  return { error: 'User not found' };
}

function getCurrentUser() {
  var email = '';
  try { email = Session.getActiveUser().getEmail().toLowerCase().trim(); } catch (e) {}
  if (!email) return { email: '', role: 'viewer', supervisorName: '' };

  var users = loadUsers();
  if (users.length === 0) {
    users.push({ email: email, role: 'admin', supervisorName: '', status: 'active', addedAt: new Date().toISOString() });
    saveUsers(users);
    return { email: email, role: 'admin', supervisorName: '' };
  }

  for (var i = 0; i < users.length; i++) {
    if (users[i].email === email) {
      if (users[i].status === 'revoked') return { email: email, role: 'revoked', supervisorName: '' };
      return { email: email, role: users[i].role, supervisorName: users[i].supervisorName };
    }
  }
  return { email: email, role: 'viewer', supervisorName: '' };
}

function getSupervisorList() {
  var master = getCachedData('master');
  if (!master) { refreshAllData(); master = getCachedData('master'); }
  if (!master) return [];
  var sups = {};
  var keys = Object.keys(master);
  for (var i = 0; i < keys.length; i++) {
    var s = master[keys[i]].supervisor;
    if (s) sups[s] = 1;
  }
  return Object.keys(sups).sort();
}

function getAppUrl_() {
  return ScriptApp.getService().getUrl();
}

function getAppUrl() {
  return getAppUrl_();
}

function buildUserEmailHtml_(title, greeting, bodyLines, ctaText, ctaUrl) {
  var h = '<div style="font-family:\'Poppins\',Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e0db;">';
  h += '<div style="background:#411517;color:#fff;padding:24px 32px;">';
  h += '<h1 style="margin:0;font-size:20px;font-weight:600;">talabat <span style="color:#FF5A00;">LS</span> — CPO Check</h1>';
  h += '<p style="margin:6px 0 0;font-size:13px;opacity:0.8;">' + title + '</p>';
  h += '</div>';
  h += '<div style="padding:28px 32px;">';
  h += '<p style="font-size:14px;color:#411517;margin:0 0 16px;">' + greeting + '</p>';
  for (var i = 0; i < bodyLines.length; i++) {
    h += '<p style="font-size:13px;color:#555;margin:0 0 10px;line-height:1.6;">' + bodyLines[i] + '</p>';
  }
  if (ctaText && ctaUrl) {
    h += '<div style="text-align:center;margin:24px 0;">';
    h += '<a href="' + ctaUrl + '" style="display:inline-block;padding:12px 32px;background:#FF5A00;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">' + ctaText + '</a>';
    h += '</div>';
  }
  h += '<hr style="border:none;border-top:1px solid #e5e0db;margin:24px 0;">';
  h += '<p style="font-size:11px;color:#999;margin:0;">This is an automated message from talabat LS CPO Check. If you have questions, contact your admin.</p>';
  h += '</div></div>';
  return h;
}

function getRoleDescription_(role) {
  if (role === 'admin') return 'Full access — view all data, manage settings, users, and email triggers.';
  if (role === 'manager') return 'View access — see all stores and data across the entire operation.';
  if (role === 'supervisor') return 'Supervisor access — view data for stores assigned to you.';
  return 'Viewer access — limited read-only view.';
}

function sendWelcomeEmail_(email, role, supervisorName) {
  var url = getAppUrl_();
  var roleDesc = getRoleDescription_(role);
  var body = [
    'You have been granted access to the <strong>CPO Check</strong> dashboard — the Cost Per Order tracking tool for talabat Local Shops operations.',
    '<div style="background:#F4EDE3;padding:14px 18px;border-radius:8px;margin:8px 0;">'
      + '<div style="font-size:11px;color:#888;text-transform:uppercase;margin-bottom:4px;">Your Role</div>'
      + '<div style="font-size:15px;font-weight:600;color:#411517;">' + role.charAt(0).toUpperCase() + role.slice(1) + '</div>'
      + '<div style="font-size:12px;color:#555;margin-top:2px;">' + roleDesc + '</div>'
      + (supervisorName ? '<div style="font-size:12px;color:#555;margin-top:4px;">Supervisor area: <strong>' + supervisorName + '</strong></div>' : '')
      + '</div>',
    'Click the button below to open your dashboard. You will be signed in automatically with your Google account.'
  ];
  try {
    GmailApp.sendEmail(email, 'You now have access to talabat LS CPO Check', '', {
      htmlBody: buildUserEmailHtml_('Access Granted', 'Hello,', body, 'Open CPO Check Dashboard', url),
      name: 'talabat LS CPO Check'
    });
  } catch (e) { Logger.log('Welcome email error: ' + e); }
}

function sendRoleChangeEmail_(email, newRole, supervisorName) {
  var url = getAppUrl_();
  var roleDesc = getRoleDescription_(newRole);
  var body = [
    'Your access role on the <strong>CPO Check</strong> dashboard has been updated.',
    '<div style="background:#F4EDE3;padding:14px 18px;border-radius:8px;margin:8px 0;">'
      + '<div style="font-size:11px;color:#888;text-transform:uppercase;margin-bottom:4px;">New Role</div>'
      + '<div style="font-size:15px;font-weight:600;color:#411517;">' + newRole.charAt(0).toUpperCase() + newRole.slice(1) + '</div>'
      + '<div style="font-size:12px;color:#555;margin-top:2px;">' + roleDesc + '</div>'
      + (supervisorName ? '<div style="font-size:12px;color:#555;margin-top:4px;">Supervisor area: <strong>' + supervisorName + '</strong></div>' : '')
      + '</div>',
    'Your access is effective immediately.'
  ];
  try {
    GmailApp.sendEmail(email, 'Your CPO Check access role has been updated', '', {
      htmlBody: buildUserEmailHtml_('Role Updated', 'Hello,', body, 'Open CPO Check Dashboard', url),
      name: 'talabat LS CPO Check'
    });
  } catch (e) { Logger.log('Role change email error: ' + e); }
}

function sendRevokedEmail_(email) {
  var body = [
    'Your access to the <strong>CPO Check</strong> dashboard has been revoked by an administrator.',
    'You will no longer be able to view data on the dashboard. If you believe this is an error, please contact your admin.'
  ];
  try {
    GmailApp.sendEmail(email, 'Your CPO Check access has been revoked', '', {
      htmlBody: buildUserEmailHtml_('Access Revoked', 'Hello,', body, null, null),
      name: 'talabat LS CPO Check'
    });
  } catch (e) { Logger.log('Revoke email error: ' + e); }
}

function sendReinstateEmail_(email, role, supervisorName) {
  var url = getAppUrl_();
  var roleDesc = getRoleDescription_(role);
  var body = [
    'Your access to the <strong>CPO Check</strong> dashboard has been reinstated.',
    '<div style="background:#F4EDE3;padding:14px 18px;border-radius:8px;margin:8px 0;">'
      + '<div style="font-size:11px;color:#888;text-transform:uppercase;margin-bottom:4px;">Your Role</div>'
      + '<div style="font-size:15px;font-weight:600;color:#411517;">' + role.charAt(0).toUpperCase() + role.slice(1) + '</div>'
      + '<div style="font-size:12px;color:#555;margin-top:2px;">' + roleDesc + '</div>'
      + (supervisorName ? '<div style="font-size:12px;color:#555;margin-top:4px;">Supervisor area: <strong>' + supervisorName + '</strong></div>' : '')
      + '</div>',
    'You can now access the dashboard again.'
  ];
  try {
    GmailApp.sendEmail(email, 'Your CPO Check access has been reinstated', '', {
      htmlBody: buildUserEmailHtml_('Access Reinstated', 'Hello,', body, 'Open CPO Check Dashboard', url),
      name: 'talabat LS CPO Check'
    });
  } catch (e) { Logger.log('Reinstate email error: ' + e); }
}

// ============================================================
// EMAIL REPORTS
// ============================================================
function sendWeeklyReports() {
  var settings = loadConfig('email_settings');
  var weeklyConfig = null;
  for (var i = 0; i < settings.length; i++) {
    if (settings[i].type === 'weekly' && settings[i].enabled) { weeklyConfig = settings[i]; break; }
  }
  if (!weeklyConfig) return { skipped: true, reason: 'Weekly email disabled' };

  refreshAllData();
  var cpo = computeCPO('weekly', 0, ['Picker']);
  if (cpo.error) return { error: cpo.error };

  var users = loadUsers();
  var sent = 0;
  for (var u = 0; u < users.length; u++) {
    if (users[u].role !== 'supervisor') continue;
    var supName = users[u].supervisorName;
    if (!supName) continue;
    var supData = cpo.data.filter(function (r) { return r.supervisor === supName; });
    if (supData.length === 0) continue;
    var html = buildReportEmail(supName, supData, cpo.dateLabel, 'Weekly');
    var subject = (weeklyConfig.subject || 'Weekly CPO Report') + ' — ' + cpo.dateLabel;
    try {
      GmailApp.sendEmail(users[u].email, subject, '', { htmlBody: html, name: 'talabat LS CPO Check' });
      sent++;
    } catch (e) { Logger.log('Email error for ' + users[u].email + ': ' + e); }
  }
  return { success: true, sent: sent };
}

function sendMonthlyReports() {
  var settings = loadConfig('email_settings');
  var monthlyConfig = null;
  for (var i = 0; i < settings.length; i++) {
    if (settings[i].type === 'monthly' && settings[i].enabled) { monthlyConfig = settings[i]; break; }
  }
  if (!monthlyConfig) return { skipped: true, reason: 'Monthly email disabled' };

  refreshAllData();
  var cpo = computeCPO('monthly', 0, ['Picker']);
  if (cpo.error) return { error: cpo.error };

  var users = loadUsers();
  var sent = 0;
  for (var u = 0; u < users.length; u++) {
    if (users[u].role !== 'supervisor') continue;
    var supName = users[u].supervisorName;
    if (!supName) continue;
    var supData = cpo.data.filter(function (r) { return r.supervisor === supName; });
    if (supData.length === 0) continue;
    var html = buildReportEmail(supName, supData, cpo.dateLabel, 'Monthly');
    var subject = (monthlyConfig.subject || 'Monthly CPO Report') + ' — ' + cpo.dateLabel;
    try {
      GmailApp.sendEmail(users[u].email, subject, '', { htmlBody: html, name: 'talabat LS CPO Check' });
      sent++;
    } catch (e) { Logger.log('Email error for ' + users[u].email + ': ' + e); }
  }
  return { success: true, sent: sent };
}

function sendTestEmail(recipientEmail, period) {
  var cached = getCachedData('cache_timestamp');
  if (!cached) refreshAllData();
  var p = period || 'weekly';
  var tab = p === 'monthly' ? 'monthly' : 'mtd';
  var idx = p === 'monthly' ? 0 : -1;
  var cpo = computeCPO(tab, idx, ['Picker']);
  if (cpo.error) throw new Error(cpo.error);
  var html = buildReportEmail('All Supervisors', cpo.data, cpo.dateLabel, p === 'monthly' ? 'Monthly' : 'Weekly');
  GmailApp.sendEmail(recipientEmail, 'Test CPO Report — ' + cpo.dateLabel, '', { htmlBody: html, name: 'talabat LS CPO Check' });
  return { success: true };
}

function buildReportEmail(supervisorName, data, dateLabel, reportType) {
  data.sort(function (a, b) { return b.pickerCPO - a.pickerCPO; });
  var avgOrders = 0, avgCost = 0;
  for (var i = 0; i < data.length; i++) { avgOrders += data[i].orders; avgCost += data[i].pickerCost; }
  var avgCPO = avgOrders > 0 ? avgCost / avgOrders : 0;

  var p75 = 0;
  if (data.length > 0) {
    var cpos = data.map(function (r) { return r.pickerCPO; }).filter(function (v) { return v > 0; }).sort(function (a, b) { return a - b; });
    p75 = cpos.length > 0 ? cpos[Math.floor(cpos.length * 0.75)] : 0;
  }

  var h = '<div style="font-family:\'Poppins\',Arial,sans-serif;max-width:800px;margin:0 auto;background:#fff;">';
  h += '<div style="background:#411517;color:#fff;padding:24px 32px;border-radius:12px 12px 0 0;">';
  h += '<h1 style="margin:0;font-size:22px;font-weight:600;">talabat <span style="color:#FF5A00;">LS</span> — CPO Check</h1>';
  h += '<p style="margin:6px 0 0;font-size:14px;opacity:0.85;">' + reportType + ' Performance Report — ' + dateLabel + '</p>';
  h += '</div>';

  h += '<div style="padding:24px 32px;background:#F4EDE3;">';
  h += '<p style="font-size:14px;color:#411517;">Dear <strong>' + supervisorName + '</strong>,</p>';
  h += '<p style="font-size:13px;color:#555;">Below is your ' + reportType.toLowerCase() + ' CPO performance summary.</p>';

  h += '<div style="display:flex;gap:12px;margin:16px 0;">';
  h += '<div style="flex:1;background:#fff;padding:16px;border-radius:8px;border-left:4px solid #FF5A00;"><div style="font-size:11px;color:#888;text-transform:uppercase;">Total Orders</div><div style="font-size:24px;font-weight:700;color:#411517;">' + fmtNum(avgOrders) + '</div></div>';
  h += '<div style="flex:1;background:#fff;padding:16px;border-radius:8px;border-left:4px solid #FF5A00;"><div style="font-size:11px;color:#888;text-transform:uppercase;">Total Cost</div><div style="font-size:24px;font-weight:700;color:#411517;">AED ' + fmtNum(Math.round(avgCost)) + '</div></div>';
  h += '<div style="flex:1;background:#fff;padding:16px;border-radius:8px;border-left:4px solid #FF5A00;"><div style="font-size:11px;color:#888;text-transform:uppercase;">Avg CPO</div><div style="font-size:24px;font-weight:700;color:#411517;">AED ' + avgCPO.toFixed(2) + '</div></div>';
  h += '<div style="flex:1;background:#fff;padding:16px;border-radius:8px;border-left:4px solid #FF5A00;"><div style="font-size:11px;color:#888;text-transform:uppercase;">Stores</div><div style="font-size:24px;font-weight:700;color:#411517;">' + data.length + '</div></div>';
  h += '</div>';

  var td = 'padding:8px 12px;border-bottom:1px solid #e5e0db;font-size:12px;';
  h += '<table style="width:100%;border-collapse:collapse;margin-top:16px;background:#fff;border-radius:8px;overflow:hidden;">';
  h += '<tr style="background:#411517;color:#fff;">';
  h += '<th style="' + td + 'text-align:left;color:#fff;">Store</th>';
  h += '<th style="' + td + 'text-align:left;color:#fff;">Chain</th>';
  h += '<th style="' + td + 'text-align:right;color:#fff;">Pickers</th>';
  h += '<th style="' + td + 'text-align:right;color:#fff;">Orders</th>';
  h += '<th style="' + td + 'text-align:right;color:#fff;">Picker Cost</th>';
  h += '<th style="' + td + 'text-align:right;color:#fff;">CPO</th>';
  h += '</tr>';

  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    var isHigh = r.pickerCPO > p75 && r.pickerCPO > 0;
    var rowBg = i % 2 === 0 ? '#fff' : '#faf6f1';
    if (isHigh) rowBg = '#fef2f2';
    var cpoColor = isHigh ? '#dc2626' : '#059669';
    h += '<tr style="background:' + rowBg + ';">';
    h += '<td style="' + td + '">' + r.storeName + '</td>';
    h += '<td style="' + td + '">' + r.chain + '</td>';
    h += '<td style="' + td + 'text-align:right;">' + r.pickerCount + '</td>';
    h += '<td style="' + td + 'text-align:right;">' + fmtNum(r.orders) + '</td>';
    h += '<td style="' + td + 'text-align:right;">AED ' + fmtNum(r.pickerCost) + '</td>';
    h += '<td style="' + td + 'text-align:right;font-weight:700;color:' + cpoColor + ';">' + (isHigh ? '⚠ ' : '') + 'AED ' + r.pickerCPO.toFixed(2) + '</td>';
    h += '</tr>';
  }
  h += '</table>';

  if (data.filter(function (r) { return r.pickerCPO > p75 && r.pickerCPO > 0; }).length > 0) {
    h += '<div style="margin-top:16px;padding:12px 16px;background:#fef2f2;border-left:4px solid #dc2626;border-radius:4px;font-size:12px;color:#991b1b;">';
    h += '<strong>⚠ High CPO Alert:</strong> ' + data.filter(function (r) { return r.pickerCPO > p75 && r.pickerCPO > 0; }).length + ' store(s) above the 75th percentile (AED ' + p75.toFixed(2) + '). Review picker allocation for optimization.';
    h += '</div>';
  }

  h += '<p style="font-size:11px;color:#999;margin-top:24px;">This is an automated report from the talabat LS CPO Check. <a href="#" style="color:#FF5A00;">Open Dashboard</a></p>';
  h += '</div></div>';
  return h;
}

function fmtNum(n) {
  if (n === null || n === undefined) return '0';
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// ============================================================
// TRIGGER MANAGEMENT
// ============================================================
function setupWeeklyTrigger() {
  removeTrigger_('sendWeeklyReports');
  ScriptApp.newTrigger('sendWeeklyReports').timeBased().everyWeeks(1).onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(8).create();
  return { success: true, message: 'Weekly trigger set for Sunday 8 AM' };
}

function setupMonthlyTrigger() {
  removeTrigger_('sendMonthlyReports');
  ScriptApp.newTrigger('sendMonthlyReports').timeBased().onMonthDay(1).atHour(8).create();
  return { success: true, message: 'Monthly trigger set for 1st of month 8 AM' };
}

function removeTrigger_(funcName) {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === funcName) ScriptApp.deleteTrigger(triggers[i]);
  }
}

function getActiveTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  var result = [];
  for (var i = 0; i < triggers.length; i++) {
    result.push({ func: triggers[i].getHandlerFunction(), type: String(triggers[i].getEventType()) });
  }
  return result;
}

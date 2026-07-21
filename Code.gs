// ============================================================
// talabat LS — CPO Check  v3.0
// Changes: vendor hours/day, UTR fix, monthly attend fix,
//          MTD sync banner, all-data single load, historical+trends tab
// ============================================================
var _SHEET_IDS_DEFAULT={
  orders:'1mDnzwA0fycVbo-1hIxvKzoLoi5U8pv12I6Fazq8CKOI',
  attendance:'1LRlCJbv7nnabo_doQ2VAP4jMl80fF-ZpLcsqIE6FO9w',
  master:'10swg2HotxTSmIMPGQt6AxARFQyfTbvt7504tFjysmGs',
  hourly:'1n4GopL6gSsSw_sauMkHKVfcF6IDYI84skyGMdfC4hqA'
};
function _getSheetIds(){
  var v=PropertiesService.getScriptProperties().getProperty('cpo_sheet_ids');
  var saved=v?JSON.parse(v):{};
  return{
    orders:saved.orders||_SHEET_IDS_DEFAULT.orders,
    attendance:saved.attendance||_SHEET_IDS_DEFAULT.attendance,
    master:saved.master||_SHEET_IDS_DEFAULT.master,
    hourly:saved.hourly||_SHEET_IDS_DEFAULT.hourly
  };
}
function getSheetIds(){return _getSheetIds();}
function saveSheetIds(ids){
  var cur=_getSheetIds();
  var merged={
    orders:ids.orders||cur.orders,
    attendance:ids.attendance||cur.attendance,
    master:ids.master||cur.master,
    hourly:ids.hourly||cur.hourly
  };
  PropertiesService.getScriptProperties().setProperty('cpo_sheet_ids',JSON.stringify(merged));
  // Bust hourly caches
  CacheService.getScriptCache().remove('cpo_hourly');
  CacheService.getScriptCache().remove('cpo_hourly_gmv');
  return{success:true};
}
var _sheetIds=_getSheetIds();
var ORDER_SHEET_ID      = _sheetIds.orders;
var ATTENDANCE_SHEET_ID = _sheetIds.attendance;
var MASTER_DATA_SHEET_ID= _sheetIds.master;
var HOURLY_SHEET_ID     = _sheetIds.hourly;
var ORDER_TABS   = { mtd:'MTD Order',   weekly:'Weekly Order',   monthly:'Monthly Order' };
var ATTEND_TABS  = { mtd:'MTD Know',    weekly:'Weekly Know',    monthly:'Monthly Know'  };
var CACHE_FOLDER_NAME   = 'CPO_Cache';
var ARCHIVE_FOLDER_NAME = 'CPO_Data_Archive';

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Dashboard')
    .setTitle('talabat LS — CPO Check')
    .addMetaTag('viewport','width=device-width,initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ============================================================
// CONFIG CRUD
// ============================================================
function saveConfig(t,e){PropertiesService.getScriptProperties().setProperty('cpo_config_'+t,JSON.stringify(e));return{success:true};}
function loadConfig(t){var v=PropertiesService.getScriptProperties().getProperty('cpo_config_'+t);return v?JSON.parse(v):[];}

function loadAllConfig() {
  var types = ['vendor_rates','employee_costs','working_days','email_settings'];
  var props = PropertiesService.getScriptProperties();
  var result = {}; var hasAny = false;
  for (var i=0;i<types.length;i++) {
    var val = props.getProperty('cpo_config_'+types[i]);
    if (val) { result[types[i]]=JSON.parse(val); hasAny=true; } else { result[types[i]]=[]; }
  }
  if (!hasAny) { initDefaultConfig(); return loadAllConfig(); }
  return result;
}

// ============================================================
// OPTIMIZER CONFIG
// ============================================================
function loadOptimizerConfig(){
  var v=PropertiesService.getScriptProperties().getProperty('cpo_config_optimizer');
  if(v)return JSON.parse(v);
  return{
    currency:'AED',
    actionThreshold:4.0,
    criticalThreshold:20.0,
    relieverAttendancePct:25,
    relieverMinPickers:3,
    lowOrderPerDay:10,
    closureOrdersPerWeek:50,
    proximityRadiusKm:5,
    proximityDriveMin:10,
    otUTRThreshold:5,
    edgeOrderThreshold:1.0,
    edgeGMVThreshold:50,
    weekdayDayOffOnly:1
  };
}
function saveOptimizerConfig(cfg){
  PropertiesService.getScriptProperties().setProperty('cpo_config_optimizer',JSON.stringify(cfg));
  return{success:true};
}

function loadRamadanConfig(){
  var v=PropertiesService.getScriptProperties().getProperty('cpo_config_ramadan');
  if(v)return JSON.parse(v);
  return{start:'',end:''};
}
function saveRamadanConfig(cfg){
  PropertiesService.getScriptProperties().setProperty('cpo_config_ramadan',JSON.stringify(cfg));
  return{success:true};
}

function loadHolidays(){
  var v=PropertiesService.getScriptProperties().getProperty('cpo_config_holidays');
  return v?JSON.parse(v):[];
}
function saveHolidays(list){
  PropertiesService.getScriptProperties().setProperty('cpo_config_holidays',JSON.stringify(list));
  return list;
}
function addHolidayEntry(entry){
  var list=loadHolidays();
  entry.id='hl_'+new Date().getTime()+'_'+Math.floor(Math.random()*1000);
  list.push(entry);
  return saveHolidays(list);
}
function deleteHolidayEntry(id){
  return saveHolidays(loadHolidays().filter(function(h){return h.id!==id;}));
}
function getConfigHolidays(month,year){
  var pad=function(n){return n<10?'0'+n:String(n);};
  var prefix=year+'-'+pad(month)+'-';
  return loadHolidays().filter(function(h){return h.date&&h.date.indexOf(prefix)===0;});
}
function updateWorkdayHolidays(id,holidays){
  return updateConfigEntry('working_days',id,{holidays:holidays});
}

function addConfigEntry(t,e) {
  var entries=loadConfig(t);
  e.id=t.substring(0,2)+'_'+new Date().getTime()+'_'+Math.floor(Math.random()*1000);
  entries.push(e); saveConfig(t,entries); return entries;
}
function deleteConfigEntry(t,id) {
  var entries=loadConfig(t).filter(function(e){return e.id!==id;});
  saveConfig(t,entries); return entries;
}
function updateConfigEntry(t,id,fields) {
  var entries=loadConfig(t);
  for(var i=0;i<entries.length;i++){if(entries[i].id===id){Object.assign(entries[i],fields);break;}}
  saveConfig(t,entries); return entries;
}

function initDefaultConfig() {
  var props = PropertiesService.getScriptProperties();
  // vendor_rates now include hoursPerDay per vendor
  var vr = [
    {id:'vr_krh',        vendorName:'KRH',        baseRate:2750, hoursPerDay:10, effectiveStartMonth:1,effectiveStartYear:2025,effectiveEndMonth:null,effectiveEndYear:null},
    {id:'vr_transguard', vendorName:'Transguard',  baseRate:2574, hoursPerDay:10, effectiveStartMonth:1,effectiveStartYear:2025,effectiveEndMonth:null,effectiveEndYear:null},
    {id:'vr_wesource',   vendorName:'WeSource',    baseRate:2780, hoursPerDay:10, effectiveStartMonth:1,effectiveStartYear:2025,effectiveEndMonth:null,effectiveEndYear:null},
    {id:'vr_zone',       vendorName:'Zone',        baseRate:2780, hoursPerDay:10, effectiveStartMonth:1,effectiveStartYear:2025,effectiveEndMonth:null,effectiveEndYear:null},
    {id:'vr_trumax',     vendorName:'Trumax',      baseRate:2780, hoursPerDay:10, effectiveStartMonth:1,effectiveStartYear:2025,effectiveEndMonth:null,effectiveEndYear:null},
    {id:'vr_sanket',     vendorName:'Sanket',      baseRate:2750, hoursPerDay:10, effectiveStartMonth:1,effectiveStartYear:2025,effectiveEndMonth:null,effectiveEndYear:null},
    {id:'vr_mtm',        vendorName:'MTM',         baseRate:2780, hoursPerDay:10, effectiveStartMonth:1,effectiveStartYear:2025,effectiveEndMonth:null,effectiveEndYear:null},
    {id:'vr_jumbo',      vendorName:'Jumbo',       baseRate:2780, hoursPerDay:10, effectiveStartMonth:1,effectiveStartYear:2025,effectiveEndMonth:null,effectiveEndYear:null}
  ];
  props.setProperty('cpo_config_vendor_rates', JSON.stringify(vr));
  var ec = [
    {id:'ec_champion', role:'Champion',      baseCost:6400, effectiveStartMonth:1,effectiveStartYear:2025,effectiveEndMonth:null,effectiveEndYear:null},
    {id:'ec_supervisor',role:'City Supervisor',baseCost:8500,effectiveStartMonth:1,effectiveStartYear:2025,effectiveEndMonth:null,effectiveEndYear:null}
  ];
  props.setProperty('cpo_config_employee_costs', JSON.stringify(ec));
  props.setProperty('cpo_config_working_days','[]');
  var es = [
    {id:'es_weekly', type:'weekly', enabled:true,dayOfWeek:0,  subject:'Weekly CPO Report',  effectiveStartMonth:1,effectiveStartYear:2025,effectiveEndMonth:null,effectiveEndYear:null},
    {id:'es_monthly',type:'monthly',enabled:true,dayOfMonth:1, subject:'Monthly CPO Report', effectiveStartMonth:1,effectiveStartYear:2025,effectiveEndMonth:null,effectiveEndYear:null}
  ];
  props.setProperty('cpo_config_email_settings', JSON.stringify(es));
  return {success:true};
}

// ============================================================
// EFFECTIVE DATE RESOLUTION
// ============================================================
function resolveEffectiveEntry(entries,month,year,matchField,matchValue) {
  var target=year*12+month, best=null, bestStart=-1;
  for(var i=0;i<entries.length;i++){
    var e=entries[i];
    if(matchField && e[matchField]!==matchValue) continue;
    var start=e.effectiveStartYear*12+e.effectiveStartMonth;
    var end=(e.effectiveEndMonth===null||e.effectiveEndYear===null)?Infinity:e.effectiveEndYear*12+e.effectiveEndMonth;
    if(target>=start&&target<=end&&start>bestStart){best=e;bestStart=start;}
  }
  return best;
}

function getActiveVendorEntry(vendorName,month,year) {
  var entries=loadConfig('vendor_rates');
  var norm=normalizeDept(vendorName);
  for(var i=0;i<entries.length;i++){if(normalizeDept(entries[i].vendorName)===norm)entries[i]._norm=norm;}
  return resolveEffectiveEntry(entries,month,year,'_norm',norm);
}
function getActiveRate(vendorName,month,year){var e=getActiveVendorEntry(vendorName,month,year);return e?e.baseRate:0;}
// NEW: per-vendor hours/day, fallback 10
function getVendorHours(vendorName,month,year){var e=getActiveVendorEntry(vendorName,month,year);return e?(e.hoursPerDay||10):10;}

function getActiveEmployeeCost(role,month,year){
  var m=resolveEffectiveEntry(loadConfig('employee_costs'),month,year,'role',role);
  return m?m.baseCost:0;
}
function getWorkingDays(month,year){
  var entries=loadConfig('working_days');
  for(var i=0;i<entries.length;i++){if(entries[i].month===month&&entries[i].year===year)return entries[i].workingDays;}
  var cal=new Date(year,month,0).getDate();
  return month===2?24:(cal===31?27:26);
}

function normalizeDept(dept){
  if(!dept)return'Other';
  var d=dept.trim().toUpperCase();
  if(d==='KRH')return'KRH';
  if(d==='TRANSGUARD')return'Transguard';
  if(d==='TRUEMAX'||d==='TRUMAX')return'Trumax';
  if(d==='WESOURCE')return'WeSource';
  if(d==='SANKET')return'Sanket';
  if(d==='ZONE')return'Zone';
  if(d==='MTM')return'MTM';
  if(d==='JUMBO')return'Jumbo';
  return dept.trim();
}

// ============================================================
// DRIVE CACHE — folder cached in memory per execution
// ============================================================
var _cacheFolder=null;
function getCacheFolder_(){
  if(!_cacheFolder){
    var f=DriveApp.getFoldersByName(CACHE_FOLDER_NAME);
    _cacheFolder=f.hasNext()?f.next():DriveApp.createFolder(CACHE_FOLDER_NAME);
  }
  return _cacheFolder;
}
function saveDriveData(key,obj){
  var folder=getCacheFolder_(), fn='cpo_cache_'+key+'.json';
  var ex=folder.getFilesByName(fn); while(ex.hasNext())ex.next().setTrashed(true);
  folder.createFile(fn,JSON.stringify(obj),'application/json');
}
function loadDriveData(key){
  try{
    var folder=getCacheFolder_(), fn='cpo_cache_'+key+'.json';
    var files=folder.getFilesByName(fn);
    return files.hasNext()?JSON.parse(files.next().getBlob().getDataAsString()):null;
  }catch(e){return null;}
}
function getCachedData(key){return loadDriveData(key);}
function getLastRefreshTime(){return PropertiesService.getScriptProperties().getProperty('cpo_timestamp')||null;}

// Clears old PropertiesService bloat — run once from Script Editor
function clearOldPropertiesCache(){
  var props=PropertiesService.getScriptProperties(), all=props.getProperties(), n=0;
  // These are now stored in Drive — delete any stale PropertiesService copies
  var driveKeys=['cpo_precomp_done','cpo_fetch_log'];
  driveKeys.forEach(function(k){if(all[k]){props.deleteProperty(k);n++;}});
  for(var k in all){
    if(k.indexOf('cpo_config_')===0||k==='cpo_users'||k==='cpo_timestamp')continue;
    props.deleteProperty(k); n++;
  }
  Logger.log('Cleared '+n+' old cache properties');
  return{cleared:n};
}

// ============================================================
// DRIVE ARCHIVE
// ============================================================
function getArchiveFolder_(){
  var f=DriveApp.getFoldersByName(ARCHIVE_FOLDER_NAME);
  return f.hasNext()?f.next():DriveApp.createFolder(ARCHIVE_FOLDER_NAME);
}
function archiveMonthlySnapshot_(){
  var orders=loadDriveData('orders_monthly'), attend=loadDriveData('attend_monthly');
  if(!orders||!orders.dates||orders.dates.length===0)return;
  var label=orders.dates[0].substring(0,7);
  var fn='cpo_monthly_'+label+'.json';
  var folder=getArchiveFolder_();
  var ex=folder.getFilesByName(fn); while(ex.hasNext())ex.next().setTrashed(true);
  folder.createFile(fn,JSON.stringify({orders:orders,attend:attend,savedAt:new Date().toISOString()}),'application/json');
}
function listArchivedMonths(){
  try{
    var folder=getArchiveFolder_(), files=folder.getFiles(), months=[];
    while(files.hasNext()){
      var f=files.next(), name=f.getName();
      if(/^cpo_monthly_\d{4}-\d{2}\.json$/.test(name)){
        months.push({label:name.replace('cpo_monthly_','').replace('.json',''),fileId:f.getId()});
      }
    }
    return months.sort(function(a,b){return b.label.localeCompare(a.label);});
  }catch(e){return[];}
}
function loadArchivedMonth(fileId){
  try{return JSON.parse(DriveApp.getFileById(fileId).getBlob().getDataAsString());}
  catch(e){return{error:'Cannot load archive: '+e.message};}
}

// ============================================================
// DATA READERS
// ============================================================
function findCol(headers,names){
  for(var n=0;n<names.length;n++)
    for(var c=0;c<headers.length;c++)
      if(String(headers[c]).trim().toLowerCase()===names[n])return c;
  return -1;
}
function idx(headers,candidates){
  for(var i=0;i<candidates.length;i++){var ix=headers.indexOf(candidates[i]);if(ix>=0)return ix;}
  return -1;
}
function normalizeDateLabel(v){
  if(v instanceof Date){try{return Utilities.formatDate(v,'Asia/Dubai','yyyy-MM-dd');}catch(e){return'';}}
  var s=String(v).trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;
  if(/^\d{4}-\d{2}$/.test(s))return s+'-01';
  return s;
}
function findDateRow(data){
  for(var r=0;r<Math.min(5,data.length);r++)
    for(var c=0;c<data[r].length;c++){
      var v=data[r][c];
      if(v instanceof Date)return{row:r,startCol:c};
      var s=String(v).trim();
      if(/^\d{4}-\d{2}(-\d{2})?$/.test(s))return{row:r,startCol:c};
    }
  return null;
}
function extractDates(data,dateInfo){
  var dates=[];
  for(var c=dateInfo.startCol;c<data[dateInfo.row].length;c++){
    var s=normalizeDateLabel(data[dateInfo.row][c]);
    if(s&&/^\d{4}/.test(s))dates.push({col:c,label:s});
  }
  return dates;
}

function readOrderData(period){
  var sheet=SpreadsheetApp.openById(ORDER_SHEET_ID).getSheetByName(ORDER_TABS[period]);
  if(!sheet)return{dates:[],stores:{}};
  var data=sheet.getDataRange().getValues();
  if(data.length<3)return{dates:[],stores:{}};
  var dateInfo=findDateRow(data); if(!dateInfo)return{dates:[],stores:{}};
  var dates=extractDates(data,dateInfo);
  var hr=dateInfo.row+1; if(hr>=data.length)hr=1;
  var headers=data[hr];
  var cChainId=findCol(headers,['chain id']),cChainName=findCol(headers,['chain name']);
  var cVid=findCol(headers,['vendor id']),cVname=findCol(headers,['vendor name (english)','vendor name']);
  var stores={};
  for(var r=hr+1;r<data.length;r++){
    var row=data[r];
    var vid=cVid>=0?String(row[cVid]).trim():'';
    if(!vid||vid==='undefined')continue;
    var values=[];
    for(var d=0;d<dates.length;d++)values.push(parseFloat(String(row[dates[d].col]).replace(/,/g,''))||0);
    stores[vid]={chainId:cChainId>=0?String(row[cChainId]).trim():'',chainName:cChainName>=0?String(row[cChainName]).trim():'',vendorName:cVname>=0?String(row[cVname]).trim():'',values:values};
  }
  return{dates:dates.map(function(d){return d.label;}),stores:stores};
}

// FIXED: Monthly attendance reads "Present Count" per month column correctly
function readAttendanceData(period){
  var sheet=SpreadsheetApp.openById(ATTENDANCE_SHEET_ID).getSheetByName(ATTEND_TABS[period]);
  if(!sheet)return{dates:[],byStore:{},isMonthly:period==='monthly'};
  var data=sheet.getDataRange().getValues();
  if(data.length<3)return{dates:[],byStore:{},isMonthly:period==='monthly'};
  var dateInfo=findDateRow(data); if(!dateInfo)return{dates:[],byStore:{},isMonthly:period==='monthly'};
  var dates=extractDates(data,dateInfo);
  var hr=dateInfo.row+1; if(hr>=data.length)hr=1;
  var headers=data[hr];
  var cName=findCol(headers,['employee name']),cType=findCol(headers,['user type']);
  var cDept=findCol(headers,['department','dept','3pl']);
  var cSid=findCol(headers,['shopper id']),cBid=findCol(headers,['shift branch id']);
  var byStore={};
  for(var r=hr+1;r<data.length;r++){
    var row=data[r];
    var bid=cBid>=0?String(row[cBid]).trim():'';
    var sid=cSid>=0?String(row[cSid]).trim():'';
    if(!bid||!sid)continue;
    var values=[];
    for(var d=0;d<dates.length;d++){
      var raw=parseFloat(String(row[dates[d].col]).replace(/,/g,''))||0;
      // For MTD: cap at 1 (present/absent). For weekly/monthly: raw present count (days present)
      if(period==='mtd'&&raw>=1)raw=1;
      values.push(raw);
    }
    if(!byStore[bid])byStore[bid]=[];
    byStore[bid].push({
      shopperId:sid,
      name:cName>=0?String(row[cName]).trim():'',
      userType:cType>=0?String(row[cType]).trim():'Picker',
      department:cDept>=0?String(row[cDept]).trim():'',
      values:values
    });
  }
  return{dates:dates.map(function(d){return d.label;}),byStore:byStore,isMonthly:period==='monthly'};
}

function readMasterData(){
  var sheet=SpreadsheetApp.openById(MASTER_DATA_SHEET_ID).getSheetByName('Master Data Champions');
  if(!sheet)return{};
  var data=sheet.getDataRange().getValues(); if(data.length<2)return{};
  var h=data[0].map(function(c){return String(c).trim().toLowerCase().replace(/\s+/g,'_');});
  var cols={
    name:idx(h,['name','champion','champion_name']),supervisor:idx(h,['supervisor','supervisor_name']),
    emirates:idx(h,['emirates','emirate','city']),chainId:idx(h,['chain_id']),chainName:idx(h,['chain_name','chain_nam','chain']),
    vendorId:idx(h,['vendor_id']),vendorName:idx(h,['vendor_name','vendor_nam','store_name','location_name']),
    lat:idx(h,['latitude','lat']),lng:idx(h,['longitude','lng','long']),
    mapLink:idx(h,['link','map_link','maps_link'])
  };
  var master={};
  for(var i=1;i<data.length;i++){
    var vid=cols.vendorId>=0?String(data[i][cols.vendorId]).trim():'';
    if(!vid||vid==='undefined')continue;
    var latVal=cols.lat>=0?parseFloat(String(data[i][cols.lat])):NaN;
    var lngVal=cols.lng>=0?parseFloat(String(data[i][cols.lng])):NaN;
    master[vid]={
      champion:cols.name>=0?String(data[i][cols.name]).trim():'',
      supervisor:cols.supervisor>=0?String(data[i][cols.supervisor]).trim():'',
      emirates:cols.emirates>=0?String(data[i][cols.emirates]).trim():'',
      chainName:cols.chainName>=0?String(data[i][cols.chainName]).trim():'',
      storeName:cols.vendorName>=0?String(data[i][cols.vendorName]).trim():'',
      lat:isNaN(latVal)?null:latVal,
      lng:isNaN(lngVal)?null:lngVal,
      mapLink:cols.mapLink>=0?String(data[i][cols.mapLink]).trim():''
    };
  }
  return master;
}

// ============================================================
// REFRESH — saves all periods to Drive
// ============================================================
function refreshAllData(){
  saveDriveData('master',readMasterData());
  var periods=['mtd','weekly','monthly'];
  var props=PropertiesService.getScriptProperties();
  for(var i=0;i<periods.length;i++){
    var p=periods[i];
    var orders=readOrderData(p);
    var attend=readAttendanceData(p);
    saveDriveData('orders_'+p,orders);
    saveDriveData('attend_'+p,attend);
    // Save date lists to PropertiesService — tiny, instant on startup
    props.setProperty('cpo_dates_'+p,JSON.stringify(orders.dates||[]));
  }
  // Compute and save MTD sync info
  var syncInfo=getMTDSyncInfo();
  props.setProperty('cpo_sync_date',syncInfo.syncDate||'');
  props.setProperty('cpo_sync_order_date',syncInfo.lastOrderDate||'');
  props.setProperty('cpo_sync_attend_date',syncInfo.lastAttendDate||'');
  try{archiveMonthlySnapshot_();}catch(e){Logger.log('Archive warning: '+e);}
  props.setProperty('cpo_timestamp',new Date().toISOString());
  addFetchLog('refresh','Orders + Attendance (MTD/Weekly/Monthly) + Master Data read from Sheets → Drive cache saved');
  return{success:true,timestamp:new Date().toISOString()};
}

// ============================================================
// CPO + UTR ENGINE
// UTR = Orders / (TotalPresentDays × VendorHoursPerDay)
// ============================================================
function computeCPO(period,dateIndex,userTypes,archOrders,archAttend){
  if(!userTypes)userTypes=['Picker'];
  var master=getCachedData('master');
  var orders=archOrders||getCachedData('orders_'+period);
  var attend=archAttend||getCachedData('attend_'+period);
  if(!master||!orders||!attend){
    refreshAllData();
    master=getCachedData('master'); orders=getCachedData('orders_'+period); attend=getCachedData('attend_'+period);
  }
  if(!orders||!attend)return{error:'No data. Please refresh.'};
  var dates=orders.dates||[];
  if(dates.length===0)return{error:'No date columns found.'};

  var isMTD=(period==='mtd'&&dateIndex===-1);
  var refDate=isMTD?dates[0]:(dates[dateIndex]||dates[0]);
  var dp=refDate.split('-');
  var year=parseInt(dp[0])||new Date().getFullYear();
  var month=parseInt(dp[1])||new Date().getMonth()+1;
  var workDays=getWorkingDays(month,year); if(workDays<=0)workDays=26;

  // Load ALL config once — avoid repeated PropertiesService reads inside loops
  var optimizerCfg=loadOptimizerConfig();
  var vendorRates=loadConfig('vendor_rates');
  var empCosts=loadConfig('employee_costs');
  var champEntry=resolveEffectiveEntry(empCosts,month,year,'role','Champion');
  var supEntry=resolveEffectiveEntry(empCosts,month,year,'role','City Supervisor');
  var champCost=champEntry?champEntry.baseCost:0;
  var supCost=supEntry?supEntry.baseCost:0;

  // Build vendor rate+hours lookup map once
  var vendorRateMap={};
  for(var vri=0;vri<vendorRates.length;vri++){
    var vr=vendorRates[vri];
    var nm=normalizeDept(vr.vendorName);
    var start=vr.effectiveStartYear*12+vr.effectiveStartMonth;
    var end=(vr.effectiveEndMonth===null||vr.effectiveEndYear===null)?Infinity:vr.effectiveEndYear*12+vr.effectiveEndMonth;
    var target=year*12+month;
    if(target>=start&&target<=end){
      if(!vendorRateMap[nm]||start>vendorRateMap[nm]._start){
        vendorRateMap[nm]={rate:vr.baseRate,hours:vr.hoursPerDay||10,
          otMult:vr.otMultiplier||1.5,
          ramadanHours:vr.ramadanHours||(vr.hoursPerDay||10),
          ramadanOT:vr.ramadanOT||false,
          _start:start};
      }
    }
  }
  var attendDates=attend.dates||[];
  var attendDateMap={};
  for(var ai=0;ai<attendDates.length;ai++)attendDateMap[attendDates[ai]]=ai;

  // Holiday and Ramadan date sets for OT calculation
  var configHolidays=getConfigHolidays(month,year);
  var holidaySet={};
  for(var hi=0;hi<configHolidays.length;hi++){if(configHolidays[hi].date)holidaySet[configHolidays[hi].date]=true;}
  var ramadanCfg=loadRamadanConfig();
  var ramadanSet={};
  if(ramadanCfg.start&&ramadanCfg.end){
    var dates_=attend.dates||[];
    for(var ri=0;ri<dates_.length;ri++){if(dates_[ri]>=ramadanCfg.start&&dates_[ri]<=ramadanCfg.end)ramadanSet[dates_[ri]]=true;}
  }

  // For MTD: build a set of VALID dates — dates where BOTH orders>0 AND attendance>0
  // Dates where either source is 0 are skipped (data not yet available from that source)
  var validDateSet={};
  if(isMTD){
    var orderStores=orders.stores||{};
    var attendStores=attend.byStore||{};
    for(var di=0;di<dates.length;di++){
      var dl=dates[di];
      var aIdx=attendDateMap[dl];
      if(aIdx===undefined)continue; // no attend data for this date at all
      // Check total orders > 0 for this date
      var totalO=0;
      var oVids=Object.keys(orderStores);
      for(var ovi=0;ovi<oVids.length;ovi++)totalO+=(orderStores[oVids[ovi]].values[di]||0);
      if(totalO===0)continue;
      // Check total attendance > 0 for this date
      var totalA=0;
      var aVids=Object.keys(attendStores);
      for(var avi=0;avi<aVids.length;avi++){
        var pickers=attendStores[aVids[avi]];
        for(var pki=0;pki<pickers.length;pki++)totalA+=(pickers[pki].values[aIdx]||0);
        if(totalA>0)break;
      }
      if(totalA===0)continue;
      validDateSet[dl]=1; // both orders and attendance have data
    }
  }

  var champStoreCount={},supChampions={};
  var vids=Object.keys(master);
  for(var vi=0;vi<vids.length;vi++){
    var m=master[vids[vi]];
    if(m.champion){if(!champStoreCount[m.champion])champStoreCount[m.champion]=0;champStoreCount[m.champion]++;}
    if(m.supervisor){
      if(!supChampions[m.supervisor])supChampions[m.supervisor]={};
      if(m.champion)supChampions[m.supervisor][m.champion]=1;
    }
  }

  var allIds={};
  Object.keys(orders.stores||{}).forEach(function(k){allIds[k]=1;});
  Object.keys(attend.byStore||{}).forEach(function(k){allIds[k]=1;});

  var results=[];
  Object.keys(allIds).forEach(function(vendorId){
    var so=orders.stores?orders.stores[vendorId]:null;
    var sp=attend.byStore?attend.byStore[vendorId]:null;
    var mi=master[vendorId]||{};

    var totalOrders=0;
    if(so){
      if(isMTD){
        // Only sum dates where BOTH orders and attendance have data
        for(var di=0;di<dates.length;di++){
          if(validDateSet[dates[di]])totalOrders+=so.values[di]||0;
        }
      }
      else{totalOrders=(so.values&&so.values[dateIndex])?so.values[dateIndex]:0;}
    }

    var pickerCost=0,pickerCount=0,totalPresent=0,totalHours=0;
    var deptSet={}, pickerDaysList=[], dailyCounts={};
    if(sp){
      for(var pi=0;pi<sp.length;pi++){
        var pk=sp[pi];
        var ut=(pk.userType||'Picker').trim();
        var matched=false;
        for(var ui=0;ui<userTypes.length;ui++){if(ut.toLowerCase()===userTypes[ui].toLowerCase()){matched=true;break;}}
        if(!matched)continue;
        var dept=normalizeDept(pk.department);
        var vm=vendorRateMap[dept]||{rate:0,hours:10};
        var rate=vm.rate;
        var vHours=vm.hours;
        var present=0;
        if(isMTD){
          for(var di2=0;di2<dates.length;di2++){
            if(!validDateSet[dates[di2]])continue;
            var aIdx=attendDateMap[dates[di2]];
            if(aIdx!==undefined){
              var dayVal=pk.values[aIdx]||0;
              present+=dayVal;
              if(dayVal>0)dailyCounts[dates[di2]]=(dailyCounts[dates[di2]]||0)+1;
            }
          }
        }else{
          var targetDate=dates[dateIndex];
          var aIdxSingle=attendDateMap[targetDate];
          if(aIdxSingle!==undefined)present=pk.values[aIdxSingle]||0;
        }
        if(present>0){
          var dailyR=rate/workDays;
          var hourlyR=vHours>0?dailyR/vHours:0;
          var otM=vm.otMult||1.5;
          // Count holiday and Ramadan days worked
          var holDays=0,ramDays=0;
          if(isMTD){
            for(var dih=0;dih<dates.length;dih++){
              if(!validDateSet[dates[dih]])continue;
              var aIdxH=attendDateMap[dates[dih]];
              if(aIdxH!==undefined&&(pk.values[aIdxH]||0)>0){
                if(holidaySet[dates[dih]])holDays++;
                if(ramadanSet[dates[dih]])ramDays++;
              }
            }
          } else {
            var td2=dates[dateIndex];
            if(td2&&present>0){if(holidaySet[td2])holDays++;if(ramadanSet[td2])ramDays++;}
          }
          var holExtra=holDays*dailyR*(otM-1);
          var ramExtra=0;
          if(vm.ramadanOT&&ramDays>0){
            var rHrs=vm.ramadanHours||vHours;
            if(rHrs>vHours)ramExtra=ramDays*(rHrs-vHours)*hourlyR*otM;
          }
          pickerCost+=(rate/workDays)*present+holExtra+ramExtra;
          pickerCount++;
          totalPresent+=present;
          totalHours+=present*vHours;
          deptSet[dept]=1;
          pickerDaysList.push({days:present,dept:dept,rate:rate,hours:vHours});
        }
      }
    }
    // Max concurrent pickers on any single day (for optimizer current headcount)
    var maxDailyPickers=1;
    if(isMTD){
      var dcKeys=Object.keys(dailyCounts);
      for(var dck=0;dck<dcKeys.length;dck++){if(dailyCounts[dcKeys[dck]]>maxDailyPickers)maxDailyPickers=dailyCounts[dcKeys[dck]];}
    }else{maxDailyPickers=pickerCount;}

    // Reliever detection: pickers whose days < threshold% of the most-present picker's days
    // Use max days (not workDays) as denominator so MTD partial months work correctly
    var maxPickerDays=pickerDaysList.reduce(function(m,p){return Math.max(m,p.days);},0);
    var periodDays=maxPickerDays>0?maxPickerDays:workDays;
    var relieverThrPct=optimizerCfg.relieverAttendancePct||25;
    var relievers=pickerDaysList.filter(function(p){return periodDays>0&&p.days/periodDays<relieverThrPct/100;});
    var relieverInfo={
      hasReliever:pickerDaysList.length>=2&&relievers.length>0,
      relieverCount:relievers.length,
      relieverTotalDays:relievers.reduce(function(s,p){return s+p.days;},0),
      relieverAvgRate:relievers.length>0?relievers.reduce(function(s,p){return s+p.rate;},0)/relievers.length:0,
      regularPickerCount:pickerDaysList.length-relievers.length,
      workDays:workDays
    };

    var chainName=(so&&so.chainName)?so.chainName:(mi.chainName||'');
    var vendorName=(so&&so.vendorName)?so.vendorName:(mi.storeName||vendorId);
    var champion=mi.champion||'', supervisor=mi.supervisor||'', city=mi.emirates||'';

    var periodDays=isMTD?dates.length:(period==='mtd'?1:(period==='weekly'?7:workDays));
    var champAlloc=0;
    if(champion&&champStoreCount[champion]>0)champAlloc=(champCost/champStoreCount[champion])*(periodDays/workDays);
    var supAlloc=0;
    if(supervisor&&supChampions[supervisor]){
      var supTotal=0;
      Object.keys(supChampions[supervisor]).forEach(function(sc){supTotal+=champStoreCount[sc]||0;});
      if(supTotal>0)supAlloc=(supCost/supTotal)*(periodDays/workDays);
    }

    var loadedCost=pickerCost+champAlloc+supAlloc;
    var pickerCPO=totalOrders>0?pickerCost/totalOrders:0;
    var loadedCPO=totalOrders>0?loadedCost/totalOrders:0;
    // UTR = Orders / (TotalPresentDays × HoursPerDay) → orders per hour
    var utr=(totalHours>0&&totalOrders>0)?totalOrders/totalHours:0;

    if(totalOrders>0||pickerCount>0){
      results.push({
        vendorId:vendorId,storeName:vendorName,chain:chainName,city:city,
        supervisor:supervisor,champion:champion,dept3pl:Object.keys(deptSet).join(', '),
        pickerCount:pickerCount,maxDailyPickers:maxDailyPickers,presentDays:Math.round(totalPresent*100)/100,
        orders:totalOrders,pickerCost:Math.round(pickerCost),
        pickerCPO:Math.round(pickerCPO*100)/100,
        loadedCost:Math.round(loadedCost),loadedCPO:Math.round(loadedCPO*100)/100,
        champAlloc:Math.round(champAlloc),supAlloc:Math.round(supAlloc),
        utr:Math.round(utr*10)/10,
        relieverInfo:relieverInfo
      });
    }
  });

  // MTD label: last date where BOTH orders AND attendance > 0
  var mtdLastDate=dates[0];
  if(isMTD){
    for(var li=dates.length-1;li>=0;li--){
      if(validDateSet[dates[li]]){mtdLastDate=dates[li];break;}
    }
  }

  results.sort(function(a,b){return b.orders-a.orders;});
  return{
    period:period,dateIndex:dateIndex,
    dateLabel:isMTD?'MTD ('+dates[0]+' to '+mtdLastDate+')': (dates[dateIndex]||''),
    dates:dates,month:month,year:year,workingDays:workDays,totalStores:results.length,data:results
  };
}

// Compute from archived Drive file
function computeCPOFromArchive(fileId,userTypes){
  var snap=loadArchivedMonth(fileId);
  if(snap.error)return{error:snap.error};
  return computeCPO('monthly',0,userTypes||['Picker'],snap.orders,snap.attend);
}

// Fast version — reads sync info from PropertiesService, no Drive reads
function getMTDSyncInfoFast(){
  var props=PropertiesService.getScriptProperties();
  return{
    syncDate:props.getProperty('cpo_sync_date')||null,
    lastOrderDate:props.getProperty('cpo_sync_order_date')||null,
    lastAttendDate:props.getProperty('cpo_sync_attend_date')||null
  };
}

// Full version — reads Drive, called only during Refresh
// Only counts a date as valid if BOTH total orders > 0 AND total attendance > 0
function getMTDSyncInfo(){
  var orders=getCachedData('orders_mtd'), attend=getCachedData('attend_mtd');
  if(!orders||!attend)return{syncDate:null,lastOrderDate:null,lastAttendDate:null};
  var od=orders.dates||[], ad=attend.dates||[];

  // Build set of attend dates that have actual data (at least one picker present)
  var adValidSet={};
  for(var ai=0;ai<ad.length;ai++){
    var dateLabel=ad[ai];
    var hasAttend=false;
    var byStore=attend.byStore||{};
    var storeIds=Object.keys(byStore);
    for(var si=0;si<storeIds.length;si++){
      var pickers=byStore[storeIds[si]];
      for(var pi=0;pi<pickers.length;pi++){
        if((pickers[pi].values[ai]||0)>0){hasAttend=true;break;}
      }
      if(hasAttend)break;
    }
    if(hasAttend)adValidSet[dateLabel]=1;
  }

  // Find last order date that also has orders > 0 AND attendance > 0
  var syncDate=null;
  for(var oi=od.length-1;oi>=0;oi--){
    var oDate=od[oi];
    if(!adValidSet[oDate])continue; // no attendance for this date
    // Check orders > 0 for this date
    var hasOrders=false;
    var stores=orders.stores||{};
    var vids=Object.keys(stores);
    for(var vi=0;vi<vids.length;vi++){
      if((stores[vids[vi]].values[oi]||0)>0){hasOrders=true;break;}
    }
    if(hasOrders){syncDate=oDate;break;}
  }

  return{
    syncDate:syncDate,
    lastOrderDate:od[od.length-1]||null,
    lastAttendDate:ad[ad.length-1]||null
  };
}

// ============================================================
// STARTUP — only computes MTD summary (~5s). All other periods computed on demand.
// ============================================================
function getInitialData(){
  var timestamp=getLastRefreshTime();
  if(!timestamp){refreshAllData();timestamp=getLastRefreshTime();}

  // Read date lists from PropertiesService (instant — saved on refresh)
  // Avoids opening Drive files just to get date arrays
  var props=PropertiesService.getScriptProperties();
  var periodsData={};
  var periods=['mtd','weekly','monthly'];
  for(var i=0;i<periods.length;i++){
    var p=periods[i];
    var datesJson=props.getProperty('cpo_dates_'+p);
    periodsData[p]={orderDates:datesJson?JSON.parse(datesJson):[]};
  }
  periodsData.archivedMonths=[]; // loaded lazily when user opens Historical tab
  periodsData.timestamp=timestamp;

  var config=loadAllConfig();
  var user=getCurrentUser();
  var mtdSync=getMTDSyncInfoFast(); // uses PropertiesService, not Drive

  // Use pre-computed MTD summary if available, else compute live
  var precomp=getPrecomputedData('mtd',-1,['Picker']);
  var mtdCPO=precomp||computeCPO('mtd',-1,['Picker']);

  return{
    periodsData:periodsData,
    config:config,
    user:user,
    timestamp:timestamp,
    mtdSync:mtdSync,
    mtdCPO:mtdCPO,
    masterData:getCachedData('master')||{},
    optimizerConfig:loadOptimizerConfig(),
    ramadanConfig:loadRamadanConfig(),
    holidays:loadHolidays(),
    hourlyData:loadHourlyOrderData(),
    hourlyGMVData:loadHourlyGMVData(),
    storeTimingData:loadStoreTimingData()
  };
}

function loadHourlyOrderData(){
  try{
    var cache=CacheService.getScriptCache().get('cpo_hourly');
    if(cache)return JSON.parse(cache);
    var ss=SpreadsheetApp.openById(HOURLY_SHEET_ID);
    var sheet=ss.getSheets()[0];
    var data=sheet.getDataRange().getValues();
    var result=[];
    for(var i=2;i<data.length;i++){
      var row=data[i];
      var vid=String(row[3]||'').trim();
      if(!vid||isNaN(Number(vid)))continue;
      var hourly=[];
      for(var h=0;h<24;h++)hourly.push(parseFloat(row[5+h])||0);
      result.push({vendorId:vid,storeName:String(row[4]||'').trim(),hourly:hourly});
    }
    try{CacheService.getScriptCache().put('cpo_hourly',JSON.stringify(result),1800);}catch(ce){}
    return result;
  }catch(e){Logger.log('loadHourlyOrderData: '+e);return[];}
}

// GMV data: Sheet2, same spreadsheet — 14-day totals per hour (0-23)
function loadHourlyGMVData(){
  try{
    var cache=CacheService.getScriptCache().get('cpo_hourly_gmv');
    if(cache)return JSON.parse(cache);
    var ss=SpreadsheetApp.openById(HOURLY_SHEET_ID);
    var sheet=ss.getSheetByName('Sheet2')||(ss.getSheets().length>1?ss.getSheets()[1]:null);
    if(!sheet)return[];
    var data=sheet.getDataRange().getValues();
    var result=[];
    // Row 0 = header, Row 1 = sub-header, Row 2+ = data (same layout as Sheet1)
    for(var i=2;i<data.length;i++){
      var row=data[i];
      var vid=String(row[3]||'').trim();
      if(!vid||isNaN(Number(vid)))continue;
      var gmv=[];
      for(var h=0;h<24;h++)gmv.push(parseFloat(row[5+h])||0);
      result.push({vendorId:vid,storeName:String(row[4]||'').trim(),gmv:gmv});
    }
    try{CacheService.getScriptCache().put('cpo_hourly_gmv',JSON.stringify(result),1800);}catch(ce){}
    return result;
  }catch(e){Logger.log('loadHourlyGMVData: '+e);return[];}
}

// Store timing: Sheet3 — vendor open/close times
function _extractTimeHours(val){
  if(!val)return 0;
  if(val instanceof Date)return val.getHours()+val.getMinutes()/60;
  var s=String(val).trim();
  var m=s.match(/(\d+):(\d+)(?::\d+)?(?:\s|$|\.)/);
  if(!m){m=s.match(/(\d+):(\d+)/);}
  if(m)return parseInt(m[1])+parseInt(m[2])/60;
  return 0;
}
function loadStoreTimingData(){
  try{
    var cache=CacheService.getScriptCache().get('cpo_store_timing');
    if(cache)return JSON.parse(cache);
    var ss=SpreadsheetApp.openById(HOURLY_SHEET_ID);
    var sheet=ss.getSheetByName('Sheet3')||(ss.getSheets().length>2?ss.getSheets()[2]:null);
    if(!sheet)return[];
    var data=sheet.getDataRange().getValues();
    var result=[];
    // Row 0 = header; Col B(1)=VendorID, E(4)=CloseTime, F(5)=OpenTime, G(6)=DurationHrs
    for(var i=1;i<data.length;i++){
      var row=data[i];
      var vid=String(row[1]||'').trim();
      if(!vid||isNaN(Number(vid)))continue;
      var openHr=_extractTimeHours(row[5]);
      var closeHr=_extractTimeHours(row[4]);
      var duration=parseFloat(row[6])||0;
      result.push({vendorId:vid,openHr:openHr,closeHr:closeHr,duration:duration});
    }
    try{CacheService.getScriptCache().put('cpo_store_timing',JSON.stringify(result),1800);}catch(ce){}
    return result;
  }catch(e){Logger.log('loadStoreTimingData: '+e);return[];}
}

// On-demand: checks pre-computed Drive cache first, falls back to live compute
function getCPOData(period,dateIndex,userTypes){
  var precomp=getPrecomputedData(period,dateIndex,userTypes);
  if(precomp)return precomp;
  return computeCPO(period,dateIndex,userTypes||['Picker']);
}

// ADMIN ONLY: Pre-compute ALL dates, skip already-computed past periods
// On-demand: compute ALL daily dates for trend chart
function getDailyTrendData(userTypes){
  var mtdDates=(getCachedData('orders_mtd')||{dates:[]}).dates||[];
  var results=[];
  for(var d=0;d<mtdDates.length;d++){
    results.push(computeCPO('mtd',d,userTypes||['Picker']));
  }
  return results;
}

// Historical: accepts array of fileIds, returns array of month results
function getHistoricalData(fileIds,userTypes){
  var results=[];
  for(var i=0;i<fileIds.length;i++){
    var r=computeCPOFromArchive(fileIds[i],userTypes||['Picker']);
    if(!r.error)results.push(r);
  }
  return results;
}

function getAvailablePeriods(){
  var r={};
  ['mtd','weekly','monthly'].forEach(function(p){
    var o=getCachedData('orders_'+p); r[p]=o?(o.dates||[]):[];
  });
  r.archivedMonths=listArchivedMonths();
  r.timestamp=getLastRefreshTime();
  return r;
}

// ============================================================
// ACCESS CONTROL
// ============================================================
function loadUsers(){var v=PropertiesService.getScriptProperties().getProperty('cpo_users');return v?JSON.parse(v):[];}
function saveUsers(u){PropertiesService.getScriptProperties().setProperty('cpo_users',JSON.stringify(u));return{success:true};}

function getCurrentUser(){
  var email='';
  try{email=Session.getActiveUser().getEmail().toLowerCase().trim();}catch(e){}
  if(!email)return{email:'',role:'viewer',supervisorName:''};
  var users=loadUsers();
  if(users.length===0){
    users.push({email:email,role:'admin',supervisorName:'',status:'active',addedAt:new Date().toISOString()});
    saveUsers(users); return{email:email,role:'admin',supervisorName:''};
  }
  for(var i=0;i<users.length;i++){
    if(users[i].email===email){
      if(users[i].status==='revoked')return{email:email,role:'revoked',supervisorName:''};
      return{email:email,role:users[i].role,supervisorName:users[i].supervisorName};
    }
  }
  return{email:email,role:'viewer',supervisorName:''};
}

function addUser(email,role,supervisorName){
  var users=loadUsers(); email=email.toLowerCase().trim();
  for(var i=0;i<users.length;i++){if(users[i].email===email)return{error:'User already exists'};}
  users.push({email:email,role:role,supervisorName:supervisorName||'',status:'active',addedAt:new Date().toISOString()});
  saveUsers(users); sendWelcomeEmail_(email,role,supervisorName); return{success:true};
}
function updateUserRole(email,role,supervisorName){
  var users=loadUsers(); email=email.toLowerCase().trim();
  for(var i=0;i<users.length;i++){
    if(users[i].email===email){
      var old=users[i].role; users[i].role=role; users[i].supervisorName=supervisorName||'';
      saveUsers(users); if(old!==role)sendRoleChangeEmail_(email,role,supervisorName);
      return{success:true};
    }
  }
  return{error:'User not found'};
}
function revokeUser(email){
  var users=loadUsers(); email=email.toLowerCase().trim();
  for(var i=0;i<users.length;i++){if(users[i].email===email){users[i].status='revoked';saveUsers(users);sendRevokedEmail_(email);return{success:true};}}
  return{error:'User not found'};
}
function reinstateUser(email){
  var users=loadUsers(); email=email.toLowerCase().trim();
  for(var i=0;i<users.length;i++){if(users[i].email===email){users[i].status='active';delete users[i].revokedAt;saveUsers(users);sendReinstateEmail_(email,users[i].role,users[i].supervisorName);return{success:true};}}
  return{error:'User not found'};
}
function removeUser(email){
  email=email.toLowerCase().trim();
  saveUsers(loadUsers().filter(function(u){return u.email!==email;}));
  return{success:true};
}
function resendInvite(email){
  var users=loadUsers(); email=email.toLowerCase().trim();
  for(var i=0;i<users.length;i++){if(users[i].email===email){saveUsers(users);sendWelcomeEmail_(email,users[i].role,users[i].supervisorName);return{success:true};}}
  return{error:'User not found'};
}
function getSupervisorList(){
  var master=getCachedData('master')||{}; var sups={};
  Object.keys(master).forEach(function(k){if(master[k].supervisor)sups[master[k].supervisor]=1;});
  return Object.keys(sups).sort();
}
function getAppUrl_(){return ScriptApp.getService().getUrl();}
function getAppUrl(){return getAppUrl_();}

// ============================================================
// EMAIL HELPERS + REPORTS (condensed)
// ============================================================
function buildUserEmailHtml_(title,greeting,bodyLines,ctaText,ctaUrl){
  var h='<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #e5e0db;">';
  h+='<div style="background:#411517;color:#fff;padding:24px 32px;"><h1 style="margin:0;font-size:20px;">talabat <span style="color:#FF5A00;">LS</span> — CPO Check</h1><p style="margin:6px 0 0;font-size:13px;opacity:.8;">'+title+'</p></div>';
  h+='<div style="padding:28px 32px;"><p style="font-size:14px;color:#411517;margin:0 0 16px;">'+greeting+'</p>';
  for(var i=0;i<bodyLines.length;i++)h+='<p style="font-size:13px;color:#555;margin:0 0 10px;line-height:1.6;">'+bodyLines[i]+'</p>';
  if(ctaText&&ctaUrl)h+='<div style="text-align:center;margin:24px 0;"><a href="'+ctaUrl+'" style="display:inline-block;padding:12px 32px;background:#FF5A00;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">'+ctaText+'</a></div>';
  h+='<hr style="border:none;border-top:1px solid #e5e0db;margin:24px 0;"><p style="font-size:11px;color:#999;margin:0;">Automated from talabat LS CPO Check.</p></div></div>';
  return h;
}
function getRoleDesc_(r){
  if(r==='admin')return'Full access.';if(r==='manager')return'View all stores.';
  if(r==='supervisor')return'View your assigned stores.';return'Limited view.';
}
function sendWelcomeEmail_(email,role,sup){
  var url=getAppUrl_();
  try{GmailApp.sendEmail(email,'Access granted — talabat LS CPO Check','',{
    htmlBody:buildUserEmailHtml_('Access Granted','Hello,',['You have access to CPO Check as <strong>'+role+'</strong>.'+(sup?'<br>Supervisor area: '+sup:''),'Click below to open.'],'Open Dashboard',url),
    name:'talabat LS CPO Check'
  });}catch(e){Logger.log('Email err: '+e);}
}
function sendRoleChangeEmail_(email,role,sup){
  var url=getAppUrl_();
  try{GmailApp.sendEmail(email,'Your CPO Check role was updated','',{
    htmlBody:buildUserEmailHtml_('Role Updated','Hello,',['Your role is now <strong>'+role+'</strong>.'+(sup?'<br>Supervisor area: '+sup:'')],'Open Dashboard',url),
    name:'talabat LS CPO Check'
  });}catch(e){Logger.log('Email err: '+e);}
}
function sendRevokedEmail_(email){
  try{GmailApp.sendEmail(email,'CPO Check access revoked','',{
    htmlBody:buildUserEmailHtml_('Access Revoked','Hello,',['Your access has been revoked. Contact your admin.'],null,null),
    name:'talabat LS CPO Check'
  });}catch(e){Logger.log('Email err: '+e);}
}
function sendReinstateEmail_(email,role,sup){
  var url=getAppUrl_();
  try{GmailApp.sendEmail(email,'CPO Check access reinstated','',{
    htmlBody:buildUserEmailHtml_('Access Reinstated','Hello,',['Your access has been reinstated as <strong>'+role+'</strong>.'],'Open Dashboard',url),
    name:'talabat LS CPO Check'
  });}catch(e){Logger.log('Email err: '+e);}
}

function fmtNum(n){if(n==null)return'0';return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g,',');}

function buildReportEmail(supervisorName,data,dateLabel,reportType){
  var totalOrders=0,totalCost=0;
  data.forEach(function(r){totalOrders+=r.orders;totalCost+=r.pickerCost;});
  var avgCPO=totalOrders>0?totalCost/totalOrders:0;
  var cpos=data.map(function(r){return r.pickerCPO;}).filter(function(v){return v>0;}).sort(function(a,b){return a-b;});
  var p75=cpos.length>0?cpos[Math.floor(cpos.length*0.75)]:0;
  var td='padding:8px 12px;border-bottom:1px solid #e5e0db;font-size:12px;';
  var h='<div style="font-family:Arial,sans-serif;max-width:800px;margin:0 auto;">';
  h+='<div style="background:#411517;color:#fff;padding:24px 32px;"><h1 style="margin:0;font-size:22px;">talabat <span style="color:#FF5A00;">LS</span> — CPO Check</h1>';
  h+='<p style="margin:6px 0 0;font-size:14px;opacity:.85;">'+reportType+' Report — '+dateLabel+'</p></div>';
  h+='<div style="padding:24px 32px;background:#F4EDE3;"><p>Dear <strong>'+supervisorName+'</strong>,</p>';
  h+='<div style="display:flex;gap:12px;margin:16px 0;">';
  h+='<div style="flex:1;background:#fff;padding:16px;border-radius:8px;border-left:4px solid #FF5A00;"><div style="font-size:11px;color:#888;">ORDERS</div><div style="font-size:24px;font-weight:700;color:#411517;">'+fmtNum(totalOrders)+'</div></div>';
  h+='<div style="flex:1;background:#fff;padding:16px;border-radius:8px;border-left:4px solid #059669;"><div style="font-size:11px;color:#888;">AVG CPO</div><div style="font-size:24px;font-weight:700;color:#411517;">AED '+avgCPO.toFixed(2)+'</div></div>';
  h+='<div style="flex:1;background:#fff;padding:16px;border-radius:8px;border-left:4px solid #FF5A00;"><div style="font-size:11px;color:#888;">STORES</div><div style="font-size:24px;font-weight:700;color:#411517;">'+data.length+'</div></div>';
  h+='</div><table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;">';
  h+='<tr style="background:#411517;color:#fff;"><th style="'+td+'text-align:left;color:#fff;">Store</th><th style="'+td+'text-align:right;color:#fff;">Orders</th><th style="'+td+'text-align:right;color:#fff;">CPO</th><th style="'+td+'text-align:right;color:#fff;">UTR</th></tr>';
  data.sort(function(a,b){return b.pickerCPO-a.pickerCPO;}).forEach(function(r,i){
    var hi=r.pickerCPO>p75&&r.pickerCPO>0;
    h+='<tr style="background:'+(hi?'#fef2f2':(i%2===0?'#fff':'#faf6f1'))+';">';
    h+='<td style="'+td+'">'+r.storeName+'</td><td style="'+td+'text-align:right;">'+fmtNum(r.orders)+'</td>';
    h+='<td style="'+td+'text-align:right;font-weight:700;color:'+(hi?'#dc2626':'#059669')+';">'+(hi?'⚠ ':'')+'AED '+r.pickerCPO.toFixed(2)+'</td>';
    h+='<td style="'+td+'text-align:right;">'+(r.utr?r.utr.toFixed(3):'—')+'</td></tr>';
  });
  h+='</table><p style="font-size:11px;color:#999;margin-top:24px;">Automated report — talabat LS CPO Check.</p></div></div>';
  return h;
}

function sendWeeklyReports(){
  var cfg=loadConfig('email_settings').filter(function(s){return s.type==='weekly'&&s.enabled;})[0];
  if(!cfg)return{skipped:true};
  refreshAllData(); var cpo=computeCPO('weekly',0,['Picker']); if(cpo.error)return{error:cpo.error};
  var sent=0;
  loadUsers().forEach(function(u){
    if(u.role!=='supervisor'||!u.supervisorName)return;
    var d=cpo.data.filter(function(r){return r.supervisor===u.supervisorName;});
    if(!d.length)return;
    try{GmailApp.sendEmail(u.email,(cfg.subject||'Weekly CPO Report')+' — '+cpo.dateLabel,'',{htmlBody:buildReportEmail(u.supervisorName,d,cpo.dateLabel,'Weekly'),name:'talabat LS CPO Check'});sent++;}
    catch(e){Logger.log('Email err: '+e);}
  });
  return{success:true,sent:sent};
}
function sendMonthlyReports(){
  var cfg=loadConfig('email_settings').filter(function(s){return s.type==='monthly'&&s.enabled;})[0];
  if(!cfg)return{skipped:true};
  refreshAllData(); var cpo=computeCPO('monthly',0,['Picker']); if(cpo.error)return{error:cpo.error};
  var sent=0;
  loadUsers().forEach(function(u){
    if(u.role!=='supervisor'||!u.supervisorName)return;
    var d=cpo.data.filter(function(r){return r.supervisor===u.supervisorName;});
    if(!d.length)return;
    try{GmailApp.sendEmail(u.email,(cfg.subject||'Monthly CPO Report')+' — '+cpo.dateLabel,'',{htmlBody:buildReportEmail(u.supervisorName,d,cpo.dateLabel,'Monthly'),name:'talabat LS CPO Check'});sent++;}
    catch(e){Logger.log('Email err: '+e);}
  });
  return{success:true,sent:sent};
}
function sendTestEmail(to,period){
  if(!getCachedData('master'))refreshAllData();
  var p=period==='monthly'?'monthly':'mtd', idx=period==='monthly'?0:-1;
  var cpo=computeCPO(p,idx,['Picker']); if(cpo.error)throw new Error(cpo.error);
  GmailApp.sendEmail(to,'Test CPO Report — '+cpo.dateLabel,'',{htmlBody:buildReportEmail('All',cpo.data,cpo.dateLabel,period==='monthly'?'Monthly':'Weekly'),name:'talabat LS CPO Check'});
  return{success:true};
}

// ============================================================
// TRIGGERS
// ============================================================
function setupWeeklyTrigger(){removeTrigger_('sendWeeklyReports');ScriptApp.newTrigger('sendWeeklyReports').timeBased().everyWeeks(1).onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(8).create();return{success:true,message:'Weekly trigger set'};}
function setupMonthlyTrigger(){removeTrigger_('sendMonthlyReports');ScriptApp.newTrigger('sendMonthlyReports').timeBased().onMonthDay(1).atHour(8).create();return{success:true,message:'Monthly trigger set'};}
function removeTrigger_(fn){ScriptApp.getProjectTriggers().forEach(function(t){if(t.getHandlerFunction()===fn)ScriptApp.deleteTrigger(t);});}
function getActiveTriggers(){return ScriptApp.getProjectTriggers().map(function(t){return{func:t.getHandlerFunction(),type:String(t.getEventType())};});}
function precomputeAllData(){return{success:true,log:['Use batch approach — call getPrecomputePlan then computeBatch']};} // legacy stub

// ADMIN: Returns full batch plan — what needs computing, grouped into small batches
// Frontend calls computeBatch(batchIndex, plan) one at a time — no timeout risk
function getPrecomputePlan(){
  var props=PropertiesService.getScriptProperties();
  var today=new Date();
  var currentYM=today.getFullYear()+'-'+(today.getMonth()<9?'0':'')+(today.getMonth()+1);

  // Buffer periods — always recompute even if previously marked done
  // Monthly: current month + last 1 month (attendance arrives late)
  // Weekly:  current week + last 2 weeks (attendance arrives late)
  // MTD:     always recompute everything (data changes daily)
  var prevMonth=new Date(today.getFullYear(),today.getMonth()-1,1);
  var prevMonthYM=prevMonth.getFullYear()+'-'+(prevMonth.getMonth()<9?'0':'')+(prevMonth.getMonth()+1);
  var prev2Month=new Date(today.getFullYear(),today.getMonth()-2,1);
  var prev2MonthYM=prev2Month.getFullYear()+'-'+(prev2Month.getMonth()<9?'0':'')+(prev2Month.getMonth()+1);

  var doneKeys=loadDriveData('precomp_done')||{};

  var batches=[];
  var configs=[
    {period:'monthly',batchSize:1},
    {period:'weekly', batchSize:2},
    {period:'mtd',    batchSize:3}
  ];

  for(var ci=0;ci<configs.length;ci++){
    var p=configs[ci].period, batchSize=configs[ci].batchSize;
    var datesJson=props.getProperty('cpo_dates_'+p);
    var dates=datesJson?JSON.parse(datesJson):[];
    var group=[];
    var totalDates=dates.length;

    for(var d=0;d<totalDates;d++){
      var dateLabel=dates[d]?dates[d].substring(0,7):''; // yyyy-MM for comparison
      var isFuture=dateLabel>currentYM;
      var key='precomp_'+p+'_'+d;

      if(isFuture)continue; // skip future — no data yet

      // Decide if this date is in the "always recompute" buffer
      var alwaysRecompute=false;
      if(p==='mtd'){
        alwaysRecompute=true; // MTD: always recompute all dates (data changes daily)
      } else if(p==='monthly'){
        // Current month + last 1 month buffer
        alwaysRecompute=(dateLabel>=prevMonthYM);
      } else if(p==='weekly'){
        // Current week + last 2 weeks: use last 3 date indices as buffer
        alwaysRecompute=(d>=totalDates-3);
      }

      // Skip if already done AND not in buffer
      if(!alwaysRecompute&&doneKeys[key])continue;

      group.push({period:p,dateIndex:d,label:dates[d]?dates[d].substring(0,10):''});
      if(group.length>=batchSize){batches.push({items:group.slice()});group=[];}
    }
    if(group.length>0)batches.push({items:group});
  }

  // MTD summary always recomputed last
  batches.push({items:[{period:'mtd',dateIndex:-1,label:'MTD Summary'}]});
  return{batches:batches,total:batches.length};
}

// Mark keys as done — but NEVER mark MTD or buffer periods as permanently done
function computeBatch(batchIndex,plan){
  var props=PropertiesService.getScriptProperties();
  var today=new Date();
  var currentYM=today.getFullYear()+'-'+(today.getMonth()<9?'0':'')+(today.getMonth()+1);
  var prevMonth=new Date(today.getFullYear(),today.getMonth()-1,1);
  var prevMonthYM=prevMonth.getFullYear()+'-'+(prevMonth.getMonth()<9?'0':'')+(prevMonth.getMonth()+1);

  var userTypes=['Picker'];
  var items=plan[batchIndex]?plan[batchIndex].items:[];
  var done=[];

  var doneKeys=loadDriveData('precomp_done')||{};

  // Get total weekly dates count for buffer calculation
  var wDatesJson=props.getProperty('cpo_dates_weekly');
  var wDates=wDatesJson?JSON.parse(wDatesJson):[];
  var totalWeekly=wDates.length;

  for(var i=0;i<items.length;i++){
    var item=items[i];
    var key=item.dateIndex===-1?'precomp_mtd_summary':'precomp_'+item.period+'_'+item.dateIndex;
    var result=computeCPO(item.period,item.dateIndex,userTypes);
    saveDriveData(key,result);

    // Only permanently mark done if it's a safely past period (outside buffer)
    var markDone=false;
    if(item.period==='mtd'){
      markDone=false; // MTD: never permanently done
    } else if(item.period==='monthly'){
      var dlYM=item.label?item.label.substring(0,7):'';
      markDone=(dlYM<prevMonthYM); // only months older than last month
    } else if(item.period==='weekly'){
      markDone=(item.dateIndex<totalWeekly-3); // only weeks older than last 3
    } else {
      markDone=true;
    }
    if(markDone)doneKeys[key]=1;

    done.push(item.label||item.period+'['+item.dateIndex+']');
  }

  saveDriveData('precomp_done',doneKeys);

  addFetchLog('fetchall_batch','Batch '+(batchIndex+1)+'/'+plan.length+': '+done.join(', '));

  if(batchIndex>=plan.length-1){
    props.setProperty('cpo_precomputed','true');
    props.setProperty('cpo_precomp_timestamp',new Date().toISOString());
    // Refresh hourly order + GMV data cache as part of final batch
    try{
      CacheService.getScriptCache().remove('cpo_hourly');
      var hourlyResult=loadHourlyOrderData();
      addFetchLog('hourly_refresh','Hourly order data re-fetched: '+hourlyResult.length+' stores cached');
    }catch(he){Logger.log('Hourly refresh error: '+he);}
    try{
      CacheService.getScriptCache().remove('cpo_hourly_gmv');
      var gmvResult=loadHourlyGMVData();
      addFetchLog('hourly_gmv_refresh','Hourly GMV data re-fetched: '+gmvResult.length+' stores cached');
    }catch(ge){Logger.log('GMV refresh error: '+ge);}
    addFetchLog('fetchall_done','Fetch All complete — '+plan.length+' batches processed. All users get instant tab switches.');
  }
  return{success:true,computed:done,batchIndex:batchIndex,totalBatches:plan.length};
}

// Check if pre-computed data exists and return it
function getPrecomputedData(period,dateIndex,userTypes){
  var key='precomp_'+period+'_'+(dateIndex===-1?'summary':dateIndex);
  var cached=loadDriveData(key);
  if(!cached)return null;
  if(userTypes&&userTypes.join(',')!=='Picker')return null;
  return cached;
}

function getPrecomputeStatus(){
  var props=PropertiesService.getScriptProperties();
  var done=props.getProperty('cpo_precomputed')==='true';
  var doneKeys=loadDriveData('precomp_done')||{};
  var fileCount=Object.keys(doneKeys).length;
  return{
    done:done,
    timestamp:props.getProperty('cpo_precomp_timestamp')||null,
    fileCount:fileCount,
    log:getFetchLog()
  };
}

function addFetchLog(type,detail){
  var log=loadDriveData('fetch_log')||[];
  log.unshift({ts:new Date().toISOString(),type:type,detail:String(detail||'')});
  if(log.length>100)log=log.slice(0,100);
  try{saveDriveData('fetch_log',log);}catch(e){}
}

function getFetchLog(){
  return loadDriveData('fetch_log')||[];
}

function clearFetchLog(){
  saveDriveData('fetch_log',[]);
  return{success:true};
}

// ── Auto-fetch scheduler ──────────────────────────────────────────
// Runs full refresh + all compute batches server-side (called by time trigger or browser)
function scheduledFetch(){
  var start=new Date().getTime();
  // Step 1: refresh raw sheet data (orders, attendance, master → Drive cache)
  try{refreshAllData();addFetchLog('auto_fetch','Step 1/4: Sheet data refreshed (orders + attendance + master)');}
  catch(e){addFetchLog('auto_fetch_error','Sheet refresh failed: '+e.message);}
  // Step 2: hourly order data
  try{CacheService.getScriptCache().remove('cpo_hourly');loadHourlyOrderData();addFetchLog('auto_fetch','Step 2/4: Hourly order data refreshed');}
  catch(e){addFetchLog('auto_fetch_error','Hourly orders failed: '+e.message);}
  // Step 3: hourly GMV data
  try{CacheService.getScriptCache().remove('cpo_hourly_gmv');loadHourlyGMVData();addFetchLog('auto_fetch','Step 3/4: Hourly GMV data refreshed');}
  catch(e){addFetchLog('auto_fetch_error','Hourly GMV failed: '+e.message);}
  // Step 4: store timing (Sheet3)
  try{CacheService.getScriptCache().remove('cpo_store_timing');loadStoreTimingData();addFetchLog('auto_fetch','Step 4/4: Store timing data refreshed (Sheet3)');}
  catch(e){addFetchLog('auto_fetch_error','Store timing failed: '+e.message);}
  // Step 5: compute all CPO batches
  var plan=getPrecomputePlan().batches;
  var processed=0;
  for(var i=0;i<plan.length;i++){
    if(new Date().getTime()-start>300000)break; // 5-min safety
    try{computeBatch(i,plan);processed++;}catch(e){addFetchLog('auto_fetch_error','Batch '+i+': '+e.message);}
  }
  addFetchLog('auto_fetch','Scheduled fetch complete — '+processed+'/'+plan.length+' CPO batches processed');
}

// Create or replace two daily triggers for scheduledFetch
function setupAutoFetch(hour1,hour2){
  removeTrigger_('scheduledFetch');
  ScriptApp.newTrigger('scheduledFetch').timeBased().atHour(hour1).everyDays(1).create();
  ScriptApp.newTrigger('scheduledFetch').timeBased().atHour(hour2).everyDays(1).create();
  PropertiesService.getScriptProperties().setProperty('cpo_auto_fetch_hours',JSON.stringify([hour1,hour2]));
  addFetchLog('auto_fetch_schedule','Auto-fetch scheduled at '+hour1+':00 and '+hour2+':00 daily');
  return{success:true};
}

function disableAutoFetch(){
  removeTrigger_('scheduledFetch');
  PropertiesService.getScriptProperties().deleteProperty('cpo_auto_fetch_hours');
  addFetchLog('auto_fetch_schedule','Auto-fetch disabled');
  return{success:true};
}

function getAutoFetchConfig(){
  var v=PropertiesService.getScriptProperties().getProperty('cpo_auto_fetch_hours');
  var triggers=ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()==='scheduledFetch';});
  return{hours:v?JSON.parse(v):null,activeTriggers:triggers.length};
}

// Kick off a background fetch in ~10 s — continues even if the browser tab closes
function triggerFetchNow(){
  ScriptApp.newTrigger('scheduledFetch').timeBased().after(10000).create();
  addFetchLog('fetch_triggered','Background fetch queued — starts in ~10 seconds');
  return{success:true};
}

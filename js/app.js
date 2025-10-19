// ===== Constants =====
const API_BASE = 'https://grippo-app.com';
const LIST_ENDPOINT   = `${API_BASE}/exercise-examples`;
const DETAIL_ENDPOINT = (id) => `${API_BASE}/exercise-examples/${encodeURIComponent(id)}`;
const CREATE_ENDPOINT = `${API_BASE}/exercise-examples`;
const PUT_ENDPOINT    = (id) => `${API_BASE}/exercise-examples?id=${encodeURIComponent(id)}`;

const LOGIN_ENDPOINT = `${API_BASE}/auth/login`;

const EQUIPMENT_GROUPS_ENDPOINT = `${API_BASE}/equipments`;
const MUSCLE_GROUPS_ENDPOINT    = `${API_BASE}/muscles`;

const FIELD = {
  equipmentRefs: 'equipmentRefs',
  bundles: 'exerciseExampleBundles',
  muscleId: 'muscleId',
  percentage: 'percentage'
};

const SUPPORTED_LANGUAGES = ['en','ua','ru'];
const DEFAULT_LANGUAGE = 'en';
const LOCALE_STORAGE_KEY = 'grippo_admin_locale';

// ===== State =====
let items = [];
let filtered = [];
let current = null;
let isNew = false;
let currentSort = 'name';
let activeLocale = DEFAULT_LANGUAGE;
try {
  const storedLocale = localStorage.getItem(LOCALE_STORAGE_KEY);
  if (storedLocale && SUPPORTED_LANGUAGES.includes(storedLocale)) {
    activeLocale = storedLocale;
  }
} catch {}

// Persisted view mode (form or json) shared across exercises
let viewMode = 'form';
try { viewMode = localStorage.getItem('grippo_view_mode') || 'form'; } catch {}

function persistViewMode(){
  try { localStorage.setItem('grippo_view_mode', viewMode); } catch{}
}

function applyViewMode(){
  if (viewMode === 'json') setViewJson();
  else setViewForm();
}

// Edited-in-session tracking
let editedIds = new Set();
function loadEdited(){
  try{
    const raw = sessionStorage.getItem('grippo_edited_ids') || '[]';
    const arr = JSON.parse(raw);
    editedIds = new Set(Array.isArray(arr) ? arr : []);
  }catch{ editedIds = new Set(); }
}
function persistEdited(){
  try{ sessionStorage.setItem('grippo_edited_ids', JSON.stringify([...editedIds])); }catch{}
}
function markEdited(id){
  if(!id) return;
  editedIds.add(String(id));
  persistEdited();
}
function isEdited(id){
  return id ? editedIds.has(String(id)) : false;
}

// Dictionaries (id -> name)
const dict = { equipment: new Map(), muscles: new Map() };

// ===== Elements =====
const els = {
  load: document.getElementById('loadBtn'),

  list: document.getElementById('list'),
  search: document.getElementById('search'),
  sortDropdown: document.getElementById('sortDropdown'),
  sortToggle: document.getElementById('sortToggle'),
  sortMenu: document.getElementById('sortMenu'),
  sortLabel: document.getElementById('sortLabel'),
  clearSearch: document.getElementById('clearSearch'),
  mobileBackBtn: document.getElementById('mobileBackBtn'),
  newBtn: document.getElementById('newBtn'),

  currentId: document.getElementById('currentId'),
  jsonStatus: document.getElementById('jsonStatus'),
  localeSwitcher: document.getElementById('localeSwitcher'),
  saveBtn: document.getElementById('saveBtn'),
  promptBtn: document.getElementById('promptBtn'),
  promptImgBtn: document.getElementById('promptImgBtn'),

  viewForm: document.getElementById('viewForm'),
  viewJson: document.getElementById('viewJson'),
    builder: document.getElementById('builder'),
    editorWrap: document.getElementById('jsonWrap'),
    editor: document.getElementById('editor'),
    clearJsonBtn: document.getElementById('clearJsonBtn'),

  mobileFab: document.getElementById('mobileFab'),
  mobileFabToggle: document.getElementById('fabToggle'),

  main: document.querySelector('main'),

  fName: document.getElementById('fName'),
  fImage: document.getElementById('fImage'),
  fDescription: document.getElementById('fDescription'),
  fWeightType: document.getElementById('fWeightType'),
  fCategory: document.getElementById('fCategory'),
  fExperience: document.getElementById('fExperience'),
  fForceType: document.getElementById('fForceType'),
  fId: document.getElementById('fId'),

  equipTokens: document.getElementById('equipTokens'),
  equipSingle: document.getElementById('equipSingle'),
  equipAdd: document.getElementById('equipAdd'),
  equipClear: document.getElementById('equipClear'),

  bundles: document.getElementById('bundles'),
  muscleSelect: document.getElementById('muscleSelect'),
  percentInput: document.getElementById('percentInput'),
  bundleAdd: document.getElementById('bundleAdd'),
  bundleSumInfo: document.getElementById('bundleSumInfo'),

  itemTemplate: document.querySelector('#itemTemplate')
};

const localeButtons = Array.from(els.localeSwitcher?.querySelectorAll('[data-locale]') || []);
const defaultNamePlaceholder = els.fName?.getAttribute('placeholder') || '';
const defaultDescriptionPlaceholder = els.fDescription?.getAttribute('placeholder') || '';

function createEmptyTranslations(){
  const map = {};
  for (const lang of SUPPORTED_LANGUAGES){ map[lang] = ''; }
  return map;
}

function ensureTranslationMap(value){
  const base = createEmptyTranslations();
  if (!value || typeof value !== 'object') return base;
  for (const lang of SUPPORTED_LANGUAGES){
    const raw = value[lang];
    if (typeof raw === 'string') base[lang] = raw;
    else if (raw != null) base[lang] = String(raw);
  }
  return base;
}

function getTranslation(map, lang){
  if (!map || typeof map !== 'object') return '';
  const raw = map[lang];
  return typeof raw === 'string' ? raw : '';
}

function sanitizeTranslationPayload(map){
  const payload = {};
  if (!map || typeof map !== 'object') return payload;
  for (const lang of SUPPORTED_LANGUAGES){
    const raw = map[lang];
    if (typeof raw === 'string'){
      const trimmed = raw.trim();
      if (trimmed) payload[lang] = trimmed;
    }
  }
  return payload;
}

function buildHeaders({json = false, auth = true, accept = true} = {}){
  const headers = {};
  if (accept) headers.accept = 'application/json';
  headers['accept-language'] = activeLocale;
  if (json) headers['content-type'] = 'application/json';
  if (auth){
    Object.assign(headers, bearer());
  }
  return headers;
}

function buildLocalePlaceholder(basePlaceholder, fallbackValue, locale){
  if (locale === DEFAULT_LANGUAGE) return basePlaceholder;
  if (!fallbackValue) return basePlaceholder;
  return `${fallbackValue} (${DEFAULT_LANGUAGE.toUpperCase()} fallback)`;
}

function buildPersistencePayload(entity){
  const payload = {...entity};
  payload.nameTranslations = sanitizeTranslationPayload(entity.nameTranslations);
  payload.descriptionTranslations = sanitizeTranslationPayload(entity.descriptionTranslations);
  const defaultName = getTranslation(entity.nameTranslations, DEFAULT_LANGUAGE).trim();
  const defaultDescription = getTranslation(entity.descriptionTranslations, DEFAULT_LANGUAGE).trim();
  payload.name = defaultName;
  payload.description = defaultDescription;
  delete payload.translations;
  delete payload.localizedName;
  delete payload.localizedDescription;
  return payload;
}

function updateLocaleUI(){
  if (!els.localeSwitcher) return;
  els.localeSwitcher.setAttribute('data-active-locale', activeLocale);
  localeButtons.forEach(btn => {
    const lang = btn?.dataset?.locale;
    if (!lang) return;
    const isActive = lang === activeLocale;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', String(isActive));
    btn.disabled = isActive;
  });
}

// Login elements
els.loginOverlay = document.getElementById('loginOverlay');
els.loginForm = document.getElementById('loginForm');
els.loginEmail = document.getElementById('loginEmail');
els.loginPassword = document.getElementById('loginPassword');
els.loginError = document.getElementById('loginError');
els.logoutBtn = document.getElementById('logoutBtn');

// ===== Utilities =====
function toast({title, message = '', type = 'success', ms = 3000}) {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<div class="title">${title}</div>${message ? `<div>${message}</div>` : ''}`;
  document.body.appendChild(t);
  setTimeout(()=>t.remove(), ms);
}
let authToken = '';
function saveTokenLocal(v){ localStorage.setItem('grippo_admin_token', v || ''); }
function loadTokenLocal(){ return localStorage.getItem('grippo_admin_token') || ''; }
function bearer(){ return authToken ? {'Authorization': `Bearer ${authToken}`} : {}; }
function pretty(json){ return JSON.stringify(json, null, 2); }
function logout(){ authToken=''; saveTokenLocal(''); localStorage.removeItem('grippo_admin_refresh'); if(els.loginOverlay) els.loginOverlay.style.display='flex'; }
function formatIso(d){ try{ return new Date(d).toISOString().replace('T',' ').replace('Z','Z'); }catch{ return String(d); } }
function setStatus(kind, text){ els.jsonStatus.className = `status ${kind}`; els.jsonStatus.textContent = text; }
function uuidv4(){
  if (crypto?.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c=>{
    const r=(Math.random()*16)|0, v=c==='x'?r:(r&0x3|0x8); return v.toString(16);
  });
}
function updateStickyOffsets(){
  const header = document.querySelector('header');
  const bar = document.getElementById('commandBar');
  const h = header ? header.offsetHeight : 64;
  const b = bar ? bar.offsetHeight : 56;
  document.documentElement.style.setProperty('--header-h', h + 'px');
  document.documentElement.style.setProperty('--commandbar-h', b + 'px');
}
function autosizeEditor(){
  /* no-op: editor uses internal scrolling */
}

// ---- Visibility helpers (hide controls when nothing selected/new) ----
function hasActiveItem(){
  return isNew || !!(current && current.entity && current.entity.id);
}
function toggle(el, show){
  if (!el) return;
  el.style.display = show ? '' : 'none';
}

// ===== Sorting =====
const collator = (typeof Intl !== 'undefined' && Intl.Collator)
  ? new Intl.Collator(undefined, {sensitivity:'base', numeric:true})
  : null;

const SORT_OPTIONS = {
  name: {
    label: 'Имя',
    compare: (a, b) => compareByName(a, b)
  },
  createdAt: {
    label: 'Дата создания',
    compare: (a, b) => {
      const diff = getCreatedAtStamp(b) - getCreatedAtStamp(a);
      return diff !== 0 ? diff : compareByName(a, b);
    }
  },
  hasImage: {
    label: 'Наличие картинки',
    compare: (a, b) => {
      const diff = Number(itemHasImage(b)) - Number(itemHasImage(a));
      return diff !== 0 ? diff : compareByName(a, b);
    }
  },
  missingImage: {
    label: 'Отсутствие картинки',
    compare: (a, b) => {
      const diff = Number(!itemHasImage(b)) - Number(!itemHasImage(a));
      return diff !== 0 ? diff : compareByName(a, b);
    }
  }
};

function safeString(value){
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  try{ return String(value); }
  catch{ return ''; }
}

function compareStrings(a, b){
  const strA = safeString(a);
  const strB = safeString(b);
  if (collator) return collator.compare(strA, strB);
  const cmp = strA.toLowerCase().localeCompare(strB.toLowerCase());
  if (cmp !== 0) return cmp;
  return strA.localeCompare(strB);
}

function getItemName(it){
  return safeString(it?.entity?.name ?? it?.name ?? '').trim();
}

function compareByName(a, b){
  const nameA = getItemName(a);
  const nameB = getItemName(b);
  const cmp = compareStrings(nameA, nameB);
  if (cmp !== 0) return cmp;
  const idA = safeString(a?.entity?.id ?? a?.id ?? '');
  const idB = safeString(b?.entity?.id ?? b?.id ?? '');
  return compareStrings(idA, idB);
}

function toTimestamp(value){
  if (typeof value === 'number' && isFinite(value)) return value;
  if (value instanceof Date){
    const ts = value.getTime();
    return Number.isFinite(ts) ? ts : 0;
  }
  if (typeof value === 'string' && value.trim()){
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function getCreatedAtStamp(it){
  const raw = it?.entity?.createdAt ?? it?.entity?.created_at ?? it?.createdAt ?? it?.created_at ?? null;
  return toTimestamp(raw);
}

function itemHasImage(it){
  const raw = it?.entity?.imageUrl ?? it?.entity?.image_url ?? it?.entity?.image ?? it?.imageUrl ?? it?.image_url ?? it?.image ?? '';
  return typeof raw === 'string' && raw.trim() !== '';
}

function applySort(){
  if (!Array.isArray(filtered)) filtered = [];
  const sorter = SORT_OPTIONS[currentSort] || SORT_OPTIONS.name;
  filtered.sort((a, b) => sorter.compare(a, b));
}

function updateSortUI(){
  const opt = SORT_OPTIONS[currentSort] || SORT_OPTIONS.name;
  if (els.sortLabel) els.sortLabel.textContent = opt.label;
  if (els.sortMenu){
    els.sortMenu.querySelectorAll('[data-sort]').forEach(btn => {
      const key = btn.getAttribute('data-sort');
      const active = key === currentSort;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-checked', active ? 'true' : 'false');
    });
  }
}

function positionSortMenu(){
  if (!els.sortDropdown || !els.sortMenu || !els.sortToggle) return;
  if (!els.sortDropdown.classList.contains('open')) return;

  const menu = els.sortMenu;
  const toggleRect = els.sortToggle.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth || 0;
  const gutter = 12;

  // Force layout so width is measured correctly.
  const menuWidth = menu.offsetWidth;

  let left = toggleRect.right - menuWidth;
  if (left < gutter) left = gutter;
  if (left + menuWidth > viewportWidth - gutter) {
    left = Math.max(gutter, viewportWidth - gutter - menuWidth);
  }

  const top = toggleRect.bottom + 8;

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function openSortMenu(){
  if (!els.sortDropdown) return;
  els.sortDropdown.classList.add('open');
  if (els.sortToggle) els.sortToggle.setAttribute('aria-expanded', 'true');
  positionSortMenu();
  if (els.sortMenu){
    const active = els.sortMenu.querySelector(`[data-sort="${currentSort}"]`);
    if (active) active.focus();
  }
}

function closeSortMenu(){
  if (!els.sortDropdown) return;
  if (!els.sortDropdown.classList.contains('open')) return;
  els.sortDropdown.classList.remove('open');
  if (els.sortToggle) {
    els.sortToggle.setAttribute('aria-expanded', 'false');
    if (els.sortDropdown.contains(document.activeElement)) {
      els.sortToggle.focus();
    }
  }
  if (els.sortMenu) {
    els.sortMenu.style.left = '';
    els.sortMenu.style.top = '';
  }
}

function toggleSortMenu(){
  if (!els.sortDropdown) return;
  if (els.sortDropdown.classList.contains('open')) closeSortMenu();
  else openSortMenu();
}

function setSort(key){
  if (!SORT_OPTIONS[key]){ closeSortMenu(); return; }
  if (currentSort !== key){
    currentSort = key;
  }
  updateSortUI();
  renderList();
  closeSortMenu();
}
function updateCommandBarVisibility(){
  const active = hasActiveItem();

  // Top controls
  const viewToggle = document.querySelector('.view-toggle');
  toggle(els.promptBtn, active);
  toggle(els.promptImgBtn, active);
  toggle(els.saveBtn, active);
  toggle(viewToggle, active);
  toggle(els.jsonStatus, active);
  const showLocale = !!(current && current.entity && current.entity.id && !isNew);
  toggle(els.localeSwitcher, showLocale);

  // Sync mobile fab buttons
  const fabPrompt = document.getElementById('fabPrompt');
  const fabPromptImg = document.getElementById('fabPromptImg');
  const fabSave = document.getElementById('fabSave');
  const fabNew = document.getElementById('fabNew');
  const fabLoad = document.getElementById('fabLoad');
  toggle(fabPrompt, active);
  toggle(fabPromptImg, active);
  toggle(fabSave, active);
  toggle(fabNew, !active);
  toggle(fabLoad, !active);
  if (fabSave) fabSave.disabled = els.saveBtn.disabled;

  // Right column content
  if (!active){
    els.builder.classList.remove('show');
    els.editorWrap.hidden = true;
    document.body.classList.add('hide-json-controls');
  } else {
    const formActive = els.viewForm.classList.contains('active');
    if (formActive){
      els.builder.classList.add('show');
      els.editorWrap.hidden = true;
      document.body.classList.add('hide-json-controls');
    } else {
      els.builder.classList.remove('show');
      els.editorWrap.hidden = false;
      document.body.classList.remove('hide-json-controls');
    }
  }

  syncMobileDetailState();

  if (!active && els.mobileFab) {
    els.mobileFab.classList.remove('open');
  }
}

function syncMobileDetailState(){
  if (!els.main) return;
  const isMobile = window.matchMedia('(max-width: 600px)').matches;
  const active = hasActiveItem();
  if (isMobile && active) {
    els.main.classList.add('detail-open');
    document.body.classList.add('detail-open');
  } else {
    els.main.classList.remove('detail-open');
    document.body.classList.remove('detail-open');
  }

  if (els.mobileBackBtn) {
    els.mobileBackBtn.tabIndex = isMobile && active ? 0 : -1;
  }
}

// ===== Dictionaries =====
async function fetchEquipmentDict(){
  try{
    const resp = await fetch(EQUIPMENT_GROUPS_ENDPOINT, {headers: buildHeaders({auth:false})});
    if(!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
    const data = await resp.json();
    const equipments = [];
    if (Array.isArray(data) && data.length && Array.isArray(data[0]?.equipments)){
      data.forEach(g => (g.equipments||[]).forEach(e => equipments.push(e)));
    } else if (Array.isArray(data)){
      data.forEach(e => equipments.push(e));
    }
    for (const e of equipments){
      if (e?.id) dict.equipment.set(String(e.id), String(e.name ?? e.id));
    }
  }catch(e){ console.warn('Equipment dict fetch failed:', e); }
}
async function fetchMuscleDict(){
  try{
    const resp = await fetch(MUSCLE_GROUPS_ENDPOINT, {headers: buildHeaders({auth:false})});
    if(!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
    const data = await resp.json();
    if (Array.isArray(data)){
      for (const g of data){
        (g.muscles||[]).forEach(m => { if (m?.id) dict.muscles.set(String(m.id), String(m.name ?? m.id)); });
      }
    }
  }catch(e){ console.warn('Muscle dict fetch failed:', e); }
}
function refreshOptionLists(){
  els.equipSingle.innerHTML = '';
  for (const [id,name] of dict.equipment.entries()){
    const opt = document.createElement('option');
    opt.value = id; opt.textContent = `${name} — ${id}`;
    els.equipSingle.appendChild(opt);
  }
  els.muscleSelect.innerHTML = '';
  for (const [id,name] of dict.muscles.entries()){
    const opt = document.createElement('option');
    opt.value = id; opt.textContent = `${name} — ${id}`;
    els.muscleSelect.appendChild(opt);
  }
}

// ===== Canonical entity (DTO) =====
function emptyTemplate(){
  return {
    id: uuidv4(),
    name: '',
    description: '',
    nameTranslations: createEmptyTranslations(),
    descriptionTranslations: createEmptyTranslations(),
    weightType: '',
    category: '',
    experience: '',
    forceType: '',
    imageUrl: '',
    [FIELD.bundles]: [],
    [FIELD.equipmentRefs]: []
  };
}
function normalizeEntityShape(src, options = {}){
  const locale = SUPPORTED_LANGUAGES.includes(options.locale) ? options.locale : DEFAULT_LANGUAGE;
  const previous = options.previous && typeof options.previous === 'object' ? options.previous : null;

  const e = {...src};
  const eq = Array.isArray(e[FIELD.equipmentRefs]) ? e[FIELD.equipmentRefs] : [];
  e[FIELD.equipmentRefs] = eq.map(x=>{
    if (typeof x === 'string') return { equipmentId: x };
    if (x && typeof x === 'object') {
      const id = x.equipmentId ?? x.id ?? x.key ?? x.code;
      return id ? { equipmentId: String(id) } : null;
    }
    return null;
  }).filter(Boolean);

  const rawB = Array.isArray(e[FIELD.bundles]) ? e[FIELD.bundles] : [];
  e[FIELD.bundles] = rawB.map(b=>{
    if (!b || typeof b !== 'object') return null;
    const muscleId = String(b.muscleId ?? b.muscle ?? b.muscle_id ?? b.targetMuscleId ?? '').trim();
    const percentage = Number(b.percentage ?? b.percent ?? b.ratio ?? b.load ?? 0);
    if (!muscleId || !isFinite(percentage)) return null;
    return { muscleId, percentage };
  }).filter(Boolean);

  const prevNameTranslations = ensureTranslationMap(previous?.nameTranslations);
  const prevDescTranslations = ensureTranslationMap(previous?.descriptionTranslations);

  const nameTranslations = ensureTranslationMap(e.nameTranslations);
  const descriptionTranslations = ensureTranslationMap(e.descriptionTranslations);

  for (const lang of SUPPORTED_LANGUAGES){
    if (!nameTranslations[lang] && prevNameTranslations[lang]) nameTranslations[lang] = prevNameTranslations[lang];
    if (!descriptionTranslations[lang] && prevDescTranslations[lang]) descriptionTranslations[lang] = prevDescTranslations[lang];
  }

  const rawTranslations = Array.isArray(e.translations) ? e.translations : [];
  rawTranslations.forEach(tr => {
    if (!tr || typeof tr !== 'object') return;
    const lang = typeof tr.language === 'string' ? tr.language.toLowerCase() : '';
    if (!SUPPORTED_LANGUAGES.includes(lang)) return;
    if (typeof tr.name === 'string') nameTranslations[lang] = tr.name;
    if (typeof tr.description === 'string') descriptionTranslations[lang] = tr.description;
  });

  if (typeof e.name === 'string' && !nameTranslations[locale]) nameTranslations[locale] = e.name;
  if (typeof e.description === 'string' && !descriptionTranslations[locale]) descriptionTranslations[locale] = e.description;

  if (typeof e.name === 'string' && locale === DEFAULT_LANGUAGE && !nameTranslations[DEFAULT_LANGUAGE]) {
    nameTranslations[DEFAULT_LANGUAGE] = e.name;
  }
  if (typeof e.description === 'string' && locale === DEFAULT_LANGUAGE && !descriptionTranslations[DEFAULT_LANGUAGE]) {
    descriptionTranslations[DEFAULT_LANGUAGE] = e.description;
  }

  if (!nameTranslations[DEFAULT_LANGUAGE] && typeof previous?.name === 'string') {
    nameTranslations[DEFAULT_LANGUAGE] = previous.name;
  }
  if (!descriptionTranslations[DEFAULT_LANGUAGE] && typeof previous?.description === 'string') {
    descriptionTranslations[DEFAULT_LANGUAGE] = previous.description;
  }

  e.nameTranslations = nameTranslations;
  e.descriptionTranslations = descriptionTranslations;
  e.name = nameTranslations[DEFAULT_LANGUAGE] || '';
  e.description = descriptionTranslations[DEFAULT_LANGUAGE] || '';
  delete e.translations;

  return e;
}
let canonical = emptyTemplate();
function getEntity(){
  return {
    ...canonical,
    nameTranslations: ensureTranslationMap(canonical.nameTranslations),
    descriptionTranslations: ensureTranslationMap(canonical.descriptionTranslations),
  };
}
function setEntity(newEnt){
  canonical = {
    ...newEnt,
    nameTranslations: ensureTranslationMap(newEnt.nameTranslations),
    descriptionTranslations: ensureTranslationMap(newEnt.descriptionTranslations),
  };
  writeEntityToForm(canonical);
  els.editor.value = pretty(canonical);
  validateAll();
  autosizeEditor();
}

// ===== Sidebar =====
function renderList(){
  applySort();
  els.list.innerHTML = '';
  const frag = document.createDocumentFragment();
  filtered.forEach(it=>{
    const node = els.itemTemplate.content.firstElementChild.cloneNode(true);
    const entity = it.entity;
    const displayName = entity?.localizedName || entity?.name || '(no name)';
    node.querySelector('.name').textContent = displayName;
    node.querySelector('.usage').textContent = `used ${it.usageCount ?? 0}`;
    node.querySelector('.lastUsed').textContent = it.lastUsed ? `last: ${formatIso(it.lastUsed)}` : 'last: —';
    const thumb = node.querySelector('.thumb');
    if (thumb){
      if (entity?.imageUrl){
        thumb.src = entity.imageUrl;
        thumb.alt = displayName || '';
        thumb.addEventListener('error', ()=> thumb.remove());
      } else {
        thumb.remove();
      }
    }

    // Mark "edited in this session"
    if (isEdited(entity?.id)) {
      node.classList.add('edited');
      const meta = node.querySelector('.meta');
      if (meta) {
        const badge = document.createElement('span');
        badge.className = 'pill edited';
        badge.textContent = 'edited';
        meta.appendChild(badge);
      }
    }

    node.addEventListener('click', ()=>selectItem(it));
    node.addEventListener('keydown', e=>{
      if(e.key==='Enter'||e.key===' '){ e.preventDefault(); selectItem(it); }
    });
    if (current && current.entity?.id === entity?.id) node.classList.add('active');
    frag.appendChild(node);
  });
  els.list.appendChild(frag);
}
function applySearch(){
  const q = (els.search?.value || '').trim().toLowerCase();
  filtered = !q ? items.slice() : items.filter(it => {
    const value = (it.entity?.localizedName || it.entity?.name || '').toLowerCase();
    return value.includes(q);
  });
  renderList();
}

// ===== Form sync =====
function readFormToEntity(entity){
  const e = {...entity};
  const locale = activeLocale;
  const nameValue = els.fName.value.trim();
  const descriptionValue = els.fDescription.value.trim();
  e.nameTranslations = ensureTranslationMap(e.nameTranslations);
  e.descriptionTranslations = ensureTranslationMap(e.descriptionTranslations);
  e.nameTranslations[locale] = nameValue;
  e.descriptionTranslations[locale] = descriptionValue;
  e.name = getTranslation(e.nameTranslations, DEFAULT_LANGUAGE);
  e.imageUrl = els.fImage.value.trim();
  e.description = getTranslation(e.descriptionTranslations, DEFAULT_LANGUAGE);
  e.weightType = els.fWeightType.value;
  e.category = els.fCategory.value;
  e.experience = els.fExperience.value;
  e.forceType = els.fForceType.value;
  return e;
}
function writeEntityToForm(entity){
  const locale = activeLocale;
  const nameTranslations = ensureTranslationMap(entity?.nameTranslations);
  const descTranslations = ensureTranslationMap(entity?.descriptionTranslations);
  const localeName = getTranslation(nameTranslations, locale);
  const localeDescription = getTranslation(descTranslations, locale);
  const defaultName = getTranslation(nameTranslations, DEFAULT_LANGUAGE) || entity?.name || '';
  const defaultDescription = getTranslation(descTranslations, DEFAULT_LANGUAGE) || entity?.description || '';

  els.fId.value = entity?.id || '';
  els.fName.value = localeName;
  els.fName.placeholder = buildLocalePlaceholder(defaultNamePlaceholder, defaultName, locale);
  els.fImage.value = entity?.imageUrl || '';
  els.fDescription.value = localeDescription;
  els.fDescription.placeholder = buildLocalePlaceholder(defaultDescriptionPlaceholder, defaultDescription, locale);
  els.fWeightType.value = entity?.weightType || '';
  els.fCategory.value = entity?.category || '';
  els.fExperience.value = entity?.experience || '';
  els.fForceType.value = entity?.forceType || '';
  renderEquipmentTokens(entity);
  renderBundles(entity);
}

// ===== Equipment UI =====
function renderEquipmentTokens(entity){
  const eq = Array.isArray(entity[FIELD.equipmentRefs]) ? entity[FIELD.equipmentRefs] : [];
  els.equipTokens.innerHTML = '';
  const frag = document.createDocumentFragment();
  eq.forEach((obj, idx)=>{
    const id = String(obj?.equipmentId || '');
    const name = dict.equipment.get(id) || id;
    const t = document.createElement('span');
    t.className = 'token';
    if (!dict.equipment.has(id)) t.classList.add('invalid');
    t.innerHTML = `<span>${name}</span>`;
    const btn = document.createElement('button'); btn.type='button'; btn.textContent='×'; btn.title='Remove';
    btn.addEventListener('click', ()=>{
      const ent = getEntity(); const arr = ent[FIELD.equipmentRefs] || [];
      arr.splice(idx,1); ent[FIELD.equipmentRefs] = arr; setEntity(ent);
    });
    t.appendChild(btn); frag.appendChild(t);
  });
  els.equipTokens.appendChild(frag);
}
function addSingleEquipment(){
  const id = els.equipSingle.value;
  if (!id){ toast({title:'Select equipment', type:'error'}); return; }
  if (!dict.equipment.has(id)){ toast({title:'Unknown equipment', type:'error'}); return; }
  const ent = getEntity();
  if (!Array.isArray(ent[FIELD.equipmentRefs])) ent[FIELD.equipmentRefs] = [];
  if (!ent[FIELD.equipmentRefs].some(x => x.equipmentId === id)) {
    ent[FIELD.equipmentRefs].push({ equipmentId: id });
  }
  setEntity(ent);
}

// ===== Bundles UI =====
function renderBundles(entity){
  const arr = Array.isArray(entity[FIELD.bundles]) ? entity[FIELD.bundles] : [];
  els.bundles.innerHTML = '';
  const frag = document.createDocumentFragment();
  let sum = 0;

  arr.forEach((b, i)=>{
    const row = document.createElement('div'); row.className='bundle-row';

    const muscle = document.createElement('select');
    for (const [id,name] of dict.muscles.entries()){
      const opt = document.createElement('option');
      opt.value=id; opt.textContent=`${name} — ${id}`;
      if (String(b?.muscleId||'')===id) opt.selected=true;
      muscle.appendChild(opt);
    }
    if (!dict.muscles.has(String(b?.muscleId||''))) muscle.classList.add('invalid');

    const percent = document.createElement('input');
    percent.type='number'; percent.min='0'; percent.max='100'; percent.step='1'; percent.placeholder='%';
    const p = Number(b?.percentage ?? 0); percent.value = String(p);
    if (!isFinite(p) || p<0 || p>100) percent.classList.add('invalid');
    sum += isFinite(p) ? p : 0;

    const del = document.createElement('button'); del.className='btn muted'; del.type='button'; del.textContent='Remove';

    muscle.addEventListener('change', ()=>{
      const ent = getEntity();
      ent[FIELD.bundles][i].muscleId = muscle.value;
      setEntity(ent);
    });
    percent.addEventListener('change', ()=>{
      const ent = getEntity();
      ent[FIELD.bundles][i].percentage = Number(percent.value || 0);
      setEntity(ent);
    });
    del.addEventListener('click', ()=>{
      const ent = getEntity(); ent[FIELD.bundles].splice(i,1); setEntity(ent);
    });

    row.appendChild(muscle); row.appendChild(percent); row.appendChild(del);
    frag.appendChild(row);
  });

  els.bundles.appendChild(frag);
  els.bundleSumInfo.textContent = `Sum: ${sum}%`;
  els.bundleSumInfo.className = 'sum ' + (sum===100?'ok':'bad');
}
function addBundleFromInputs(){
  const muscleId = els.muscleSelect.value;
  const p = Number(els.percentInput.value || 0);
  if (!muscleId || !isFinite(p)){ toast({title:'Select muscle and %', type:'error'}); return; }
  if (!dict.muscles.has(muscleId)){ toast({title:'Unknown muscle', type:'error'}); return; }
  const ent = getEntity();
  if (!Array.isArray(ent[FIELD.bundles])) ent[FIELD.bundles] = [];
  ent[FIELD.bundles].push({ muscleId, percentage: p });
  setEntity(ent);
  els.percentInput.value='';
}

// ===== Selection & CRUD =====
async function selectItem(it){
  if (!it || !it.entity) return;
  const id = String(it.entity.id || '').trim();
  if (!id){ toast({title:'Missing ID', type:'error'}); return; }

  const prevCurrent = current;
  const prevEntitySnapshot = getEntity();
  const prevIsNew = isNew;
  const prevIdText = els.currentId.textContent;

  isNew = false;
  current = it;
  renderList();
  updateCommandBarVisibility();

  const previousEntity = getEntity();
  const sameEntity = previousEntity?.id && String(previousEntity.id) === id;

  els.currentId.textContent = `Loading ID: ${id}…`;
  try{
    const detail = await fetchExerciseExampleById(id);
    const remoteEntity = detail?.entity || {};
    const localizedNameFromServer = typeof remoteEntity.name === 'string' ? remoteEntity.name : '';
    const localizedDescriptionFromServer = typeof remoteEntity.description === 'string' ? remoteEntity.description : '';
    const normalized = normalizeEntityShape(remoteEntity, { locale: activeLocale, previous: sameEntity ? previousEntity : null });

    let mergedEntity = normalized;
    if (sameEntity){
      mergedEntity = {
        ...previousEntity,
        ...normalized,
        nameTranslations: {
          ...previousEntity.nameTranslations,
          ...normalized.nameTranslations,
        },
        descriptionTranslations: {
          ...previousEntity.descriptionTranslations,
          ...normalized.descriptionTranslations,
        }
      };
      mergedEntity.nameTranslations[activeLocale] = getTranslation(normalized.nameTranslations, activeLocale);
      mergedEntity.descriptionTranslations[activeLocale] = getTranslation(normalized.descriptionTranslations, activeLocale);
      mergedEntity.name = getTranslation(mergedEntity.nameTranslations, DEFAULT_LANGUAGE);
      mergedEntity.description = getTranslation(mergedEntity.descriptionTranslations, DEFAULT_LANGUAGE);
    }

    if (!mergedEntity.id) mergedEntity.id = id;

    const localizedName = getTranslation(normalized.nameTranslations, activeLocale) || localizedNameFromServer;
    const localizedDescription = getTranslation(normalized.descriptionTranslations, activeLocale) || localizedDescriptionFromServer;
    mergedEntity.localizedName = localizedName;
    mergedEntity.localizedDescription = localizedDescription;

    setEntity(mergedEntity);
    els.currentId.textContent = mergedEntity?.id ? `Editing ID: ${mergedEntity.id}` : `Editing ID: ${id}`;
    applyViewMode();
    updateLocaleUI();

    const enrichedDetail = {
      ...detail,
      entity: {...mergedEntity}
    };
    current = enrichedDetail;

    const idx = items.findIndex(entry => String(entry?.entity?.id || '') === id);
    if (idx >= 0) items[idx] = enrichedDetail;
    const fIdx = filtered.findIndex(entry => String(entry?.entity?.id || '') === id);
    if (fIdx >= 0) filtered[fIdx] = enrichedDetail;

    renderList();
  }catch(e){
    console.error(e);
    toast({title:'Failed to load item', message:String(e.message||e), type:'error'});
    current = prevCurrent;
    isNew = prevIsNew;
    setEntity(prevEntitySnapshot);
    els.currentId.textContent = prevIdText || 'No item selected';
    updateLocaleUI();
    renderList();
  }finally{
    updateCommandBarVisibility(); // reflect active state
  }
}
function newItem(){
  current = null; isNew = true;
  canonical = emptyTemplate();
  els.currentId.textContent = 'Creating new item (ID will be assigned on save)';
  writeEntityToForm(canonical);
  els.editor.value = pretty(canonical);
  applyViewMode();            // respect global view mode
  validateAll();
  autosizeEditor && autosizeEditor();
  updateCommandBarVisibility(); // reflect active state
}

async function setActiveLocale(lang, {forceRefetch = false} = {}){
  if (!SUPPORTED_LANGUAGES.includes(lang)) return;
  const snapshot = readFormToEntity(getEntity());
  const hasCurrent = current && current.entity && current.entity.id && !isNew;
  const same = lang === activeLocale;

  if (!same){
    activeLocale = lang;
    try { localStorage.setItem(LOCALE_STORAGE_KEY, lang); } catch {}
  }

  updateLocaleUI();
  setEntity(snapshot);

  if (hasCurrent && (forceRefetch || !same)){
    await selectItem(current);
  }
  updateCommandBarVisibility();
}

async function loadList(){
  const headers = buildHeaders();
  if (!headers.Authorization){
    toast({title:'Login required', message:'Please sign in first.', type:'error', ms:3500});
    if (els.loginOverlay) els.loginOverlay.style.display='flex';
    return;
  }
  els.load.disabled = true;
  try{
    const resp = await fetch(LIST_ENDPOINT, {headers, method:'GET'});
    if(!resp.ok){
      const text = await resp.text(); throw new Error(`${resp.status} ${resp.statusText} — ${text.slice(0,300)}`);
    }
    const data = await resp.json();
    if(!Array.isArray(data)) throw new Error('Unexpected response shape: expected an array');
    items = data.map(entry => {
      const entity = entry?.entity ? {...entry.entity} : {};
      if (entity && typeof entity.name === 'string') entity.localizedName = entity.name;
      if (entity && typeof entity.description === 'string') entity.localizedDescription = entity.description;
      return {...entry, entity};
    });
    applySearch();
    toast({title:'Loaded', message:`Items: ${items.length}`});
  }catch(e){
    toast({title:'Load failed', message:String(e.message||e), type:'error', ms:6000}); console.error(e);
  }finally{ els.load.disabled = false; }
}

async function fetchExerciseExampleById(id){
  const headers = buildHeaders();
  if (!headers.Authorization){
    toast({title:'Login required', message:'Please sign in first.', type:'error'});
    if (els.loginOverlay) els.loginOverlay.style.display='flex';
    throw new Error('Not authenticated');
  }
  const resp = await fetch(DETAIL_ENDPOINT(id), {headers, method:'GET'});
  if (!resp.ok){
    const text = await resp.text();
    throw new Error(`${resp.status} ${resp.statusText} — ${text.slice(0,400)}`);
  }
  return resp.json();
}

async function saveCurrent(){
  const headers = buildHeaders({json:true});
  if (!headers.Authorization){
    toast({title:'Login required', message:'Please sign in first.', type:'error'});
    if (els.loginOverlay) els.loginOverlay.style.display='flex';
    return;
  }

  const ent = readFormToEntity(getEntity());
  setEntity(ent);
  const {ok} = validateAll();
  if (!ok){ toast({title:'Fix validation errors', type:'error'}); return; }

  els.saveBtn.disabled = true;
  { const fabSave = document.getElementById('fabSave'); if (fabSave) fabSave.disabled = true; }
  try{
    if (isNew){
      // Create: DO NOT send id
      const payload = buildPersistencePayload({...canonical});
      delete payload.id;
      delete payload.createdAt;
      delete payload.updatedAt;

      const resp = await fetch(CREATE_ENDPOINT, {
        method:'POST', headers, body: JSON.stringify(payload)
      });
      if (!resp.ok){
        const text = await resp.text(); 
        throw new Error(`${resp.status} ${resp.statusText} — ${text.slice(0,400)}`);
      }

      // Expect { id: "..." } (some backends may return no body)
      let createdId = null;
      try{
        const data = await resp.json();
        if (data && data.id) createdId = String(data.id);
      }catch(_) {}

      if (createdId){
        canonical.id = createdId;
        writeEntityToForm(canonical);
        els.currentId.textContent = `Editing ID: ${createdId}`;
        markEdited(createdId);   // mark new item as edited in this session
      }

      toast({title:'Created', message: createdId ? `ID ${createdId}` : 'Created'});
      isNew = false;
      await loadList();
      updateCommandBarVisibility();
    } else {
      // Update: id via query, NOT in body
      const id = current?.entity?.id || canonical.id;
      if (!id){ toast({title:'Missing ID', type:'error'}); return; }

      const payload = buildPersistencePayload({...canonical});
      delete payload.id;
      delete payload.createdAt;
      delete payload.updatedAt;

      const resp = await fetch(PUT_ENDPOINT(id), {
        method:'PUT', headers, body: JSON.stringify(payload)
      });
      if (!resp.ok){
        const text = await resp.text(); 
        throw new Error(`${resp.status} ${resp.statusText} — ${text.slice(0,400)}`);
      }

      toast({title:'Saved', message:`ID ${id} updated.`});
      markEdited(id);           // mark as edited in this session
      if (current) current.entity = {...canonical, id};
      renderList();
    }
  }catch(e){
    toast({title:'Save failed', message:String(e.message||e), type:'error', ms:7000});
    console.error(e);
  }finally{
    els.saveBtn.disabled = false;
    { const fabSave = document.getElementById('fabSave'); if (fabSave) fabSave.disabled = false; }
  }
}

// ===== Validation (imageUrl -> warning only) =====
function validateAll(){
  const ent = getEntity();

  const errors = [];
  const warnings = [];

  const defaultName = getTranslation(ent.nameTranslations, DEFAULT_LANGUAGE).trim();
  const defaultDescription = getTranslation(ent.descriptionTranslations, DEFAULT_LANGUAGE).trim();
  ent.name = defaultName;
  ent.description = defaultDescription;
  if (!defaultName) errors.push(`Missing: name (${DEFAULT_LANGUAGE.toUpperCase()})`);
  if (!defaultDescription) errors.push(`Missing: description (${DEFAULT_LANGUAGE.toUpperCase()})`);
  if (!ent.weightType) errors.push('Missing: weightType');
  if (!ent.category) errors.push('Missing: category');
  if (!ent.experience) errors.push('Missing: experience');
  if (!ent.forceType) errors.push('Missing: forceType');

  if (!ent.imageUrl) warnings.push('imageUrl is empty');

  const weightOk = ['free','fixed','body_weight'].includes(ent.weightType);
  const catOk = ['compound','isolation'].includes(ent.category);
  const expOk = ['beginner','intermediate','advanced','pro'].includes(ent.experience);
  const forceOk = ['push','pull','hinge'].includes(ent.forceType);
  if (ent.weightType && !weightOk) errors.push('weightType invalid');
  if (ent.category && !catOk) errors.push('category invalid');
  if (ent.experience && !expOk) errors.push('experience invalid');
  if (ent.forceType && !forceOk) errors.push('forceType invalid');

  // Equipment can be empty now (bodyweight). Only validate unknown IDs if any provided.
  const eq = Array.isArray(ent[FIELD.equipmentRefs]) ? ent[FIELD.equipmentRefs] : [];
  const unknownEq = eq.length ? eq.map(x=>String(x?.equipmentId||'')).filter(id => !dict.equipment.has(id)) : [];
  if (unknownEq.length) errors.push(`Unknown equipment: ${Array.from(new Set(unknownEq)).join(', ')}`);

  const bundles = Array.isArray(ent[FIELD.bundles]) ? ent[FIELD.bundles] : [];
  if (bundles.length === 0) errors.push('No muscle bundles added');
  let sum = 0, outOfRange = false; const unknownMuscles = [];
  for (const b of bundles){
    const id = String(b?.muscleId ?? '');
    const p  = Number(b?.percentage ?? 0);
    if (!isFinite(p) || p<0 || p>100) outOfRange = true;
    sum += isFinite(p)? p : 0;
    if (!dict.muscles.has(id)) unknownMuscles.push(id);
  }
  if (sum !== 100) errors.push(`Bundles sum ${sum}% (must be 100%)`);
  if (outOfRange) errors.push('Bundle percentage out of [0..100]');
  if (unknownMuscles.length) errors.push(`Unknown muscles: ${Array.from(new Set(unknownMuscles)).join(', ')}`);

  const ok = errors.length === 0;
  if (!ok) setStatus('bad', errors[0]);
  else if (warnings.length) setStatus('warn', warnings[0]);
  else setStatus('ok', 'Valid');
  els.saveBtn.disabled = !ok;
  { const fabSave = document.getElementById('fabSave'); if (fabSave) fabSave.disabled = els.saveBtn.disabled; }

  if (!els.editor.hasAttribute('hidden')) els.editor.value = pretty(ent);
  return {ok, errors, warnings};
}

// ===== GPT prompt =====
function buildGptPrompt(){
  const e = getEntity();
  const lines = [];

  lines.push('You are an expert strength & conditioning editor and a strict JSON validator.');
  lines.push('');
  lines.push('When you answer, follow this EXACT output format:');
  lines.push('```json');
  lines.push('{ ...final JSON... }');
  lines.push('```');
  lines.push('Пояснение (на русском): кратко и по пунктам объясни, что улучшил(а) и почему (с опорой на НАЗВАНИЕ/ОПИСАНИЕ и общие знания/практику).');
  lines.push('');
  lines.push('Hard requirements:');
  lines.push('- The JSON in the code block MUST strictly match this schema:');
  lines.push('  {');
  lines.push('    "id"?: string,');
  lines.push('    "name": string,');
  lines.push('    "description": string,');
  lines.push('    "weightType": "free"|"fixed"|"body_weight",');
  lines.push('    "category": "compound"|"isolation",');
  lines.push('    "experience": "beginner"|"intermediate"|"advanced"|"pro",');
  lines.push('    "forceType": "push"|"pull"|"hinge",');
  lines.push('    "imageUrl"?: string,');
  lines.push(`    "${FIELD.bundles}": [{ "muscleId": string, "percentage": number }],`);
  lines.push(`    "${FIELD.equipmentRefs}": [{ "equipmentId": string }]`);
  lines.push('  }');
  lines.push('- Do NOT include a field named "tutorials".');
  lines.push('- Do NOT change "id" if it is present.');
  lines.push(`- Sum of "${FIELD.bundles}[].percentage" MUST be exactly 100 (integers only).`);
  lines.push(`- "${FIELD.equipmentRefs}" MUST use VALID equipment IDs from the dictionary below (no unknown IDs).`);
  lines.push('- If there are duplicates of the same muscle/equipment, merge them (for muscles: sum, then re-normalize to 100).');
  lines.push('- Keep field names and types; do not add extra fields; do not remove required fields; respect enums.');
  lines.push('- Improve QUALITY of muscle distribution using NAME and DESCRIPTION AND your general domain knowledge (outside the provided data).');
  lines.push('- You MAY add/remove muscles if that leads to a more realistic split, but use only IDs from the provided dictionary.');
  lines.push('- You MAY refine "description" for clarity and utility; keep the same language as the input where possible and you MAY use "\\n" for new lines.');
  lines.push('- Ensure equipment list is relevant to the exercise; only use IDs from the equipment dictionary.');
  lines.push('');
  lines.push('Review focus:');
  lines.push('- Critically evaluate MUSCLE RATIOS based on exercise NAME and DESCRIPTION, and on general biomechanical knowledge (prime movers, synergists, stabilizers).');
  lines.push('- If distribution is unrealistic, adjust to plausible primary/secondary splits (still sum to 100).');
  lines.push('- Validate that chosen equipment matches typical execution for this exercise.');
  lines.push('');
  lines.push(`Name: ${e.name || '(empty)'}`);
  lines.push(`Description: ${e.description || '(empty)'}`);
  lines.push('');
  lines.push('Muscles dictionary (name — id):');
  for (const [id, name] of dict.muscles.entries()) lines.push(`- ${name} — ${id}`);
  lines.push('');
  lines.push('Equipment dictionary (name — id):');
  for (const [id, name] of dict.equipment.entries()) lines.push(`- ${name} — ${id}`);
  lines.push('');
  lines.push('Current JSON:');
  lines.push(pretty(e));
  lines.push('');
  lines.push('OUTPUT FORMAT (repeat for clarity):');
  lines.push('```json');
  lines.push('{ ...final JSON... }');
  lines.push('```');
  lines.push('Пояснение: ... (на русском, перечисли ключевые изменения и логику на основе общих знаний и описания).');
  lines.push('Return NOTHING else beyond these two parts.');

  return lines.join('\n');
}

// Builds an image-generation prompt following the strict V2 bench-press format while retaining legacy guidance
function buildGptImagePrompt(){
  const e = getEntity();

  // equipment names (no IDs in prompt)
  const eqArr = Array.isArray(e[FIELD.equipmentRefs]) ? e[FIELD.equipmentRefs] : [];
  const eqNames = eqArr
    .map(x => String(dict.equipment.get(String(x?.equipmentId || '')) || '').trim())
    .filter(Boolean);

  // "Данные упражнения" equipment line
  const allowedEqForData =
    eqNames.length ? eqNames.join(', ') : 'без дополнительного оборудования';

  const lines = [];
  lines.push('Задача:');
  lines.push(`Сгенерируй превью упражнения "${e.name || '(empty)'}".`);
  lines.push('');
  lines.push('Изображение (строгие требования):');
  lines.push('\t• ответ только картинка, без текста;');
  lines.push('\t• aspect_ratio: 1:1 строго;');
  lines.push('\t• size: 900×900, PNG, sRGB, без alpha;');
  lines.push('');
  // Color
  lines.push('Color (hard, only these HEX):');
  lines.push('\t• Background radial: center #CBD0D8 → edges #2E333B (allowed solids: #EDEFF1, #262A31)');
  lines.push('\t• Metal: base #AEB6C2, shadows #8993A1 / #6B7684, highlight #D7DEE6');
  lines.push('\t• Rubber: base #2B3036, highlight #3A4048');
  lines.push('\t• Plastic: base #3A4048, highlight #4A515B');
  lines.push('\t• Skin/mannequin: base #ECE6E0, mid #D6CDC5, deep #BFB4A9, highlight #F7F3EF (матовые, без глянца)');
  lines.push('\t• Outfit: base #2E333B; one accent ≤12%: #3366FF (обычно) или #FFA726 (редко).');
  lines.push('\t• Accent — тонкий кант/пояс/шнурок; не делать большие заливки.');
  lines.push('\t• Использовать только перечисленные HEX; другие цвета запрещены.');
  lines.push('\t• Контраст акцента к базе ≥ 4.5:1.');
  lines.push('\t• No pure #FFFFFF/#000000.');
  lines.push('');
  // Style
  lines.push('Style (fixed): clay/3D, matte, без бликов/шума/текста/логотипов.');
  lines.push('Манекен: андрогинный, без лица/волос/пор/вен.');
  lines.push('Пропорции: реалистичные — корректные плечи, торс, руки и ноги без деформаций.');
  lines.push('Окружение: минималистичная студия, нейтральный фон, без текста/логотипов/UI.');
  lines.push('');
  // Camera & Framing
  lines.push('Camera & Framing (hard):');
  lines.push('\t• View: 3/4 isometric, tilt from above ≈ 12°; eq. focal ≈ 40 mm; camera height ≈ chest level of mannequin.');
  lines.push('\t• Subject centered; mannequin + equipment occupy 70–80% of frame height.');
  lines.push('\t• Safe-margin: ≥ 7% от кадра по всем сторонам.');
  lines.push('\t• Для 900×900: ≥ 63 px со всех сторон.');
  lines.push('\t• Extra buffer поверх safe-margin вокруг объединённого bbox(man + gear): ≥ 11% по каждой оси (ориентир ~ 100 px при 900×900).');
  lines.push('\t• Hard rule: Entire silhouette and equipment must fit inside safe-margin. If violated → auto zoom-out until both safe-margin и buffer выполняются.');
  lines.push('\t• Ground plane visible; soft contact shadow under feet and rack/bench.');
  lines.push('');
  // Lighting
  lines.push('Lighting (soft-matte): Key:Fill:Rim ≈ 1 : 0.5 : 0.2, key 35–45° сверху-сбоку; тени мягкие, лёгкий rim для отделения от фона.');
  lines.push('');
  // Equipment whitelist
  lines.push(`Allowed equipment only: ${eqNames.length ? eqNames.join(', ') : '— без дополнительного оборудования'}. Никакого другого инвентаря.`);
  lines.push('');
  // Pose/Technique
  lines.push('Pose/Technique (mid-range rep):');
  lines.push('\t• 5-point setup: feet flat, glutes, upper back, head; лёгкий арч.');
  lines.push('\t• Scapulae retracted/depressed; wrist neutral stacked over elbows.');
  lines.push('\t• Elbows ≈45–70°; grip чуть шире плеч.');
  lines.push('\t• Bar path читаемо «J-curve»: кадр — середина амплитуды (бар ~ над нижней/серединной частью груди).');
  lines.push('\t• Neck нейтральная, взгляд вверх.');
  lines.push('\t• Траектории усилий читаемы.');
  lines.push('\t• Если Description задаёт pronated/neutral/supinated или ширину хвата — соблюсти.');
  lines.push('');
  // Restrictions
  lines.push('Restrictions (hard):');
  lines.push('\t• Нет лишних людей/зеркал/окон/декора.');
  lines.push('\t• Нет motion blur/шума/глянца/экстремальной перспективы.');
  lines.push('\t• Нет стрелок/оверлеев/водяных знаков/текста/логотипов.');
  lines.push('');
  // QC checklist
  lines.push('QC checklist (reject if fail):');
  lines.push('\t• 1:1 строго, 900×900, PNG sRGB, no alpha.');
  lines.push('\t• 1 mannequin only, equipment whitelist only.');
  lines.push('\t• Все цвета из списка; 1 accent ≤12%, контраст с #2E333B ≥ 4.5:1.');
  lines.push('\t• Ни одна часть тела/снаряда не пересекает safe-margin.');
  lines.push('\t• Запас buffer вокруг bbox(man+gear) соблюдён по всем сторонам.');
  lines.push('\t• Углы/стойка/хват соответствуют Description.');
  lines.push('\t• Мягкие контактные тени присутствуют; ничего не обрезано.');
  lines.push('');
  // Данные упражнения
  lines.push('Данные упражнения');
  lines.push('');
  lines.push(`Name: ${e.name || '(empty)'}`);
  lines.push(`Description: ${e.description || '(empty)'}`);
  lines.push(`Allowed equipment: ${allowedEqForData}`);

  return lines.join('\n');
}


async function copyImagePrompt(){
  const prompt = buildGptImagePrompt();
  try{
    await navigator.clipboard.writeText(prompt);
    toast({title:'Image prompt copied'});
  }catch{
    const ta = document.createElement('textarea');
    ta.value = prompt;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast({title:'Image prompt copied'});
  }
}

async function copyPrompt(){
  const prompt = buildGptPrompt();
  try{ await navigator.clipboard.writeText(prompt); toast({title:'Prompt copied'}); }
  catch(e){
    const ta=document.createElement('textarea'); ta.value=prompt; document.body.appendChild(ta);
    ta.select(); document.execCommand('copy'); ta.remove(); toast({title:'Prompt copied'});
  }
}

// ===== View switching + JSON controls toggle =====
function setViewForm(){
  viewMode = 'form';
  persistViewMode();
  els.viewForm.classList.add('active'); els.viewJson.classList.remove('active');
  els.builder.classList.add('show'); els.editorWrap.hidden = true;
  document.body.classList.add('hide-json-controls'); // hides Format/Copy buttons
  updateCommandBarVisibility();
}
function setViewJson(){
  viewMode = 'json';
  persistViewMode();
  els.viewJson.classList.add('active'); els.viewForm.classList.remove('active');
  els.builder.classList.remove('show'); els.editorWrap.hidden = false;
  els.editor.value = pretty(getEntity());
  document.body.classList.remove('hide-json-controls');
  updateCommandBarVisibility();
}

// ===== Bootstrap =====
window.addEventListener('DOMContentLoaded', async ()=>{
  authToken = loadTokenLocal();
  if (!authToken && els.loginOverlay){ els.loginOverlay.style.display='flex'; }
  loadEdited(); // restore edited IDs for this tab session

  await Promise.all([fetchEquipmentDict(), fetchMuscleDict()]);
  refreshOptionLists();
  updateLocaleUI();
  if (els.localeSwitcher){
    localeButtons.forEach(btn => {
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        const lang = btn.dataset.locale;
        if (!lang) return;
        const forceRefetch = lang === activeLocale;
        setActiveLocale(lang, {forceRefetch}).catch(err => console.error(err));
      });
    });
  }

  // Sidebar
  els.load.addEventListener('click', loadList);
  els.search.addEventListener('input', applySearch);
  if (els.clearSearch) {
    els.clearSearch.addEventListener('click', ()=>{ els.search.value=''; applySearch(); });
  }
  if (els.sortToggle) {
    els.sortToggle.addEventListener('click', (event) => {
      event.preventDefault();
      toggleSortMenu();
    });
  }
  const commandBar = document.getElementById('commandBar');
  if (commandBar) {
    try {
      commandBar.addEventListener('scroll', positionSortMenu, {passive:true});
    } catch {
      commandBar.addEventListener('scroll', positionSortMenu);
    }
  }
  if (els.sortMenu) {
    els.sortMenu.querySelectorAll('.dropdown-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-sort');
        setSort(key);
      });
    });
  }
  document.addEventListener('click', (evt) => {
    if (!els.sortDropdown) return;
    if (els.sortDropdown.contains(evt.target)) return;
    closeSortMenu();
  });
  document.addEventListener('keydown', (evt) => {
    if (evt.key === 'Escape') closeSortMenu();
  });
  document.addEventListener('focusin', (evt) => {
    if (!els.sortDropdown) return;
    if (!els.sortDropdown.classList.contains('open')) return;
    if (els.sortDropdown.contains(evt.target)) return;
    closeSortMenu();
  });
  window.addEventListener('resize', positionSortMenu);
  updateSortUI();
  els.newBtn.addEventListener('click', newItem);
  if (els.mobileBackBtn) {
    els.mobileBackBtn.addEventListener('click', () => {
      current = null; isNew = false;
      els.currentId.textContent = 'No item selected';
      updateCommandBarVisibility();
      renderList();
    });
  }

  // Header actions
  els.saveBtn.addEventListener('click', saveCurrent);
  els.promptBtn.addEventListener('click', copyPrompt);
  els.promptImgBtn.addEventListener('click', copyImagePrompt);
  if (els.logoutBtn) { els.logoutBtn.addEventListener('click', ()=>{ logout(); toast({title:'Logged out'}); }); }

  // View
  els.viewForm.addEventListener('click', setViewForm);
  els.viewJson.addEventListener('click', setViewJson);
  applyViewMode();

  
// Login form
if (els.loginForm){
  els.loginForm.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const email = els.loginEmail.value.trim();
    const password = els.loginPassword.value;
    if (els.loginError){ els.loginError.textContent=''; els.loginError.style.display='none'; }
    try{
      const resp = await fetch(LOGIN_ENDPOINT, {
        method:'POST',
        headers: buildHeaders({json:true, auth:false}),
        body: JSON.stringify({email, password})
      });
      if(!resp.ok){
        const msg = 'Invalid credentials';
        if(els.loginError){ els.loginError.textContent=msg; els.loginError.style.display='block'; }
        throw new Error(msg);
      }
      const data = await resp.json();
      authToken = data.accessToken || '';
      saveTokenLocal(authToken);
      localStorage.setItem('grippo_admin_refresh', data.refreshToken || '');
      els.loginOverlay.style.display='none';
      toast({title:'Logged in'});
    }catch(err){
      if(els.loginError){ els.loginError.textContent=String(err.message||err); els.loginError.style.display='block'; }
      toast({title:'Login failed', message:String(err.message||err), type:'error'});
    }
  });
}

// Form inputs
  [els.fName, els.fImage, els.fDescription].forEach(input=> input.addEventListener('input', ()=>{ setEntity(readFormToEntity(getEntity())); }));
  [els.fWeightType, els.fCategory, els.fExperience, els.fForceType].forEach(sel=> sel.addEventListener('change', ()=>{ setEntity(readFormToEntity(getEntity())); }));

  // Equipment actions
  els.equipAdd.addEventListener('click', addSingleEquipment);
  els.equipClear.addEventListener('click', ()=>{
    const ent=getEntity(); ent[FIELD.equipmentRefs]=[]; setEntity(ent);
  });

  // Bundles actions
  els.bundleAdd.addEventListener('click', addBundleFromInputs);
  els.percentInput.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); addBundleFromInputs(); } });

  // JSON normalize
  els.editor.addEventListener('input', ()=>{
    const raw = els.editor.value;
    if (!raw.trim()) {
      setStatus('warn','Waiting for JSON');
      els.saveBtn.disabled = true;
      { const fabSave = document.getElementById('fabSave'); if (fabSave) fabSave.disabled = true; }
      return;
    }
    try{
      const obj = JSON.parse(raw);
      canonical = normalizeEntityShape(obj, { locale: activeLocale, previous: canonical });
      writeEntityToForm(canonical);
      validateAll();
    }catch{
      setStatus('bad','Invalid JSON');
      els.saveBtn.disabled = true;
      { const fabSave = document.getElementById('fabSave'); if (fabSave) fabSave.disabled = true; }
    }
  });

  if (els.clearJsonBtn) {
    els.clearJsonBtn.addEventListener('click', () => {
      els.editor.value = '';
      els.editor.dispatchEvent(new Event('input'));
    });
  }

  // Start — nothing selected yet, no "New" pressed
  current = null; isNew = false;
  canonical = emptyTemplate();
  els.builder.classList.remove('show');
  els.editorWrap.hidden = true;
  document.body.classList.add('hide-json-controls');

  // Floating action button for mobile
  if (els.mobileFab && els.mobileFabToggle) {
    const closeFab = () => els.mobileFab.classList.remove('open');
    els.mobileFabToggle.addEventListener('click', () => els.mobileFab.classList.toggle('open'));
    document.getElementById('fabNew').addEventListener('click', () => { els.newBtn.click(); closeFab(); });
    document.getElementById('fabLoad').addEventListener('click', () => { els.load.click(); closeFab(); });
    document.getElementById('fabPrompt').addEventListener('click', () => { els.promptBtn.click(); closeFab(); });
    document.getElementById('fabPromptImg').addEventListener('click', () => { els.promptImgBtn.click(); closeFab(); });
    document.getElementById('fabSave').addEventListener('click', () => { els.saveBtn.click(); closeFab(); });
  }

  updateCommandBarVisibility(); // hide GPT/Save/toggle/status
  updateStickyOffsets();
  window.addEventListener('resize', () => {
    updateStickyOffsets();
    syncMobileDetailState();
    closeSortMenu();
  });
});

// ===== Helpers =====
// CORS hint wrapper

(function patchFetchForHints(){
  const orig = window.fetch;
  window.fetch = async (...args)=>{
    try{
      const resp = await orig(...args);
      if(resp.status === 401 || resp.status === 403){
        logout();
        const message = resp.status === 401 ? 'Authorization has expired. Please log in again.' : 'Session expired';
        toast({title:'Logged out', message, type:'error'});
      }
      return resp;
    }catch(e){
      toast({
        title:'Network error',
        message:'If this runs on GitHub Pages, enable CORS on grippo-app.com for GET, POST, PUT and header Authorization.',
        type:'error', ms:8000
      });
      throw e;
    }
  };
})();


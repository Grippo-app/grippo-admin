// ===== Constants =====
const API_BASE = 'https://grippo-app.com';
const LIST_ENDPOINT   = `${API_BASE}/exercise-examples`;
const CREATE_ENDPOINT = `${API_BASE}/exercise-examples`;
const PUT_ENDPOINT    = (id) => `${API_BASE}/exercise-examples?id=${encodeURIComponent(id)}`;

const EQUIPMENT_GROUPS_ENDPOINT = `${API_BASE}/equipments`;
const MUSCLE_GROUPS_ENDPOINT    = `${API_BASE}/muscles`;

const FIELD = {
  equipmentRefs: 'equipmentRefs',
  bundles: 'exerciseExampleBundles',
  muscleId: 'muscleId',
  percentage: 'percentage'
};

// ===== State =====
let items = [];
let filtered = [];
let current = null;
let isNew = false;

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
  token: document.getElementById('token'),
  saveToken: document.getElementById('saveToken'),
  load: document.getElementById('loadBtn'),

  list: document.getElementById('list'),
  search: document.getElementById('search'),
  clearSearch: document.getElementById('clearSearch'),
  newBtn: document.getElementById('newBtn'),

  currentId: document.getElementById('currentId'),
  jsonStatus: document.getElementById('jsonStatus'),
  saveBtn: document.getElementById('saveBtn'),
  formatBtn: document.getElementById('formatBtn'),
  copyEntityBtn: document.getElementById('copyEntityBtn'),
  copyFullBtn: document.getElementById('copyFullBtn'),
  promptBtn: document.getElementById('promptBtn'),
  promptImgBtn: document.getElementById('promptImgBtn'),

  viewForm: document.getElementById('viewForm'),
  viewJson: document.getElementById('viewJson'),
  builder: document.getElementById('builder'),
  editor: document.getElementById('editor'),

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

// ===== Utilities =====
function toast({title, message = '', type = 'success', ms = 3000}) {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<div class="title">${title}</div>${message ? `<div>${message}</div>` : ''}`;
  document.body.appendChild(t);
  setTimeout(()=>t.remove(), ms);
}
function saveTokenLocal(v){ localStorage.setItem('grippo_admin_token', v || ''); }
function loadTokenLocal(){ return localStorage.getItem('grippo_admin_token') || ''; }
function bearer(){ const tok = els.token.value.trim(); return tok ? {'Authorization': `Bearer ${tok}`} : {}; }
function pretty(json){ return JSON.stringify(json, null, 2); }
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
function updateCommandBarVisibility(){
  const active = hasActiveItem();

  // Top controls
  const viewToggle = document.querySelector('.view-toggle');
  toggle(els.promptBtn, active);
  toggle(els.promptImgBtn, active);
  toggle(els.saveBtn, active);
  toggle(viewToggle, active);
  toggle(els.jsonStatus, active);

  // Right column content
  if (!active){
    els.builder.classList.remove('show');
    els.editor.hidden = true;
    document.body.classList.add('hide-json-controls');
  } else {
    const formActive = els.viewForm.classList.contains('active');
    if (formActive){
      els.builder.classList.add('show');
      els.editor.hidden = true;
      document.body.classList.add('hide-json-controls');
    } else {
      els.builder.classList.remove('show');
      els.editor.hidden = false;
      document.body.classList.remove('hide-json-controls');
    }
  }
}

// ===== Dictionaries =====
async function fetchEquipmentDict(){
  try{
    const resp = await fetch(EQUIPMENT_GROUPS_ENDPOINT, {headers:{accept:'application/json'}});
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
    const resp = await fetch(MUSCLE_GROUPS_ENDPOINT, {headers:{accept:'application/json'}});
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
    weightType: '',
    category: '',
    experience: '',
    forceType: '',
    imageUrl: '',
    [FIELD.bundles]: [],
    [FIELD.equipmentRefs]: []
  };
}
function normalizeEntityShape(src){
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
  return e;
}
let canonical = emptyTemplate();
function getEntity(){ return {...canonical}; }
function setEntity(newEnt){
  canonical = {...newEnt};
  writeEntityToForm(canonical);
  els.editor.value = pretty(canonical);
  validateAll();
  autosizeEditor();
}

// ===== Sidebar =====
function renderList(){
  els.list.innerHTML = '';
  const frag = document.createDocumentFragment();
  filtered.forEach(it=>{
    const node = els.itemTemplate.content.firstElementChild.cloneNode(true);
    const entity = it.entity;
    node.querySelector('.name').textContent = entity?.name || '(no name)';
    node.querySelector('.usage').textContent = `used ${it.usageCount ?? 0}`;
    node.querySelector('.lastUsed').textContent = it.lastUsed ? `last: ${formatIso(it.lastUsed)}` : 'last: —';

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
  const q = els.search.value.trim().toLowerCase();
  filtered = !q ? items.slice() : items.filter(it => (it.entity?.name || '').toLowerCase().includes(q));
  renderList();
}

// ===== Form sync =====
function readFormToEntity(entity){
  const e = {...entity};
  e.name = els.fName.value.trim();
  e.imageUrl = els.fImage.value.trim();
  e.description = els.fDescription.value.trim();
  e.weightType = els.fWeightType.value;
  e.category = els.fCategory.value;
  e.experience = els.fExperience.value;
  e.forceType = els.fForceType.value;
  return e;
}
function writeEntityToForm(entity){
  els.fId.value = entity?.id || '';
  els.fName.value = entity?.name || '';
  els.fImage.value = entity?.imageUrl || '';
  els.fDescription.value = entity?.description || '';
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
function selectItem(it){
  current = it; isNew = false;
  const e = it.entity || emptyTemplate();
  canonical = normalizeEntityShape(e);
  els.currentId.textContent = canonical?.id ? `Editing ID: ${canonical.id}` : 'Editing: unknown ID';
  writeEntityToForm(canonical);
  els.editor.value = pretty(canonical);
  validateAll();
  autosizeEditor();
  renderList();
  updateCommandBarVisibility(); // reflect active state
}
function newItem(){
  current = null; isNew = true;
  canonical = emptyTemplate();
  els.currentId.textContent = 'Creating new item (ID will be assigned on save)';
  writeEntityToForm(canonical);
  els.editor.value = pretty(canonical);
  setViewForm();            // default to Form for new
  validateAll();
  autosizeEditor && autosizeEditor();
  updateCommandBarVisibility(); // reflect active state
}

async function loadList(){
  const headers = {accept:'application/json', ...bearer()};
  if (!headers.Authorization){
    toast({title:'Token required', message:'Set a valid Bearer token first.', type:'error', ms:3500}); return;
  }
  els.load.disabled = true;
  try{
    const resp = await fetch(LIST_ENDPOINT, {headers, method:'GET'});
    if(!resp.ok){
      const text = await resp.text(); throw new Error(`${resp.status} ${resp.statusText} — ${text.slice(0,300)}`);
    }
    const data = await resp.json();
    if(!Array.isArray(data)) throw new Error('Unexpected response shape: expected an array');
    items = data; filtered = items.slice();
    renderList(); toast({title:'Loaded', message:`Items: ${items.length}`});
  }catch(e){
    toast({title:'Load failed', message:String(e.message||e), type:'error', ms:6000}); console.error(e);
  }finally{ els.load.disabled = false; }
}

async function saveCurrent(){
  const headers = {'accept':'application/json','content-type':'application/json', ...bearer()};
  if (!headers.Authorization){
    toast({title:'Token required', message:'Set a valid Bearer token first.', type:'error'}); 
    return; 
  }

  const ent = readFormToEntity(getEntity());
  setEntity(ent);
  const {ok} = validateAll();
  if (!ok){ toast({title:'Fix validation errors', type:'error'}); return; }

  els.saveBtn.disabled = true;
  try{
    if (isNew){
      // Create: DO NOT send id
      const payload = {...canonical};
      delete payload.id;

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

      const payload = {...canonical};
      delete payload.id;

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
  }
}

// ===== Validation (imageUrl -> warning only) =====
function validateAll(){
  const ent = getEntity();

  const errors = [];
  const warnings = [];

  if (!ent.name) errors.push('Missing: name');
  if (!ent.description) errors.push('Missing: description');
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

  const eq = Array.isArray(ent[FIELD.equipmentRefs]) ? ent[FIELD.equipmentRefs] : [];
  if (eq.length === 0) errors.push('No equipment selected');
  const unknownEq = eq.map(x=>String(x?.equipmentId||'')).filter(id => !dict.equipment.has(id));
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
  lines.push('1) ```json');
  lines.push('{ ...final JSON... }');
  lines.push('```');
  lines.push('2) Пояснение (на русском): кратко и по пунктам объясни, что улучшил(а) и почему (с опорой на НАЗВАНИЕ/ОПИСАНИЕ и общие знания/практику).');
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

// Builds an image-generation prompt using the same context (entity + dicts)
function buildGptImagePrompt(){
  const e = getEntity();

  // Selected equipment names (fallback to ID if name is unknown)
  const selectedEq = Array.isArray(e[FIELD.equipmentRefs]) ? e[FIELD.equipmentRefs] : [];
  const selectedEqLines = selectedEq.map(x => {
    const id = String(x?.equipmentId || '');
    const name = dict.equipment.get(id) || id;
    return `- ${name} — ${id}`;
  });

  // Bundles pretty print
  const bundles = Array.isArray(e[FIELD.bundles]) ? e[FIELD.bundles] : [];
  const bundleLines = bundles.map(b => {
    const id = String(b?.muscleId || '');
    const name = dict.muscles.get(id) || id;
    const p = Number(b?.percentage ?? 0);
    return `- ${name} — ${p}% (${id})`;
  });

  const lines = [];
  lines.push('ИНСТРУКЦИЯ ДЛЯ ИЗОБРАЖЕНИЯ (универсальная для серии)');
  lines.push(`Цель: создать одно превью упражнения «${e.name || '(empty)'}» из описания, один кадр, один персонаж, только необходимое оборудование. Всё полностью влезает в кадр.`);
  lines.push('');
  lines.push('Стиль серии (фиксированный для всех картинок)');
  lines.push('Визуал: чистый полу-реалистичный clay/3D-иллюстрация с мягкими градиентами, без брендинга и текста. Материалы матовые.');
  lines.push('');
  lines.push('Персонаж: нейтральный андрогинный манекен без лица/волос, однотонная форма (топ/шорты).');
  lines.push('');
  lines.push('Окружение: минималистичная студия, нейтральный фон, без окон/зеркал/логотипов.');
  lines.push('');
  lines.push('Освещение: мягкий студийный, верхне-боковой рассеянный источник, мягкие тени.');
  lines.push('');
  lines.push('Параметры кадра (фиксированные)');
  lines.push('Соотношение сторон: 4:3 (рекоменд. 800×600; итог не меньше 2048×1536).');
  lines.push('Камера: 3/4 вид, лёгкая изометрия, угол сверху ~10–15°, фокусное экв. 35–50мм.');
  lines.push('Безопасные поля: по 5–10% со всех сторон; не обрезать голову, ступни, снаряд.');
  lines.push('');
  lines.push('Состав кадра');
  lines.push('Один персонаж + один основной снаряд (или один набор тренажёра) из «Equipment dictionary».');
  lines.push('Выбор оборудования делай из описания: включай только то, что указано в equipment. Если требуется платформа/скамья — размести её целиком.');
  lines.push('Угол и дистанцию подстрой так, чтобы и атлет, и оборудование полностью видны в 4:3.');
  lines.push('');
  lines.push('Поза и техника (из Description)');
  lines.push('Покажи узнаваемый момент середины амплитуды или позицию, лучше всего демонстрирующую механику (хват, постановка ног, наклон корпуса, траектория).');
  lines.push('Следуй указаниям по хвату (pronated/neutral/supinated), ширине, углам в тазобедренных/коленных/плечевых суставах.');
  lines.push('Спина нейтральная, шея в продолжение позвоночника; линии движения и векторы усилия читаемы.');
  lines.push('');
  lines.push('ПАЛИТРА (единый стиль, подходит для light/dark):');
  lines.push('Основной акцент: #3366FF');
  lines.push('Доп. тёплый акцент (иногда для рима/свечения): #FFA726');
  lines.push('Светлый нейтральный фон (light): #EDEFF1');
  lines.push('Тёмный нейтральный фон (dark): #262A31');
  lines.push('Универсальный фон-градиент (оба режима): центр #CBD0D8 → края #2E333B (радиальный). Фолбэк: #EDEFF1 (light) / #262A31 (dark).');
  lines.push('Контуры для читаемости: двойной штрих — внутренний #FAFAFA @35% (2px), внешний #15181F @60% (3px).');
  lines.push('Правила: не более двух акцентных цветов одновременно; избегать больших заливок чистым #FFFFFF/#000000; держать контраст ≥ 4.5:1.');
  lines.push('');
  lines.push('Запреты (negative)');
  lines.push('Нет текста, логотипов, UI, водяных знаков.');
  lines.push('Нет лишних людей, зеркал, окон, зрителей, декоративного инвентаря.');
  lines.push('Без экстремальной перспективы, сильного блеска/глянца, motion blur, шума.');
  lines.push('');
  lines.push('Контроль перед выводом');
  lines.push('Формат строго 4:3, разрешение не меньше 2048×1536.');
  lines.push('В кадре только один персонаж и только необходимое оборудование.');
  lines.push('Ключевые детали техники из описания соблюдены; ничего не обрезано.');
  lines.push('');
  lines.push('---');
  lines.push(`Name: ${e.name || '(empty)'}`);
  lines.push(`Description: ${e.description || '(empty)'}`);
  lines.push('');
  lines.push('Selected equipment (use only what is listed):');
  if (selectedEqLines.length){ lines.push(...selectedEqLines); } else { lines.push('- (none)'); }
  lines.push('');
  lines.push('Muscle bundles (for context; do not render text):');
  if (bundleLines.length){ lines.push(...bundleLines); } else { lines.push('- (none)'); }
  lines.push('');
  lines.push('Muscles dictionary (name — id):');
  for (const [id, name] of dict.muscles.entries()) lines.push(`- ${name} — ${id}`);
  lines.push('');
  lines.push('Equipment dictionary (name — id):');
  for (const [id, name] of dict.equipment.entries()) lines.push(`- ${name} — ${id}`);

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
  els.viewForm.classList.add('active'); els.viewJson.classList.remove('active');
  els.builder.classList.add('show'); els.editor.hidden = true;
  document.body.classList.add('hide-json-controls'); // hides Format/Copy buttons
  updateCommandBarVisibility();
}
function setViewJson(){
  els.viewJson.classList.add('active'); els.viewForm.classList.remove('active');
  els.builder.classList.remove('show'); els.editor.hidden = false;
  els.editor.value = pretty(getEntity());
  document.body.classList.remove('hide-json-controls');
  updateCommandBarVisibility();
}

// ===== Bootstrap =====
window.addEventListener('DOMContentLoaded', async ()=>{
  els.token.value = loadTokenLocal();
  loadEdited(); // restore edited IDs for this tab session

  await Promise.all([fetchEquipmentDict(), fetchMuscleDict()]);
  refreshOptionLists();

  // Sidebar
  els.load.addEventListener('click', loadList);
  els.search.addEventListener('input', applySearch);
  if (els.clearSearch) {
    els.clearSearch.addEventListener('click', ()=>{ els.search.value=''; applySearch(); });
  }
  els.newBtn.addEventListener('click', newItem);

  // Header actions
  els.saveToken.addEventListener('click', ()=>{ saveTokenLocal(els.token.value); toast({title:'Token saved'}); });
  els.saveBtn.addEventListener('click', saveCurrent);
  els.formatBtn.addEventListener('click', ()=>{
    try{
      const obj = JSON.parse(els.editor.value);
      els.editor.value = pretty(obj);
      validateAll();
      autosizeEditor();
    }catch(e){
      toast({title:'Format error', message:String(e.message||e), type:'error'});
    }
  });
  els.copyEntityBtn.addEventListener('click', ()=> copyToClipboard(els.editor.value, 'Editor JSON copied'));
  els.copyFullBtn.addEventListener('click', ()=>{
    if (!current){ toast({title:'Nothing selected', type:'error'}); return; }
    copyToClipboard(JSON.stringify(current,null,2), 'Full item JSON copied');
  });
  els.promptBtn.addEventListener('click', copyPrompt);
  els.promptImgBtn.addEventListener('click', copyImagePrompt);

  // View
  els.viewForm.addEventListener('click', setViewForm);
  els.viewJson.addEventListener('click', setViewJson);

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
    try{
      const obj = JSON.parse(els.editor.value);
      canonical = normalizeEntityShape(obj);
      writeEntityToForm(canonical);
      validateAll();
    }catch{
      setStatus('bad','Invalid JSON'); els.saveBtn.disabled = true;
    }
  });

  // Start — nothing selected yet, no "New" pressed
  current = null; isNew = false;
  canonical = emptyTemplate();
  els.builder.classList.remove('show');
  els.editor.hidden = true;
  document.body.classList.add('hide-json-controls');

  updateCommandBarVisibility(); // hide GPT/Save/toggle/status
  updateStickyOffsets();
  window.addEventListener('resize', updateStickyOffsets);
});

// ===== Helpers =====
async function copyToClipboard(text, label='Copied'){
  try{ await navigator.clipboard.writeText(text); toast({title:label}); }
  catch(e){
    const ta = document.createElement('textarea'); ta.value=text; document.body.appendChild(ta);
    ta.select(); document.execCommand('copy'); ta.remove(); toast({title:label});
  }
}

// CORS hint wrapper
(function patchFetchForHints(){
  const orig = window.fetch;
  window.fetch = async (...args)=>{
    try{ return await orig(...args); }
    catch(e){
      toast({
        title:'Network error',
        message:'If this runs on GitHub Pages, enable CORS on grippo-app.com for GET, POST, PUT and header Authorization.',
        type:'error', ms:8000
      });
      throw e;
    }
  };
})();

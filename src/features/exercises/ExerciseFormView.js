import { FIELD, DEFAULT_LANGUAGE } from '../../shared/constants/index.js';
import { ExerciseNormalizer }       from '../../domain/exercise/ExerciseNormalizer.js';
import { Toast }                    from '../../shared/components/Toast.js';

/**
 * ExerciseFormView — renders the exercise form and reacts to store changes.
 *
 * Responsibilities:
 *  - Populate form inputs from a canonical entity object (writeEntityToForm)
 *  - Read form inputs back into a canonical entity object (readFormToEntity)
 *  - Manage component-rules checkbox visibility (updateRulesInputsVisibility)
 *  - Render equipment tokens and muscle-bundle rows
 *  - Handle locale switching, equipment add/remove, bundle add/remove
 *
 * Does NOT make HTTP calls — delegates to onSave / onDelete callbacks.
 * Does NOT navigate — delegates section changes to the store (setViewMode, setLocale).
 */
export class ExerciseFormView {
  /**
   * @param {{
   *   store:       ExerciseStore,
   *   validator:   ExerciseValidator,
   *   dictionaries: DictionaryStore,
   *   els: {
   *     saveBtn, viewForm, viewJson,
   *     builder, editorWrap, editor,
   *     fId, fName, fImage, fDescription,
   *     fWeightType, fCategory, fExperience, fForceType,
   *     fRulesExternalWeightEnabled, fRulesExternalWeightRequired,
   *     fRulesBodyWeightEnabled, fRulesBodyWeightMultiplier, fRulesBodyWeightMultiplierValue,
   *     fRulesExtraWeightEnabled, fRulesExtraWeightRequired,
   *     fRulesAssistanceEnabled, fRulesAssistanceRequired,
   *     equipTokens, equipSingle, equipAdd, equipClear,
   *     bundles, muscleSelect, percentInput, bundleAdd, bundleSumInfo,
   *     previewCard, previewImg, previewEmpty, previewFrame,
   *     localeButtons, localeSwitcher
   *   },
   *   onSave:   (entity) => Promise<void>,
   *   onDelete: (id)     => Promise<void>
   * }} deps
   */
  constructor({ store, validator, dictionaries, els, onSave, onDelete }) {
    this._store     = store;
    this._validator = validator;
    this._dicts     = dictionaries;
    this._els       = els;
    this._onSave    = onSave;
    this._onDelete  = onDelete;

    this._locale               = store.getState().locale || DEFAULT_LANGUAGE;
    this._bodyWeightMultiplier = 1;

    this._bindEvents();
    store.subscribe((state) => this._onStateChange(state));
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Populate all form inputs from a canonical entity + active locale.
   *
   * @param {object} entity  — canonical exercise shape
   * @param {string} locale  — active locale ('en' | 'ua' | 'ru')
   */
  writeEntityToForm(entity, locale) {
    if (!entity) return;
    const loc = locale || this._locale;

    const nameTrans = ExerciseNormalizer.ensureTranslationMap(entity?.nameTranslations);
    const descTrans = ExerciseNormalizer.ensureTranslationMap(entity?.descriptionTranslations);
    const localeName = ExerciseNormalizer.getTranslation(nameTrans, loc);
    const localeDesc = ExerciseNormalizer.getTranslation(descTrans, loc);
    const defaultName = ExerciseNormalizer.getTranslation(nameTrans, DEFAULT_LANGUAGE) || entity?.name || '';
    const defaultDesc = ExerciseNormalizer.getTranslation(descTrans, DEFAULT_LANGUAGE) || entity?.description || '';

    if (this._els.fId) this._els.fId.value = entity?.id || '';

    if (this._els.fName) {
      this._els.fName.value       = localeName;
      this._els.fName.placeholder = ExerciseNormalizer.buildLocalePlaceholder('Exercise name', defaultName, loc);
    }

    if (this._els.fImage) this._els.fImage.value = entity?.imageUrl || '';
    this._renderImagePreview(entity?.imageUrl || '');

    if (this._els.fDescription) {
      this._els.fDescription.value       = localeDesc;
      this._els.fDescription.placeholder = ExerciseNormalizer.buildLocalePlaceholder('Short description', defaultDesc, loc);
    }

    if (this._els.fWeightType) this._els.fWeightType.value = entity?.weightType || '';
    if (this._els.fCategory)   this._els.fCategory.value   = entity?.category   || '';
    if (this._els.fExperience) this._els.fExperience.value = entity?.experience  || '';
    if (this._els.fForceType)  this._els.fForceType.value  = entity?.forceType   || '';

    // Components (exercise rules)
    const components = entity?.components || entity?.rules?.components || {};
    const extW   = components?.externalWeight;
    const bodyW  = components?.bodyWeight;
    const extraW = components?.extraWeight;
    const assistW = components?.assistWeight;
    const bwm = Number(bodyW?.multiplier);
    this._bodyWeightMultiplier = Number.isFinite(bwm) ? bwm : 1;

    if (this._els.fRulesExternalWeightEnabled)  this._els.fRulesExternalWeightEnabled.checked  = !!extW;
    if (this._els.fRulesExternalWeightRequired) this._els.fRulesExternalWeightRequired.checked = !!extW?.required;
    if (this._els.fRulesBodyWeightEnabled)      this._els.fRulesBodyWeightEnabled.checked      = !!bodyW;
    if (this._els.fRulesBodyWeightMultiplier)   this._els.fRulesBodyWeightMultiplier.value     = String(this._bodyWeightMultiplier);
    this._syncBodyWeightMultiplierLabel();
    if (this._els.fRulesExtraWeightEnabled)  this._els.fRulesExtraWeightEnabled.checked  = !!extraW;
    if (this._els.fRulesExtraWeightRequired) this._els.fRulesExtraWeightRequired.checked = !!extraW?.required;
    if (this._els.fRulesAssistanceEnabled)   this._els.fRulesAssistanceEnabled.checked   = !!assistW;
    if (this._els.fRulesAssistanceRequired)  this._els.fRulesAssistanceRequired.checked  = !!assistW?.required;

    this.updateRulesInputsVisibility();
    this._renderEquipmentTokens(entity);
    this._renderBundles(entity);
  }

  /**
   * Read all form inputs into a canonical entity object.
   * Merges with the store's current entity so non-form fields (id, bundles, etc.) are preserved.
   *
   * @returns {object} canonical entity shape
   */
  readFormToEntity() {
    const { current } = this._store.getState();
    const e   = { ...(current || ExerciseNormalizer.emptyTemplate()) };
    const loc = this._locale;

    const nameValue = this._els.fName?.value.trim()        || '';
    const descValue = this._els.fDescription?.value.trim() || '';

    e.nameTranslations        = ExerciseNormalizer.ensureTranslationMap(e.nameTranslations);
    e.descriptionTranslations = ExerciseNormalizer.ensureTranslationMap(e.descriptionTranslations);
    e.nameTranslations[loc]        = nameValue;
    e.descriptionTranslations[loc] = descValue;
    e.name        = ExerciseNormalizer.getTranslation(e.nameTranslations,        DEFAULT_LANGUAGE);
    e.description = ExerciseNormalizer.getTranslation(e.descriptionTranslations, DEFAULT_LANGUAGE);

    e.imageUrl   = this._els.fImage?.value.trim()      || '';
    e.weightType = this._els.fWeightType?.value        || '';
    e.category   = this._els.fCategory?.value          || '';
    e.experience = this._els.fExperience?.value        || '';
    e.forceType  = this._els.fForceType?.value         || '';

    const externalEnabled = !!this._els.fRulesExternalWeightEnabled?.checked;
    const bodyEnabled     = !!this._els.fRulesBodyWeightEnabled?.checked;
    const extraEnabled    = !!this._els.fRulesExtraWeightEnabled?.checked;
    const assistEnabled   = !!this._els.fRulesAssistanceEnabled?.checked;

    e.components = {
      externalWeight: externalEnabled
        ? { required: !!this._els.fRulesExternalWeightRequired?.checked }
        : null,
      bodyWeight: bodyEnabled
        ? { required: true, multiplier: this._bodyWeightMultiplier }
        : null,
      extraWeight: bodyEnabled && extraEnabled
        ? { required: !!this._els.fRulesExtraWeightRequired?.checked }
        : null,
      assistWeight: bodyEnabled && assistEnabled
        ? { required: !!this._els.fRulesAssistanceRequired?.checked }
        : null,
    };

    return e;
  }

  /**
   * Enforce mutual exclusivity and cascading disabled state for component checkboxes.
   *
   * @param {'external'|'body'|''} [preferred] — which side "won" when both were checked
   */
  updateRulesInputsVisibility(preferred) {
    const externalEnabled = !!this._els.fRulesExternalWeightEnabled?.checked;
    const bodyEnabled     = !!this._els.fRulesBodyWeightEnabled?.checked;

    // Mutual exclusivity: external weight ↔ body weight
    if (externalEnabled && bodyEnabled) {
      if (preferred === 'body') {
        if (this._els.fRulesExternalWeightEnabled) this._els.fRulesExternalWeightEnabled.checked = false;
      } else {
        if (this._els.fRulesBodyWeightEnabled) this._els.fRulesBodyWeightEnabled.checked = false;
      }
    }

    const finalExternal = !!this._els.fRulesExternalWeightEnabled?.checked;
    const finalBody     = !!this._els.fRulesBodyWeightEnabled?.checked;

    if (this._els.fRulesExternalWeightRequired) {
      this._els.fRulesExternalWeightRequired.disabled = !finalExternal;
      if (!finalExternal) this._els.fRulesExternalWeightRequired.checked = false;
    }

    if (this._els.fRulesBodyWeightMultiplier) {
      this._els.fRulesBodyWeightMultiplier.disabled = !finalBody;
      this._els.fRulesBodyWeightMultiplier.value    = String(this._bodyWeightMultiplier);
      this._syncBodyWeightMultiplierLabel();
    }

    if (this._els.fRulesExtraWeightEnabled) {
      this._els.fRulesExtraWeightEnabled.disabled = !finalBody;
      if (!finalBody) this._els.fRulesExtraWeightEnabled.checked = false;
    }

    if (this._els.fRulesExtraWeightRequired) {
      const enabled = finalBody && !!this._els.fRulesExtraWeightEnabled?.checked;
      this._els.fRulesExtraWeightRequired.disabled = !enabled;
      if (!enabled) this._els.fRulesExtraWeightRequired.checked = false;
    }

    if (this._els.fRulesAssistanceEnabled) {
      this._els.fRulesAssistanceEnabled.disabled = !finalBody;
      if (!finalBody) this._els.fRulesAssistanceEnabled.checked = false;
    }

    if (this._els.fRulesAssistanceRequired) {
      const enabled = finalBody && !!this._els.fRulesAssistanceEnabled?.checked;
      this._els.fRulesAssistanceRequired.disabled = !enabled;
      if (!enabled) this._els.fRulesAssistanceRequired.checked = false;
    }
  }

  // ── Private: state ────────────────────────────────────────────────────────

  _onStateChange({ current, locale, viewMode }) {
    if (locale && locale !== this._locale) {
      this._locale = locale;
      this._updateLocaleUI();
    }
    if (current) {
      this._refreshOptionLists();
      this.writeEntityToForm(current, this._locale);
    }
    this._applyViewMode(viewMode);
  }

  _applyViewMode(mode) {
    const showForm = mode !== 'json';
    if (this._els.builder)    this._els.builder.hidden    = !showForm;
    if (this._els.editorWrap) this._els.editorWrap.hidden =  showForm;
  }

  // ── Private: UI helpers ───────────────────────────────────────────────────

  _syncBodyWeightMultiplierLabel() {
    if (!this._els.fRulesBodyWeightMultiplierValue) return;
    const value = Number(this._els.fRulesBodyWeightMultiplier?.value);
    this._els.fRulesBodyWeightMultiplierValue.textContent =
      Number.isFinite(value) ? `${value.toFixed(2)}×` : '—';
  }

  _renderImagePreview(url) {
    if (!this._els.previewCard) return;
    const hasImage = !!url;
    const altName  = (this._els.fName?.value || 'Exercise').trim();
    if (this._els.previewImg) {
      if (hasImage) {
        this._els.previewImg.src = url;
        this._els.previewImg.alt = `${altName} illustration`;
      } else {
        this._els.previewImg.removeAttribute('src');
        this._els.previewImg.alt = 'Exercise image preview';
      }
    }
    if (this._els.previewEmpty) {
      this._els.previewEmpty.textContent = 'No image selected yet';
    }
    this._els.previewCard.classList.toggle('has-image', hasImage);
    if (this._els.previewFrame) {
      this._els.previewFrame.setAttribute('aria-disabled', hasImage ? 'false' : 'true');
    }
  }

  _updateLocaleUI() {
    if (!this._els.localeButtons) return;
    Array.from(this._els.localeButtons).forEach(btn => {
      btn.classList.toggle('active', btn.dataset.locale === this._locale);
    });
    if (this._els.localeSwitcher) this._els.localeSwitcher.style.display = '';
  }

  // ── Private: equipment ───────────────────────────────────────────────────

  _renderEquipmentTokens(entity) {
    if (!this._els.equipTokens) return;
    const eq = Array.isArray(entity?.[FIELD.equipmentRefs]) ? entity[FIELD.equipmentRefs] : [];
    this._els.equipTokens.innerHTML = '';
    const frag = document.createDocumentFragment();

    eq.forEach((obj, index) => {
      const id   = String(obj?.equipmentId || '');
      const name = this._dicts.getEquipmentName(id) || id;

      const token = document.createElement('span');
      token.className = 'token';
      if (!this._dicts.equipment.has(id)) token.classList.add('invalid');
      token.innerHTML = `<span>${name}</span>`;

      const removeBtn = document.createElement('button');
      removeBtn.type        = 'button';
      removeBtn.textContent = '×';
      removeBtn.title       = 'Remove';
      removeBtn.addEventListener('click', () => {
        const { current } = this._store.getState();
        const arr = [...(current?.[FIELD.equipmentRefs] || [])];
        arr.splice(index, 1);
        this._store.setCurrent({ ...current, [FIELD.equipmentRefs]: arr });
      });

      token.appendChild(removeBtn);
      frag.appendChild(token);
    });

    this._els.equipTokens.appendChild(frag);
  }

  _refreshOptionLists() {
    if (this._els.equipSingle) {
      this._els.equipSingle.innerHTML = '';
      for (const [id, name] of this._dicts.equipment.entries()) {
        const opt = document.createElement('option');
        opt.value       = id;
        opt.textContent = `${name} — ${id}`;
        this._els.equipSingle.appendChild(opt);
      }
    }
    if (this._els.muscleSelect) {
      this._els.muscleSelect.innerHTML = '';
      for (const [id, name] of this._dicts.muscles.entries()) {
        const opt = document.createElement('option');
        opt.value       = id;
        opt.textContent = `${name} — ${id}`;
        this._els.muscleSelect.appendChild(opt);
      }
    }
  }

  // ── Private: bundles ─────────────────────────────────────────────────────

  _renderBundles(entity) {
    if (!this._els.bundles) return;
    const arr = Array.isArray(entity?.[FIELD.bundles]) ? entity[FIELD.bundles] : [];
    this._els.bundles.innerHTML = '';
    const frag = document.createDocumentFragment();
    let sum = 0;

    arr.forEach((bundle, index) => {
      const row = document.createElement('div');
      row.className = 'bundle-row';

      // Muscle select
      const muscleEl = document.createElement('select');
      for (const [id, name] of this._dicts.muscles.entries()) {
        const opt = document.createElement('option');
        opt.value       = id;
        opt.textContent = `${name} — ${id}`;
        if (String(bundle?.muscleId || '') === id) opt.selected = true;
        muscleEl.appendChild(opt);
      }
      if (!this._dicts.muscles.has(String(bundle?.muscleId || ''))) {
        muscleEl.classList.add('invalid');
      }

      // Percentage input
      const percentEl  = document.createElement('input');
      percentEl.type        = 'number';
      percentEl.min         = '0';
      percentEl.max         = '100';
      percentEl.step        = '1';
      percentEl.placeholder = '%';
      const pVal = Number(bundle?.percentage ?? 0);
      percentEl.value = String(pVal);
      if (!isFinite(pVal) || pVal < 0 || pVal > 100) percentEl.classList.add('invalid');
      sum += isFinite(pVal) ? pVal : 0;

      // Remove button
      const removeBtn = document.createElement('button');
      removeBtn.className   = 'btn muted';
      removeBtn.type        = 'button';
      removeBtn.textContent = 'Remove';

      muscleEl.addEventListener('change', () => {
        const { current } = this._store.getState();
        const bundles = [...(current?.[FIELD.bundles] || [])];
        bundles[index] = { ...bundles[index], muscleId: muscleEl.value };
        this._store.setCurrent({ ...current, [FIELD.bundles]: bundles });
      });
      percentEl.addEventListener('change', () => {
        const { current } = this._store.getState();
        const bundles = [...(current?.[FIELD.bundles] || [])];
        bundles[index] = { ...bundles[index], percentage: Number(percentEl.value || 0) };
        this._store.setCurrent({ ...current, [FIELD.bundles]: bundles });
      });
      removeBtn.addEventListener('click', () => {
        const { current } = this._store.getState();
        const bundles = [...(current?.[FIELD.bundles] || [])];
        bundles.splice(index, 1);
        this._store.setCurrent({ ...current, [FIELD.bundles]: bundles });
      });

      row.appendChild(muscleEl);
      row.appendChild(percentEl);
      row.appendChild(removeBtn);
      frag.appendChild(row);
    });

    this._els.bundles.appendChild(frag);

    if (this._els.bundleSumInfo) {
      this._els.bundleSumInfo.textContent = `Sum: ${sum}%`;
      this._els.bundleSumInfo.className   = `sum ${sum === 100 ? 'ok' : 'bad'}`;
    }
  }

  _addBundleFromInputs() {
    const muscleId   = this._els.muscleSelect?.value;
    const percentage = Number(this._els.percentInput?.value || 0);
    if (!muscleId || !isFinite(percentage)) {
      Toast.show({ title: 'Select muscle and %', type: 'error' });
      return;
    }
    if (!this._dicts.muscles.has(muscleId)) {
      Toast.show({ title: 'Unknown muscle', type: 'error' });
      return;
    }
    const { current } = this._store.getState();
    const bundles = [...(Array.isArray(current?.[FIELD.bundles]) ? current[FIELD.bundles] : [])];
    bundles.push({ muscleId, percentage });
    this._store.setCurrent({ ...current, [FIELD.bundles]: bundles });
    if (this._els.percentInput) this._els.percentInput.value = '';
  }

  // ── Private: event binding ───────────────────────────────────────────────

  _bindEvents() {
    // Save
    this._els.saveBtn?.addEventListener('click', async () => {
      const entity = this.readFormToEntity();
      const { ok, errors, warnings } = this._validator.validate(entity);
      if (!ok) {
        Toast.show({ title: 'Validation failed', message: errors[0], type: 'error' });
        return;
      }
      if (warnings.length) {
        Toast.show({ title: 'Warning', message: warnings[0], type: 'warning' });
      }
      await this._onSave(entity);
    });

    // View mode toggle
    this._els.viewForm?.addEventListener('click', () => this._store.setViewMode('form'));
    this._els.viewJson?.addEventListener('click', () => this._store.setViewMode('json'));

    // Image preview live update
    this._els.fImage?.addEventListener('input', () => {
      this._renderImagePreview(this._els.fImage.value.trim());
    });

    // Rules checkboxes — mutual exclusivity + cascading disable
    [
      this._els.fRulesExternalWeightEnabled,
      this._els.fRulesExternalWeightRequired,
      this._els.fRulesBodyWeightEnabled,
      this._els.fRulesExtraWeightEnabled,
      this._els.fRulesExtraWeightRequired,
      this._els.fRulesAssistanceEnabled,
      this._els.fRulesAssistanceRequired,
    ].filter(Boolean).forEach(input => input.addEventListener('change', (event) => {
      const id = event?.target?.id;
      const preferred =
        id === 'fRulesExternalWeightEnabled' ? 'external' :
        id === 'fRulesBodyWeightEnabled'     ? 'body'     : '';
      // Auto-enable parent when required is ticked
      if (id === 'fRulesExtraWeightRequired'    && this._els.fRulesExtraWeightEnabled)
        this._els.fRulesExtraWeightEnabled.checked   = true;
      if (id === 'fRulesAssistanceRequired'     && this._els.fRulesAssistanceEnabled)
        this._els.fRulesAssistanceEnabled.checked    = true;
      if (id === 'fRulesExternalWeightRequired' && this._els.fRulesExternalWeightEnabled)
        this._els.fRulesExternalWeightEnabled.checked = true;
      this.updateRulesInputsVisibility(preferred);
    }));

    // Body weight multiplier slider
    this._els.fRulesBodyWeightMultiplier?.addEventListener('input', () => {
      const value = Number(this._els.fRulesBodyWeightMultiplier.value);
      if (Number.isFinite(value)) this._bodyWeightMultiplier = value;
      this._syncBodyWeightMultiplierLabel();
    });

    // Locale switcher
    Array.from(this._els.localeButtons || []).forEach(btn => {
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        const lang = btn.dataset.locale;
        if (!lang) return;
        // Flush current locale text into store before switching
        const entity = this.readFormToEntity();
        this._store.setCurrent(entity);
        this._locale = lang;
        this._store.setLocale(lang);
        this._updateLocaleUI();
        this.writeEntityToForm(this._store.getState().current, lang);
      });
    });

    // Equipment
    this._els.equipAdd?.addEventListener('click', () => {
      const id = this._els.equipSingle?.value;
      if (!id) { Toast.show({ title: 'Select equipment', type: 'error' }); return; }
      if (!this._dicts.equipment.has(id)) { Toast.show({ title: 'Unknown equipment', type: 'error' }); return; }
      const { current } = this._store.getState();
      const refs = Array.isArray(current?.[FIELD.equipmentRefs]) ? [...current[FIELD.equipmentRefs]] : [];
      if (!refs.some(x => x.equipmentId === id)) refs.push({ equipmentId: id });
      this._store.setCurrent({ ...current, [FIELD.equipmentRefs]: refs });
    });

    this._els.equipClear?.addEventListener('click', () => {
      const { current } = this._store.getState();
      this._store.setCurrent({ ...current, [FIELD.equipmentRefs]: [] });
    });

    // Bundles
    this._els.bundleAdd?.addEventListener('click', () => this._addBundleFromInputs());
    this._els.percentInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); this._addBundleFromInputs(); }
    });
  }
}

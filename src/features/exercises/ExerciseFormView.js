import {DEFAULT_LANGUAGE, FIELD} from '../../shared/constants/index.js';
import {ExerciseNormalizer} from '../../domain/exercise/index.js';
import {Toast} from '../../shared/components/Toast.js';
import {sanitizeUrl} from '../../shared/utils/index.js';

export class ExerciseFormView {
    /**
     * @param {{
     *   store:       ExerciseStore,
     *   validator:   ExerciseValidator,
     *   dictionaries: DictionaryStore,
     *   els: {
     *     saveBtn, deleteBtn, viewForm, viewJson,
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
    constructor({store, validator, dictionaries, els, onSave, onDelete, onLocaleChange}) {
        this._store = store;
        this._validator = validator;
        this._dicts = dictionaries;
        this._els = els;
        this._onSave = onSave;
        this._onDelete = onDelete;
        this._onLocaleChange = onLocaleChange;

        this._locale = store.getState().locale || DEFAULT_LANGUAGE;
        this._viewMode = store.getState().viewMode || 'form';
        this._bodyWeightMultiplier = 1;

        // Кеш для дедупликации перерисовок формы. _onStateChange срабатывает
        // на ЛЮБОЕ изменение стора (search, sort, loading, saving) — нельзя
        // дёргать writeEntityToForm каждый раз, иначе затрутся правки юзера в полях.
        this._lastRendered = {current: null, locale: null, isNew: null};

        this._bindEvents();
        this._unsubscribe = store.subscribe((state) => this._onStateChange(state));

        // Apply initial view mode so UI matches store state from the start
        this._applyViewMode(this._viewMode);
    }

    /** Снять подписки на стор. Для тестов / HMR. */
    destroy() {
        this._unsubscribe?.();
        this._unsubscribe = null;
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Populate the equipment and muscle <select> dropdowns from the dictionary store.
     * Call this once after dictionaries have been loaded so the options are ready
     * before the user opens any exercise (not deferred until first selectItem).
     *
     * Также пересобирает equipment tokens и bundle rows у текущего entity —
     * иначе элементы, отрендеренные до загрузки словарей, остаются с классом 'invalid'.
     */
    refreshOptionLists() {
        this._refreshOptionLists();
        const {current} = this._store.getState();
        if (current) {
            this._renderEquipmentTokens(current);
            this._renderBundles(current);
        }
    }

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
            this._els.fName.value = localeName;
            this._els.fName.placeholder = ExerciseNormalizer.buildLocalePlaceholder('Exercise name', defaultName, loc);
        }

        if (this._els.fImage) this._els.fImage.value = entity?.imageUrl || '';
        this._renderImagePreview(entity?.imageUrl || '');

        if (this._els.fDescription) {
            this._els.fDescription.value = localeDesc;
            this._els.fDescription.placeholder = ExerciseNormalizer.buildLocalePlaceholder('Short description', defaultDesc, loc);
        }

        if (this._els.fWeightType) this._els.fWeightType.value = entity?.weightType || '';
        if (this._els.fCategory) this._els.fCategory.value = entity?.category || '';
        if (this._els.fExperience) this._els.fExperience.value = entity?.experience || '';
        if (this._els.fForceType) this._els.fForceType.value = entity?.forceType || '';

        // Components (exercise rules)
        const components = entity?.components || entity?.rules?.components || {};
        const extW = components?.externalWeight;
        const bodyW = components?.bodyWeight;
        const extraW = components?.extraWeight;
        const assistW = components?.assistWeight;
        const bwm = Number(bodyW?.multiplier);
        this._bodyWeightMultiplier = Number.isFinite(bwm) ? bwm : 1;

        if (this._els.fRulesExternalWeightEnabled) this._els.fRulesExternalWeightEnabled.checked = !!extW;
        if (this._els.fRulesExternalWeightRequired) this._els.fRulesExternalWeightRequired.checked = !!extW?.required;
        if (this._els.fRulesBodyWeightEnabled) this._els.fRulesBodyWeightEnabled.checked = !!bodyW;
        if (this._els.fRulesBodyWeightMultiplier) this._els.fRulesBodyWeightMultiplier.value = String(this._bodyWeightMultiplier);
        this._syncBodyWeightMultiplierLabel();
        if (this._els.fRulesExtraWeightEnabled) this._els.fRulesExtraWeightEnabled.checked = !!extraW;
        if (this._els.fRulesExtraWeightRequired) this._els.fRulesExtraWeightRequired.checked = !!extraW?.required;
        if (this._els.fRulesAssistanceEnabled) this._els.fRulesAssistanceEnabled.checked = !!assistW;
        if (this._els.fRulesAssistanceRequired) this._els.fRulesAssistanceRequired.checked = !!assistW?.required;

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
        // In JSON view mode, parse from the raw editor
        if (this._viewMode === 'json' && this._els.editor) {
            try {
                const parsed = JSON.parse(this._els.editor.value);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    return parsed;
                }
                // null / array / primitive → fall through to form reading
            } catch {
                // Fall through to form reading
            }
        }
        const {current} = this._store.getState();
        const e = {...(current || ExerciseNormalizer.emptyTemplate())};
        const loc = this._locale;

        const nameValue = this._els.fName?.value.trim() || '';
        const descValue = this._els.fDescription?.value.trim() || '';

        e.nameTranslations = ExerciseNormalizer.ensureTranslationMap(e.nameTranslations);
        e.descriptionTranslations = ExerciseNormalizer.ensureTranslationMap(e.descriptionTranslations);
        e.nameTranslations[loc] = nameValue;
        e.descriptionTranslations[loc] = descValue;
        e.name = ExerciseNormalizer.getTranslation(e.nameTranslations, DEFAULT_LANGUAGE);
        e.description = ExerciseNormalizer.getTranslation(e.descriptionTranslations, DEFAULT_LANGUAGE);

        e.imageUrl = this._els.fImage?.value.trim() || '';
        e.weightType = this._els.fWeightType?.value || '';
        e.category = this._els.fCategory?.value || '';
        e.experience = this._els.fExperience?.value || '';
        e.forceType = this._els.fForceType?.value || '';

        const externalEnabled = !!this._els.fRulesExternalWeightEnabled?.checked;
        const bodyEnabled = !!this._els.fRulesBodyWeightEnabled?.checked;
        const extraEnabled = !!this._els.fRulesExtraWeightEnabled?.checked;
        const assistEnabled = !!this._els.fRulesAssistanceEnabled?.checked;

        e.components = {
            externalWeight: externalEnabled
                ? {required: !!this._els.fRulesExternalWeightRequired?.checked}
                : null,
            bodyWeight: bodyEnabled
                ? {required: true, multiplier: Number(this._els.fRulesBodyWeightMultiplier?.value) || this._bodyWeightMultiplier || 1}
                : null,
            extraWeight: bodyEnabled && extraEnabled
                ? {required: !!this._els.fRulesExtraWeightRequired?.checked}
                : null,
            assistWeight: bodyEnabled && assistEnabled
                ? {required: !!this._els.fRulesAssistanceRequired?.checked}
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
        const bodyEnabled = !!this._els.fRulesBodyWeightEnabled?.checked;

        // Mutual exclusivity: external weight ↔ body weight
        if (externalEnabled && bodyEnabled) {
            if (preferred === 'body') {
                if (this._els.fRulesExternalWeightEnabled) this._els.fRulesExternalWeightEnabled.checked = false;
            } else {
                if (this._els.fRulesBodyWeightEnabled) this._els.fRulesBodyWeightEnabled.checked = false;
            }
        }

        const finalExternal = !!this._els.fRulesExternalWeightEnabled?.checked;
        const finalBody = !!this._els.fRulesBodyWeightEnabled?.checked;

        if (this._els.fRulesExternalWeightRequired) {
            this._els.fRulesExternalWeightRequired.disabled = !finalExternal;
            if (!finalExternal) this._els.fRulesExternalWeightRequired.checked = false;
        }

        if (this._els.fRulesBodyWeightMultiplier) {
            this._els.fRulesBodyWeightMultiplier.disabled = !finalBody;
            this._els.fRulesBodyWeightMultiplier.value = String(this._bodyWeightMultiplier);
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

    _onStateChange({current, isNew, locale, viewMode, isSaving}) {
        // Always apply view mode — must run even if something below throws
        try {
            // Sync this._locale с состоянием стора. Это отдельный шаг, не путать с
            // мемоизацией — мемо хранит "последнюю отрисованную" локаль, а
            // this._locale — актуальный сказ стора.
            if (locale && locale !== this._locale) {
                this._locale = locale;
                this._updateLocaleUI();
            }

            // Перерисовываем форму ТОЛЬКО когда реально изменилось то,
            // что в неё пишется (current по reference, locale, или isNew).
            // Иначе search/sort/loading/saving события безусловно затирали
            // несохранённые правки юзера в полях.
            const currentChanged = current !== this._lastRendered.current;
            const localeChanged = this._locale !== this._lastRendered.locale;
            const isNewChanged = isNew !== this._lastRendered.isNew;
            const shouldRerender = current && (currentChanged || localeChanged || isNewChanged);

            if (shouldRerender) {
                this._refreshOptionLists();
                this.writeEntityToForm(current, this._locale);
                this._updateLocaleUI();
                this._updateCurrentId(current, isNew);
                if (this._viewMode === 'json') this._populateJsonEditor(current);
                this._lastRendered = {current, locale: this._locale, isNew};
            } else if (!current && this._lastRendered.current) {
                // current был, стал null — обновим placeholder ID
                this._updateCurrentId(null, isNew);
                this._lastRendered = {current: null, locale: this._locale, isNew};
            }
        } catch (e) {
            console.error('[ExerciseFormView] _onStateChange error:', e);
        }
        // Save доступен всегда (кроме момента активного сохранения), а отсутствие
        // выбранного упражнения отлавливаем тостом в click-handler.
        if (this._els.saveBtn) {
            this._els.saveBtn.disabled = !!isSaving;
            this._els.saveBtn.textContent = isSaving ? 'Saving…' : 'Save';
        }
        // Delete доступен только для уже сохранённого упражнения с реальным ID.
        // Для нового (несохранённого) и при отсутствии current — кнопку прячем,
        // иначе нечего удалять. На время сохранения тоже блокируем.
        if (this._els.deleteBtn) {
            const canDelete = !!current && !isNew && !!current.id;
            this._els.deleteBtn.hidden = !canDelete;
            this._els.deleteBtn.disabled = !canDelete || !!isSaving;
        }
        this._applyViewMode(viewMode);
    }

    _applyViewMode(mode) {
        const safeMode = mode || 'form';
        const wasJson = this._viewMode === 'json';
        const isJson = safeMode === 'json';
        this._viewMode = safeMode;

        // Use CSS class toggling — avoids conflict between hidden attribute and .show class
        if (this._els.builder) {
            this._els.builder.classList.toggle('show', !isJson);
            this._els.builder.hidden = isJson;
        }
        if (this._els.editorWrap) {
            this._els.editorWrap.classList.toggle('show', isJson);
            this._els.editorWrap.hidden = !isJson;
        }

        // Update segment button active states
        if (this._els.viewForm) this._els.viewForm.classList.toggle('active', !isJson);
        if (this._els.viewJson) this._els.viewJson.classList.toggle('active', isJson);
        if (this._els.viewForm) this._els.viewForm.setAttribute('aria-selected', String(!isJson));
        if (this._els.viewJson) this._els.viewJson.setAttribute('aria-selected', String(isJson));

        // jsonStatus is only meaningful in JSON mode
        if (this._els.jsonStatus) this._els.jsonStatus.hidden = !isJson;

        // Populate editor when switching TO json
        if (isJson && !wasJson) {
            const {current} = this._store.getState();
            if (current) this._populateJsonEditor(current);
        }
    }

    _populateJsonEditor(entity) {
        if (!this._els.editor) return;
        this._els.editor.value = JSON.stringify(entity, null, 2);
        this._validateJsonEditor();
    }

    _validateJsonEditor() {
        if (!this._els.jsonStatus) return;
        const text = this._els.editor?.value || '';
        try {
            JSON.parse(text);
            this._els.jsonStatus.textContent = 'Valid JSON';
            this._els.jsonStatus.className = 'status ok';
        } catch {
            this._els.jsonStatus.textContent = 'Invalid JSON';
            this._els.jsonStatus.className = 'status warn';
        }
    }

    _updateCurrentId(entity, isNew) {
        if (!this._els.currentId) return;
        if (isNew) {
            this._els.currentId.textContent = 'Creating new (ID on save)';
        } else {
            this._els.currentId.textContent = entity?.id ? `ID: ${entity.id}` : 'No item selected';
        }
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
        const safe = sanitizeUrl(url);
        const hasImage = !!safe;
        const altName = (this._els.fName?.value || 'Exercise').trim();
        if (this._els.previewImg) {
            if (hasImage) {
                // используем отвалидированный URL — без javascript:/data:/protocol-relative
                this._els.previewImg.src = safe;
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
        if (this._els.localeSwitcher) this._els.localeSwitcher.hidden = false;
    }

    // ── Private: equipment ───────────────────────────────────────────────────

    _renderEquipmentTokens(entity) {
        if (!this._els.equipTokens) return;
        const eq = Array.isArray(entity?.[FIELD.equipmentRefs]) ? entity[FIELD.equipmentRefs] : [];
        this._els.equipTokens.innerHTML = '';
        const frag = document.createDocumentFragment();

        eq.forEach((obj, index) => {
            const id = String(obj?.equipmentId || '');
            const name = this._dicts.getEquipmentName(id) || id;

            const token = document.createElement('span');
            token.className = 'token';
            if (!this._dicts.equipment.has(id)) token.classList.add('invalid');
            const nameEl = document.createElement('span');
            nameEl.textContent = name;
            token.appendChild(nameEl);

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.textContent = '×';
            removeBtn.title = 'Remove';
            removeBtn.addEventListener('click', () => {
                const formEntity = this.readFormToEntity();
                const arr = [...(formEntity?.[FIELD.equipmentRefs] || [])];
                arr.splice(index, 1);
                this._store.patchCurrent({...formEntity, [FIELD.equipmentRefs]: arr});
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
                opt.value = id;
                opt.textContent = `${name} — ${id}`;
                this._els.equipSingle.appendChild(opt);
            }
        }
        if (this._els.muscleSelect) {
            this._els.muscleSelect.innerHTML = '';
            for (const [id, name] of this._dicts.muscles.entries()) {
                const opt = document.createElement('option');
                opt.value = id;
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
                opt.value = id;
                opt.textContent = `${name} — ${id}`;
                if (String(bundle?.muscleId || '') === id) opt.selected = true;
                muscleEl.appendChild(opt);
            }
            if (!this._dicts.muscles.has(String(bundle?.muscleId || ''))) {
                muscleEl.classList.add('invalid');
            }

            // Percentage input
            const percentEl = document.createElement('input');
            percentEl.type = 'number';
            percentEl.min = '0';
            percentEl.max = '100';
            percentEl.step = '1';
            percentEl.placeholder = '%';
            const pVal = Number(bundle?.percentage ?? 0);
            percentEl.value = String(pVal);
            if (!isFinite(pVal) || pVal < 0 || pVal > 100) percentEl.classList.add('invalid');
            sum += isFinite(pVal) ? pVal : 0;

            // Remove button
            const removeBtn = document.createElement('button');
            removeBtn.className = 'btn muted';
            removeBtn.type = 'button';
            removeBtn.textContent = 'Remove';

            muscleEl.addEventListener('change', () => {
                const formEntity = this.readFormToEntity();
                const bundles = [...(formEntity?.[FIELD.bundles] || [])];
                bundles[index] = {...bundles[index], muscleId: muscleEl.value};
                this._store.patchCurrent({...formEntity, [FIELD.bundles]: bundles});
            });
            percentEl.addEventListener('change', () => {
                const formEntity = this.readFormToEntity();
                const bundles = [...(formEntity?.[FIELD.bundles] || [])];
                bundles[index] = {...bundles[index], percentage: Number(percentEl.value || 0)};
                this._store.patchCurrent({...formEntity, [FIELD.bundles]: bundles});
            });
            removeBtn.addEventListener('click', () => {
                const formEntity = this.readFormToEntity();
                const bundles = [...(formEntity?.[FIELD.bundles] || [])];
                bundles.splice(index, 1);
                this._store.patchCurrent({...formEntity, [FIELD.bundles]: bundles});
            });

            row.appendChild(muscleEl);
            row.appendChild(percentEl);
            row.appendChild(removeBtn);
            frag.appendChild(row);
        });

        this._els.bundles.appendChild(frag);

        if (this._els.bundleSumInfo) {
            this._els.bundleSumInfo.textContent = `Sum: ${sum}%`;
            this._els.bundleSumInfo.className = `sum ${sum === 100 ? 'ok' : 'bad'}`;
        }
    }

    _addBundleFromInputs() {
        const muscleId = this._els.muscleSelect?.value;
        const percentage = Number(this._els.percentInput?.value || 0);
        if (!muscleId || !isFinite(percentage)) {
            Toast.show({title: 'Select muscle and %', type: 'error'});
            return;
        }
        if (!this._dicts.muscles.has(muscleId)) {
            Toast.show({title: 'Unknown muscle', type: 'error'});
            return;
        }
        const formEntity = this.readFormToEntity();
        const bundles = [...(Array.isArray(formEntity?.[FIELD.bundles]) ? formEntity[FIELD.bundles] : [])];
        bundles.push({muscleId, percentage});
        this._store.patchCurrent({...formEntity, [FIELD.bundles]: bundles});
        if (this._els.percentInput) this._els.percentInput.value = '';
    }

    // ── Private: event binding ───────────────────────────────────────────────

    _bindEvents() {
        // Save
        this._els.saveBtn?.addEventListener('click', async () => {
            const {current} = this._store.getState();
            if (!current) {
                Toast.show({title: 'Nothing to save', message: 'Select an exercise from the list or click "New".', type: 'error'});
                return;
            }
            const entity = this.readFormToEntity();
            const {ok, errors, warnings} = this._validator.validate(entity);
            if (!ok) {
                Toast.show({title: 'Validation failed', message: errors[0], type: 'error'});
                return;
            }
            if (warnings.length) {
                Toast.show({title: 'Warning', message: warnings[0], type: 'warning'});
            }
            await this._onSave(entity);
        });

        // Delete — confirmation живёт в контроллере, тут только прокидываем id текущего упражнения.
        this._els.deleteBtn?.addEventListener('click', async () => {
            const {current, isNew} = this._store.getState();
            if (!current || isNew || !current.id) {
                Toast.show({title: 'Nothing to delete', message: 'Select a saved exercise first.', type: 'error'});
                return;
            }
            await this._onDelete(current.id);
        });

        // View mode toggle — flush form inputs to store before entering JSON view
        // so the JSON editor always reflects the latest in-form edits
        this._els.viewForm?.addEventListener('click', () => this._store.setViewMode('form'));
        this._els.viewJson?.addEventListener('click', () => {
            if (this._viewMode !== 'json') {
                try {
                    const entity = this.readFormToEntity();
                    this._store.patchCurrent(entity);
                } catch (e) {
                    console.warn('[ExerciseFormView] Could not flush form before JSON view:', e);
                }
            }
            this._store.setViewMode('json');
        });

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
                    id === 'fRulesBodyWeightEnabled' ? 'body' : '';
            // Auto-enable parent when required is ticked
            if (id === 'fRulesExtraWeightRequired' && this._els.fRulesExtraWeightEnabled)
                this._els.fRulesExtraWeightEnabled.checked = true;
            if (id === 'fRulesAssistanceRequired' && this._els.fRulesAssistanceEnabled)
                this._els.fRulesAssistanceEnabled.checked = true;
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
                if (!lang || lang === this._locale) return;
                // Flush текущей локали текст в стор ДО переключения. readFormToEntity
                // использует this._locale как ключ, поэтому строки попадут в правильный слот.
                const entity = this.readFormToEntity();
                this._store.patchCurrent(entity);
                // Не устанавливаем this._locale напрямую — setLocale (внутри selectLocale
                // или ниже) синхронно вызовет _onStateChange, который и обновит this._locale
                // и UI. Прямая установка здесь приводит к мерцанию active-класса.
                if (this._onLocaleChange) {
                    this._onLocaleChange(lang);
                } else {
                    this._store.setLocale(lang);
                }
            });
        });

        // Equipment
        this._els.equipAdd?.addEventListener('click', () => {
            const id = this._els.equipSingle?.value;
            if (!id) {
                Toast.show({title: 'Select equipment', type: 'error'});
                return;
            }
            if (!this._dicts.equipment.has(id)) {
                Toast.show({title: 'Unknown equipment', type: 'error'});
                return;
            }
            const formEntity = this.readFormToEntity();
            const refs = Array.isArray(formEntity?.[FIELD.equipmentRefs]) ? [...formEntity[FIELD.equipmentRefs]] : [];
            if (!refs.some(x => x.equipmentId === id)) refs.push({equipmentId: id});
            this._store.patchCurrent({...formEntity, [FIELD.equipmentRefs]: refs});
        });

        this._els.equipClear?.addEventListener('click', () => {
            const formEntity = this.readFormToEntity();
            this._store.patchCurrent({...formEntity, [FIELD.equipmentRefs]: []});
        });

        // Bundles
        this._els.bundleAdd?.addEventListener('click', () => this._addBundleFromInputs());
        this._els.percentInput?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                this._addBundleFromInputs();
            }
        });

        // JSON editor live validation + clear button
        this._els.editor?.addEventListener('input', () => this._validateJsonEditor());
        this._els.clearJsonBtn?.addEventListener('click', () => {
            if (this._els.editor) this._els.editor.value = '';
            this._validateJsonEditor();
        });

        // GPT prompt buttons
        this._els.promptBtn?.addEventListener('click', () => this._copyPrompt('review'));
        this._els.promptImgBtn?.addEventListener('click', () => this._copyPrompt('image'));
        this._els.promptRulesBtn?.addEventListener('click', () => this._copyPrompt('rules'));
    }

    // ── GPT prompts ──────────────────────────────────────────────────────────

    async _copyPrompt(type) {
        let text;
        if (type === 'image') text = this._buildImagePrompt();
        else if (type === 'rules') text = this._buildRulesPrompt();
        else text = this._buildReviewPrompt();

        try {
            await navigator.clipboard.writeText(text);
        } catch {
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
        }
        Toast.show({title: type === 'image' ? 'Image prompt copied' : type === 'rules' ? 'Rules prompt copied' : 'Prompt copied'});
    }

    _buildReviewPrompt() {
        const entity = this.readFormToEntity();
        const FIELD_BUNDLES = 'exerciseExampleBundles';
        const FIELD_EQUIP = 'equipmentRefs';
        const pretty = (o) => JSON.stringify(o, null, 2);
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
        lines.push(`    "${FIELD_BUNDLES}": [{ "muscleId": string, "percentage": number }],`);
        lines.push(`    "${FIELD_EQUIP}": [{ "equipmentId": string }]`);
        lines.push('  }');
        lines.push('- Do NOT include a field named "tutorials".');
        lines.push('- Do NOT change "id" if it is present.');
        lines.push(`- Sum of "${FIELD_BUNDLES}[].percentage" MUST be exactly 100 (integers only).`);
        lines.push(`- "${FIELD_EQUIP}" MUST use VALID equipment IDs from the dictionary below.`);
        lines.push('- If there are duplicates of the same muscle/equipment, merge them.');
        lines.push('- Improve QUALITY of muscle distribution using NAME and DESCRIPTION AND your general domain knowledge.');
        lines.push('- You MAY add/remove muscles if that leads to a more realistic split, but use only IDs from the provided dictionary.');
        lines.push('- You MAY refine "description" for clarity and utility; keep the same language.');
        lines.push('- Ensure equipment list is relevant to the exercise; only use IDs from the equipment dictionary.');
        lines.push('');
        lines.push(`Name: ${entity.name || '(empty)'}`);
        lines.push(`Description: ${entity.description || '(empty)'}`);
        lines.push('');
        lines.push('Muscles dictionary (name — id):');
        for (const [id, name] of this._dicts.muscles.entries()) lines.push(`- ${name} — ${id}`);
        lines.push('');
        lines.push('Equipment dictionary (name — id):');
        for (const [id, name] of this._dicts.equipment.entries()) lines.push(`- ${name} — ${id}`);
        lines.push('');
        lines.push('Current JSON:');
        lines.push(pretty(entity));
        lines.push('');
        lines.push('OUTPUT FORMAT (repeat for clarity):');
        lines.push('```json');
        lines.push('{ ...final JSON... }');
        lines.push('```');
        lines.push('Пояснение: ... (на русском, перечисли ключевые изменения).');
        lines.push('Return NOTHING else beyond these two parts.');
        return lines.join('\n');
    }

    _buildImagePrompt() {
        const entity = this.readFormToEntity();
        const FIELD_EQUIP = 'equipmentRefs';
        const eqArr = Array.isArray(entity[FIELD_EQUIP]) ? entity[FIELD_EQUIP] : [];
        const eqNames = eqArr
            .map((x) => (this._dicts.getEquipmentName(String(x?.equipmentId || '')) || '').trim())
            .filter(Boolean);
        const allowedEq = eqNames.length ? eqNames.join(', ') : 'без дополнительного оборудования';
        const lines = [];
        lines.push('Задача:');
        lines.push(`Сгенерируй превью упражнения "${entity.name || '(empty)'}".`);
        lines.push('');
        lines.push('Изображение (строгие требования):');
        lines.push('\t• ответ только картинка, без текста;');
        lines.push('\t• aspect_ratio: 1:1 строго;');
        lines.push('\t• size: 900×900, PNG, sRGB, без alpha;');
        lines.push('');
        lines.push('Color (hard, only these HEX):');
        lines.push('\t• Background radial: center #CBD0D8 → edges #2E333B (allowed solids: #EDEFF1, #262A31)');
        lines.push('\t• Metal: base #AEB6C2, shadows #8993A1 / #6B7684, highlight #D7DEE6');
        lines.push('\t• Rubber: base #2B3036, highlight #3A4048');
        lines.push('\t• Plastic: base #3A4048, highlight #4A515B');
        lines.push('\t• Skin/mannequin: base #ECE6E0, mid #D6CDC5, deep #BFB4A9, highlight #F7F3EF (матовые, без глянца)');
        lines.push('\t• Outfit: base #2E333B; one accent ≤12%: #3366FF (обычно) или #FFA726 (редко).');
        lines.push('\t• Контраст акцента к базе ≥ 4.5:1.');
        lines.push('\t• No pure #FFFFFF/#000000.');
        lines.push('');
        lines.push('Style (fixed): clay/3D, matte, без бликов/шума/текста/логотипов.');
        lines.push('Манекен: андрогинный, без лица/волос/пор/вен.');
        lines.push('Пропорции: реалистичные — корректные плечи, торс, руки и ноги без деформаций.');
        lines.push('Окружение: минималистичная студия, нейтральный фон, без текста/логотипов/UI.');
        lines.push('');
        lines.push('Camera & Framing (hard):');
        lines.push('\t• View: 3/4 isometric, tilt from above ≈ 12°; eq. focal ≈ 40 mm; camera height ≈ chest level.');
        lines.push('\t• Subject centered; mannequin + equipment occupy 70–80% of frame height.');
        lines.push('\t• Safe-margin: ≥ 7% от кадра по всем сторонам.');
        lines.push('\t• Hard rule: Entire silhouette and equipment must fit inside safe-margin.');
        lines.push('\t• Ground plane visible; soft contact shadow under feet and rack/bench.');
        lines.push('');
        lines.push('Lighting (soft-matte): Key:Fill:Rim ≈ 1 : 0.5 : 0.2, key 35–45° сверху-сбоку.');
        lines.push('');
        lines.push(`Allowed equipment only: ${eqNames.length ? eqNames.join(', ') : '— без дополнительного оборудования'}. Никакого другого инвентаря.`);
        lines.push('');
        lines.push('Данные упражнения:');
        lines.push(`• Оборудование: ${allowedEq}`);
        lines.push(`• Описание: ${entity.description || '(пусто)'}`);
        return lines.join('\n');
    }

    _buildRulesPrompt() {
        const entity = this.readFormToEntity();
        const FIELD_EQUIP = 'equipmentRefs';
        const pretty = (o) => JSON.stringify(o, null, 2);
        const eqArr = Array.isArray(entity[FIELD_EQUIP]) ? entity[FIELD_EQUIP] : [];
        const resolvedEquip = eqArr
            .map((ref) => {
                const id = ref?.equipmentId ?? ref?.id ?? null;
                if (!id) return null;
                const name = this._dicts.getEquipmentName(id) ?? null;
                return name ? `${name} — ${id}` : String(id);
            })
            .filter(Boolean);

        const lines = [];
        lines.push('You are a strength training domain expert AND a strict JSON validator.');
        lines.push('');
        lines.push('GOAL: Keep entire input JSON unchanged EXCEPT the field `components`. Replace `components` with the best possible values based on: name, description, weightType, category, forceType, and equipmentRefs.');
        lines.push('');
        lines.push('OUTPUT FORMAT (MANDATORY): Return EXACTLY one markdown code block with JSON inside, and NOTHING else.');
        lines.push('- First chars: ```json');
        lines.push('- Last chars: ```');
        lines.push('- No text before or after the code block.');
        lines.push('');
        lines.push('HARD REQUIREMENTS:');
        lines.push('1) Output a SINGLE valid JSON object inside the code block.');
        lines.push('2) You may ONLY change `components`. Every other field must remain identical.');
        lines.push('3) `components` is a TOP-LEVEL field. Do NOT nest it inside `rules`.');
        lines.push('');
        lines.push('COMPONENTS SCHEMA (STRICT):');
        lines.push('"components": {');
        lines.push('  "externalWeight": { "required": boolean } | null,');
        lines.push('  "bodyWeight": { "required": boolean, "multiplier": number } | null,');
        lines.push('  "extraWeight": { "required": boolean } | null,');
        lines.push('  "assistWeight": { "required": boolean } | null');
        lines.push('}');
        lines.push('');
        lines.push('INVARIANTS (MUST ALWAYS HOLD):');
        lines.push('- externalWeight and bodyWeight are mutually exclusive (never both non-null).');
        lines.push('- If bodyWeight is non-null, it MUST include multiplier in range 0.05..2.0.');
        lines.push('- extraWeight and assistWeight are ONLY allowed when bodyWeight exists.');
        lines.push('- If externalWeight exists, extraWeight and assistWeight MUST be null.');
        lines.push('- bodyWeight.required MUST be true; externalWeight.required MUST be true.');
        lines.push('');
        if (resolvedEquip.length > 0) {
            lines.push('EQUIPMENT REFS (RESOLVED FOR THIS EXERCISE):');
            resolvedEquip.forEach((s) => lines.push(`- ${s}`));
            lines.push('');
        }
        lines.push('INPUT JSON (copy this and only edit `components`):');
        lines.push(pretty(entity));
        return lines.join('\n');
    }
}

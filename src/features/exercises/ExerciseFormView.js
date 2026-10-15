import {DEFAULT_LANGUAGE, FIELD, SUPPORTED_LANGUAGES} from '../../shared/constants/index.js';
import {ExerciseNormalizer, ExerciseTranslations} from '../../domain/exercise/index.js';
import {Toast} from '../../shared/components/Toast.js';
import {buildReviewPrompt, buildImagePrompt, buildRulesPrompt} from './exercisePrompts.js';
import {draftSignature, exerciseName} from './exercisePresentation.js';
import {readBundleRows, updateBundleSummary} from './exerciseBundleFields.js';
import {escapeHtml, sanitizeUrl} from '../../shared/utils/index.js';
import {ExerciseDiagnosticsView} from './ExerciseDiagnosticsView.js';

const DETAIL_SKELETON = `<span class="sr-only">Loading exercise details and translations…</span>
    <div class="exercise-detail-skeleton" aria-hidden="true">
        <div class="exercise-skeleton-card exercise-skeleton-basics"><span class="skeleton exercise-skeleton-preview"></span><div class="skeleton-stack"><span class="skeleton skeleton-line skeleton-line--short"></span><span class="skeleton exercise-skeleton-field"></span><span class="skeleton skeleton-line skeleton-line--medium"></span><span class="skeleton exercise-skeleton-description"></span></div></div>
        <div class="exercise-skeleton-columns">${Array.from({length: 2}, () => '<div class="exercise-skeleton-card skeleton-stack"><span class="skeleton skeleton-line skeleton-line--medium"></span><span class="skeleton exercise-skeleton-field"></span><span class="skeleton exercise-skeleton-field"></span><span class="skeleton exercise-skeleton-field"></span></div>').join('')}</div>
    </div>`;

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
        this._diagnostics = new ExerciseDiagnosticsView({store, panel: els.diagnosticPanel});
        this._onSave = onSave;
        this._onDelete = onDelete;
        this._onLocaleChange = onLocaleChange;

        this._locale = store.getState().locale || DEFAULT_LANGUAGE;
        this._viewMode = store.getState().viewMode || 'form';
        this._bodyWeightMultiplier = 1;
        this._baselineId = null;
        this._baseline = '';
        this._jsonCreatedIdentity = null;
        this._issues = [];

        // Кеш для дедупликации перерисовок формы. _onStateChange срабатывает
        // на ЛЮБОЕ изменение стора (search, sort, loading, saving) — нельзя
        // дёргать writeEntityToForm каждый раз, иначе затрутся правки юзера в полях.
        this._lastRendered = {current: null, locale: null, isNew: null};

        this._bindEvents();
        this._unsubscribe = store.subscribe((state) => this._onStateChange(state));

        // Apply initial view mode so UI matches store state from the start
        this._onStateChange(store.getState());
    }

    /** Снять подписки на стор. Для тестов / HMR. */
    destroy() {
        this._unsubscribe?.();
        this._unsubscribe = null;
    }

    hasUnsavedChanges() {
        if (!this._store.getState().current) return false;
        try { return this._signature(this.readFormToEntity()) !== this._baseline; }
        catch { return true; }
    }

    flush() {
        if (!this._store.getState().current) return true;
        try {
            const entity = this.readFormToEntity();
            const preserve = this._preserveFormInputs;
            this._preserveFormInputs = this._viewMode === 'form';
            try { this._store.patchCurrent(entity); } finally { this._preserveFormInputs = preserve; }
            return true;
        } catch (error) {
            this._showEditorError(error);
            return false;
        }
    }

    markSaved(entity) {
        this._baselineId = entity?.id || null;
        this._baseline = entity ? this._signature(entity) : '';
        this._showValidation([]);
        this._updateDraftState();
    }

    acknowledgeCreatedIdentity(fromId, toId) {
        this._createdIdentity = {fromId, toId};
    }

    preserveDraftAfterSave(saved, {translationSnapshot = null} = {}) {
        const {current, isNew} = this._store.getState();
        let draft = current;
        let invalidJson = null;
        let invalidIdentity = null;
        try { draft = this.readFormToEntity(); }
        catch {
            invalidJson = this._els.editor?.value ?? '';
            if (isNew && current.id !== saved.id) invalidIdentity = {fromId: current.id, toId: saved.id};
            else if (this._jsonCreatedIdentity?.toId === current.id && saved.id === current.id) invalidIdentity = this._jsonCreatedIdentity;
        }
        this._store.setCurrent({...draft, id: saved.id}, {translationProvenanceKnown: true, translationSnapshot});
        if (invalidJson !== null && this._els.editor) {
            this._els.editor.value = invalidJson;
            // setCurrent synchronously writes canonical JSON; restore this exact acknowledgement afterwards.
            this._jsonCreatedIdentity = invalidIdentity;
            this._validateJsonEditor();
        }
    }

    _signature(entity) {
        const nameTranslations = ExerciseNormalizer.ensureTranslationMap(entity.nameTranslations);
        const descriptionTranslations = ExerciseNormalizer.ensureTranslationMap(entity.descriptionTranslations);
        const normalizeText = value => value.replace(/\r\n?/g, '\n').trim();
        for (const lang of Object.keys(nameTranslations)) nameTranslations[lang] = normalizeText(nameTranslations[lang]);
        for (const lang of Object.keys(descriptionTranslations)) descriptionTranslations[lang] = normalizeText(descriptionTranslations[lang]);
        return draftSignature(ExerciseNormalizer.buildPersistencePayload({...entity, nameTranslations, descriptionTranslations,
            weightType: entity.weightType ?? '', category: entity.category ?? '', experience: entity.experience ?? '', forceType: entity.forceType ?? '',
            imageUrl: typeof entity.imageUrl === 'string' ? entity.imageUrl.trim() : ''}));
    }

    _updateDraftState() {
        const {current, isNew, isSaving, isDetailLoading, createIdentityMissing} = this._store.getState();
        if (this._els.editorStatus) {
            const dirty = this.hasUnsavedChanges();
            this._els.editorStatus.textContent = isDetailLoading || !current ? '' : createIdentityMissing ? 'Created · refresh the library to locate it' : isSaving ? 'Saving…' : dirty ? 'Unsaved changes' : isNew ? 'New exercise' : 'All changes saved';
            this._els.editorStatus.classList.toggle('is-dirty', dirty);
        }
    }

    _updateDictionaryStatus() {
        const {current, isSaving, isDetailLoading, createIdentityMissing} = this._store.getState();
        const notReady = this._dicts.isReady === false;
        const errors = this._dicts.errors || [];
        if (this._els.dictionaryStatus) {
            this._els.dictionaryStatus.hidden = !errors.length && (!current || (!this._dicts.loading && !notReady));
            const message = this._els.dictionaryStatus.querySelector('span');
            if (message) message.textContent = this._dicts.loading ? 'Loading muscle and equipment dictionaries…'
                : errors.length ? `Dictionaries could not load. ${errors.join(' ')}${this._dicts.isReady ? ' Last loaded options are still available.' : ' Retry before saving.'}`
                    : 'Muscle and equipment dictionaries are not ready. Retry loading them before saving.';
        }
        if (this._els.saveBtn) this._els.saveBtn.disabled = !current || !!isSaving || !!isDetailLoading || notReady || !!createIdentityMissing;
    }

    _showEditorError(error) {
        this._showValidation([{field: 'editor', message: error.message}]);
        this._els.editor?.focus();
        Toast.show({title: 'Check the JSON editor', message: error.message, type: 'error'});
    }

    _showValidation(issues) {
        this._issues = issues;
        const fields = {nameTranslations: this._els.fName, descriptionTranslations: this._els.fDescription,
            imageUrl: this._els.fImage, weightType: this._els.fWeightType, category: this._els.fCategory,
            experience: this._els.fExperience, forceType: this._els.fForceType,
            equipmentRefs: this._els.equipSingle, bundles: this._els.muscleSelect,
            components: this._els.fRulesExternalWeightEnabled, editor: this._els.editor};
        for (const [field, element] of Object.entries(fields)) {
            element?.setAttribute('aria-invalid', String(issues.some(issue => issue.field === field)));
        }
        const summary = this._els.validationSummary;
        if (!summary) return;
        summary.replaceChildren();
        summary.hidden = !issues.length;
        if (!issues.length) return;
        const title = document.createElement('strong');
        title.textContent = `Before saving, fix ${issues.length} ${issues.length === 1 ? 'issue' : 'issues'}:`;
        summary.appendChild(title);
        const list = document.createElement('ul');
        for (const issue of issues) {
            const item = document.createElement('li');
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = issue.message;
            button.addEventListener('click', () => {
                if (this._viewMode === 'json') { this._els.editor?.focus(); return; }
                if (issue.field === 'nameTranslations' || issue.field === 'descriptionTranslations') {
                    if (!this.flush()) return;
                    this._store.setLocale(DEFAULT_LANGUAGE);
                }
                for (let disclosure = fields[issue.field]?.closest?.('details'); disclosure; disclosure = disclosure.parentElement?.closest?.('details')) disclosure.open = true;
                fields[issue.field]?.focus();
                fields[issue.field]?.scrollIntoView?.({block: 'center', behavior: 'smooth'});
            });
            item.appendChild(button);
            list.appendChild(item);
        }
        summary.appendChild(list);
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Populate the equipment and muscle <select> dropdowns from the dictionary store.
     * Call this once after dictionaries have been loaded so the options are ready
     * before the user opens any exercise (not deferred until first selectItem).
     *
     * Refresh labels in place so dictionary retries preserve live inputs and focus.
     */
    refreshOptionLists() {
        this._refreshOptionLists();
        this._refreshDictionaryLabels();
        this._updateConfigurationSummary();
        this._updateDictionaryStatus();
        this._diagnostics.render();
    }

    /**
     * Populate all form inputs from a canonical entity + active locale.
     *
     * @param {object} entity  — canonical exercise shape
     * @param {string} locale  — active locale ('en' | 'ua' | 'ru')
     */
    writeEntityToForm(entity, locale) {
        if (!entity) return;
        this._writeLocalizedText(entity, locale);
        if (this._els.fId) this._els.fId.value = entity?.id || '';
        if (this._els.fImage) this._els.fImage.value = entity?.imageUrl || '';
        this._renderImagePreview(entity?.imageUrl || '');

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

    _writeLocalizedText(entity, locale) {
        const loc = locale || this._locale;
        const language = {en: 'English', ua: 'Ukrainian', ru: 'Russian'}[loc] || 'English';
        const required = loc === DEFAULT_LANGUAGE;
        for (const [label, input, field] of [[this._els.nameLabel, this._els.fName, 'name'], [this._els.descriptionLabel, this._els.fDescription, 'description']]) {
            if (label) label.textContent = `${language} ${field}${required ? ' *' : ' (optional)'}`;
            if (input) { input.required = required; input.setAttribute('aria-required', String(required)); }
        }
        if (this._els.localeHint) this._els.localeHint.textContent = 'Only name and description change by language. Save includes all languages.';
        const nameTrans = ExerciseNormalizer.ensureTranslationMap(entity?.nameTranslations);
        const descTrans = ExerciseNormalizer.ensureTranslationMap(entity?.descriptionTranslations);
        const localeName = ExerciseNormalizer.getTranslation(nameTrans, loc);
        const localeDesc = ExerciseNormalizer.getTranslation(descTrans, loc);
        const defaultName = ExerciseNormalizer.getTranslation(nameTrans, DEFAULT_LANGUAGE) || entity?.name || '';
        const defaultDesc = ExerciseNormalizer.getTranslation(descTrans, DEFAULT_LANGUAGE) || entity?.description || '';

        if (this._els.fName) {
            this._els.fName.value = localeName;
            this._els.fName.placeholder = ExerciseNormalizer.buildLocalePlaceholder('Exercise name', defaultName, loc);
        }

        if (this._els.fDescription) {
            this._els.fDescription.value = localeDesc;
            this._els.fDescription.placeholder = ExerciseNormalizer.buildLocalePlaceholder('Short description', defaultDesc, loc);
        }

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
            let parsed;
            try { parsed = JSON.parse(this._els.editor.value); }
            catch { throw new Error('Fix invalid JSON before saving or switching to Form.'); }
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON must contain one exercise object.');
            for (const field of ['nameTranslations', 'descriptionTranslations']) {
                if (!(field in parsed)) continue;
                const map = parsed[field];
                if (!map || typeof map !== 'object' || Array.isArray(map)) throw new Error(`${field} must be an object with language keys and text values.`);
                for (const language of SUPPORTED_LANGUAGES) {
                    if (Object.hasOwn(map, language) && typeof map[language] !== 'string') throw new Error(`${field}.${language} must be text. Replace its value with a quoted string.`);
                }
            }
            const current = this._store.getState().current;
            if (current && parsed.id !== current.id) {
                const identity = this._jsonCreatedIdentity;
                if (identity?.fromId !== parsed.id || identity?.toId !== current.id) throw new Error('The exercise ID cannot be changed. Restore the original ID.');
                parsed.id = current.id;
            } else this._jsonCreatedIdentity = null;
            const normalized = ExerciseNormalizer.normalizeEntityShape(parsed);
            return {...parsed, name: normalized.name, description: normalized.description,
                nameTranslations: normalized.nameTranslations, descriptionTranslations: normalized.descriptionTranslations};
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
                ? {required: true, multiplier: this._bodyWeightMultiplier}
                : null,
            extraWeight: bodyEnabled && extraEnabled
                ? {required: !!this._els.fRulesExtraWeightRequired?.checked}
                : null,
            assistWeight: bodyEnabled && assistEnabled
                ? {required: !!this._els.fRulesAssistanceRequired?.checked}
                : null,
        };
        e[FIELD.bundles] = readBundleRows(this._els.bundles, e[FIELD.bundles]);

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
        this._updateConfigurationSummary();
    }

    // ── Private: state ────────────────────────────────────────────────────────

    _onStateChange({current, isNew, locale, viewMode, isSaving, isDetailLoading, detailError}) {
        const created = this._createdIdentity;
        this._createdIdentity = null;
        const sameCreatedDraft = created && created.fromId === this._lastRendered.current?.id && created.toId === current?.id;
        const selectionChanged = current?.id !== this._lastRendered.current?.id && !sameCreatedDraft;
        if (selectionChanged) {
            this._jsonCreatedIdentity = null;
            for (const section of [this._els.inputsSection, this._els.equipmentSection]) if (section) section.open = false;
            this._els.builder?.querySelectorAll('.exercise-reference-fields').forEach(disclosure => { disclosure.open = false; });
        }
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

            if (shouldRerender && this._preserveFormInputs) {
                this._lastRendered = {current, locale: this._locale, isNew};
                this._updateLocaleUI();
            } else if (shouldRerender) {
                if (localeChanged && !currentChanged && !isNewChanged) this._writeLocalizedText(current, this._locale);
                else {
                    this._refreshOptionLists();
                    this.writeEntityToForm(current, this._locale);
                }
                this._updateLocaleUI();
                this._updateCurrentId(current, isNew);
                if (this._viewMode === 'json') this._populateJsonEditor(current);
                this._lastRendered = {current, locale: this._locale, isNew};
                if (current.id !== this._baselineId) {
                    this.markSaved(current);
                    this._showValidation([]);
                }
            } else if (!current && this._lastRendered.current) {
                this.writeEntityToForm({id: '', components: {}, [FIELD.bundles]: [], [FIELD.equipmentRefs]: []}, this._locale);
                if (this._els.editor) this._els.editor.value = '';
                if (this._els.jsonStatus) this._els.jsonStatus.textContent = 'No exercise selected';
                this._updateCurrentId(null, isNew);
                this._lastRendered = {current: null, locale: this._locale, isNew};
                this.markSaved(null);
                this._showValidation([]);
            }
        } catch (e) {
            console.error('[ExerciseFormView] _onStateChange error:', e);
        }
        // Save доступен всегда (кроме момента активного сохранения), а отсутствие
        // выбранного упражнения отлавливаем тостом в click-handler.
        if (this._els.saveBtn) {
            this._els.saveBtn.disabled = !current || !!isSaving || !!isDetailLoading;
            this._els.saveBtn.textContent = isSaving ? 'Saving…' : 'Save';
        }
        // Delete доступен только для уже сохранённого упражнения с реальным ID.
        // Для нового (несохранённого) и при отсутствии current — кнопку прячем,
        // иначе нечего удалять. На время сохранения тоже блокируем.
        if (this._els.deleteBtn) {
            const canDelete = !!current && !isNew && !!current.id;
            this._els.deleteBtn.hidden = !canDelete;
            this._els.deleteBtn.disabled = !canDelete || !!isSaving || !!isDetailLoading;
        }
        if (this._els.emptyState) this._els.emptyState.hidden = !!current || !!isDetailLoading;
        this._renderDetailLoading(isDetailLoading, detailError, current);
        if (isDetailLoading && this._els.currentId) this._els.currentId.textContent = '—';
        else this._updateCurrentId(current, isNew);
        for (const button of [this._els.promptBtn, this._els.promptImgBtn, this._els.promptRulesBtn, ...Array.from(this._els.localeButtons || [])]) {
            if (button) button.disabled = !current || !!isDetailLoading;
        }
        this._els.builder?.querySelectorAll('input, select, textarea, button').forEach(input => {
            if (input !== this._els.fId) input.disabled = !current || !!isDetailLoading;
        });
        if (current && !isDetailLoading) this.updateRulesInputsVisibility();
        if (this._els.previewFrame) this._els.previewFrame.disabled = !current || !!isDetailLoading || !this._els.previewCard?.classList.contains('has-image');
        if (this._els.editor) this._els.editor.disabled = !current || !!isDetailLoading;
        this._updateDraftState();
        this._updateDictionaryStatus();
        this._diagnostics.render();
        this._renderTranslationNotice(current, isNew);
        this._updateConfigurationSummary();
        this._applyViewMode(viewMode);
    }

    _renderTranslationNotice(current, isNew) {
        const container = this._els.translationNotice;
        if (!container) return;
        const {translationProvenanceKnown: known, translationSnapshot} = this._store.getState();
        const explanation = known ? ExerciseTranslations.legacyNotice(translationSnapshot)
            : 'Translation coverage is unknown: the API may return English fallback for UA/RU. Saving replaces text in all three languages; review each language before saving.';
        container.hidden = !current || isNew || !explanation;
        if (container.hidden) {
            if (this._translationNotice) container.innerHTML = '';
            this._translationNotice = null;
            return;
        }
        if (this._translationNotice?.id === current.id && this._translationNotice.explanation === explanation) return;
        const open = this._translationNotice?.id === current.id && container.querySelector('details')?.open;
        const summary = known ? 'Legacy translation text · Saving will normalize it' : 'Translation coverage unknown · Review before saving';
        container.innerHTML = `<details${open ? ' open' : ''}><summary>${escapeHtml(summary)}</summary><p>${escapeHtml(explanation)}</p></details>`;
        this._translationNotice = {id: current.id, explanation};
    }

    _renderDetailLoading(loading, error, current) {
        const panel = this._els.builder?.closest?.('.exercise-panel');
        panel?.classList.toggle('is-detail-loading', !!loading);
        panel?.setAttribute('aria-busy', String(!!loading));
        const placeholder = this._els.detailLoading;
        if (!placeholder) return;
        placeholder.hidden = !loading && !error;
        placeholder.classList.toggle('error', !loading && !!error);
        if (loading) {
            if (this._detailPlaceholder !== 'loading') placeholder.innerHTML = DETAIL_SKELETON;
            this._detailPlaceholder = 'loading';
        } else {
            const message = error ? `Could not open exercise: ${error}. ${current ? 'Your previous exercise is still open. ' : ''}Select it again to retry.` : '';
            if (this._detailPlaceholder !== message) placeholder.innerHTML = message
                ? `<span>${escapeHtml(message)}</span><button type="button" class="btn muted" data-exercise-action="dismiss-detail-error">Dismiss</button>` : '';
            this._detailPlaceholder = message;
        }
    }

    _applyViewMode(mode) {
        const safeMode = mode || 'form';
        const wasJson = this._viewMode === 'json';
        const isJson = safeMode === 'json';
        const hasCurrent = !!this._store.getState().current;
        this._viewMode = safeMode;

        // Use CSS class toggling — avoids conflict between hidden attribute and .show class
        if (this._els.builder) {
            this._els.builder.classList.toggle('show', !isJson && hasCurrent);
            this._els.builder.hidden = isJson || !hasCurrent;
        }
        if (this._els.editorWrap) {
            this._els.editorWrap.classList.toggle('show', isJson && hasCurrent);
            this._els.editorWrap.hidden = !isJson || !hasCurrent;
        }

        // Update segment button active states
        if (this._els.viewForm) this._els.viewForm.classList.toggle('active', !isJson);
        if (this._els.viewJson) this._els.viewJson.classList.toggle('active', isJson);
        if (this._els.viewForm) this._els.viewForm.setAttribute('aria-selected', String(!isJson));
        if (this._els.viewJson) this._els.viewJson.setAttribute('aria-selected', String(isJson));
        if (this._els.viewForm) this._els.viewForm.tabIndex = isJson ? -1 : 0;
        if (this._els.viewJson) this._els.viewJson.tabIndex = isJson ? 0 : -1;

        // jsonStatus is only meaningful in JSON mode
        if (this._els.jsonStatus) this._els.jsonStatus.hidden = !isJson || !hasCurrent;

        // Populate editor when switching TO json
        if (isJson && !wasJson) {
            const {current} = this._store.getState();
            if (current) this._populateJsonEditor(current);
        }
    }

    _populateJsonEditor(entity) {
        if (!this._els.editor) return;
        this._els.editor.value = JSON.stringify(entity, null, 2);
        this._jsonCreatedIdentity = null;
        this._validateJsonEditor();
    }

    _validateJsonEditor() {
        if (!this._els.jsonStatus) return;
        const text = this._els.editor?.value || '';
        try {
            const parsed = JSON.parse(text);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected object');
            this._els.jsonStatus.textContent = 'Valid JSON';
            this._els.jsonStatus.className = 'status ok';
        } catch {
            this._els.jsonStatus.textContent = 'Enter a valid JSON object';
            this._els.jsonStatus.className = 'status warn';
        }
    }

    _updateCurrentId(entity, isNew) {
        if (!this._els.currentId) return;
        const name = ExerciseNormalizer.getTranslation(entity?.nameTranslations, this._locale) || exerciseName(entity);
        const title = entity ? name || (isNew ? 'New exercise' : 'Untitled exercise') : 'No exercise selected';
        this._els.currentId.textContent = title;
        this._els.currentId.title = title;
    }

    // ── Private: UI helpers ───────────────────────────────────────────────────

    _syncBodyWeightMultiplierLabel() {
        const value = this._bodyWeightMultiplier;
        if (this._els.fRulesBodyWeightMultiplierValue) this._els.fRulesBodyWeightMultiplierValue.textContent = Number.isFinite(value) ? `${value.toFixed(2)}×` : '—';
        this._updateConfigurationSummary();
    }

    _updateConfigurationSummary() {
        const parts = [];
        const requirement = input => input?.checked ? 'required' : 'optional';
        if (this._els.fRulesExternalWeightEnabled?.checked) parts.push(`Weight ${requirement(this._els.fRulesExternalWeightRequired)}`);
        if (this._els.fRulesBodyWeightEnabled?.checked) {
            parts.push(`Body weight ${Number.isFinite(this._bodyWeightMultiplier) ? this._bodyWeightMultiplier.toFixed(2) : '—'}×`);
            if (this._els.fRulesExtraWeightEnabled?.checked) parts.push(`Extra ${requirement(this._els.fRulesExtraWeightRequired)}`);
            if (this._els.fRulesAssistanceEnabled?.checked) parts.push(`Assistance ${requirement(this._els.fRulesAssistanceRequired)}`);
        }
        if (this._els.inputsSummary) this._els.inputsSummary.textContent = parts.join(' · ') || 'No weight inputs';
        const refs = this._store.getState().current?.[FIELD.equipmentRefs];
        const names = (Array.isArray(refs) ? refs : []).map(ref => {
            const id = String(ref?.equipmentId || '');
            return this._dicts.getEquipmentName(id) || 'Unknown equipment';
        });
        if (this._els.equipmentSummary) {
            this._els.equipmentSummary.textContent = names.length ? names.slice(0, 2).join(', ') + (names.length > 2 ? ` +${names.length - 2}` : '') : 'None selected';
            this._els.equipmentSummary.title = names.join(', ');
        }
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
            this._els.previewFrame.disabled = !hasImage;
        }
    }

    _updateLocaleUI() {
        if (!this._els.localeButtons) return;
        Array.from(this._els.localeButtons).forEach(btn => {
            btn.classList.toggle('active', btn.dataset.locale === this._locale);
            btn.setAttribute('aria-pressed', String(btn.dataset.locale === this._locale));
            const current = this._store.getState().current;
            const name = ExerciseNormalizer.getTranslation(current?.nameTranslations, btn.dataset.locale);
            const description = ExerciseNormalizer.getTranslation(current?.descriptionTranslations, btn.dataset.locale);
            const {translationProvenanceKnown: known, translationSnapshot} = this._store.getState();
            const stored = translationSnapshot?.translations.find(row => row.language === btn.dataset.locale);
            const complete = translationSnapshot ? !!stored?.name && !!stored?.description : !!name && !!description;
            btn.classList.toggle('has-translation', !!known && complete);
            btn.classList.toggle('translation-unverified', !known && !!name && !!description);
            const coverage = translationSnapshot ? complete ? 'stored name and description' : stored ? 'partially stored translation; empty fields are missing' : 'no stored translation row'
                : name && description ? 'name and description entered' : 'translation incomplete';
            btn.title = `${btn.dataset.locale.toUpperCase()}: ${!known ? 'localized text loaded; English fallback may be in use. Translation coverage is unknown.' : coverage}`;
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
            token.dataset.equipmentId = id;
            if (!this._dicts.equipment.has(id)) token.classList.add('invalid');
            const nameEl = document.createElement('span');
            nameEl.dataset.equipmentLabel = '';
            nameEl.textContent = name;
            token.appendChild(nameEl);

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.textContent = '×';
            removeBtn.title = 'Remove';
            removeBtn.setAttribute('aria-label', `Remove ${name || 'equipment'}`);
            removeBtn.addEventListener('click', () => {
                const focusIndex = document.activeElement === removeBtn
                    ? Array.from(this._els.equipTokens.querySelectorAll('[data-equipment-id]')).indexOf(token) : -1;
                const formEntity = this.readFormToEntity();
                const arr = [...(formEntity?.[FIELD.equipmentRefs] || [])];
                arr.splice(index, 1);
                this._store.patchCurrent({...formEntity, [FIELD.equipmentRefs]: arr});
                if (focusIndex >= 0) {
                    const tokens = this._els.equipTokens.querySelectorAll('[data-equipment-id]');
                    (tokens[Math.min(focusIndex, tokens.length - 1)]?.querySelector('button') || this._els.equipSingle)?.focus({preventScroll: true});
                }
            });

            token.appendChild(removeBtn);
            frag.appendChild(token);
        });

        this._els.equipTokens.appendChild(frag);
    }

    _refreshDictionaryLabels() {
        for (const token of this._els.equipTokens?.querySelectorAll('[data-equipment-id]') || []) {
            const id = token.dataset.equipmentId;
            const name = this._dicts.getEquipmentName(id) || id;
            const label = token.querySelector('[data-equipment-label]');
            if (label) label.textContent = name;
            token.classList.toggle('invalid', !this._dicts.equipment.has(id));
            token.querySelector('button')?.setAttribute('aria-label', `Remove ${name || 'equipment'}`);
        }
        for (const row of this._els.bundles?.querySelectorAll('[data-bundle-index]') || []) {
            const select = row.querySelector('[data-bundle-muscle]');
            if (!select) continue;
            const id = select.value;
            this._fillMuscleOptions(select, id);
            const name = this._dicts.getMuscleName(id) || id;
            const percentage = row.querySelector('[data-bundle-percentage]');
            percentage?.setAttribute('aria-label', `Contribution for ${name}, percent`);
            row.querySelector('button')?.setAttribute('aria-label', `Remove ${name || 'muscle contribution'}`);
            row.querySelector('progress')?.setAttribute('aria-label', `${name || 'Muscle'} contribution: ${percentage?.value || '0'}%`);
        }
    }

    _fillMuscleOptions(select, id) {
        const options = [];
        if (!this._dicts.muscles.has(id)) {
            const unknown = document.createElement('option');
            unknown.value = id;
            unknown.textContent = `Unknown muscle: ${id || '(missing ID)'}`;
            options.push(unknown);
        }
        for (const [value, name] of this._dicts.muscles) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = name;
            option.title = value;
            options.push(option);
        }
        select.replaceChildren(...options);
        select.value = id;
        select.classList.toggle('invalid', !this._dicts.muscles.has(id));
    }

    _refreshOptionLists() {
        for (const [select, entries, label] of [[this._els.equipSingle, this._dicts.equipment, 'equipment'], [this._els.muscleSelect, this._dicts.muscles, 'muscle']]) {
            if (!select) continue;
            const selected = select.value;
            select.innerHTML = '';
            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = entries.size ? `Choose ${label}…` : `${label === 'muscle' ? 'Muscle' : 'Equipment'} dictionary unavailable`;
            select.appendChild(placeholder);
            for (const [id, name] of [...entries].sort((a, b) => a[1].localeCompare(b[1]))) {
                const opt = document.createElement('option');
                opt.value = id;
                opt.textContent = name;
                opt.title = id;
                select.appendChild(opt);
            }
            if (entries.has(selected)) select.value = selected;
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
            row.dataset.bundleIndex = String(index);

            // Muscle select
            const muscleEl = document.createElement('select');
            muscleEl.dataset.bundleMuscle = '';
            muscleEl.setAttribute('aria-label', `Muscle ${index + 1}`);
            const currentMuscleId = String(bundle?.muscleId || '');
            this._fillMuscleOptions(muscleEl, currentMuscleId);

            // Percentage input
            const percentEl = document.createElement('input');
            percentEl.dataset.bundlePercentage = '';
            percentEl.type = 'number';
            percentEl.min = '0';
            percentEl.max = '100';
            percentEl.step = '1';
            percentEl.placeholder = '%';
            percentEl.setAttribute('aria-label', `Contribution for ${this._dicts.getMuscleName(currentMuscleId) || currentMuscleId}, percent`);
            const pVal = Number(bundle?.percentage ?? 0);
            percentEl.value = String(pVal);
            if (!isFinite(pVal) || pVal < 0 || pVal > 100) percentEl.classList.add('invalid');
            sum += isFinite(pVal) ? pVal : 0;

            // Remove button
            const removeBtn = document.createElement('button');
            removeBtn.className = 'btn muted';
            removeBtn.type = 'button';
            removeBtn.textContent = 'Remove';
            removeBtn.setAttribute('aria-label', `Remove ${this._dicts.getMuscleName(currentMuscleId) || 'muscle contribution'}`);

            muscleEl.addEventListener('change', () => {
                const formEntity = this.readFormToEntity();
                const bundles = [...(formEntity?.[FIELD.bundles] || [])];
                if (bundles.some((bundle, otherIndex) => otherIndex !== index && bundle?.muscleId === muscleEl.value)) {
                    muscleEl.value = currentMuscleId;
                    Toast.show({title: 'Muscle already added', message: 'Adjust its existing contribution instead.', type: 'warning'});
                    return;
                }
                bundles[index] = {...bundles[index], muscleId: muscleEl.value};
                this._store.patchCurrent({...formEntity, [FIELD.bundles]: bundles});
            });
            percentEl.addEventListener('input', () => {
                const formEntity = this.readFormToEntity();
                this._preserveFormInputs = true;
                try { this._store.patchCurrent(formEntity); } finally { this._preserveFormInputs = false; }
                const percentage = formEntity[FIELD.bundles][index]?.percentage;
                progress.value = Number.isFinite(percentage) ? Math.max(0, Math.min(100, percentage)) : 0;
                percentEl.classList.toggle('invalid', !Number.isFinite(percentage) || percentage < 0 || percentage > 100);
                progress.setAttribute('aria-label', `${this._dicts.getMuscleName(muscleEl.value) || 'Muscle'} contribution: ${percentage}%`);
                updateBundleSummary(this._els.bundleSumInfo, formEntity[FIELD.bundles].reduce((total, bundle) => total + (Number.isFinite(bundle?.percentage) ? bundle.percentage : 0), 0));
            });
            removeBtn.addEventListener('click', () => {
                const focusIndex = document.activeElement === removeBtn
                    ? Array.from(this._els.bundles.querySelectorAll('[data-bundle-index]')).indexOf(row) : -1;
                const formEntity = this.readFormToEntity();
                const bundles = [...(formEntity?.[FIELD.bundles] || [])];
                bundles.splice(index, 1);
                this._store.patchCurrent({...formEntity, [FIELD.bundles]: bundles});
                if (focusIndex >= 0) {
                    const rows = this._els.bundles.querySelectorAll('[data-bundle-index]');
                    (rows[Math.min(focusIndex, rows.length - 1)]?.querySelector('[data-bundle-muscle]') || this._els.muscleSelect)?.focus({preventScroll: true});
                }
            });

            row.appendChild(muscleEl);
            row.appendChild(percentEl);
            row.appendChild(removeBtn);
            const progress = document.createElement('progress');
            progress.className = 'bundle-progress';
            progress.max = 100;
            progress.value = Math.max(0, Math.min(100, Number.isFinite(pVal) ? pVal : 0));
            progress.setAttribute('aria-label', `${this._dicts.getMuscleName(currentMuscleId) || 'Muscle'} contribution: ${pVal}%`);
            row.appendChild(progress);
            frag.appendChild(row);
        });

        this._els.bundles.appendChild(frag);
        if (!arr.length) {
            const empty = document.createElement('p');
            empty.className = 'exercise-inline-empty';
            empty.textContent = 'No muscles added. Choose the working muscles below and allocate 100% between them.';
            this._els.bundles.appendChild(empty);
        }

        updateBundleSummary(this._els.bundleSumInfo, sum);
    }

    _addBundleFromInputs() {
        const muscleId = this._els.muscleSelect?.value;
        const percentage = Number(this._els.percentInput?.value);
        if (!muscleId || !this._els.percentInput?.value || !Number.isFinite(percentage) || percentage <= 0 || percentage > 100) {
            Toast.show({title: 'Choose a muscle and a percentage from 1 to 100', type: 'error'});
            return;
        }
        if (!this._dicts.muscles.has(muscleId)) {
            Toast.show({title: 'Unknown muscle', type: 'error'});
            return;
        }
        const formEntity = this.readFormToEntity();
        const bundles = [...(Array.isArray(formEntity?.[FIELD.bundles]) ? formEntity[FIELD.bundles] : [])];
        if (bundles.some(bundle => bundle?.muscleId === muscleId)) {
            Toast.show({title: 'Muscle already added', message: 'Adjust its existing contribution instead.', type: 'warning'});
            return;
        }
        bundles.push({muscleId, percentage});
        this._store.patchCurrent({...formEntity, [FIELD.bundles]: bundles});
        if (this._els.percentInput) this._els.percentInput.value = '';
    }

    // ── Private: event binding ───────────────────────────────────────────────

    _bindEvents() {
        this._els.detailLoading?.addEventListener('click', event => {
            if (!event.target.closest?.('[data-exercise-action="dismiss-detail-error"]')) return;
            this._store.setDetailError('');
            const {current, viewMode} = this._store.getState();
            const target = !current ? this._els.viewForm : viewMode === 'json' ? this._els.editor : this._els.fName;
            target?.focus({preventScroll: true});
        });
        this._els.builder?.addEventListener('input', () => this._updateDraftState());
        this._els.builder?.addEventListener('change', () => this._updateDraftState());
        // Save
        this._els.saveBtn?.addEventListener('click', async () => {
            const {current} = this._store.getState();
            if (!current) {
                Toast.show({title: 'Nothing to save', message: 'Select an exercise from the list or click "New".', type: 'error'});
                return;
            }
            let entity;
            try { entity = this.readFormToEntity(); } catch (error) { this._showEditorError(error); return; }
            const {ok, errors, warnings, issues} = this._validator.validate(entity);
            this._showValidation(issues || errors.map(message => ({field: 'editor', message})));
            if (!ok) {
                Toast.show({title: 'Validation failed', message: errors[0], type: 'error'});
                this._els.validationSummary?.scrollIntoView?.({block: 'start', behavior: 'smooth'});
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
        const switchMode = mode => {
            if (mode === this._viewMode) return true;
            if (!this.flush()) return false;
            this._store.setViewMode(mode);
            return true;
        };
        this._els.viewForm?.addEventListener('click', () => switchMode('form'));
        this._els.viewJson?.addEventListener('click', () => switchMode('json'));
        const modeButtons = [this._els.viewForm, this._els.viewJson];
        modeButtons.forEach((button, index) => button?.addEventListener('keydown', event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index;
            if (switchMode(next === 0 ? 'form' : 'json')) modeButtons[next]?.focus();
            else modeButtons[this._viewMode === 'json' ? 1 : 0]?.focus();
        }));

        // Image preview live update
        this._els.fImage?.addEventListener('input', () => {
            this._renderImagePreview(this._els.fImage.value.trim());
        });
        this._els.previewImg?.addEventListener('error', () => {
            this._els.previewCard?.classList.remove('has-image');
            if (this._els.previewEmpty) this._els.previewEmpty.textContent = 'Image could not load. Check the URL.';
            if (this._els.previewFrame) this._els.previewFrame.disabled = true;
        });
        this._els.previewFrame?.addEventListener('click', () => {
            const url = sanitizeUrl(this._els.fImage?.value);
            if (url) window.open(url, '_blank', 'noopener,noreferrer');
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
                if (!this.flush()) return;
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
            if (!refs.some(x => x?.equipmentId === id)) refs.push({equipmentId: id});
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
        this._els.editor?.addEventListener('input', () => { this._validateJsonEditor(); this._updateDraftState(); });
        this._els.clearJsonBtn?.addEventListener('click', () => {
            if (this._els.editor) this._els.editor.value = '';
            this._validateJsonEditor();
            this._updateDraftState();
        });

        // GPT prompt buttons
        this._els.promptBtn?.addEventListener('click', () => this._copyPrompt('review'));
        this._els.promptImgBtn?.addEventListener('click', () => this._copyPrompt('image'));
        this._els.promptRulesBtn?.addEventListener('click', () => this._copyPrompt('rules'));
    }

    // ── GPT prompts ──────────────────────────────────────────────────────────

    async _copyPrompt(type) {
        if (!this._store.getState().current) return;
        let entity;
        try { entity = this.readFormToEntity(); } catch (error) { this._showEditorError(error); return; }
        const build = type === 'image' ? buildImagePrompt : type === 'rules' ? buildRulesPrompt : buildReviewPrompt;
        const text = build(entity, this._dicts);

        try {
            await navigator.clipboard.writeText(text);
        } catch {
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            let copied = false;
            try { copied = document.execCommand('copy'); } catch { /* Report the failure below. */ }
            ta.remove();
            if (!copied) {
                Toast.show({title: 'Could not copy prompt', message: 'Allow clipboard access and try again.', type: 'error'});
                return;
            }
        }
        Toast.show({title: type === 'image' ? 'Image prompt copied' : type === 'rules' ? 'Rules prompt copied' : 'Prompt copied'});
    }

}

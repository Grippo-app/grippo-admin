import {Events} from '../../infrastructure/events/events.js';
import {ExerciseNormalizer, ExerciseTranslations} from '../../domain/exercise/index.js';
import {Toast} from '../../shared/components/Toast.js';
import {DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES} from '../../shared/constants/index.js';
import {draftSignature, exerciseDiagnosticSources, exerciseName, mergeLocalizedExerciseLists} from './exercisePresentation.js';

export class ExerciseController {
    constructor({store, listView, formView, repository, bus, confirmDialog}) {
        this._store = store;
        this._list = listView;
        this._form = formView;
        this._repo = repository;
        this._bus = bus;
        this._confirm = confirmDialog;
        this._selectSeq = 0;
        this._intentSeq = 0;
        this._listSeq = 0;
        this._sessionSeq = 0;
        this._sourceSeq = 0;
        bus.on(Events.AUTH_LOGIN_SUCCESS, () => this.loadList());
        const reset = () => {
            this._sessionSeq++;
            this._selectSeq++;
            this._intentSeq++;
            this._listSeq++;
            this._store.reset();
        };
        bus.on(Events.AUTH_LOGOUT, reset);
        bus.on(Events.AUTH_SESSION_EXPIRED, reset);
    }

    async _canLeaveDraft() {
        if (!this._form?.hasUnsavedChanges?.()) return true;
        return this._confirm.ask({title: 'Discard unsaved changes?',
            message: 'Your exercise changes have not been saved.',
            detail: 'Save the exercise first to keep your edits.', actionLabel: 'Discard changes'});
    }

    async loadList() {
        const seq = ++this._listSeq;
        const sourceVersion = ++this._sourceSeq;
        this._store.setLoadError();
        this._store.setLoading(true);
        try {
            const responses = await Promise.all(SUPPORTED_LANGUAGES.map(async locale => ({locale, list: await this._repo.fetchList(locale)})));
            if (seq !== this._listSeq) return;
            const diagnosticSources = exerciseDiagnosticSources(responses);
            const list = mergeLocalizedExerciseLists(responses);
            this._store.setItems(list, {diagnosticSources, sourceVersion});
            this._bus.emit(Events.EXERCISE_LIST_LOADED, list);
        } catch (err) {
            if (seq !== this._listSeq) return;
            this._store.setLoadError(err.message);
            Toast.show({title: 'Failed to load exercises', message: err.message, type: 'error'});
        } finally {
            if (seq === this._listSeq) this._store.setLoading(false);
        }
    }

    async selectItem(item) {
        const id = item?.entity?.id || item?.id;
        if (!id) return;
        const state = this._store.getState();
        if (state.current?.id === id && !state.isNew) {
            this._intentSeq++;
            if (state.isDetailLoading) {
                this._selectSeq++;
                this._store.setDetailLoading(false);
            }
            return;
        }
        const intent = ++this._intentSeq;
        if (!await this._canLeaveDraft() || intent !== this._intentSeq) return;
        const seq = ++this._selectSeq;
        const sourceVersion = ++this._sourceSeq;
        this._store.setDetailLoading(true, id);
        try {
            // All translations must load before editing: saving a partial record could erase a locale.
            const responses = await Promise.all(SUPPORTED_LANGUAGES.map(async locale => ({
                locale, raw: await this._repo.fetchDetail(id, locale),
            })));
            if (seq !== this._selectSeq) return;
            if (responses.some(({raw}) => !raw || typeof raw !== 'object')) throw new Error('Incomplete exercise data. Please try again.');
            let translationSnapshot = null;
            try {
                const raw = await this._repo.fetchTranslations(id);
                if (seq !== this._selectSeq) return;
                translationSnapshot = ExerciseTranslations.validateSnapshot(raw, id);
            } catch (error) {
                if (seq !== this._selectSeq) return;
                // Older deployed APIs may not have the admin read route. Other failures must stay visible.
                if (error.status !== 404) throw error;
            }
            let canonical = {...ExerciseNormalizer.emptyTemplate(), id};
            for (const {locale, raw} of responses) {
                const normalized = ExerciseNormalizer.normalizeEntityShape(raw.entity || raw, {locale, previous: canonical});
                canonical = ExerciseNormalizer.mergeLocalizedEntity(canonical, normalized);
            }
            if (translationSnapshot) canonical = ExerciseTranslations.applySnapshot(canonical, translationSnapshot);
            const englishRaw = responses.find(response => response.locale === DEFAULT_LANGUAGE).raw;
            this._store.setDiagnosticSource(id, englishRaw.entity || englishRaw, {translationSnapshot, sourceVersion});
            this._store.setCurrent(canonical, {translationProvenanceKnown: !!translationSnapshot, translationSnapshot});
            this._form?.markSaved?.(canonical);
            this._bus.emit(Events.EXERCISE_SELECTED, canonical);
        } catch (err) {
            if (seq !== this._selectSeq) return;
            this._store.setDetailError(err.message);
            Toast.show({title: 'Failed to load exercise', message: err.message, type: 'error'});
        } finally {
            if (seq === this._selectSeq) {
                const error = this._store.getState().detailError;
                this._store.setDetailLoading(false);
                if (error) this._store.setDetailError(error);
            }
        }
    }

    selectLocale(locale) {
        if (!SUPPORTED_LANGUAGES.includes(locale) || !this._store.getState().current) return;
        // selectItem already loads every locale. Refetching here overwrote unsaved edits.
        this._store.setLocale(locale);
        this._bus.emit(Events.EXERCISE_LOCALE_CHANGED, {locale});
    }

    async newItem() {
        const intent = ++this._intentSeq;
        if (!await this._canLeaveDraft() || intent !== this._intentSeq) return;
        this._selectSeq++;
        this._store.setDetailLoading(false);
        const blank = ExerciseNormalizer.emptyTemplate();
        this._store.setNew(blank);
        this._form?.markSaved?.(blank);
    }

    async saveItem(entity) {
        const {current, isNew, isSaving, isDetailLoading, createIdentityMissing, translationProvenanceKnown} = this._store.getState();
        if (!current || isSaving || isDetailLoading || createIdentityMissing || entity?.id !== current.id) return;
        const session = this._sessionSeq;
        const selection = this._selectSeq;
        if (!isNew && !translationProvenanceKnown) {
            const confirmed = await this._confirm.ask({title: 'Save text for all three languages?',
                message: 'This API replaces all localized names and descriptions when you save.',
                detail: 'Loaded UA/RU text may be English fallback. Saving writes every currently loaded EN, UA and RU value and may turn fallback text into a stored translation. Exact preservation requires raw translation data from the backend.',
                actionLabel: 'Save all languages', actionType: 'warn'});
            if (!confirmed || session !== this._sessionSeq || selection !== this._selectSeq || this._store.getState().current?.id !== current.id || this._store.getState().isSaving) return;
        }
        const submitted = draftSignature(entity);
        this._store.setSaving(true);
        try {
            const payload = ExerciseNormalizer.buildPersistencePayload(entity);
            const saved = isNew ? await this._repo.create(payload) : await this._repo.update(current.id, payload);
            if (session !== this._sessionSeq) return;
            const responseEntity = saved?.entity || (saved && typeof saved === 'object' ? saved : {});
            if (isNew && (typeof responseEntity.id !== 'string' || !responseEntity.id.trim())) {
                const error = new Error('The server accepted the new exercise but did not return its ID. Refresh the library and select the created record before saving again.');
                error.code = 'CREATE_ID_MISSING';
                throw error;
            }
            const finalId = responseEntity.id || current.id;
            const refreshed = ExerciseNormalizer.normalizeEntityShape({...entity, ...responseEntity, id: finalId}, {
                locale: DEFAULT_LANGUAGE, previous: entity,
            });
            const translationSnapshot = ExerciseTranslations.fromEntity(refreshed);
            const listItem = saved?.entity ? {...saved, entity: refreshed} : {id: finalId, entity: refreshed};
            this._store.upsertItem(listItem);
            this._store.setDiagnosticSource(finalId, {...payload, ...responseEntity, id: finalId}, {translationSnapshot, sourceVersion: ++this._sourceSeq});
            this._listSeq++;
            this._store.setLoading(false);
            if (selection === this._selectSeq && this._store.getState().current?.id === current.id) {
                let unchanged = true;
                try { unchanged = draftSignature(this._form?.readFormToEntity?.() || entity) === submitted; }
                catch { unchanged = false; }
                if (unchanged) this._store.setCurrent(refreshed, {translationProvenanceKnown: true, translationSnapshot});
                else {
                    // A successful create is persisted even if the draft JSON became invalid in-flight.
                    if (this._form?.preserveDraftAfterSave) this._form.preserveDraftAfterSave(refreshed, {translationSnapshot});
                    else this._store.setCurrent({...this._store.getState().current, id: finalId}, {translationProvenanceKnown: true, translationSnapshot});
                }
                this._form?.markSaved?.(refreshed);
            }
            this._bus.emit(Events.EXERCISE_SAVED, listItem);
            Toast.show({title: isNew ? 'Exercise created' : 'Exercise saved'});
        } catch (err) {
            if (session === this._sessionSeq) {
                if (isNew && err.code === 'CREATE_ID_MISSING') {
                    if (selection === this._selectSeq && this._store.getState().current?.id === current.id) this._store.setCreateIdentityMissing(true);
                    Toast.show({title: 'Exercise created — refresh the library', message: err.message, type: 'warning'});
                } else Toast.show({title: 'Save failed', message: err.message, type: 'error'});
            }
        } finally {
            if (session === this._sessionSeq) this._store.setSaving(false);
        }
    }

    async deleteItem(id) {
        const {current, isSaving} = this._store.getState();
        if (!id || !current || current.id !== id || isSaving) return;
        const session = this._sessionSeq;
        const ok = await this._confirm.ask({title: 'Delete exercise example',
            message: `Delete "${exerciseName(current) || id}"?`,
            detail: 'This action cannot be undone. Examples referenced by existing exercises cannot be deleted.',
            actionLabel: 'Delete'});
        if (!ok || session !== this._sessionSeq) return;
        this._store.setSaving(true);
        try {
            await this._repo.delete(id);
            if (session !== this._sessionSeq) return;
            this._store.removeItem(id);
            this._listSeq++;
            this._store.setLoading(false);
            if (this._store.getState().current?.id === id) {
                this._selectSeq++;
                this._store.clearCurrent();
            }
            this._bus.emit(Events.EXERCISE_DELETED, {id});
            Toast.show({title: 'Exercise deleted'});
        } catch (err) {
            if (session !== this._sessionSeq) return;
            const message = err?.message || '';
            Toast.show({title: message.includes('409') ? 'Cannot delete' : 'Delete failed',
                message: message.includes('409') ? 'This example is referenced by existing exercises.' : message, type: 'error'});
        } finally {
            if (session === this._sessionSeq) this._store.setSaving(false);
        }
    }
}

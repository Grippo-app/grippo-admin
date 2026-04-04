import {Events} from '../../infrastructure/events/events.js';
import {ExerciseNormalizer} from '../../domain/exercise/index.js';
import {Toast} from '../../shared/components/Toast.js';
import {SUPPORTED_LANGUAGES} from '../../shared/constants/index.js';

export class ExerciseController {
    constructor({store, listView, formView, repository, bus}) {
        this._store = store;
        this._list = listView;
        this._form = formView;
        this._repo = repository;
        this._bus = bus;

        bus.on(Events.AUTH_LOGIN_SUCCESS, () => this.loadList());
        bus.on(Events.AUTH_LOGOUT, () => this._store.setItems([]));
        bus.on(Events.AUTH_SESSION_EXPIRED, () => this._store.setItems([]));
    }

    async loadList() {
        this._store.setLoading(true);
        try {
            const raw = await this._repo.fetchList();
            this._store.setItems(Array.isArray(raw) ? raw : []);
        } catch (err) {
            Toast.show({title: 'Failed to load exercises', message: err.message, type: 'error'});
        } finally {
            this._store.setLoading(false);
        }
    }

    async selectItem(item) {
        // entity.id is the real exercise ID; item.id is the list-wrapper ID
        const id = item.entity?.id || item.id;
        if (!id) {
            Toast.show({title: 'Missing exercise ID', type: 'error'});
            return;
        }
        try {
            // Fetch all locales in parallel, normalize each, then merge
            const responses = await Promise.all(
                SUPPORTED_LANGUAGES.map(async l => ({
                    locale: l,
                    raw: await this._repo.fetchDetail(id, l).catch(() => null)
                }))
            );

            let canonical = ExerciseNormalizer.emptyTemplate();
            canonical.id = id; // ensure correct ID from the start

            for (const {locale: l, raw} of responses) {
                if (!raw) continue;
                // Detail endpoint returns { entity: {...}, ... } — extract the actual data
                const entityData = raw.entity || raw;
                const normalized = ExerciseNormalizer.normalizeEntityShape(entityData, {
                    locale: l,
                    previous: canonical,
                });
                canonical = ExerciseNormalizer.mergeLocalizedEntity(canonical, normalized);
            }

            this._store.setCurrent(canonical);
            this._bus.emit(Events.EXERCISE_SELECTED, canonical);
        } catch (err) {
            Toast.show({title: 'Failed to load exercise', message: err.message, type: 'error'});
        }
    }

    async selectLocale(locale) {
        const {current} = this._store.getState();
        const id = current?.id;
        if (!id) return;
        this._store.setLocale(locale);
        try {
            const raw = await this._repo.fetchDetail(id, locale);
            if (!raw) return;
            const entityData = raw.entity || raw;
            const normalized = ExerciseNormalizer.normalizeEntityShape(entityData, {
                locale,
                previous: current,
            });
            const merged = ExerciseNormalizer.mergeLocalizedEntity(current, normalized);
            this._store.setCurrent(merged);
        } catch (err) {
            Toast.show({title: 'Failed to load locale', message: err.message, type: 'error'});
        }
    }

    newItem() {
        const blank = ExerciseNormalizer.emptyTemplate();
        this._store.setNew(blank);
    }

    async saveItem(entity) {
        const {current, isNew} = this._store.getState();
        const entityId = entity?.id || current?.id;
        this._store.setSaving(true);
        try {
            const payload = ExerciseNormalizer.buildPersistencePayload(entity);
            const saved = isNew
                ? await this._repo.create(payload)
                : await this._repo.update(entityId, payload);
            // After save, re-select to get fresh server data
            const savedEntity = saved?.entity || saved;
            if (savedEntity?.id) {
                const refreshed = ExerciseNormalizer.normalizeEntityShape(savedEntity, {
                    locale: this._store.getState().locale,
                    previous: current,
                });
                this._store.upsertItem(saved);
                this._store.setCurrent(refreshed);
            } else {
                this._store.upsertItem(saved);
                this._store.setCurrent(saved);
            }
            this._bus.emit(Events.EXERCISE_SAVED, saved);
            Toast.show({title: isNew ? 'Created' : 'Saved'});
        } catch (err) {
            Toast.show({title: 'Save failed', message: err.message, type: 'error'});
        } finally {
            this._store.setSaving(false);
        }
    }

    async deleteItem(id) {
        try {
            await this._repo.delete(id);
            this._store.removeItem(id);
            this._store.clearCurrent();
            this._bus.emit(Events.EXERCISE_DELETED, {id});
            Toast.show({title: 'Deleted'});
        } catch (err) {
            Toast.show({title: 'Delete failed', message: err.message, type: 'error'});
        }
    }
}

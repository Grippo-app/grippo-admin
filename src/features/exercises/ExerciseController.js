import {Events} from '../../infrastructure/events/events.js';
import {ExerciseNormalizer} from '../../domain/exercise/index.js';
import {Toast} from '../../shared/components/Toast.js';
import {DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES} from '../../shared/constants/index.js';

export class ExerciseController {
    constructor({store, listView, formView, repository, bus, confirmDialog}) {
        this._store = store;
        this._list = listView;
        this._form = formView;
        this._repo = repository;
        this._bus = bus;
        this._confirm = confirmDialog;

        // Monotonically increasing ID used to discard stale selectItem responses
        this._selectSeq = 0;
        // Отдельный seq для смены локали (selectLocale)
        this._localeSeq = 0;

        bus.on(Events.AUTH_LOGIN_SUCCESS, () => this.loadList());
        bus.on(Events.AUTH_LOGOUT, () => this._store.setItems([]));
        bus.on(Events.AUTH_SESSION_EXPIRED, () => this._store.setItems([]));
    }

    async loadList() {
        this._store.setLoading(true);
        try {
            const raw = await this._repo.fetchList();
            const list = Array.isArray(raw) ? raw : [];
            this._store.setItems(list);
            this._bus.emit(Events.EXERCISE_LIST_LOADED, list);
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

        // Capture sequence number — if a newer selectItem fires before this one resolves,
        // the stale response will be silently discarded
        const seq = ++this._selectSeq;

        try {
            // Fetch all locales in parallel, normalize each, then merge
            const responses = await Promise.all(
                SUPPORTED_LANGUAGES.map(async l => ({
                    locale: l,
                    raw: await this._repo.fetchDetail(id, l).catch(() => null)
                }))
            );

            // Another selection started while we were in-flight — discard this result
            if (seq !== this._selectSeq) return;

            // Если ни одна локаль не пришла — это либо сетевой сбой, либо id невалиден.
            // Не подсовываем пустой шаблон вместо реальных данных.
            if (responses.every(({raw}) => !raw)) {
                Toast.show({title: 'Failed to load exercise', message: 'No data returned for any locale', type: 'error'});
                return;
            }

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
            if (seq === this._selectSeq) {
                Toast.show({title: 'Failed to load exercise', message: err.message, type: 'error'});
            }
        }
    }

    async selectLocale(locale) {
        const {current, isNew} = this._store.getState();
        const id = current?.id;
        if (!id) return;
        // Для свежесозданного, ещё не сохранённого упражнения тянуть с сервера нечего
        if (isNew) {
            this._store.setLocale(locale);
            this._bus.emit(Events.EXERCISE_LOCALE_CHANGED, {locale});
            return;
        }
        const seq = ++this._localeSeq;
        this._store.setLocale(locale);
        this._bus.emit(Events.EXERCISE_LOCALE_CHANGED, {locale});
        try {
            const raw = await this._repo.fetchDetail(id, locale);
            if (seq !== this._localeSeq) return; // stale, more recent locale switch is in flight
            if (!raw) return;
            const entityData = raw.entity || raw;
            const normalized = ExerciseNormalizer.normalizeEntityShape(entityData, {
                locale,
                previous: current,
            });
            // Берём актуальный current из стора — пока ходили на сервер, юзер мог что-то напечатать,
            // и FormView успел зафлэшить правки в стор перед переключением локали.
            const base = this._store.getState().current || current;
            const merged = ExerciseNormalizer.mergeLocalizedEntity(base, normalized);
            this._store.patchCurrent(merged);
        } catch (err) {
            if (seq === this._localeSeq) {
                Toast.show({title: 'Failed to load locale', message: err.message, type: 'error'});
            }
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
            // After save, re-select to get fresh server data.
            // Если сервер вернул пустое/неполное тело — синтезируем минимальный ответ
            // на основе того, что отправили. Это исключает падение upsertItem(null).
            const savedEntity = saved?.entity || (saved && typeof saved === 'object' ? saved : null) || {...entity, id: entityId};
            const finalId = savedEntity?.id || entityId;
            const safeListItem = saved && typeof saved === 'object'
                ? (saved.entity ? saved : {id: finalId, entity: savedEntity})
                : {id: finalId, entity: savedEntity};

            const refreshed = ExerciseNormalizer.normalizeEntityShape(savedEntity, {
                locale: this._store.getState().locale,
                previous: current,
            });
            this._store.upsertItem(safeListItem);
            this._store.setCurrent(refreshed);
            this._bus.emit(Events.EXERCISE_SAVED, safeListItem);
            Toast.show({title: isNew ? 'Created' : 'Saved'});
        } catch (err) {
            Toast.show({title: 'Save failed', message: err.message, type: 'error'});
        } finally {
            this._store.setSaving(false);
        }
    }

    async deleteItem(id) {
        if (!id) return;

        // Confirm перед удалением — сервер удаляет навсегда, отката нет.
        // В сообщении показываем имя на дефолтной локали, чтобы юзер видел, что именно удаляет.
        const {current} = this._store.getState();
        const nameTrans = ExerciseNormalizer.ensureTranslationMap(current?.nameTranslations);
        const displayName = ExerciseNormalizer.getTranslation(nameTrans, DEFAULT_LANGUAGE)
            || (typeof current?.name === 'string' ? current.name : '')
            || id;
        const ok = await this._confirm.ask({
            title: 'Delete exercise example',
            message: `Delete "${displayName}"?`,
            detail: 'This action cannot be undone. Examples referenced by existing exercises cannot be deleted.',
            actionLabel: 'Delete',
        });
        if (!ok) return;

        try {
            await this._repo.delete(id);
            this._store.removeItem(id);
            this._store.clearCurrent();
            this._bus.emit(Events.EXERCISE_DELETED, {id});
            Toast.show({title: 'Deleted'});
        } catch (err) {
            // Бэкенд возвращает 409, если example используется существующими exercises —
            // даём более понятное сообщение, чем сырой ответ сервера.
            const msg = err?.message || '';
            if (msg.includes('409')) {
                Toast.show({title: 'Cannot delete', message: 'This example is referenced by existing exercises.', type: 'error'});
            } else {
                Toast.show({title: 'Delete failed', message: msg, type: 'error'});
            }
        }
    }
}

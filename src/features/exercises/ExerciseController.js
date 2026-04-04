import { Events }             from '../../infrastructure/events/events.js';
import { ExerciseNormalizer } from '../../domain/exercise/ExerciseNormalizer.js';
import { Toast }              from '../../shared/components/Toast.js';
import { SUPPORTED_LANGUAGES } from '../../shared/constants/index.js';

/**
 * ExerciseController — оркестрирует store ↔ views ↔ repository.
 *
 * Не трогает DOM напрямую — делегирует views.
 * Не делает HTTP напрямую — делегирует repository.
 */
export class ExerciseController {
  constructor({ store, listView, formView, repository, bus }) {
    this._store  = store;
    this._list   = listView;
    this._form   = formView;
    this._repo   = repository;
    this._bus    = bus;

    bus.on(Events.AUTH_LOGIN_SUCCESS,   () => this.loadList());
    bus.on(Events.AUTH_LOGOUT,          () => this._store.setItems([]));
    bus.on(Events.AUTH_SESSION_EXPIRED, () => this._store.setItems([]));
  }

  async loadList() {
    this._store.setLoading(true);
    try {
      const raw = await this._repo.fetchList();
      this._store.setItems(Array.isArray(raw) ? raw : []);
    } catch (err) {
      Toast.show({ title: 'Failed to load exercises', message: err.message, type: 'error' });
    } finally {
      this._store.setLoading(false);
    }
  }

  async selectItem(item) {
    try {
      // Fetch all locales and merge
      const results = await Promise.all(
        SUPPORTED_LANGUAGES.map(l => this._repo.fetchDetail(item.id, l).catch(() => null))
      );
      let canonical = ExerciseNormalizer.emptyTemplate();
      for (const [i, raw] of results.entries()) {
        if (raw) canonical = ExerciseNormalizer.mergeLocalizedEntity(canonical, raw);
      }
      this._store.setCurrent(canonical);
      this._bus.emit(Events.EXERCISE_SELECTED, canonical);
    } catch (err) {
      Toast.show({ title: 'Failed to load exercise', message: err.message, type: 'error' });
    }
  }

  newItem() {
    const blank = ExerciseNormalizer.emptyTemplate();
    this._store.setNew(blank);
  }

  async saveItem(entity) {
    const { current, isNew } = this._store.getState();
    this._store.setSaving(true);
    try {
      const payload = ExerciseNormalizer.buildPersistencePayload(entity);
      const saved = isNew
        ? await this._repo.create(payload)
        : await this._repo.update(current?.id, payload);
      this._store.upsertItem(saved);
      this._store.setCurrent(saved);
      this._bus.emit(Events.EXERCISE_SAVED, saved);
      Toast.show({ title: isNew ? 'Created' : 'Saved' });
    } catch (err) {
      Toast.show({ title: 'Save failed', message: err.message, type: 'error' });
    } finally {
      this._store.setSaving(false);
    }
  }

  async deleteItem(id) {
    try {
      await this._repo.delete(id);
      this._store.removeItem(id);
      this._store.clearCurrent();
      this._bus.emit(Events.EXERCISE_DELETED, { id });
      Toast.show({ title: 'Deleted' });
    } catch (err) {
      Toast.show({ title: 'Delete failed', message: err.message, type: 'error' });
    }
  }
}

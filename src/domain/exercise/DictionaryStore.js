import {FIELD} from '../../shared/constants/index.js';

/** Server dictionaries, retaining the last successful cache when refresh fails. */
export class DictionaryStore {
    constructor(repository) {
        this._repo = repository;
        this.equipment = new Map();
        this.muscles = new Map();
        this.loading = false;
        this.errors = [];
        this._equipmentLoaded = false;
        this._musclesLoaded = false;
        this._loadPromise = null;
    }

    get isReady() { return this._equipmentLoaded && this._musclesLoaded; }

    async loadAll() {
        if (this._loadPromise) return this._loadPromise;
        this.loading = true;
        this.errors = [];
        this._loadPromise = (async () => {
            try {
                await Promise.all([this.loadEquipments(), this.loadMuscles()]);
                return {ok: this.isReady && !this.errors.length, errors: [...this.errors]};
            } finally {
                this.loading = false;
                this._loadPromise = null;
            }
        })();
        return this._loadPromise;
    }

    async loadEquipments() {
        try {
            const data = await this._repo.fetchEquipments();
            if (!Array.isArray(data)) throw new Error('Unexpected equipment dictionary response');
            const equipment = new Map();
            for (const group of data) {
                for (const item of Array.isArray(group?.equipments) ? group.equipments : [group]) {
                    if (item?.id) equipment.set(String(item.id), String(item.name ?? item.id));
                }
            }
            this.equipment = equipment;
            this._equipmentLoaded = true;
            return true;
        } catch (error) {
            this.errors.push(`Equipment: ${error.message}`);
            return false;
        }
    }

    async loadMuscles() {
        try {
            const data = await this._repo.fetchMuscles();
            if (!Array.isArray(data)) throw new Error('Unexpected muscle dictionary response');
            const muscles = new Map();
            for (const group of data) {
                for (const item of Array.isArray(group?.muscles) ? group.muscles : [group]) {
                    if (item?.id) muscles.set(String(item.id), String(item.name ?? item.id));
                }
            }
            this.muscles = muscles;
            this._musclesLoaded = true;
            return true;
        } catch (error) {
            this.errors.push(`Muscles: ${error.message}`);
            return false;
        }
    }

    getEquipmentName(id) { return this.equipment.get(String(id)); }
    getMuscleName(id) { return this.muscles.get(String(id)); }

    validateEquipmentRefs(entity) {
        const refs = Array.isArray(entity[FIELD.equipmentRefs]) ? entity[FIELD.equipmentRefs] : [];
        return refs.map(ref => String(ref?.equipmentId || '')).filter(id => !this.equipment.has(id));
    }

    validateBundles(entity) {
        const bundles = Array.isArray(entity[FIELD.bundles]) ? entity[FIELD.bundles] : [];
        const unknownMuscles = [];
        let sum = 0;
        let outOfRange = false;
        for (const bundle of bundles) {
            const id = String(bundle?.muscleId ?? '');
            const percentage = Number(bundle?.percentage ?? 0);
            if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) outOfRange = true;
            sum += Number.isFinite(percentage) ? percentage : 0;
            if (!this.muscles.has(id)) unknownMuscles.push(id);
        }
        return {sum, outOfRange, unknownMuscles};
    }
}

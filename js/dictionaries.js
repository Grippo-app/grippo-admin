import { FIELD } from './constants.js';

export class DictionaryStore {
  constructor(api) {
    this.api = api;
    this.equipment = new Map();
    this.muscles = new Map();
  }

  async loadAll() {
    await Promise.all([this.loadEquipments(), this.loadMuscles()]);
  }

  async loadEquipments() {
    try {
      const data = await this.api.fetchEquipments();
      const equipments = [];
      if (Array.isArray(data) && data.length && Array.isArray(data[0]?.equipments)) {
        data.forEach((g) => (g.equipments || []).forEach((e) => equipments.push(e)));
      } else if (Array.isArray(data)) {
        data.forEach((e) => equipments.push(e));
      }
      for (const e of equipments) {
        if (e?.id) this.equipment.set(String(e.id), String(e.name ?? e.id));
      }
    } catch (error) {
      console.warn('Equipment dict fetch failed:', error);
    }
  }

  async loadMuscles() {
    try {
      const data = await this.api.fetchMuscles();
      if (Array.isArray(data)) {
        for (const g of data) {
          (g.muscles || []).forEach((m) => {
            if (m?.id) this.muscles.set(String(m.id), String(m.name ?? m.id));
          });
        }
      }
    } catch (error) {
      console.warn('Muscle dict fetch failed:', error);
    }
  }

  getEquipmentName(id) {
    return this.equipment.get(String(id));
  }

  getMuscleName(id) {
    return this.muscles.get(String(id));
  }

  validateEquipmentRefs(entity) {
    const arr = Array.isArray(entity[FIELD.equipmentRefs]) ? entity[FIELD.equipmentRefs] : [];
    return arr.map((x) => String(x?.equipmentId || '')).filter((id) => !this.equipment.has(id));
  }

  validateBundles(entity) {
    const arr = Array.isArray(entity[FIELD.bundles]) ? entity[FIELD.bundles] : [];
    const unknownMuscles = [];
    let sum = 0;
    let outOfRange = false;

    for (const bundle of arr) {
      const id = String(bundle?.muscleId ?? '');
      const p = Number(bundle?.percentage ?? 0);
      if (!isFinite(p) || p < 0 || p > 100) outOfRange = true;
      sum += isFinite(p) ? p : 0;
      if (!this.muscles.has(id)) unknownMuscles.push(id);
    }

    return { sum, outOfRange, unknownMuscles };
  }
}

import { FIELD, DEFAULT_LANGUAGE } from './constants.js';
import { EntityToolkit } from './entity.js';

const REQUIRED_ENUMS = {
  weightType: ['free', 'fixed', 'body_weight'],
  category: ['compound', 'isolation'],
  experience: ['beginner', 'intermediate', 'advanced', 'pro'],
  forceType: ['push', 'pull', 'hinge']
};

export class EntityValidator {
  constructor(dictionaryStore) {
    this.dictionary = dictionaryStore;
  }

  validate(entity) {
    const normalized = {
      ...entity,
      nameTranslations: EntityToolkit.ensureTranslationMap(entity.nameTranslations),
      descriptionTranslations: EntityToolkit.ensureTranslationMap(entity.descriptionTranslations)
    };

    const errors = [];
    const warnings = [];

    const defaultName = EntityToolkit.getTranslation(normalized.nameTranslations, DEFAULT_LANGUAGE).trim();
    const defaultDescription = EntityToolkit.getTranslation(normalized.descriptionTranslations, DEFAULT_LANGUAGE).trim();
    normalized.name = defaultName;
    normalized.description = defaultDescription;
    if (!defaultName) errors.push(`Missing: name (${DEFAULT_LANGUAGE.toUpperCase()})`);
    if (!defaultDescription) errors.push(`Missing: description (${DEFAULT_LANGUAGE.toUpperCase()})`);
    if (!normalized.weightType) errors.push('Missing: weightType');
    if (!normalized.category) errors.push('Missing: category');
    if (!normalized.experience) errors.push('Missing: experience');
    if (!normalized.forceType) errors.push('Missing: forceType');

    if (!normalized.imageUrl) warnings.push('imageUrl is empty');

    const rules = normalized.rules || {};
    const inputs = rules?.inputs;
    if (!inputs || typeof inputs !== 'object') {
      errors.push('Missing: rules.inputs');
    } else {
      const externalWeight = inputs.externalWeight;
      const bodyWeight = inputs.bodyWeight;
      const extraWeight = inputs.extraWeight;
      const assistance = inputs.assistance;

      const isRequiredInput = (value) => value && typeof value === 'object' && typeof value.required === 'boolean';

      if (externalWeight && bodyWeight) {
        errors.push('rules.inputs.externalWeight and rules.inputs.bodyWeight are mutually exclusive');
      }

      if (externalWeight && !isRequiredInput(externalWeight)) {
        errors.push('rules.inputs.externalWeight.required must be boolean');
      }

      if (bodyWeight) {
        if (bodyWeight.participates !== true) {
          errors.push('rules.inputs.bodyWeight.participates must be true');
        }
        const multiplier = Number(bodyWeight.multiplier);
        if (!Number.isFinite(multiplier)) {
          errors.push('rules.inputs.bodyWeight.multiplier required');
        } else if (multiplier < 0.05 || multiplier > 2) {
          errors.push('rules.inputs.bodyWeight.multiplier must be between 0.05 and 2.0');
        }
      }

      if (!bodyWeight && (extraWeight || assistance)) {
        errors.push('rules.inputs.extraWeight and rules.inputs.assistance require bodyWeight');
      }

      if (externalWeight && (extraWeight || assistance)) {
        errors.push('rules.inputs.extraWeight and rules.inputs.assistance must be null when externalWeight is set');
      }

      if (extraWeight && !isRequiredInput(extraWeight)) {
        errors.push('rules.inputs.extraWeight.required must be boolean');
      }

      if (assistance && !isRequiredInput(assistance)) {
        errors.push('rules.inputs.assistance.required must be boolean');
      }
    }

    for (const [key, values] of Object.entries(REQUIRED_ENUMS)) {
      if (normalized[key] && !values.includes(normalized[key])) {
        errors.push(`${key} invalid`);
      }
    }

    const unknownEquipment = this.dictionary?.validateEquipmentRefs(normalized) || [];
    if (unknownEquipment.length) {
      errors.push(`Unknown equipment: ${Array.from(new Set(unknownEquipment)).join(', ')}`);
    }

    const bundles = Array.isArray(normalized[FIELD.bundles]) ? normalized[FIELD.bundles] : [];
    if (bundles.length === 0) errors.push('No muscle bundles added');

    const { sum, outOfRange, unknownMuscles } = this.dictionary?.validateBundles(normalized) || {};
    if (sum !== undefined && sum !== 100) errors.push(`Bundles sum ${sum}% (must be 100%)`);
    if (outOfRange) errors.push('Bundle percentage out of [0..100]');
    if (unknownMuscles && unknownMuscles.length) {
      errors.push(`Unknown muscles: ${Array.from(new Set(unknownMuscles)).join(', ')}`);
    }

    return { ok: errors.length === 0, errors, warnings };
  }
}

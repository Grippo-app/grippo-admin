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
    const components = rules?.components;
    if (!components || typeof components !== 'object') {
      errors.push('Missing: rules.components');
    } else {
      const externalWeight = components.externalWeight;
      const bodyWeight = components.bodyWeight;
      const extraWeight = components.extraWeight;
      const assistWeight = components.assistWeight;

      const isRequiredInput = (value) => value && typeof value === 'object' && typeof value.required === 'boolean';

      if (externalWeight && bodyWeight) {
        errors.push('rules.components.externalWeight and rules.components.bodyWeight are mutually exclusive');
      }

      if (externalWeight && !isRequiredInput(externalWeight)) {
        errors.push('rules.components.externalWeight.required must be boolean');
      }

      if (bodyWeight && !isRequiredInput(bodyWeight)) {
        errors.push('rules.components.bodyWeight.required must be boolean');
      }

      if (!bodyWeight && (extraWeight || assistWeight)) {
        errors.push('rules.components.extraWeight and rules.components.assistWeight require bodyWeight');
      }

      if (externalWeight && (extraWeight || assistWeight)) {
        errors.push('rules.components.extraWeight and rules.components.assistWeight must be null when externalWeight is set');
      }

      if (extraWeight && !isRequiredInput(extraWeight)) {
        errors.push('rules.components.extraWeight.required must be boolean');
      }

      if (assistWeight && !isRequiredInput(assistWeight)) {
        errors.push('rules.components.assistWeight.required must be boolean');
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

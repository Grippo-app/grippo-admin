import { FIELD, SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE } from './constants.js';
import { uuidv4 } from './utils.js';

function createEmptyTranslations() {
  return Object.fromEntries(SUPPORTED_LANGUAGES.map((lang) => [lang, '']));
}

function ensureTranslationMap(value) {
  const base = createEmptyTranslations();
  if (!value || typeof value !== 'object') return base;
  for (const lang of SUPPORTED_LANGUAGES) {
    const raw = value[lang];
    if (typeof raw === 'string') base[lang] = raw;
    else if (raw != null) base[lang] = String(raw);
  }
  return base;
}

function getTranslation(map, lang) {
  if (!map || typeof map !== 'object') return '';
  const raw = map[lang];
  return typeof raw === 'string' ? raw : '';
}

function cloneArrayOfObjects(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((item) => (item && typeof item === 'object' ? { ...item } : null))
    .filter(Boolean);
}

function buildLocalizedEntries(map) {
  const normalized = ensureTranslationMap(map);
  const entries = SUPPORTED_LANGUAGES.map((lang) => {
    const value = typeof normalized[lang] === 'string' ? normalized[lang].trim() : '';
    const entry = { language: lang };
    if (value) entry.value = value;
    return entry;
  });
  return entries.length ? entries : [{ language: DEFAULT_LANGUAGE }];
}

function toBool(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  if (typeof value === 'number') return value !== 0;
  return false;
}

function normalizeRules(rules, previousRules) {
  const prev = previousRules && typeof previousRules === 'object' ? previousRules : {};
  const src = rules && typeof rules === 'object' ? rules : {};

  const normalizeRequiredComponent = (value) => {
    if (!value || typeof value !== 'object') return null;
    const required = toBool(value.required);
    return { required };
  };

  const normalizeBodyWeight = (value) => {
    if (!value || typeof value !== 'object') return null;
    if (typeof value.required === 'boolean') return { required: value.required };
    return { required: true };
  };

  const baseComponents = src.components || prev.components;
  if (baseComponents && typeof baseComponents === 'object') {
    let externalWeight = normalizeRequiredComponent(baseComponents.externalWeight);
    let bodyWeight = normalizeBodyWeight(baseComponents.bodyWeight);
    let extraWeight = normalizeRequiredComponent(baseComponents.extraWeight);
    let assistWeight = normalizeRequiredComponent(baseComponents.assistWeight);

    if (bodyWeight) {
      externalWeight = null;
    } else {
      extraWeight = null;
      assistWeight = null;
    }

    if (externalWeight) {
      extraWeight = null;
      assistWeight = null;
    }

    return {
      components: { externalWeight, bodyWeight, extraWeight, assistWeight }
    };
  }

  const baseInputs = src.inputs || prev.inputs;
  if (baseInputs && typeof baseInputs === 'object') {
    let externalWeight = normalizeRequiredComponent(baseInputs.externalWeight);
    let bodyWeight = baseInputs.bodyWeight ? { required: true } : null;
    let extraWeight = normalizeRequiredComponent(baseInputs.extraWeight);
    let assistWeight = normalizeRequiredComponent(baseInputs.assistance);

    if (bodyWeight) {
      externalWeight = null;
    } else {
      extraWeight = null;
      assistWeight = null;
    }

    if (externalWeight) {
      extraWeight = null;
      assistWeight = null;
    }

    return {
      components: { externalWeight, bodyWeight, extraWeight, assistWeight }
    };
  }

  const entryType = src?.entry?.type ?? src?.entryType ?? prev?.entry?.type ?? '';
  const loadType = src?.load?.type ?? src?.loadType ?? prev?.load?.type ?? '';

  const optionsSource = src?.options && typeof src.options === 'object' ? src.options : {};
  const prevOptions = prev?.options && typeof prev.options === 'object' ? prev.options : {};
  const canAddExtraWeight = toBool(optionsSource.canAddExtraWeight ?? prevOptions.canAddExtraWeight ?? false);
  const canUseAssistance = toBool(optionsSource.canUseAssistance ?? prevOptions.canUseAssistance ?? false);

  let externalWeight = null;
  let bodyWeight = null;
  let extraWeight = null;
  let assistWeight = null;

  if (entryType === 'RepetitionsAndWeight') {
    externalWeight = { required: true };
  } else if (entryType === 'RepetitionsWithOptionalExtraWeight') {
    bodyWeight = { required: true };
    extraWeight = { required: false };
  } else if (entryType === 'RepetitionsWithOptionalExtraAndAssistance') {
    bodyWeight = { required: true };
    extraWeight = { required: false };
    assistWeight = { required: false };
  } else if (entryType === 'RepetitionsOnly') {
    externalWeight = null;
  } else if (loadType === 'DirectWeight') {
    externalWeight = { required: true };
  } else if (loadType === 'BodyWeightFull' || loadType === 'BodyWeightMultiplier') {
    bodyWeight = { required: true };
  }

  if (bodyWeight && !extraWeight && canAddExtraWeight) {
    extraWeight = { required: false };
  }
  if (bodyWeight && !assistWeight && canUseAssistance) {
    assistWeight = { required: false };
  }

  if (!bodyWeight) {
    extraWeight = null;
    assistWeight = null;
  }

  if (externalWeight && bodyWeight) {
    bodyWeight = null;
    extraWeight = null;
    assistWeight = null;
  }

  return {
    components: { externalWeight, bodyWeight, extraWeight, assistWeight }
  };
}

function emptyTemplate() {
  return {
    id: uuidv4(),
    name: '',
    description: '',
    nameTranslations: createEmptyTranslations(),
    descriptionTranslations: createEmptyTranslations(),
    weightType: '',
    category: '',
    experience: '',
    forceType: '',
    imageUrl: '',
    rules: normalizeRules({}, {}),
    [FIELD.bundles]: [],
    [FIELD.equipmentRefs]: []
  };
}

function normalizeEntityShape(src, options = {}) {
  const locale = SUPPORTED_LANGUAGES.includes(options.locale) ? options.locale : DEFAULT_LANGUAGE;
  const previous = options.previous && typeof options.previous === 'object' ? options.previous : null;

  const e = { ...src };
  const eq = Array.isArray(e[FIELD.equipmentRefs]) ? e[FIELD.equipmentRefs] : [];
  e[FIELD.equipmentRefs] = eq
    .map((x) => {
      if (typeof x === 'string') return { equipmentId: x };
      if (x && typeof x === 'object') {
        const id = x.equipmentId ?? x.id ?? x.key ?? x.code;
        return id ? { equipmentId: String(id) } : null;
      }
      return null;
    })
    .filter(Boolean);

  const rawB = Array.isArray(e[FIELD.bundles]) ? e[FIELD.bundles] : [];
  e[FIELD.bundles] = rawB
    .map((b) => {
      if (!b || typeof b !== 'object') return null;
      const muscleId = String(b.muscleId ?? b.muscle ?? b.muscle_id ?? b.targetMuscleId ?? '').trim();
      const percentage = Number(b.percentage ?? b.percent ?? b.ratio ?? b.load ?? 0);
      if (!muscleId || !isFinite(percentage)) return null;
      return { muscleId, percentage };
    })
    .filter(Boolean);

  const prevNameTranslations = ensureTranslationMap(previous?.nameTranslations);
  const prevDescTranslations = ensureTranslationMap(previous?.descriptionTranslations);

  const nameTranslations = ensureTranslationMap(e.nameTranslations);
  const descriptionTranslations = ensureTranslationMap(e.descriptionTranslations);

  const applyLocalizedArray = (target, value) => {
    if (!Array.isArray(value)) return;
    value.forEach((entry) => {
      if (!entry || typeof entry !== 'object') return;
      const lang = typeof entry.language === 'string' ? entry.language.toLowerCase() : '';
      if (!SUPPORTED_LANGUAGES.includes(lang)) return;
      const val = typeof entry.value === 'string'
        ? entry.value
        : typeof entry.name === 'string'
          ? entry.name
          : typeof entry.text === 'string'
            ? entry.text
            : '';
      if (typeof val === 'string') target[lang] = val;
    });
  };

  applyLocalizedArray(nameTranslations, e.name);
  applyLocalizedArray(descriptionTranslations, e.description);

  for (const lang of SUPPORTED_LANGUAGES) {
    if (!nameTranslations[lang] && prevNameTranslations[lang]) nameTranslations[lang] = prevNameTranslations[lang];
    if (!descriptionTranslations[lang] && prevDescTranslations[lang]) descriptionTranslations[lang] = prevDescTranslations[lang];
  }

  const rawTranslations = Array.isArray(e.translations) ? e.translations : [];
  rawTranslations.forEach((tr) => {
    if (!tr || typeof tr !== 'object') return;
    const lang = typeof tr.language === 'string' ? tr.language.toLowerCase() : '';
    if (!SUPPORTED_LANGUAGES.includes(lang)) return;
    if (typeof tr.name === 'string') nameTranslations[lang] = tr.name;
    if (typeof tr.description === 'string') descriptionTranslations[lang] = tr.description;
  });

  if (typeof e.name === 'string' && !nameTranslations[locale]) nameTranslations[locale] = e.name;
  if (typeof e.description === 'string' && !descriptionTranslations[locale]) descriptionTranslations[locale] = e.description;

  if (typeof e.name === 'string' && locale === DEFAULT_LANGUAGE && !nameTranslations[DEFAULT_LANGUAGE]) {
    nameTranslations[DEFAULT_LANGUAGE] = e.name;
  }
  if (typeof e.description === 'string' && locale === DEFAULT_LANGUAGE && !descriptionTranslations[DEFAULT_LANGUAGE]) {
    descriptionTranslations[DEFAULT_LANGUAGE] = e.description;
  }

  if (!nameTranslations[DEFAULT_LANGUAGE] && typeof previous?.name === 'string') {
    nameTranslations[DEFAULT_LANGUAGE] = previous.name;
  }
  if (!descriptionTranslations[DEFAULT_LANGUAGE] && typeof previous?.description === 'string') {
    descriptionTranslations[DEFAULT_LANGUAGE] = previous.description;
  }

  e.nameTranslations = nameTranslations;
  e.descriptionTranslations = descriptionTranslations;
  e.name = nameTranslations[DEFAULT_LANGUAGE] || '';
  e.description = descriptionTranslations[DEFAULT_LANGUAGE] || '';
  delete e.translations;
  if (Array.isArray(e.name)) delete e.name;
  if (Array.isArray(e.description)) delete e.description;
  e.rules = normalizeRules(e.rules, previous?.rules);

  return e;
}

function mergeLocalizedEntity(base, addition) {
  if (!addition) return base || null;
  const incoming = {
    ...addition,
    nameTranslations: ensureTranslationMap(addition.nameTranslations),
    descriptionTranslations: ensureTranslationMap(addition.descriptionTranslations),
    [FIELD.equipmentRefs]: cloneArrayOfObjects(addition[FIELD.equipmentRefs]),
    [FIELD.bundles]: cloneArrayOfObjects(addition[FIELD.bundles])
  };

  if (!base) {
    return incoming;
  }

  const merged = {
    ...base,
    nameTranslations: ensureTranslationMap(base.nameTranslations),
    descriptionTranslations: ensureTranslationMap(base.descriptionTranslations)
  };

  for (const [key, value] of Object.entries(incoming)) {
    if (key === 'nameTranslations' || key === 'descriptionTranslations') continue;
    if (key === FIELD.equipmentRefs || key === FIELD.bundles) {
      if (Array.isArray(value) && value.length) merged[key] = cloneArrayOfObjects(value);
      continue;
    }
    if (value !== undefined && value !== null && value !== '') {
      merged[key] = value;
    }
  }

  merged.nameTranslations = {
    ...merged.nameTranslations,
    ...incoming.nameTranslations
  };
  merged.descriptionTranslations = {
    ...merged.descriptionTranslations,
    ...incoming.descriptionTranslations
  };

  return merged;
}

function buildPersistencePayload(entity) {
  const payload = { ...entity };
  const nameEntries = buildLocalizedEntries(entity.nameTranslations);
  const descriptionEntries = buildLocalizedEntries(entity.descriptionTranslations);
  payload.name = nameEntries;
  payload.description = descriptionEntries;
  delete payload.translations;
  delete payload.localizedName;
  delete payload.localizedDescription;
  delete payload.locales;
  delete payload.nameTranslations;
  delete payload.descriptionTranslations;
  return payload;
}

function buildLocalePlaceholder(basePlaceholder, fallbackValue, locale) {
  if (locale === DEFAULT_LANGUAGE) return basePlaceholder;
  if (!fallbackValue) return basePlaceholder;
  return `${fallbackValue} (${DEFAULT_LANGUAGE.toUpperCase()} fallback)`;
}

export const EntityToolkit = {
  createEmptyTranslations,
  ensureTranslationMap,
  getTranslation,
  cloneArrayOfObjects,
  buildLocalizedEntries,
  emptyTemplate,
  normalizeEntityShape,
  mergeLocalizedEntity,
  buildPersistencePayload,
  buildLocalePlaceholder
};

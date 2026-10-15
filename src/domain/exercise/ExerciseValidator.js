import {DEFAULT_LANGUAGE, FIELD, SUPPORTED_LANGUAGES} from '../../shared/constants/index.js';
import {sanitizeUrl} from '../../shared/utils/index.js';
import {ExerciseNormalizer} from './ExerciseNormalizer.js';
import {EXERCISE_ENUMS} from './exerciseConstraints.js';

const FIELD_LABELS = {weightType: 'weight type', category: 'category', experience: 'experience level', forceType: 'force type'};

export class ExerciseValidator {
    constructor(dictionaryStore) { this.dictionary = dictionaryStore; }

    validate(entity) {
        const issues = [];
        const warnings = [];
        const add = (field, message) => issues.push({field, message});
        const result = () => ({ok: !issues.length, errors: issues.map(issue => issue.message), issues, warnings});
        if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
            add('editor', 'Enter one exercise JSON object.');
            return result();
        }
        for (const [field, label] of [['nameTranslations', 'name'], ['descriptionTranslations', 'description']]) {
            const map = ExerciseNormalizer.ensureTranslationMap(entity[field]);
            if (!ExerciseNormalizer.getTranslation(map, DEFAULT_LANGUAGE).trim()) add(field, `Enter the English ${label}.`);
            if (entity[field] && (typeof entity[field] !== 'object' || Array.isArray(entity[field]))) add(field, `${field} must be a language map.`);
            for (const language of SUPPORTED_LANGUAGES) {
                if (entity[field] && Object.hasOwn(entity[field], language) && typeof entity[field][language] !== 'string') {
                    add(field, `${field}.${language} must be text. Replace its value with a quoted string.`);
                }
            }
        }
        for (const [field, values] of Object.entries(EXERCISE_ENUMS)) {
            if (!values.includes(entity[field])) add(field, `Choose a valid ${FIELD_LABELS[field]}.`);
        }
        if (!entity.imageUrl) warnings.push('No image added. You can add one later.');
        else if (typeof entity.imageUrl !== 'string' || !sanitizeUrl(entity.imageUrl)) add('imageUrl', 'Use an HTTP(S) image URL or a relative image path.');

        const components = entity.components ?? entity.rules?.components;
        if (!components || typeof components !== 'object' || Array.isArray(components)) {
            add('components', 'Components must be an object with weight inputs or null values.');
        } else {
            const {externalWeight, bodyWeight, extraWeight, assistWeight} = components;
            for (const key of ['externalWeight', 'bodyWeight', 'extraWeight', 'assistWeight']) {
                const value = components[key];
                if (!Object.hasOwn(components, key) || value === undefined) add('components', `Set ${key} to a weight input object or null.`);
                if (value !== undefined && value !== null && (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.required !== 'boolean')) {
                    add('components', `${key} must be null or an object with a boolean required field.`);
                }
            }
            if (externalWeight && bodyWeight) add('components', 'Choose either external weight or body weight.');
            if (bodyWeight && bodyWeight.required !== true) add('components', 'Body weight participation must have required set to true.');
            if (bodyWeight && (!Number.isFinite(bodyWeight.multiplier) || bodyWeight.multiplier < 0.05 || bodyWeight.multiplier > 2)) {
                add('components', 'Body weight multiplier must be between 0.05 and 2.0.');
            }
            if (!bodyWeight && (extraWeight || assistWeight)) add('components', 'Enable body weight before extra weight or assistance.');
        }

        if (!Array.isArray(entity[FIELD.equipmentRefs])) add('equipmentRefs', 'Equipment must be a list.');
        const refs = Array.isArray(entity[FIELD.equipmentRefs]) ? entity[FIELD.equipmentRefs] : [];
        if (refs.some(ref => !ref || typeof ref.equipmentId !== 'string' || !ref.equipmentId)) add('equipmentRefs', 'Each equipment entry needs an equipment ID.');
        const equipmentIds = refs.map(ref => ref?.equipmentId);
        if (new Set(equipmentIds).size !== equipmentIds.length) add('equipmentRefs', 'Remove duplicate equipment entries.');
        const unknownEquipment = this.dictionary?.validateEquipmentRefs(entity) || [];
        if (unknownEquipment.length) add('equipmentRefs', 'Choose equipment from the loaded dictionary. Remove or replace unknown entries.');

        const bundles = Array.isArray(entity[FIELD.bundles]) ? entity[FIELD.bundles] : [];
        if (!bundles.length) add('bundles', 'Add at least one muscle contribution.');
        if (bundles.some(bundle => !bundle || typeof bundle.muscleId !== 'string' || !Number.isFinite(bundle.percentage))) {
            add('bundles', 'Every muscle contribution needs a muscle ID and a numeric percentage.');
        }
        if (bundles.some(bundle => Number.isFinite(bundle?.percentage) && !Number.isInteger(bundle.percentage))) add('bundles', 'Use whole-number muscle percentages.');
        const muscleIds = bundles.map(bundle => bundle?.muscleId);
        if (new Set(muscleIds).size !== muscleIds.length) add('bundles', 'Each muscle can appear once. Merge duplicate contributions.');
        const {sum, outOfRange, unknownMuscles} = this.dictionary?.validateBundles(entity) || {};
        if (sum !== undefined && Math.abs(sum - 100) > 0.000001) add('bundles', `Muscle contributions total ${Number(sum.toFixed(2))}%. Adjust them to 100%.`);
        if (outOfRange) add('bundles', 'Each muscle percentage must be between 0 and 100.');
        if (unknownMuscles?.length) add('bundles', 'Replace unknown muscles with an option from the dictionary.');
        return result();
    }
}

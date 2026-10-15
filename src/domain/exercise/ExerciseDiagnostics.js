import {FIELD} from '../../shared/constants/index.js';
import {runDiagnosticRules} from '../diagnostics/index.js';
import {EXERCISE_ENUMS} from './exerciseConstraints.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const owns = (record, field) => object(record) && Object.hasOwn(record, field);
const issue = (field, message) => ({field, message});
const list = (record, field, context) => owns(record, field) ? record[field] : context.complete ? undefined : null;
const validPercent = value => Number.isInteger(value) && value >= 0 && value <= 100;
const nonempty = value => typeof value === 'string' && !!value.trim();
const componentKeys = ['externalWeight', 'bodyWeight', 'extraWeight', 'assistWeight'];
const componentsOf = record => owns(record, 'components') ? record.components : record?.rules?.components;
const duplicateIds = (rows, field) => {
    const seen = new Set();
    const duplicates = new Set();
    for (const row of rows) {
        const id = row?.[field];
        if (!nonempty(id)) continue;
        if (seen.has(id)) duplicates.add(id);
        seen.add(id);
    }
    return [...duplicates];
};

/** Checks target the persisted API contract, never exercise-science assumptions. */
export const EXERCISE_DIAGNOSTIC_RULES = Object.freeze([
    {id: 'muscle-percentages', severity: 'error', title: 'Invalid muscle contributions', evaluate(record, context) {
        const rows = list(record, FIELD.bundles, context);
        if (rows === null && !owns(record, FIELD.bundles)) return null;
        if (!Array.isArray(rows) || !rows.length) return [issue(FIELD.bundles, 'At least one muscle contribution is required.')];
        return rows.flatMap((row, index) => {
            const field = `${FIELD.bundles}[${index}]`;
            if (!object(row) || !nonempty(row.muscleId)) return [issue(field, `Contribution ${index + 1} needs a muscle ID and a whole-number percentage from 0 to 100.`)];
            if (!validPercent(row.percentage)) return [issue(`${field}.percentage`, `Contribution ${index + 1} has ${JSON.stringify(row.percentage) ?? 'no percentage'}. Use a whole number from 0 to 100.`)];
            return [];
        });
    }},
    {id: 'muscle-total', severity: 'error', title: 'Muscle total differs from 100%', evaluate(record) {
        const rows = record?.[FIELD.bundles];
        if (!Array.isArray(rows) || !rows.length || rows.some(row => !object(row) || !validPercent(row.percentage))) return null;
        const total = rows.reduce((sum, row) => sum + row.percentage, 0);
        return total === 100 ? [] : [issue(FIELD.bundles, `Stored muscle contributions total ${total}%. The required total is 100%.`)];
    }},
    {id: 'muscle-duplicates', severity: 'error', title: 'Duplicate muscles', evaluate(record) {
        const rows = record?.[FIELD.bundles];
        if (!Array.isArray(rows)) return null;
        return duplicateIds(rows, 'muscleId').map(id => issue(FIELD.bundles, `Muscle ${id} occurs more than once. Each muscle can have one contribution.`));
    }},
    {id: 'muscle-zero', severity: 'warning', title: 'Zero muscle contribution', evaluate(record) {
        const rows = record?.[FIELD.bundles];
        if (!Array.isArray(rows)) return null;
        return rows.flatMap((row, index) => row?.percentage === 0 ? [issue(`${FIELD.bundles}[${index}].percentage`, `Contribution ${index + 1} is 0%. Review whether this muscle should be included.`)] : []);
    }},
    {id: 'equipment-entries', severity: 'error', title: 'Invalid equipment references', evaluate(record, context) {
        const rows = list(record, FIELD.equipmentRefs, context);
        if (rows === null && !owns(record, FIELD.equipmentRefs)) return null;
        if (!Array.isArray(rows)) return [issue(FIELD.equipmentRefs, 'Equipment references must be a list.')];
        return rows.flatMap((row, index) => !object(row) || !nonempty(row.equipmentId)
            ? [issue(`${FIELD.equipmentRefs}[${index}]`, `Equipment entry ${index + 1} needs an equipment ID.`)] : []);
    }},
    {id: 'equipment-duplicates', severity: 'error', title: 'Duplicate equipment', evaluate(record) {
        const rows = record?.[FIELD.equipmentRefs];
        if (!Array.isArray(rows)) return null;
        return duplicateIds(rows, 'equipmentId').map(id => issue(FIELD.equipmentRefs, `Equipment ${id} occurs more than once. Each equipment reference can appear once.`));
    }},
    {id: 'component-contract', severity: 'error', title: 'Invalid weight inputs', evaluate(record, context) {
        const components = componentsOf(record);
        if (components === undefined && !context.complete) return null;
        if (!object(components)) return [issue('components', 'Weight inputs must contain all four component keys, each set to an input object or null.')];
        const findings = [];
        for (const key of componentKeys) {
            const value = components[key];
            if (!Object.hasOwn(components, key) || value === undefined) findings.push(issue(`components.${key}`, 'This component key is required; use an input object or null.'));
            else if (value !== null && (!object(value) || typeof value.required !== 'boolean')) findings.push(issue(`components.${key}.required`, 'An enabled component needs a boolean required flag.'));
        }
        const {externalWeight, bodyWeight, extraWeight, assistWeight} = components;
        if (object(externalWeight) && object(bodyWeight)) findings.push(issue('components', 'External weight and body weight cannot both be enabled.'));
        if (!object(bodyWeight) && (object(extraWeight) || object(assistWeight))) findings.push(issue('components', 'Extra weight and assistance require body weight to be enabled.'));
        if (object(bodyWeight)) {
            if (bodyWeight.required !== true) findings.push(issue('components.bodyWeight.required', 'Body weight must have required set to true.'));
            if (!Number.isFinite(bodyWeight.multiplier) || bodyWeight.multiplier < 0.05 || bodyWeight.multiplier > 2) findings.push(issue('components.bodyWeight.multiplier', 'The body weight multiplier must be a number from 0.05 to 2.'));
        }
        return findings;
    }},
    {id: 'required-enums', severity: 'error', title: 'Invalid exercise attributes', evaluate(record, context) {
        const known = Object.keys(EXERCISE_ENUMS).filter(field => owns(record, field) || context.complete);
        if (!known.length) return null;
        return known.filter(field => !EXERCISE_ENUMS[field].includes(record?.[field]))
            .map(field => issue(field, `Stored ${field} must be one of: ${EXERCISE_ENUMS[field].join(', ')}.`));
    }},
    {id: 'unknown-muscles', severity: 'error', title: 'Unknown muscle references', evaluate(record, context) {
        if (!context.musclesReady || !(context.muscles instanceof Map) || !Array.isArray(record?.[FIELD.bundles])) return null;
        return [...new Set(record[FIELD.bundles].map(row => row?.muscleId).filter(nonempty))]
            .filter(id => !context.muscles.has(id)).map(id => issue(FIELD.bundles, `Muscle ${id} is absent from the successfully loaded muscle dictionary.`));
    }},
    {id: 'unknown-equipment', severity: 'error', title: 'Unknown equipment references', evaluate(record, context) {
        if (!context.equipmentReady || !(context.equipment instanceof Map) || !Array.isArray(record?.[FIELD.equipmentRefs])) return null;
        return [...new Set(record[FIELD.equipmentRefs].map(row => row?.equipmentId).filter(nonempty))]
            .filter(id => !context.equipment.has(id)).map(id => issue(FIELD.equipmentRefs, `Equipment ${id} is absent from the successfully loaded equipment dictionary.`));
    }},
    {id: 'english-text', severity: 'error', title: 'Missing English text', evaluate(record, context) {
        const snapshot = context.translationSnapshot;
        const english = snapshot?.translations.find(row => row.language === 'en');
        const findings = [];
        let known = false;
        for (const field of ['name', 'description']) {
            const map = record?.[`${field}Translations`];
            if (!snapshot && !object(map)) continue;
            known = true;
            const value = snapshot ? english?.[field] ?? snapshot.base[field] : map.en;
            if (!nonempty(value)) findings.push(issue(`${field}Translations.en`, `Stored English ${field} is missing or blank.`));
        }
        return known ? findings : null;
    }},
    {id: 'missing-image', severity: 'info', title: 'No image', evaluate(record, context) {
        const field = owns(record, 'imageUrl') ? 'imageUrl' : owns(record, 'image_url') ? 'image_url' : null;
        if (!field && !context.complete) return null;
        const value = field ? record[field] : undefined;
        if (value != null && typeof value !== 'string') return null;
        return value == null || (typeof value === 'string' && !value.trim())
            ? [issue('imageUrl', 'No image URL is stored. An illustration can make this exercise easier to identify.')] : [];
    }},
]);

export function diagnoseExercise(record, context = {}) {
    return runDiagnosticRules(EXERCISE_DIAGNOSTIC_RULES, record, context);
}

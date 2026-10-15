import {DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES} from '../../shared/constants/index.js';
import {ExerciseNormalizer} from '../../domain/exercise/ExerciseNormalizer.js';

export function exerciseEntity(item) {
    return item?.entity && typeof item.entity === 'object' ? item.entity : item || {};
}

export function exerciseName(item, locale = DEFAULT_LANGUAGE) {
    const entity = exerciseEntity(item);
    if (typeof entity.nameTranslations?.[locale] === 'string' && entity.nameTranslations[locale]) {
        return entity.nameTranslations[locale];
    }
    if (typeof entity.name === 'string') return entity.name;
    if (Array.isArray(entity.name)) {
        const entry = entity.name.find(value => value?.language === locale) || entity.name[0];
        return typeof (entry?.value ?? entry?.name) === 'string' ? entry.value ?? entry.name : '';
    }
    return '';
}

export function exerciseSearchText(item) {
    const entity = exerciseEntity(item);
    return [...SUPPORTED_LANGUAGES.map(locale => exerciseName(item, locale)), entity.id || item?.id || '']
        .join(' ').toLocaleLowerCase();
}

/** Keep untranslated transport values separate from the editor's normalized records. */
export function exerciseDiagnosticSources(responses) {
    const list = responses.find(response => response.locale === DEFAULT_LANGUAGE)?.list;
    if (!Array.isArray(list)) throw new Error('Unexpected exercise list response. Refresh to try again.');
    return new Map(list.map(item => {
        const entity = exerciseEntity(item);
        return [entity.id || item?.id, structuredClone(entity)];
    }));
}

export function mergeLocalizedExerciseLists(responses) {
    const items = new Map();
    for (const {locale, list} of responses) {
        if (!Array.isArray(list)) throw new Error('Unexpected exercise list response. Refresh to try again.');
        for (const item of list) {
            const entity = exerciseEntity(item);
            const id = entity.id || item?.id;
            if (!id) throw new Error('An exercise list record has no ID. Refresh to try again.');
            if (locale !== DEFAULT_LANGUAGE && !items.has(id)) continue;
            const previous = items.get(id);
            const normalized = ExerciseNormalizer.normalizeEntityShape(entity, {locale, previous: previous?.entity});
            if (previous) previous.entity = {...previous.entity, nameTranslations: normalized.nameTranslations,
                descriptionTranslations: normalized.descriptionTranslations};
            else items.set(id, item.entity ? {...item, entity: normalized} : {id, entity: normalized});
        }
    }
    return [...items.values()];
}

export function draftSignature(entity) {
    const stable = value => {
        if (Array.isArray(value)) return value.map(stable);
        if (!value || typeof value !== 'object') return value;
        return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
    };
    return JSON.stringify(stable(entity));
}

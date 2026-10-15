import {DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES} from '../../shared/constants/index.js';
import {ExerciseNormalizer} from './ExerciseNormalizer.js';

/** Authoritative untranslated rows stay separate from the editable JSON document. */
export class ExerciseTranslations {
    static validateSnapshot(raw, expectedId) {
        const object = value => value && typeof value === 'object' && !Array.isArray(value);
        const nullableText = value => value === null || typeof value === 'string';
        if (!object(raw) || typeof raw.id !== 'string' || !raw.id.trim() || raw.id !== expectedId || !object(raw.base)
            || !nullableText(raw.base.name) || !nullableText(raw.base.description) || !Array.isArray(raw.translations)) {
            throw new Error('The server returned an invalid raw translation snapshot. Retry loading this exercise.');
        }
        const seen = new Set();
        const translations = raw.translations.map(row => {
            if (!object(row) || !SUPPORTED_LANGUAGES.includes(row.language) || seen.has(row.language)
                || !nullableText(row.name) || !nullableText(row.description)) {
                throw new Error('Raw translations contain invalid or duplicate language rows. Retry loading this exercise.');
            }
            seen.add(row.language);
            return {language: row.language, name: row.name, description: row.description};
        });
        return {id: raw.id, base: {name: raw.base.name, description: raw.base.description}, translations};
    }

    static applySnapshot(entity, snapshot) {
        const nameTranslations = ExerciseNormalizer.createEmptyTranslations();
        const descriptionTranslations = ExerciseNormalizer.createEmptyTranslations();
        for (const row of snapshot.translations) {
            nameTranslations[row.language] = row.name ?? '';
            descriptionTranslations[row.language] = row.description ?? '';
        }
        const english = snapshot.translations.find(row => row.language === DEFAULT_LANGUAGE);
        if (english?.name == null) nameTranslations.en = snapshot.base.name ?? '';
        if (english?.description == null) descriptionTranslations.en = snapshot.base.description ?? '';
        return {...entity, id: snapshot.id, nameTranslations, descriptionTranslations,
            name: nameTranslations.en, description: descriptionTranslations.en};
    }

    static fromEntity(entity) {
        const names = ExerciseNormalizer.ensureTranslationMap(entity.nameTranslations);
        const descriptions = ExerciseNormalizer.ensureTranslationMap(entity.descriptionTranslations);
        const text = value => value.trim() || null;
        const translations = SUPPORTED_LANGUAGES.map(language => ({language,
            name: text(names[language]), description: text(descriptions[language])}))
            .filter(row => row.name !== null || row.description !== null);
        const baseValue = field => translations.find(row => row.language === DEFAULT_LANGUAGE)?.[field]
            ?? translations.find(row => row[field] !== null)?.[field] ?? null;
        return {id: entity.id, base: {name: baseValue('name'), description: baseValue('description')}, translations};
    }

    static legacyNotice(snapshot) {
        if (!snapshot) return '';
        const english = snapshot.translations.find(row => row.language === DEFAULT_LANGUAGE);
        const fields = ['name', 'description'];
        const usesBase = fields.some(field => english?.[field] == null && typeof snapshot.base[field] === 'string' && snapshot.base[field].trim());
        const differs = fields.some(field => english?.[field] != null && snapshot.base[field] !== english[field]);
        if (usesBase) return 'Legacy English base text is shown where no English translation is stored. Saving will store that text in an English translation row and normalize the base text. Missing UA/RU translations will stay missing.';
        if (differs) return 'Legacy base text differs from the stored English translation. Saving will normalize the base text to the translation values shown here; stored UA/RU text will be preserved.';
        return '';
    }
}

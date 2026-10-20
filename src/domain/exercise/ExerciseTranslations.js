import {DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES} from '../../shared/constants/index.js';
import {ExerciseNormalizer} from './ExerciseNormalizer.js';

/** Authoritative untranslated rows stay separate from the editable JSON document. */
export class ExerciseTranslations {
    static validateSnapshot(raw, expectedId) {
        const object = value => value && typeof value === 'object' && !Array.isArray(value);
        const nullableText = value => value === null || typeof value === 'string';
        if (!object(raw) || typeof raw.id !== 'string' || !raw.id.trim() || raw.id !== expectedId || !object(raw.base)
            || typeof raw.translationsRevision !== 'string' || !/^[a-f0-9]{64}$/.test(raw.translationsRevision)
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
        return {id: raw.id, base: {name: raw.base.name, description: raw.base.description}, translations,
            translationsRevision: raw.translationsRevision};
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

    /** Rebase only untouched text fields; retain local edits for explicit review. No revision is synthesized. */
    static reconcileDraft(draft, baseline, latest) {
        const merged = ExerciseTranslations.applySnapshot(draft, latest);
        if (!baseline) return merged;
        const before = ExerciseTranslations.applySnapshot({}, baseline);
        for (const field of ['nameTranslations', 'descriptionTranslations']) {
            const edits = ExerciseNormalizer.ensureTranslationMap(draft[field]);
            for (const language of SUPPORTED_LANGUAGES) {
                if (edits[language] !== before[field][language]) merged[field][language] = edits[language];
            }
        }
        return {...merged, name: merged.nameTranslations.en, description: merged.descriptionTranslations.en};
    }

    static reviewDetails(draft, baseline, latest) {
        const merged = ExerciseTranslations.reconcileDraft(draft, baseline, latest);
        const server = ExerciseTranslations.applySnapshot({}, latest);
        const lines = [baseline
            ? 'Untouched fields use the latest server text. Your edited fields stay in the draft, including empty values that delete a translation. Review every resulting value below. Saving is a separate action.'
            : 'The original raw snapshot is unavailable. Latest server translations will replace the localized draft text. Other draft fields stay unchanged. Saving is a separate action.'];
        for (const language of SUPPORTED_LANGUAGES) {
            for (const [map, label] of [['nameTranslations', 'name'], ['descriptionTranslations', 'description']]) {
                lines.push(`${language} ${label}\nLatest: ${JSON.stringify(server[map][language])}\nDraft: ${JSON.stringify(draft[map]?.[language] ?? '')}\nResult: ${JSON.stringify(merged[map][language])}`);
            }
        }
        return lines.join('\n\n');
    }

    static legacyNotice(snapshot) {
        if (!snapshot) return '';
        const english = snapshot.translations.find(row => row.language === DEFAULT_LANGUAGE);
        const fields = ['name', 'description'];
        const usesBase = fields.some(field => english?.[field] == null && typeof snapshot.base[field] === 'string' && snapshot.base[field].trim());
        const differs = fields.some(field => english?.[field] != null && snapshot.base[field] !== english[field]);
        if (usesBase) return 'Legacy English base text is shown where no English translation is stored. Saving will store that text in an English translation row and normalize the base text. Missing UA/RU/pt-BR/pt-PT translations will stay missing.';
        if (differs) return 'Legacy base text differs from the stored English translation. Saving will normalize the base text to the translation values shown here; other stored languages will be preserved.';
        return '';
    }
}

export function buildReviewPrompt(entity, dictionaries) {
    const FIELD_BUNDLES = 'exerciseExampleBundles';
    const FIELD_EQUIP = 'equipmentRefs';
    const pretty = (o) => JSON.stringify(o, null, 2);
    const lines = [];
    lines.push('You are an expert strength & conditioning editor and a strict JSON validator.');
    lines.push('');
    lines.push('When you answer, follow this EXACT output format:');
    lines.push('```json');
    lines.push('{ ...final JSON... }');
    lines.push('```');
    lines.push('Пояснение (на русском): кратко и по пунктам объясни, что улучшил(а) и почему (с опорой на НАЗВАНИЕ/ОПИСАНИЕ и общие знания/практику).');
    lines.push('');
    lines.push('Hard requirements:');
    lines.push('- The JSON in the code block MUST strictly match this schema:');
    lines.push('  {');
    lines.push('    "id"?: string,');
    lines.push('    "name": string, "nameTranslations": {"en": string, "ua": string, "ru": string},');
    lines.push('    "description": string, "descriptionTranslations": {"en": string, "ua": string, "ru": string},');
    lines.push('    "weightType": "free"|"fixed"|"body_weight",');
    lines.push('    "category": "compound"|"isolation",');
    lines.push('    "experience": "beginner"|"intermediate"|"advanced"|"pro",');
    lines.push('    "forceType": "push"|"pull"|"hinge",');
    lines.push('    "imageUrl"?: string,');
    lines.push('    "components": {"externalWeight": {"required": boolean}|null, "bodyWeight": {"required": boolean, "multiplier": number}|null, "extraWeight": {"required": boolean}|null, "assistWeight": {"required": boolean}|null},');
    lines.push(`    "${FIELD_BUNDLES}": [{ "muscleId": string, "percentage": number }],`);
    lines.push(`    "${FIELD_EQUIP}": [{ "equipmentId": string }]`);
    lines.push('  }');
    lines.push('- Do NOT include a field named "tutorials".');
    lines.push('- Do NOT change "id" if it is present. Preserve all translation maps, components and other input fields.');
    lines.push('- If you improve name/description, update the matching English translation map entry too.');
    lines.push(`- Sum of "${FIELD_BUNDLES}[].percentage" MUST be exactly 100 (integers only).`);
    lines.push(`- "${FIELD_EQUIP}" MUST use VALID equipment IDs from the dictionary below.`);
    lines.push('- If there are duplicates of the same muscle/equipment, merge them.');
    lines.push('- Improve QUALITY of muscle distribution using NAME and DESCRIPTION AND your general domain knowledge.');
    lines.push('- You MAY add/remove muscles if that leads to a more realistic split, but use only IDs from the provided dictionary.');
    lines.push('- You MAY refine "description" for clarity and utility; keep the same language.');
    lines.push('- Ensure equipment list is relevant to the exercise; only use IDs from the equipment dictionary.');
    lines.push('');
    lines.push(`Name: ${entity.name || '(empty)'}`);
    lines.push(`Description: ${entity.description || '(empty)'}`);
    lines.push('');
    lines.push('Muscles dictionary (name — id):');
    for (const [id, name] of dictionaries.muscles.entries()) lines.push(`- ${name} — ${id}`);
    lines.push('');
    lines.push('Equipment dictionary (name — id):');
    for (const [id, name] of dictionaries.equipment.entries()) lines.push(`- ${name} — ${id}`);
    lines.push('');
    lines.push('Current JSON:');
    lines.push(pretty(entity));
    lines.push('');
    lines.push('OUTPUT FORMAT (repeat for clarity):');
    lines.push('```json');
    lines.push('{ ...final JSON... }');
    lines.push('```');
    lines.push('Пояснение: ... (на русском, перечисли ключевые изменения).');
    lines.push('Return NOTHING else beyond these two parts.');
    return lines.join('\n');
}

export function buildImagePrompt(entity, dictionaries) {
    const FIELD_EQUIP = 'equipmentRefs';
    const eqArr = Array.isArray(entity[FIELD_EQUIP]) ? entity[FIELD_EQUIP] : [];
    const eqNames = eqArr
        .map((x) => (dictionaries.getEquipmentName(String(x?.equipmentId || '')) || '').trim())
        .filter(Boolean);
    const allowedEq = eqNames.length ? eqNames.join(', ') : 'без дополнительного оборудования';
    const lines = [];
    lines.push('Задача:');
    lines.push(`Сгенерируй превью упражнения "${entity.name || '(empty)'}".`);
    lines.push('');
    lines.push('Изображение (строгие требования):');
    lines.push('\t• ответ только картинка, без текста;');
    lines.push('\t• aspect_ratio: 1:1 строго;');
    lines.push('\t• size: 900×900, PNG, sRGB, без alpha;');
    lines.push('');
    lines.push('Color (hard, only these HEX):');
    lines.push('\t• Background radial: center #CBD0D8 → edges #2E333B (allowed solids: #EDEFF1, #262A31)');
    lines.push('\t• Metal: base #AEB6C2, shadows #8993A1 / #6B7684, highlight #D7DEE6');
    lines.push('\t• Rubber: base #2B3036, highlight #3A4048');
    lines.push('\t• Plastic: base #3A4048, highlight #4A515B');
    lines.push('\t• Skin/mannequin: base #ECE6E0, mid #D6CDC5, deep #BFB4A9, highlight #F7F3EF (матовые, без глянца)');
    lines.push('\t• Outfit: base #2E333B; one accent ≤12%: #3366FF (обычно) или #FFA726 (редко).');
    lines.push('\t• Контраст акцента к базе ≥ 4.5:1.');
    lines.push('\t• No pure #FFFFFF/#000000.');
    lines.push('');
    lines.push('Style (fixed): clay/3D, matte, без бликов/шума/текста/логотипов.');
    lines.push('Манекен: андрогинный, без лица/волос/пор/вен.');
    lines.push('Пропорции: реалистичные — корректные плечи, торс, руки и ноги без деформаций.');
    lines.push('Окружение: минималистичная студия, нейтральный фон, без текста/логотипов/UI.');
    lines.push('');
    lines.push('Camera & Framing (hard):');
    lines.push('\t• View: 3/4 isometric, tilt from above ≈ 12°; eq. focal ≈ 40 mm; camera height ≈ chest level.');
    lines.push('\t• Subject centered; mannequin + equipment occupy 70–80% of frame height.');
    lines.push('\t• Safe-margin: ≥ 7% от кадра по всем сторонам.');
    lines.push('\t• Hard rule: Entire silhouette and equipment must fit inside safe-margin.');
    lines.push('\t• Ground plane visible; soft contact shadow under feet and rack/bench.');
    lines.push('');
    lines.push('Lighting (soft-matte): Key:Fill:Rim ≈ 1 : 0.5 : 0.2, key 35–45° сверху-сбоку.');
    lines.push('');
    lines.push(`Allowed equipment only: ${eqNames.length ? eqNames.join(', ') : '— без дополнительного оборудования'}. Никакого другого инвентаря.`);
    lines.push('');
    lines.push('Данные упражнения:');
    lines.push(`• Оборудование: ${allowedEq}`);
    lines.push(`• Описание: ${entity.description || '(пусто)'}`);
    return lines.join('\n');
}

export function buildRulesPrompt(entity, dictionaries) {
    const FIELD_EQUIP = 'equipmentRefs';
    const pretty = (o) => JSON.stringify(o, null, 2);
    const eqArr = Array.isArray(entity[FIELD_EQUIP]) ? entity[FIELD_EQUIP] : [];
    const resolvedEquip = eqArr
        .map((ref) => {
            const id = ref?.equipmentId ?? ref?.id ?? null;
            if (!id) return null;
            const name = dictionaries.getEquipmentName(id) ?? null;
            return name ? `${name} — ${id}` : String(id);
        })
        .filter(Boolean);

    const lines = [];
    lines.push('You are a strength training domain expert AND a strict JSON validator.');
    lines.push('');
    lines.push('GOAL: Keep entire input JSON unchanged EXCEPT the field `components`. Replace `components` with the best possible values based on: name, description, weightType, category, forceType, and equipmentRefs.');
    lines.push('');
    lines.push('OUTPUT FORMAT (MANDATORY): Return EXACTLY one markdown code block with JSON inside, and NOTHING else.');
    lines.push('- First chars: ```json');
    lines.push('- Last chars: ```');
    lines.push('- No text before or after the code block.');
    lines.push('');
    lines.push('HARD REQUIREMENTS:');
    lines.push('1) Output a SINGLE valid JSON object inside the code block.');
    lines.push('2) You may ONLY change `components`. Every other field must remain identical.');
    lines.push('3) `components` is a TOP-LEVEL field. Do NOT nest it inside `rules`.');
    lines.push('');
    lines.push('COMPONENTS SCHEMA (STRICT):');
    lines.push('"components": {');
    lines.push('  "externalWeight": { "required": boolean } | null,');
    lines.push('  "bodyWeight": { "required": boolean, "multiplier": number } | null,');
    lines.push('  "extraWeight": { "required": boolean } | null,');
    lines.push('  "assistWeight": { "required": boolean } | null');
    lines.push('}');
    lines.push('');
    lines.push('INVARIANTS (MUST ALWAYS HOLD):');
    lines.push('- externalWeight and bodyWeight are mutually exclusive (never both non-null).');
    lines.push('- If bodyWeight is non-null, it MUST include multiplier in range 0.05..2.0.');
    lines.push('- extraWeight and assistWeight are ONLY allowed when bodyWeight exists.');
    lines.push('- If externalWeight exists, extraWeight and assistWeight MUST be null.');
    lines.push('- bodyWeight.required MUST be true; externalWeight.required MUST be true.');
    lines.push('');
    if (resolvedEquip.length > 0) {
        lines.push('EQUIPMENT REFS (RESOLVED FOR THIS EXERCISE):');
        resolvedEquip.forEach((s) => lines.push(`- ${s}`));
        lines.push('');
    }
    lines.push('INPUT JSON (copy this and only edit `components`):');
    lines.push(pretty(entity));
    return lines.join('\n');
}

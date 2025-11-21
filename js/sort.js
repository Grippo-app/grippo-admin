import { DEFAULT_LANGUAGE } from './constants.js';
import { compareStrings, safeString, toTimestamp } from './utils.js';

function getItemName(item) {
  const translations = item?.entity?.nameTranslations || {};
  const englishName = translations[DEFAULT_LANGUAGE];
  const fallback = item?.entity?.name ?? item?.name ?? '';
  return safeString(englishName ?? fallback).trim();
}

function getCreatedAtStamp(item) {
  const raw = item?.entity?.createdAt ?? item?.entity?.created_at ?? item?.createdAt ?? item?.created_at ?? null;
  return toTimestamp(raw);
}

function itemHasImage(item) {
  const raw = item?.entity?.imageUrl ?? item?.entity?.image_url ?? item?.entity?.image ?? item?.imageUrl ?? item?.image_url ?? item?.image ?? '';
  return typeof raw === 'string' && raw.trim() !== '';
}

function compareByName(a, b) {
  const nameA = getItemName(a);
  const nameB = getItemName(b);
  const cmp = compareStrings(nameA, nameB);
  if (cmp !== 0) return cmp;
  const idA = safeString(a?.entity?.id ?? a?.id ?? '');
  const idB = safeString(b?.entity?.id ?? b?.id ?? '');
  return compareStrings(idA, idB);
}

export class SortManager {
  constructor() {
    this.currentSort = 'name';
    this.options = {
      name: {
        label: 'Имя',
        compare: (a, b) => compareByName(a, b)
      },
      createdAt: {
        label: 'Дата создания',
        compare: (a, b) => {
          const diff = getCreatedAtStamp(b) - getCreatedAtStamp(a);
          return diff !== 0 ? diff : compareByName(a, b);
        }
      },
      hasImage: {
        label: 'Наличие картинки',
        compare: (a, b) => {
          const diff = Number(itemHasImage(b)) - Number(itemHasImage(a));
          return diff !== 0 ? diff : compareByName(a, b);
        }
      },
      missingImage: {
        label: 'Отсутствие картинки',
        compare: (a, b) => {
          const diff = Number(!itemHasImage(b)) - Number(!itemHasImage(a));
          return diff !== 0 ? diff : compareByName(a, b);
        }
      }
    };
  }

  setSort(key) {
    if (!this.options[key]) return false;
    const changed = this.currentSort !== key;
    this.currentSort = key;
    return changed;
  }

  apply(items) {
    if (!Array.isArray(items)) return [];
    const sorted = [...items];
    const sorter = this.options[this.currentSort] || this.options.name;
    sorted.sort((a, b) => sorter.compare(a, b));
    return sorted;
  }

  getActiveOption() {
    return this.options[this.currentSort] || this.options.name;
  }
}

export function formatItemMeta(item) {
  return {
    displayName: item?.entity?.localizedName || item?.entity?.name || '(no name)',
    usage: item?.usageCount ?? 0,
    lastUsed: item?.lastUsed ? new Date(item.lastUsed) : null,
    hasImage: itemHasImage(item)
  };
}

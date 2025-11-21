import { FIELD, SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE } from './constants.js';
import { StorageManager } from './storage.js';
import { ApiClient } from './api.js';
import { DictionaryStore } from './dictionaries.js';
import { SortManager } from './sort.js';
import { EntityToolkit } from './entity.js';
import { EntityValidator } from './validator.js';
import { toast, pretty, formatIso } from './utils.js';

class GrippoAdminApp {
  constructor() {
    this.storage = new StorageManager();
    this.activeLocale = this.storage.getLocale();
    this.viewMode = this.storage.getViewMode();
    this.editedIds = this.storage.loadEditedSet();

    this.api = new ApiClient({
      storage: this.storage,
      getLocale: () => this.activeLocale
    });

    this.dictionaries = new DictionaryStore(this.api);
    this.validator = new EntityValidator(this.dictionaries);
    this.sortManager = new SortManager();

    this.items = [];
    this.filtered = [];
    this.current = null;
    this.isNew = false;
    this.canonical = EntityToolkit.emptyTemplate();
    this.activeSection = 'exercise';

    this.els = {};
    this.localeButtons = [];
    this.defaultNamePlaceholder = '';
    this.defaultDescriptionPlaceholder = '';
  }

  async init() {
    this.cacheElements();
    this.updatePrimarySectionVisibility();
    this.attachPrimaryNavHandlers();
    this.loadPersistedState();
    await this.dictionaries.loadAll();
    this.refreshOptionLists();
    this.attachEventHandlers();
    this.updateLocaleUI();
    this.applyViewMode();
    this.updateCommandBarVisibility();
    this.updateStickyOffsets();
  }

  cacheElements() {
    this.els = {
      load: document.getElementById('loadBtn'),
      list: document.getElementById('list'),
      search: document.getElementById('search'),
      sortDropdown: document.getElementById('sortDropdown'),
      sortToggle: document.getElementById('sortToggle'),
      sortMenu: document.getElementById('sortMenu'),
      sortLabel: document.getElementById('sortLabel'),
      clearSearch: document.getElementById('clearSearch'),
      newBtn: document.getElementById('newBtn'),
      currentId: document.getElementById('currentId'),
      jsonStatus: document.getElementById('jsonStatus'),
      localeSwitcher: document.getElementById('localeSwitcher'),
      saveBtn: document.getElementById('saveBtn'),
      promptBtn: document.getElementById('promptBtn'),
      promptImgBtn: document.getElementById('promptImgBtn'),
      viewForm: document.getElementById('viewForm'),
      viewJson: document.getElementById('viewJson'),
      builder: document.getElementById('builder'),
      editorWrap: document.getElementById('jsonWrap'),
      editor: document.getElementById('editor'),
      clearJsonBtn: document.getElementById('clearJsonBtn'),
      main: document.querySelector('main'),
      fName: document.getElementById('fName'),
      fImage: document.getElementById('fImage'),
      fDescription: document.getElementById('fDescription'),
      fWeightType: document.getElementById('fWeightType'),
      fCategory: document.getElementById('fCategory'),
      fExperience: document.getElementById('fExperience'),
      fForceType: document.getElementById('fForceType'),
      fId: document.getElementById('fId'),
      equipTokens: document.getElementById('equipTokens'),
      equipSingle: document.getElementById('equipSingle'),
      equipAdd: document.getElementById('equipAdd'),
      equipClear: document.getElementById('equipClear'),
      bundles: document.getElementById('bundles'),
      muscleSelect: document.getElementById('muscleSelect'),
      percentInput: document.getElementById('percentInput'),
      bundleAdd: document.getElementById('bundleAdd'),
      bundleSumInfo: document.getElementById('bundleSumInfo'),
      itemTemplate: document.querySelector('#itemTemplate'),
      loginOverlay: document.getElementById('loginOverlay'),
      loginForm: document.getElementById('loginForm'),
      loginEmail: document.getElementById('loginEmail'),
      loginPassword: document.getElementById('loginPassword'),
      loginError: document.getElementById('loginError'),
      logoutBtn: document.getElementById('logoutBtn'),
      commandBar: document.getElementById('commandBar'),
      exerciseView: document.getElementById('exerciseView'),
      generalView: document.getElementById('generalView'),
      tabExercise: document.getElementById('tabExercise'),
      tabGeneral: document.getElementById('tabGeneral'),
      previewImg: document.getElementById('exercisePreview'),
      previewCard: document.getElementById('exercisePreviewCard'),
      previewEmpty: document.getElementById('exercisePreviewEmpty'),
      previewFrame: document.getElementById('previewFrame'),
      lightbox: document.getElementById('imageLightbox'),
      lightboxImg: document.getElementById('lightboxImage'),
      lightboxClose: document.getElementById('lightboxClose')
    };

    this.localeButtons = Array.from(this.els.localeSwitcher?.querySelectorAll('[data-locale]') || []);
    this.defaultNamePlaceholder = this.els.fName?.getAttribute('placeholder') || '';
    this.defaultDescriptionPlaceholder = this.els.fDescription?.getAttribute('placeholder') || '';
    if (this.els.previewImg) {
      this.els.previewImg.addEventListener('error', () => this.renderImagePreview(''));
    }
  }

  loadPersistedState() {
    this.activeLocale = this.storage.getLocale();
    this.viewMode = this.storage.getViewMode();
    this.editedIds = this.storage.loadEditedSet();

    if (this.api.authToken) {
      this.hideLoginOverlay();
    } else {
      this.showLoginOverlay();
    }
  }

  attachEventHandlers() {
    this.attachSortHandlers();
    this.attachSidebarHandlers();
    this.attachLocaleHandlers();
    this.attachViewHandlers();
    this.attachPreviewHandlers();
    this.attachFormHandlers();
    this.attachAuthHandlers();
    this.attachBundleHandlers();
    this.attachEquipmentHandlers();
    this.attachJsonHandlers();

    window.addEventListener('resize', () => {
      this.updateStickyOffsets();
      this.closeSortMenu();
    });
  }

  attachSidebarHandlers() {
    this.els.load?.addEventListener('click', () => this.loadList());
    this.els.newBtn?.addEventListener('click', () => this.newItem());
    this.els.search?.addEventListener('input', () => this.applySearch());
    this.els.clearSearch?.addEventListener('click', () => {
      if (!this.els.search) return;
      this.els.search.value = '';
      this.applySearch();
    });
    document.addEventListener('click', (evt) => {
      if (!this.els.sortDropdown) return;
      if (this.els.sortDropdown.contains(evt.target)) return;
      this.closeSortMenu();
    });
    document.addEventListener('keydown', (evt) => {
      if (evt.key === 'Escape') this.closeSortMenu();
    });
    document.addEventListener('focusin', (evt) => {
      if (!this.els.sortDropdown) return;
      if (!this.els.sortDropdown.classList.contains('open')) return;
      if (this.els.sortDropdown.contains(evt.target)) return;
      this.closeSortMenu();
    });
    const commandBar = document.getElementById('commandBar');
    if (commandBar) {
      const handler = () => this.positionSortMenu();
      try {
        commandBar.addEventListener('scroll', handler, { passive: true });
      } catch {
        commandBar.addEventListener('scroll', handler);
      }
    }
  }

  attachPrimaryNavHandlers() {
    [this.els.tabExercise, this.els.tabGeneral]
      .filter(Boolean)
      .forEach((btn) => {
        btn.addEventListener('click', () => {
          const target = btn.dataset.section;
          this.setActiveSection(target);
        });
      });
  }

  attachSortHandlers() {
    this.els.sortToggle?.addEventListener('click', (event) => {
      event.preventDefault();
      this.toggleSortMenu();
    });
    this.els.sortMenu?.querySelectorAll('.dropdown-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-sort');
        if (this.sortManager.setSort(key)) {
          this.updateSortUI();
          this.renderList();
        }
        this.closeSortMenu();
      });
    });
    this.updateSortUI();
  }

  attachLocaleHandlers() {
    this.localeButtons.forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        const lang = btn.dataset.locale;
        if (!lang) return;
        this.setActiveLocale(lang).catch((err) => console.error(err));
      });
    });
  }

  attachViewHandlers() {
    this.els.viewForm?.addEventListener('click', () => this.setViewForm());
    this.els.viewJson?.addEventListener('click', () => this.setViewJson());
  }

  attachPreviewHandlers() {
    this.els.previewFrame?.addEventListener('click', () => this.openImageLightbox());
    this.els.lightboxClose?.addEventListener('click', () => this.closeImageLightbox());
    this.els.lightbox?.addEventListener('click', (event) => {
      if (event.target === this.els.lightbox) this.closeImageLightbox();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.closeImageLightbox();
    });
  }

  attachFormHandlers() {
    [this.els.fName, this.els.fImage, this.els.fDescription]
      .filter(Boolean)
      .forEach((input) => input.addEventListener('input', () => {
        this.setEntity(this.readFormToEntity(this.getEntity()));
      }));

    [this.els.fWeightType, this.els.fCategory, this.els.fExperience, this.els.fForceType]
      .filter(Boolean)
      .forEach((select) => select.addEventListener('change', () => {
        this.setEntity(this.readFormToEntity(this.getEntity()));
      }));

    this.els.saveBtn?.addEventListener('click', () => this.saveCurrent());
    this.els.promptBtn?.addEventListener('click', () => this.copyPrompt());
    this.els.promptImgBtn?.addEventListener('click', () => this.copyImagePrompt());
  }

  attachAuthHandlers() {
    this.els.logoutBtn?.addEventListener('click', () => {
      this.logout();
      toast({ title: 'Logged out' });
    });

    this.els.loginForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const email = this.els.loginEmail?.value.trim();
      const password = this.els.loginPassword?.value || '';
      if (this.els.loginError) {
        this.els.loginError.textContent = '';
        this.els.loginError.style.display = 'none';
      }
      try {
        const data = await this.api.login({ email, password });
        this.api.setAuthToken(data.accessToken || '');
        this.storage.setRefreshToken(data.refreshToken || '');
        this.hideLoginOverlay();
        toast({ title: 'Logged in' });
      } catch (error) {
        if (this.els.loginError) {
          this.els.loginError.textContent = String(error.message || error);
          this.els.loginError.style.display = 'block';
        }
        toast({ title: 'Login failed', message: String(error.message || error), type: 'error' });
      }
    });
  }

  attachEquipmentHandlers() {
    this.els.equipAdd?.addEventListener('click', () => this.addSingleEquipment());
    this.els.equipClear?.addEventListener('click', () => {
      const entity = this.getEntity();
      entity[FIELD.equipmentRefs] = [];
      this.setEntity(entity);
    });
  }

  attachBundleHandlers() {
    this.els.bundleAdd?.addEventListener('click', () => this.addBundleFromInputs());
    this.els.percentInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.addBundleFromInputs();
      }
    });
  }

  attachJsonHandlers() {
    this.els.editor?.addEventListener('input', () => {
      const raw = this.els.editor.value;
      if (!raw.trim()) {
        this.setStatus('warn', 'Waiting for JSON');
        if (this.els.saveBtn) this.els.saveBtn.disabled = true;
        return;
      }
      try {
        const obj = JSON.parse(raw);
        this.canonical = EntityToolkit.normalizeEntityShape(obj, {
          locale: this.activeLocale,
          previous: this.canonical
        });
        this.writeEntityToForm(this.canonical);
        this.validateAll();
      } catch {
        this.setStatus('bad', 'Invalid JSON');
        if (this.els.saveBtn) this.els.saveBtn.disabled = true;
      }
    });

    this.els.clearJsonBtn?.addEventListener('click', () => {
      if (!this.els.editor) return;
      this.els.editor.value = '';
      this.els.editor.dispatchEvent(new Event('input'));
    });
  }

  showLoginOverlay() {
    if (this.els.loginOverlay) this.els.loginOverlay.style.display = 'flex';
  }

  hideLoginOverlay() {
    if (this.els.loginOverlay) this.els.loginOverlay.style.display = 'none';
  }

  requireAuth() {
    if (this.api.authToken) return true;
    toast({ title: 'Login required', message: 'Please sign in first.', type: 'error', ms: 3500 });
    this.showLoginOverlay();
    return false;
  }

  logout() {
    this.api.clearAuthToken();
    this.showLoginOverlay();
  }

  setActiveSection(section) {
    if (!section || section === this.activeSection) return;
    this.activeSection = section;
    this.updatePrimarySectionVisibility();
    this.updateStickyOffsets();
    if (section === 'exercise') this.updateCommandBarVisibility();
  }

  updatePrimarySectionVisibility() {
    const showExercise = this.activeSection !== 'general';
    const showGeneral = this.activeSection === 'general';
    this.toggleElement(this.els.commandBar, showExercise);
    if (this.els.commandBar) this.els.commandBar.hidden = !showExercise;
    if (this.els.exerciseView) {
      this.els.exerciseView.hidden = !showExercise;
      this.els.exerciseView.classList.toggle('active', showExercise);
    }
    if (this.els.generalView) {
      this.els.generalView.hidden = !showGeneral;
      this.els.generalView.classList.toggle('active', showGeneral);
    }
    if (this.els.tabExercise) {
      this.els.tabExercise.classList.toggle('active', showExercise);
      this.els.tabExercise.setAttribute('aria-selected', String(showExercise));
    }
    if (this.els.tabGeneral) {
      this.els.tabGeneral.classList.toggle('active', showGeneral);
      this.els.tabGeneral.setAttribute('aria-selected', String(showGeneral));
    }
  }

  updateStickyOffsets() {
    const header = document.querySelector('header');
    const bar = document.getElementById('commandBar');
    const h = header ? header.offsetHeight : 64;
    const b = bar ? bar.offsetHeight : 56;
    document.documentElement.style.setProperty('--header-h', `${h}px`);
    document.documentElement.style.setProperty('--commandbar-h', `${b}px`);
  }

  updateLocaleUI() {
    if (!this.els.localeSwitcher) return;
    this.els.localeSwitcher.setAttribute('data-active-locale', this.activeLocale);
    this.localeButtons.forEach((btn) => {
      const lang = btn?.dataset?.locale;
      if (!lang) return;
      const isActive = lang === this.activeLocale;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', String(isActive));
      btn.disabled = isActive;
    });
  }

  async setActiveLocale(lang) {
    if (!SUPPORTED_LANGUAGES.includes(lang)) return;
    const snapshot = this.readFormToEntity(this.getEntity());
    this.activeLocale = lang;
    this.storage.setLocale(lang);
    this.updateLocaleUI();
    this.setEntity(snapshot);
    this.updateCommandBarVisibility();
  }

  applyViewMode() {
    if (this.viewMode === 'json') this.setViewJson();
    else this.setViewForm();
  }

  persistViewMode() {
    this.storage.setViewMode(this.viewMode);
  }
  setViewForm() {
    this.viewMode = 'form';
    this.persistViewMode();
    this.els.viewForm?.classList.add('active');
    this.els.viewJson?.classList.remove('active');
    this.els.builder?.classList.add('show');
    if (this.els.editorWrap) this.els.editorWrap.hidden = true;
    document.body.classList.add('hide-json-controls');
    this.updateCommandBarVisibility();
  }

  setViewJson() {
    this.viewMode = 'json';
    this.persistViewMode();
    this.els.viewJson?.classList.add('active');
    this.els.viewForm?.classList.remove('active');
    this.els.builder?.classList.remove('show');
    if (this.els.editorWrap) this.els.editorWrap.hidden = false;
    if (this.els.editor) this.els.editor.value = pretty(this.getEntity());
    document.body.classList.remove('hide-json-controls');
    this.updateCommandBarVisibility();
  }

  updateCommandBarVisibility() {
    const active = this.hasActiveItem();
    const viewToggle = document.querySelector('.view-toggle');
    this.toggleElement(this.els.promptBtn, active);
    this.toggleElement(this.els.promptImgBtn, active);
    this.toggleElement(this.els.saveBtn, active);
    this.toggleElement(viewToggle, active);
    this.toggleElement(this.els.jsonStatus, active);
    const showLocale = !!(this.current && this.current.entity && this.current.entity.id && !this.isNew);
    this.toggleElement(this.els.localeSwitcher, showLocale);

    if (!active) {
      this.els.builder?.classList.remove('show');
      if (this.els.editorWrap) this.els.editorWrap.hidden = true;
      document.body.classList.add('hide-json-controls');
    } else {
      const formActive = this.els.viewForm?.classList.contains('active');
      if (formActive) {
        this.els.builder?.classList.add('show');
        if (this.els.editorWrap) this.els.editorWrap.hidden = true;
        document.body.classList.add('hide-json-controls');
      } else {
        this.els.builder?.classList.remove('show');
        if (this.els.editorWrap) this.els.editorWrap.hidden = false;
        document.body.classList.remove('hide-json-controls');
      }
    }
  }

  hasActiveItem() {
    return this.isNew || !!(this.current && this.current.entity && this.current.entity.id);
  }

  toggleElement(el, show) {
    if (!el) return;
    el.style.display = show ? '' : 'none';
  }

  positionSortMenu() {
    if (!this.els.sortDropdown || !this.els.sortMenu || !this.els.sortToggle) return;
    if (!this.els.sortDropdown.classList.contains('open')) return;

    const menu = this.els.sortMenu;
    const toggleRect = this.els.sortToggle.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth || 0;
    const gutter = 12;
    const menuWidth = menu.offsetWidth;

    let left = toggleRect.right - menuWidth;
    if (left < gutter) left = gutter;
    if (left + menuWidth > viewportWidth - gutter) {
      left = Math.max(gutter, viewportWidth - gutter - menuWidth);
    }
    const top = toggleRect.bottom + 8;
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  openSortMenu() {
    if (!this.els.sortDropdown) return;
    this.els.sortDropdown.classList.add('open');
    this.els.sortToggle?.setAttribute('aria-expanded', 'true');
    this.positionSortMenu();
    if (this.els.sortMenu) {
      const active = this.els.sortMenu.querySelector(`[data-sort="${this.sortManager.currentSort}"]`);
      active?.focus();
    }
  }

  closeSortMenu() {
    if (!this.els.sortDropdown) return;
    if (!this.els.sortDropdown.classList.contains('open')) return;
    this.els.sortDropdown.classList.remove('open');
    if (this.els.sortToggle) {
      this.els.sortToggle.setAttribute('aria-expanded', 'false');
      if (this.els.sortDropdown.contains(document.activeElement)) {
        this.els.sortToggle.focus();
      }
    }
    if (this.els.sortMenu) {
      this.els.sortMenu.style.left = '';
      this.els.sortMenu.style.top = '';
    }
  }

  toggleSortMenu() {
    if (!this.els.sortDropdown) return;
    if (this.els.sortDropdown.classList.contains('open')) this.closeSortMenu();
    else this.openSortMenu();
  }

  updateSortUI() {
    const option = this.sortManager.getActiveOption();
    if (this.els.sortLabel) this.els.sortLabel.textContent = option.label;
    this.els.sortMenu?.querySelectorAll('[data-sort]').forEach((btn) => {
      const key = btn.getAttribute('data-sort');
      const active = key === this.sortManager.currentSort;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-checked', active ? 'true' : 'false');
    });
  }

  async loadList() {
    if (!this.requireAuth()) return;
    if (this.els.load) this.els.load.disabled = true;
    try {
      const data = await this.api.fetchList();
      if (!Array.isArray(data)) throw new Error('Unexpected response shape: expected an array');
      this.items = data.map((entry) => {
        const entity = entry?.entity ? { ...entry.entity } : {};
        if (entity && typeof entity.name === 'string') entity.localizedName = entity.name;
        if (entity && typeof entity.description === 'string') entity.localizedDescription = entity.description;
        return { ...entry, entity };
      });
      this.applySearch();
      toast({ title: 'Loaded', message: `Items: ${this.items.length}` });
    } catch (error) {
      toast({ title: 'Load failed', message: String(error.message || error), type: 'error', ms: 6000 });
      console.error(error);
    } finally {
      if (this.els.load) this.els.load.disabled = false;
    }
  }

  applySearch() {
    const query = (this.els.search?.value || '').trim().toLowerCase();
    this.filtered = !query
      ? [...this.items]
      : this.items.filter((item) => {
          const value = (item.entity?.localizedName || item.entity?.name || '').toLowerCase();
          return value.includes(query);
        });
    this.renderList();
  }

  renderList() {
    this.filtered = this.sortManager.apply(this.filtered);
    if (!this.els.list || !this.els.itemTemplate) return;
    this.els.list.innerHTML = '';
    const frag = document.createDocumentFragment();
    this.filtered.forEach((item) => {
      const node = this.els.itemTemplate.content.firstElementChild.cloneNode(true);
      const entity = item.entity;
      const displayName = entity?.localizedName || entity?.name || '(no name)';
      node.querySelector('.name').textContent = displayName;
      node.querySelector('.usage').textContent = `used ${item.usageCount ?? 0}`;
      node.querySelector('.lastUsed').textContent = item.lastUsed ? `last: ${formatIso(item.lastUsed)}` : 'last: —';
      const thumb = node.querySelector('.thumb');
      if (thumb) {
        if (entity?.imageUrl) {
          thumb.src = entity.imageUrl;
          thumb.alt = displayName || '';
          thumb.addEventListener('error', () => thumb.remove());
        } else {
          thumb.remove();
        }
      }
      if (this.isEdited(entity?.id)) {
        node.classList.add('edited');
        const meta = node.querySelector('.meta');
        if (meta) {
          const badge = document.createElement('span');
          badge.className = 'pill edited';
          badge.textContent = 'edited';
          meta.appendChild(badge);
        }
      }
      node.addEventListener('click', () => this.selectItem(item));
      node.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this.selectItem(item);
        }
      });
      if (this.current && this.current.entity?.id === entity?.id) node.classList.add('active');
      frag.appendChild(node);
    });
    this.els.list.appendChild(frag);
  }

  getEntity() {
    return {
      ...this.canonical,
      nameTranslations: EntityToolkit.ensureTranslationMap(this.canonical.nameTranslations),
      descriptionTranslations: EntityToolkit.ensureTranslationMap(this.canonical.descriptionTranslations)
    };
  }

  setEntity(entity) {
    this.canonical = {
      ...entity,
      nameTranslations: EntityToolkit.ensureTranslationMap(entity.nameTranslations),
      descriptionTranslations: EntityToolkit.ensureTranslationMap(entity.descriptionTranslations)
    };
    this.writeEntityToForm(this.canonical);
    if (this.els.editor) this.els.editor.value = pretty(this.canonical);
    this.validateAll();
  }

  readFormToEntity(entity) {
    const e = { ...entity };
    const locale = this.activeLocale;
    const nameValue = this.els.fName?.value.trim() || '';
    const descriptionValue = this.els.fDescription?.value.trim() || '';
    e.nameTranslations = EntityToolkit.ensureTranslationMap(e.nameTranslations);
    e.descriptionTranslations = EntityToolkit.ensureTranslationMap(e.descriptionTranslations);
    e.nameTranslations[locale] = nameValue;
    e.descriptionTranslations[locale] = descriptionValue;
    e.name = EntityToolkit.getTranslation(e.nameTranslations, DEFAULT_LANGUAGE);
    e.imageUrl = this.els.fImage?.value.trim() || '';
    e.description = EntityToolkit.getTranslation(e.descriptionTranslations, DEFAULT_LANGUAGE);
    e.weightType = this.els.fWeightType?.value || '';
    e.category = this.els.fCategory?.value || '';
    e.experience = this.els.fExperience?.value || '';
    e.forceType = this.els.fForceType?.value || '';
    return e;
  }

  writeEntityToForm(entity) {
    const locale = this.activeLocale;
    const nameTranslations = EntityToolkit.ensureTranslationMap(entity?.nameTranslations);
    const descTranslations = EntityToolkit.ensureTranslationMap(entity?.descriptionTranslations);
    const localeName = EntityToolkit.getTranslation(nameTranslations, locale);
    const localeDescription = EntityToolkit.getTranslation(descTranslations, locale);
    const defaultName = EntityToolkit.getTranslation(nameTranslations, DEFAULT_LANGUAGE) || entity?.name || '';
    const defaultDescription = EntityToolkit.getTranslation(descTranslations, DEFAULT_LANGUAGE) || entity?.description || '';

    if (this.els.fId) this.els.fId.value = entity?.id || '';
    if (this.els.fName) {
      this.els.fName.value = localeName;
      this.els.fName.placeholder = EntityToolkit.buildLocalePlaceholder(
        this.defaultNamePlaceholder,
        defaultName,
        locale
      );
    }
    if (this.els.fImage) this.els.fImage.value = entity?.imageUrl || '';
    this.renderImagePreview(entity?.imageUrl || '');
    if (this.els.fDescription) {
      this.els.fDescription.value = localeDescription;
      this.els.fDescription.placeholder = EntityToolkit.buildLocalePlaceholder(
        this.defaultDescriptionPlaceholder,
        defaultDescription,
        locale
      );
    }
    if (this.els.fWeightType) this.els.fWeightType.value = entity?.weightType || '';
    if (this.els.fCategory) this.els.fCategory.value = entity?.category || '';
    if (this.els.fExperience) this.els.fExperience.value = entity?.experience || '';
    if (this.els.fForceType) this.els.fForceType.value = entity?.forceType || '';
    this.renderEquipmentTokens(entity);
    this.renderBundles(entity);
  }

  renderImagePreview(url) {
    if (!this.els.previewCard) return;
    const hasImage = !!url;
    const altName = (this.els.fName?.value || this.canonical?.name || 'Exercise').trim();
    if (this.els.previewImg) {
      if (hasImage) {
        this.els.previewImg.src = url;
        this.els.previewImg.alt = `${altName || 'Exercise'} illustration`;
      } else {
        this.els.previewImg.removeAttribute('src');
        this.els.previewImg.alt = 'Exercise image preview';
      }
    }
    if (this.els.previewEmpty) {
      this.els.previewEmpty.textContent = 'No image selected yet';
    }
    this.els.previewCard.classList.toggle('has-image', hasImage);
    if (this.els.previewFrame) {
      this.els.previewFrame.setAttribute('aria-disabled', hasImage ? 'false' : 'true');
    }
  }

  openImageLightbox() {
    const src = this.els.previewImg?.getAttribute('src');
    if (!src || !this.els.previewCard?.classList.contains('has-image')) return;
    if (this.els.lightboxImg) {
      this.els.lightboxImg.src = src;
      this.els.lightboxImg.alt = this.els.previewImg?.alt || 'Exercise image preview';
    }
    if (this.els.lightbox) {
      this.els.lightbox.removeAttribute('hidden');
    }
  }

  closeImageLightbox() {
    if (this.els.lightbox) {
      this.els.lightbox.setAttribute('hidden', 'hidden');
    }
    if (this.els.lightboxImg) {
      this.els.lightboxImg.removeAttribute('src');
    }
  }

  renderEquipmentTokens(entity) {
    if (!this.els.equipTokens) return;
    const eq = Array.isArray(entity[FIELD.equipmentRefs]) ? entity[FIELD.equipmentRefs] : [];
    this.els.equipTokens.innerHTML = '';
    const frag = document.createDocumentFragment();
    eq.forEach((obj, index) => {
      const id = String(obj?.equipmentId || '');
      const name = this.dictionaries.getEquipmentName(id) || id;
      const token = document.createElement('span');
      token.className = 'token';
      if (!this.dictionaries.equipment.has(id)) token.classList.add('invalid');
      token.innerHTML = `<span>${name}</span>`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = '×';
      btn.title = 'Remove';
      btn.addEventListener('click', () => {
        const ent = this.getEntity();
        const arr = ent[FIELD.equipmentRefs] || [];
        arr.splice(index, 1);
        ent[FIELD.equipmentRefs] = arr;
        this.setEntity(ent);
      });
      token.appendChild(btn);
      frag.appendChild(token);
    });
    this.els.equipTokens.appendChild(frag);
  }

  addSingleEquipment() {
    const id = this.els.equipSingle?.value;
    if (!id) {
      toast({ title: 'Select equipment', type: 'error' });
      return;
    }
    if (!this.dictionaries.equipment.has(id)) {
      toast({ title: 'Unknown equipment', type: 'error' });
      return;
    }
    const ent = this.getEntity();
    if (!Array.isArray(ent[FIELD.equipmentRefs])) ent[FIELD.equipmentRefs] = [];
    if (!ent[FIELD.equipmentRefs].some((x) => x.equipmentId === id)) {
      ent[FIELD.equipmentRefs].push({ equipmentId: id });
    }
    this.setEntity(ent);
  }

  renderBundles(entity) {
    if (!this.els.bundles) return;
    const arr = Array.isArray(entity[FIELD.bundles]) ? entity[FIELD.bundles] : [];
    this.els.bundles.innerHTML = '';
    const frag = document.createDocumentFragment();
    let sum = 0;

    arr.forEach((bundle, index) => {
      const row = document.createElement('div');
      row.className = 'bundle-row';

      const muscle = document.createElement('select');
      for (const [id, name] of this.dictionaries.muscles.entries()) {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = `${name} — ${id}`;
        if (String(bundle?.muscleId || '') === id) opt.selected = true;
        muscle.appendChild(opt);
      }
      if (!this.dictionaries.muscles.has(String(bundle?.muscleId || ''))) {
        muscle.classList.add('invalid');
      }

      const percent = document.createElement('input');
      percent.type = 'number';
      percent.min = '0';
      percent.max = '100';
      percent.step = '1';
      percent.placeholder = '%';
      const value = Number(bundle?.percentage ?? 0);
      percent.value = String(value);
      if (!isFinite(value) || value < 0 || value > 100) percent.classList.add('invalid');
      sum += isFinite(value) ? value : 0;

      const remove = document.createElement('button');
      remove.className = 'btn muted';
      remove.type = 'button';
      remove.textContent = 'Remove';

      muscle.addEventListener('change', () => {
        const ent = this.getEntity();
        ent[FIELD.bundles][index].muscleId = muscle.value;
        this.setEntity(ent);
      });
      percent.addEventListener('change', () => {
        const ent = this.getEntity();
        ent[FIELD.bundles][index].percentage = Number(percent.value || 0);
        this.setEntity(ent);
      });
      remove.addEventListener('click', () => {
        const ent = this.getEntity();
        ent[FIELD.bundles].splice(index, 1);
        this.setEntity(ent);
      });

      row.appendChild(muscle);
      row.appendChild(percent);
      row.appendChild(remove);
      frag.appendChild(row);
    });

    this.els.bundles.appendChild(frag);
    if (this.els.bundleSumInfo) {
      this.els.bundleSumInfo.textContent = `Sum: ${sum}%`;
      this.els.bundleSumInfo.className = `sum ${sum === 100 ? 'ok' : 'bad'}`;
    }
  }

  addBundleFromInputs() {
    const muscleId = this.els.muscleSelect?.value;
    const percentage = Number(this.els.percentInput?.value || 0);
    if (!muscleId || !isFinite(percentage)) {
      toast({ title: 'Select muscle and %', type: 'error' });
      return;
    }
    if (!this.dictionaries.muscles.has(muscleId)) {
      toast({ title: 'Unknown muscle', type: 'error' });
      return;
    }
    const ent = this.getEntity();
    if (!Array.isArray(ent[FIELD.bundles])) ent[FIELD.bundles] = [];
    ent[FIELD.bundles].push({ muscleId, percentage });
    this.setEntity(ent);
    if (this.els.percentInput) this.els.percentInput.value = '';
  }
  refreshOptionLists() {
    if (this.els.equipSingle) {
      this.els.equipSingle.innerHTML = '';
      for (const [id, name] of this.dictionaries.equipment.entries()) {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = `${name} — ${id}`;
        this.els.equipSingle.appendChild(opt);
      }
    }
    if (this.els.muscleSelect) {
      this.els.muscleSelect.innerHTML = '';
      for (const [id, name] of this.dictionaries.muscles.entries()) {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = `${name} — ${id}`;
        this.els.muscleSelect.appendChild(opt);
      }
    }
  }

  async selectItem(item) {
    if (!item || !item.entity) return;
    const id = String(item.entity.id || '').trim();
    if (!id) {
      toast({ title: 'Missing ID', type: 'error' });
      return;
    }

    const prevCurrent = this.current;
    const prevEntitySnapshot = this.getEntity();
    const prevIsNew = this.isNew;
    const prevIdText = this.els.currentId?.textContent;
    const prevId = prevCurrent?.entity?.id;
    const nextId = item?.entity?.id;
    const isSameItem = prevId && nextId && String(prevId) === String(nextId);

    this.isNew = false;
    this.current = item;
    this.renderList();
    this.updateCommandBarVisibility();

    const previousEntity = isSameItem ? prevEntitySnapshot : null;
    if (this.els.currentId) this.els.currentId.textContent = `Loading ID: ${id}…`;

    try {
      const cachedLocales = item?.locales;
      const hasCachedLocales = cachedLocales && SUPPORTED_LANGUAGES.every((lang) => cachedLocales[lang]);
      const responses = hasCachedLocales
        ? SUPPORTED_LANGUAGES.map((lang) => ({ lang, detail: cachedLocales[lang] }))
        : await Promise.all(
            SUPPORTED_LANGUAGES.map(async (lang) => ({
              lang,
              detail: await this.fetchExerciseExampleById(id, lang)
            }))
          );

      let mergedEntity = null;
      let baseDetail = null;
      const localesCache = {};
      for (const { lang, detail } of responses) {
        localesCache[lang] = detail;
        if (!baseDetail) baseDetail = detail;
        const remoteEntity = detail?.entity || {};
        const normalized = EntityToolkit.normalizeEntityShape(remoteEntity, {
          locale: lang,
          previous: mergedEntity || previousEntity
        });
        const fallbackName = typeof remoteEntity.name === 'string' ? remoteEntity.name : '';
        const fallbackDescription = typeof remoteEntity.description === 'string' ? remoteEntity.description : '';
        if (fallbackName && !normalized.nameTranslations[lang]) {
          normalized.nameTranslations[lang] = fallbackName;
        }
        if (fallbackDescription && !normalized.descriptionTranslations[lang]) {
          normalized.descriptionTranslations[lang] = fallbackDescription;
        }
        mergedEntity = EntityToolkit.mergeLocalizedEntity(mergedEntity, normalized);
      }

      if (!mergedEntity) throw new Error('No exercise data received');
      if (!mergedEntity.id) mergedEntity.id = id;

      const enrichedDetail = {
        ...baseDetail,
        entity: {
          ...mergedEntity,
          locales: localesCache
        }
      };

      this.current = {
        ...item,
        ...enrichedDetail,
        entity: mergedEntity,
        locales: localesCache
      };

      this.setEntity(mergedEntity);
      if (this.els.currentId) this.els.currentId.textContent = `Editing ID: ${mergedEntity.id}`;
      this.isNew = false;
      this.current.locales = localesCache;
      this.updateCommandBarVisibility();

      const idx = this.items.findIndex((entry) => String(entry?.entity?.id || '') === id);
      if (idx >= 0) {
        this.items[idx] = {
          ...enrichedDetail,
          entity: { ...mergedEntity }
        };
      }
      const filteredIdx = this.filtered.findIndex((entry) => String(entry?.entity?.id || '') === id);
      if (filteredIdx >= 0) {
        this.filtered[filteredIdx] = {
          ...enrichedDetail,
          entity: { ...mergedEntity }
        };
      }
      this.renderList();
    } catch (error) {
      console.error(error);
      toast({ title: 'Failed to load item', message: String(error.message || error), type: 'error' });
      this.current = prevCurrent;
      this.isNew = prevIsNew;
      this.setEntity(prevEntitySnapshot);
      if (this.els.currentId) this.els.currentId.textContent = prevIdText || 'No item selected';
      this.updateLocaleUI();
      this.renderList();
    } finally {
      this.updateCommandBarVisibility();
    }
  }

  newItem() {
    this.current = null;
    this.isNew = true;
    this.canonical = EntityToolkit.emptyTemplate();
    if (this.els.currentId) this.els.currentId.textContent = 'Creating new item (ID will be assigned on save)';
    this.writeEntityToForm(this.canonical);
    if (this.els.editor) this.els.editor.value = pretty(this.canonical);
    this.applyViewMode();
    this.validateAll();
    this.updateCommandBarVisibility();
  }

  async fetchExerciseExampleById(id, locale) {
    if (!this.requireAuth()) throw new Error('Not authenticated');
    return this.api.fetchDetail(id, locale);
  }

  async saveCurrent() {
    if (!this.requireAuth()) return;
    if (!this.els.saveBtn) return;
    this.els.saveBtn.disabled = true;
    try {
      const canonical = this.getEntity();
      const validation = this.validateAll();
      if (!validation.ok) {
        toast({ title: 'Validation failed', message: validation.errors[0] || 'Unknown error', type: 'error' });
        return;
      }

      const payload = EntityToolkit.buildPersistencePayload({ ...canonical });

      if (this.isNew) {
        delete payload.id;
        const resp = await this.api.createExercise(payload);
        const createdId = resp?.entity?.id || canonical.id;
        toast({ title: 'Created', message: `ID ${createdId}` });
        this.markEdited(createdId);
        this.isNew = false;
        await this.loadList();
        this.updateCommandBarVisibility();
      } else {
        const id = this.current?.entity?.id || canonical.id;
        if (!id) {
          toast({ title: 'Missing ID', type: 'error' });
          return;
        }
        delete payload.id;
        delete payload.createdAt;
        delete payload.updatedAt;
        await this.api.updateExercise(id, payload);
        toast({ title: 'Saved', message: `ID ${id} updated.` });
        this.markEdited(id);
        if (this.current) this.current.entity = { ...canonical, id };
        this.renderList();
      }
    } catch (error) {
      toast({ title: 'Save failed', message: String(error.message || error), type: 'error', ms: 7000 });
      console.error(error);
    } finally {
      this.els.saveBtn.disabled = false;
    }
  }

  validateAll() {
    const entity = this.getEntity();
    const result = this.validator.validate(entity);
    if (!result.ok) this.setStatus('bad', result.errors[0]);
    else if (result.warnings.length) this.setStatus('warn', result.warnings[0]);
    else this.setStatus('ok', 'Valid');
    if (this.els.saveBtn) this.els.saveBtn.disabled = !result.ok;
    if (this.els.editor && !this.els.editor.hasAttribute('hidden')) {
      this.els.editor.value = pretty(entity);
    }
    return result;
  }

  setStatus(kind, text) {
    if (!this.els.jsonStatus) return;
    this.els.jsonStatus.className = `status ${kind}`;
    this.els.jsonStatus.textContent = text;
  }

  markEdited(id, { skipPersist = false } = {}) {
    if (!id) return;
    this.editedIds.add(String(id));
    if (!skipPersist) this.storage.persistEditedSet(this.editedIds);
  }

  isEdited(id) {
    if (!id) return false;
    return this.editedIds.has(String(id));
  }

  buildGptPrompt() {
    const entity = this.getEntity();
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
    lines.push('    "name": string,');
    lines.push('    "description": string,');
    lines.push('    "weightType": "free"|"fixed"|"body_weight",');
    lines.push('    "category": "compound"|"isolation",');
    lines.push('    "experience": "beginner"|"intermediate"|"advanced"|"pro",');
    lines.push('    "forceType": "push"|"pull"|"hinge",');
    lines.push('    "imageUrl"?: string,');
    lines.push(`    "${FIELD.bundles}": [{ "muscleId": string, "percentage": number }],`);
    lines.push(`    "${FIELD.equipmentRefs}": [{ "equipmentId": string }]`);
    lines.push('  }');
    lines.push('- Do NOT include a field named "tutorials".');
    lines.push('- Do NOT change "id" if it is present.');
    lines.push(`- Sum of "${FIELD.bundles}[].percentage" MUST be exactly 100 (integers only).`);
    lines.push(`- "${FIELD.equipmentRefs}" MUST use VALID equipment IDs from the dictionary below (no unknown IDs).`);
    lines.push('- If there are duplicates of the same muscle/equipment, merge them (for muscles: sum, then re-normalize to 100).');
    lines.push('- Keep field names and types; do not add extra fields; do not remove required fields; respect enums.');
    lines.push('- Improve QUALITY of muscle distribution using NAME and DESCRIPTION AND your general domain knowledge (outside the provided data).');
    lines.push('- You MAY add/remove muscles if that leads to a more realistic split, but use only IDs from the provided dictionary.');
    lines.push('- You MAY refine "description" for clarity and utility; keep the same language as the input where possible and you MAY use "\\n" for new lines.');
    lines.push('- Ensure equipment list is relevant to the exercise; only use IDs from the equipment dictionary.');
    lines.push('');
    lines.push('Review focus:');
    lines.push('- Critically evaluate MUSCLE RATIOS based on exercise NAME and DESCRIPTION, and on general biomechanical knowledge (prime movers, synergists, stabilizers).');
    lines.push('- If distribution is unrealistic, adjust to plausible primary/secondary splits (still sum to 100).');
    lines.push('- Validate that chosen equipment matches typical execution for this exercise.');
    lines.push('');
    lines.push(`Name: ${entity.name || '(empty)'}`);
    lines.push(`Description: ${entity.description || '(empty)'}`);
    lines.push('');
    lines.push('Muscles dictionary (name — id):');
    for (const [id, name] of this.dictionaries.muscles.entries()) lines.push(`- ${name} — ${id}`);
    lines.push('');
    lines.push('Equipment dictionary (name — id):');
    for (const [id, name] of this.dictionaries.equipment.entries()) lines.push(`- ${name} — ${id}`);
    lines.push('');
    lines.push('Current JSON:');
    lines.push(pretty(entity));
    lines.push('');
    lines.push('OUTPUT FORMAT (repeat for clarity):');
    lines.push('```json');
    lines.push('{ ...final JSON... }');
    lines.push('```');
    lines.push('Пояснение: ... (на русском, перечисли ключевые изменения и логику на основе общих знаний и описания).');
    lines.push('Return NOTHING else beyond these two parts.');
    return lines.join('\n');
  }

  buildGptImagePrompt() {
    const entity = this.getEntity();
    const eqArr = Array.isArray(entity[FIELD.equipmentRefs]) ? entity[FIELD.equipmentRefs] : [];
    const eqNames = eqArr
      .map((x) => String(this.dictionaries.getEquipmentName(String(x?.equipmentId || '')) || '').trim())
      .filter(Boolean);
    const allowedEqForData = eqNames.length ? eqNames.join(', ') : 'без дополнительного оборудования';

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
    lines.push('\t• Accent — тонкий кант/пояс/шнурок; не делать большие заливки.');
    lines.push('\t• Использовать только перечисленные HEX; другие цвета запрещены.');
    lines.push('\t• Контраст акцента к базе ≥ 4.5:1.');
    lines.push('\t• No pure #FFFFFF/#000000.');
    lines.push('');
    lines.push('Style (fixed): clay/3D, matte, без бликов/шума/текста/логотипов.');
    lines.push('Манекен: андрогинный, без лица/волос/пор/вен.');
    lines.push('Пропорции: реалистичные — корректные плечи, торс, руки и ноги без деформаций.');
    lines.push('Окружение: минималистичная студия, нейтральный фон, без текста/логотипов/UI.');
    lines.push('');
    lines.push('Camera & Framing (hard):');
    lines.push('\t• View: 3/4 isometric, tilt from above ≈ 12°; eq. focal ≈ 40 mm; camera height ≈ chest level of mannequin.');
    lines.push('\t• Subject centered; mannequin + equipment occupy 70–80% of frame height.');
    lines.push('\t• Safe-margin: ≥ 7% от кадра по всем сторонам.');
    lines.push('\t• Для 900×900: ≥ 63 px со всех сторон.');
    lines.push('\t• Extra buffer поверх safe-margin вокруг объединённого bbox(man + gear): ≥ 11% по каждой оси (ориентир ~ 100 px при 900×900).');
    lines.push('\t• Hard rule: Entire silhouette and equipment must fit inside safe-margin. If violated → auto zoom-out until both safe-margin и buffer выполняются.');
    lines.push('\t• Ground plane visible; soft contact shadow under feet and rack/bench.');
    lines.push('');
    lines.push('Lighting (soft-matte): Key:Fill:Rim ≈ 1 : 0.5 : 0.2, key 35–45° сверху-сбоку; тени мягкие, лёгкий rim для отделения от фона.');
    lines.push('');
    lines.push(`Allowed equipment only: ${eqNames.length ? eqNames.join(', ') : '— без дополнительного оборудования'}. Никакого другого инвентаря.`);
    lines.push('');
    lines.push('Pose/Technique (mid-range rep):');
    lines.push('\t• 5-point setup: feet flat, glutes, upper back, head; лёгкий арч.');
    lines.push('\t• Scapulae retracted/depressed; wrist neutral stacked over elbows.');
    lines.push('\t• Elbows ≈45–70°; grip чуть шире плеч.');
    lines.push('\t• Bar path читаемо «J-curve»: кадр — середина амплитуды (бар ~ над нижней/серединной частью груди).');
    lines.push('\t• Neck нейтральная, взгляд вверх.');
    lines.push('\t• Траектории усилий читаемы.');
    lines.push('\t• Если Description задаёт pronated/neutral/supinated или ширину хвата — соблюсти.');
    lines.push('');
    lines.push('Restrictions (hard):');
    lines.push('\t• Нет лишних людей/зеркал/окон/декора.');
    lines.push('\t• Нет motion blur/шума/глянца/экстремальной перспективы.');
    lines.push('\t• Нет стрелок/оверлеев/водяных знаков/текста/логотипов.');
    lines.push('');
    lines.push('QC checklist (reject if fail):');
    lines.push('\t• 1:1 строго, 900×900, PNG sRGB, no alpha.');
    lines.push('\t• 1 mannequin only, equipment whitelist only.');
    lines.push('\t• Все цвета из списка; 1 accent ≤12%, контраст с #2E333B ≥ 4.5:1.');
    lines.push('\t• Ни одна часть тела/снаряда не пересекает safe-margin.');
    lines.push('\t• Equipment = списку.');
    lines.push('\t• Манекен корректный, без деформаций.');
    lines.push('');
    lines.push('Данные упражнения:');
    lines.push(`• Оборудование: ${allowedEqForData}`);
    lines.push(`• Описание: ${entity.description || '(пусто)'}`);
    return lines.join('\n');
  }

  async copyPrompt() {
    const prompt = this.buildGptPrompt();
    try {
      await navigator.clipboard.writeText(prompt);
      toast({ title: 'Prompt copied' });
    } catch {
      const ta = document.createElement('textarea');
      ta.value = prompt;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      toast({ title: 'Prompt copied' });
    }
  }

  async copyImagePrompt() {
    const prompt = this.buildGptImagePrompt();
    try {
      await navigator.clipboard.writeText(prompt);
      toast({ title: 'Image prompt copied' });
    } catch {
      const ta = document.createElement('textarea');
      ta.value = prompt;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      toast({ title: 'Image prompt copied' });
    }
  }
}

function patchFetchForHints(app) {
  const original = window.fetch;
  window.fetch = async (...args) => {
    try {
      const response = await original(...args);
      if (response.status === 401 || response.status === 403) {
        app.logout();
        const message = response.status === 401
          ? 'Authorization has expired. Please log in again.'
          : 'Session expired';
        toast({ title: 'Logged out', message, type: 'error' });
      }
      return response;
    } catch (error) {
      toast({
        title: 'Network error',
        message: 'If this runs on GitHub Pages, enable CORS on grippo-app.com for GET, POST, PUT and header Authorization.',
        type: 'error',
        ms: 8000
      });
      throw error;
    }
  };
}

const app = new GrippoAdminApp();
window.addEventListener('DOMContentLoaded', () => {
  app.init();
});
patchFetchForHints(app);

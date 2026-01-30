import { FIELD, SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE } from './constants.js';
import { StorageManager } from './storage.js';
import { ApiClient } from './api.js';
import { DictionaryStore } from './dictionaries.js';
import { SortManager } from './sort.js';
import { EntityToolkit } from './entity.js';
import { EntityValidator } from './validator.js';
import { toast, pretty, formatIso, compareStrings, toTimestamp } from './utils.js';

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
    this.userInfo = { id: '', profileId: '' };

    this.users = [];
    this.filteredUsers = [];
    this.activeUser = null;
    this.userSort = 'createdAt';
    this.userSortOptions = {
      createdAt: {
        label: 'Creation date',
        compare: (a, b) => this.compareUsersByCreatedAt(a, b)
      },
      lastActivity: {
        label: 'Last activity',
        compare: (a, b) => this.compareUsersByLastActivity(a, b)
      },
      workoutsCount: {
        label: 'Workouts count',
        compare: (a, b) => this.compareUsersByWorkoutsCount(a, b)
      },
      authType: {
        label: 'Auth type',
        compare: (a, b) => this.compareUsersByAuthType(a, b)
      },
      email: {
        label: 'Email',
        compare: (a, b) => this.compareUsersByEmail(a, b)
      }
    };
    this.roleChangeInFlight = false;
    this.confirmResolver = null;

    this.els = {};
    this.localeButtons = [];
    this.defaultNamePlaceholder = '';
    this.defaultDescriptionPlaceholder = '';
    this.bodyWeightMultiplier = 1;
  }

  getListName(item) {
    const translations = EntityToolkit.ensureTranslationMap(item?.entity?.nameTranslations);
    const english = EntityToolkit.getTranslation(translations, DEFAULT_LANGUAGE);
    if (english) return english;
    if (typeof item?.entity?.name === 'string') return item.entity.name;
    if (typeof item?.name === 'string') return item.name;
    return '';
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
      promptRulesBtn: document.getElementById('promptRulesBtn'),
      viewForm: document.getElementById('viewForm'),
      viewJson: document.getElementById('viewJson'),
      builder: document.getElementById('builder'),
      editorWrap: document.getElementById('jsonWrap'),
      editor: document.getElementById('editor'),
      clearJsonBtn: document.getElementById('clearJsonBtn'),
      main: document.querySelector('main'),
      introMain: document.querySelector('.intro-main'),
      fName: document.getElementById('fName'),
      fImage: document.getElementById('fImage'),
      fDescription: document.getElementById('fDescription'),
      fWeightType: document.getElementById('fWeightType'),
      fCategory: document.getElementById('fCategory'),
      fExperience: document.getElementById('fExperience'),
      fForceType: document.getElementById('fForceType'),
      fRulesExternalWeightEnabled: document.getElementById('fRulesExternalWeightEnabled'),
      fRulesExternalWeightRequired: document.getElementById('fRulesExternalWeightRequired'),
      fRulesBodyWeightEnabled: document.getElementById('fRulesBodyWeightEnabled'),
      fRulesBodyWeightMultiplier: document.getElementById('fRulesBodyWeightMultiplier'),
      fRulesBodyWeightMultiplierValue: document.getElementById('fRulesBodyWeightMultiplierValue'),
      fRulesExtraWeightEnabled: document.getElementById('fRulesExtraWeightEnabled'),
      fRulesExtraWeightRequired: document.getElementById('fRulesExtraWeightRequired'),
      fRulesAssistanceEnabled: document.getElementById('fRulesAssistanceEnabled'),
      fRulesAssistanceRequired: document.getElementById('fRulesAssistanceRequired'),
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
      userSelectionHint: document.getElementById('userSelectionHint'),
      commandBar: document.getElementById('commandBar'),
      usersCommandBar: document.getElementById('usersCommandBar'),
      exerciseView: document.getElementById('exerciseView'),
      usersView: document.getElementById('usersView'),
      tabExercise: document.getElementById('tabExercise'),
      tabUsers: document.getElementById('tabUsers'),
      previewImg: document.getElementById('exercisePreview'),
      previewCard: document.getElementById('exercisePreviewCard'),
      previewEmpty: document.getElementById('exercisePreviewEmpty'),
      previewFrame: document.getElementById('previewFrame'),
      previewLabel: document.querySelector('.preview-card .preview-label'),
      introRow: document.querySelector('.intro-row'),
      lightbox: document.getElementById('imageLightbox'),
      lightboxImg: document.getElementById('lightboxImage'),
      lightboxClose: document.getElementById('lightboxClose'),

      userList: document.getElementById('userList'),
      userSearch: document.getElementById('userSearch'),
      userSortDropdown: document.getElementById('userSortDropdown'),
      userSortToggle: document.getElementById('userSortToggle'),
      userSortMenu: document.getElementById('userSortMenu'),
      userSortLabel: document.getElementById('userSortLabel'),
      reloadUsersBtn: document.getElementById('reloadUsersBtn'),
      userDetail: document.getElementById('userDetail'),
      userName: document.getElementById('userName'),
      userEmail: document.getElementById('userEmail'),
      userIdField: document.getElementById('userIdField'),
      profileIdField: document.getElementById('profileIdField'),
      userAuthPill: document.getElementById('userAuthPill'),
      userAuthList: document.getElementById('userAuthList'),
      userCreated: document.getElementById('userCreated'),
      userUpdated: document.getElementById('userUpdated'),
      userLastActivity: document.getElementById('userLastActivity'),
      userWorkoutsCount: document.getElementById('userWorkoutsCount'),
      roleDefaultBtn: document.getElementById('roleDefaultBtn'),
      roleAdminBtn: document.getElementById('roleAdminBtn'),
      deleteUserBtn: document.getElementById('deleteUserBtn'),
      userItemTemplate: document.getElementById('userItemTemplate'),

      confirmOverlay: document.getElementById('confirmOverlay'),
      confirmTitle: document.getElementById('confirmTitle'),
      confirmMessage: document.getElementById('confirmMessage'),
      confirmDetail: document.getElementById('confirmDetail'),
      confirmAccept: document.getElementById('confirmAccept'),
      confirmCancel: document.getElementById('confirmCancel'),
      confirmClose: document.getElementById('confirmClose')
    };

    this.localeButtons = Array.from(this.els.localeSwitcher?.querySelectorAll('[data-locale]') || []);
    this.defaultNamePlaceholder = this.els.fName?.getAttribute('placeholder') || '';
    this.defaultDescriptionPlaceholder = this.els.fDescription?.getAttribute('placeholder') || '';
    if (this.els.previewImg) {
      this.els.previewImg.addEventListener('error', () => this.renderImagePreview(''));
    }
    this.initPreviewSizing();
  }

  loadPersistedState() {
    this.activeLocale = this.storage.getLocale();
    this.viewMode = this.storage.getViewMode();
    this.editedIds = this.storage.loadEditedSet();
    this.userInfo = this.storage.loadUserInfo();
    this.renderUserInfo();

    if (this.api.authToken) {
      this.hideLoginOverlay();
      this.refreshCurrentUser();
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
    this.attachUserSortHandlers();
    this.attachUserHandlers();

    window.addEventListener('resize', () => {
      this.updateStickyOffsets();
      this.closeSortMenu();
      this.closeUserSortMenu();
      this.positionUserSortMenu();
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
      if (!this.els.sortDropdown?.contains(evt.target)) this.closeSortMenu();
      if (!this.els.userSortDropdown?.contains(evt.target)) this.closeUserSortMenu();
    });
    document.addEventListener('keydown', (evt) => {
      if (evt.key === 'Escape') {
        this.closeSortMenu();
        this.closeUserSortMenu();
      }
    });
    document.addEventListener('focusin', (evt) => {
      const sortMenuOpen = this.els.sortDropdown?.classList.contains('open');
      const userSortOpen = this.els.userSortDropdown?.classList.contains('open');
      if (sortMenuOpen && !this.els.sortDropdown.contains(evt.target)) this.closeSortMenu();
      if (userSortOpen && !this.els.userSortDropdown.contains(evt.target)) this.closeUserSortMenu();
    });
    const commandBar = document.getElementById('commandBar');
    if (commandBar) {
      const handler = () => this.positionSortMenu();
      try {
        commandBar.addEventListener('scroll', handler, { passive: true });
      } catch (error) {
        commandBar.addEventListener('scroll', handler);
      }
    }
    const usersCommandBar = document.getElementById('usersCommandBar');
    if (usersCommandBar) {
      const handler = () => this.positionUserSortMenu();
      try {
        usersCommandBar.addEventListener('scroll', handler, { passive: true });
      } catch (error) {
        usersCommandBar.addEventListener('scroll', handler);
      }
    }
  }

  attachPrimaryNavHandlers() {
    [this.els.tabExercise, this.els.tabUsers]
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

    [
      this.els.fRulesExternalWeightEnabled,
      this.els.fRulesExternalWeightRequired,
      this.els.fRulesBodyWeightEnabled,
      this.els.fRulesExtraWeightEnabled,
      this.els.fRulesExtraWeightRequired,
      this.els.fRulesAssistanceEnabled,
      this.els.fRulesAssistanceRequired
    ]
      .filter(Boolean)
      .forEach((input) => input.addEventListener('change', (event) => {
        const id = event?.target?.id;
        const preferred = id === 'fRulesExternalWeightEnabled' ? 'external' : id === 'fRulesBodyWeightEnabled' ? 'body' : '';
        if (id === 'fRulesExtraWeightRequired' && this.els.fRulesExtraWeightEnabled) {
          this.els.fRulesExtraWeightEnabled.checked = true;
        }
        if (id === 'fRulesAssistanceRequired' && this.els.fRulesAssistanceEnabled) {
          this.els.fRulesAssistanceEnabled.checked = true;
        }
        if (id === 'fRulesExternalWeightRequired' && this.els.fRulesExternalWeightEnabled) {
          this.els.fRulesExternalWeightEnabled.checked = true;
        }
        this.updateRulesInputsVisibility(preferred);
        this.setEntity(this.readFormToEntity(this.getEntity()));
      }));

    this.els.fRulesBodyWeightMultiplier?.addEventListener('input', () => {
      const raw = this.els.fRulesBodyWeightMultiplier?.value;
      const value = Number(raw);
      if (Number.isFinite(value)) {
        this.bodyWeightMultiplier = value;
      }
      this.syncBodyWeightMultiplierLabel();
      this.setEntity(this.readFormToEntity(this.getEntity()));
    });

    this.els.saveBtn?.addEventListener('click', () => this.saveCurrent());
    this.els.promptBtn?.addEventListener('click', () => this.copyPrompt());
    this.els.promptImgBtn?.addEventListener('click', () => this.copyImagePrompt());
    this.els.promptRulesBtn?.addEventListener('click', () => this.copyRulesPrompt());
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
        const info = this.extractUserInfo(data);
        this.setUserInfo(info);
        if (!info.id) this.refreshCurrentUser();
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
      } catch (error) {
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

  attachUserSortHandlers() {
    this.els.userSortToggle?.addEventListener('click', (event) => {
      event.preventDefault();
      this.toggleUserSortMenu();
    });

    this.els.userSortMenu?.querySelectorAll('.dropdown-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-sort');
        if (this.setUserSort(key)) {
          this.updateUserSortUI();
          this.applyUserSearch({ preserveSelection: true, fallbackId: this.activeUser?.id || null });
        }
        this.closeUserSortMenu();
      });
    });

    this.updateUserSortUI();
  }

  attachUserHandlers() {
    this.els.reloadUsersBtn?.addEventListener('click', () => this.loadUsers());
    this.els.userSearch?.addEventListener('input', () => this.applyUserSearch());

    this.els.userList?.addEventListener('click', (event) => {
      const item = event.target.closest('[data-user-id]');
      if (!item) return;
      const id = item.dataset.userId;
      const user = this.users.find((u) => u.id === id);
      this.setActiveUser(user || null);
    });

    this.els.roleDefaultBtn?.addEventListener('click', () => this.handleRoleSegment('default'));
    this.els.roleAdminBtn?.addEventListener('click', () => this.handleRoleSegment('admin'));
    this.els.deleteUserBtn?.addEventListener('click', () => this.deleteActiveUser());

    this.els.confirmCancel?.addEventListener('click', () => this.finishConfirm(false));
    this.els.confirmClose?.addEventListener('click', () => this.finishConfirm(false));
    this.els.confirmAccept?.addEventListener('click', () => this.finishConfirm(true));
    this.els.confirmOverlay?.addEventListener('click', (event) => {
      if (event.target === this.els.confirmOverlay) this.finishConfirm(false);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.els.confirmOverlay && !this.els.confirmOverlay.hidden) {
        this.finishConfirm(false);
      }
    });
  }

  showLoginOverlay() {
    if (this.els.loginOverlay) this.els.loginOverlay.style.display = 'flex';
  }

  hideLoginOverlay() {
    if (this.els.loginOverlay) this.els.loginOverlay.style.display = 'none';
  }

  renderUserInfo(info = this.userInfo) {
    const userId = info?.id || '';
    const profileId = info?.profileId || '';
    if (this.els.userSelectionHint) {
      const hint = userId || profileId ? `Logged in as ${userId || '—'}` : 'No user selected';
      this.els.userSelectionHint.textContent = hint;
    }
  }

  setUserInfo(info = {}) {
    const next = {
      id: info?.id ? String(info.id) : '',
      profileId: info?.profileId ? String(info.profileId) : ''
    };
    this.userInfo = next;
    this.storage.setUserId(next.id);
    this.storage.setProfileId(next.profileId);
    this.renderUserInfo(next);
  }

  extractUserInfo(payload) {
    if (!payload) return { id: '', profileId: '' };
    const source = payload.user || payload;
    const profileId = source?.profileId || source?.profile?.id || '';
    return {
      id: source?.id ? String(source.id) : '',
      profileId: profileId ? String(profileId) : ''
    };
  }

  async refreshCurrentUser() {
    if (!this.api.authToken) return;
    try {
      const data = await this.api.fetchCurrentUser();
      this.setUserInfo(this.extractUserInfo(data));
    } catch (error) {
      console.error('Failed to load current user', error);
    }
  }

  requireAuth() {
    if (this.api.authToken) return true;
    toast({ title: 'Login required', message: 'Please sign in first.', type: 'error', ms: 3500 });
    this.showLoginOverlay();
    return false;
  }

  logout() {
    this.api.clearAuthToken();
    this.storage.clearUserInfo();
    this.setUserInfo({ id: '', profileId: '' });
    this.showLoginOverlay();
  }

  setActiveSection(section) {
    if (!section || section === this.activeSection) return;
    this.activeSection = section;
    this.updatePrimarySectionVisibility();
    this.updateStickyOffsets();
    if (section === 'exercise') this.updateCommandBarVisibility();
    if (section === 'users') {
      this.renderUserDetail();
      if (!this.users.length) this.loadUsers().catch((err) => console.error(err));
    }
  }

  updatePrimarySectionVisibility() {
    const showExercise = this.activeSection === 'exercise';
    const showUsers = this.activeSection === 'users';
    this.toggleElement(this.els.commandBar, showExercise);
    this.toggleElement(this.els.usersCommandBar, showUsers);
    if (this.els.commandBar) this.els.commandBar.hidden = !showExercise;
    if (this.els.usersCommandBar) this.els.usersCommandBar.hidden = !showUsers;
    if (this.els.exerciseView) {
      this.els.exerciseView.hidden = !showExercise;
      this.els.exerciseView.classList.toggle('active', showExercise);
    }
    if (this.els.usersView) {
      this.els.usersView.hidden = !showUsers;
      this.els.usersView.classList.toggle('active', showUsers);
    }
    if (this.els.tabExercise) {
      this.els.tabExercise.classList.toggle('active', showExercise);
      this.els.tabExercise.setAttribute('aria-selected', String(showExercise));
    }
    if (this.els.tabUsers) {
      this.els.tabUsers.classList.toggle('active', showUsers);
      this.els.tabUsers.setAttribute('aria-selected', String(showUsers));
    }
  }

  updateStickyOffsets() {
    const header = document.querySelector('header');
    const bar = (this.activeSection === 'users' ? this.els.usersCommandBar : this.els.commandBar) || document.getElementById('commandBar');
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
    this.toggleElement(this.els.promptRulesBtn, active);
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

  normalizeUser(user = {}) {
    const profileId = user?.profileId || user?.profile?.id || '';
    const profile = user?.profile || null;
    const name = user?.name || profile?.name || '';
    const authTypes = this.normalizeAuthTypes(user?.authTypes || (user?.authType ? [user.authType] : []));
    const lastActivity = user?.lastActivity ?? user?.last_activity ?? null;
    const workoutsCountRaw = user?.workoutsCount ?? user?.workouts_count ?? 0;
    const workoutsCount = Number.isFinite(workoutsCountRaw) ? workoutsCountRaw : Number(workoutsCountRaw) || 0;
    return { ...user, profileId, profile, name, authTypes, lastActivity, workoutsCount };
  }

  normalizeAuthTypes(authTypes = []) {
    if (!Array.isArray(authTypes)) return [];
    const cleaned = authTypes
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean);
    return Array.from(new Set(cleaned));
  }

  getUserAuthTypes(user) {
    if (!user) return [];
    if (Array.isArray(user.authTypes) && user.authTypes.length) {
      return this.normalizeAuthTypes(user.authTypes);
    }
    if (user.authType) {
      return this.normalizeAuthTypes([user.authType]);
    }
    return [];
  }

  getAuthIcon(authType) {
    const type = (authType || '').toLowerCase();
    if (type === 'google') {
      return {
        label: 'Google',
        svg:
          '<svg aria-hidden="true" viewBox="0 0 24 24" class="auth-icon auth-icon-google"><path class="g-blue" d="M23.49 12.27c0-.79-.07-1.54-.21-2.27H12v4.3h6.44c-.28 1.38-1.09 2.55-2.32 3.34v2.77h3.75c2.2-2.03 3.62-5.02 3.62-8.14z"></path><path class="g-green" d="M12 24c3.15 0 5.8-1.04 7.73-2.86l-3.75-2.77c-1.04.7-2.37 1.11-3.98 1.11-3.06 0-5.64-2.06-6.57-4.84H1.56v3.03C3.47 21.43 7.43 24 12 24z"></path><path class="g-yellow" d="M5.43 14.64c-.23-.7-.36-1.44-.36-2.21s.13-1.51.36-2.21V7.19H1.56A11.98 11.98 0 0 0 0 12.43c0 1.94.46 3.77 1.56 5.24l3.87-3.03z"></path><path class="g-red" d="M12 4.73c1.71 0 3.24.6 4.45 1.77l3.3-3.3C17.79 1.3 15.15 0 12 0 7.43 0 3.47 2.57 1.56 6.19l3.87 3.03C6.36 6.79 8.94 4.73 12 4.73z"></path></svg>'
      };
    }

    if (type === 'apple') {
      return {
        label: 'Apple',
        svg:
          '<svg aria-hidden="true" viewBox="0 0 24 24" class="auth-icon auth-icon-apple"><path d="M16.39 12.27c.03 2.75 2.41 3.66 2.44 3.68-.02.06-.38 1.33-1.27 2.63-.77 1.12-1.57 2.23-2.83 2.25-1.24.02-1.64-.73-3.06-.73-1.42 0-1.86.71-3.03.75-1.22.05-2.16-1.23-2.94-2.35-1.6-2.32-2.83-6.56-1.18-9.42.82-1.42 2.29-2.32 3.88-2.34 1.21-.02 2.35.82 3.06.82.71 0 2.05-1.01 3.46-.86.59.03 2.23.24 3.29 1.81-.09.06-1.96 1.14-1.94 3.76zm-2.28-6.65c.64-.78 1.07-1.88.95-2.98-.92.04-2.04.61-2.7 1.39-.59.68-1.1 1.78-.96 2.84 1.03.08 2.07-.52 2.71-1.25z"></path></svg>'
      };
    }

    const label = type === 'email' ? 'Email' : authType || 'Unknown';
    return {
      label,
      svg:
        '<svg aria-hidden="true" viewBox="0 0 24 24" class="auth-icon auth-icon-email"><path d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm0 2v.511l8 5.333 8-5.333V7H4zm16 10V9.489l-8 5.334-8-5.334V17h16z"></path></svg>'
    };
  }

  renderAuthIndicator(el, authTypes = []) {
    if (!el) return;
    const types = this.getUserAuthTypes({ authTypes });
    if (!types.length) {
      el.innerHTML = '<span class="auth-type-empty">—</span>';
      el.setAttribute('aria-label', 'No auth types');
      return;
    }

    el.innerHTML = types
      .map((authType) => {
        const { label, svg } = this.getAuthIcon(authType);
        return `<span class="auth-type-icon" title="${label}" aria-label="${label}">${svg}</span>`;
      })
      .join('');
    el.setAttribute('aria-label', `Auth types: ${types.join(', ')}`);
  }

  renderAuthTypeList(el, authTypes = []) {
    if (!el) return;
    const types = this.getUserAuthTypes({ authTypes });
    if (!types.length) {
      el.textContent = '—';
      return;
    }
    const labels = types.map((authType) => this.getAuthIcon(authType).label);
    el.textContent = labels.join(' · ');
  }

  getUserCreatedTimestamp(user) {
    return toTimestamp(
      user?.createdAt ?? user?.created_at ?? user?.profile?.createdAt ?? user?.profile?.created_at ?? 0
    );
  }

  getUserLastActivityTimestamp(user) {
    return toTimestamp(user?.lastActivity ?? user?.last_activity ?? 0);
  }

  getUserWorkoutsCount(user) {
    const count = user?.workoutsCount ?? user?.workouts_count ?? 0;
    if (typeof count === 'number' && Number.isFinite(count)) return count;
    return Number(count) || 0;
  }

  getUserAuthRank(user) {
    const rankForType = (authType) => {
      const type = (authType || '').toLowerCase();
      if (type === 'google') return 0;
      if (type === 'apple') return 1;
      if (type === 'email') return 2;
      return 3;
    };
    const types = this.getUserAuthTypes(user);
    if (!types.length) return 99;
    return Math.min(...types.map(rankForType));
  }

  compareUsersByCreatedAt(a, b) {
    const diff = this.getUserCreatedTimestamp(b) - this.getUserCreatedTimestamp(a);
    if (diff !== 0) return diff;
    return compareStrings(a?.email || a?.name || '', b?.email || b?.name || '');
  }

  compareUsersByLastActivity(a, b) {
    const diff = this.getUserLastActivityTimestamp(b) - this.getUserLastActivityTimestamp(a);
    if (diff !== 0) return diff;
    return this.compareUsersByCreatedAt(a, b);
  }

  compareUsersByWorkoutsCount(a, b) {
    const diff = this.getUserWorkoutsCount(b) - this.getUserWorkoutsCount(a);
    if (diff !== 0) return diff;
    return this.compareUsersByCreatedAt(a, b);
  }

  compareUsersByAuthType(a, b) {
    const diff = this.getUserAuthRank(a) - this.getUserAuthRank(b);
    if (diff !== 0) return diff;
    return this.compareUsersByCreatedAt(a, b);
  }

  compareUsersByEmail(a, b) {
    const cmp = compareStrings((a?.email || '').toLowerCase(), (b?.email || '').toLowerCase());
    if (cmp !== 0) return cmp;
    return this.compareUsersByCreatedAt(a, b);
  }

  sortUsers(users = []) {
    if (!Array.isArray(users)) return [];
    const sorter = this.userSortOptions[this.userSort]?.compare || ((a, b) => this.compareUsersByCreatedAt(a, b));
    const sorted = [...users];
    sorted.sort((a, b) => sorter(a, b));
    return sorted;
  }

  async loadUsers() {
    if (!this.requireAuth()) return;
    const btn = this.els.reloadUsersBtn;
    const prevLabel = btn?.textContent;
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Loading…';
    }
    const prevSelectedId = this.activeUser?.id || null;
    try {
      const users = await this.api.fetchUsers();
      this.users = Array.isArray(users) ? users.map((u) => this.normalizeUser(u)) : [];
      this.applyUserSearch({ preserveSelection: true, fallbackId: prevSelectedId });
    } catch (error) {
      console.error(error);
      toast({ title: 'Failed to load users', message: String(error.message || error), type: 'error' });
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = prevLabel || 'Reload';
      }
    }
  }

  applyUserSearch({ preserveSelection = false, fallbackId = null } = {}) {
    const term = (this.els.userSearch?.value || '').trim().toLowerCase();
    const needle = term && term.length > 1 ? term : term;
    const filtered = this.users.filter((user) => {
      if (!needle) return true;
      const name = (user.name || user.profile?.name || '').toLowerCase();
      const email = (user.email || '').toLowerCase();
      return name.includes(needle) || email.includes(needle);
    });

    this.filteredUsers = this.sortUsers(filtered);

    const targetId = preserveSelection ? (this.activeUser?.id || fallbackId) : null;
    this.renderUserList();

    if (this.filteredUsers.length === 0) {
      this.setActiveUser(null, { skipListRerender: true });
      return;
    }

    const preserved = targetId ? this.filteredUsers.find((u) => u.id === targetId) : null;
    this.setActiveUser(preserved || this.filteredUsers[0], { skipListRerender: true });
  }

  renderUserList() {
    if (!this.els.userList) return;
    this.els.userList.innerHTML = '';

    if (!this.filteredUsers.length) {
      const empty = document.createElement('div');
      empty.className = 'list-empty';
      empty.textContent = 'No users loaded yet';
      this.els.userList.appendChild(empty);
      return;
    }

    this.filteredUsers.forEach((user) => {
      const template = this.els.userItemTemplate?.content?.firstElementChild;
      const node = template ? template.cloneNode(true) : document.createElement('div');
      node.dataset.userId = user.id;
      node.classList.add('user-row');
      if (!template) node.textContent = `${user.name || user.email}`;

      const initial = (user.name || user.email || '?')[0]?.toUpperCase?.() || '?';
      const role = user.role || 'unknown';
      const nameEl = node.querySelector('.user-name');
      const emailEl = node.querySelector('.user-email');
      const roleEl = node.querySelector('.user-role');
      const authEl = node.querySelector('.user-auth');
      const badgeEl = node.querySelector('.user-badge');
      if (nameEl) nameEl.textContent = user.name || 'No name';
      if (emailEl) emailEl.textContent = user.email || 'No email';
      if (roleEl) {
        roleEl.textContent = role;
        roleEl.classList.toggle('pill-admin', role === 'admin');
      }
      this.renderAuthIndicator(authEl, user.authTypes);
      if (badgeEl) badgeEl.textContent = initial;
      node.classList.toggle('active', this.activeUser?.id === user.id);
      this.els.userList.appendChild(node);
    });
  }

  setActiveUser(user, { skipListRerender = false } = {}) {
    this.activeUser = user ? this.normalizeUser(user) : null;
    this.renderUserDetail();
    if (!skipListRerender) this.renderUserList();
  }

  renderUserDetail() {
    const hasUser = !!this.activeUser;
    if (this.els.userDetail) this.els.userDetail.hidden = !hasUser;

    if (!hasUser || !this.activeUser) {
      if (this.els.userName) this.els.userName.textContent = '';
      if (this.els.userEmail) this.els.userEmail.textContent = '';
      if (this.els.userIdField) this.els.userIdField.value = '';
      if (this.els.profileIdField) this.els.profileIdField.value = '';
      if (this.els.userAuthPill) this.els.userAuthPill.innerHTML = '';
      if (this.els.userAuthList) this.els.userAuthList.textContent = '';
      if (this.els.userCreated) this.els.userCreated.textContent = '—';
      if (this.els.userUpdated) this.els.userUpdated.textContent = '—';
      if (this.els.userLastActivity) this.els.userLastActivity.textContent = '—';
      if (this.els.userWorkoutsCount) this.els.userWorkoutsCount.textContent = '—';
      if (this.els.userSelectionHint) this.els.userSelectionHint.textContent = 'No user selected';
      this.updateUserActionsState();
      return;
    }

    const user = this.activeUser;
    const profileName = user.profile?.name || user.name || 'Unnamed user';
    const profileId = user.profileId || user.profile?.id || '';
    if (this.els.userName) this.els.userName.textContent = profileName;
    if (this.els.userEmail) this.els.userEmail.textContent = user.email || '—';
    if (this.els.userIdField) this.els.userIdField.value = user.id || '';
    if (this.els.profileIdField) this.els.profileIdField.value = profileId || '';
    if (this.els.userSelectionHint) this.els.userSelectionHint.textContent = `Selected: ${user.id || '—'}`;

    this.renderAuthIndicator(this.els.userAuthPill, user.authTypes);
    this.renderAuthTypeList(this.els.userAuthList, user.authTypes);

    if (this.els.userCreated) this.els.userCreated.textContent = formatIso(user.createdAt) || '—';
    if (this.els.userUpdated) this.els.userUpdated.textContent = formatIso(user.updatedAt) || '—';
    if (this.els.userLastActivity) {
      this.els.userLastActivity.textContent = user.lastActivity ? formatIso(user.lastActivity) : '—';
    }
    if (this.els.userWorkoutsCount) {
      this.els.userWorkoutsCount.textContent = String(this.getUserWorkoutsCount(user));
    }

    this.updateUserActionsState();
  }

  updateUserActionsState() {
    const hasUser = !!this.activeUser;
    const disableRole = !hasUser || this.roleChangeInFlight;
    if (this.els.roleDefaultBtn) this.els.roleDefaultBtn.disabled = disableRole;
    if (this.els.roleAdminBtn) this.els.roleAdminBtn.disabled = disableRole;
    if (this.els.deleteUserBtn) this.els.deleteUserBtn.disabled = !hasUser;
    if (!hasUser && this.els.userSelectionHint) this.els.userSelectionHint.textContent = 'No user selected';
    this.updateRoleSegmentUI();
  }

  handleRoleSegment(role) {
    if (!this.activeUser || this.roleChangeInFlight) return;
    if (this.activeUser.role === role) {
      this.updateRoleSegmentUI();
      return;
    }
    this.changeUserRole(role);
  }

  updateRoleSegmentUI() {
    if (!this.els.roleDefaultBtn || !this.els.roleAdminBtn) return;
    const role = this.activeUser?.role || 'default';
    const isAdmin = role === 'admin';
    this.els.roleDefaultBtn.classList.toggle('active', !isAdmin);
    this.els.roleAdminBtn.classList.toggle('active', isAdmin);
    this.els.roleDefaultBtn.setAttribute('aria-selected', String(!isAdmin));
    this.els.roleAdminBtn.setAttribute('aria-selected', String(isAdmin));
  }

  async changeUserRole(role) {
    if (!this.activeUser || !role) return;
    if (!this.requireAuth()) return;

    const targetId = this.activeUser.id;
    const adminBtn = this.els.roleAdminBtn;
    const defaultBtn = this.els.roleDefaultBtn;
    const targetBtn = role === 'admin' ? adminBtn : defaultBtn;
    const prevLabel = targetBtn?.textContent;

    this.roleChangeInFlight = true;
    if (adminBtn) adminBtn.disabled = true;
    if (defaultBtn) defaultBtn.disabled = true;
    if (targetBtn) targetBtn.textContent = 'Saving…';

    try {
      const updated = await this.api.setUserRole(targetId, role);
      this.updateUserCollections(updated);
      this.applyUserSearch({ preserveSelection: true, fallbackId: targetId });
      toast({ title: 'Role updated', message: `${updated.email} set to ${updated.role}` });
    } catch (error) {
      console.error(error);
      toast({ title: 'Failed to update role', message: String(error.message || error), type: 'error' });
    } finally {
      this.roleChangeInFlight = false;
      if (targetBtn) targetBtn.textContent = prevLabel || targetBtn.textContent;
      this.updateUserActionsState();
      this.renderUserList();
    }
  }

  async deleteActiveUser() {
    if (!this.activeUser) return;
    if (!this.requireAuth()) return;
    const userLabel = `${this.activeUser.name || 'User'} (${this.activeUser.email || 'no email'})`;
    const detail = `ID: ${this.activeUser.id || 'unknown'} · Role: ${this.activeUser.role || '—'}`;
    const confirmed = await this.showConfirm({
      title: 'Delete user?',
      message: `Удалить ${userLabel}? Действие нельзя отменить.`,
      detail,
      actionLabel: 'Delete user'
    });
    if (!confirmed) return;

    const btn = this.els.deleteUserBtn;
    const prev = btn?.textContent;
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Deleting…';
    }
    const targetId = this.activeUser.id;
    try {
      await this.api.deleteUser(targetId);
      this.users = this.users.filter((u) => u.id !== targetId);
      this.filteredUsers = this.filteredUsers.filter((u) => u.id !== targetId);
      toast({ title: 'User deleted', message: targetId, type: 'warn' });
      if (this.activeUser?.id === targetId) {
        this.setActiveUser(null, { skipListRerender: true });
      }
      this.applyUserSearch();
    } catch (error) {
      console.error(error);
      toast({ title: 'Delete failed', message: String(error.message || error), type: 'error' });
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = prev || 'Delete user';
      }
    }
  }

  updateUserCollections(updatedUser) {
    if (!updatedUser || !updatedUser.id) return;
    const normalised = this.normalizeUser(updatedUser);
    const mapper = (user) => (user.id === normalised.id ? { ...user, ...normalised } : user);
    this.users = this.users.map(mapper);
    this.filteredUsers = this.filteredUsers.map(mapper);
  }

  showConfirm({ title = 'Confirm action', message, detail, actionLabel = 'Confirm' } = {}) {
    if (!this.els.confirmOverlay || !this.els.confirmMessage || !this.els.confirmAccept) return Promise.resolve(false);
    if (this.els.confirmTitle) this.els.confirmTitle.textContent = title;
    this.els.confirmMessage.textContent = message || 'Are you sure?';
    if (this.els.confirmDetail) {
      if (detail) {
        this.els.confirmDetail.textContent = detail;
        this.els.confirmDetail.hidden = false;
      } else {
        this.els.confirmDetail.hidden = true;
        this.els.confirmDetail.textContent = '';
      }
    }
    this.els.confirmAccept.textContent = actionLabel;
    this.els.confirmOverlay.hidden = false;
    document.body.classList.add('modal-open');
    if (this.els.confirmAccept) this.els.confirmAccept.focus();
    return new Promise((resolve) => {
      this.confirmResolver = resolve;
    });
  }

  finishConfirm(result) {
    if (typeof this.confirmResolver === 'function') this.confirmResolver(result);
    this.confirmResolver = null;
    this.hideConfirm();
  }

  hideConfirm() {
    if (this.els.confirmOverlay) this.els.confirmOverlay.hidden = true;
    document.body.classList.remove('modal-open');
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

  setUserSort(key) {
    if (!this.userSortOptions[key]) return false;
    const changed = this.userSort !== key;
    this.userSort = key;
    return changed;
  }

  updateUserSortUI() {
    const option = this.userSortOptions[this.userSort] || this.userSortOptions.createdAt;
    if (this.els.userSortLabel) this.els.userSortLabel.textContent = option.label;
    this.els.userSortMenu?.querySelectorAll('[data-sort]').forEach((btn) => {
      const key = btn.getAttribute('data-sort');
      const active = key === this.userSort;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-checked', active ? 'true' : 'false');
    });
  }

  positionUserSortMenu() {
    if (!this.els.userSortMenu || !this.els.userSortToggle) return;
    const toggleRect = this.els.userSortToggle.getBoundingClientRect();
    const menu = this.els.userSortMenu;
    const gutter = 12;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
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

  openUserSortMenu() {
    if (!this.els.userSortDropdown) return;
    this.els.userSortDropdown.classList.add('open');
    this.els.userSortToggle?.setAttribute('aria-expanded', 'true');
    this.positionUserSortMenu();
    if (this.els.userSortMenu) {
      const active = this.els.userSortMenu.querySelector(`[data-sort="${this.userSort}"]`);
      active?.focus();
    }
  }

  closeUserSortMenu() {
    if (!this.els.userSortDropdown) return;
    if (!this.els.userSortDropdown.classList.contains('open')) return;
    this.els.userSortDropdown.classList.remove('open');
    if (this.els.userSortToggle) {
      this.els.userSortToggle.setAttribute('aria-expanded', 'false');
      if (this.els.userSortDropdown.contains(document.activeElement)) {
        this.els.userSortToggle.focus();
      }
    }
    if (this.els.userSortMenu) {
      this.els.userSortMenu.style.left = '';
      this.els.userSortMenu.style.top = '';
    }
  }

  toggleUserSortMenu() {
    if (!this.els.userSortDropdown) return;
    if (this.els.userSortDropdown.classList.contains('open')) this.closeUserSortMenu();
    else this.openUserSortMenu();
  }

  async loadList() {
    if (!this.requireAuth()) return;
    if (this.els.load) this.els.load.disabled = true;
    try {
      const data = await this.api.fetchList();
      if (!Array.isArray(data)) throw new Error('Unexpected response shape: expected an array');
      this.items = data.map((entry) => {
        const rawEntity = entry?.entity ? { ...entry.entity } : {};
        const normalized = EntityToolkit.normalizeEntityShape(rawEntity, { locale: DEFAULT_LANGUAGE });
        const entity = {
          ...normalized,
          localizedName:
            EntityToolkit.getTranslation(normalized.nameTranslations, DEFAULT_LANGUAGE) || normalized.name || '',
          localizedDescription:
            EntityToolkit.getTranslation(normalized.descriptionTranslations, DEFAULT_LANGUAGE) ||
            normalized.description || ''
        };
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
          const value = this.getListName(item).toLowerCase();
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
      const displayName = this.getListName(item) || '(no name)';
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

  updateRulesInputsVisibility(preferred) {
    const externalEnabled = !!this.els.fRulesExternalWeightEnabled?.checked;
    const bodyEnabled = !!this.els.fRulesBodyWeightEnabled?.checked;

    if (externalEnabled && bodyEnabled) {
      if (preferred === 'body') {
        if (this.els.fRulesExternalWeightEnabled) this.els.fRulesExternalWeightEnabled.checked = false;
      } else {
        if (this.els.fRulesBodyWeightEnabled) this.els.fRulesBodyWeightEnabled.checked = false;
      }
    }

    const finalExternal = !!this.els.fRulesExternalWeightEnabled?.checked;
    const finalBody = !!this.els.fRulesBodyWeightEnabled?.checked;

    if (this.els.fRulesExternalWeightRequired) {
      this.els.fRulesExternalWeightRequired.disabled = !finalExternal;
      if (!finalExternal) this.els.fRulesExternalWeightRequired.checked = false;
    }

    if (this.els.fRulesBodyWeightMultiplier) {
      this.els.fRulesBodyWeightMultiplier.disabled = !finalBody;
      this.els.fRulesBodyWeightMultiplier.value = String(this.bodyWeightMultiplier);
      this.syncBodyWeightMultiplierLabel();
    }

    if (this.els.fRulesExtraWeightEnabled) {
      this.els.fRulesExtraWeightEnabled.disabled = !finalBody;
      if (!finalBody) this.els.fRulesExtraWeightEnabled.checked = false;
    }

    if (this.els.fRulesExtraWeightRequired) {
      const enabled = finalBody && !!this.els.fRulesExtraWeightEnabled?.checked;
      this.els.fRulesExtraWeightRequired.disabled = !enabled;
      if (!enabled) this.els.fRulesExtraWeightRequired.checked = false;
    }

    if (this.els.fRulesAssistanceEnabled) {
      this.els.fRulesAssistanceEnabled.disabled = !finalBody;
      if (!finalBody) this.els.fRulesAssistanceEnabled.checked = false;
    }

    if (this.els.fRulesAssistanceRequired) {
      const enabled = finalBody && !!this.els.fRulesAssistanceEnabled?.checked;
      this.els.fRulesAssistanceRequired.disabled = !enabled;
      if (!enabled) this.els.fRulesAssistanceRequired.checked = false;
    }
  }

  syncBodyWeightMultiplierLabel() {
    if (!this.els.fRulesBodyWeightMultiplierValue || !this.els.fRulesBodyWeightMultiplier) return;
    const raw = this.els.fRulesBodyWeightMultiplier.value;
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      this.els.fRulesBodyWeightMultiplierValue.textContent = '—';
      return;
    }
    this.els.fRulesBodyWeightMultiplierValue.textContent = `${value.toFixed(2)}×`;
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
    const externalEnabled = !!this.els.fRulesExternalWeightEnabled?.checked;
    const bodyEnabled = !!this.els.fRulesBodyWeightEnabled?.checked;
    const extraEnabled = !!this.els.fRulesExtraWeightEnabled?.checked;
    const assistEnabled = !!this.els.fRulesAssistanceEnabled?.checked;

    e.rules = {
      components: {
        externalWeight: externalEnabled ? { required: !!this.els.fRulesExternalWeightRequired?.checked } : null,
        bodyWeight: bodyEnabled ? { required: true } : null,
        extraWeight: bodyEnabled && extraEnabled
          ? { required: !!this.els.fRulesExtraWeightRequired?.checked }
          : null,
        assistWeight: bodyEnabled && assistEnabled
          ? { required: !!this.els.fRulesAssistanceRequired?.checked }
          : null
      }
    };
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
    const components = entity?.rules?.components || {};
    const externalWeight = components?.externalWeight;
    const bodyWeight = components?.bodyWeight;
    const extraWeight = components?.extraWeight;
    const assistWeight = components?.assistWeight;

    if (this.els.fRulesExternalWeightEnabled) {
      this.els.fRulesExternalWeightEnabled.checked = !!externalWeight;
    }
    if (this.els.fRulesExternalWeightRequired) {
      this.els.fRulesExternalWeightRequired.checked = !!externalWeight?.required;
    }
    if (this.els.fRulesBodyWeightEnabled) {
      this.els.fRulesBodyWeightEnabled.checked = !!bodyWeight;
    }
    if (this.els.fRulesBodyWeightMultiplier) {
      this.els.fRulesBodyWeightMultiplier.value = String(this.bodyWeightMultiplier);
    }
    this.syncBodyWeightMultiplierLabel();
    if (this.els.fRulesExtraWeightEnabled) {
      this.els.fRulesExtraWeightEnabled.checked = !!extraWeight;
    }
    if (this.els.fRulesExtraWeightRequired) {
      this.els.fRulesExtraWeightRequired.checked = !!extraWeight?.required;
    }
    if (this.els.fRulesAssistanceEnabled) {
      this.els.fRulesAssistanceEnabled.checked = !!assistWeight;
    }
    if (this.els.fRulesAssistanceRequired) {
      this.els.fRulesAssistanceRequired.checked = !!assistWeight?.required;
    }
    this.updateRulesInputsVisibility();
    this.renderEquipmentTokens(entity);
    this.renderBundles(entity);
    this.updatePreviewSize();
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

  initPreviewSizing() {
    this.updatePreviewSize();
    if (this.els.introMain) {
      this.previewSizer = new ResizeObserver(() => this.updatePreviewSize());
      this.previewSizer.observe(this.els.introMain);
    }
    window.addEventListener('resize', () => this.updatePreviewSize());
  }

  updatePreviewSize() {
    if (!this.els.previewCard || !this.els.previewFrame || !this.els.introMain || !this.els.introRow) return;

    const introRect = this.els.introMain.getBoundingClientRect();
    const introHeight = Math.round(introRect.height || this.els.introMain.scrollHeight);
    if (!introHeight) return;

    const target = Math.round(Math.min(420, Math.max(260, introHeight)));
    const cardStyles = getComputedStyle(this.els.previewCard);
    const paddingX = parseFloat(cardStyles.paddingLeft || '0') + parseFloat(cardStyles.paddingRight || '0');
    const paddingY = parseFloat(cardStyles.paddingTop || '0') + parseFloat(cardStyles.paddingBottom || '0');
    const gapY = parseFloat(cardStyles.rowGap || cardStyles.gap || '0');
    const labelHeight = this.els.previewLabel?.getBoundingClientRect()?.height || 0;
    const labelMargin = this.els.previewLabel ? parseFloat(getComputedStyle(this.els.previewLabel).marginBottom || '0') : 0;
    const available = Math.max(0, target - paddingY - labelHeight - labelMargin - gapY);
    const frameSize = Math.max(160, Math.min(target, available));

    this.els.introMain.style.minHeight = `${target}px`;
    this.els.introMain.style.maxHeight = `${target}px`;
    this.els.previewCard.style.height = `${target}px`;
    this.els.previewCard.style.minHeight = `${target}px`;
    this.els.previewCard.style.maxHeight = `${target}px`;
    this.els.previewCard.style.setProperty('--preview-size', `${frameSize}px`);
    this.els.previewCard.style.width = `${frameSize + paddingX}px`;
    this.els.introRow?.style.setProperty('--intro-fixed-h', `${target}px`);
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

  buildGptRulesPrompt() {
  const entity = this.getEntity();
  const lines = [];

  lines.push('You are a strength training domain expert AND a strict JSON validator.');
  lines.push('');

  lines.push('GOAL:');
  lines.push('- You MUST keep the entire input JSON unchanged EXCEPT the field `rules`.');
  lines.push('- You MUST replace `rules` with the best possible values based on the exercise context: `name`, `description`, `weightType`, `category`, `forceType`, and `equipmentRefs`.');
  lines.push('- Think like a coach AND like a product designer: choose the configuration that best matches how users realistically log sets in a gym app.');
  lines.push('');

  lines.push('OUTPUT FORMAT (MANDATORY):');
  lines.push('- Return EXACTLY one markdown code block with JSON inside, and NOTHING else.');
  lines.push('- The very first characters of your answer MUST be: ```json');
  lines.push('- The very last characters of your answer MUST be: ```');
  lines.push('- Do not add any text before or after the code block.');
  lines.push('');
  lines.push('Example wrapper (do NOT copy the placeholder):');
  lines.push('```json');
  lines.push('{ "...": "..." }');
  lines.push('```');
  lines.push('');

  lines.push('HARD REQUIREMENTS:');
  lines.push('1) Inside the code block you must output a SINGLE valid JSON object.');
  lines.push('2) You may ONLY change `rules`. Every other field must remain identical in value.');
  lines.push('3) Best practice: copy the input JSON and edit only the `rules` object in-place.');
  lines.push('4) Preserve field order as in the input JSON.');
  lines.push('5) No extra keys anywhere. No explanations. No comments. No trailing commas.');
  lines.push('');

  lines.push('RULES SCHEMA (STRICT):');
  lines.push('"rules": {');
  lines.push('  "components": {');
  lines.push('    "externalWeight": { "required": boolean } | null,');
  lines.push('    "bodyWeight": { "required": boolean, "multiplier": number } | null,');
  lines.push('    "extraWeight": { "required": boolean } | null,');
  lines.push('    "assistWeight": { "required": boolean } | null');
  lines.push('  }');
  lines.push('}');
  lines.push('');

  lines.push('SEMANTICS (WHAT EACH COMPONENT MEANS):');
  lines.push('- externalWeight: the set is logged with an external numeric load as the main load (dumbbells, barbell, machines, cable stacks, plate-loaded, etc).');
  lines.push('- bodyWeight: the set is fundamentally bodyweight-based (push-up, pull-up, dip, pistol squat, etc).');
  lines.push('- bodyWeight.multiplier: a constant coefficient applied to bodyweight-based effective load. Default 1.0. Must be 0.05..2.0.');
  lines.push('- extraWeight: additional load on top of bodyweight (belt/vest/dumbbell between legs). Only meaningful if bodyWeight exists.');
  lines.push('- assistWeight: assistance that reduces effective bodyweight load (band assistance, assisted machine, counterbalance). Only meaningful if bodyWeight exists.');
  lines.push('');

  lines.push('INVARIANTS (MUST ALWAYS HOLD):');
  lines.push('- externalWeight and bodyWeight are mutually exclusive (never both non-null).');
  lines.push('- If bodyWeight is non-null, it MUST include `multiplier` between 0.05 and 2.0 (inclusive).');
  lines.push('- extraWeight and assistWeight are ONLY allowed when bodyWeight exists.');
  lines.push('- If externalWeight exists, extraWeight and assistWeight MUST be null.');
  lines.push('- If bodyWeight is null, then extraWeight and assistWeight MUST be null.');
  lines.push('- Do NOT include legacy fields like entry/load/options/requiresEquipment/requirements.');
  lines.push('');

  lines.push('EQUIPMENT DICTIONARY (name -> id) FOR INTERPRETATION:');
  lines.push('- Dumbbells — 9d66ac93-3a48-429d-aeaa-54302856e204');
  lines.push('- Barbell — b17ae8af-2d78-4e77-b45b-39253c28247a');
  lines.push('- EZ Bar — ad130932-4b2f-4e7b-b3a4-c20b4a6b85ae');
  lines.push('- Trap Bar — 21aad68b-b21b-4452-9ebf-7407be8e613d');
  lines.push('- Straight Bar — 15495639-2adb-41b8-899c-493ac0172f57');
  lines.push('- Cord Handles — 331a0c35-f5a5-478d-ba7c-9f14ba2ee0fa');
  lines.push('- Rope — af38ec0a-1465-45a8-99ba-a394224530dc');
  lines.push('- V Bar — 524da8cf-0303-4c53-8761-832a5fdb54ed');
  lines.push('- Close Grip Handle — c7c51826-c595-4ae8-9ac4-4421b2afc4ad');
  lines.push('- Wide Grip Handle — dec9f53a-7dac-4199-b4ff-ab0624090b8b');
  lines.push('- AB Machines — 527227fe-8182-4aec-949a-66335c5ce25e');
  lines.push('- Butterfly — 3f2fb6e0-df68-4881-a735-f07ea083aaa7');
  lines.push('- Butterfly Reverse — 526347a3-ee32-473d-9b5d-049f526ae48e');
  lines.push('- Leg Extension Machines — c74a2236-739f-476b-96d9-a11487d4049f');
  lines.push('- Leg Curl Machines — a8a80e95-9165-4200-af80-cd7608099307');
  lines.push('- Chest Press Machines — 79e4532a-afda-421f-9b5f-8c2de5f63ec0');
  lines.push('- Biceps Machines — 0d0f8242-be68-4086-b665-0a11ff6a0dcd');
  lines.push('- Smith Machines — 623e0be7-870a-4bca-b053-76e99c9ea7e0');
  lines.push('- Hack Squat Machines — 20e225dd-68d7-409b-9b7d-5ef6d4224d02');
  lines.push('- Deadlift Machines — 6ba064c9-68b3-4b76-af61-6a81eee230c8');
  lines.push('- Shoulder Press Machines — 6c587294-e384-4941-b90d-e6ec64b8731d');
  lines.push('- Lateral Raise Machines — 0268b0d7-f8e4-47ea-b9da-969427b43adf');
  lines.push('- Triceps Machines — f3166b1f-125f-4fb9-a443-e1fc2b1c0f8f');
  lines.push('- Calf Raise Machines — 7752a881-139d-4cf4-98b2-e92e9de0e2e5');
  lines.push('- Glute Machines — f3dadde9-6213-4a90-8fc0-12bd7bf7ea6b');
  lines.push('- Adductor Machine — 9a4df37b-9fdb-4c19-93b3-d99393d9e605');
  lines.push('- Abductor Machine — 32bed80a-1512-4945-9654-8d710618ef81');
  lines.push('- Leg Press Machine — 1959d942-75fb-4ece-b501-b7cf8884d479');
  lines.push('- Lat Pulldown — 18995b62-6971-4750-84fe-0c2bc712f352');
  lines.push('- Cable — 752ee7ba-ae88-46f0-95fb-e0a316212f16');
  lines.push('- Cable Crossover — a6628e7c-1488-4268-82ee-5174f3a5a2a5');
  lines.push('- Row Cable — 373d04ea-8079-439a-82a3-d118da6253b1');
  lines.push('- Pull Up Bar — ddf4299a-fc48-47bd-9bdf-7e3d7692b09f');
  lines.push('- Dip Bars — c01e10b9-4ef6-4f23-9b41-7f6d5d4d1e85');
  lines.push('- Romain Chair — afe516f8-6dc9-45ca-b95e-81142c336878');
  lines.push('- Glute Ham Raise Bench — 306270ba-834e-461e-81ce-45fd5a77c99f');
  lines.push('- Flat Bench — 85dbccf6-454e-4440-8905-50a90d91dbcc');
  lines.push('- Adjustable Bench — 6215cbaf-6065-4534-a9d5-a588c1b3dc28');
  lines.push('- Decline Bench — c4d5e6fe-30fd-4f16-8646-634102d1bf1b');
  lines.push('- Flat Bench with Rack — e7fc1da0-48df-4338-b03f-1cea01cd12d5');
  lines.push('- Incline Bench with Rack — 6345b70f-6e3f-46e2-9d51-3be51250ed99');
  lines.push('- Decline Bench with Rack — 9677e942-8a9b-4754-a27f-7e4d945681a1');
  lines.push('- Squat Rack — a025ec57-670e-45ea-962e-9c9430786666');
  lines.push('- Preacher Curl Bench — 061ad8e2-77aa-4ba8-9a41-51788e7803c7');
  lines.push('- Row Bench — 0eda801d-e31d-4943-8a73-68c702f3d3d2');
  lines.push('');

  lines.push('DECISION PROCEDURE (DO THIS INTERNALLY; DO NOT OUTPUT THESE STEPS):');
  lines.push('Step 1: Identify the logging archetype using strict priority:');
  lines.push('  (a) weightType field');
  lines.push('  (b) equipmentRefs (ids and any embedded equipment names if present)');
  lines.push('  (c) name/description keywords');
  lines.push('');
  lines.push('Archetypes:');
  lines.push('A1) BODYWEIGHT: main load is bodyweight (push-up, pull-up, dip, pistol squat, etc).');
  lines.push('A2) EXTERNAL_LOAD: main load is external and numeric per set (barbell, dumbbell, machine, cable, leg press, smith, etc).');
  lines.push('A3) NO_WEIGHT: tracking weight is meaningless (mobility, stretching, breathing, skill drill).');
  lines.push('A4) ASSISTED_BODYWEIGHT: bodyweight movement with meaningful assistance (assisted machine, band-assisted, counterbalance).');
  lines.push('');
  lines.push('Step 2: Generate 2-3 candidate `rules` configurations for the chosen archetype.');
  lines.push('  - For each candidate, consider what the user must input per set to make the set meaningful.');
  lines.push('  - Prefer the option that minimizes friction while keeping data quality high.');
  lines.push('');
  lines.push('Step 3: Choose `required` flags as a saving constraint:');
  lines.push('- required=true  => the set cannot be saved without this input.');
  lines.push('- required=false => optional input (nice-to-have).');
  lines.push('');
  lines.push('Step 4: Run the SELF-CHECK. If any check fails, revise rules until all checks pass.');
  lines.push('');

  lines.push('BASELINE MAPPINGS (START HERE, THEN REFINE):');
  lines.push('- If weightType == "body_weight": start from BODYWEIGHT (A1), unless name/description indicates assistance (A4).');
  lines.push('- If weightType in ["free","fixed"]: start from EXTERNAL_LOAD (A2), unless it is clearly a non-numeric drill (A3).');
  lines.push('');

  lines.push('A1) BODYWEIGHT baseline:');
  lines.push('  externalWeight: null');
  lines.push('  bodyWeight: { required: true, multiplier: 1.0 }');
  lines.push('  extraWeight: { required: false }');
  lines.push('  assistWeight: null');
  lines.push('');

  lines.push('A4) ASSISTED_BODYWEIGHT baseline:');
  lines.push('  externalWeight: null');
  lines.push('  bodyWeight: { required: true, multiplier: 1.0 }');
  lines.push('  extraWeight: { required: false }');
  lines.push('  assistWeight: { required: false }');
  lines.push('');

  lines.push('A2) EXTERNAL_LOAD baseline:');
  lines.push('  externalWeight: { required: true }');
  lines.push('  bodyWeight: null');
  lines.push('  extraWeight: null');
  lines.push('  assistWeight: null');
  lines.push('');

  lines.push('A3) NO_WEIGHT baseline:');
  lines.push('  externalWeight: null');
  lines.push('  bodyWeight: null');
  lines.push('  extraWeight: null');
  lines.push('  assistWeight: null');
  lines.push('');

  lines.push('MULTIPLIER GUIDANCE:');
  lines.push('- Use multiplier 1.0 by default.');
  lines.push('- Only change it if the exercise clearly scales by a fixed fraction of body weight in a stable way.');
  lines.push('- If uncertain, keep 1.0.');
  lines.push('');

  lines.push('SELF-CHECK (MUST PASS BEFORE OUTPUT):');
  lines.push('- The final JSON must match the input JSON in all fields except `rules`.');
  lines.push('- `rules` contains ONLY the allowed schema.');
  lines.push('- externalWeight and bodyWeight are mutually exclusive.');
  lines.push('- If bodyWeight exists => multiplier exists and is within 0.05..2.0.');
  lines.push('- If externalWeight exists => extraWeight and assistWeight are null.');
  lines.push('- If bodyWeight is null => extraWeight and assistWeight are null.');
  lines.push('');

  lines.push('IMPORTANT PRODUCT NOTE:');
  lines.push('- Iteration `weight` is the effective weight recorded by the app. Rules define UI/UX and interpretation only.');
  lines.push('');

  lines.push('FAILSAFE:');
  lines.push('- If you cannot fully comply with ALL requirements (including exact one-code-block output), output the ORIGINAL input JSON unchanged, still wrapped in the required ```json code block.');
  lines.push('');

  lines.push('INPUT JSON (copy this and only edit `rules`):');
  lines.push(pretty(entity));

  return lines.join('\\n');
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
    } catch (error) {
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
    } catch (error) {
      const ta = document.createElement('textarea');
      ta.value = prompt;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      toast({ title: 'Image prompt copied' });
    }
  }

  async copyRulesPrompt() {
    const prompt = this.buildGptRulesPrompt();
    try {
      await navigator.clipboard.writeText(prompt);
      toast({ title: 'Rules prompt copied' });
    } catch (error) {
      const ta = document.createElement('textarea');
      ta.value = prompt;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      toast({ title: 'Rules prompt copied' });
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

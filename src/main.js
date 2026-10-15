import {StorageManager} from './infrastructure/storage/index.js';
import {ApiClient} from './infrastructure/http/index.js';
import {EventBus} from './infrastructure/events/EventBus.js';

import {DictionaryStore, ExerciseRepository, ExerciseValidator, EXERCISE_DIAGNOSTIC_RULES} from './domain/exercise/index.js';
import {UserRepository, USER_DIAGNOSTIC_RULES} from './domain/user/index.js';

import {AuthService, LoginView} from './features/auth/index.js';
import {ExerciseController, ExerciseFormView, ExerciseListView, ExerciseStore} from './features/exercises/index.js';
import {UserController, UserDetailView, UserListView, UserStore} from './features/users/index.js';

import {ConfirmDialog} from './shared/components/index.js';
import {Toast} from './shared/components/Toast.js';
import {DEFAULT_LANGUAGE} from './shared/constants/index.js';
import {Events} from './infrastructure/events/events.js';
import {LoadingIndicator, loadingDescription} from './shared/components/LoadingIndicator.js';
import {ResponsivePicker} from './shared/components/ResponsivePicker.js';
import {ReviewQueue} from './shared/components/ReviewQueue.js';
import {exerciseName} from './features/exercises/exercisePresentation.js';

/* ── 1. Infrastructure ──────────────────────────────────────── */

const storage = new StorageManager();
const bus = new EventBus();
const api = new ApiClient({
    storage,
    getLocale: () => storage.getLocale(),
    onSessionExpired: () => {
    } // перезаписывается AuthService после создания
});

/* ── 2. Domain ──────────────────────────────────────────────── */

const exerciseRepo = new ExerciseRepository(api);
const userRepo = new UserRepository(api);
const dictionaries = new DictionaryStore(exerciseRepo);
const validator = new ExerciseValidator(dictionaries);

/* ── 3. Shared components ───────────────────────────────────── */

ConfirmDialog.init({
    overlay: document.getElementById('confirmOverlay'),
    titleEl: document.getElementById('confirmTitle'),
    messageEl: document.getElementById('confirmMessage'),
    detailEl: document.getElementById('confirmDetail'),
    actionLabelEl: document.getElementById('confirmAcceptLabel'),
    cancelBtn: document.getElementById('confirmCancel'),
    closeBtn: document.getElementById('confirmClose'),
    acceptBtn: document.getElementById('confirmAccept'),
});

/* ── 4. Auth ────────────────────────────────────────────────── */

const authService = new AuthService({apiClient: api, userRepository: userRepo, storage, bus});

const loginView = new LoginView({
    authService,
    bus,
    els: {
        overlay: document.getElementById('loginOverlay'),
        form: document.getElementById('loginForm'),
        emailInput: document.getElementById('loginEmail'),
        passwordInput: document.getElementById('loginPassword'),
        errorEl: document.getElementById('loginError'),
        restoreEl: document.getElementById('loginRestore'),
    }
});

/* ── 5. Exercises ───────────────────────────────────────────── */

const exerciseStore = new ExerciseStore();
exerciseStore.setLocale(storage.getLocale());
exerciseStore.setViewMode(storage.getViewMode());

// Persist content locale and editor mode; the interface language remains English.
let _lastPersistedLocale = exerciseStore.getState().locale;
let _lastPersistedViewMode = exerciseStore.getState().viewMode;
document.documentElement.setAttribute('lang', 'en');
exerciseStore.subscribe((state) => {
    if (state.locale && state.locale !== _lastPersistedLocale) {
        _lastPersistedLocale = state.locale;
        storage.setLocale(state.locale);
    }
    if (state.viewMode && state.viewMode !== _lastPersistedViewMode) {
        _lastPersistedViewMode = state.viewMode;
        storage.setViewMode(state.viewMode);
    }
});

const exerciseSortOptions = {
    name: {label: 'Name'},
    createdAt: {label: 'Creation date'},
    hasImage: {label: 'Has image'},
    missingImage: {label: 'Missing image'},
};

// Forward-declare contoller — list/form views ссылаются на него через замыкания onSelect/onSave/onDelete.
// Реальное присваивание ниже, после конструирования вьюх.
let exerciseController;

const exerciseListView = new ExerciseListView({
    store: exerciseStore,
    els: {
        list: document.getElementById('list'),
        count: document.getElementById('exerciseListCount'),
        qualityFilter: document.getElementById('exerciseQualityFilter'),
        qualitySummary: document.getElementById('exerciseQualitySummary'),
        filters: document.getElementById('exerciseFilters'),
        filterCount: document.getElementById('exerciseFilterCount'),
        filterResults: document.getElementById('exerciseFilterResults'),
        clearFiltersBtn: document.getElementById('clearExerciseFilters'),
        search: document.getElementById('search'),
        sortToggle: document.getElementById('sortToggle'),
        sortMenu: document.getElementById('sortMenu'),
        sortLabel: document.getElementById('sortLabel'),
        newBtn: document.getElementById('newBtn'),
        loadBtn: document.getElementById('loadBtn'),
    },
    onSelect: (item) => exerciseController.selectItem(item),
    onNew: () => exerciseController.newItem(),
    onLoad: () => exerciseController.loadList(),
    sortOptions: exerciseSortOptions,
});

const exerciseFormView = new ExerciseFormView({
    store: exerciseStore,
    validator,
    dictionaries,
    els: {
        // Toolbar
        saveBtn: document.getElementById('saveBtn'),
        emptyState: document.getElementById('exerciseEmpty'),
        validationSummary: document.getElementById('exerciseValidation'),
        editorStatus: document.getElementById('exerciseEditorStatus'),
        detailLoading: document.getElementById('exerciseDetailLoading'),
        dictionaryStatus: document.getElementById('dictionaryStatus'),
        translationNotice: document.getElementById('exerciseTranslationNotice'),
        diagnosticPanel: document.getElementById('exerciseDiagnostics'),
        deleteBtn: document.getElementById('deleteExerciseBtn'),
        viewForm: document.getElementById('viewForm'),
        viewJson: document.getElementById('viewJson'),
        currentId: document.getElementById('currentId'),
        nameLabel: document.getElementById('exerciseNameLabel'),
        descriptionLabel: document.getElementById('exerciseDescriptionLabel'),
        localeHint: document.getElementById('exerciseLocaleHint'),
        inputsSection: document.getElementById('exerciseInputsSection'),
        equipmentSection: document.getElementById('exerciseEquipmentSection'),
        inputsSummary: document.getElementById('exerciseInputsSummary'),
        equipmentSummary: document.getElementById('exerciseEquipmentSummary'),
        jsonStatus: document.getElementById('jsonStatus'),
        promptBtn: document.getElementById('promptBtn'),
        promptImgBtn: document.getElementById('promptImgBtn'),
        promptRulesBtn: document.getElementById('promptRulesBtn'),
        // Editor panels
        builder: document.getElementById('builder'),
        editorWrap: document.getElementById('jsonWrap'),
        editor: document.getElementById('editor'),
        clearJsonBtn: document.getElementById('clearJsonBtn'),
        // Basics
        fId: document.getElementById('fId'),
        fName: document.getElementById('fName'),
        fImage: document.getElementById('fImage'),
        fDescription: document.getElementById('fDescription'),
        // Attributes
        fWeightType: document.getElementById('fWeightType'),
        fCategory: document.getElementById('fCategory'),
        fExperience: document.getElementById('fExperience'),
        fForceType: document.getElementById('fForceType'),
        // Components / rules
        fRulesExternalWeightEnabled: document.getElementById('fRulesExternalWeightEnabled'),
        fRulesExternalWeightRequired: document.getElementById('fRulesExternalWeightRequired'),
        fRulesBodyWeightEnabled: document.getElementById('fRulesBodyWeightEnabled'),
        fRulesBodyWeightMultiplier: document.getElementById('fRulesBodyWeightMultiplier'),
        fRulesBodyWeightMultiplierValue: document.getElementById('fRulesBodyWeightMultiplierValue'),
        fRulesExtraWeightEnabled: document.getElementById('fRulesExtraWeightEnabled'),
        fRulesExtraWeightRequired: document.getElementById('fRulesExtraWeightRequired'),
        fRulesAssistanceEnabled: document.getElementById('fRulesAssistanceEnabled'),
        fRulesAssistanceRequired: document.getElementById('fRulesAssistanceRequired'),
        // Equipment
        equipTokens: document.getElementById('equipTokens'),
        equipSingle: document.getElementById('equipSingle'),
        equipAdd: document.getElementById('equipAdd'),
        equipClear: document.getElementById('equipClear'),
        // Bundles
        bundles: document.getElementById('bundles'),
        muscleSelect: document.getElementById('muscleSelect'),
        percentInput: document.getElementById('percentInput'),
        bundleAdd: document.getElementById('bundleAdd'),
        bundleSumInfo: document.getElementById('bundleSumInfo'),
        // Image preview
        previewCard: document.getElementById('exercisePreviewCard'),
        previewImg: document.getElementById('exercisePreview'),
        previewEmpty: document.getElementById('exercisePreviewEmpty'),
        previewFrame: document.getElementById('previewFrame'),
        // Locale switcher
        localeButtons: document.querySelectorAll('[data-locale]'),
        localeSwitcher: document.getElementById('localeSwitcher'),
    },
    onSave: (entity) => exerciseController.saveItem(entity),
    onDelete: (id) => exerciseController.deleteItem(id),
    onLocaleChange: (locale) => exerciseController.selectLocale(locale),
});

exerciseController = new ExerciseController({
    store: exerciseStore,
    listView: exerciseListView,
    formView: exerciseFormView,
    repository: exerciseRepo,
    bus,
    confirmDialog: ConfirmDialog,
});

/* ── 6. Users ───────────────────────────────────────────────── */

const userStore = new UserStore();

const userSortOptions = {
    createdAt: {label: 'Creation date'},
    lastActivity: {label: 'Last activity'},
    workoutsCount: {label: 'Workouts count'},
    authType: {label: 'Auth type'},
    email: {label: 'Email'},
};

// Forward-declare userController, аналогично exerciseController
let userController;

const userListView = new UserListView({
    store: userStore,
    els: {
        userList: document.getElementById('userList'),
        reloadUsersBtn: document.getElementById('reloadUsersBtn'),
        userCount: document.getElementById('userListCount'),
        qualityFilter: document.getElementById('userQualityFilter'),
        qualitySummary: document.getElementById('userQualitySummary'),
        filters: document.getElementById('userFilters'),
        filterCount: document.getElementById('userFilterCount'),
        filterResults: document.getElementById('userFilterResults'),
        clearFiltersBtn: document.getElementById('clearUserFilters'),
        userSearch: document.getElementById('userSearch'),
        userSortToggle: document.getElementById('userSortToggle'),
        userSortMenu: document.getElementById('userSortMenu'),
        userSortLabel: document.getElementById('userSortLabel'),
    },
    onSelect: (user) => userController.selectUser(user),
    sortOptions: userSortOptions,
});

const userDetailView = new UserDetailView({
    store: userStore,
    els: {
        panel: document.getElementById('userDetailsPanel'),
        accountDetails: document.getElementById('userAccountDetails'),
        accountActions: document.getElementById('userAccountActions'),
        sectionElements: {
            goal: document.getElementById('userGoalSection'),
            recentTrainings: document.getElementById('userTrainingsSection'),
            weightHistory: document.getElementById('userWeightSection'),
            deviceTokens: document.getElementById('userDevicesSection'),
        },
        userDetail: document.getElementById('userDetail'),
        userDiagnostics: document.getElementById('userDiagnostics'),
        userEmptyState: document.getElementById('userEmptyState'),
        userNameEl: document.getElementById('userName'),
        userIdEl: document.getElementById('userIdField'),
        profileIdEl: document.getElementById('profileIdField'),
        userEmailEl: document.getElementById('userEmail'),
        userCreatedEl: document.getElementById('userCreated'),
        userUpdatedEl: document.getElementById('userUpdated'),
        userActivityEl: document.getElementById('userLastActivity'),
        userWorkoutsEl: document.getElementById('userWorkoutsCount'),
        userAuthPill: document.getElementById('userAuthPill'),
        userAuthList: document.getElementById('userAuthList'),
        userSelectionHint: document.getElementById('userSelectionHint'),
        roleSegments: document.querySelectorAll('[data-role]'),
        deleteUserBtn: document.getElementById('deleteUserBtn'),
        // Details sections
        detailsSections: document.getElementById('userDetailsGrid'),
        goalSummary: document.getElementById('userGoalSummary'),
        goalBody: document.getElementById('userGoalBody'),
        trainingsCount: document.getElementById('userTrainingsCount'),
        trainingsBody: document.getElementById('userTrainingsBody'),
        weightSummary: document.getElementById('userWeightSummary'),
        weightBody: document.getElementById('userWeightBody'),
        deviceTokensSummary: document.getElementById('userDeviceTokensSummary'),
        deviceTokensBody: document.getElementById('userDeviceTokensBody'),
    },
    onRoleChange: (role) => userController.changeRole(role),
    onRetryDetails: (key) => userController.reloadDetails(key),
    onDelete: () => userController.deleteActiveUser(),
});

userController = new UserController({
    store: userStore,
    repository: userRepo,
    bus,
    confirmDialog: ConfirmDialog,
});

/* Review uses the existing saved-record filters and selection guards. */
function reviewFilter(value, rules) {
    return ['attention', 'error', 'warning'].includes(value)
        || rules.some(rule => value === `rule:${rule.id}` && ['error', 'warning'].includes(rule.severity));
}

function showChecks(id) {
    const checks = document.getElementById(id)?.querySelector('.diagnostic-panel');
    if (!checks) return;
    checks.open = true;
    checks.querySelector('summary')?.focus();
    checks.scrollIntoView({block: 'nearest'});
}

const exerciseReview = new ReviewQueue({root: document.getElementById('exerciseReviewQueue'),
    getId: item => item?.entity?.id || item?.id,
    onSelect: (item, {isCurrent}) => exerciseController.selectItem(item, {canSelect: isCurrent}),
    onShowReason: () => showChecks('exerciseDiagnostics')});
const userReview = new ReviewQueue({root: document.getElementById('userReviewQueue'),
    getId: item => item.id,
    // User selection is synchronous; slow independent sections must not block the next record.
    onSelect: (item, {isCurrent}) => { if (isCurrent()) void userController.selectUser(item); },
    onShowReason: () => showChecks('userDiagnostics')});

function syncExerciseReview(state) {
    const enabled = reviewFilter(state.qualityFilter, EXERCISE_DIAGNOSTIC_RULES);
    exerciseReview.update({items: state.filtered, reports: state.diagnosticReports, selectedId: state.isNew ? null : state.current?.id,
        enabled, busy: state.isLoading || state.isSaving || state.isDetailLoading, loadError: state.loadError});
    document.getElementById('exerciseReviewBtn').hidden = enabled || !state.diagnosticSummary.recordCount;
}
function syncUserReview(state) {
    const enabled = reviewFilter(state.diagnosticFilter, USER_DIAGNOSTIC_RULES);
    userReview.update({items: state.filtered, reports: state.diagnostics, selectedId: state.active?.id,
        enabled, busy: state.isLoading || state.roleChangeInFlight || state.deleteInFlight, loadError: state.loadError});
    document.getElementById('userReviewBtn').hidden = enabled || !state.diagnosticSummary.attentionCount;
}
exerciseStore.subscribe(syncExerciseReview);
userStore.subscribe(syncUserReview);
syncExerciseReview(exerciseStore.getState());
syncUserReview(userStore.getState());
for (const [buttonId, rootId, start] of [
    ['exerciseReviewBtn', 'exerciseReviewQueue', () => exerciseStore.setQualityFilter('attention')],
    ['userReviewBtn', 'userReviewQueue', () => userStore.setDiagnosticFilter('attention')],
]) {
    document.getElementById(buttonId).addEventListener('click', () => {
        start();
        const root = document.getElementById(rootId);
        root.tabIndex = -1;
        root.focus();
    });
}

/* ── 7. Navigation ──────────────────────────────────────────── */

const exercisePicker = new ResponsivePicker({details: document.getElementById('exercisePicker'),
    labelEl: document.getElementById('exercisePickerLabel'), emptyLabel: 'Choose an exercise'});
const userPicker = new ResponsivePicker({details: document.getElementById('userPicker'),
    labelEl: document.getElementById('userPickerLabel'), emptyLabel: 'Choose an account'});
exerciseStore.subscribe(state => exercisePicker.update(state.current
    ? {id: state.current.id, label: exerciseName(state.current, state.locale)} : null));
userStore.subscribe(state => userPicker.update(state.active
    ? {id: state.active.id, label: state.active.name || state.active.email || 'Selected account'} : null));

let activeSection = 'exercise';
const primaryTabs = [...document.querySelectorAll('.primary-tabs [role="tab"]')];
const loadingIndicator = new LoadingIndicator({root: document.getElementById('globalLoading'), labelEl: document.getElementById('globalLoadingLabel')});
let loadingSessionActive = false;
function syncLoadingIndicator() {
    loadingIndicator.update(loadingDescription({authenticated: loadingSessionActive, section: activeSection,
        exercise: exerciseStore.getState(), users: userStore.getState(), dictionaryLoading: dictionaries.loading}));
}
exerciseStore.subscribe(syncLoadingIndicator);
userStore.subscribe(syncLoadingIndicator);
bus.on(Events.AUTH_LOGIN_SUCCESS, () => { loadingSessionActive = true; syncLoadingIndicator(); });
for (const event of [Events.AUTH_LOGOUT, Events.AUTH_SESSION_EXPIRED]) {
    bus.on(event, () => { loadingSessionActive = false; loadingIndicator.reset(); });
}

async function confirmDiscard() {
    if (!exerciseFormView.hasUnsavedChanges()) return true;
    return ConfirmDialog.ask({
        title: 'Unsaved exercise changes',
        message: 'Discard your changes to this exercise?',
        detail: 'Save the exercise first if you want to keep your edits.',
        actionLabel: 'Discard changes',
        actionType: 'warn',
    });
}

function navigate(section) {
    if (section === activeSection) return;
    bus.emit(Events.NAV_SECTION_CHANGED, {section});
}

primaryTabs.forEach((tab, index) => {
    tab.addEventListener('click', () => navigate(tab.dataset.section));
    tab.addEventListener('keydown', (event) => {
        const offsets = {ArrowRight: 1, ArrowLeft: -1};
        let next;
        if (event.key in offsets) next = (index + offsets[event.key] + primaryTabs.length) % primaryTabs.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = primaryTabs.length - 1;
        else return;
        event.preventDefault();
        primaryTabs[next].focus();
        navigate(primaryTabs[next].dataset.section);
    });
});
document.querySelector('.app-brand')?.addEventListener('click', event => {
    event.preventDefault();
    navigate('exercise');
});
document.getElementById('reloadUsersBtn')?.addEventListener('click', () => userController.loadUsers());
bus.on(Events.NAV_SECTION_CHANGED, ({section}) => {
    if (!['exercise', 'users'].includes(section)) return;
    if (section === 'users') refreshUserDiagnostics();
    activeSection = section;
    document.getElementById('exerciseView').hidden = section !== 'exercise';
    document.getElementById('usersView').hidden = section !== 'users';
    primaryTabs.forEach(tab => {
        const selected = tab.dataset.section === section;
        tab.classList.toggle('active', selected);
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
    });
    document.title = `${section === 'exercise' ? 'Exercises' : 'Users'} · Grippo Admin`;
    syncLoadingIndicator();
});

// Close before the action runs so confirmations and validation can take focus safely.
for (const menu of document.querySelectorAll('.prompt-menu, #userAccountActions, .record-filters')) {
    menu.addEventListener('click', event => {
        if (event.target.closest('button')) {
            menu.open = false;
            menu.querySelector('summary')?.focus();
        }
    }, true);
    // Floating panels can close without moving the record under the pointer.
    document.addEventListener('click', event => {
        if (!menu.contains(event.target)) menu.open = false;
    });
    menu.addEventListener('focusout', event => {
        if (!menu.contains(event.relatedTarget)) menu.open = false;
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !event.defaultPrevented && menu.open && menu.contains(event.target)) {
            event.preventDefault();
            menu.open = false;
            menu.querySelector('summary')?.focus();
        }
    });
    bus.on(Events.NAV_SECTION_CHANGED, () => { menu.open = false; });
}
window.addEventListener('beforeunload', event => {
    if (!exerciseFormView.hasUnsavedChanges()) return;
    event.preventDefault();
    event.returnValue = '';
});

/* ── 8. Logout ──────────────────────────────────────────────── */

document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    if (!await confirmDiscard()) return;
    await authService.logout();
    Toast.show({title: 'Logged out'});
});

/* ── 9. Dictionaries ────────────────────────────────────────── */

let dictionaryLoadSeq = 0;
function updateDiagnosticDictionaries(ready) {
    exerciseStore.setDiagnosticContext({equipment: dictionaries.equipment, muscles: dictionaries.muscles,
        equipmentReady: ready, musclesReady: ready});
}
async function loadDictionaries() {
    const seq = ++dictionaryLoadSeq;
    const retry = document.getElementById('dictionaryRetry');
    retry.disabled = true;
    retry.textContent = 'Loading dictionaries…';
    const request = dictionaries.loadAll();
    updateDiagnosticDictionaries(false);
    syncLoadingIndicator();
    await request;
    if (seq !== dictionaryLoadSeq) return;
    updateDiagnosticDictionaries(dictionaries.isReady && !dictionaries.loading && !dictionaries.errors.length);
    exerciseFormView.refreshOptionLists();
    retry.disabled = false;
    retry.textContent = 'Reload dictionaries';
    syncLoadingIndicator();
    bus.emit(Events.DICTS_LOADED, {equipments: dictionaries.equipment, muscles: dictionaries.muscles});
}
document.getElementById('dictionaryRetry')?.addEventListener('click', loadDictionaries);
bus.on(Events.AUTH_LOGIN_SUCCESS, loadDictionaries);

/* Recheck age thresholds without fetching additional records. Browser timers pause with the document. */
function refreshUserDiagnostics() {
    if (!document.hidden && userStore.getState().users.length) userStore.refreshDiagnostics();
}
window.setInterval(refreshUserDiagnostics, 60_000);
document.addEventListener('visibilitychange', refreshUserDiagnostics);

/* ── 10. Start ──────────────────────────────────────────────── */

const restoreView = loginView.setRestoring(true);
try { await authService.tryRestoreSession(); }
finally { loginView.setRestoring(false, restoreView); }

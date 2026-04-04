import {StorageManager} from './infrastructure/storage/index.js';
import {ApiClient} from './infrastructure/http/index.js';
import {EventBus} from './infrastructure/events/EventBus.js';

import {DictionaryStore, ExerciseNormalizer, ExerciseRepository, ExerciseValidator} from './domain/exercise/index.js';
import {UserRepository} from './domain/user/index.js';

import {AuthService, LoginView} from './features/auth/index.js';
import {ExerciseController, ExerciseFormView, ExerciseListView, ExerciseStore} from './features/exercises/index.js';
import {UserController, UserDetailView, UserListView, UserStore} from './features/users/index.js';

import {ConfirmDialog} from './shared/components/index.js';
import {Toast} from './shared/components/Toast.js';
import {DEFAULT_LANGUAGE} from './shared/constants/index.js';

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
    }
});

/* ── 5. Exercises ───────────────────────────────────────────── */

const exerciseStore = new ExerciseStore();
exerciseStore.setLocale(storage.getLocale());
exerciseStore.setViewMode(storage.getViewMode());

const exerciseSortOptions = {
    name: {label: 'Name'},
    createdAt: {label: 'Creation date'},
    hasImage: {label: 'Has image'},
    missingImage: {label: 'Missing image'},
};

const exerciseListView = new ExerciseListView({
    store: exerciseStore,
    els: {
        list: document.getElementById('list'),
        search: document.getElementById('search'),
        clearSearch: document.getElementById('clearSearch'),
        sortToggle: document.getElementById('sortToggle'),
        sortMenu: document.getElementById('sortMenu'),
        sortLabel: document.getElementById('sortLabel'),
        newBtn: document.getElementById('newBtn'),
        loadBtn: document.getElementById('loadBtn'),
    },
    onSelect: (item) => exerciseController.selectItem(item),
    onNew: () => exerciseController.newItem(),
    onLoad: () => exerciseController.loadList(),
    getItemName: (item) => {
        const nameTranslations = item?.entity?.nameTranslations ?? item?.nameTranslations;
        const fromMap = ExerciseNormalizer.getTranslation(
            ExerciseNormalizer.ensureTranslationMap(nameTranslations),
            DEFAULT_LANGUAGE
        );
        if (fromMap) return fromMap;
        if (Array.isArray(item?.name)) {
            const en = item.name.find(e => e.language === 'en');
            return en?.value || en?.name || item.name[0]?.value || '';
        }
        return typeof item?.name === 'string' ? item.name : '';
    },
    sortOptions: exerciseSortOptions,
});

const exerciseFormView = new ExerciseFormView({
    store: exerciseStore,
    validator,
    dictionaries,
    els: {
        // Toolbar
        saveBtn: document.getElementById('saveBtn'),
        viewForm: document.getElementById('viewForm'),
        viewJson: document.getElementById('viewJson'),
        currentId: document.getElementById('currentId'),
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

// exerciseController forward-declared; defined below
const exerciseController = new ExerciseController({
    store: exerciseStore,
    listView: exerciseListView,
    formView: exerciseFormView,
    repository: exerciseRepo,
    bus,
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

const userListView = new UserListView({
    store: userStore,
    els: {
        userList: document.getElementById('userList'),
        userCount: document.getElementById('userListCount'),
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
        userNameEl: document.getElementById('userName'),
        userIdEl: document.getElementById('userIdField'),
        userEmailEl: document.getElementById('userEmail'),
        userCreatedEl: document.getElementById('userCreated'),
        userActivityEl: document.getElementById('userLastActivity'),
        userWorkoutsEl: document.getElementById('userWorkoutsCount'),
        userAuthPill: document.getElementById('userAuthPill'),
        userAuthList: document.getElementById('userAuthList'),
        roleSegments: document.querySelectorAll('[data-role]'),
        deleteUserBtn: document.getElementById('deleteUserBtn'),
    },
    onRoleChange: (role) => userController.changeRole(role),
    onDelete: () => userController.deleteActiveUser(),
});

const userController = new UserController({
    store: userStore,
    listView: userListView,
    detailView: userDetailView,
    repository: userRepo,
    bus,
    confirmDialog: ConfirmDialog,
});

/* ── 7. Navigation ──────────────────────────────────────────── */

document.getElementById('tabExercise')?.addEventListener('click', () => {
    bus.emit('nav:section-changed', {section: 'exercise'});
});
document.getElementById('tabUsers')?.addEventListener('click', () => {
    bus.emit('nav:section-changed', {section: 'users'});
});
bus.on('nav:section-changed', ({section}) => {
    document.getElementById('exerciseView')?.toggleAttribute('hidden', section !== 'exercise');
    document.getElementById('usersView')?.toggleAttribute('hidden', section !== 'users');

    const tabExercise = document.getElementById('tabExercise');
    const tabUsers = document.getElementById('tabUsers');
    if (tabExercise) {
        tabExercise.classList.toggle('active', section === 'exercise');
        tabExercise.setAttribute('aria-selected', String(section === 'exercise'));
    }
    if (tabUsers) {
        tabUsers.classList.toggle('active', section === 'users');
        tabUsers.setAttribute('aria-selected', String(section === 'users'));
    }
});

/* ── 8. Logout ──────────────────────────────────────────────── */

document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await authService.logout();
    Toast.show({title: 'Logged out'});
});

/* ── 9. Dictionaries ────────────────────────────────────────── */

bus.on('auth:login-success', async () => {
    await dictionaries.loadAll();
});

/* ── 10. Start ──────────────────────────────────────────────── */

await authService.tryRestoreSession();

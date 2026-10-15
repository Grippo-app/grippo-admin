import {userProfileState} from '../../domain/user/index.js';
import {readUserWorkoutCount} from '../../domain/user/userEvidence.js';
import {diagnosticPanelHtml} from '../../shared/components/diagnosticPresentation.js';
import {escapeHtml} from '../../shared/utils/index.js';
import {getAuthIcon} from '../../shared/utils/authIcons.js';
import {Toast} from '../../shared/components/Toast.js';
import {formatDuration, formatNumber, formatShortDate, humanizeEnum, relativeDate} from './userFormatters.js';
import {buildWeightHistoryModel} from './weightHistoryModel.js';

export class UserDetailView {
    constructor({store, els, onRoleChange, onDelete, onRetryDetails}) {
        this._store = store;
        this._els = els;
        this._renderedSections = new Map();
        this._lastActive = null;
        els.roleSegments?.forEach(button => button.addEventListener('click', () => {
            if (button.dataset.role) onRoleChange(button.dataset.role);
        }));
        els.deleteUserBtn?.addEventListener('click', onDelete);
        els.detailsSections?.addEventListener('click', event => {
            const button = event.target.closest('[data-user-action]');
            const action = button?.dataset.userAction;
            if (action === 'retry') onRetryDetails?.(button.dataset.userSection);
            if (action === 'more-trainings') store.showMoreTrainings();
            if (action === 'more-weights') store.showMoreWeights();
        });
        els.trainingsBody?.addEventListener('click', event => {
            const row = event.target.closest('[data-training-id]');
            if (row) store.toggleExpandedTraining(row.dataset.trainingId);
        });
        els.deviceTokensBody?.addEventListener('click', event => {
            const button = event.target.closest('[data-device-token]');
            if (button) this._copyDeviceToken(button.dataset.deviceToken, button);
        });
        this._unsubscribe = store.subscribe(() => this.render());
        this.render();
    }

    destroy() {
        this._unsubscribe?.();
        this._unsubscribe = null;
    }

    render() {
        const state = this._store.getState();
        const {active, roleChangeInFlight, deleteInFlight, details, detailsLoading} = state;
        const disabled = !active || roleChangeInFlight || deleteInFlight;
        if (this._els.accountActions) this._els.accountActions.hidden = !active;
        if (this._els.deleteUserBtn) {
            this._els.deleteUserBtn.disabled = disabled;
            this._els.deleteUserBtn.textContent = deleteInFlight && state.deleteUserId === active?.id ? 'Deleting…' : 'Delete user';
        }
        this._els.roleSegments?.forEach(button => {
            const selected = Boolean(active && button.dataset.role === active.role);
            button.disabled = disabled;
            button.classList.toggle('active', selected);
            button.setAttribute('aria-pressed', String(selected));
        });
        if (this._els.userDetail) this._els.userDetail.hidden = !active;
        if (this._els.userSelectionHint) this._els.userSelectionHint.hidden = Boolean(active);
        if (this._els.userEmptyState) this._els.userEmptyState.hidden = Boolean(active);
        if (!active) {
            this._clearSelection();
            this._lastActive = null;
            this._renderedSections.clear();
            return;
        }
        if (this._lastActive !== active) {
            if (this._lastActive?.id !== active.id) {
                if (this._els.panel) this._els.panel.scrollTop = 0;
                if (this._els.accountDetails) this._els.accountDetails.open = false;
                if (this._els.accountActions) this._els.accountActions.open = false;
                for (const element of Object.values(this._els.sectionElements || {})) element.open = false;
                const measurements = this._els.weightBody?.querySelector?.('.weight-measurements');
                if (measurements) measurements.open = false;
                if (this._els.weightBody) this._els.weightBody.scrollTop = 0;
            }
            this._renderHeader(active);
            this._lastActive = active;
        }
        const report = state.diagnostics?.get(active.id);
        this._renderSection('diagnostics', [active.id, report], () => {
            if (!this._els.userDiagnostics) return;
            this._els.userDiagnostics.hidden = false;
            const profileNote = userProfileState(active) === 'unknown'
                ? '<p class="diagnostic-unverified">Profile data was not supplied. Profile checks are incomplete.</p>' : '';
            this._setBody(this._els.userDiagnostics, diagnosticPanelHtml(report, {title: 'Account checks'}) + profileNote);
        });
        const section = key => {
            const status = state.detailSections?.[key];
            const error = status?.error || details?.errors?.[key];
            const loading = status?.loading ?? (detailsLoading || !details);
            const hasCached = status?.loaded ?? (!!details && Object.hasOwn(details, key) && !error);
            return {state: loading ? hasCached ? 'refreshing' : 'loading' : 'ready', error, hasCached};
        };
        const goal = section('goal'), trainings = section('recentTrainings'), weights = section('weightHistory'), devices = section('deviceTokens');
        const content = status => status.hasCached ? {...status, state: 'ready', error: ''} : status;
        const dependencies = status => [content(status).state, content(status).error];
        this._renderSection('goal', [active.id, ...dependencies(goal), details?.goal], () =>
            this._renderGoal({...content(goal), goal: details?.goal}));
        this._renderSection('trainings', [active.id, ...dependencies(trainings), details?.recentTrainings, state.expandedTrainingId, state.trainingsLimit], () =>
            this._renderTrainings({...content(trainings), trainings: details?.recentTrainings, expandedTrainingId: state.expandedTrainingId, limit: state.trainingsLimit}));
        this._renderSection('weights', [active.id, userProfileState(active), ...dependencies(weights), details?.weightHistory, state.weightsLimit], () =>
            this._renderWeight({...content(weights), entries: details?.weightHistory, userHasProfile: userProfileState(active) !== 'missing', limit: state.weightsLimit}));
        this._renderSection('devices', [active.id, ...dependencies(devices), details?.deviceTokens], () =>
            this._renderDeviceTokens({...content(devices), tokens: details?.deviceTokens}));
        for (const [status, body, summary] of [[goal, this._els.goalBody, this._els.goalSummary], [trainings, this._els.trainingsBody, this._els.trainingsCount],
            [weights, this._els.weightBody, this._els.weightSummary], [devices, this._els.deviceTokensBody, this._els.deviceTokensSummary]]) this._renderCachedStatus(body, summary, status);
        this._els.detailsSections?.querySelectorAll('[data-user-action="retry"]').forEach(button => {
            button.disabled = state.detailSections?.[button.dataset.userSection]?.loading ?? detailsLoading;
            button.title = button.disabled ? 'This section is loading.' : '';
        });
    }

    _clearSelection() {
        this._sectionNotes?.clear();
        this._sectionStatuses?.clear();
        if (this._els.accountDetails) this._els.accountDetails.open = false;
        if (this._els.accountActions) this._els.accountActions.open = false;
        for (const element of Object.values(this._els.sectionElements || {})) element.open = false;
        const textFields = ['userNameEl', 'userEmailEl', 'userCreatedEl', 'userUpdatedEl',
            'userActivityEl', 'userWorkoutsEl', 'userAuthList', 'goalSummary', 'trainingsCount',
            'weightSummary', 'deviceTokensSummary'];
        textFields.forEach(key => this._setText(this._els[key], ''));
        for (const key of ['userIdEl', 'profileIdEl']) {
            if (this._els[key]) this._els[key].value = '';
        }
        for (const key of ['userAuthPill', 'goalBody', 'trainingsBody', 'weightBody', 'deviceTokensBody', 'userDiagnostics']) {
            if (this._els[key]) this._els[key].innerHTML = '';
        }
        if (this._els.userActivityEl) this._els.userActivityEl.title = '';
        if (this._els.userDiagnostics) this._els.userDiagnostics.hidden = true;
    }

    _renderHeader(active) {
        const title = active.name || active.email || active.id;
        this._setText(this._els.userNameEl, title);
        if (this._els.userIdEl) this._els.userIdEl.value = active.id;
        if (this._els.profileIdEl) this._els.profileIdEl.value = active.profileId;
        this._setText(this._els.userEmailEl, active.email && active.email !== title ? active.email : '');
        this._setText(this._els.userCreatedEl, formatShortDate(active.createdAt) || '—');
        this._setText(this._els.userUpdatedEl, formatShortDate(active.updatedAt) || '—');
        this._setText(this._els.userActivityEl, relativeDate(active.lastActivity) || 'No date reported');
        if (this._els.userActivityEl) this._els.userActivityEl.title = formatShortDate(active.lastActivity);
        this._setText(this._els.userWorkoutsEl, formatNumber(readUserWorkoutCount(active)));
        const types = active.authTypes || [];
        if (this._els.userAuthPill) {
            this._els.userAuthPill.innerHTML = types.map(type => {
                const {label, svg} = getAuthIcon(type);
                return `<span class="auth-type-icon" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${svg}</span>`;
            }).join('');
        }
        this._setText(this._els.userAuthList, types.length ? types.map(type => getAuthIcon(type).label).join(' · ') : 'No sign-in methods');
    }

    _renderSection(name, dependencies, render) {
        const previous = this._renderedSections.get(name);
        if (previous && dependencies.every((value, index) => value === previous[index])) return;
        render();
        this._renderedSections.set(name, dependencies);
    }

    _renderCachedStatus(body, summary, {state, error, hasCached}) {
        if (!body || !hasCached) return;
        body.setAttribute('aria-busy', String(state === 'refreshing'));
        if (!summary) return;
        const signature = JSON.stringify([state, error || '', this._sectionNotes?.get(summary)]);
        if (this._sectionStatuses?.get(summary) === signature) return;
        (this._sectionStatuses ??= new Map()).set(summary, signature);
        const hadFocus = typeof document !== 'undefined' && summary.contains?.(document.activeElement);
        if (state === 'refreshing') summary.textContent = 'Updating · Previous data shown';
        else if (error) summary.innerHTML = `<span class="user-refresh-error" title="${escapeHtml(error)}">Refresh failed · Previous data shown</span><span class="sr-only">${escapeHtml(error)}</span><button type="button" class="btn user-refresh-retry" data-user-action="retry" data-user-section="${this._sectionKey(body)}">Retry</button>`;
        else summary.textContent = this._sectionNotes?.get(summary) ?? '';
        if (hadFocus) { summary.tabIndex = -1; summary.focus?.({preventScroll: true}); }
    }

    _sectionState(body, summary, {state, error, empty}) {
        if (!body) return true;
        body.setAttribute('aria-busy', String(state === 'loading' || state === 'refreshing'));
        body.classList?.toggle('is-initial-loading', state === 'loading');
        body.classList?.toggle('is-empty', !error && state !== 'loading' && !!empty);
        if (state === 'loading') {
            const isHistory = body === this._els.trainingsBody || body === this._els.weightBody;
            const count = isHistory ? 4 : 2;
            const skeleton = `<div class="skeleton-stack user-section-skeleton" aria-hidden="true">${Array.from({length: count}, () => '<div class="skeleton-row user-detail-skeleton-row"><div class="skeleton-stack"><span class="skeleton skeleton-line skeleton-line--medium"></span><span class="skeleton skeleton-line skeleton-line--short"></span></div></div>').join('')}</div>`;
            this._setBody(body, skeleton + '<span class="sr-only">Loading section…</span>');
            this._setText(summary, 'Loading…');
            return true;
        }
        if (error) {
            this._setBody(body, `<div class="user-section-error" role="status"><strong>Could not load this section</strong><span>${escapeHtml(error)}</span><button class="btn user-retry" type="button" data-user-action="retry" data-user-section="${this._sectionKey(body)}">Try again</button></div>`);
            this._setText(summary, 'Unavailable');
            return true;
        }
        if (empty) {
            this._setBody(body, `<div class="user-section-empty">${escapeHtml(empty)}</div>`);
            const labels = {goal: 'Not set', recentTrainings: 'No recent workouts', weightHistory: 'No records', deviceTokens: 'No devices'};
            this._setSectionNote(summary, labels[this._sectionKey(body)] || 'No records');
            return true;
        }
        return false;
    }

    _renderGoal({state, error, goal}) {
        const {goalBody: body, goalSummary: summary} = this._els;
        if (this._sectionState(body, summary, {state, error, empty: !goal && 'This user has not set a goal yet.'})) return;
        const pills = [this._goalPill('Primary goal', humanizeEnum(goal.primaryGoal) || 'Not specified')];
        if (goal.secondaryGoal) pills.push(this._goalPill('Secondary', humanizeEnum(goal.secondaryGoal)));
        if (goal.target) {
            const target = typeof goal.target === 'number' ? formatNumber(goal.target) : formatShortDate(goal.target) || humanizeEnum(String(goal.target));
            pills.push(this._goalPill('Target', target));
        }
        const tags = goal.personalizations.map(tag => `<span class="goal-tag">${escapeHtml(humanizeEnum(tag))}</span>`).join('');
        const confidence = Number.isFinite(goal.confidence)
            ? `<div class="goal-confidence"><span>Confidence <strong>${Math.round(goal.confidence * 100)}%</strong></span><meter min="0" max="1" value="${goal.confidence}" aria-label="Goal confidence">${Math.round(goal.confidence * 100)}%</meter></div>` : '';
        this._setBody(body, `<div class="goal-row">${pills.join('')}</div>${tags ? `<div class="goal-tags">${tags}</div>` : ''}${confidence}`);
        const note = humanizeEnum(goal.primaryGoal) || 'Goal available';
        this._setSectionNote(summary, note);
    }

    _goalPill(label, value) {
        return `<span class="goal-pill"><span class="pill-label">${escapeHtml(label)}</span>${escapeHtml(value)}</span>`;
    }

    _renderTrainings({state, error, trainings = [], expandedTrainingId, limit = 10}) {
        const {trainingsBody: body, trainingsCount: note} = this._els;
        if (this._sectionState(body, note, {state, error, empty: !trainings.length && 'No workouts recorded in the last 60 days.'})) return;
        const visible = trainings.slice(0, limit);
        const rows = visible.map((training, index) => {
            const key = training.id || `row-${index}`;
            return this._trainingItem(training, index, key === expandedTrainingId, key);
        }).join('');
        const more = trainings.length > limit
            ? `<button type="button" class="btn user-show-more" data-user-action="more-trainings">Show ${Math.min(10, trainings.length - limit)} more workouts <span>${visible.length} of ${trainings.length}</span></button>` : '';
        this._setBody(body, rows + more);
        this._setSectionNote(note, `${trainings.length} workout${trainings.length === 1 ? '' : 's'} · last 60 days`);
    }

    _trainingItem(training, index, isOpen, key = training.id) {
        const stats = [
            this._stat('Duration', formatDuration(training.duration)),
            this._stat('Volume', formatNumber(training.volume, {unit: 'kg', decimals: 1})),
            this._stat('Reps', formatNumber(training.repetitions)),
        ].join('');
        const date = formatShortDate(training.createdAt);
        return `<div class="training-group">
            <button type="button" class="training-row${isOpen ? ' is-open' : ''}" data-training-id="${escapeHtml(key)}" aria-expanded="${isOpen}" aria-controls="training-detail-${index}">
                <span class="training-date"><span class="training-date-rel">${escapeHtml(relativeDate(training.createdAt) || 'Unknown date')}</span><span class="training-date-abs">${escapeHtml(date)}</span></span>
                <span class="training-stats">${stats}</span><span class="training-exercises">${training.exercisesCount} exercise${training.exercisesCount === 1 ? '' : 's'}</span>
                <svg class="training-chevron" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M5 3l4 4-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <div id="training-detail-${index}" class="training-detail"${isOpen ? '' : ' hidden'}>${isOpen ? this._trainingDetail(training) : ''}</div>
        </div>`;
    }

    _stat(label, value) {
        return `<span class="training-stat"><span class="stat-label">${escapeHtml(label)}</span><span class="stat-value">${escapeHtml(value)}</span></span>`;
    }

    _trainingDetail(training) {
        if (!training.exercises.length) return '<div class="user-section-empty">No exercises recorded.</div>';
        return training.exercises.map(exercise => {
            const sets = exercise.iterations.length;
            return `<div class="training-exercise"><div class="training-exercise-name"><span>${escapeHtml(exercise.name)}</span><span class="sets-count">${sets} set${sets === 1 ? '' : 's'}</span></div><div class="training-iterations">${exercise.iterations.map((iteration, index) => this._trainingIteration(iteration, index)).join('')}</div></div>`;
        }).join('');
    }

    _trainingIteration(iteration, index) {
        const weights = [];
        const hasBodyLoad = iteration.bodyWeight > 0 || iteration.extraWeight > 0 || iteration.assistWeight > 0;
        if (iteration.externalWeight !== null && (iteration.externalWeight !== 0 || !hasBodyLoad)) weights.push(`External ${formatNumber(iteration.externalWeight, {unit: 'kg', decimals: 1})}`);
        if (iteration.bodyWeight !== null) {
            const multiplier = iteration.bodyMultiplier !== null ? ` × ${formatNumber(iteration.bodyMultiplier, {decimals: 2})}` : '';
            weights.push(`Body ${formatNumber(iteration.bodyWeight, {unit: 'kg', decimals: 1})}${multiplier}`);
        }
        if (iteration.extraWeight > 0) weights.push(`Extra +${formatNumber(iteration.extraWeight, {unit: 'kg', decimals: 1})}`);
        if (iteration.assistWeight > 0) weights.push(`Assistance −${formatNumber(iteration.assistWeight, {unit: 'kg', decimals: 1})}`);
        const reps = iteration.repetitions === null ? 'Reps not recorded' : `${formatNumber(iteration.repetitions)} reps`;
        return `<div class="training-iteration"><span class="iter-mode">Set ${index + 1}</span><span>${escapeHtml(weights.join(' · ') || 'No weight recorded')}</span><strong>${escapeHtml(reps)}</strong></div>`;
    }

    _renderWeight({state, error, entries = [], userHasProfile, limit = 12}) {
        const {weightBody: body, weightSummary: summary} = this._els;
        if (this._sectionState(body, summary, {state, error, empty: !entries.length && (userHasProfile ? 'No weight records yet.' : 'No profile or weight records yet.')})) return;
        const model = buildWeightHistoryModel(entries);
        const value = model.latestWeight === null ? `${entries.length} measurements` : formatNumber(model.latestWeight, {unit: 'kg', decimals: 1});
        const note = !model.datedCount ? 'Dates unavailable; the latest weight cannot be determined.'
            : model.latestWeight === null ? 'Multiple weights share the latest timestamp; their order is unknown.'
                : `Latest dated weight${model.change === null ? '' : ` · ${this._formatDelta(model.change)} across ${model.datedCount} dated records`}`;
        const overview = `<div class="weight-overview"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(note)}</span></div>`;
        const rows = model.rows.slice(0, limit).map(({entry, delta, timestamp}) => this._weightRow(entry, delta, timestamp)).join('');
        const more = entries.length > limit ? `<button type="button" class="btn user-show-more" data-user-action="more-weights">Show ${Math.min(12, entries.length - limit)} more records <span>${Math.min(limit, entries.length)} of ${entries.length}</span></button>` : '';
        this._setBody(body, `${overview}${this._weightTrend(model)}<details class="weight-measurements"><summary>Measurements (${entries.length})</summary><div class="weight-measurements-body"><div class="weight-table-head"><span>Recorded</span><span>Weight</span><span>Change</span></div>${rows}${more}</div></details>`);
        this._setSectionNote(summary, `${entries.length} record${entries.length === 1 ? '' : 's'}`);
    }

    _weightTrend(model) {
        if (!model.datedCount) return '<p class="weight-trend-note">No dated measurements to plot. All records remain in the table.</p>';
        const coordinate = point => `${(12 + point.x * 276).toFixed(2)},${(8 + point.y * 84).toFixed(2)}`;
        const lines = model.lineSegments.map(segment => `M${segment.map(coordinate).join('L')}`).join('');
        // Round, non-scaling strokes keep markers circular when the plot stretches horizontally.
        const markers = model.points.map(point => `M${coordinate(point)}h0`).join('');
        const firstDate = new Date(model.points[0].timestamp).toISOString();
        const lastDate = new Date(model.points[model.points.length - 1].timestamp).toISOString();
        const intraday = firstDate.slice(0, 10) === lastDate.slice(0, 10);
        const singleTime = model.distinctTimeCount === 1;
        const precision = singleTime || firstDate.slice(0, 19) === lastDate.slice(0, 19) ? 23
            : firstDate.slice(0, 16) === lastDate.slice(0, 16) ? 19 : 16;
        const dateLabel = date => `<span>${escapeHtml(date.slice(0, 10))}${intraday ? `<small>${escapeHtml(date.slice(11, precision))} UTC</small>` : ''}</span>`;
        const dates = singleTime ? dateLabel(firstDate) : dateLabel(firstDate) + dateLabel(lastDate);
        const notes = [];
        if (singleTime) notes.push('Only one measurement time; no time trend yet.');
        if (model.undatedCount) notes.push(`${model.undatedCount} undated ${model.undatedCount === 1 ? 'record is' : 'records are'} shown only in the table.`);
        if (model.ambiguousCount) notes.push(`${model.ambiguousCount} measurements share timestamps; no order is assumed within them.`);
        const axis = [model.axis.max, model.axis.mid, model.axis.min].map(weight => `<span>${formatNumber(weight, {decimals: Number.isInteger(weight * 10) ? 1 : 2})} kg</span>`).join('');
        const label = `Weight history: ${model.datedCount} dated measurements. Dates in UTC; exact values are listed below.`;
        return `<div class="weight-trend"><div class="weight-trend-axis" aria-hidden="true">${axis}</div><svg viewBox="0 0 300 100" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(label)}"><path class="weight-trend-grid" d="M12 8H288M12 50H288M12 92H288"/><path class="weight-trend-line" d="${lines}"/><path class="weight-trend-point" d="${markers}"/></svg><div class="weight-trend-labels${singleTime ? ' weight-trend-labels--single' : ''}">${dates}</div><p class="weight-trend-note">Dates in UTC · Scale adjusts to the recorded range${notes.length ? `. ${escapeHtml(notes.join(' '))}` : ''}</p></div>`;
    }

    _weightRow(entry, delta, timestamp) {
        const date = timestamp === null ? '' : new Date(timestamp).toISOString().replace('T', ' ').replace('Z', ' UTC');
        return `<div class="weight-row"><time class="weight-date" title="${escapeHtml(date)}">${escapeHtml(timestamp === null ? 'Unknown date' : relativeDate(timestamp))}${date ? `<small>${escapeHtml(date)}</small>` : ''}</time><div class="weight-value">${formatNumber(entry.weight, {unit: 'kg', decimals: 1})}</div><span class="weight-delta ${delta === null || Math.abs(delta) < 0.05 ? 'zero' : delta > 0 ? 'up' : 'down'}" title="${delta === null ? 'Change unavailable without an unambiguous earlier measurement' : 'Compared with the previous dated measurement'}">${delta === null ? '—' : this._formatDelta(delta)}</span></div>`;
    }

    _formatDelta(value) {
        if (!Number.isFinite(value) || Math.abs(value) < 0.05) return '±0.0 kg';
        return `${value > 0 ? '+' : '−'}${formatNumber(Math.abs(value), {unit: 'kg', decimals: 1})}`;
    }

    _renderDeviceTokens({state, error, tokens = []}) {
        const {deviceTokensBody: body, deviceTokensSummary: summary} = this._els;
        if (this._sectionState(body, summary, {state, error, empty: !tokens.length && 'No devices registered for push notifications.'})) return;
        this._setBody(body, tokens.map((token, index) => `<div class="device-token-row"><div class="device-token-info"><span class="device-token-label">Device ${index + 1}</span><code class="device-token-value" title="${escapeHtml(token.token)}">${escapeHtml(token.token)}</code></div><span class="device-token-date" title="${escapeHtml(formatShortDate(token.createdAt))}">${escapeHtml(relativeDate(token.createdAt) || 'Unknown date')}</span><button type="button" class="device-token-copy" data-device-token="${escapeHtml(token.token)}" aria-label="Copy token for device ${index + 1}" title="Copy token"><svg viewBox="0 0 14 14" fill="none" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" rx="1.2" stroke="currentColor" stroke-width="1.4"/><path d="M5.5 3.5V2.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></button></div>`).join(''));
        this._setSectionNote(summary, `${tokens.length} device${tokens.length === 1 ? '' : 's'}`);
    }

    async _copyDeviceToken(text, button) {
        let copied = false;
        try {
            await navigator.clipboard.writeText(text);
            copied = true;
        } catch {
            const previousFocus = document.activeElement;
            const textarea = document.createElement('textarea');
            textarea.className = 'clipboard-fallback';
            textarea.value = text;
            textarea.setAttribute('aria-label', 'Device token to copy');
            document.body.appendChild(textarea);
            try {
                textarea.select();
                copied = document.execCommand('copy');
            } catch {
                copied = false;
            } finally {
                textarea.remove();
                previousFocus?.focus({preventScroll: true});
            }
        }
        if (!copied) {
            Toast.show({title: 'Could not copy token', message: 'Select the token text and copy it manually.', type: 'error'});
            return;
        }
        Toast.show({title: 'Token copied'});
        button.classList.add('is-copied');
        setTimeout(() => button.classList.remove('is-copied'), 1200);
    }

    /** Preserve section scroll and keyboard focus while expanding history rows. */
    _setBody(body, html) {
        const focused = body.contains(document.activeElement) ? document.activeElement : null;
        const measurements = body === this._els.weightBody ? body.querySelector?.('.weight-measurements') : null;
        const measurementsState = measurements ? {open: measurements.open, scrollTop: measurements.scrollTop} : null;
        const focusedSummary = focused && focused === measurements?.querySelector('summary');
        const focusKey = focused?.dataset?.trainingId !== undefined ? ['trainingId', focused.dataset.trainingId]
            : focused?.dataset?.userAction ? ['userAction', focused.dataset.userAction] : null;
        const scrollTop = body.scrollTop;
        body.innerHTML = html;
        const nextMeasurements = measurements ? body.querySelector?.('.weight-measurements') : null;
        if (nextMeasurements) {
            nextMeasurements.open = measurementsState.open;
            nextMeasurements.scrollTop = measurementsState.scrollTop;
        }
        const nextSummary = nextMeasurements?.querySelector('summary');
        body.scrollTop = scrollTop;
        if (focusKey || focusedSummary) {
            const requested = focusedSummary ? nextSummary
                : Array.from(body.querySelectorAll('button')).find(button => button.dataset[focusKey[0]] === focusKey[1]);
            const target = body.closest?.('details:not([open])')?.querySelector('summary') || requested;
            if (target) target.focus({preventScroll: true});
            else {
                const fallback = nextSummary || body;
                if (fallback === body) body.tabIndex = -1;
                fallback.focus({preventScroll: true});
            }
        }
    }

    _setText(element, text) {
        if (element && element.textContent !== (text ?? '')) element.textContent = text ?? '';
    }

    _sectionKey(body) {
        return [['goal', this._els.goalBody], ['recentTrainings', this._els.trainingsBody], ['weightHistory', this._els.weightBody], ['deviceTokens', this._els.deviceTokensBody]].find(([, element]) => element === body)?.[0] || '';
    }

    _setSectionNote(element, text) {
        if (!element) return;
        (this._sectionNotes ??= new Map()).set(element, text);
        this._sectionStatuses?.delete(element);
        this._setText(element, text);
    }
}

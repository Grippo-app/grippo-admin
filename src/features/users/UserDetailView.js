import {UserEntity} from '../../domain/user/index.js';
import {escapeHtml, formatIso} from '../../shared/utils/index.js';
import {getAuthIcon} from '../../shared/utils/authIcons.js';
import {formatDuration, formatNumber, formatShortDate, humanizeEnum, relativeDate,} from './userFormatters.js';

export class UserDetailView {
    /**
     * @param {{
     *   store: UserStore,
     *   els: {
     *     userNameEl, userIdEl, userEmailEl, userCreatedEl, userActivityEl, userWorkoutsEl,
     *     userAuthPill, userAuthList,
     *     roleSegments, deleteUserBtn,
     *     detailsSections, goalSummary, goalBody,
     *     trainingsCount, trainingsBody,
     *     weightSummary, weightBody
     *   },
     *   onRoleChange: (role: string) => void,
     *   onDelete: () => void
     * }} deps
     */
    constructor({store, els, onRoleChange, onDelete}) {
        this._store = store;
        this._els = els;

        this._bindRoleSegment(onRoleChange);
        this._els.deleteUserBtn?.addEventListener('click', onDelete);
        this._bindTrainingsDelegation();

        this._unsubscribe = store.subscribe(() => this.render());
        // Сразу применяем initial state чтобы UserDetail был скрыт корректно
        this.render();
    }

    destroy() {
        this._unsubscribe?.();
        this._unsubscribe = null;
    }

    render() {
        const {active, roleChangeInFlight, details, detailsLoading, expandedTrainingId} = this._store.getState();
        if (!active) {
            this._showEmpty();
            this._setActionsDisabled(true);
            return;
        }
        this._setActionsDisabled(roleChangeInFlight);

        if (this._els.userDetail) this._els.userDetail.hidden = false;
        if (this._els.userSelectionHint) this._els.userSelectionHint.hidden = true;

        // User name, ID, email, dates, workout count
        this._setText(this._els.userNameEl, active.name || active.email || active.id);
        this._setValue(this._els.userIdEl, active.id);
        this._setValue(this._els.profileIdEl, active.profileId);
        this._setText(this._els.userEmailEl, active.email);
        this._setText(this._els.userCreatedEl, formatIso(UserEntity.createdAt(active)));
        this._setText(this._els.userUpdatedEl, formatIso(UserEntity.updatedAt(active)));
        this._setText(this._els.userActivityEl, formatIso(UserEntity.lastActivityAt(active)));
        this._setText(this._els.userWorkoutsEl, String(UserEntity.workoutsCount(active)));

        // Auth type indicators
        this._renderAuthIndicator(this._els.userAuthPill, active.authTypes);
        this._renderAuthTypeList(this._els.userAuthList, active.authTypes);

        // Role segment
        this._updateRoleSegment(active.role);

        // Extended details sections
        this._renderDetails({active, details, loading: detailsLoading, expandedTrainingId});
    }

    _setActionsDisabled(disabled) {
        if (this._els.deleteUserBtn) this._els.deleteUserBtn.disabled = disabled;
        this._els.roleSegments?.forEach(btn => {
            btn.disabled = disabled;
        });
    }

    // ── Auth indicator ────────────────────────────────────

    _renderAuthIndicator(el, authTypes = []) {
        if (!el) return;
        const types = UserEntity.getAuthTypes({authTypes});
        if (!types.length) {
            el.innerHTML = '<span class="auth-type-empty">—</span>';
            el.setAttribute('aria-label', 'No auth types');
            return;
        }
        el.innerHTML = types
            .map((authType) => {
                const {label, svg} = getAuthIcon(authType);
                const safeLabel = escapeHtml(label);
                return `<span class="auth-type-icon" title="${safeLabel}" aria-label="${safeLabel}">${svg}</span>`;
            })
            .join('');
        el.setAttribute('aria-label', `Auth types: ${types.join(', ')}`);
    }

    _renderAuthTypeList(el, authTypes = []) {
        if (!el) return;
        const types = UserEntity.getAuthTypes({authTypes});
        if (!types.length) {
            el.textContent = '—';
            return;
        }
        const labels = types.map((authType) => getAuthIcon(authType).label);
        el.textContent = labels.join(' · ');
    }

    // ── Role segment ─────────────────────────────────────

    _bindRoleSegment(onRoleChange) {
        this._els.roleSegments?.forEach(btn => {
            btn.addEventListener('click', () => {
                if (!btn.dataset.role) return;
                onRoleChange(btn.dataset.role);
            });
        });
    }

    _updateRoleSegment(activeRole) {
        this._els.roleSegments?.forEach(btn => {
            btn.classList.toggle('segment--active', btn.dataset.role === activeRole);
        });
    }

    // ── Details sections ─────────────────────────────────

    _renderDetails({active, details, loading, expandedTrainingId}) {
        if (!this._els.detailsSections) return;

        if (loading) {
            this._renderGoal({state: 'loading'});
            this._renderTrainings({state: 'loading'});
            this._renderWeight({state: 'loading'});
            return;
        }
        if (!details) {
            this._renderGoal({state: 'empty'});
            this._renderTrainings({state: 'empty'});
            this._renderWeight({state: 'empty', userHasProfile: Boolean(active.profileId)});
            return;
        }
        this._renderGoal({state: 'ready', goal: details.goal});
        this._renderTrainings({state: 'ready', trainings: details.recentTrainings, expandedTrainingId});
        this._renderWeight({state: 'ready', entries: details.weightHistory});
    }

    _renderGoal({state, goal}) {
        const body = this._els.goalBody;
        const summary = this._els.goalSummary;
        if (!body) return;

        if (state === 'loading') {
            body.innerHTML = '<div class="user-section-loading"></div><div class="user-section-loading"></div>';
            this._setText(summary, '');
            return;
        }
        if (!goal) {
            body.innerHTML = '<div class="user-section-empty">Goal not set</div>';
            this._setText(summary, '');
            return;
        }

        const pills = [];
        pills.push(this._goalPill('Primary', humanizeEnum(goal.primaryGoal)));
        if (goal.secondaryGoal) {
            pills.push(this._goalPill('Secondary', humanizeEnum(goal.secondaryGoal)));
        }
        if (goal.target) {
            pills.push(this._goalPill('Target', formatShortDate(goal.target)));
        }
        if (Number.isFinite(goal.confidence)) {
            pills.push(this._goalPill('Confidence', `${Math.round(goal.confidence * 100)}%`));
        }

        const tags = (goal.personalizations || []).map(tag =>
            `<span class="goal-tag" title="${escapeHtml(tag)}">${escapeHtml(humanizeEnum(tag))}</span>`
        ).join('');

        body.innerHTML = `
            <div class="goal-row">${pills.join('')}</div>
            ${tags ? `<div class="goal-tags">${tags}</div>` : ''}
        `;

        const updated = goal.updatedAt ? `Updated ${relativeDate(goal.updatedAt)}` : '';
        this._setText(summary, updated);
    }

    _goalPill(label, value) {
        return `<span class="goal-pill"><span class="pill-label">${escapeHtml(label)}</span>${escapeHtml(value)}</span>`;
    }

    _renderTrainings({state, trainings, expandedTrainingId}) {
        const body = this._els.trainingsBody;
        const note = this._els.trainingsCount;
        if (!body) return;

        if (state === 'loading') {
            body.innerHTML = '<div class="user-section-loading"></div><div class="user-section-loading"></div><div class="user-section-loading"></div>';
            this._setText(note, '');
            return;
        }
        if (!trainings || trainings.length === 0) {
            body.innerHTML = '<div class="user-section-empty">No workouts in last 60 days</div>';
            this._setText(note, '');
            return;
        }

        const visible = trainings.slice(0, 10);
        body.innerHTML = visible
            .map(t => this._trainingItem(t, t.id === expandedTrainingId))
            .join('');
        const moreLabel = trainings.length > visible.length
            ? `Showing ${visible.length} of ${trainings.length}`
            : `${trainings.length} workout${trainings.length === 1 ? '' : 's'} · last 60 days`;
        this._setText(note, moreLabel);
    }

    _trainingItem(training, isOpen) {
        const stats = [
            this._stat('Duration', formatDuration(training.duration)),
            this._stat('Volume', formatNumber(training.volume, {unit: 'kg', decimals: 1})),
            this._stat('Reps', formatNumber(training.repetitions)),
        ].join('');

        const dateRel = relativeDate(training.createdAt) || '—';
        const dateAbs = formatShortDate(training.createdAt);
        const exCountLabel = `${training.exercisesCount} ex.`;

        const detail = isOpen ? this._trainingDetail(training) : '';

        return `
            <button type="button" class="training-row${isOpen ? ' is-open' : ''}"
                    data-training-id="${escapeHtml(training.id)}"
                    aria-expanded="${isOpen ? 'true' : 'false'}"
                    title="${escapeHtml(dateAbs)}">
                <span class="training-date">
                    <span class="training-date-rel">${escapeHtml(dateRel)}</span>
                    <span class="training-date-abs">${escapeHtml(dateAbs)}</span>
                </span>
                <span class="training-stats">${stats}</span>
                <span class="training-exercises">${escapeHtml(exCountLabel)}</span>
                <svg class="training-chevron" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                    <path d="M5 3l4 4-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </button>
            ${detail}
        `;
    }

    _stat(label, value) {
        return `<span class="training-stat"><span class="stat-label">${escapeHtml(label)}</span><span class="stat-value">${escapeHtml(value)}</span></span>`;
    }

    _trainingDetail(training) {
        if (!training.exercises || training.exercises.length === 0) {
            return `<div class="training-detail"><div class="user-section-empty">No exercises recorded</div></div>`;
        }
        const items = training.exercises.map(ex => this._trainingExercise(ex)).join('');
        return `<div class="training-detail">${items}</div>`;
    }

    _trainingExercise(exercise) {
        const sets = exercise.iterations.length;
        const setsLabel = sets === 0 ? 'no sets' : `${sets} set${sets === 1 ? '' : 's'}`;
        const iters = exercise.iterations.map(it => this._trainingIteration(it)).join('');
        return `
            <div class="training-exercise">
                <div class="training-exercise-name">
                    <span>${escapeHtml(exercise.name)}</span>
                    <span class="sets-count">${escapeHtml(setsLabel)}</span>
                </div>
                ${iters ? `<div class="training-iterations">${iters}</div>` : ''}
            </div>
        `;
    }

    _trainingIteration(iteration) {
        const reps = iteration.repetitions;
        const repsText = reps != null ? `× ${reps}` : '';

        // Pick the most informative weight signal available.
        const w = this._formatIterationWeight(iteration);
        if (!w) {
            return `<span class="training-iteration training-iteration--reps-only">${escapeHtml(repsText || '—')}</span>`;
        }
        return `
            <span class="training-iteration">
                <span class="iter-mode">${escapeHtml(w.mode)}</span>
                <span>${escapeHtml(w.value)}</span>
                <span>${escapeHtml(repsText)}</span>
            </span>
        `;
    }

    _formatIterationWeight(it) {
        if (it.externalWeight != null) {
            return {mode: 'ext', value: formatNumber(it.externalWeight, {unit: 'kg', decimals: 1})};
        }
        if (it.extraWeight != null) {
            return {mode: 'extra', value: `+${formatNumber(it.extraWeight, {unit: 'kg', decimals: 1})}`};
        }
        if (it.assistWeight != null) {
            return {mode: 'assist', value: `-${formatNumber(it.assistWeight, {unit: 'kg', decimals: 1})}`};
        }
        if (it.bodyWeight != null) {
            const mult = it.bodyMultiplier != null ? ` ×${formatNumber(it.bodyMultiplier, {decimals: 2})}` : '';
            return {mode: 'bw', value: `${formatNumber(it.bodyWeight, {unit: 'kg', decimals: 1})}${mult}`};
        }
        return null;
    }

    _bindTrainingsDelegation() {
        const body = this._els.trainingsBody;
        if (!body) return;
        body.addEventListener('click', (e) => {
            const row = e.target.closest('.training-row');
            if (!row) return;
            const id = row.dataset.trainingId;
            if (!id) return;
            this._store.toggleExpandedTraining(id);
        });
    }

    _renderWeight({state, entries, userHasProfile}) {
        const body = this._els.weightBody;
        const summary = this._els.weightSummary;
        if (!body) return;

        if (state === 'loading') {
            body.innerHTML = '<div class="user-section-loading"></div><div class="user-section-loading"></div>';
            this._setText(summary, '');
            return;
        }
        if (!entries || entries.length === 0) {
            body.innerHTML = `<div class="user-section-empty">${userHasProfile === false ? 'No profile yet' : 'No weight records'}</div>`;
            this._setText(summary, '');
            return;
        }

        // Server returns DESC; show the most recent N with a delta vs. the *older* (next-in-list) entry.
        const visible = entries.slice(0, 12);
        body.innerHTML = visible.map((entry, i) => {
            const prev = visible[i + 1] ?? entries[i + 1];
            const delta = prev ? entry.weight - prev.weight : null;
            return this._weightRow(entry, delta);
        }).join('');

        const latest = entries[0];
        const oldest = entries[entries.length - 1];
        const totalDelta = entries.length > 1 ? latest.weight - oldest.weight : 0;
        const summaryText = entries.length > 1
            ? `${formatNumber(latest.weight, {
                unit: 'kg',
                decimals: 1
            })} · ${this._formatDelta(totalDelta)} over ${entries.length} entries`
            : `${formatNumber(latest.weight, {unit: 'kg', decimals: 1})}`;
        this._setText(summary, summaryText);
    }

    _weightRow(entry, delta) {
        const dateRel = relativeDate(entry.createdAt) || '—';
        const dateAbs = formatShortDate(entry.createdAt);
        const deltaHtml = delta === null
            ? '<span class="weight-delta zero">—</span>'
            : this._formatDeltaPill(delta);
        return `
            <div class="weight-row" title="${escapeHtml(dateAbs)}">
                <div class="weight-date">${escapeHtml(dateRel)}</div>
                <div class="weight-value">${escapeHtml(formatNumber(entry.weight, {unit: 'kg', decimals: 1}))}</div>
                ${deltaHtml}
            </div>
        `;
    }

    _formatDelta(value) {
        if (!Number.isFinite(value) || value === 0) return '±0 kg';
        const sign = value > 0 ? '+' : '-';
        return `${sign}${formatNumber(Math.abs(value), {unit: 'kg', decimals: 1})}`;
    }

    _formatDeltaPill(value) {
        if (!Number.isFinite(value) || value === 0) {
            return '<span class="weight-delta zero">±0</span>';
        }
        const cls = value > 0 ? 'up' : 'down';
        const sign = value > 0 ? '+' : '-';
        return `<span class="weight-delta ${cls}">${sign}${formatNumber(Math.abs(value), {decimals: 1})}</span>`;
    }

    // ── Helpers ──────────────────────────────────────────

    _showEmpty() {
        if (this._els.userDetail) this._els.userDetail.hidden = true;
        if (this._els.userSelectionHint) this._els.userSelectionHint.hidden = false;
        // Сбрасываем поля на случай, если потом снова покажем без active
        if (this._els.userNameEl) this._setText(this._els.userNameEl, '');
        if (this._els.userIdEl) this._setValue(this._els.userIdEl, '');
        if (this._els.profileIdEl) this._setValue(this._els.profileIdEl, '');
        if (this._els.userEmailEl) this._setText(this._els.userEmailEl, '');
        if (this._els.userCreatedEl) this._setText(this._els.userCreatedEl, '');
        if (this._els.userUpdatedEl) this._setText(this._els.userUpdatedEl, '');
        if (this._els.userActivityEl) this._setText(this._els.userActivityEl, '');
        if (this._els.userWorkoutsEl) this._setText(this._els.userWorkoutsEl, '');
        if (this._els.userAuthPill) this._els.userAuthPill.innerHTML = '';
        if (this._els.userAuthList) this._setText(this._els.userAuthList, '');
        if (this._els.goalBody) this._els.goalBody.innerHTML = '';
        if (this._els.goalSummary) this._setText(this._els.goalSummary, '');
        if (this._els.trainingsBody) this._els.trainingsBody.innerHTML = '';
        if (this._els.trainingsCount) this._setText(this._els.trainingsCount, '');
        if (this._els.weightBody) this._els.weightBody.innerHTML = '';
        if (this._els.weightSummary) this._setText(this._els.weightSummary, '');
    }

    _setText(el, text) {
        if (el) el.textContent = text ?? '';
    }

    _setValue(el, value) {
        if (!el) return;
        if ('value' in el) el.value = value ?? '';
        else el.textContent = value ?? '';
    }
}

export class ConfirmDialog {

    static init(els) {
        if (ConfirmDialog._initialized) return;
        ConfirmDialog._initialized = true;

        ConfirmDialog._els = els;
        els.cancelBtn?.addEventListener('click', () => ConfirmDialog._resolve(false));
        els.closeBtn?.addEventListener('click', () => ConfirmDialog._resolve(false));
        els.acceptBtn?.addEventListener('click', () => ConfirmDialog._resolve(true));
        els.overlay?.addEventListener('click', (e) => {
            if (e.target === els.overlay) ConfirmDialog._resolve(false);
        });
        document.addEventListener('keydown', (e) => {
            if (!ConfirmDialog._resolver || els.overlay?.hidden) return;
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                ConfirmDialog._resolve(false);
            } else if (e.key === 'Tab') {
                const focusable = ConfirmDialog._focusableElements();
                const first = focusable[0];
                const last = focusable.at(-1);
                if (!first) {
                    e.preventDefault();
                    ConfirmDialog._focusInitial();
                } else if (e.shiftKey && (document.activeElement === first || !els.overlay.contains(document.activeElement))) {
                    e.preventDefault();
                    last.focus();
                } else if (!e.shiftKey && (document.activeElement === last || !els.overlay.contains(document.activeElement))) {
                    e.preventDefault();
                    first.focus();
                }
            }
        });
        document.addEventListener('focusin', (e) => {
            if (ConfirmDialog._resolver && !els.overlay?.hidden && !els.overlay?.contains(e.target)) {
                ConfirmDialog._focusInitial();
            }
        });
    }

    static _initialized = false;
    static _resolver = null;
    static _els = null;
    static _previousFocus = null;

    /**
     * Показывает диалог. Возвращает Promise<boolean>.
     * Если диалог уже открыт — закрывает предыдущий с false и открывает новый.
     */
    static ask({title = 'Confirm', message = '', detail = '', actionLabel = 'Confirm', actionType = 'danger'} = {}) {
        const {overlay, titleEl, messageEl, detailEl, actionLabelEl, acceptBtn} = ConfirmDialog._els || {};
        if (!overlay) return Promise.resolve(false);

        if (!ConfirmDialog._resolver) ConfirmDialog._previousFocus = document.activeElement;

        // Если уже открыт — корректно закрыть предыдущий ask, чтобы старый await не висел
        if (ConfirmDialog._resolver) {
            const prev = ConfirmDialog._resolver;
            ConfirmDialog._resolver = null;
            try { prev(false); } catch { /* ignore */ }
        }

        if (titleEl) titleEl.textContent = title;
        if (messageEl) messageEl.textContent = message;
        if (detailEl) {
            detailEl.hidden = !detail;
            detailEl.textContent = detail;
        }
        if (actionLabelEl) actionLabelEl.textContent = actionLabel;
        if (acceptBtn) {
            acceptBtn.classList.add('btn');
            acceptBtn.classList.remove('danger', 'warn', 'muted');
            if (actionType && actionType !== 'primary') acceptBtn.classList.add(actionType);
        }
        overlay.hidden = false;

        return new Promise(resolve => {
            ConfirmDialog._resolver = resolve;
            ConfirmDialog._focusInitial();
        });
    }

    static _focusableElements() {
        return Array.from(ConfirmDialog._els?.overlay?.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]'
        ) || []).filter(el => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length > 0);
    }

    static _focusInitial() {
        const {overlay, cancelBtn} = ConfirmDialog._els || {};
        const focusable = ConfirmDialog._focusableElements();
        const target = focusable.includes(cancelBtn) ? cancelBtn : focusable[0];
        if (target) target.focus();
        else {
            overlay?.setAttribute('tabindex', '-1');
            overlay?.focus();
        }
    }

    static cancel() {
        if (ConfirmDialog._resolver) ConfirmDialog._resolve(false);
    }

    static _resolve(result) {
        if (ConfirmDialog._els?.overlay) ConfirmDialog._els.overlay.hidden = true;
        for (const key of ['titleEl', 'messageEl', 'detailEl', 'actionLabelEl']) {
            if (ConfirmDialog._els?.[key]) ConfirmDialog._els[key].textContent = '';
        }
        if (ConfirmDialog._els?.detailEl) ConfirmDialog._els.detailEl.hidden = true;
        const r = ConfirmDialog._resolver;
        ConfirmDialog._resolver = null;
        const previousFocus = ConfirmDialog._previousFocus;
        ConfirmDialog._previousFocus = null;
        if (previousFocus?.isConnected && !previousFocus.closest('[hidden], [inert]')) previousFocus.focus();
        r?.(result);
    }
}

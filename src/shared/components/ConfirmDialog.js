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
            if (e.key === 'Escape' && !els.overlay?.hidden) ConfirmDialog._resolve(false);
        });
    }

    static _initialized = false;
    static _resolver = null;
    static _els = null;

    /**
     * Показывает диалог. Возвращает Promise<boolean>.
     * Если диалог уже открыт — закрывает предыдущий с false и открывает новый.
     */
    static ask({title = 'Confirm', message = '', detail = '', actionLabel = 'Confirm', actionType = 'danger'} = {}) {
        const {overlay, titleEl, messageEl, detailEl, actionLabelEl, acceptBtn} = ConfirmDialog._els || {};

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
        if (overlay) overlay.hidden = false;

        return new Promise(resolve => {
            ConfirmDialog._resolver = resolve;
        });
    }

    static _resolve(result) {
        if (ConfirmDialog._els?.overlay) ConfirmDialog._els.overlay.hidden = true;
        const r = ConfirmDialog._resolver;
        ConfirmDialog._resolver = null;
        r?.(result);
    }
}

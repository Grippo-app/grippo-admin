export class Toast {
    static _container = null;
    static _clearers = new Set();

    /** Remove prior session notifications immediately without moving focus. */
    static clear() {
        for (const clear of Toast._clearers) clear();
    }

    static _getContainer() {
        if (!Toast._container?.isConnected) {
            Toast._container = document.createElement('div');
            Toast._container.className = 'toast-container';
            Toast._container.setAttribute('role', 'status');
            Toast._container.setAttribute('aria-live', 'polite');
            Toast._container.setAttribute('aria-atomic', 'false');
            Toast._container.setAttribute('aria-relevant', 'additions text');
            Toast._container.setAttribute('aria-label', 'Notifications');
            document.body.appendChild(Toast._container);
        }
        return Toast._container;
    }

    static show({title = '', message = '', type = 'info', ms} = {}) {
        const previousFocus = document.activeElement;
        const container = Toast._getContainer();
        const el = document.createElement('div');
        el.className = `toast toast--${type}`;
        el.setAttribute('aria-atomic', 'true');
        const titleEl = document.createElement('strong');
        titleEl.className = 'toast__title';
        titleEl.textContent = String(title ?? '');
        el.appendChild(titleEl);
        if (message) {
            const msgEl = document.createElement('span');
            msgEl.className = 'toast__msg';
            msgEl.textContent = String(message);
            el.appendChild(msgEl);
        }
        const dismissBtn = document.createElement('button');
        dismissBtn.type = 'button';
        dismissBtn.className = 'toast__dismiss';
        dismissBtn.setAttribute('aria-label', 'Dismiss notification');
        dismissBtn.textContent = '×';
        el.appendChild(dismissBtn);
        container.appendChild(el);

        let dismissed = false;
        let hovered = false;
        let focused = false;
        let timeout;
        let removalTimeout;
        const duration = Number.isFinite(ms) ? Math.max(0, ms) : type === 'error' ? 7000 : 4000;
        const remove = () => {
            dismissed = true;
            clearTimeout(timeout);
            clearTimeout(removalTimeout);
            el.remove();
            Toast._clearers.delete(remove);
        };
        Toast._clearers.add(remove);
        const dismiss = () => {
            if (dismissed) return;
            dismissed = true;
            clearTimeout(timeout);
            el.classList.remove('toast--visible');
            if (el.contains(document.activeElement) && previousFocus?.isConnected && !previousFocus.disabled
                && !previousFocus.closest('[hidden], [inert]')) previousFocus.focus();
            el.addEventListener('transitionend', remove, {once: true});
            // Reduced motion does not fire transitionend.
            removalTimeout = setTimeout(remove, 350);
        };
        const resume = () => {
            clearTimeout(timeout);
            if (duration && !dismissed && !hovered && !focused) timeout = setTimeout(dismiss, duration);
        };
        const pause = () => clearTimeout(timeout);
        el.addEventListener('mouseenter', () => { hovered = true; pause(); });
        el.addEventListener('mouseleave', () => {
            hovered = false;
            resume();
        });
        el.addEventListener('focusin', () => { focused = true; pause(); });
        el.addEventListener('focusout', (e) => {
            focused = el.contains(e.relatedTarget);
            resume();
        });
        dismissBtn.addEventListener('click', dismiss);
        requestAnimationFrame(() => {
            if (!dismissed) el.classList.add('toast--visible');
        });
        resume();
        return el;
    }
}

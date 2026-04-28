export class Toast {
    static _container = null;

    static _getContainer() {
        if (!Toast._container) {
            Toast._container = document.createElement('div');
            Toast._container.className = 'toast-container';
            document.body.appendChild(Toast._container);
        }
        return Toast._container;
    }

    static show({title = '', message = '', type = 'info', ms = 3000} = {}) {
        const el = document.createElement('div');
        el.className = `toast toast--${type}`;
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
        const container = Toast._getContainer();
        container.appendChild(el);
        // Trigger CSS animation
        requestAnimationFrame(() => el.classList.add('toast--visible'));
        setTimeout(() => {
            el.classList.remove('toast--visible');
            // Remove on transition end OR after a hard timeout (reduce-motion → нет transitionend)
            const safeRemove = () => el.remove();
            el.addEventListener('transitionend', safeRemove, {once: true});
            setTimeout(safeRemove, 600);
        }, ms);
    }
}

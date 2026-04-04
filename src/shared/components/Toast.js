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
        el.innerHTML = `
      <strong class="toast__title">${title}</strong>
      ${message ? `<span class="toast__msg">${message}</span>` : ''}
    `;
        const container = Toast._getContainer();
        container.appendChild(el);
        // Trigger CSS animation
        requestAnimationFrame(() => el.classList.add('toast--visible'));
        setTimeout(() => {
            el.classList.remove('toast--visible');
            el.addEventListener('transitionend', () => el.remove(), {once: true});
        }, ms);
    }
}

/**
 * ConfirmDialog — Promise-based диалог подтверждения.
 *
 * Использование:
 *   const ok = await ConfirmDialog.ask({
 *     title: 'Delete exercise',
 *     message: 'This cannot be undone.',
 *     actionLabel: 'Delete'
 *   });
 *   if (ok) { ... }
 */
export class ConfirmDialog {
  /**
   * @param {{ overlay, title, message, detail, actionLabel, cancelBtn, acceptBtn }} els
   *   — DOM элементы диалога, переданные при инициализации
   */
  static init(els) {
    ConfirmDialog._els = els;
    els.cancelBtn?.addEventListener('click',  () => ConfirmDialog._resolve(false));
    els.closeBtn?.addEventListener('click',   () => ConfirmDialog._resolve(false));
    els.acceptBtn?.addEventListener('click',  () => ConfirmDialog._resolve(true));
    els.overlay?.addEventListener('click', (e) => {
      if (e.target === els.overlay) ConfirmDialog._resolve(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !els.overlay?.hidden) ConfirmDialog._resolve(false);
    });
  }

  static _resolver = null;
  static _els = null;

  static ask({ title = 'Confirm', message = '', detail = '', actionLabel = 'Confirm' } = {}) {
    const { overlay, titleEl, messageEl, detailEl, actionLabelEl } = ConfirmDialog._els || {};
    if (titleEl)       titleEl.textContent       = title;
    if (messageEl)     messageEl.textContent     = message;
    if (detailEl)      detailEl.hidden            = !detail;
    if (detailEl)      detailEl.textContent       = detail;
    if (actionLabelEl) actionLabelEl.textContent  = actionLabel;
    if (overlay)       overlay.hidden             = false;

    return new Promise(resolve => {
      ConfirmDialog._resolver = resolve;
    });
  }

  static _resolve(result) {
    if (ConfirmDialog._els?.overlay) ConfirmDialog._els.overlay.hidden = true;
    ConfirmDialog._resolver?.(result);
    ConfirmDialog._resolver = null;
  }
}

import {diagnosticPanelHtml} from '../../shared/components/diagnosticPresentation.js';

/** Presentation only: never flushes the form or changes the editable record. */
export class ExerciseDiagnosticsView {
    constructor({store, panel}) { this._store = store; this._panel = panel; this._last = null; }

    render() {
        if (!this._panel) return;
        const {current, isNew} = this._store.getState();
        const report = !isNew && current ? this._store.getDiagnosticReport(current.id) : null;
        this._panel.hidden = !current || isNew;
        if (!current || isNew) {
            this._panel.replaceChildren();
            this._last = null;
            return;
        }
        if (this._last?.id === current.id && this._last.report === report) return;
        this._panel.innerHTML = diagnosticPanelHtml(report, {title: 'Saved exercise checks'});
        this._last = {id: current.id, report};
    }
}

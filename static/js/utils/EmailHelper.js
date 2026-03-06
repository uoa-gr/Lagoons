/**
 * EmailHelper - Contact & feedback emails for Lagoons WebGIS
 */

import { escapeHtml } from './helpers.js';

class EmailHelper {
    constructor() {
        this.recipients = ['alexliaskos@geol.uoa.gr', 'evelpidou@geol.uoa.gr'];
        this.replyTo    = 'lagoons-webgis@noreply.com';
    }

    /**
     * Open mail client for a data submission
     */
    openSubmitDataEmail(data = {}) {
        const subject = encodeURIComponent('Lagoons WebGIS – Data Submission');
        const body    = encodeURIComponent(this._buildSubmitBody(data));
        this._open(subject, body);
    }

    /**
     * Open mail client for a bug report
     */
    openBugReportEmail(data = {}) {
        const subject = encodeURIComponent('Lagoons WebGIS – Bug Report');
        const body    = encodeURIComponent(this._buildBugBody(data));
        this._open(subject, body);
    }

    /**
     * Open mail client for a feature suggestion
     */
    openSuggestionEmail(data = {}) {
        const subject = encodeURIComponent('Lagoons WebGIS – Suggestion');
        const body    = encodeURIComponent(this._buildSuggestionBody(data));
        this._open(subject, body);
    }

    // ── Private ────────────────────────────────────────────────────────────────────

    _open(subject, body) {
        const to = this.recipients.join(',');
        window.location.href = `mailto:${to}?subject=${subject}&body=${body}`;
    }

    _buildSubmitBody(d) {
        return [
            'Dear Team,',
            '',
            'I would like to submit data for a lagoon:',
            '',
            `Lagoon Name (EN): ${d.name_en || ''}`,
            `Location: ${d.location_en || ''}`,
            `Island: ${d.island_en || ''}`,
            `Area (km²): ${d.area_km2 || ''}`,
            `RCP 2.6 Inundated: ${d.rcp2_6_inundated || ''}`,
            `RCP 8.5 Inundated: ${d.rcp8_5_inundated || ''}`,
            '',
            'Additional notes:',
            d.notes || '',
            '',
            'Source / Reference:',
            d.reference || '',
            '',
            'Best regards'
        ].join('\n');
    }

    _buildBugBody(d) {
        return [
            'Dear Team,',
            '',
            'I have encountered an issue with the Lagoons WebGIS:',
            '',
            `Description: ${d.description || ''}`,
            `Steps to reproduce: ${d.steps || ''}`,
            `Expected behaviour: ${d.expected || ''}`,
            `Actual behaviour: ${d.actual || ''}`,
            `Browser: ${navigator.userAgent}`,
            '',
            'Best regards'
        ].join('\n');
    }

    _buildSuggestionBody(d) {
        return [
            'Dear Team,',
            '',
            'I have a suggestion for the Lagoons WebGIS:',
            '',
            `Suggestion: ${d.suggestion || ''}`,
            `Reason / benefit: ${d.reason || ''}`,
            '',
            'Best regards'
        ].join('\n');
    }
}

export default EmailHelper;

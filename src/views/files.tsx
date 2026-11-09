import type { Translator } from '../i18n/index.js';
import { campaignUrl } from '../mailchimp/client.js';
import type { ImportSummary } from '../translation/files.js';

/** The summary after "Import translation": one block per campaign and language of the file. */
export function ImportSummaryPanel(props: { t: Translator; summaries: ImportSummary[]; dc: string }) {
  const { t } = props;
  return (
    <div class="import-summary">
      {props.summaries.map((summary) => {
        const url = campaignUrl(props.dc, summary.webId);
        const lines = summary.error
          ? []
          : [
              summary.kept ? t.t('files.summary.kept') : t.t('files.summary.ok', { count: summary.written }),
              summary.skippedChanged ? t.t('files.summary.changed', { count: summary.skippedChanged }) : '',
              summary.counts.untranslated ? t.t('files.summary.untranslated', { count: summary.counts.untranslated }) : '',
              summary.counts.invalid_markup ? t.t('files.summary.invalid', { count: summary.counts.invalid_markup }) : '',
              summary.counts.missing ? t.t('files.summary.missing', { count: summary.counts.missing }) : '',
            ].filter(Boolean);
        const tone = summary.error ? 'error' : summary.written > 0 ? 'success' : 'info';
        return (
          <div class={`notice ${tone}`}>
            <strong>
              {summary.title ?? summary.reference}
              {summary.language ? ` · ${summary.language}` : ''}
            </strong>
            {summary.error ? (
              <p>{t.error(summary.error)}</p>
            ) : (
              <ul>
                {lines.map((line) => (
                  <li>{line}</li>
                ))}
                {summary.written > 0 && summary.skippedChanged + summary.counts.untranslated + summary.counts.invalid_markup + summary.counts.missing > 0 && (
                  <li>{t.t('files.summary.originalKept')}</li>
                )}
              </ul>
            )}
            {url && summary.state && (
              <p>
                <a href={url} target="_blank" rel="noopener">
                  {t.t(`job.${summary.state}`)}
                </a>
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

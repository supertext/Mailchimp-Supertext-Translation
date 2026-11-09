import type { ErrorInfo } from '../i18n/error.js';
import type { MessageKey } from '../i18n/index.js';
import { campaignUrl, type Campaign } from '../mailchimp/client.js';
import type { Account, Job } from '../store/store.js';
import { folderName } from '../translation/folders.js';
import { languageName, resolvedTarget } from '../translation/languages.js';
import { History, JobPanel } from './job.js';
import { ApiKeyHelp, appUrl, Layout, Notice, splitTemplate, type PageContext } from './layout.js';

export interface CampaignRow {
  campaign: Campaign;
  /** Language → web ID of its draft (0 if unknown). */
  drafts: Record<string, number>;
}

export interface TranslatePageProps {
  ctx: PageContext;
  account: Account;
  hasKey: boolean;
  rows?: CampaignRow[];
  offset: number;
  total: number;
  pageSize: number;
  selected?: string;
  job?: Job;
  history: Job[];
  error?: ErrorInfo;
}

const STATUSES = new Set(['save', 'paused', 'schedule', 'sending', 'sent']);

export function TranslatePage(props: TranslatePageProps) {
  const { ctx, account, rows } = props;
  const { t } = ctx;
  const heading = t.t('translate.heading');
  const targets = account.targets;
  const allFolder = account.folderTrigger && Object.keys(account.folders).length > 0 ? folderName(account, 'all') : '';
  const [tipBefore, tipAfter] = splitTemplate(t.t('translate.folderTip'), ['{folder}']);

  return (
    <Layout ctx={ctx} title={heading}>
      <h1>{heading}</h1>
      <p class="intro">{t.t('translate.intro')}</p>

      {!props.hasKey && <NoKey ctx={ctx} />}
      {targets.length === 0 && <NoLanguages ctx={ctx} />}
      {props.error && <Notice tone="error">{t.error(props.error)}</Notice>}
      {!account.appTrigger && <Notice tone="info">{t.t('translate.appOff')}</Notice>}

      {account.appTrigger && targets.length > 0 && rows && (
        <form id="translate-form" class="card">
          <h2>{t.t('translate.step1')}</h2>
          {rows.length === 0 ? (
            <p class="muted">{t.t('translate.empty')}</p>
          ) : (
            <>
              <table class="items">
                <thead>
                  <tr>
                    <th class="check"></th>
                    <th>{t.t('translate.campaign')}</th>
                    <th>{t.t('translate.audience')}</th>
                    {targets.map((code) => (
                      <th>{languageName(code, t.locale)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ campaign, drafts }) => {
                    const status = STATUSES.has(campaign.status) ? campaign.status : 'other';
                    return (
                      <tr>
                        <td class="check">
                          <input
                            type="radio"
                            name="campaign"
                            value={campaign.id}
                            id={`c-${campaign.id}`}
                            checked={campaign.id === props.selected}
                            data-drafts={Object.keys(drafts).join(',')}
                          />
                        </td>
                        <td class="title">
                          <label for={`c-${campaign.id}`}>{campaign.settings.title || campaign.settings.subject_line || campaign.id}</label>
                          <span class="sub">
                            <span class={`badge status-${status}`}>{t.t(`status.${status}` as MessageKey)}</span>
                            {campaign.settings.subject_line && <span class="muted"> {campaign.settings.subject_line}</span>}
                          </span>
                        </td>
                        <td class="muted">{campaign.recipients?.list_name ?? ''}</td>
                        {targets.map((code) => {
                          if (!(code in drafts)) return <td><span class="badge none">{t.t('state.none')}</span></td>;
                          const url = campaignUrl(account.dc, drafts[code]);
                          return (
                            <td>
                              {url ? (
                                <a class="badge done" href={url} target="_blank" rel="noopener">{t.t('state.draft')}</a>
                              ) : (
                                <span class="badge done">{t.t('state.draft')}</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div class="pager">
                <span class="spacer"></span>
                {props.offset > 0 && (
                  <a href={appUrl('/', { offset: Math.max(0, props.offset - props.pageSize) || undefined })}>{t.t('translate.previousPage')}</a>
                )}
                {props.offset + props.pageSize < props.total && (
                  <a href={appUrl('/', { offset: props.offset + props.pageSize })}>{t.t('translate.nextPage')}</a>
                )}
              </div>
            </>
          )}

          <h2>{t.t('translate.step2')}</h2>
          <p class="muted">
            {account.sourceLanguage
              ? t.t('translate.from', { language: languageName(account.sourceLanguage, t.locale) })
              : t.t('translate.fromAuto')}
          </p>
          <div class="languages">
            {targets.map((code) => (
              <label class="language">
                <input type="checkbox" name="language" value={code} checked />
                <span>{languageName(code, t.locale)}</span>
                {resolvedTarget(code, account.languageCodes) ? (
                  <code>{resolvedTarget(code, account.languageCodes)}</code>
                ) : (
                  <span class="warning-text">{t.t('translate.notMapped')}</span>
                )}
              </label>
            ))}
          </div>

          <label class="inline overwrite">
            <input type="checkbox" id="overwrite" name="overwrite" />
            {t.t('translate.overwrite')}
          </label>
          <p class="help" id="overwrite-hint">
            {t.t('translate.overwriteHint')}
          </p>
          <div id="overwrite-warning" class="notice warning" hidden>
            {t.t('translate.overwriteWarning')}
          </div>

          <div class="actions">
            <button
              type="submit"
              class="primary"
              id="translate-button"
              disabled={!props.hasKey}
              data-label={t.t('translate.submit')}
              data-label-one={t.t('translate.submitCount.one')}
              data-label-other={t.t('translate.submitCount.other')}
              data-starting={t.t('translate.starting')}
              data-select={t.t('translate.selectSomething')}
            >
              {t.t('translate.submit')}
            </button>
            <span id="form-message" class="muted" role="status"></span>
          </div>
          {allFolder && (
            <p class="help tip">
              {tipBefore}
              <strong>{allFolder}</strong>
              {tipAfter}
            </p>
          )}
        </form>
      )}

      {account.appTrigger && targets.length > 0 && rows && rows.length > 0 && <ExportCard ctx={ctx} account={account} />}
      {targets.length > 0 && <ImportCard ctx={ctx} />}

      <section id="job-panel" data-job={props.job?.status === 'running' ? props.job.id : undefined}>
        {props.job && <JobPanel t={t} job={props.job} dc={account.dc} />}
      </section>
      <History t={t} jobs={props.history} />
    </Layout>
  );
}

function NoKey(props: { ctx: PageContext }) {
  const { t } = props.ctx;
  const [before, after] = splitTemplate(t.t('translate.noKey.text'), ['{settings}']);
  return (
    <Notice tone="warning">
      <strong>{t.t('translate.noKey.heading')}</strong>
      <p>
        {before}
        <a href="/settings">{t.t('translate.noKey.settings')}</a>
        {after}
      </p>
      <ApiKeyHelp t={t} />
    </Notice>
  );
}

function NoLanguages(props: { ctx: PageContext }) {
  const { t } = props.ctx;
  const [before, after] = splitTemplate(t.t('translate.noLanguages.text'), ['{settings}']);
  return (
    <Notice tone="info">
      <strong>{t.t('translate.noLanguages.heading')}</strong>
      <p>
        {before}
        <a href="/settings">{t.t('translate.noKey.settings')}</a>
        {after}
      </p>
    </Notice>
  );
}

/** "Export for translation": the campaign chosen in the list above, as XLIFF or HTML (public/app.js downloads it). */
function ExportCard(props: { ctx: PageContext; account: Account }) {
  const { t } = props.ctx;
  return (
    <section id="export-card" class="card" data-select-one={t.t('files.export.selectOne')}>
      <h2>{t.t('files.export.heading')}</h2>
      <p class="muted">{t.t('files.export.text')}</p>
      <fieldset class="plain">
        <legend>{t.t('files.format')}</legend>
        <label class="inline">
          <input type="radio" name="file-format" value="xliff" checked />
          {t.t('files.format.xliff')}
        </label>
        <label class="inline">
          <input type="radio" name="file-format" value="html" />
          {t.t('files.format.html')}
        </label>
      </fieldset>
      <fieldset class="plain">
        <legend>{t.t('files.languages')}</legend>
        <div class="languages">
          {props.account.targets.map((code) => (
            <label class="language">
              <input type="checkbox" name="export-language" value={code} checked />
              <span>{languageName(code, t.locale)}</span>
              {/* Unmapped languages don't block an export: the file names the Mailchimp code. */}
              <code>{resolvedTarget(code, props.account.languageCodes) ?? code.replace(/_/g, '-')}</code>
            </label>
          ))}
        </div>
      </fieldset>
      <div class="actions">
        <button type="button" class="primary" id="export-button">
          {t.t('files.download')}
        </button>
        <span id="export-message" class="muted" role="status"></span>
      </div>
    </section>
  );
}

/** "Import translation": upload a translated file; the summary comes back as HTML. */
function ImportCard(props: { ctx: PageContext }) {
  const { t } = props.ctx;
  return (
    <form id="import-form" class="card" enctype="multipart/form-data" data-too-large={t.t('error.fileTooLarge')} data-importing={t.t('files.importing')}>
      <h2>{t.t('files.import.heading')}</h2>
      <p class="muted">{t.t('files.import.text')}</p>
      <label class="field">
        <span>{t.t('files.file')}</span>
        <input type="file" name="file" accept=".xlf,.xliff,.html,.htm" required />
      </label>
      <label class="inline">
        <input type="checkbox" name="includeChanged" value="1" />
        {t.t('files.includeChanged')}
      </label>
      <label class="inline">
        <input type="checkbox" name="overwrite" value="1" />
        {t.t('translate.overwrite')}
      </label>
      <div class="actions">
        <button type="submit" class="primary" id="import-button">
          {t.t('files.import.submit')}
        </button>
        <span id="import-message" class="muted" role="status"></span>
      </div>
      <div id="import-result"></div>
    </form>
  );
}

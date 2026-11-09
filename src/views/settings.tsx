import type { ApiKeyCheck } from 'supertext-sdk/v1';
import type { Translator } from '../i18n/index.js';
import type { Account } from '../store/store.js';
import { Reporting } from '../reporting.js';
import { folderName } from '../translation/folders.js';
import {
  isLanguage,
  LANGUAGE_CODES,
  languageName,
  resolvedTarget,
  suggestedTarget,
  supertextSource,
  supportsPoliteness,
  targetOptions,
} from '../translation/languages.js';
import { releaseUrl, VERSION } from '../version.js';
import { API_KEY_URL, ApiKeyHelp, Layout, Notice, SIGNUP_URL, splitTemplate, type PageContext } from './layout.js';

/** The key check result in the interface language (the Commando Center's wording). */
export function keyCheckText(t: Translator, check: ApiKeyCheck): string {
  return t.t(`keyCheck.${check.status}`, { status: check.httpStatus ?? check.errorCode ?? '?' });
}

/** The key check message, with "supertext.com" and "supertext.com → Integrations → API" as links (new tab). */
export function KeyCheckMessage(props: { t: Translator; check: ApiKeyCheck }) {
  const parts = keyCheckText(props.t, props.check).split(/(supertext\.com → Integrations → API|supertext\.com)/);
  return (
    <span class={`key-check ${props.check.status}`}>
      {parts.map((part) =>
        part === 'supertext.com → Integrations → API' ? (
          <a href={API_KEY_URL} target="_blank" rel="noopener">
            {part}
          </a>
        ) : part === 'supertext.com' ? (
          <a href={SIGNUP_URL} target="_blank" rel="noopener">
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </span>
  );
}

/** The source language as Supertext knows it, or null when Supertext doesn't translate from it. */
function sourceOk(account: Account): boolean {
  try {
    supertextSource(account.sourceLanguage, account.languageCodes);
    return true;
  } catch {
    return false;
  }
}

export interface SettingsPageProps {
  ctx: PageContext;
  account: Account;
  /** A key is set on the server (SUPERTEXT_API_KEY). */
  serverKey: boolean;
  /** Version reports are on for this account (the setting and SUPERTEXT_VERSION_REPORTS). */
  reportsEnabled: boolean;
  /** SUPERTEXT_VERSION_REPORTS decides, so the checkbox can't be changed. */
  reportsFixed: boolean;
  /** A review service is configured (SUPERTEXT_REVIEW_URL isn't ''): the Translation review column is shown. */
  reviewAvailable: boolean;
  saved?: boolean;
  invalidCodes?: string;
  foldersError?: string;
  bothOff?: boolean;
}

export function SettingsPage(props: SettingsPageProps) {
  const { ctx, account } = props;
  const { t } = ctx;
  const heading = t.t('settings.heading');
  const [versionBefore, versionAfter] = splitTemplate(t.t('settings.about.version'), ['{version}']);
  const [accountBefore, accountAfter] = splitTemplate(t.t('settings.connection.account'), ['{account}']);
  const example = account.targets[0] ?? 'de';
  const [foldersBefore, foldersAfter] = splitTemplate(t.t('settings.start.foldersHint'), ['{folder}']);
  const exampleFolder = folderName({ ...account, folderLocale: t.locale }, example);
  // Chosen languages first, in their order; then all others by name.
  const others = LANGUAGE_CODES.filter((code) => !account.targets.includes(code)).sort((a, b) =>
    languageName(a, t.locale).localeCompare(languageName(b, t.locale), t.locale),
  );
  const ordered = [...account.targets.filter(isLanguage), ...others];
  const unmapped = account.targets.filter((code) => !resolvedTarget(code, account.languageCodes));
  const noPoliteness = account.targets.filter((code) => {
    const target = resolvedTarget(code, account.languageCodes);
    return target && !supportsPoliteness(target);
  });
  const names = (codes: string[]) => codes.map((code) => languageName(code, t.locale)).join(', ');
  const check = Reporting.lastCheck(account);
  const options = targetOptions(t.locale);

  return (
    <Layout ctx={ctx} title={heading}>
      <h1>{heading}</h1>
      {props.saved && !props.invalidCodes && !props.foldersError && !props.bothOff && (
        <Notice tone="success">{t.t('settings.saved')}</Notice>
      )}
      {props.invalidCodes && <Notice tone="warning">{t.t('settings.invalidCodes', { codes: props.invalidCodes })}</Notice>}
      {props.foldersError && <Notice tone="warning">{t.t('settings.foldersFailed', { reason: props.foldersError })}</Notice>}
      {props.bothOff && <Notice tone="warning">{t.t('settings.start.none')}</Notice>}
      {unmapped.length > 0 && <Notice tone="warning">{t.t('settings.languages.unmapped', { languages: names(unmapped) })}</Notice>}
      {account.sourceLanguage && !sourceOk(account) && (
        <Notice tone="warning">
          {t.t('settings.languages.sourceUnsupported', { language: languageName(account.sourceLanguage, t.locale) })}
        </Notice>
      )}

      <form method="post" action="/settings" class="settings">
        <input type="hidden" name="csrf" value={ctx.csrf} />

        <section class="card">
          <h2>{t.t('settings.apiKey.heading')}</h2>
          <label class="field">
            <span>{t.t('settings.apiKey.label')}</span>
            <input
              type="password"
              name="apiKey"
              autocomplete="off"
              placeholder={account.apiKey ? t.t('settings.apiKey.placeholderSaved') : t.t('settings.apiKey.placeholder')}
            />
          </label>
          <ApiKeyHelp t={t} />
          {!account.apiKey && props.serverKey && <p class="muted">{t.t('settings.apiKey.server')}</p>}
          {account.apiKey && (
            <label class="inline">
              <input type="checkbox" name="removeKey" value="1" />
              {t.t('settings.apiKey.remove')}
            </label>
          )}
          {check && (
            <p class="key-check-line" id="key-check">
              <strong>{t.t('settings.keyCheck.label')}</strong>{' '}
              <KeyCheckMessage t={t} check={check} />{' '}
              <span class="muted">
                {t.t('settings.keyCheck.at', {
                  time: new Date(check.checkedAt).toLocaleString(t.locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }),
                })}
              </span>
            </p>
          )}
          <div class="actions">
            <button type="button" id="test-button" data-testing={t.t('settings.testing')}>
              {t.t('settings.test')}
            </button>
            <span id="test-result" role="status"></span>
          </div>
        </section>

        <section class="card">
          <h2>{t.t('settings.languages.heading')}</h2>
          <p class="help">{t.t('settings.languages.text')}</p>
          <label class="field">
            <span>{t.t('settings.languages.source')}</span>
            <select name="sourceLanguage">
              <option value="" selected={!account.sourceLanguage}>
                {t.t('settings.languages.auto')}
              </option>
              {[...LANGUAGE_CODES]
                .sort((a, b) => languageName(a, t.locale).localeCompare(languageName(b, t.locale), t.locale))
                .map((code) => (
                  <option value={code} selected={account.sourceLanguage === code}>
                    {languageName(code, t.locale)}
                  </option>
                ))}
            </select>
          </label>
          <h3>{t.t('settings.languages.targets')}</h3>
          <p class="help">{t.t('settings.languages.codeHint')}</p>
          <table class="codes" id="targets">
            <thead>
              <tr>
                <th></th>
                <th></th>
                <th>{t.t('settings.languages.code')}</th>
                {props.reviewAvailable && <th>{t.t('settings.languages.review')}</th>}
              </tr>
            </thead>
            <tbody>
              {ordered.map((code) => {
                const chosen = account.targets.includes(code);
                const saved = account.languageCodes[code];
                const selected = saved ?? suggestedTarget(code) ?? '';
                const known = options.some((option) => option.code === selected);
                return (
                  <tr class={`${chosen ? 'chosen' : 'other'}${selected ? '' : ' missing'}`}>
                    <td class="check">
                      <input type="checkbox" name="target" value={code} id={`t-${code}`} checked={chosen} />
                    </td>
                    <td>
                      <label for={`t-${code}`}>{languageName(code, t.locale)}</label> <code class="muted">{code}</code>
                    </td>
                    <td>
                      <select name={`code:${code}`} aria-label={`${t.t('settings.languages.code')}: ${languageName(code, t.locale)}`}>
                        {!selected && (
                          <option value="" selected>
                            {t.t('settings.languages.choose')}
                          </option>
                        )}
                        {selected && !known && (
                          <option value={selected} selected>
                            {selected}
                          </option>
                        )}
                        {options.map((option) => (
                          <option value={option.code} selected={option.code === selected}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    {props.reviewAvailable && (
                      <td class="review">
                        <label class="inline">
                          <input
                            type="checkbox"
                            name="review"
                            value={code}
                            checked={account.reviewLanguages.includes(code)}
                            aria-label={`${t.t('settings.languages.review')}: ${languageName(code, t.locale)}`}
                          />
                          <span class="review-label">{t.t('settings.languages.review')}</span>
                        </label>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {props.reviewAvailable && <p class="help">{t.t('settings.languages.reviewHint')}</p>}
        </section>

        <section class="card">
          <h2>{t.t('settings.start.heading')}</h2>
          <label class="inline strong">
            <input type="checkbox" name="folderTrigger" value="1" checked={account.folderTrigger} />
            {t.t('settings.start.folders')}
          </label>
          <p class="help">
            {foldersBefore}
            <strong>{exampleFolder}</strong>
            {foldersAfter}
          </p>
          <p class="help warning-text">{t.t('settings.start.foldersWarning')}</p>
          <label class="inline strong">
            <input type="checkbox" name="appTrigger" value="1" checked={account.appTrigger} />
            {t.t('settings.start.app')}
          </label>
          <p class="help">{t.t('settings.start.appHint')}</p>
        </section>

        <section class="card">
          <h2>{t.t('settings.audience.heading')}</h2>
          <label class="inline">
            <input type="checkbox" name="limitOriginal" value="1" checked={account.limitOriginal} />
            {t.t('settings.audience.limit')}
          </label>
          <p class="help">{t.t('settings.audience.limitHint')}</p>
        </section>

        <section class="card">
          <h2>{t.t('settings.style.heading')}</h2>
          <label class="field">
            <span>{t.t('settings.style.label')}</span>
            <select name="tone">
              {(['default', 'more', 'less'] as const).map((tone) => (
                <option value={tone} selected={account.tone === tone}>
                  {t.t(`settings.style.${tone}`)}
                </option>
              ))}
            </select>
          </label>
          {account.tone !== 'default' && noPoliteness.length > 0 && (
            <p class="help">{t.t('settings.style.notOffered', { languages: names(noPoliteness) })}</p>
          )}
        </section>

        <section class="card">
          <h2>{t.t('settings.reports.heading')}</h2>
          <label class="inline">
            <input
              type="checkbox"
              name="versionReports"
              value="1"
              checked={props.reportsEnabled}
              disabled={props.reportsFixed}
            />
            {t.t('settings.reports.label')}
          </label>
          <p class="help">{t.t('settings.reports.help')}</p>
          {props.reportsFixed && <p class="help muted">{t.t('settings.reports.fixed')}</p>}
        </section>

        <div class="actions">
          <button type="submit" class="primary">
            {t.t('settings.save')}
          </button>
        </div>
      </form>

      <section class="card connection">
        <h2>{t.t('settings.connection.heading')}</h2>
        <p>
          {accountBefore}
          <strong>{account.accountName || account.accountId}</strong>
          {/\.$/.test(account.accountName) && accountAfter.startsWith('.') ? accountAfter.slice(1) : accountAfter}
        </p>
        <form method="post" action="/disconnect" id="disconnect-form" data-confirm={t.t('settings.connection.confirm')}>
          <input type="hidden" name="csrf" value={ctx.csrf} />
          <button type="submit" class="danger">
            {t.t('settings.connection.disconnect')}
          </button>
        </form>
        <p class="help">{t.t('settings.connection.disconnectHint')}</p>
      </section>

      <section class="card about">
        <h2>{t.t('settings.about.heading')}</h2>
        <p>
          {versionBefore}
          <a href={releaseUrl()} target="_blank" rel="noopener">
            {VERSION || '?'}
          </a>
          {versionAfter}
        </p>
      </section>
    </Layout>
  );
}

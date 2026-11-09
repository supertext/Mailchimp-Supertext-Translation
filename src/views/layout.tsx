import type { Child } from 'hono/jsx';
import { LOCALES, type Translator } from '../i18n/index.js';

/** What every page needs: the language, the current page, the CSRF token and the connected account. */
export interface PageContext {
  t: Translator;
  page: 'connect' | 'translate' | 'settings';
  /** Empty on the connect page (no session). */
  csrf: string;
  accountName?: string;
}

export const SIGNUP_URL = 'https://www.supertext.com/person/en/account/signin';
export const API_KEY_URL = 'https://www.supertext.com/en/integrations/api';

const LANGUAGE_NAMES: Record<string, string> = { en: 'English', de: 'Deutsch', fr: 'Français', it: 'Italiano' };

/** A link within the app. */
export function appUrl(path: string, params: Record<string, string | number | undefined> = {}): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') query.set(key, String(value));
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

export function Layout(props: { ctx: PageContext; title: string; children: Child }) {
  const { ctx } = props;
  const { t } = ctx;
  const here = ctx.page === 'settings' ? '/settings' : '/';
  return (
    <html lang={t.locale}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title}</title>
        <link rel="preload" href="/static/fonts/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin="" />
        <link rel="stylesheet" href="/static/app.css" />
        <link rel="icon" href="/static/favicon.svg" type="image/svg+xml" />
        <meta name="theme-color" content="#003230" />
      </head>
      <body data-locale={t.locale} data-csrf={ctx.csrf}>
        <header class="topbar">
          <a class="brand" href="/" aria-label="Supertext × Mailchimp">
            <img src="/static/supertext-logo.svg" alt="Supertext" width="122" height="22" />
            <span class="for">× Mailchimp</span>
          </a>
          {ctx.page !== 'connect' && (
            <nav class="tabs">
              <a href="/" class={ctx.page === 'translate' ? 'tab active' : 'tab'}>
                {t.t('nav.translate')}
              </a>
              <a href="/settings" class={ctx.page === 'settings' ? 'tab active' : 'tab'}>
                {t.t('nav.settings')}
              </a>
            </nav>
          )}
          <span class="spacer"></span>
          {ctx.accountName && <span class="account">{ctx.accountName}</span>}
          <nav class="langs" aria-label={t.t('nav.language')}>
            {LOCALES.map((locale) => (
              <a href={appUrl(here, { lang: locale })} class={locale === t.locale ? 'active' : ''} lang={locale} title={LANGUAGE_NAMES[locale]}>
                {locale.toUpperCase()}
              </a>
            ))}
          </nav>
        </header>
        <main class="page">{props.children}</main>
        <script src="/static/app.js" defer></script>
      </body>
    </html>
  );
}

/** "No Supertext account yet? Create one at supertext.com. Generate your API key at …" with links. */
export function ApiKeyHelp(props: { t: Translator }) {
  const { t } = props;
  const [before, middle, after] = splitTemplate(t.t('apiKeyHelp.text'), ['{signup}', '{apiKey}']);
  return (
    <p class="help">
      {before}
      <a href={SIGNUP_URL} target="_blank" rel="noopener">
        {t.t('apiKeyHelp.signup')}
      </a>
      {middle}
      <a href={API_KEY_URL} target="_blank" rel="noopener">
        {t.t('apiKeyHelp.apiKey')}
      </a>
      {after}
    </p>
  );
}

/** Splits "a {x} b {y} c" at the given placeholders, in order. */
export function splitTemplate(text: string, placeholders: string[]): string[] {
  const parts: string[] = [];
  let rest = text;
  for (const placeholder of placeholders) {
    const index = rest.indexOf(placeholder);
    if (index < 0) {
      parts.push(rest);
      rest = '';
      continue;
    }
    parts.push(rest.slice(0, index));
    rest = rest.slice(index + placeholder.length);
  }
  parts.push(rest);
  return parts;
}

export function Notice(props: { tone: 'info' | 'success' | 'warning' | 'error'; children: Child }) {
  return <div class={`notice ${props.tone}`}>{props.children}</div>;
}

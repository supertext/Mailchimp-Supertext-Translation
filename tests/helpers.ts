import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { MemoryStore } from '../src/store/store.js';
import { createMailchimpStandin } from './standin/mailchimp.js';
import { createSupertextStandin } from './standin/supertext.js';

export const ACCOUNT_ID = '48210377';

/** The app wired to the stand-in Mailchimp and Supertext APIs, with an in-memory store. */
export function setup(env: Record<string, string> = {}) {
  const mailchimp = createMailchimpStandin('https://mailchimp.test');
  const supertext = createSupertextStandin();
  const store = new MemoryStore();
  /** Every request to Supertext or its review service (method and URL), in order. */
  const supertextRequests: string[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const host = new URL(request.url).host;
    if (host === 'mailchimp.test') return mailchimp.handle(request);
    if (host === 'supertext.test' || host === 'review.test') supertextRequests.push(`${request.method} ${request.url}`);
    // review.test: the review service (it speaks the same API, so the stand-in answers it too).
    if (host === 'supertext.test' || host === 'review.test' || host === 'center.test') return supertext.handle(request);
    throw new Error(`Unexpected request to ${request.url}`);
  }) as typeof fetch;
  const config = loadConfig({
    APP_URL: 'https://app.test',
    MAILCHIMP_CLIENT_ID: 'client-id',
    MAILCHIMP_CLIENT_SECRET: 'client-secret',
    MAILCHIMP_LOGIN_BASE: 'https://mailchimp.test',
    SESSION_SECRET: 'session-secret',
    SUPERTEXT_API_ENDPOINT: 'https://supertext.test/v1/',
    SUPERTEXT_API_KEY: 'server-key',
    SUPERTEXT_REVIEW_URL: 'https://review.test/v1/',
    // Version reports go to the stand-in (supertext.reports), never to the live Commando Center.
    SUPERTEXT_REPORT_URL: 'https://center.test/api/v1/report',
    FOLDER_POLL_SECONDS: '0',
    ...env,
  });
  const jobs: Promise<unknown>[] = [];
  const onJob = (done: Promise<unknown>) => jobs.push(done);
  const app = createApp({ config, store, fetch: fetchFn, onJob });
  let cookies: Record<string, string> = {};
  const cookieHeader = () =>
    Object.entries(cookies)
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  const remember = (response: Response) => {
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const [name, ...value] = pair.split('=');
      if (/Max-Age=0/i.test(line) || value.join('=') === '') delete cookies[name];
      else cookies[name] = value.join('=');
    }
    return response;
  };

  /** A request as the browser would send it (cookies kept between requests). */
  const request = async (path: string, init: RequestInit = {}) =>
    remember(
      await app.request(`https://app.test${path}`, {
        ...init,
        headers: { Cookie: cookieHeader(), 'Accept-Language': 'en', ...(init.headers ?? {}) },
      }),
    );

  /** Connects the stand-in Mailchimp account through the OAuth flow. */
  const connect = async () => {
    const start = await request('/oauth/start');
    const authorize = await mailchimp.handle(new Request(start.headers.get('location')!));
    const callback = new URL(authorize.headers.get('location')!);
    return request(callback.pathname + callback.search);
  };

  /** The CSRF token of the current session (as the pages embed it). */
  const csrf = async () => {
    const page = await (await request('/settings')).text();
    return /data-csrf="([^"]+)"/.exec(page)?.[1] ?? '';
  };

  const api = async (method: string, path: string, body?: unknown) =>
    request(path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': await csrf() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  /** Saves settings through the form, as the settings page does. */
  const saveSettings = async (fields: [string, string][]) => {
    const form = new URLSearchParams([['csrf', await csrf()], ...fields]);
    return request('/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
  };

  const settle = async () => {
    while (jobs.length) await Promise.all(jobs.splice(0));
  };
  const clearCookies = () => {
    cookies = {};
  };
  return { app, mailchimp, supertext, supertextRequests, store, config, request, connect, csrf, api, saveSettings, settle, onJob, fetchFn, clearCookies };
}

/** The usual settings: German and French, folders and app, original limited. */
export const STANDARD_SETTINGS: [string, string][] = [
  ['sourceLanguage', 'en'],
  ['target', 'de'],
  ['target', 'fr'],
  ['code:de', 'de-CH'],
  ['code:fr', 'fr-CH'],
  ['folderTrigger', '1'],
  ['appTrigger', '1'],
  ['limitOriginal', '1'],
  ['tone', 'default'],
  ['versionReports', '1'],
];

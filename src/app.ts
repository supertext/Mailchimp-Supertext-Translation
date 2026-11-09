import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { SESSION_COOKIE, Sessions, STATE_COOKIE } from './auth/session.js';
import type { Config } from './config.js';
import { errorInfo, LocalizedError, type ErrorInfo } from './i18n/error.js';
import { localeFromRequest, translator, type Translator } from './i18n/index.js';
import { authorizeUrl, exchangeCode, MailchimpClient } from './mailchimp/client.js';
import { SupertextClient } from './supertext/client.js';
import { defaultAccount, type Account, type Store } from './store/store.js';
import { removeFolders, syncFolders } from './translation/folders.js';
import { exportFile, importFile, refuseLargeUpload } from './translation/files.js';
import { startJob, type JobDeps } from './translation/jobs.js';
import { isLanguage, supertextCodeOf } from './translation/languages.js';
import { Reporting } from './reporting.js';
import { ConnectPage } from './views/connect.js';
import { ImportSummaryPanel } from './views/files.js';
import { JobPanel } from './views/job.js';
import { appUrl, type PageContext } from './views/layout.js';
import { KeyCheckMessage, keyCheckText, SettingsPage } from './views/settings.js';
import type { ApiKeyCheck } from 'supertext-sdk/v1';
import { TranslatePage, type CampaignRow } from './views/translate.js';

export interface AppDeps {
  config: Config;
  store: Store;
  /** Injected for tests. */
  fetch?: typeof fetch;
  /** Called with each job's (and background report's) completion promise (tests wait on it). */
  onJob?: (done: Promise<unknown>) => void;
}

const PAGE_SIZE = 25;

/** Everything the routes and the folder poller share. */
export function services(deps: AppDeps) {
  const { config } = deps;
  const mailchimp = (account: Account) =>
    new MailchimpClient({
      apiEndpoint: config.mailchimpApiBase || account.apiEndpoint,
      accessToken: account.accessToken,
      fetch: deps.fetch,
    });
  const supertext = (account: Account) =>
    new SupertextClient({
      apiKey: account.apiKey || config.supertextApiKey,
      endpoint: config.supertextEndpoint || undefined,
      reviewEndpoint: config.reviewUrl,
      fetch: deps.fetch,
    });
  const reporting = new Reporting({ config, store: deps.store, fetch: deps.fetch, onTask: deps.onJob });
  const jobDeps: JobDeps & { onJob?: (done: Promise<unknown>) => void } = {
    store: deps.store,
    mailchimp,
    supertext,
    onJob: deps.onJob,
    onAuthenticationFailed: (account, status) => void reporting.inBackground(account, 'authenticationFailed', status),
  };
  return { mailchimp, supertext, jobDeps, reporting };
}

export function createApp(deps: AppDeps) {
  const { config, store } = deps;
  const app = new Hono();
  const sessions = new Sessions(config.sessionSecret || config.mailchimpClientSecret || 'local-development-only');
  const { mailchimp, jobDeps, reporting } = services(deps);
  /** Back-end requests that run the app's code: the reporter notices upgrades and changed keys (in the background). */
  const onRequest = (account: Account) => void reporting.inBackground(account, 'onRequest');
  const hasKey = (account: Account) => Boolean(account.apiKey || config.supertextApiKey);
  const secure = config.appUrl.startsWith('https://');
  const configured = Boolean(config.mailchimpClientId && config.mailchimpClientSecret);
  const redirectUri = `${config.appUrl}/oauth/callback`;
  const oauth = {
    loginBase: config.mailchimpLoginBase,
    clientId: config.mailchimpClientId,
    clientSecret: config.mailchimpClientSecret,
    redirectUri,
    fetch: deps.fetch,
  };

  app.use('*', async (c, next) => {
    await next();
    c.header('Content-Security-Policy', "frame-ancestors 'none'");
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    c.header('X-Content-Type-Options', 'nosniff');
  });

  // ?lang=de switches the interface language and remembers it.
  app.use('*', async (c, next) => {
    const lang = c.req.query('lang');
    if (lang && /^(en|de|fr|it)$/.test(lang)) {
      setCookie(c, 'st_locale', lang, { path: '/', maxAge: 365 * 86400, sameSite: 'Lax', secure });
    }
    await next();
  });

  const tr = (c: Context): Translator => translator(localeFromRequest(c.req.raw));

  /** The connected account of this browser, if any. */
  const current = async (c: Context): Promise<{ account: Account; cookie: string } | undefined> => {
    const cookie = getCookie(c, SESSION_COOKIE);
    const session = sessions.read(cookie);
    if (!session || !cookie) return undefined;
    const account = await store.getAccount(session.accountId);
    if (!account || !account.accessToken) return undefined;
    return { account, cookie };
  };

  const pageContext = (t: Translator, page: PageContext['page'], session?: { account: Account; cookie: string }): PageContext => ({
    t,
    page,
    csrf: session ? sessions.csrf(session.cookie) : '',
    accountName: session?.account.accountName,
  });

  /** API calls: a session and the CSRF token in a header (POST). */
  const apiSession = async (c: Context, write: boolean) => {
    const session = await current(c);
    if (!session) return c.json({ error: { message: 'Session expired', code: 'session' } satisfies ErrorInfo }, 401);
    if (write && !sessions.checkCsrf(session.cookie, c.req.header('x-csrf-token'))) {
      return c.json({ error: { message: 'Session expired', code: 'session' } satisfies ErrorInfo }, 403);
    }
    return session;
  };

  app.get('/health', (c) => c.text('ok'));

  app.get('/', async (c) => {
    const t = tr(c);
    const session = await current(c);
    if (!session) {
      const notice = c.req.query('denied') ? 'denied' : c.req.query('disconnected') ? 'disconnected' : undefined;
      const error = /^[a-zA-Z]{1,40}$/.test(c.req.query('error') ?? '') ? c.req.query('error') : undefined;
      return c.html(
        page(
          ConnectPage({
            ctx: pageContext(t, 'connect'),
            notice,
            configured,
            error: error ? { message: error, code: error } : undefined,
          }),
        ),
      );
    }
    const { account } = session;
    onRequest(account);
    const offset = Math.max(0, Number(c.req.query('offset')) || 0);
    let rows: CampaignRow[] | undefined;
    let total = 0;
    let error: ErrorInfo | undefined;
    if (account.appTrigger && account.targets.length > 0) {
      try {
        const list = await mailchimp(account).campaigns({ offset, count: PAGE_SIZE });
        const targets = await store.translationTargets(account.accountId);
        total = list.total;
        rows = [];
        for (const campaign of list.campaigns) {
          if (targets.has(campaign.id) || (campaign.type !== 'regular' && campaign.type !== 'plaintext')) continue;
          const drafts: Record<string, number> = {};
          for (const draft of await store.translations(account.accountId, campaign.id)) drafts[draft.language] = draft.webId ?? 0;
          rows.push({ campaign, drafts });
        }
      } catch (caught) {
        console.error('Supertext: could not load the campaigns', caught);
        error = errorInfo(caught);
        if (error.code === 'mailchimpAuth') await refuseToken(account);
      }
    }
    const history = await store.recentJobs(account.accountId, 6);
    const latest = history[0];
    return c.html(
      page(
        TranslatePage({
          ctx: pageContext(t, 'translate', session),
          account,
          hasKey: hasKey(account),
          rows,
          offset,
          total,
          pageSize: PAGE_SIZE,
          selected: c.req.query('campaign') ?? latest?.campaignId,
          job: latest,
          history: history.slice(1),
          error,
        }),
      ),
    );
  });

  // --- OAuth -----------------------------------------------------------------

  app.get('/oauth/start', (c) => {
    if (!configured) return c.redirect('/?error=notConfigured', 302);
    const { state, cookie } = sessions.state();
    setCookie(c, STATE_COOKIE, cookie, { path: '/oauth', maxAge: 600, httpOnly: true, sameSite: 'Lax', secure });
    return c.redirect(authorizeUrl(oauth, state), 302);
  });

  app.get('/oauth/callback', async (c) => {
    const stateCookie = getCookie(c, STATE_COOKIE);
    deleteCookie(c, STATE_COOKIE, { path: '/oauth' });
    if (c.req.query('error')) return c.redirect('/?denied=1', 302);
    const code = c.req.query('code');
    if (!code || !sessions.checkState(stateCookie, c.req.query('state'))) return c.redirect('/?error=session', 302);
    try {
      const { accessToken, metadata } = await exchangeCode(oauth, code);
      const existing = await store.getAccount(metadata.accountId);
      let account: Account = {
        ...(existing ?? { ...defaultAccount(metadata.accountId), folderLocale: tr(c).locale }),
        accountName: metadata.accountName,
        dc: metadata.dc,
        apiEndpoint: metadata.apiEndpoint,
        accessToken,
      };
      if (account.folderTrigger && account.targets.length > 0) {
        account = await syncFolders(mailchimp(account), account).catch(() => account);
      }
      await store.saveAccount(account);
      console.log(`Supertext: Mailchimp account ${account.accountId} connected`);
      setCookie(c, SESSION_COOKIE, sessions.create(account.accountId), {
        path: '/',
        maxAge: 30 * 86400,
        httpOnly: true,
        sameSite: 'Lax',
        secure,
      });
      return c.redirect(account.targets.length > 0 ? '/' : '/settings', 302);
    } catch (error) {
      console.error('Supertext: OAuth failed', error);
      return c.redirect(`/?error=${encodeURIComponent(errorInfo(error).code ?? 'oauthFailed')}`, 302);
    }
  });

  const refuseToken = async (account: Account) => {
    await store.saveAccount({ ...account, accessToken: '' });
    console.warn(`Supertext: Mailchimp refused the token of account ${account.accountId}; it has to connect again.`);
  };

  app.post('/disconnect', async (c) => {
    const session = await current(c);
    const form = await c.req.parseBody();
    if (session && sessions.checkCsrf(session.cookie, String(form.csrf ?? ''))) {
      await removeFolders(mailchimp(session.account), session.account).catch(() => undefined);
      await store.deleteAccount(session.account.accountId);
      console.log(`Supertext: Mailchimp account ${session.account.accountId} disconnected; its data was deleted.`);
    }
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.redirect('/?disconnected=1', 303);
  });

  // --- Jobs --------------------------------------------------------------------

  app.post('/api/jobs', async (c) => {
    const session = await apiSession(c, true);
    if (session instanceof Response) return session;
    const { account } = session;
    const body = (await c.req.json().catch(() => ({}))) as { campaignId?: string; languages?: string[]; overwrite?: boolean };
    const languages = (body.languages ?? []).filter((code) => typeof code === 'string' && account.targets.includes(code));
    if (!account.appTrigger) {
      return c.json({ error: { message: 'Translating from the app is turned off.', code: 'select' } }, 400);
    }
    if (!body.campaignId || typeof body.campaignId !== 'string' || languages.length === 0) {
      return c.json({ error: { message: 'Select a campaign and at least one language.', code: 'select' } }, 400);
    }
    if (!hasKey(account)) {
      return c.json({ error: errorInfo(new LocalizedError('No Supertext API key configured.', 'noApiKey')) }, 400);
    }
    onRequest(account);
    const { job, done } = await startJob(jobDeps, {
      accountId: account.accountId,
      campaignId: body.campaignId,
      languages,
      overwrite: Boolean(body.overwrite),
      trigger: 'app',
    });
    deps.onJob?.(done);
    return c.json({ id: job.id });
  });

  app.get('/api/jobs/:id', async (c) => {
    const session = await apiSession(c, false);
    if (session instanceof Response) return session;
    const job = await store.getJob(session.account.accountId, c.req.param('id'));
    if (!job) return c.json({ error: { message: 'Not found', code: 'notFound' } }, 404);
    const html = (await JobPanel({ t: tr(c), job, dc: session.account.dc })).toString();
    return c.json({ status: job.status, html });
  });

  /** *Export for translation*: one campaign, XLIFF (one or more languages) or HTML (one) → the file as a download. */
  app.post('/api/files/export', async (c) => {
    const session = await apiSession(c, true);
    if (session instanceof Response) return session;
    const { account } = session;
    const t = tr(c);
    const body = (await c.req.json().catch(() => ({}))) as { campaignId?: string; languages?: string[]; format?: string };
    try {
      if (!body.campaignId || typeof body.campaignId !== 'string') {
        throw new LocalizedError('Select a campaign to export.', 'fileSelectOne');
      }
      const file = await exportFile(store, account, mailchimp(account), {
        campaignId: body.campaignId,
        languages: (body.languages ?? []).filter((code) => typeof code === 'string'),
        format: body.format === 'html' ? 'html' : 'xliff',
      });
      return c.body(file.content, 200, {
        'Content-Type': file.contentType,
        'Content-Disposition': `attachment; filename="${file.filename.replace(/[^\w.-]/g, '_')}"`,
        'Cache-Control': 'no-store',
      });
    } catch (error) {
      const info = errorInfo(error);
      return c.json({ error: info, text: t.error(info) }, 400);
    }
  });

  /** *Import translation*: one uploaded file (≤ 10 MB, parsed in memory, never stored) → the languages' drafts, summary HTML. */
  app.post('/api/files/import', async (c) => {
    const session = await apiSession(c, true);
    if (session instanceof Response) return session;
    const { account } = session;
    const t = tr(c);
    try {
      refuseLargeUpload(c.req.header('content-length'));
      const form = await c.req.parseBody();
      const file = form.file;
      if (!(file instanceof File) || file.size === 0) throw new LocalizedError('Choose a file.', 'fileChoose');
      refuseLargeUpload(undefined, file);
      const summaries = await importFile(store, account, mailchimp(account), await file.text(), {
        includeChanged: form.includeChanged === '1',
        overwrite: form.overwrite === '1',
        uiLocale: t.locale,
      });
      const html = (await ImportSummaryPanel({ t, summaries, dc: account.dc }).toString()).toString();
      return c.json({ summaries, html });
    } catch (error) {
      const info = errorInfo(error);
      return c.json({ error: info, text: t.error(info) }, 400);
    }
  });

  app.post('/api/test', async (c) => {
    const session = await apiSession(c, true);
    if (session instanceof Response) return session;
    const t = tr(c);
    const body = (await c.req.json().catch(() => ({}))) as { apiKey?: string };
    const typed = body.apiKey?.trim() ?? '';
    const saved = reporting.apiKey(session.account);
    let check: ApiKeyCheck | null;
    if (!typed || typed === saved) {
      // The saved key: the same check as after saving, stored and reported when its status changed.
      check = (await reporting.run(session.account, 'testConnection'))?.check ?? null;
    } else {
      // A key typed but not saved yet: only checked, nothing stored or reported.
      check = await new SupertextClient({ apiKey: typed, endpoint: config.supertextEndpoint || undefined, fetch: deps.fetch })
        .checkApiKey()
        .catch(() => null);
    }
    if (!check) return c.json({ ok: false, message: t.t('keyCheck.error', { status: '?' }) });
    return c.json({
      ok: check.status === 'ok',
      message: keyCheckText(t, check),
      html: (await KeyCheckMessage({ t, check })).toString(),
    });
  });

  // --- Settings ----------------------------------------------------------------

  app.get('/settings', async (c) => {
    const session = await current(c);
    if (!session) return c.redirect('/', 302);
    const t = tr(c);
    onRequest(session.account);
    return c.html(
      page(
        SettingsPage({
          ctx: pageContext(t, 'settings', session),
          account: session.account,
          serverKey: Boolean(config.supertextApiKey),
          reportsEnabled: reporting.enabled(session.account),
          reportsFixed: reporting.fixedByEnvironment,
          reviewAvailable: Boolean(config.reviewUrl),
          saved: c.req.query('saved') === '1',
          invalidCodes: c.req.query('invalid') || undefined,
          foldersError: c.req.query('folders') || undefined,
          bothOff: c.req.query('bothOff') === '1',
        }),
      ),
    );
  });

  app.post('/settings', async (c) => {
    const session = await current(c);
    if (!session) return c.redirect('/', 303);
    const form = await c.req.parseBody({ all: true });
    const field = (name: string) => {
      const value = form[name];
      return String(Array.isArray(value) ? value[0] : (value ?? ''));
    };
    if (!sessions.checkCsrf(session.cookie, field('csrf'))) return c.redirect('/?error=session', 303);
    const t = tr(c);
    let account = { ...session.account };

    const apiKey = field('apiKey').trim();
    if (field('removeKey') === '1') account.apiKey = '';
    if (apiKey) account.apiKey = apiKey;
    const tone = field('tone');
    account.tone = tone === 'more' || tone === 'less' ? tone : 'default';
    const source = field('sourceLanguage');
    account.sourceLanguage = isLanguage(source) ? source : '';
    const chosen = form.target === undefined ? [] : Array.isArray(form.target) ? form.target : [form.target];
    account.targets = [...new Set(chosen.map(String))].filter((code) => isLanguage(code) && code !== account.sourceLanguage);
    const invalid: string[] = [];
    const codes: Record<string, string> = {};
    for (const [name, value] of Object.entries(form)) {
      if (!name.startsWith('code:')) continue;
      const code = String(Array.isArray(value) ? value[0] : value).trim();
      if (!code) continue;
      const language = name.slice(5);
      const exact = supertextCodeOf(code);
      if (isLanguage(language) && exact) codes[language] = exact;
      else invalid.push(code);
    }
    account.languageCodes = codes;
    const review = form.review === undefined ? [] : Array.isArray(form.review) ? form.review : [form.review];
    account.reviewLanguages = [...new Set(review.map(String))].filter((code) => isLanguage(code));
    if (!reporting.fixedByEnvironment) account.versionReports = field('versionReports') === '1';
    account.folderTrigger = field('folderTrigger') === '1';
    account.appTrigger = field('appTrigger') === '1';
    const bothOff = !account.folderTrigger && !account.appTrigger;
    if (bothOff) account.appTrigger = true;
    account.limitOriginal = field('limitOriginal') === '1';
    account.folderLocale = t.locale;

    let foldersError: string | undefined;
    try {
      account = await syncFolders(mailchimp(account), account);
    } catch (error) {
      foldersError = t.error(errorInfo(error));
    }
    await store.saveAccount(account);
    // The automatic API key check (shown on the settings page) and the settings_saved report.
    await reporting.run(account, 'afterSettingsSaved');
    return c.redirect(
      appUrl('/settings', {
        saved: '1',
        invalid: invalid.join(', ') || undefined,
        folders: foldersError,
        bothOff: bothOff ? '1' : undefined,
      }),
      303,
    );
  });

  return app;
}

/** A full HTML page from a JSX element. */
async function page(element: { toString(): string | Promise<string> }): Promise<string> {
  return `<!doctype html>\n${await element.toString()}`;
}

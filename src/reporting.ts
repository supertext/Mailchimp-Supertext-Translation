/**
 * Version reports to the Supertext Commando Center and the automatic API key check
 * (Commando-Center-Supertext-Translation → docs/DEVELOPER.md → Report protocol). The protocol is
 * Supertext Plugin Health's (`InstallationReporter`, `supertext-plugin-health` from
 * vendor/supertext-plugin-health); the key check is the Supertext SDK's (`checkApiKey()`). This
 * file only gives them what the app knows: the connected Mailchimp account (one "installation"
 * per account), the app's version, and a place to keep the reporter's state (the account's
 * `reporter` field in the store).
 *
 * A hosted app has no server on the customer's side, so there is no ping endpoint and no
 * callback URL. Nothing here ever throws into a request or a translation, and the API key is
 * never logged or sent (only its fingerprint is kept).
 */
import {
  InstallationReporter,
  reportsEnabled,
  type FetchLike,
  type KeyChecker,
  type LanguageMapping,
  type ReporterOptions,
  type ReporterResult,
} from 'supertext-plugin-health';
import { SDK_VERSION } from 'supertext-sdk';
import { apiKeyFingerprint, SupertextClient as SdkClient, type ApiKeyCheck, type SupertextClientOptions } from 'supertext-sdk/v1';
import type { Config } from './config.js';
import type { Account, Store } from './store/store.js';
import { USER_AGENT } from './supertext/client.js';
import { VERSION } from './version.js';

/** The GitHub repository name: the center reads the latest release from it. */
export const PLUGIN_NAME = 'Mailchimp-Supertext-Translation';

/**
 * The "site URL" of an installation: the Mailchimp account the app serves. Mailchimp accounts
 * have no website of their own, so it is Mailchimp's admin host with the account ID as path
 * (the center keeps paths but drops queries). Stable for the account's lifetime; no name, no
 * login, no e-mail address.
 */
export const siteUrl = (account: Pick<Account, 'accountId'>): string =>
  `https://admin.mailchimp.com/account/${encodeURIComponent(account.accountId)}`;

export type ReportAction = 'afterSettingsSaved' | 'onRequest' | 'testConnection' | 'authenticationFailed';

export interface ReportingDeps {
  config: Config;
  store: Store;
  /** HTTP for the key check against Supertext and for the report (tests route both to stand-ins). */
  fetch?: typeof fetch;
  /** Tests: more options for the Plugin Health reporter (clock, …). */
  reporterOverrides?: Partial<ReporterOptions>;
  /** Called with every background task (tests wait on them). */
  onTask?: (done: Promise<unknown>) => void;
}

/**
 * A reporter result with the key check typed as the SDK's (the checks come from the SDK's
 * `checkApiKey()` or are `invalid` after a 401/403, so the status is one of the SDK's).
 */
export type ReportResult = Omit<ReporterResult, 'check'> & { check: ApiKeyCheck | null };

export class Reporting {
  /** Per account, so two requests of the same account don't report twice. */
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(private readonly deps: ReportingDeps) {}

  /** The account's setting, unless SUPERTEXT_VERSION_REPORTS turns reports off (or on) for everyone. */
  enabled(account: Pick<Account, 'versionReports'>): boolean {
    return reportsEnabled(account.versionReports ?? true, this.deps.config.versionReports);
  }

  /** Whether SUPERTEXT_VERSION_REPORTS decides instead of the account's setting. */
  get fixedByEnvironment(): boolean {
    const value = this.deps.config.versionReports;
    return reportsEnabled(true, value) === reportsEnabled(false, value);
  }

  /** The key the account's translations use. */
  apiKey(account: Pick<Account, 'apiKey'>): string {
    return account.apiKey || this.deps.config.supertextApiKey;
  }

  reporter(account: Account, languages?: LanguageMapping[]): InstallationReporter {
    const { config } = this.deps;
    return new InstallationReporter({
      enabled: this.enabled(account),
      siteUrl: siteUrl(account),
      plugin: { name: PLUGIN_NAME, version: VERSION || '0.0.0' },
      // Mailchimp is a hosted service without a version number of its own.
      system: { name: 'Mailchimp', version: null },
      sdkVersion: SDK_VERSION,
      callbackUrl: null,
      keyChecker: this.keyChecker(),
      ...(languages ? { languages: () => languages } : {}),
      ...(config.reportUrl ? { reportUrl: config.reportUrl } : {}),
      ...(this.deps.fetch ? { fetch: this.deps.fetch as FetchLike } : {}),
      ...this.deps.reporterOverrides,
    });
  }

  /** The SDK's key check (`GET features`) against the configured endpoint, with the app's User-Agent. */
  keyChecker(): KeyChecker {
    const { config } = this.deps;
    const options: SupertextClientOptions = {
      baseUrl: config.supertextEndpoint || undefined,
      userAgent: USER_AGENT,
      ...(this.deps.fetch ? { fetch: this.deps.fetch as SupertextClientOptions['fetch'] } : {}),
    };
    return { check: (key) => new SdkClient(key, options).checkApiKey(), fingerprint: apiKeyFingerprint };
  }

  /**
   * Runs one reporter action with the account's stored state and stores the new state.
   * Never throws; null when something went wrong (logged without the key).
   */
  run(account: Account, action: ReportAction, httpStatus?: number): Promise<ReportResult | null> {
    const previous = this.queues.get(account.accountId) ?? Promise.resolve();
    const task = previous.then(async () => {
      try {
        // The latest state: another request may have stored a newer one meanwhile.
        const fresh = (await this.deps.store.getAccount(account.accountId)) ?? account;
        const reporter = this.reporter(fresh);
        const state = fresh.reporter ?? null;
        const key = this.apiKey(fresh);
        const result =
          action === 'afterSettingsSaved'
            ? await reporter.afterSettingsSaved(state, key)
            : action === 'testConnection'
              ? await reporter.testConnection(state, key)
              : action === 'authenticationFailed'
                ? await reporter.authenticationFailed(state, key, httpStatus ?? 401)
                : await reporter.onRequest(state, key);
        await this.deps.store.saveReporterState(account.accountId, result.state);
        if (result.event) {
          console.log(`Supertext: version report "${result.event}" for account ${account.accountId}: ${result.sent ? 'sent' : 'not sent'}`);
        }
        return result as ReportResult;
      } catch (error) {
        console.warn(`Supertext: version report skipped (${error instanceof Error ? error.message : String(error)})`);
        return null;
      }
    });
    const settled = task.catch(() => undefined);
    this.queues.set(account.accountId, settled);
    void settled.then(() => {
      if (this.queues.get(account.accountId) === settled) this.queues.delete(account.accountId);
    });
    return task;
  }

  /**
   * "Send configuration to Supertext" (Settings): the account's language mapping in one `extensions`
   * report (a hosted app has no plugins of its own to list, so the list is empty), sent now (also
   * within the hour after a failed report). Null while version reports are off. Never throws.
   */
  sendConfiguration(account: Account, languages: LanguageMapping[]): Promise<ReportResult | null> {
    const previous = this.queues.get(account.accountId) ?? Promise.resolve();
    const task = previous.then(async () => {
      try {
        const fresh = (await this.deps.store.getAccount(account.accountId)) ?? account;
        if (!this.enabled(fresh)) return null;
        const result = await this.reporter(fresh, languages).sendExtensions(fresh.reporter ?? null, []);
        await this.deps.store.saveReporterState(account.accountId, result.state);
        return result as ReportResult;
      } catch (error) {
        console.warn(`Supertext: configuration not sent (${error instanceof Error ? error.message : String(error)})`);
        return null;
      }
    });
    const settled = task.catch(() => undefined);
    this.queues.set(account.accountId, settled);
    void settled.then(() => {
      if (this.queues.get(account.accountId) === settled) this.queues.delete(account.accountId);
    });
    return task;
  }

  /** For page requests: in the background, so nobody waits for Supertext or the center. */
  inBackground(account: Account, action: ReportAction, httpStatus?: number): Promise<ReportResult | null> {
    const task = this.run(account, action, httpStatus);
    this.deps.onTask?.(task);
    return task;
  }

  /** The latest stored key check (settings page). */
  static lastCheck(account: Pick<Account, 'reporter'>): ApiKeyCheck | null {
    return (account.reporter?.keyCheck as ApiKeyCheck | undefined) ?? null;
  }
}

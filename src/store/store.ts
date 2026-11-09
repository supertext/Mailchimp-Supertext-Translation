import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import type { ErrorInfo } from '../i18n/error.js';
import type { Politeness } from '../supertext/client.js';
import type { ReporterState } from 'supertext-plugin-health';

/** What a Supertext folder starts: one language, or all of the account's languages. */
export type FolderTarget = 'all' | string;

/** A connected Mailchimp account and its settings, keyed by Mailchimp's account (user) ID. */
export interface Account {
  accountId: string;
  /** Shown in the app ("Swiss Chocolate Co."). */
  accountName: string;
  /** Mailchimp data center ("us21"), for links into Mailchimp. */
  dc: string;
  /** Marketing API base, e.g. https://us21.api.mailchimp.com. */
  apiEndpoint: string;
  /** OAuth access token (doesn't expire; '' after Mailchimp refused it). */
  accessToken: string;
  /** The account's own Supertext API key ('' = use SUPERTEXT_API_KEY). */
  apiKey: string;
  tone: Politeness;
  /** Mailchimp code of the campaigns' language ("en"); '' = let Supertext detect it. */
  sourceLanguage: string;
  /** Mailchimp codes of the languages to translate into, in the order shown. */
  targets: string[];
  /**
   * The language mapping: Mailchimp code → Supertext code ("de" → "de-CH"), one for both
   * directions. A language without one is sent only if its Mailchimp code is a Supertext code
   * as it is ("es"); otherwise it fails with `unsupportedLanguage`.
   */
  languageCodes: Record<string, string>;
  /**
   * Mailchimp codes of the languages with Translation review on (Settings → Languages): translations
   * into them go through Supertext's review service (SUPERTEXT_REVIEW_URL), all others directly to Supertext.
   */
  reviewLanguages: string[];
  /** Start translations by moving a campaign into a Supertext folder. */
  folderTrigger: boolean;
  /** Start translations on the app's Translate page. */
  appTrigger: boolean;
  /** Send the original only to subscribers whose language has no translation. */
  limitOriginal: boolean;
  /** Interface language the folder names are written in. */
  folderLocale: string;
  /** The Supertext folders the app created: Mailchimp folder ID → what it starts. */
  folders: Record<string, FolderTarget>;
  /** "Send version information to Supertext" (SUPERTEXT_VERSION_REPORTS=0 turns it off for all accounts). */
  versionReports: boolean;
  /** The Commando Center reporter's state (Plugin Health's ReporterState JSON, as the SDK 0.2 reporter stored it); see reporting.ts. */
  reporter?: ReporterState | null;
  connectedAt: string;
}

export const defaultAccount = (accountId: string): Account => ({
  accountId,
  accountName: '',
  dc: '',
  apiEndpoint: '',
  accessToken: '',
  apiKey: '',
  tone: 'default',
  sourceLanguage: 'en',
  targets: [],
  languageCodes: {},
  reviewLanguages: [],
  folderTrigger: true,
  appTrigger: true,
  limitOriginal: true,
  folderLocale: 'en',
  folders: {},
  versionReports: true,
  reporter: null,
  connectedAt: new Date().toISOString(),
});

/** A translation draft the app made: source campaign × language → draft campaign. */
export interface Translation {
  sourceId: string;
  language: string;
  targetId: string;
  /** Mailchimp's web ID of the draft, for links into Mailchimp. */
  webId?: number;
  updatedAt: string;
}

/** Where each campaign was last seen, so a campaign moved into a Supertext folder can go back. */
export interface FolderEntry {
  /** The campaign's folder outside the Supertext folders ('' = no folder). */
  folder: string;
  /** Set while the campaign sits in a Supertext folder it couldn't be moved out of (already handled). */
  handled?: string;
}

export type ItemState = 'created' | 'updated' | 'kept' | 'failed';

export interface JobItem {
  language: string;
  state: ItemState;
  targetId?: string;
  webId?: number;
  /** Notes about the result: 'segmentNotCombined', 'sections', 'html'. */
  notes?: string[];
  error?: ErrorInfo;
}

export interface Job {
  id: string;
  accountId: string;
  status: 'running' | 'done' | 'failed';
  trigger: 'app' | 'folder';
  campaignId: string;
  campaignTitle: string;
  languages: string[];
  overwrite: boolean;
  items: JobItem[];
  /** Set when the original's audience was limited to the remaining languages. */
  originalLimited?: boolean;
  /** Set when the whole job stopped (authentication, limit, Mailchimp errors). */
  error?: ErrorInfo;
  createdAt: string;
  finishedAt?: string;
}

export interface Store {
  getAccount(accountId: string): Promise<Account | undefined>;
  /** Saves the settings and the token; keeps the stored `reporter` (only `saveReporterState` writes it). */
  saveAccount(account: Account): Promise<void>;
  /** Stores only the reporter's state, so a report finishing late never overwrites newer settings. */
  saveReporterState(accountId: string, state: ReporterState): Promise<void>;
  /** Forgets everything about the account: settings, token, drafts, jobs. */
  deleteAccount(accountId: string): Promise<void>;
  /** Accounts that start translations from folders and have a token. */
  folderAccounts(): Promise<Account[]>;

  translations(accountId: string, sourceId: string): Promise<Translation[]>;
  saveTranslation(accountId: string, translation: Translation): Promise<void>;
  /** All draft campaign IDs the app made for the account (to recognise them). */
  translationTargets(accountId: string): Promise<Set<string>>;

  folderEntries(accountId: string): Promise<Record<string, FolderEntry>>;
  saveFolderEntries(accountId: string, entries: Record<string, FolderEntry>): Promise<void>;

  saveJob(job: Job): Promise<void>;
  getJob(accountId: string, id: string): Promise<Job | undefined>;
  recentJobs(accountId: string, limit: number): Promise<Job[]>;
  /** Jobs still "running" after a restart are marked failed. */
  failRunningJobs(error: ErrorInfo): Promise<void>;
}

export const newJobId = (): string => randomUUID();

/** AES-256-GCM for stored tokens and API keys. */
export class Secrets {
  private readonly key: Buffer;

  constructor(secret: string) {
    if (!secret) throw new Error('An encryption key or the Mailchimp client secret is required.');
    this.key = createHash('sha256').update(`supertext-mailchimp:${secret}`).digest();
  }

  encrypt(value: string): string {
    if (!value) return '';
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
  }

  decrypt(value: string): string {
    if (!value) return '';
    const [version, iv, tag, data] = value.split(':');
    if (version !== 'v1' || !iv || !tag || !data) return '';
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
    } catch {
      return '';
    }
  }
}

/** In-memory store: tests, local development without a database, screenshots. */
export class MemoryStore implements Store {
  private readonly accounts = new Map<string, Account>();
  private readonly drafts = new Map<string, Translation[]>();
  private readonly entries = new Map<string, Record<string, FolderEntry>>();
  private readonly jobs = new Map<string, Job>();

  async getAccount(accountId: string) {
    const account = this.accounts.get(accountId);
    return account ? structuredClone(account) : undefined;
  }

  async saveAccount(account: Account) {
    const reporter = this.accounts.get(account.accountId)?.reporter ?? null;
    this.accounts.set(account.accountId, { ...structuredClone(account), reporter });
  }

  async saveReporterState(accountId: string, state: ReporterState) {
    const account = this.accounts.get(accountId);
    if (account) account.reporter = structuredClone(state);
  }

  async deleteAccount(accountId: string) {
    this.accounts.delete(accountId);
    this.drafts.delete(accountId);
    this.entries.delete(accountId);
    for (const [id, job] of this.jobs) if (job.accountId === accountId) this.jobs.delete(id);
  }

  async folderAccounts() {
    return [...this.accounts.values()].filter((a) => a.folderTrigger && a.accessToken).map((a) => structuredClone(a));
  }

  async translations(accountId: string, sourceId: string) {
    return structuredClone((this.drafts.get(accountId) ?? []).filter((t) => t.sourceId === sourceId));
  }

  async saveTranslation(accountId: string, translation: Translation) {
    const list = (this.drafts.get(accountId) ?? []).filter(
      (t) => !(t.sourceId === translation.sourceId && t.language === translation.language),
    );
    list.push(structuredClone(translation));
    this.drafts.set(accountId, list);
  }

  async translationTargets(accountId: string) {
    return new Set((this.drafts.get(accountId) ?? []).map((t) => t.targetId));
  }

  async folderEntries(accountId: string) {
    return structuredClone(this.entries.get(accountId) ?? {});
  }

  async saveFolderEntries(accountId: string, entries: Record<string, FolderEntry>) {
    this.entries.set(accountId, structuredClone(entries));
  }

  async saveJob(job: Job) {
    this.jobs.set(job.id, structuredClone(job));
  }

  async getJob(accountId: string, id: string) {
    const job = this.jobs.get(id);
    return job && job.accountId === accountId ? structuredClone(job) : undefined;
  }

  async recentJobs(accountId: string, limit: number) {
    return [...this.jobs.values()]
      .filter((job) => job.accountId === accountId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((job) => structuredClone(job));
  }

  async failRunningJobs(error: ErrorInfo) {
    for (const job of this.jobs.values()) {
      if (job.status === 'running') Object.assign(job, { status: 'failed', error, finishedAt: new Date().toISOString() });
    }
  }
}

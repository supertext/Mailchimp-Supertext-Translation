import { REVIEW_URL } from './supertext/client.js';

/** Settings from environment variables (Railway variables in production). */
export interface Config {
  port: number;
  /** Public HTTPS URL of this app; the OAuth redirect URI is APP_URL/oauth/callback. */
  appUrl: string;
  /** From Mailchimp → Profile → Extras → Registered apps. */
  mailchimpClientId: string;
  mailchimpClientSecret: string;
  /** Mailchimp's OAuth host. Points at a stand-in in tests and for screenshots. */
  mailchimpLoginBase: string;
  /** Overrides the API endpoint Mailchimp's metadata returns (stand-ins only). */
  mailchimpApiBase: string;
  /** Signs session cookies; falls back to a key derived from the client secret. */
  sessionSecret: string;
  /** Default Supertext API key for accounts that haven't entered their own (the demo account). */
  supertextApiKey: string;
  supertextEndpoint: string;
  /**
   * SUPERTEXT_REVIEW_URL: the review service for languages with Translation review on
   * (default: Supertext's review service, REVIEW_URL; '' = review off for every language).
   */
  reviewUrl: string;
  databaseUrl: string;
  /** Key for encrypting stored tokens and API keys; falls back to a key derived from the client secret. */
  encryptionKey: string;
  /** SUPERTEXT_VERSION_REPORTS: `0` turns the version reports off for every account (see reporting.ts). */
  versionReports: string | undefined;
  /** SUPERTEXT_REPORT_URL: where version reports go ('' = the SDK's default, the live Commando Center). Tests point it at a stand-in. */
  reportUrl: string;
  /** How often the Supertext folders are checked, in seconds (0 = never: tests). */
  pollSeconds: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const poll = Number(env.FOLDER_POLL_SECONDS);
  return {
    port: Number(env.PORT) || 8080,
    appUrl: (env.APP_URL || `http://127.0.0.1:${Number(env.PORT) || 8080}`).replace(/\/+$/, ''),
    mailchimpClientId: env.MAILCHIMP_CLIENT_ID ?? '',
    mailchimpClientSecret: env.MAILCHIMP_CLIENT_SECRET ?? '',
    mailchimpLoginBase: (env.MAILCHIMP_LOGIN_BASE || 'https://login.mailchimp.com').replace(/\/+$/, ''),
    mailchimpApiBase: (env.MAILCHIMP_API_BASE ?? '').replace(/\/+$/, ''),
    sessionSecret: env.SESSION_SECRET ?? '',
    supertextApiKey: env.SUPERTEXT_API_KEY ?? '',
    supertextEndpoint: env.SUPERTEXT_API_ENDPOINT ?? '',
    reviewUrl: (env.SUPERTEXT_REVIEW_URL ?? REVIEW_URL).trim(),
    databaseUrl: env.DATABASE_URL ?? '',
    encryptionKey: env.APP_ENCRYPTION_KEY ?? '',
    versionReports: env.SUPERTEXT_VERSION_REPORTS,
    reportUrl: env.SUPERTEXT_REPORT_URL ?? '',
    pollSeconds: Number.isFinite(poll) && env.FOLDER_POLL_SECONDS !== undefined && env.FOLDER_POLL_SECONDS !== '' ? Math.max(0, poll) : 60,
  };
}

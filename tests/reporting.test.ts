import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { Reporting, siteUrl } from '../src/reporting.js';
import { defaultAccount, MemoryStore } from '../src/store/store.js';
import { createSupertextStandin } from './standin/supertext.js';

// The protocol is the SDK's (tested there); here only the app's glue.
describe('reporting glue', () => {
  const config = loadConfig({
    SUPERTEXT_API_ENDPOINT: 'https://supertext.test/v1/',
    SUPERTEXT_API_KEY: 'server-key',
    SUPERTEXT_API_KEY_ACCOUNT: '48210377',
    SUPERTEXT_REPORT_URL: 'https://center.test/api/v1/report',
  });

  it('uses the Mailchimp account as the site, without anything personal', () => {
    expect(siteUrl({ accountId: '48210377' })).toBe('https://admin.mailchimp.com/account/48210377');
  });

  it('never throws, even when the center and the store fail', async () => {
    const store = new MemoryStore();
    const account = { ...defaultAccount('1'), accountName: 'Shop' };
    await store.saveAccount(account);
    store.saveReporterState = async () => {
      throw new Error('database down');
    };
    const supertext = createSupertextStandin();
    const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      if (new URL(request.url).host === 'center.test') throw new Error('ECONNREFUSED');
      return supertext.handle(request);
    }) as typeof fetch;
    const reporting = new Reporting({ config, store, fetch: fetchFn });
    await expect(reporting.run(account, 'afterSettingsSaved')).resolves.toBeNull();
  });

  it('keeps a failed report from being retried for an hour', async () => {
    const store = new MemoryStore();
    const account = defaultAccount('2');
    await store.saveAccount(account);
    let center = 0;
    const supertext = createSupertextStandin();
    const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      if (new URL(request.url).host === 'center.test') {
        center++;
        return new Response('{"ok":false}', { status: 503 });
      }
      return supertext.handle(request);
    }) as typeof fetch;
    const reporting = new Reporting({ config, store, fetch: fetchFn });
    const first = await reporting.run(account, 'onRequest');
    expect(first).toMatchObject({ event: 'installed', sent: false });
    await reporting.run(account, 'onRequest');
    expect(center).toBe(1);
    expect((await store.getAccount('2'))!.reporter?.lastFailureAt).toBeTruthy();
  });

  it('turns off with SUPERTEXT_VERSION_REPORTS=0, whatever the account says', () => {
    const off = new Reporting({ config: { ...config, versionReports: '0' }, store: new MemoryStore() });
    expect(off.enabled({ versionReports: true })).toBe(false);
    expect(off.fixedByEnvironment).toBe(true);
    const on = new Reporting({ config, store: new MemoryStore() });
    expect(on.enabled({ versionReports: false })).toBe(false);
    expect(on.fixedByEnvironment).toBe(false);
  });

  it('Send configuration: the language mapping in one extensions report (no plugins), nothing with reports off', async () => {
    const store = new MemoryStore();
    const account = defaultAccount('3');
    await store.saveAccount(account);
    const reports: Array<Record<string, unknown>> = [];
    const supertext = createSupertextStandin();
    const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      if (new URL(request.url).host === 'center.test') {
        reports.push((await request.json()) as Record<string, unknown>);
        return new Response('{"ok":true}', { status: 202 });
      }
      return supertext.handle(request);
    }) as typeof fetch;
    const languages = [
      { code: 'en', supertext: 'en' },
      { code: 'de', supertext: 'de-DE' },
      { code: 'no', supertext: null },
    ];
    const reporting = new Reporting({ config, store, fetch: fetchFn });
    expect(await reporting.sendConfiguration(account, languages)).toMatchObject({ event: 'extensions', sent: true });
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ event: 'extensions', extensions: [], languages });

    const off = new Reporting({ config: { ...config, versionReports: '0' }, store, fetch: fetchFn });
    expect(await off.sendConfiguration(account, languages)).toBeNull();
    expect(reports).toHaveLength(1);
  });
});

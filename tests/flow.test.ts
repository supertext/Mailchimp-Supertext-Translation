import { describe, expect, it } from 'vitest';
import { SDK_VERSION } from 'supertext-sdk';
import { services } from '../src/app.js';
import { pollAccount } from '../src/translation/folders.js';
import { ACCOUNT_ID, setup, STANDARD_SETTINGS } from './helpers.js';
import { moveToFolder } from './standin/mailchimp.js';

const folderId = (env: ReturnType<typeof setup>, name: string) =>
  [...env.mailchimp.folders.values()].find((folder) => folder.name === name)?.id;

describe('connecting Mailchimp', () => {
  it('shows the connect page without a session', async () => {
    const env = setup();
    const page = await (await env.request('/')).text();
    expect(page).toContain('Connect Mailchimp');
    expect(page).toContain('href="/oauth/start"');
  });

  it('runs the OAuth flow, stores the account and opens the settings first', async () => {
    const env = setup();
    const callback = await env.connect();
    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toBe('/settings');
    const account = await env.store.getAccount(ACCOUNT_ID);
    expect(account).toMatchObject({ accountName: 'Swiss Chocolate Co.', dc: 'us21', accessToken: 'standin-token' });
    const settings = await (await env.request('/settings')).text();
    expect(settings).toContain('Swiss Chocolate Co.');
    expect(settings).toContain('https://www.supertext.com/person/en/account/signin');
    expect(settings).toContain('https://www.supertext.com/en/integrations/api');
  });

  it('refuses a callback whose state does not match', async () => {
    const env = setup();
    const response = await env.request('/oauth/callback?code=standin-code&state=forged');
    expect(response.headers.get('location')).toBe('/?error=session');
    expect(await env.store.getAccount(ACCOUNT_ID)).toBeUndefined();
  });

  it('goes back to the start page when the user declines', async () => {
    const env = setup();
    await env.request('/oauth/start');
    const response = await env.request('/oauth/callback?error=access_denied');
    expect(response.headers.get('location')).toBe('/?denied=1');
  });

  it('refuses API calls without the CSRF token', async () => {
    const env = setup();
    await env.connect();
    const response = await env.request('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaignId: 'c-autumn', languages: ['de'] }),
    });
    expect(response.status).toBe(403);
  });
});

describe('settings', () => {
  it('saves languages and creates the Supertext folders in the interface language', async () => {
    const env = setup();
    await env.connect();
    const saved = await env.saveSettings(STANDARD_SETTINGS);
    expect(saved.headers.get('location')).toBe('/settings?saved=1');
    const account = (await env.store.getAccount(ACCOUNT_ID))!;
    expect(account.targets).toEqual(['de', 'fr']);
    expect(account.languageCodes).toEqual({ de: 'de-CH', fr: 'fr-CH' });
    const names = [...env.mailchimp.folders.values()].map((folder) => folder.name).sort();
    expect(names).toEqual(['Seasonal', 'Supertext → All languages', 'Supertext → French', 'Supertext → German']);

    // Fewer languages and German folder names: renamed, the unused (empty) folder removed.
    await env.request('/settings?lang=de');
    await env.saveSettings(STANDARD_SETTINGS.filter(([name, value]) => !(name === 'target' && value === 'fr')));
    const after = [...env.mailchimp.folders.values()].map((folder) => folder.name).sort();
    expect(after).toEqual(['Seasonal', 'Supertext → Alle Sprachen', 'Supertext → Deutsch']);
  });

  it('removes the folders when the folder trigger is turned off, and keeps one way on', async () => {
    const env = setup();
    await env.connect();
    await env.saveSettings(STANDARD_SETTINGS);
    const off = await env.saveSettings(STANDARD_SETTINGS.filter(([name]) => name !== 'folderTrigger' && name !== 'appTrigger'));
    expect(off.headers.get('location')).toContain('bothOff=1');
    expect([...env.mailchimp.folders.values()].map((folder) => folder.name)).toEqual(['Seasonal']);
    expect((await env.store.getAccount(ACCOUNT_ID))!.appTrigger).toBe(true);
  });

  it('reports invalid language codes and keeps the rest', async () => {
    const env = setup();
    await env.connect();
    const saved = await env.saveSettings([...STANDARD_SETTINGS.filter(([name]) => name !== 'code:fr'), ['code:fr', 'french!']]);
    expect(decodeURIComponent(saved.headers.get('location')!)).toContain('invalid=french!');
    expect((await env.store.getAccount(ACCOUNT_ID))!.languageCodes).toEqual({ de: 'de-CH' });
  });

  it('stores the API key encrypted-ready and tests it', async () => {
    const env = setup();
    await env.connect();
    await env.saveSettings([...STANDARD_SETTINGS, ['apiKey', 'Supertext-Auth-Key own-key']]);
    expect((await env.store.getAccount(ACCOUNT_ID))!.apiKey).toBe('Supertext-Auth-Key own-key');
    const ok = await (await env.api('POST', '/api/test', {})).json();
    expect(ok).toMatchObject({ ok: true, message: 'API key checked: the connection to Supertext works.' });
    const bad = await (await env.api('POST', '/api/test', { apiKey: 'invalid' })).json();
    expect(bad.ok).toBe(false);
    expect(bad.message).toMatch(/^Supertext rejected the API key/);
    // Both links, opening in a new tab.
    expect(bad.html).toContain('<a href="https://www.supertext.com/en/integrations/api" target="_blank" rel="noopener">');
    expect(bad.html).toContain('<a href="https://www.supertext.com/person/en/account/signin" target="_blank" rel="noopener">');
    // A typed, unsaved key is only checked: the stored result stays the saved key's.
    expect((await env.store.getAccount(ACCOUNT_ID))!.reporter?.keyCheck?.status).toBe('ok');
  });

  it('shows the version linked to its release', async () => {
    const env = setup();
    await env.connect();
    const page = await (await env.request('/settings')).text();
    expect(page).toMatch(/Supertext Translation for Mailchimp, version <a href="https:\/\/github.com\/Supertext\/Mailchimp-Supertext-Translation\/releases\/tag\/v\d+\.\d+\.\d+"/);
  });
});

describe('translating from the app', () => {
  it('lists campaigns and creates one draft per language with translated texts and segments', async () => {
    const env = setup();
    await env.connect();
    await env.saveSettings(STANDARD_SETTINGS);
    const page = await (await env.request('/')).text();
    expect(page).toContain('Autumn newsletter');
    expect(page).toContain('Advent calendar offer');

    const started = await env.api('POST', '/api/jobs', { campaignId: 'c-autumn', languages: ['de', 'fr'] });
    expect(started.status).toBe(200);
    const { id } = await started.json();
    await env.settle();
    const job = await (await env.api('GET', `/api/jobs/${id}`)).json();
    expect(job.status).toBe('done');
    expect(job.html).toContain('Done: 2 created, 0 updated, 0 kept, 0 failed.');
    expect(job.html).toContain('https://us21.admin.mailchimp.com/campaigns/show/?id=');

    const drafts = [...env.mailchimp.campaigns.values()].filter((c) => c.id.startsWith('c-copy-'));
    expect(drafts.map((c) => c.settings.title).sort()).toEqual(['Autumn newsletter · DE', 'Autumn newsletter · FR']);
    const german = drafts.find((c) => c.settings.title.endsWith('DE'))!;
    expect(german.settings.subject_line).toBe('Unsere Herbstschokoladen sind da');
    expect(german.settings.preview_text).toBe('Drei neue Pralinen und eine Degustation in Zürich');
    expect(german.recipients.segment_opts).toEqual({
      match: 'all',
      conditions: [{ condition_type: 'Language', field: 'language', op: 'is', value: 'de' }],
    });
    const html = env.mailchimp.contents.get(german.id)!.html;
    expect(html).toContain('<h1>Hallo *|FNAME|*, der Herbst ist da</h1>');
    expect(html).toContain('<strong>drei neue Pralinen</strong>');
    expect(html).toContain('<a href="*|UNSUB|*">Abmelden</a>');
    // Outside the editable sections the template stays as it is (as in Mailchimp's editor).
    expect(html).toContain('alt="Swiss Chocolate Co. logo"');
    expect(html).toContain('*|LIST:ADDRESSLINE|*');
    expect(html).toContain('<!--[if gte mso 15]>');
    expect(html).not.toContain('data-st-a');
    // Written into the template's editable sections, so the draft stays a template campaign.
    expect(german.content_type).toBe('template');
    expect(env.mailchimp.calls).toContain(`PUT campaigns/${german.id}/content`);

    // Supertext got the language pair and one document per language.
    expect(env.supertext.documents.map((d) => [d.source, d.target])).toEqual([
      ['en', 'de-CH'],
      ['en', 'fr-CH'],
    ]);

    // The original now goes only to subscribers without German or French.
    expect(env.mailchimp.campaigns.get('c-autumn')!.recipients.segment_opts).toEqual({
      match: 'all',
      conditions: [
        { condition_type: 'Language', field: 'language', op: 'not', value: 'de' },
        { condition_type: 'Language', field: 'language', op: 'not', value: 'fr' },
      ],
    });

    // The list shows the drafts, and the drafts themselves aren't offered.
    const list = await (await env.request('/')).text();
    expect(list.match(/badge done/g)?.length).toBe(2);
    expect(list).not.toContain('Autumn newsletter · DE');
  });

  it('keeps existing drafts unless asked to update them', async () => {
    const env = setup();
    await env.connect();
    await env.saveSettings(STANDARD_SETTINGS);
    await env.api('POST', '/api/jobs', { campaignId: 'c-advent', languages: ['de'] });
    await env.settle();
    const draft = [...env.mailchimp.campaigns.values()].find((c) => c.settings.title === 'Advent calendar offer · DE')!;
    env.mailchimp.contents.get(draft.id)!.html = '<p>Edited by hand</p>';

    const kept = await (await env.api('POST', '/api/jobs', { campaignId: 'c-advent', languages: ['de'] })).json();
    await env.settle();
    expect((await env.store.getJob(ACCOUNT_ID, kept.id))!.items[0].state).toBe('kept');
    expect(env.mailchimp.contents.get(draft.id)!.html).toBe('<p>Edited by hand</p>');

    const updated = await (await env.api('POST', '/api/jobs', { campaignId: 'c-advent', languages: ['de'], overwrite: true })).json();
    await env.settle();
    expect((await env.store.getJob(ACCOUNT_ID, updated.id))!.items[0]).toMatchObject({ state: 'updated', targetId: draft.id });
    expect(env.mailchimp.contents.get(draft.id)!.html).toContain('24 kleine Überraschungen');
    // An HTML campaign gets its whole HTML translated, alt texts included.
    expect(env.mailchimp.contents.get(draft.id)!.html).toContain('alt="Logo von Swiss Chocolate Co."');
    expect([...env.mailchimp.campaigns.values()].filter((c) => c.settings.title === 'Advent calendar offer · DE')).toHaveLength(1);
  });

  it("combines the original's own segment with the language", async () => {
    const env = setup();
    await env.connect();
    await env.saveSettings(STANDARD_SETTINGS);
    await env.api('POST', '/api/jobs', { campaignId: 'c-advent', languages: ['fr'] });
    await env.settle();
    const draft = [...env.mailchimp.campaigns.values()].find((c) => c.settings.title === 'Advent calendar offer · FR')!;
    expect(draft.settings.folder_id).toBe('f-seasonal');
    expect(draft.recipients.segment_opts.conditions).toEqual([
      { condition_type: 'Interests', field: 'interests-123', op: 'interestcontains', value: ['456'] },
      { condition_type: 'Language', field: 'language', op: 'is', value: 'fr' },
    ]);
  });

  it('falls back to HTML when Mailchimp refuses the template sections', async () => {
    const env = setup();
    env.mailchimp.refuseSections = true;
    await env.connect();
    await env.saveSettings(STANDARD_SETTINGS);
    const { id } = await (await env.api('POST', '/api/jobs', { campaignId: 'c-autumn', languages: ['de'] })).json();
    await env.settle();
    const job = (await env.store.getJob(ACCOUNT_ID, id))!;
    expect(job.items[0]).toMatchObject({ state: 'created', notes: ['html'] });
    const panel = await (await env.api('GET', `/api/jobs/${id}`)).json();
    expect(panel.html).toContain("Saved as HTML: edit it with Mailchimp&#39;s code editor.");
  });

  it('stops on an invalid Supertext key and leaves no half-made draft', async () => {
    const env = setup({ SUPERTEXT_API_KEY: 'invalid' });
    await env.connect();
    await env.saveSettings(STANDARD_SETTINGS);
    const { id } = await (await env.api('POST', '/api/jobs', { campaignId: 'c-autumn', languages: ['de', 'fr'] })).json();
    await env.settle();
    const job = (await env.store.getJob(ACCOUNT_ID, id))!;
    expect(job.status).toBe('failed');
    expect(job.error?.code).toBe('auth');
    expect(job.items).toHaveLength(1);
    expect([...env.mailchimp.campaigns.keys()].filter((key) => key.startsWith('c-copy-'))).toEqual([]);
  });

  it('sends nothing for a language without a Supertext code and goes on with the others', async () => {
    const env = setup();
    await env.connect();
    // Norwegian ("no") has no exact match and no default (Supertext's code is nb), so it needs a mapping.
    await env.saveSettings([...STANDARD_SETTINGS, ['target', 'no']]);
    const settings = await (await env.request('/settings')).text();
    expect(settings).toContain('These languages have no Supertext language yet');
    expect(settings).toMatch(/<select name="code:no"[^>]*><option value="" selected="">— choose —<\/option>/);
    const { id } = await (await env.api('POST', '/api/jobs', { campaignId: 'c-autumn', languages: ['de', 'no'] })).json();
    await env.settle();
    const job = (await env.store.getJob(ACCOUNT_ID, id))!;
    expect(job.status).toBe('done');
    expect(job.items.map((item) => [item.language, item.state, item.error?.code])).toEqual([
      ['de', 'created', undefined],
      ['no', 'failed', 'unsupportedLanguage'],
    ]);
    expect(env.supertext.documents.map((d) => d.target)).toEqual(['de-CH']);
  });

  it('sends languages with Translation review through the review service and the others directly', async () => {
    const env = setup();
    await env.connect();
    await env.saveSettings([...STANDARD_SETTINGS, ['review', 'de']]);
    expect((await env.store.getAccount(ACCOUNT_ID))!.reviewLanguages).toEqual(['de']);
    const settings = await (await env.request('/settings')).text();
    expect(settings).toContain('Translation review');
    expect(settings).toMatch(/<input type="checkbox" name="review" value="de" checked=""/);
    expect(settings).toMatch(/<input type="checkbox" name="review" value="fr"(?! checked)/);
    const { id } = await (await env.api('POST', '/api/jobs', { campaignId: 'c-autumn', languages: ['de', 'fr'] })).json();
    await env.settle();
    expect((await env.store.getJob(ACCOUNT_ID, id))!.items.map((item) => [item.language, item.state])).toEqual([
      ['de', 'created'],
      ['fr', 'created'],
    ]);
    const translate = env.supertextRequests.filter((call) => /\/translate\//.test(call));
    const review = translate.filter((call) => call.includes('://review.test/v1/'));
    const direct = translate.filter((call) => call.includes('://supertext.test/v1/'));
    // de: upload, status, download and delete all at the review service; fr directly at Supertext.
    for (const calls of [review, direct]) {
      for (const step of [/^POST .*\/translate\/ai\/file$/, /^GET .*\/status$/, /^GET .*\/translation$/, /^DELETE /]) {
        expect(calls.some((call) => step.test(call))).toBe(true);
      }
    }
    expect(env.supertext.documents.map((d) => d.target)).toEqual(['de-CH', 'fr-CH']);
    expect(review.length + direct.length).toBe(translate.length);
    // The API key check never goes to the review service.
    expect(env.supertextRequests.filter((call) => call.includes('/features')).every((call) => call.includes('supertext.test'))).toBe(true);
  });

  it("hides Translation review and sends everything directly when SUPERTEXT_REVIEW_URL is ''", async () => {
    const env = setup({ SUPERTEXT_REVIEW_URL: '' });
    await env.connect();
    await env.saveSettings([...STANDARD_SETTINGS, ['review', 'de']]);
    expect(await (await env.request('/settings')).text()).not.toContain('name="review"');
    await env.api('POST', '/api/jobs', { campaignId: 'c-autumn', languages: ['de'] });
    await env.settle();
    expect(env.supertextRequests.length).toBeGreaterThan(0);
    expect(env.supertextRequests.every((call) => call.includes('://supertext.test/'))).toBe(true);
  });

  it('uses the SDK default for a language nobody mapped and preselects it', async () => {
    const env = setup();
    await env.connect();
    await env.saveSettings([...STANDARD_SETTINGS.filter(([name]) => name !== 'code:fr')]);
    const settings = await (await env.request('/settings')).text();
    expect(settings).not.toContain('These languages have no Supertext language yet');
    // Saved value, suggestion, exact match.
    expect(settings).toMatch(/<select name="code:de"[^>]*>(?:(?!<\/select>).)*<option value="de-CH" selected="">/s);
    expect(settings).toMatch(/<select name="code:fr"[^>]*>(?:(?!<\/select>).)*<option value="fr-FR" selected="">/s);
    expect(settings).toMatch(/<select name="code:es"[^>]*>(?:(?!<\/select>).)*<option value="es" selected="">/s);
    const { id } = await (await env.api('POST', '/api/jobs', { campaignId: 'c-autumn', languages: ['de', 'fr'] })).json();
    await env.settle();
    expect(env.supertext.documents.map((d) => d.target).sort()).toEqual(['de-CH', 'fr-FR']);
    expect((await env.store.getJob(ACCOUNT_ID, id))!.status).toBe('done');
  });

  it('translates a language whose Mailchimp code is a Supertext code as it is, and sends no politeness it lacks', async () => {
    const env = setup();
    await env.connect();
    await env.saveSettings([
      ['sourceLanguage', 'en'],
      ['target', 'es'],
      ['target', 'en'],
      ['code:en', 'en-us'],
      ['appTrigger', '1'],
      ['tone', 'more'],
    ]);
    expect((await env.store.getAccount(ACCOUNT_ID))!.languageCodes).toEqual({ en: 'en-US' });
    await env.saveSettings([
      ['sourceLanguage', 'de'],
      ['code:de', 'de-CH'],
      ['target', 'es'],
      ['target', 'en'],
      ['code:en', 'en-US'],
      ['appTrigger', '1'],
      ['tone', 'more'],
    ]);
    const { id } = await (await env.api('POST', '/api/jobs', { campaignId: 'c-autumn', languages: ['es', 'en'] })).json();
    await env.settle();
    const job = (await env.store.getJob(ACCOUNT_ID, id))!;
    expect(job.items.map((item) => [item.language, item.state])).toEqual([
      ['es', 'created'],
      ['en', 'created'],
    ]);
    // The mapping serves the source too (de-CH → de); English has no formal/informal address.
    expect(env.supertext.documents.map((d) => [d.source, d.target, d.politeness])).toEqual([
      ['de', 'es', 'more'],
      ['de', 'en-US', undefined],
    ]);
  });

  it('refuses to translate a draft Supertext made', async () => {
    const env = setup();
    await env.connect();
    await env.saveSettings(STANDARD_SETTINGS);
    await env.api('POST', '/api/jobs', { campaignId: 'c-autumn', languages: ['de'] });
    await env.settle();
    const draft = [...env.mailchimp.campaigns.values()].find((c) => c.id.startsWith('c-copy-'))!;
    const { id } = await (await env.api('POST', '/api/jobs', { campaignId: draft.id, languages: ['fr'] })).json();
    await env.settle();
    expect((await env.store.getJob(ACCOUNT_ID, id))!.error?.code).toBe('isTranslation');
  });

  it('accepts only the languages of the settings', async () => {
    const env = setup();
    await env.connect();
    await env.saveSettings(STANDARD_SETTINGS);
    const response = await env.api('POST', '/api/jobs', { campaignId: 'c-autumn', languages: ['ja'] });
    expect(response.status).toBe(400);
  });
});

describe('translating from a Supertext folder', () => {
  it('translates a campaign moved into a folder and moves it back', async () => {
    const env = setup();
    await env.connect();
    await env.saveSettings(STANDARD_SETTINGS);
    const account = (await env.store.getAccount(ACCOUNT_ID))!;
    const deps = { ...services({ config: env.config, store: env.store, fetch: env.fetchFn }).jobDeps, onJob: env.onJob };

    // First look: remembers where every campaign is.
    expect((await pollAccount(deps, account)).started).toEqual([]);

    moveToFolder(env.mailchimp, 'c-advent', folderId(env, 'Supertext → German')!);
    const first = await pollAccount(deps, account);
    expect(first.started).toHaveLength(1);
    await env.settle();
    expect(env.mailchimp.campaigns.get('c-advent')!.settings.folder_id).toBe('f-seasonal');
    const titles = [...env.mailchimp.campaigns.values()].map((c) => c.settings.title);
    expect(titles).toContain('Advent calendar offer · DE');
    expect(titles).not.toContain('Advent calendar offer · FR');
    const job = (await env.store.getJob(ACCOUNT_ID, first.started[0]))!;
    expect(job).toMatchObject({ trigger: 'folder', status: 'done', languages: ['de'] });

    // Nothing to do on the next look.
    expect((await pollAccount(deps, account)).started).toEqual([]);

    // "All languages" translates into both and replaces the German draft.
    moveToFolder(env.mailchimp, 'c-advent', folderId(env, 'Supertext → All languages')!);
    const again = await pollAccount(deps, account);
    await env.settle();
    const second = (await env.store.getJob(ACCOUNT_ID, again.started[0]))!;
    expect(second.items.map((item) => [item.language, item.state])).toEqual([
      ['de', 'updated'],
      ['fr', 'created'],
    ]);
  });

  it('translates a sent campaign once, even though it cannot be moved back', async () => {
    const env = setup();
    await env.connect();
    await env.saveSettings(STANDARD_SETTINGS);
    const account = (await env.store.getAccount(ACCOUNT_ID))!;
    const deps = { ...services({ config: env.config, store: env.store, fetch: env.fetchFn }).jobDeps, onJob: env.onJob };
    await pollAccount(deps, account);
    moveToFolder(env.mailchimp, 'c-summer', folderId(env, 'Supertext → French')!);
    expect((await pollAccount(deps, account)).started).toHaveLength(1);
    await env.settle();
    expect((await pollAccount(deps, account)).started).toHaveLength(0);
    const draft = [...env.mailchimp.campaigns.values()].find((c) => c.settings.title === 'Summer sale · FR')!;
    expect(draft.settings.subject_line).toBe('Soldes d’été : 20 % sur les pralines glacées');
    expect(draft.status).toBe('save');
  });
});

describe('disconnecting', () => {
  it('removes the empty folders and all data of the account', async () => {
    const env = setup();
    await env.connect();
    await env.saveSettings(STANDARD_SETTINGS);
    const csrf = await env.csrf();
    const response = await env.request('/disconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf }).toString(),
    });
    expect(response.headers.get('location')).toBe('/?disconnected=1');
    expect(await env.store.getAccount(ACCOUNT_ID)).toBeUndefined();
    expect([...env.mailchimp.folders.values()].map((folder) => folder.name)).toEqual(['Seasonal']);
    expect(await (await env.request('/?disconnected=1')).text()).toContain('Mailchimp is disconnected.');
  });
});

describe('Commando Center', () => {
  it('checks the key and reports "installed", then "settings_saved", with the account as the site', async () => {
    const env = setup();
    await env.connect();
    await env.saveSettings(STANDARD_SETTINGS);
    await env.saveSettings(STANDARD_SETTINGS);
    await env.settle();
    // The first back-end page after connecting already reports the installation.
    expect(env.supertext.reports.map((report) => report.event)).toEqual(['installed', 'settings_saved', 'settings_saved']);
    const [installed, saved] = env.supertext.reports;
    expect(installed).toMatchObject({
      schema: 1,
      event: 'installed',
      site_url: `https://admin.mailchimp.com/account/${ACCOUNT_ID}`,
      plugin: { name: 'Mailchimp-Supertext-Translation' },
      system: { name: 'Mailchimp' },
      runtime: { name: 'Node.js' },
      api_key_configured: true,
      api_key_check: { status: 'ok' },
      sdk_version: SDK_VERSION,
    });
    expect(installed).not.toHaveProperty('callback');
    expect(saved).toMatchObject({ event: 'settings_saved' });
    expect(JSON.stringify(env.supertext.reports)).not.toContain('server-key');
    expect(JSON.stringify(env.supertext.reports)).not.toContain('Swiss Chocolate');
    const page = await (await env.request('/settings')).text();
    expect(page).toContain('API key checked: the connection to Supertext works.');
    expect(page).toContain('Send version information to Supertext');
  });

  it('sends nothing when the setting is off, but still checks the key', async () => {
    const env = setup({ SUPERTEXT_API_KEY: 'invalid' });
    await env.connect();
    await env.saveSettings(STANDARD_SETTINGS.filter(([name]) => name !== 'versionReports'));
    await env.settle();
    const before = env.supertext.reports.length; // the first page after connecting, while it was still on
    await env.saveSettings(STANDARD_SETTINGS.filter(([name]) => name !== 'versionReports'));
    await env.request('/');
    await env.api('POST', '/api/test', {});
    await env.settle();
    expect(env.supertext.reports.length).toBe(before);
    const account = (await env.store.getAccount(ACCOUNT_ID))!;
    expect(account.versionReports).toBe(false);
    expect(account.reporter?.keyCheck?.status).toBe('invalid');
    const page = await (await env.request('/settings')).text();
    expect(page).toContain('Supertext rejected the API key.');
  });

  it('SUPERTEXT_VERSION_REPORTS=0 turns reports off for every account', async () => {
    const env = setup({ SUPERTEXT_VERSION_REPORTS: '0' });
    await env.connect();
    await env.saveSettings(STANDARD_SETTINGS);
    await env.settle();
    expect(env.supertext.reports).toEqual([]);
    const page = await (await env.request('/settings')).text();
    expect(page).toMatch(/name="versionReports" value="1" disabled/);
  });

  it('reports a key rejected during a translation once', async () => {
    const env = setup();
    await env.connect();
    await env.saveSettings(STANDARD_SETTINGS);
    await env.settle();
    // The key stops working without the app noticing (onRequest only re-checks a changed key).
    env.supertext.handle = ((original) => async (request: Request) =>
      /\/translate\//.test(request.url) ? new Response('{"detail":"revoked"}', { status: 403 }) : original(request))(env.supertext.handle);
    for (let i = 0; i < 2; i++) {
      await env.api('POST', '/api/jobs', { campaignId: 'c-autumn', languages: ['de'], overwrite: true });
      await env.settle();
    }
    const checks = env.supertext.reports.filter((report) => report.event === 'api_key_check');
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ api_key_check: { status: 'invalid', http_status: 403 } });
  });
});

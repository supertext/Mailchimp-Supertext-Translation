import { describe, expect, it } from 'vitest';
import { TranslationFiles } from 'supertext-sdk';
import { fileReference, MAX_UPLOAD_BYTES, parseReference, PLUGIN, refuseLargeUpload, type ImportSummary } from '../src/translation/files.js';
import { ACCOUNT_ID, setup, STANDARD_SETTINGS } from './helpers.js';

type Env = ReturnType<typeof setup>;

const ready = async (settings = STANDARD_SETTINGS) => {
  const env = setup();
  await env.connect();
  await env.saveSettings(settings);
  return env;
};

const exportFile = async (env: Env, body: Record<string, unknown>) => {
  const response = await env.api('POST', '/api/files/export', { format: 'xliff', ...body });
  return { response, text: await response.text() };
};

const importFile = async (env: Env, content: string, fields: Record<string, string> = {}, headers: Record<string, string> = {}) => {
  const form = new FormData();
  form.set('file', new File([content], 'translated.xlf'));
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  const response = await env.request('/api/files/import', { method: 'POST', body: form, headers: { 'X-CSRF-Token': await env.csrf(), ...headers } });
  return { status: response.status, json: (await response.json()) as { summaries?: ImportSummary[]; html?: string; error?: { code?: string }; text?: string } };
};

/** A translator: copies every XLIFF source into a target with "[xx] " in front. */
const translateXliff = (xliff: string, prefix = '[de] ') =>
  xliff.replace(/<source>([\s\S]*?)<\/source>/g, (_m, inner: string) => `<source>${inner}</source><target>${prefix}${inner}</target>`);

const drafts = (env: Env) => [...env.mailchimp.campaigns.values()].filter((c) => c.id.startsWith('c-copy-'));

describe('references', () => {
  it('round-trips the campaign and the Mailchimp language', () => {
    expect(fileReference('42d7f1a9c3', 'de')).toBe('campaign:42d7f1a9c3:de');
    expect(parseReference('campaign:42d7f1a9c3:pt_BR')).toEqual({ campaignId: '42d7f1a9c3', language: 'pt_BR' });
    expect(parseReference('page:12')).toBeNull();
    expect(parseReference('campaign:x')).toBeNull();
  });
});

describe('export for translation', () => {
  it('exports subject, preview and content with the mapped codes', async () => {
    const env = await ready();
    const { response, text } = await exportFile(env, { campaignId: 'c-autumn', languages: ['de', 'fr'] });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/x-xliff+xml');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="mailchimp-c-autumn.xlf"');
    const jobs = TranslationFiles.read(text);
    expect(jobs.map((job) => [job.plugin, job.reference, job.sourceLanguage, job.targetLanguage])).toEqual([
      [PLUGIN, 'campaign:c-autumn:de', 'en', 'de-CH'],
      [PLUGIN, 'campaign:c-autumn:fr', 'en', 'fr-CH'],
    ]);
    const keys = jobs[0].units.map((unit) => unit.key);
    expect(keys.slice(0, 3)).toEqual(['subject', 'preview', 'body.0']);
    // Merge tags travel as protected codes, never as text a translator could change.
    expect(text).not.toContain('*|FNAME|*');
  });

  it('exports one language as HTML and refuses HTML with several, no campaign or other campaign types', async () => {
    const env = await ready();
    const html = await exportFile(env, { campaignId: 'c-advent', languages: ['fr'], format: 'html' });
    expect(html.response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(html.response.headers.get('content-disposition')).toContain('mailchimp-c-advent-fr-CH.html');
    const several = await exportFile(env, { campaignId: 'c-advent', languages: ['de', 'fr'], format: 'html' });
    expect(JSON.parse(several.text).error.code).toBe('fileHtmlOneLanguage');
    expect(JSON.parse((await exportFile(env, { languages: ['de'] })).text).error.code).toBe('fileSelectOne');
    expect(JSON.parse((await exportFile(env, { campaignId: 'c-autumn', languages: ['it'] })).text).error.code).toBe('fileSelectLanguage');
    expect(JSON.parse((await exportFile(env, { campaignId: 'c-gone', languages: ['de'] })).text).error.code).toBe('campaignMissing');
  });

  it('names an unmapped language by its Mailchimp code and the auto-detected source as und', async () => {
    const env = await ready([['target', 'no'], ['appTrigger', '1'], ['tone', 'default']]);
    const { text } = await exportFile(env, { campaignId: 'c-autumn', languages: ['no'] });
    const [job] = TranslationFiles.read(text);
    expect([job.sourceLanguage, job.targetLanguage]).toEqual(['und', 'no']);
  });
});

describe('import translation', () => {
  it("writes a draft per language through the API translation's write-back", async () => {
    const env = await ready();
    const { text } = await exportFile(env, { campaignId: 'c-autumn', languages: ['de'] });
    const { status, json } = await importFile(env, translateXliff(text));
    expect(status).toBe(200);
    const [summary] = json.summaries!;
    expect(summary).toMatchObject({ title: 'Autumn newsletter', language: 'German', kept: false, state: 'created', skippedChanged: 0 });
    expect(summary.written).toBe(summary.counts.ok);
    const [german] = drafts(env);
    expect(german.settings.title).toBe('Autumn newsletter · DE');
    expect(german.settings.subject_line).toBe('[de] Our autumn chocolates are here');
    expect(german.recipients.segment_opts.conditions).toEqual([{ condition_type: 'Language', field: 'language', op: 'is', value: 'de' }]);
    const html = env.mailchimp.contents.get(german.id)!.html;
    expect(html).toContain('*|FNAME|*');
    expect(html).toContain('*|UNSUB|*');
    expect(json.html).toContain(`Imported: ${summary.written}`);
    expect(json.html).toContain('https://us21.admin.mailchimp.com/campaigns/show/?id=');
    expect((await env.store.translations(ACCOUNT_ID, 'c-autumn')).map((t) => t.language)).toEqual(['de']);
  });

  it('keeps an existing draft unless Update existing drafts, and skips source changes unless asked', async () => {
    const env = await ready();
    const { text } = await exportFile(env, { campaignId: 'c-advent', languages: ['fr'] });
    await importFile(env, translateXliff(text, '[fr] '));
    expect(drafts(env)).toHaveLength(1);
    env.mailchimp.campaigns.get('c-advent')!.settings.subject_line = 'Order your Advent calendar now';

    const kept = (await importFile(env, translateXliff(text, '[fr2] '))).json.summaries![0];
    expect(kept).toMatchObject({ kept: true, state: 'kept', written: 0 });
    expect(drafts(env)[0].settings.subject_line).toBe('[fr] Your Advent calendar is ready to order');

    const updated = (await importFile(env, translateXliff(text, '[fr2] '), { overwrite: '1' })).json.summaries![0];
    expect(updated).toMatchObject({ state: 'updated', skippedChanged: 1 });
    expect(updated.counts.source_changed).toBe(1);
    // The changed subject isn't imported: the draft gets the original's (new) subject.
    expect(drafts(env)[0].settings.subject_line).toBe('Order your Advent calendar now');
    expect(updated.written).toBeGreaterThan(0);

    const included = (await importFile(env, translateXliff(text, '[fr3] '), { overwrite: '1', includeChanged: '1' })).json.summaries![0];
    expect(included.skippedChanged).toBe(0);
    expect(drafts(env)[0].settings.subject_line).toBe('[fr3] Your Advent calendar is ready to order');
  });

  it("doesn't write untranslated texts, broken markup or lost merge tags, and makes no draft without translations", async () => {
    const env = await ready();
    const { text } = await exportFile(env, { campaignId: 'c-autumn', languages: ['de'] });
    const untouched = (await importFile(env, text)).json.summaries![0];
    expect(untouched.counts.untranslated).toBe(untouched.counts.untranslated + untouched.counts.ok);
    expect(untouched.state).toBeUndefined();
    expect(drafts(env)).toHaveLength(0);

    // Only the subject translated; the greeting (with *|FNAME|*) loses its merge-tag code.
    let partly = text.replace(/(<trans-unit id="subject"[^>]*>\s*<source>[\s\S]*?<\/source>)/, '$1<target>Unsere Herbstschokoladen</target>');
    partly = partly.replace(/(<trans-unit id="body\.1"[^>]*>\s*<source>[\s\S]*?<\/source>)/, '$1<target>Hallo, der Herbst ist da</target>');
    const [summary] = (await importFile(env, partly)).json.summaries!;
    expect(summary.counts.ok).toBe(1);
    expect(summary.counts.invalid_markup).toBe(1);
    expect(summary.written).toBe(1);
    const html = env.mailchimp.contents.get(drafts(env)[0].id)!.html;
    expect(html).toContain('*|FNAME|*');
    expect(drafts(env)[0].settings.subject_line).toBe('Unsere Herbstschokoladen');
  });

  it('refuses files of other systems, unknown campaigns and languages the app lacks', async () => {
    const env = await ready();
    const job = (plugin: string, reference: string) => ({
      plugin, reference, sourceLanguage: 'en', targetLanguage: 'de-CH', segments: [{ key: 'subject', text: 'Our autumn chocolates are here' }],
    });
    const file = TranslationFiles.exportXliff([
      job('Wix-Supertext-Translation', 'campaign:c-autumn:de'),
      job(PLUGIN, 'page:12'),
      job(PLUGIN, 'campaign:c-gone:de'),
      job(PLUGIN, 'campaign:c-autumn:it'),
    ]);
    const { json } = await importFile(env, file);
    expect(json.summaries!.map((summary) => [summary.error?.code, summary.error?.params])).toEqual([
      ['fileOtherSystem', { plugin: 'Wix-Supertext-Translation' }],
      ['fileItemGone', {}],
      ['fileItemGone', {}],
      ['fileNoLanguage', { language: 'it' }],
    ]);
    expect(drafts(env)).toHaveLength(0);
  });

  it('reports broken files in the interface language and needs the CSRF token', async () => {
    const env = await ready();
    const broken = await importFile(env, 'not a translation file', {}, { 'Accept-Language': 'fr' });
    expect(broken.status).toBe(400);
    expect(broken.json.error?.code).toBe('fileInvalid');
    expect(broken.json.text).toBe('Ce fichier n’est pas un fichier de traduction XLIFF ou HTML valide.');
    expect((await importFile(env, '<html><body><div data-st-id="0">x</div></body></html>')).json.error?.code).toBe('fileMissingMetadata');
    const form = new FormData();
    form.set('file', new File(['x'], 'x.xlf'));
    expect((await env.request('/api/files/import', { method: 'POST', body: form })).status).toBe(403);
  });

  it('writes an HTML file imported unchanged as the original text', async () => {
    const env = await ready();
    const { text } = await exportFile(env, { campaignId: 'c-advent', languages: ['de'], format: 'html' });
    const [summary] = (await importFile(env, text.replace('Your Advent calendar', 'Ihr Adventskalender'))).json.summaries!;
    expect(summary.state).toBe('created');
    expect(drafts(env)[0].settings.subject_line).toBe('Ihr Adventskalender is ready to order');
  });
});

describe('upload size', () => {
  it('refuses uploads over 10 MB, by Content-Length before reading and by file size', async () => {
    expect(() => refuseLargeUpload(String(11 * 1024 * 1024))).toThrow(expect.objectContaining({ code: 'fileTooLarge' }));
    expect(() => refuseLargeUpload(undefined, { size: MAX_UPLOAD_BYTES + 1 })).toThrow(expect.objectContaining({ code: 'fileTooLarge' }));
    expect(() => refuseLargeUpload(String(MAX_UPLOAD_BYTES), { size: 10 })).not.toThrow();
    const env = await ready();
    const response = await env.request('/api/files/import', {
      method: 'POST',
      body: 'x',
      headers: { 'X-CSRF-Token': await env.csrf(), 'Content-Length': String(MAX_UPLOAD_BYTES * 2), 'Content-Type': 'multipart/form-data; boundary=x', 'Accept-Language': 'de' },
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { text: string }).text).toBe('Die Datei ist zu gross (höchstens 10 MB).');
  });
});

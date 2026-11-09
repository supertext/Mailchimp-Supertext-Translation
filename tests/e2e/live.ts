/**
 * End-to-end test against the REAL Supertext API. There is no Mailchimp account in CI, so
 * the app (the Docker image, as on Railway) talks to the stand-in Mailchimp
 * (tests/standin/mailchimp.ts with the sample account of seed.ts) and to the real
 * Supertext API (SUPERTEXT_API_KEY on the app, never typed into the page).
 *
 * Through the app's own pages, like an editor: connect Mailchimp (the stand-in's OAuth),
 * choose English → German, French and Italian (de-CH, fr-CH, it-CH) in the settings, test
 * the connection, then translate every sample campaign into every language on the
 * Translate page. Then the drafts the stand-in Mailchimp received are checked: one draft
 * per campaign and language (never sent), subject line, preview text and every text block
 * filled and mostly changed, merge tags (*|FNAME|*, *|UNSUB|* …), links and formatting
 * kept, nothing of the protocol left, really in the target language (de-CH without "ß"),
 * originals untouched. Translating again keeps the drafts; with "Update existing drafts"
 * it updates the same drafts in place. See "End-to-end tests" in docs/DEVELOPER.md.
 *
 *   APP_URL=http://127.0.0.1:8081 MAILCHIMP_URL=http://127.0.0.1:8766 npx tsx tests/e2e/live.ts
 */
import { mkdirSync } from 'node:fs';
import { parse, type HTMLElement } from 'node-html-parser';
import { chromium } from 'playwright';

const APP = (process.env.APP_URL ?? 'http://127.0.0.1:8081').replace(/\/$/, '');
const MC = (process.env.MAILCHIMP_URL ?? 'http://127.0.0.1:8766').replace(/\/$/, '');
const artifacts = new URL('./artifacts/', import.meta.url).pathname;
mkdirSync(artifacts, { recursive: true });

/** Mailchimp language → the Supertext code the settings map it to. */
const TARGETS: Record<string, string> = { de: 'de-CH', fr: 'fr-CH', it: 'it-CH' };
const LANGUAGES = Object.keys(TARGETS);

const failures: string[] = [];
function check(name: string, ok: boolean, detail = ''): boolean {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
}
const note = (text: string) => console.log(`note ${text}`);

// Common words, to tell the languages apart. Lower case, whole words.
const STOPWORDS: Record<string, string[]> = {
  en: ['the', 'and', 'is', 'are', 'with', 'for', 'you', 'your', 'our', 'of', 'to', 'we', 'who', 'what', 'this', 'from', 'in', 'on'],
  de: ['der', 'die', 'das', 'und', 'ist', 'sind', 'mit', 'für', 'sie', 'ihre', 'ihr', 'unser', 'unsere', 'wir', 'eine', 'ein', 'den', 'zu', 'von', 'was', 'diese', 'im', 'am'],
  fr: ['le', 'la', 'les', 'et', 'est', 'sont', 'avec', 'pour', 'vous', 'votre', 'vos', 'notre', 'nos', 'nous', 'des', 'une', 'un', 'du', 'de', 'qui', 'que', 'ce', 'dans'],
  it: ['il', 'lo', 'la', 'gli', 'le', 'e', 'è', 'sono', 'con', 'per', 'lei', 'sua', 'suo', 'nostro', 'nostra', 'nostri', 'noi', 'una', 'un', 'del', 'della', 'di', 'che', 'chi', 'questa', 'nel'],
};
const words = (text: string) => text.toLowerCase().match(/\p{L}+/gu) ?? [];
const score = (text: string, lang: string) => words(text).filter((w) => STOPWORDS[lang].includes(w)).length;

const MERGE_TAG = /\*\|[^|*]{1,200}\|\*/g;
const LEFTOVERS = ['data-st-id', 'data-st-ph', 'st-ph-', 'data-mc', 'data-st-a'];
const hasLetters = (text: string) => /\p{L}/u.test(text.replace(MERGE_TAG, ''));
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;
const sorted = (list: string[]) => [...list].sort().join(' ');

// --- The stand-in Mailchimp's API: what Mailchimp would hold ------------------------------
type Campaign = {
  id: string;
  type: string;
  status: string;
  content_type?: string;
  settings: { title: string; subject_line?: string; preview_text?: string; folder_id?: string };
};
async function mailchimp<T>(path: string): Promise<T> {
  const res = await fetch(`${MC}/3.0/${path}`, { headers: { Authorization: 'Bearer standin-token' } });
  if (!res.ok) throw new Error(`Stand-in Mailchimp: GET ${path} answered HTTP ${res.status}`);
  return (await res.json()) as T;
}
const campaigns = async () => (await mailchimp<{ campaigns: Campaign[] }>('campaigns?count=1000')).campaigns;
const html = async (id: string) => (await mailchimp<{ html?: string }>(`campaigns/${id}/content`)).html ?? '';

const BLOCKS = new Set(['title', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'td', 'th', 'div', 'ul', 'ol', 'table', 'tr', 'tbody', 'body']);
/** Innermost text blocks (inner HTML), in document order: title, headings, paragraphs, list items, cells. */
function textBlocks(document: string): string[] {
  const root = parse(document, { comment: false, blockTextElements: { script: false, style: false } });
  const out: string[] = [];
  const isBlock = (e: HTMLElement) => BLOCKS.has(e.rawTagName?.toLowerCase() ?? '');
  const visit = (element: HTMLElement) => {
    const inner = element.querySelectorAll('*').filter(isBlock);
    if (isBlock(element) && inner.length === 0) {
      if (hasLetters(element.text)) out.push(element.innerHTML.trim());
      return;
    }
    for (const child of element.childNodes) if ((child as HTMLElement).rawTagName) visit(child as HTMLElement);
  };
  visit(root as unknown as HTMLElement);
  return out;
}
const plain = (fragment: string) => parse(fragment).text.replace(/\s+/g, ' ').trim();
const hrefs = (document: string) => parse(document).querySelectorAll('a').map((a) => a.getAttribute('href') ?? '');

// --- Setup ------------------------------------------------------------------------------
const before = await campaigns();
const sources = before.filter((c) => c.type === 'regular' || c.type === 'plaintext');
const sourceHtml = new Map<string, string>();
for (const c of sources) sourceHtml.set(c.id, await html(c.id));
console.log(`Stand-in Mailchimp: ${sources.length} campaigns (${sources.map((c) => `${c.settings.title} [${c.status}, ${c.content_type}]`).join('; ')}); targets ${LANGUAGES.map((l) => `${l} → ${TARGETS[l]}`).join(', ')}`);
check('sample account has campaigns', sources.length > 0);
if (!check('fresh account (no translated drafts yet)', !before.some((c) => / · [A-Z]{2}$/.test(c.settings.title)))) {
  throw new Error('Start a fresh stand-in Mailchimp (it keeps its campaigns in memory).');
}

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 }, locale: 'en-US' });
page.setDefaultTimeout(30_000);

// --- Connect Mailchimp (the stand-in approves at once) and save the settings --------------
await page.goto(`${APP}/?lang=en`);
await Promise.all([page.waitForURL(`${APP}/settings`), page.click('text=Connect Mailchimp')]);
check('connected to Mailchimp (stand-in OAuth)', page.url() === `${APP}/settings`, page.url());
check('settings: the server key is used (none typed in)', (await page.locator('input[name="apiKey"]').inputValue()) === '');
await page.selectOption('select[name="sourceLanguage"]', 'en');
for (const [code, supertext] of Object.entries(TARGETS)) {
  await page.check(`#t-${code}`);
  await page.selectOption(`select[name="code:${code}"]`, supertext);
}
await page.check('input[name="appTrigger"]');
await Promise.all([page.waitForURL(/saved=1/), page.click('button.primary')]);
check('settings saved', (await page.locator('.notice.success').count()) > 0);
const settingsWarnings = await page.locator('.notice.warning, .notice.error').allTextContents();
check('settings: no warnings or errors', settingsWarnings.length === 0, settingsWarnings.map((s) => s.replace(/\s+/g, ' ').trim()).join(' | '));
await page.click('#test-button');
await page.waitForSelector('#test-result.ok, #test-result.failed', { timeout: 60_000 });
check('settings: Test connection against the real API', (await page.locator('#test-result.ok').count()) === 1, (await page.locator('#test-result').textContent())?.trim());
await page.screenshot({ path: `${artifacts}settings.png`, fullPage: true });

// --- Translating on the Translate page ------------------------------------------------------
async function translate(label: string, campaign: Campaign, overwrite: boolean, expect: string): Promise<void> {
  const tag = `${label}: ${campaign.settings.title}`;
  await page.goto(`${APP}/?lang=en`);
  const form = page.locator('#translate-form');
  await form.waitFor();
  await page.check(`input[name="campaign"][value="${campaign.id}"]`);
  for (const code of LANGUAGES) {
    const box = page.locator(`input[name="language"][value="${code}"]`);
    if (check(`${tag}: ${code} offered, mapped to ${TARGETS[code]}`, (await box.count()) === 1 && (await form.locator('.languages').textContent())!.includes(TARGETS[code]))) {
      await box.check();
    }
  }
  if (overwrite) await page.check('#overwrite');
  else await page.uncheck('#overwrite');
  const started = Date.now();
  await page.click('#translate-button');
  // The page polls the job and reloads with ?campaign=… when it has finished.
  await page.waitForURL(new RegExp(`campaign=${campaign.id}`), { timeout: 20 * 60_000 });
  await page.locator('.job').waitFor();
  await page.screenshot({ path: `${artifacts}${label}-${campaign.id}.png`, fullPage: true });
  console.log(`${tag}: ${Math.round((Date.now() - started) / 1000)} s`);
  const summary = ((await page.locator('.job .notice').first().textContent()) ?? '').replace(/\s+/g, ' ').trim();
  check(`${tag}: ${expect}`, summary === expect, summary);
  const errors = [
    ...(await page.locator('.notice.error').allTextContents()),
    ...(await page.locator('.job .result.failed').allTextContents()),
    ...((await page.locator('#form-message').textContent())?.trim() ? [(await page.locator('#form-message').textContent())!] : []),
  ].map((e) => e.replace(/\s+/g, ' ').trim());
  check(`${tag}: no error shown`, errors.length === 0, errors.join(' | '));
  const notes = await page.locator('.job .note').allTextContents();
  if (notes.length) note(`${tag}: ${notes.map((n) => n.trim()).join(' | ')}`);
}

/** The drafts of every source campaign, per language (title "<title> · DE"). */
async function drafts(): Promise<{ all: Campaign[]; of: (source: Campaign, lang: string) => Campaign[] }> {
  const all = await campaigns();
  return { all, of: (source, lang) => all.filter((c) => c.settings.title === `${source.settings.title} · ${lang.toUpperCase()}`) };
}

/** Checks one draft against its source; returns [fields, changed fields, visible text]. */
async function checkDraft(tag: string, source: Campaign, draft: Campaign, lang: string): Promise<[number, number, string]> {
  check(`${tag}: draft, not sent`, draft.status === 'save', draft.status);
  const src = sourceHtml.get(source.id)!;
  const out = await html(draft.id);
  let fields = 0;
  let changed = 0;
  let text = '';
  for (const key of ['subject_line', 'preview_text'] as const) {
    const s = source.settings[key] ?? '';
    if (!hasLetters(s)) continue;
    const v = draft.settings[key] ?? '';
    fields++;
    if (!check(`${tag}: ${key} filled`, v.trim() !== '')) continue;
    if (v !== s) changed++;
    else note(`${tag}: ${key} "${s}" unchanged`);
    text += ` ${v}`;
    check(`${tag}: ${key} keeps its merge tags`, sorted(v.match(MERGE_TAG) ?? []) === sorted(s.match(MERGE_TAG) ?? []));
  }
  check(`${tag}: content filled`, out.trim() !== '');
  const left = LEFTOVERS.filter((l) => out.includes(l));
  check(`${tag}: no protocol leftovers`, left.length === 0, left.join(', '));
  const tags = [sorted(out.match(MERGE_TAG) ?? []), sorted(src.match(MERGE_TAG) ?? [])];
  check(`${tag}: merge tags kept`, tags[0] === tags[1], `${(out.match(MERGE_TAG) ?? []).length}/${(src.match(MERGE_TAG) ?? []).length}`);
  check(`${tag}: links kept`, sorted(hrefs(out)) === sorted(hrefs(src)), `${hrefs(out).length}/${hrefs(src).length}`);
  for (const [what, needle] of [['bold', '<strong'], ['italics', '<em'], ['list items', '<li'], ['editable sections', 'mc:edit='], ['images', '<img']]) {
    if (count(src, needle)) check(`${tag}: keeps its ${what}`, count(out, needle) === count(src, needle), `${count(out, needle)}/${count(src, needle)}`);
  }
  const s = textBlocks(src);
  const t = textBlocks(out);
  if (check(`${tag}: same text blocks`, s.length === t.length, `${t.length}/${s.length}`)) {
    s.forEach((block, i) => {
      fields++;
      if (!check(`${tag}: block ${i + 1} filled`, plain(t[i]) !== '' && hasLetters(plain(t[i])), plain(block).slice(0, 40))) return;
      if (plain(t[i]) !== plain(block)) changed++;
      else note(`${tag}: block "${plain(block).slice(0, 60)}" unchanged`);
      text += ` ${plain(t[i])}`;
    });
  }
  return [fields, changed, text];
}

// --- First translation: every campaign into every language --------------------------------
for (const campaign of sources) await translate('first-run', campaign, false, `Done: ${LANGUAGES.length} created, 0 updated, 0 kept, 0 failed.`);
const first = await drafts();
for (const source of sources) {
  check(`${source.settings.title}: original content unchanged`, (await html(source.id)) === sourceHtml.get(source.id));
  for (const lang of LANGUAGES) {
    const tag = `${source.settings.title} → ${TARGETS[lang]}`;
    const found = first.of(source, lang);
    if (!check(`${tag}: exactly one draft`, found.length === 1, String(found.length))) continue;
    const [fields, changed, text] = await checkDraft(tag, source, found[0], lang);
    check(`${tag}: texts were changed by the translation`, fields > 0 && changed / fields >= 0.8, `${changed}/${fields} fields`);
    const scores = Object.fromEntries(Object.keys(STOPWORDS).map((l) => [l, score(text, l)]));
    const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
    check(`${tag}: text is in the target language`, best === lang, JSON.stringify(scores));
    if (TARGETS[lang] === 'de-CH') check(`${tag}: Swiss German spelling (no "ß")`, !text.includes('ß'));
  }
}
const badges = await page.locator(`input[name="campaign"][value="${sources[0].id}"]`).locator('xpath=ancestor::tr').locator('.badge.done').count();
check(`translate page lists the drafts of ${sources[0].settings.title}`, badges === LANGUAGES.length, `${badges}/${LANGUAGES.length}`);

// --- Again: existing drafts are kept; with "Update existing drafts" updated in place --------
const again = sources[0];
const ids = (list: Campaign[]) => sorted(list.map((c) => c.id));
await translate('second-run', again, false, `Done: 0 created, 0 updated, ${LANGUAGES.length} kept, 0 failed.`);
const second = await drafts();
check('translating again without updating keeps the drafts (nothing new)', ids(second.all) === ids(first.all), `${first.all.length} → ${second.all.length} campaigns`);

await translate('third-run', again, true, `Done: 0 created, ${LANGUAGES.length} updated, 0 kept, 0 failed.`);
const third = await drafts();
check('updating existing drafts makes no new campaigns', ids(third.all) === ids(first.all), `${first.all.length} → ${third.all.length} campaigns`);
for (const lang of LANGUAGES) {
  const tag = `updated ${again.settings.title} → ${TARGETS[lang]}`;
  const was = first.of(again, lang).map((c) => c.id).join();
  const now = third.of(again, lang);
  if (check(`${tag}: same draft updated in place`, now.length === 1 && now[0].id === was, `${was} → ${now.map((c) => c.id).join()}`)) {
    const [fields, changed] = await checkDraft(tag, again, now[0], lang);
    check(`${tag}: texts were changed by the translation`, fields > 0 && changed / fields >= 0.8, `${changed}/${fields} fields`);
  }
}

await browser.close();
if (failures.length) {
  console.error(`\n${failures.length} check(s) failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('\nAll end-to-end checks passed.');

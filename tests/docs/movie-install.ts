/**
 * Records the install and configuration movie (a narrated MP4, not committed):
 * connecting the app to Mailchimp and its settings (API key with the fake key
 * st-demo-0000-0000-0000, the key check, the languages with their Supertext
 * code, Translation review left off, the Supertext folders), then the
 * Translate page. Against the stand-in Mailchimp and Supertext APIs, with the
 * shared Supertext movie kit (movie/movie-kit.mjs). See docs/DEVELOPER.md → Demo movie.
 *
 *   pip install piper-tts      # the voice (once); MOVIE_VOICE=0 makes it silent
 *   npm run docs:movie:install
 *
 * MOVIE_OUT: where the MP4 goes (default tests/docs/movie/out/Mailchimp-Supertext-Translation-install.mp4, git-ignored).
 * Chromium: Playwright's own (npx playwright install chromium), or CHROME=/path.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Locator } from 'playwright';
import { startApp } from './movie/app.js';
import { MovieKit } from './movie/movie-kit.mjs';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const mp4 = process.env.MOVIE_OUT ?? here('movie/out/Mailchimp-Supertext-Translation-install.mp4');

async function main() {
  const appUrl = await startApp();
  const workDir = mkdtempSync(join(tmpdir(), 'mailchimp-movie-install-'));
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, locale: 'en-US' });
  page.setDefaultTimeout(60_000);
  await page.goto(appUrl);
  await page.waitForSelector('.connect');

  const kit = await MovieKit.start(page, { workDir, assets: here('movie/assets'), voiceCache: here('movie/voice') });
  /** Scrolls an element to the middle of the window, smoothly. */
  const center = async (locator: Locator) => {
    await locator.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    await kit.hold(800);
  };

  // 1. Connect Mailchimp (the stand-in approves at once; Mailchimp's own login and consent are only told).
  await kit.say('Supertext Translation is a hosted app: nothing to install. Open it and click Connect Mailchimp.', {
    caption: 'Open the app and click <b>Connect Mailchimp</b>',
    during: async () => {
      await kit.moveTo(page.locator('.connect .points'));
      await kit.hold(1200);
      await kit.click(page.locator('.connect a.button.primary'));
      kit.pause();
      await page.waitForURL(`${appUrl}/settings`);
      await page.waitForSelector('input[name="apiKey"]');
      await page.waitForTimeout(300);
      kit.resume();
    },
  });
  await kit.say("Mailchimp asks you to log in and to allow Supertext to work with your campaigns. Confirm, and you're back in the app's settings.", {
    caption: 'Allow access in Mailchimp, back to <b>Settings</b>',
  });

  // 2. API key.
  const key = page.locator('input[name="apiKey"]');
  await kit.say('Generate your API key at supertext.com, under Integrations, API. No account yet? Create one at supertext.com.', {
    caption: 'API key: supertext.com → <b>Integrations → API</b>',
    during: () => kit.moveTo(page.getByRole('link', { name: /Integrations/ }).first()),
  });
  await kit.say('Paste the key into the API key field.', {
    caption: 'Paste it into <b>API key</b>',
    during: () => kit.type(key, 'st-demo-0000-0000-0000'),
  });

  // 3. Languages.
  const source = page.locator('select[name="sourceLanguage"]');
  await kit.say('Under Languages, choose the language you write your campaigns in: English.', {
    caption: '<b>Language of your campaigns</b>: English',
    during: async () => {
      await center(source);
      await kit.moveTo(source);
      await source.selectOption('en');
    },
  });
  const german = page.locator('#t-de');
  const code = page.locator('select[name="code:de"]');
  await kit.say('Tick the languages to translate into. For German, the Supertext code says which German: here, Swiss High German.', {
    caption: 'Tick <b>German</b>: Swiss High German (de-CH)',
    during: async () => {
      await center(german);
      await kit.click(german);
      await kit.moveTo(code);
      await code.selectOption('de-CH');
      await kit.hold(500);
    },
  });
  await kit.say('Translation review can be ticked per language. Leave it off for now.', {
    caption: '<b>Translation review</b>: leave it off',
    during: () => kit.moveTo(page.locator('input[name="review"][value="de"]')),
  });

  // 4. The Supertext folders.
  const folders = page.locator('input[name="folderTrigger"]');
  await kit.say('With Mailchimp folders on, the app creates Supertext folders in Mailchimp: move a campaign into Supertext, German, and the draft appears a minute later.', {
    caption: 'Or use the Mailchimp folder <b>Supertext → German</b>',
    during: async () => {
      await center(folders);
      await kit.moveTo(folders);
    },
  });

  // 5. Save: the key is checked.
  const save = page.locator('button.primary', { hasText: 'Save' });
  await kit.say('Scroll down to the end of the page and click Save.', {
    caption: 'Click <b>Save</b>',
    during: async () => {
      await center(save);
      await kit.click(save);
      kit.pause();
      await page.waitForSelector('.notice.success');
      await page.waitForSelector('#key-check');
      await page.waitForTimeout(300);
      kit.resume();
    },
  });
  await kit.say('Saving checks the API key. The connection to Supertext works.', {
    caption: 'API key checked: <b>the connection to Supertext works</b>',
    during: async () => {
      await center(page.locator('#key-check'));
      await kit.moveTo(page.locator('#key-check'));
    },
  });

  // 6. Where editors translate.
  await kit.say('Your team now finds Translate with Supertext on the Translate page: pick a campaign and the languages.', {
    caption: 'Editors translate on the <b>Translate</b> page',
    during: async () => {
      await kit.click(page.locator('nav.tabs a', { hasText: 'Translate' }));
      kit.pause();
      await page.waitForSelector('#translate-form');
      await page.waitForTimeout(300);
      kit.resume();
      await kit.moveTo(page.locator('#translate-form h2').first());
    },
  });
  await kit.caption('');

  await kit.finish(mp4, { system: 'Mailchimp', repo: 'Mailchimp-Supertext-Translation', kind: 'install' });
  await browser.close();
  rmSync(workDir, { recursive: true, force: true });
  console.log(`Saved ${mp4}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

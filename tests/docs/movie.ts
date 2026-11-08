/**
 * Records the README's demo movie (docs/images/demo.gif, plus a narrated MP4
 * that isn't committed) of the app's Translate page, against the stand-in
 * Mailchimp and Supertext APIs, which return real translations of the sample
 * account. Uses the shared Supertext movie kit (movie/movie-kit.mjs). See
 * docs/DEVELOPER.md → Demo movie.
 *
 *   pip install piper-tts      # the voice (once); MOVIE_VOICE=0 makes it silent
 *   npm run docs:movie
 *
 * MOVIE_OUT: where the MP4 goes (default tests/docs/movie/out/Mailchimp-Supertext-Translation.mp4, git-ignored).
 * Chromium: Playwright's own (npx playwright install chromium), or CHROME=/path.
 */
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startApp } from './movie/app.js';
import { MovieKit } from './movie/movie-kit.mjs';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const mp4 = process.env.MOVIE_OUT ?? here('movie/out/Mailchimp-Supertext-Translation.mp4');
const gif = here('../../docs/images/demo.gif');

async function main() {
  const appUrl = await startApp({ delayMs: 6000 });
  const workDir = mkdtempSync(join(tmpdir(), 'mailchimp-movie-'));
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, locale: 'en-US' });
  page.setDefaultTimeout(60_000);

  // Set up (not recorded): connect through the stand-in's OAuth, key and languages.
  await page.goto(appUrl);
  await page.click('text=Connect Mailchimp');
  await page.waitForURL(`${appUrl}/settings`);
  await page.fill('input[name="apiKey"]', 'st-demo-0000-0000-0000');
  await page.selectOption('select[name="sourceLanguage"]', 'en');
  for (const code of ['de', 'fr']) await page.check(`#t-${code}`);
  await page.selectOption('select[name="code:de"]', 'de-CH');
  await page.selectOption('select[name="code:fr"]', 'fr-CH');
  await page.click('button.primary');
  await page.waitForSelector('.notice.success');
  await page.goto(appUrl);
  await page.waitForSelector('#translate-form');

  const kit = await MovieKit.start(page, { workDir, assets: here('movie/assets'), voiceCache: here('movie/voice') });
  const form = page.locator('#translate-form');
  const button = page.locator('#translate-button');

  await kit.say('This is the Supertext app for Mailchimp. It lists your campaigns, written in English.', {
    caption: 'Your Mailchimp campaigns, in English',
    during: () => kit.moveTo(page.locator('table.items tbody tr').first()),
  });
  await kit.say('Pick the campaign you want to translate: here, the autumn newsletter.', {
    caption: '<b>Choose a campaign</b>: the autumn newsletter',
    during: () => kit.click(page.locator('input[name="campaign"][value="c-autumn"]')),
  });
  await kit.say('Choose the languages. This time, just German: untick French.', {
    caption: 'Choose the languages: <b>German</b>',
    during: async () => {
      await form.locator('.languages').evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'smooth' }));
      await kit.hold(700);
      await kit.click(page.locator('input[name="language"][value="fr"]'));
      await kit.moveTo(page.locator('input[name="language"][value="de"]'));
    },
  });
  const label = ((await button.textContent()) ?? '').trim();
  await kit.say(`Then click ${label}.`, { caption: `Click <b>${label}</b>`, during: () => kit.click(button) });

  await kit.say('Supertext translates the subject line, the preview text and the content.', {
    caption: 'Supertext translates the content…',
    during: async () => {
      const progress = page.locator('#job-panel .progress');
      await progress.waitFor();
      await progress.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'smooth' }));
      await kit.hold(600);
      await kit.moveTo(progress);
    },
  });
  kit.pause();
  await page.waitForURL(/campaign=c-autumn/, { timeout: 120_000 });
  await page.waitForSelector('.job .notice.success');
  await page.waitForTimeout(500);
  kit.resume();

  const job = page.locator('.job');
  await kit.say('A few seconds later, the autumn newsletter has a German draft in Mailchimp, next to the original.', {
    caption: 'Done: a new <b>German</b> draft in Mailchimp',
    during: () => kit.moveTo(page.locator('input[value="c-autumn"]').locator('xpath=ancestor::tr').locator('.badge.done').first()),
  });
  await kit.say('Each language gets its own draft, sent only to the subscribers who speak it.', {
    caption: 'One draft per language, for its subscribers',
    during: async () => {
      await job.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'smooth' }));
      await kit.hold(700);
      await kit.moveTo(job.locator('table.results td.title').first());
    },
  });
  await kit.say('Open it in Mailchimp, review it, and send it as usual.', {
    caption: '<b>Open in Mailchimp</b>, review it and send it',
    during: () => kit.moveTo(job.getByText('Open in Mailchimp').first()),
  });
  await kit.caption('');

  await kit.finish(mp4, { system: 'Mailchimp', repo: 'Mailchimp-Supertext-Translation', gif });
  await browser.close();
  rmSync(workDir, { recursive: true, force: true });
  console.log(`Saved ${mp4} and ${gif} (${(statSync(gif).size / 1e6).toFixed(2)} MB)`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

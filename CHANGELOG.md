# Changelog

All notable changes to Supertext Translation for Mailchimp.

## Unreleased

- Docs: demo movie in the README (`docs/images/demo.gif`, recorded from the app against the stand-ins with `npm run docs:movie`; the MP4 version, not committed, is narrated with the Piper voice “alba”) and an install and configuration movie (`npm run docs:movie:install`: connecting Mailchimp, the API key and its check, the languages, the Supertext folders; narrated MP4, not committed).
- Added: the Supertext support form is linked in the README, the user guide and GitHub's "New issue" page.
- **Added: Translation review** per language (Settings → Languages, a checkbox next to the *Supertext code*): translations into a language with *Translation review* ticked go through Supertext's review service (Supertext Localization Review), where your colleagues or Supertext linguists correct them; corrections come back into the language's draft with the next translation, and texts translated before keep their (reviewed) wording. Same API key, billing, languages and messages; all other languages keep going directly to Supertext. Off for every language by default (existing accounts too). New server setting `SUPERTEXT_REVIEW_URL` (defaults to Supertext's review service; empty turns review off for every account and hides the checkbox). All four interface languages.
- Requests to Supertext name the app's version in the User-Agent (`Mailchimp-Supertext-Translation/<version>`), also those to the review service.
- **Added: Export for translation (XLIFF 1.2 or HTML) and import of translated files; Supertext SDK 0.5.0.** On the Translate page, below the translate button: export the chosen campaign (subject line, preview text, content) for a translator, a translation tool or Supertext's web app (XLIFF with one or more languages, HTML with one), and import the translated file (up to 10 MB). Each language becomes the same draft as with Supertext AI (existing drafts kept unless *Update existing drafts*); texts whose source changed since the export are skipped unless asked, a text that lost a merge tag is refused, and a summary per language links to the draft. All four interface languages; two new screenshots. Bundled Supertext SDK updated to 0.5.0 (commit `a47ca07`).
- Changed: Settings → Languages → *Supertext code* is now a combo box per language with Supertext's languages ("Name (code)", in the interface language) instead of a text field. It starts with the saved code, else Supertext's suggestion; a language nobody mapped is translated with the obvious default (`de` → `de-DE`, `en` → `en-US`, `fr` → `fr-FR`, `it` → `it-IT`, `pt` → `pt-PT`, `zh` → `zh-Hans`, `sr` → `sr-Latn`) instead of failing. Only languages with neither (e.g. Norwegian, Arabic) show *— choose —* and fail with *has no Supertext language yet* until one is chosen. Codes saved before are kept. Supertext SDK 0.4.0 (commit `6aaad33`).
- Changed: Supertext's look: the Supertext logo in a deep-green header, Supertext's colours, pill buttons and the Inter font (bundled, no font from elsewhere), the Supertext favicon, and pages that fit a phone screen (the campaign table scrolls inside its card; Save stays at the bottom of the settings).
- Changed: version reports and the API key check result now use Supertext Plugin Health 0.1.0 (bundled in `vendor/supertext-plugin-health`); Supertext SDK updated to 0.3.0 (commit `f7bd414`). No change for accounts: settings and stored state stay as they are.
- Changed: Supertext is reached through the Supertext SDK for TypeScript (bundled from `vendor/supertext-sdk/` until it is on npm) instead of the app's own client. Same protocol; the app now identifies itself in the User-Agent, and the API key is masked wherever Supertext's answer echoes it.
- Changed: Supertext SDK 0.2.1 (API in the `v1` namespace).
- Changed: no more guessed language codes. Each language is sent with the Supertext code you set under Settings → Languages (picked from Supertext's list; one mapping for the target and the campaign language), else its Mailchimp code if Supertext uses it as it is (`es`, `nl`). A language without one isn't sent and fails with *has no Supertext code yet* (`unsupported_language`); there are no default regions any more (`de` used to be sent as `de-DE`). The settings page shows what each language is sent as and warns about ticked languages without a code; the Translate page marks them.
- Changed: the form of address is sent only for languages where Supertext offers it.
- Added: automatic API key check when the settings are saved, shown under the API key; *Test connection* shows the same messages (with the account and API key links).
- Added: *Send version information to Supertext* (on by default; `SUPERTEXT_VERSION_REPORTS=0` turns it off for all accounts): reports the Mailchimp account's ID, the app, Node.js and SDK versions and the key check result to Supertext's Commando Center. No content, API key or personal data.
- Fixed: a target language Supertext doesn't know is now reported as an unsupported language pair (was: not found).

## 0.1.0 — 2026-10-09

First version (in development: tested against a stand-in of the Mailchimp API, not yet on a real account).

- Hosted app connected to Mailchimp with OAuth: turns a campaign into one draft per language, next to the original, with the subject line, preview text and content translated by Supertext AI.
- Two ways to start, each can be turned off: move a campaign into a *Supertext* folder in Mailchimp (*All languages* or one per language; the original goes back to its folder), or pick campaign and languages on the app's *Translate* page.
- Each draft goes to the subscribers with its language (Mailchimp's language condition, combined with the original's own segment where possible); optionally the original goes only to subscribers without a translated language.
- Keeps layout, images, links and merge tags (refuses a translation that lost one); template campaigns are written into their editable sections, others as HTML; plain-text campaigns too.
- Existing drafts are kept unless *Update existing drafts* is ticked (with a warning); moving a campaign into a folder again translates it afresh.
- Settings per Mailchimp account: Supertext API key (stored encrypted, with account and API key links), *Test connection*, campaign language, target languages with their Supertext codes, the two triggers, the original's audience, form of address, disconnecting, and the app version linked to its release.
- Recent translations from both triggers with the result per language and links into Mailchimp.
- Interface in English, German, French and Italian.
- `npm run mailchimp:probe` to check a real account (read-only, or `--write` on a throw-away copy).

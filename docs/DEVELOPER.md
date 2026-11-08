# Developer guide — Supertext Translation for Mailchimp

A hosted app: a Node.js/TypeScript service (Hono, server-rendered pages) that users connect to their Mailchimp account with OAuth 2. It reads and writes campaigns through the Mailchimp Marketing API v3 and translates them with the Supertext AI file translation API. Hosted on Railway. Mailchimp has no extension point inside its own UI, so the app adds one in Mailchimp itself (campaign folders it watches) and has its own *Translate* page.

## Repository layout

```
src/
  server.ts               entry: database, static files, folder poller, HTTP server
  app.ts                  routes (Hono): start/translate page, OAuth, settings, API for the page's script, health
  config.ts               environment variables
  version.ts              version from package.json, release link
  auth/session.ts         signed session cookies, CSRF tokens, OAuth state
  mailchimp/
    client.ts             OAuth code exchange + metadata; Marketing API (campaigns, content, folders), 429 retries
    email-html.ts         campaign HTML ↔ segments: text blocks, merge-tag placeholders, mc:edit sections
  translation/
    translate.ts          one campaign × one language: collectSegments → Supertext → writeDraft (replicate, settings, segment, content)
    files.ts              translation files: export, import, reference format (SDK TranslationFiles)
    jobs.ts               a job: one campaign × languages, progress, error handling; loadCampaign, currentDraft, rememberDraft, limitOriginal (shared with files.ts)
    segments.ts           the language segment of a draft and of the original
    folders.ts            the Supertext folders: create/rename/remove, poll, start jobs
    languages.ts          Mailchimp language codes, Supertext defaults, names
  supertext/
    client.ts             the app's layer over the Supertext SDK: one client per account (forReview() for languages with Translation review), SDK error codes → app errors
  store/
    store.ts              Store interface, in-memory store, AES-GCM for tokens and keys
    postgres.ts           PostgreSQL store (creates its database and tables)
  i18n/                   en, de, fr, it messages; translator; LocalizedError
  views/                  server-rendered pages (hono/jsx): connect, translate (with the export and import cards), job panel and history, import summary, settings
public/                   app.js (selection, start, polling, export download, import upload, test connection), app.css (Supertext's look, see Look and feel), supertext-logo.svg, favicon.svg, fonts/ (Inter, SIL Open Font License)
scripts/probe.ts          look at a real account (read-only; --write tries the writes on a throw-away copy)
scripts/smoke.sh          the built app against the stand-ins (CI)
scripts/vendor-sdk.sh     updates vendor/supertext-sdk
scripts/vendor-plugin-health.sh  updates vendor/supertext-plugin-health
vendor/supertext-sdk/     the Supertext SDK (TypeScript, built), the app's `supertext-sdk` dependency; see *Supertext SDK*
vendor/supertext-plugin-health/  Supertext Plugin Health (TypeScript, built), the app's `supertext-plugin-health` dependency; see *Supertext Plugin Health*
tests/                    Vitest tests; standin/ (Mailchimp and Supertext stand-ins, sample account); docs/screenshots.ts
```

## How it fits into Mailchimp

- **OAuth 2** (authorization code): `/oauth/start` redirects to `https://login.mailchimp.com/oauth2/authorize` (`response_type=code`, `client_id`, `redirect_uri=APP_URL/oauth/callback`, `state`); the callback exchanges the code at `POST /oauth2/token` and reads `GET /oauth2/metadata` (header `Authorization: OAuth <token>`) for the data center (`dc`), the API endpoint, the account name and `user_id`, which is the account's key in the database. Mailchimp tokens don't expire; a 401 means the user revoked access, so the token is cleared and the user has to connect again. The `state` is a random value in a signed, short-lived cookie.
- **Sessions:** a signed cookie (HMAC-SHA256, 30 days) with the account ID; the token stays in the database (encrypted). Form posts and API calls carry a CSRF token derived from the session cookie. Pages refuse framing (`frame-ancestors 'none'`).
- **API calls:** `https://<dc>.api.mailchimp.com/3.0/…` with `Authorization: Bearer <token>`. HTTP 429 (Mailchimp allows 10 simultaneous connections per user) is retried up to 4 times like Supertext's. Errors become `MailchimpError`s with codes the UI translates (`mailchimpAuth`, `mailchimpForbidden`, `mailchimpUnavailable` …); Mailchimp's own `detail` is shown untranslated.

| Call | Endpoint |
| --- | --- |
| Campaign list (translate page, folder check) | `GET /campaigns?sort_field=create_time&sort_dir=DESC&fields=…` |
| One campaign | `GET /campaigns/{id}` |
| Copy for a language | `POST /campaigns/{id}/actions/replicate` |
| Title, subject, preview, folder, recipients | `PATCH /campaigns/{id}` |
| Content | `GET /campaigns/{id}/content`, `PUT /campaigns/{id}/content` (`template.sections`, else `html`; `plain_text` for plain-text campaigns) |
| Clean-up of a half-made draft | `DELETE /campaigns/{id}` |
| Supertext folders | `GET/POST /campaign-folders`, `PATCH/DELETE /campaign-folders/{id}` |
| Connection check | `GET /ping` |

## How a translation runs

1. **Start.** From the app: `POST /api/jobs` with the campaign and languages (only languages of the settings). From a folder: the poller (below). One job per campaign runs at a time; a second one waits for the first.
2. **Checks** (`jobs.ts`): the campaign exists, isn't a draft the app made (`translations` table), is `regular` or `plaintext`, and has HTML (or plain text).
3. **Segments** (`email-html.ts`, `translate.ts`): subject line and preview text as plain-text segments, then the content. A *text block* is the innermost element with letters and no block-level element inside (p, h1–h6, li, td, div …); its inner HTML is one segment, so a whole paragraph with its `<b>`, `<a href>` travels as one `data-st-id` (the shared rule). Loose text between blocks, `alt` and `title` attributes and the `<title>` are plain segments. `head`, `style`, `script`, `code`, Outlook conditional comments and anything with `translate="no"` or class `notranslate` are left alone. Elements whose attributes are translated get a temporary `data-st-a` marker so they are found again inside translated blocks; it's removed before writing.
4. **Merge tags** (`*|FNAME|*`, `*|IF:…|*`, `*|UNSUB|*` …) in text become empty `<span data-mc="N"></span>` placeholders (numbered per segment) and are put back after translation. If a segment comes back with a placeholder missing or doubled, nothing is written for that language (`mergeTags`); in attributes (links) merge tags aren't touched anyway.
5. **Supertext** (through the SDK's `translateTexts`): all segments of the language as HTML fragments, packed into one document (several above 900,000 characters); source = the account's campaign language, target = the language's Supertext code, `politeness` from the form of address. If a segment doesn't come back, nothing is written (`incomplete`).
6. **Draft:** the language's existing draft (status `save`) is kept, or updated if *Update existing drafts* / the folder trigger asks for it; a sent draft is left alone and a new one made. A new draft is a replica of the original. Then `PATCH` sets the title (`<title> · DE`), the translated subject and preview, the original's folder and the recipients (`segments.ts`): the original's list with a `Language is <code>` condition, combined with the original's own conditions when it uses `match: all`, no saved segment and the total stays within 5 conditions. Content: for `template`/`drag_and_drop` campaigns with a `template_id` the inner HTML of each `mc:edit` element is written as `template.sections`, so the draft stays editable in the classic builder; if Mailchimp refuses (400), the whole HTML is written (`notes: html`). Other campaigns get the HTML. If anything fails after the replica was made, the replica is deleted.
7. **Original:** with *Send the original only to subscribers without a translated language*, a draft or paused original gets `Language is not <code>` for every language with a draft (its earlier language conditions replaced), within the same limits; otherwise the job reports that the audience was kept.
8. **Errors:** authentication, limit, Mailchimp access and campaign problems stop the job; anything else (e.g. `INVALID_LANGUAGE_PAIR`) fails only that language. Jobs still running when the app restarts are marked *interrupted* on the next start.

### Translation files (XLIFF and HTML)

*Export for translation* and *Import translation* (cards on the translate page, `public/app.js`) use the SDK's `TranslationFiles` (SDK 0.5.0, version-neutral, imported from `supertext-sdk`, not `supertext-sdk/v1`). Glue: `src/translation/files.ts`; routes `POST /api/files/export` (JSON → the file) and `POST /api/files/import` (multipart → JSON with the summaries and the summary rendered by `views/files.tsx`), both with the session and the CSRF token like every POST.

- **Segments:** `collectSegments` in `translate.ts`, shared with the API translation: `subject`, `preview`, `body.<n>` (the n-th segment of `EmailDocument`, or the plain-text body as `body.0`). Every segment goes into the file as HTML (`html: true`), so the merge-tag placeholders `<span data-mc="N"></span>` become protected XLIFF codes.
- **Job metadata:** `plugin` = `Mailchimp-Supertext-Translation`; `reference` = `campaign:<campaign id>:<Mailchimp language>` (`fileReference` / `parseReference`); `sourceLanguage` = the account's campaign language as Supertext code (`und` when it is detected automatically), `targetLanguage` = the language's Supertext code (`resolvedTarget`), else the Mailchimp code with `_` → `-`, so unmapped languages never block an export. XLIFF: one job per language in one file; HTML: exactly one. File name `mailchimp-<campaign id>-<target>.xlf|.html` (`mailchimp-<campaign id>.xlf` for several), `application/x-xliff+xml` / `text/html; charset=utf-8`, `Content-Disposition: attachment`; the script saves the response as a blob (the CSRF header can't go with a plain link). The export needs the campaign list, which the page loads only with *Start translations from → The Supertext app* on.
- **Import:** `refuseLargeUpload` checks `Content-Length` before the body is parsed and the file's size (10 MB); nothing is stored. `TranslationFiles.read` errors become `fileInvalid` / `fileMissingMetadata` / `fileTooLarge`; per job: other `plugin` → `fileOtherSystem`, unparsable reference or missing campaign → `fileItemGone`, a language not in the account's targets → `fileNoLanguage`, and `loadCampaign`'s own checks (a draft made by the app, other campaign types). An existing draft (`currentDraft`) is kept unless *Update existing drafts*. Then `importTranslations(file, fileSegments(collected))`; `ok` (and `source_changed` with *Also import texts whose source changed*) results are checked with `segmentResult` (every merge tag must come back; otherwise counted as `invalid_markup`) and written with `writeDraft`, the API path's write-back (replica or update, title, subject, preview, folder, language segment, template sections or HTML); keys without a translation keep the original's text, because a draft is always a whole email. No translation at all → no draft. Then `rememberDraft` and, once per campaign, `limitOriginal`, as after a job.
- Tests: `tests/files.test.ts` through the routes against the stand-ins.

### The folder trigger

`folders.ts`. On saving the settings (and connecting), `syncFolders()` keeps the account's folders in line: *Supertext → All languages* plus *Supertext → <language>* per target, named in the interface language of whoever saved (`folderLocale`); renamed when that changes; a folder no longer wanted is deleted if empty, else left as an ordinary folder. Folder IDs and what they start are stored with the account.

The poller (`startPoller`, every `FOLDER_POLL_SECONDS`, default 60) lists every campaign's ID and folder of each account with the folder trigger (one call per 1,000 campaigns, `fields` limited) and compares with the last look (`folder_entries`):

- a campaign in a Supertext folder is moved back to the folder it was last seen in outside them (`folder_id: ""` if none or unknown), then a job translates it into that folder's languages with `overwrite: true` (moving it in again asks for a fresh translation);
- if Mailchimp refuses the move (sent campaigns), the campaign is translated once and marked `handled` until it leaves the folder.

Runs don't overlap; a 401 clears the account's token.

## Interface languages

English, German, French and Italian. Mailchimp doesn't pass a language to apps, so the app follows `?lang=` (top-bar switch, stored in the `st_locale` cookie), then `Accept-Language`, then English. Strings live in `src/i18n/{en,de,fr,it}.ts`; `en.ts` defines the keys and the others are typed `Messages`, so a missing key fails `npm run typecheck`, and `tests/i18n.test.ts` checks keys, placeholders, URLs, "Supertext" and "Mailchimp". **Every new or changed string gets all four languages in the same commit**, formal address (Sie, vous, Lei) and Mailchimp's own terms (Kampagne, Zielgruppe, Entwurf, Merge-Tags; campagne, audience, brouillon, balises de fusion; campagna, pubblico, bozza, tag di unione), French narrow no-break space before `? ! : ;`. Language names come from `Intl.DisplayNames`. Errors are `LocalizedError`s (English message for logs, `code` → `error.<code>`).

## Look and feel

The pages follow supertext.com: the deep-green header bar (`#003230`, rounded bottom corners) with Supertext's mint logo (`public/supertext-logo.svg`, the website's own SVG) and the interface language switch, the warm off-white background (`#f7f5f3`), deep-green text and outlines, mint (`#78ffaf`) for the main action, the active tab and language, and finished translations, light grey lines (`#dfe1df`), and pill-shaped buttons. Text is set in Inter, bundled in `public/fonts/` (variable font, Latin and Latin Extended; SIL Open Font License in `Inter-LICENSE.txt`), so no font is loaded from elsewhere. Supertext's heading font (ABC Ginto Nord) is licensed and not bundled; headings use Inter Bold. The colours are CSS variables at the top of `public/app.css`. The favicon is the logo's S mark on deep green. On phones (up to 640 px) the header wraps, the campaign table scrolls inside its card and Save stays at the bottom of the settings.

## Supertext API protocol

AI file translation API v1 at `https://api.supertext.com/v1/` (upload an HTML file, poll its status, download the translation, delete the file), handled entirely by the Supertext SDK: the `Supertext-Auth-Key` header (a pasted prefix is stripped), the multipart upload with a file part of type exactly `text/html`, HTTP 429 retries (`Retry-After`, else 1/2/4/8 s with jitter), polling every 2 s with a 3-minute timeout, the delete after every upload, the HTML packing (one `<div data-st-id="N">` per segment) and the language codes. See the SDK's [integration guide](https://github.com/Supertext/Supertext-API-SDK-and-Guide/blob/main/docs/integration-guide.md) and [API reference](https://github.com/Supertext/Supertext-API-SDK-and-Guide/blob/main/docs/api-reference.md).

`src/supertext/client.ts` creates one SDK client per account with the key and the base URL (`SUPERTEXT_API_ENDPOINT` for stand-ins), sends `Mailchimp-Supertext-Translation/<version>` in the User-Agent, and turns the SDK's error codes into the app's (`authentication_failure` → `auth`, `quota_exceeded` → `limitExceeded`, `invalid_language_pair` → `languagePair`, `unsupported_language` → `unsupportedLanguage`, `unsupported_feature` → `unsupportedFeature`, `transport_error` → `unreachable`, `incomplete_response` → `incomplete` …), which the interface shows in its four languages. *Test connection* and the automatic key check are the SDK's cost-free `checkApiKey()` (`GET features`; see *Commando Center*). The key is the account's own (Settings, AES-256-GCM encrypted with `APP_ENCRYPTION_KEY`, else a key derived from `MAILCHIMP_CLIENT_SECRET`), else `SUPERTEXT_API_KEY`. The SDK never puts the key into error details.

**Translation review** (`Account.reviewLanguages`, a checkbox per language under Settings → Languages, stored with the account's other settings in its JSON, so existing accounts start with `[]`, review off): `runJob` takes `supertext.forReview(account.reviewLanguages.includes(language))` for each language, a second SDK client with the same key, timeouts, `fetch` and User-Agent whose base URL is `SUPERTEXT_REVIEW_URL` (`Config.reviewUrl`, default `REVIEW_URL` in `src/supertext/client.ts`, the translation proxy of [Supertext Localization Review](https://github.com/Supertext/Localization-Review-Supertext-Translation)), created once per account client. `translateSegments` does the whole round trip (upload, status, download, delete) on one client, so a document is always collected where it was submitted. The proxy speaks the same API v1, forwards to the live Supertext API with the account's key, stores every segment per key and serves reviewers' corrections on the next upload, so nothing else changes in the app. `SUPERTEXT_REVIEW_URL=` (empty) or the same URL as the API means `forReview()` always returns the direct client, and the settings page hides the column. The key check (*Test connection*, Commando Center), version reports and translation-file export/import never use the review service. Tests: `tests/supertext.test.ts` (all four calls at the review URL, other languages direct, off when empty or equal to the API URL, the default) and `tests/flow.test.ts` (the setting saved and shown, a job with one review and one direct language; `tests/helpers.ts` routes `review.test` to the stand-in and records every Supertext request in `supertextRequests`).

## Supertext SDK

All Supertext calls go through the [Supertext SDK](https://github.com/Supertext/Supertext-API-SDK-and-Guide) (`sdk/typescript`, npm name `supertext-sdk`, 0.5.0; since 0.2.0 the API is in the `v1` namespace, imported as `supertext-sdk/v1`; `TranslationFiles` comes from `supertext-sdk`), the shared client of all Supertext plugins, wrapped by `src/supertext/client.ts`. It provides the API client and the API key check (`checkApiKey()`, `apiKeyFingerprint()`, `SDK_VERSION`); version reports come from Supertext Plugin Health (next section). It isn't on npm yet, so it is a file dependency (`"supertext-sdk": "file:vendor/supertext-sdk"`): `vendor/supertext-sdk/` holds its built JavaScript and type declarations, a lean `package.json`, `LICENSE`, `COMMIT` (the SDK commit), `VERSION` and a `README.md`. The Docker image copies `vendor/` before `npm ci`. Never edit it: fix the SDK repository and copy it again:

```bash
scripts/vendor-sdk.sh                  # latest main of the SDK repository
scripts/vendor-sdk.sh <commit-or-branch>
SDK_DIR=/path/to/clone scripts/vendor-sdk.sh   # a local clone as it is
```

then `npm install`, run the tests and commit `vendor/`, `package-lock.json` and any app changes with a CHANGELOG entry. Same layout and script as the other npm plugins (e.g. Directus). Once the SDK is on npm, the dependency becomes `"supertext-sdk": "^x.y.z"` and `vendor/` and the script go; the imports stay.

## Supertext Plugin Health

[Supertext Plugin Health](https://github.com/Supertext/Commando-Center-Supertext-Translation/tree/main/plugin-health) (`plugin-health/typescript` in the Commando Center repository, npm name `supertext-plugin-health`, 0.1.0) sends the version reports and the API key check result to the Supertext Commando Center (`InstallationReporter`, `reportsEnabled()`; its ping answer isn't used, the app is hosted). It has no dependencies and doesn't call Supertext: `src/reporting.ts` passes it `SDK_VERSION` and a key checker built on the SDK (`{ check: (key) => new SupertextClient(key, …).checkApiKey(), fingerprint: apiKeyFingerprint }`). Like the SDK it is a file dependency (`"supertext-plugin-health": "file:vendor/supertext-plugin-health"`): `vendor/supertext-plugin-health/` holds its built JavaScript and type declarations, a lean `package.json`, `LICENSE`, `COMMIT`, `VERSION` and a `README.md`. Never edit it: fix it in Commando-Center-Supertext-Translation/plugin-health and copy it again:

```bash
scripts/vendor-plugin-health.sh <tag>                          # e.g. plugin-health-v0.1.0 (default: main)
PLUGIN_HEALTH_DIR=/path/to/clone scripts/vendor-plugin-health.sh   # a local clone as it is
```

then `npm install`, run the tests and commit `vendor/`, `package-lock.json` and any app changes with a CHANGELOG entry.

## Language codes

Supertext accepts only the codes its `GET features` lists (the SDK's `Languages`, `supertext-sdk/v1`; spec `spec/languages.json` in the SDK repository): sources are bare (`en`); targets are regional only for de/en/fr/it/pt (`de-CH`, `en-US`, `pt-BR`), script for zh/sr (`zh-Hans`, `sr-Latn`), `gsw-u-sd-chzh`/`chbe`, and bare for everything else (`es`, `nl`, `nb`, `sl`). Anything else is HTTP 404 `INVALID_LANGUAGE_PAIR`.

**Mapping, exact match, obvious default, nothing else.** Mailchimp's subscriber languages are two-letter codes (`LANGUAGE_CODES` in `src/translation/languages.ts`). Each account has its own **language mapping**, `Account.languageCodes` (Mailchimp code → Supertext code), chosen per language on the settings page in a combo box (`<select name="code:<language>">`, options `Languages.targetOptions()` as "Name (code)", names localized with `Intl.DisplayNames`, sorted by name; see `targetOptions()` in `languages.ts`). The box preselects the saved code, else `Languages.suggestTarget(code)`, else *— choose —* (empty, not saved). The form handler saves a value only if `Languages.matchTarget` finds it, in its exact form (`de_ch` → `de-CH`; anything else is refused with *Saved, except these codes …*). There is no environment override: a hosted app has one mapping per Mailchimp account. Accounts saved before the combo box keep their codes as they are: the old text field already stored only exact Supertext codes, which the box now preselects (a stored code Supertext no longer lists stays shown as an extra option). One mapping serves both directions:

- **Target** (`supertextTarget` = `Languages.target(code, mapping)`): the mapping, else an exact match of the Mailchimp code (`es`, `nl`; case and `_`/`-` ignored), else the SDK default (`Languages.defaultTarget`: `de` → `de-DE`, `en` → `en-US`, `fr` → `fr-FR`, `it` → `it-IT`, `pt` → `pt-PT`, `zh` → `zh-Hans`, `sr` → `sr-Latn`), else the SDK error `unsupported_language` (e.g. `no`, which needs a mapping to `nb`). The job then fails that language with `unsupportedLanguage` (*has no Supertext language yet*, four languages, pointing to Settings → Languages → *Supertext code*) and sends nothing for it; the other languages go on.
- **Source** (`supertextSource` = `Languages.source(code, mapping)`): the mapping's value in its source form (`en-US` → `en`), else the bare Supertext source (`en`), else `unsupported_language` (the whole job fails, nothing sent). Empty lets Supertext detect it.
- **Politeness:** the account's form of address is sent only where `Languages.supportsPoliteness(target)` is true; elsewhere nothing is sent (Supertext would answer `FEATURE_ERROR`, `unsupported_feature` → `unsupportedFeature`).
- The settings page warns about ticked languages with neither a mapping nor a default (their box shows *— choose —*) and about an unsupported campaign language, and names the ticked languages without politeness; the Translate page shows the code each language is sent as, or *No Supertext language yet*.
- Supertext would accept `en` → `en-GB`, but a draft in the campaign's own Mailchimp language would go to the same subscribers, so the campaign language is left out of the targets.

The stand-in (`tests/standin/supertext.ts`) accepts only `Languages.TARGETS` (else 404 `INVALID_LANGUAGE_PAIR`) and refuses politeness where the target has none, like the live API.

## Commando Center

Version reports, the automatic API key check and the key status go to the Supertext Commando Center ([Commando-Center-Supertext-Translation](https://github.com/Supertext/Commando-Center-Supertext-Translation) → `docs/DEVELOPER.md` → *Report protocol*) through Supertext Plugin Health's `InstallationReporter` with the SDK's `checkApiKey()`; the app never builds a report itself. `src/reporting.ts` is the glue:

- **One installation per connected Mailchimp account.** Site URL `https://admin.mailchimp.com/account/<account ID>` (`siteUrl()`: Mailchimp accounts have no website, the center keeps paths but drops queries, and the account ID is stable and not personal), plugin `Mailchimp-Supertext-Translation` with the version from `package.json` (`src/version.ts`), system `Mailchimp` without a version, runtime Node.js (Plugin Health's default) and `SDK_VERSION`. A hosted app: **no ping endpoint and no `callbackUrl`**.
- **State:** Plugin Health's `ReporterState` JSON (the same format the SDK 0.2 reporter stored, so the switch sent no new `installed`) in `Account.reporter` (the `data` JSONB of `accounts`). Only `Store.saveReporterState()` writes it (`jsonb_set`), and `saveAccount()` keeps the stored one, so a settings save never puts back an older state. Calls are serialized per account.
- **When:** `afterSettingsSaved` after `POST /settings` (awaited; the key check is shown under the API key with its time and the center's messages, `keyCheck.*` in four languages, links in a new tab); `onRequest` in the background on `GET /`, `GET /settings` and `POST /api/jobs` (not on the folder poller); `authenticationFailed` when a translation gets 401/403 (`JobDeps.onAuthenticationFailed`); `testConnection` on *Test connection* with the saved key (a typed, unsaved key is only checked with `checkApiKey()`, nothing stored or reported).
- **Setting:** `Account.versionReports` (*Send version information to Supertext*, on by default), combined by Plugin Health's `reportsEnabled()` with `SUPERTEXT_VERSION_REPORTS` (`0` turns it off for every account and disables the checkbox). Off: nothing is sent; the key check still runs.
- **Never breaks anything:** `Reporting.run()` catches everything (Plugin Health already never throws; store errors are logged), reports time out after 3 s and wait an hour after a failure. The key is never logged or sent; the state keeps only its SHA-256 fingerprint (the SDK's `apiKeyFingerprint()`) to notice a changed `SUPERTEXT_API_KEY`.
- **Tests never reach the live center:** `SUPERTEXT_REPORT_URL` points at the stand-in (`tests/standin/supertext.ts` answers `POST /report` and records `reports`) in `tests/helpers.ts`, `scripts/smoke.sh` and the screenshot script; `tests/reporting.test.ts` covers the glue, `tests/flow.test.ts` → *Commando Center* the events.

## Local development

Requirements: Node.js 22.12+ (CI runs the tests and the smoke test on Node 22, 24 and 26; the Docker image uses Node 22). No Mailchimp account needed for most work: the stand-ins answer like Mailchimp (OAuth and the API calls above) and Supertext for a sample account (`tests/standin/seed.ts`: a Swiss chocolate shop with a template campaign, an HTML campaign in a folder of its own with an interest segment, and a sent campaign; `samples.json` holds human translations of their texts into German, French and Italian).

```bash
npm install
npm run standin            # stand-in Mailchimp :8766, stand-in Supertext :8765
MAILCHIMP_CLIENT_ID=standin MAILCHIMP_CLIENT_SECRET=standin-secret MAILCHIMP_LOGIN_BASE=http://127.0.0.1:8766 \
SUPERTEXT_API_ENDPOINT=http://127.0.0.1:8765/v1/ SUPERTEXT_API_KEY=any FOLDER_POLL_SECONDS=5 npm run dev
# open http://127.0.0.1:8080 and click Connect Mailchimp (the stand-in approves at once)
```

Without `DATABASE_URL`, everything lives in memory. To move a campaign into a folder of the stand-in: `curl -X PATCH http://127.0.0.1:8766/3.0/campaigns/c-advent -H 'Authorization: Bearer standin-token' -H 'Content-Type: application/json' -d '{"settings":{"folder_id":"<id>"}}'`.

Against real Mailchimp you need a registered app (below) whose redirect URI points at your app; for local work register `http://127.0.0.1:8080/oauth/callback` (Mailchimp accepts it for development).

### Looking at a real account

```bash
MAILCHIMP_API_KEY=<key>-us21 npm run mailchimp:probe -- [campaignId]           # read-only
MAILCHIMP_API_KEY=<key>-us21 npm run mailchimp:probe -- <campaignId> --write   # also tries the writes on a copy
```

An API key (Mailchimp → Profile → Extras → API keys) works like an OAuth token for these calls. The read-only run lists folders, the latest campaigns (type, content type, status, folder, template, segment) and how the app would split the chosen campaign (segments, merge tags, `mc:edit` sections, unchanged round trip), and saved segments with a language condition. `--write` replicates the campaign, moves the copy into a new folder and out again, sets the language segment and writes the content (sections, else HTML), then deletes the copy and the folder.

## Tests

```bash
npm test             # Vitest: email HTML and merge tags, segments, sessions, the app's SDK layer, languages, reporting, i18n, full flow, translation files
npm run typecheck
npm run build
bash scripts/smoke.sh   # after build: the built app against the stand-ins
```

The protocol itself (multipart, retries, polling, packing, language codes, error mapping) is tested in the SDK repository against its shared test vectors.

`tests/flow.test.ts` runs the whole app (`createApp`) against the stand-ins with an in-memory store: OAuth, settings and folders, Translation review (review languages through `review.test`, the others direct), translating from the app (drafts, segments, merge tags, template sections and the HTML fallback, kept and updated drafts, errors) and from folders (moved back, sent campaigns), disconnecting. `tests/files.test.ts` covers export and import: reference round trip, keys and codes, every import outcome, lost merge tags, kept drafts, upload size.

## Screenshots

```bash
npm run docs:screenshots   # Playwright, 1× scale, into docs/images/
```

`tests/docs/screenshots.ts` starts the stand-ins and the app in-process, connects through the stand-in's OAuth and captures the app's pages (connect, settings with Translation review ticked for German (the review service is a second address of the Supertext stand-in), translate page, results, list afterwards, update warning, export for translation and the import summary after an HTML round trip, German UI). Regenerate them in the same commit as any UI change they show. Chromium: Playwright's own (`npx playwright install chromium`) or `CHROME=/path/to/chrome`. Screenshots of Mailchimp's own screens (the Supertext folders, a draft) follow from the demo account.

## CI

`.github/workflows/ci.yml`: typecheck, tests, build, then `scripts/smoke.sh`: the built app against the stand-ins (OAuth with a cookie jar, settings, a job translating into two languages, a campaign moved into *Supertext → German* and translated by the poller and moved back, an API call without a session refused).

## Code quality and security checks

- *Checks* workflow (`.github/workflows/checks.yml`): actionlint and zizmor lint the workflows on every push and PR; dependency review fails a PR that adds a package with a known vulnerability (moderate or worse).
- *Links* workflow (`.github/workflows/links.yml`): lychee checks all Markdown links weekly and when docs change; broken links open or update the issue "Broken links in the docs". Links that can't work from CI (the local app and stand-ins, API and OAuth endpoints without credentials) are listed in `.lycheeignore`.
- All workflows default to `permissions: contents: read` (the release job alone gets `contents: write`), check out with `persist-credentials: false`, and pin every action to a commit SHA with the version as a comment; Dependabot keeps the pins current.
- GitHub settings (set by Remy's setup script, not in the repo): secret scanning with push protection (a push containing a known token format is rejected; findings under Security → Secret scanning) and CodeQL default setup (findings under Security → Code scanning and as PR comments).
- Before starting work in this repo, look at its open findings: code scanning alerts, secret scanning alerts, Dependabot PRs and the "Broken links in the docs" issue.
- `.github/workflows/support-triage.yml`: support requests from the Supertext integrations website arrive as issues labelled `support` (contact details stay in the Supertext CMS). Claude classifies each one: answers questions (marked `<!-- supertext:reply -->`, emailed to the sender by the CMS) and closes them, fixes bugs as pull requests for review (never merged automatically), labels feature requests `feature-request`. Only people with triage rights can add labels, so outsiders can't start it. Needs the organisation secret `ANTHROPIC_API_KEY`; the workflow is the same in every Supertext repo.

## Hosting (Railway)

The service **Mailchimp** in the Railway project *supertext-cms-demos* builds this repo's `Dockerfile` (context = repo root; set on the service, Railway ignores `railway.json`). Health check `/health`. Every push to `main` deploys. One instance only: the folder poller and jobs run in the web process.

| Variable | Value |
| --- | --- |
| `APP_URL` | the service's public URL; `APP_URL/oauth/callback` is the app's redirect URI in Mailchimp |
| `MAILCHIMP_CLIENT_ID`, `MAILCHIMP_CLIENT_SECRET` | from the registered app (below) |
| `SESSION_SECRET` | random secret for session cookies |
| `DATABASE_URL` | the shared Postgres service's URL with database `mailchimp_supertext` (created on first start) |
| `APP_ENCRYPTION_KEY` | random secret for stored tokens and keys; optional (falls back to the client secret) |
| `SUPERTEXT_API_KEY` | optional default key (the demo account) |
| `SUPERTEXT_REVIEW_URL` | optional: the review service for languages with *Translation review* on (default: Supertext's review service; empty turns review off for every account and hides the setting) |
| `FOLDER_POLL_SECONDS` | optional, default 60 |
| `SUPERTEXT_VERSION_REPORTS` | optional; `0` turns the version reports off for every account |
| `SUPERTEXT_REPORT_URL` | optional; tests and stand-ins only (default: the live Commando Center) |

Never commit these values.

## Registering the app in Mailchimp

Once, in Supertext's Mailchimp account: **Profile → Extras → Registered apps → Register an app** (https://us1.admin.mailchimp.com/account/oauth2/): name *Supertext Translation*, website https://www.supertext.com, redirect URI `APP_URL/oauth/callback`. Copy the client ID and secret (shown once) into the Railway variables. A Mailchimp Marketplace listing (review by Mailchimp) comes later; until then users open the app's URL directly.

## Demo

The demo is a Mailchimp account, not a container: Mailchimp hosts the campaigns, Railway only the app. Set it up by hand (Mailchimp accounts can't be created from outside):

1. A free Mailchimp account *Supertext Demo* with an audience *Newsletter* and a few test contacts with the languages English, German, French and Italian.
2. Campaigns in English with the texts of `tests/standin/seed.ts`: one from a classic template, one in HTML.
3. **Accounts** (the demo accounts rule, as far as Mailchimp allows): Supertext staff get access as Mailchimp users with the **Admin** role; for tests and screenshots invite a user with the **Manager** role (can create and edit campaigns). Mailchimp users are invited by hand and can't be created from Railway variables; passwords stay in Keeper, never in the repo or chat.
4. Connect the demo account in the app, enter the API key under Settings or set `SUPERTEXT_API_KEY` on Railway, choose German, French and Italian.

## Dependency updates

Dependabot (`.github/dependabot.yml`) opens weekly pull requests: minor and patch updates grouped into one, GitHub Actions in another, each major update on its own. Merge one when CI is green and it doesn't change what the app supports.

One major version is ignored on purpose: `@types/node` (the types must match the oldest Node version the app supports, Node 22, not the newest). Lift the ignore rule when the app moves to a new minimum Node version.

## Releasing

`package.json` holds the version (the release workflow's `VERSION_FILES`); the settings page reads it at runtime.

1. Move the *Unreleased* entries in `CHANGELOG.md` under a new `## X.Y.Z — YYYY-MM-DD` heading, leaving *Unreleased* empty.
2. Set the same version in `package.json` and `package-lock.json` (`npm version X.Y.Z --no-git-tag-version`).
3. Push to `main`. `.github/workflows/release.yml` tags `vX.Y.Z` and creates the GitHub release with the changelog section; 0.x versions are pre-releases. Railway deploys the code on the same push.

Never tag or create releases by hand.

## Known limitations / roadmap

- **Not yet tested on a real Mailchimp account.** The app follows the Marketing API reference; check these with `npm run mailchimp:probe -- <campaign> --write` on the demo account, and adapt the code if Mailchimp differs:
  - that `PUT …/content` still accepts `template.sections` (the current reference documents only `html`, `plain_text` and `variate_contents`) and keeps a classic-template draft editable; otherwise the drafts are saved as HTML (code-your-own);
  - what campaigns made with Mailchimp's **new email builder** return: their content type and whether their HTML can be read and written through the API at all;
  - that `folder_id: ""` takes a campaign out of all folders, and whether sent campaigns can be moved between folders;
  - the language condition's format in segments (`{condition_type: "Language", field: "language", op: "is", value: "de"}`) and the limit of 5 conditions.
- The folder check needs one listing of all campaigns per account per minute; accounts with more than 5,000 campaigns are only checked for the newest 5,000.
- Jobs and the poller run inside the web process (one Railway instance); a restart marks a running job *interrupted*. A queue comes later.
- Translation review: reviewers' corrections reach Mailchimp only with the next translation (no push); updating a draft overwrites manual changes made in Mailchimp. The review service works only with live Supertext keys.
- Translation files export one campaign at a time and need *Start translations from → The Supertext app* on for the campaign list.
- Not translated: A/B tests (variate content), RSS campaigns, automations / Customer Journeys, templates themselves, signup forms and landing pages.
- No Mailchimp Marketplace listing yet: needs Mailchimp's review; until then the app's URL.

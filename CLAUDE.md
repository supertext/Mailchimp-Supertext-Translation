# Working on this repository

Part of Supertext's translation plugins project: Supertext AI translation for the top open source CMS, PIM, shop and email systems. Each system has its own repo named `Supertext/<System>-Supertext-Translation`.

This repo is a **hosted Mailchimp app**: a Node.js/TypeScript service (Hono, server-rendered pages) that users connect to Mailchimp with OAuth. It turns a campaign into one draft per language through the Mailchimp Marketing API v3, started either by moving the campaign into a *Supertext* folder in Mailchimp (polled every minute) or on the app's *Translate* page. Hosted on Railway. See `docs/DEVELOPER.md`.

## Documentation rule (always)

Every plugin repo keeps three guides, and **every change that affects behaviour, settings, installation or the code structure updates them in the same commit**:

| File | Audience | Must cover |
| --- | --- | --- |
| `docs/INSTALLATION.md` | Administrators | Requirements, install/update/uninstall, API key, language setup, all settings, troubleshooting |
| `docs/USER_GUIDE.md` | Editors | How to translate and review in the CMS's own UI, what is and isn't translated, what errors mean |
| `docs/DEVELOPER.md` | Developers | Architecture, Supertext API protocol, local setup, tests, CI/deploy, releasing, known limitations/roadmap |

Also: `README.md` stays a short overview linking the three guides, and `CHANGELOG.md` gets an entry under *Unreleased* for every user-visible change. Before finishing any task, check the docs still match the code.

## Supertext account and API key links (always)

Everywhere an administrator enters or is told about the API key — the settings field's help text, the "no API key" / "authentication failed" messages, `docs/INSTALLATION.md`, `README.md` and `.env.example` — show both links (same as the WordPress plugin):

- Create a Supertext account (or log in): https://www.supertext.com/person/en/account/signin
- Generate the AI API key: https://www.supertext.com/en/integrations/api (supertext.com → Integrations → API; requires the **Admin** role)

Wording: "No Supertext account yet? Create one at supertext.com. Generate your API key at supertext.com → Integrations → API (requires the Admin role)." In the UI, links open in a new tab (`target="_blank" rel="noopener"`).

## UI languages (always)

The app's pages are in English, German, French and Italian. Mailchimp doesn't pass a language, so the app follows its own top-bar switch (`?lang=`, cookie `st_locale`), then `Accept-Language`. Strings live in `src/i18n/{en,de,fr,it}.ts` (typed: a missing key fails `npm run typecheck`; `tests/i18n.test.ts` checks placeholders, URLs, "Supertext" and "Mailchimp"). **New or changed strings get all four languages in the same commit.** Formal address (Sie, vous, Lei), Mailchimp's own terms in each language, "Supertext", placeholders and URLs never translated. The Supertext folder names in Mailchimp use the interface language of whoever saved the settings. Errors shown in the UI are `LocalizedError`s with a `code` (`error.<code>`).

## Plugin version on the settings screen (always)

The settings page shows the version from `package.json` (read at runtime by `src/version.ts`, never a second copy) and links it to the GitHub release.

## Plugin list (always)

`README.md` ends with the shared list of all Supertext plugins (between the `<!-- supertext-plugins:start -->` and `<!-- supertext-plugins:end -->` markers). It is identical in every Supertext plugin repo: when a plugin is added, renamed or its description changes, update the list in **all** repos and on the org profile, not just this one. Mailchimp is listed under *Email marketing* as *In development* until it has been tested on a real Mailchimp account.

## Releases (always)

Releases are published by `.github/workflows/release.yml`: never tag or create a GitHub release by hand. To release, follow `docs/DEVELOPER.md` → *Releasing* (new version section in `CHANGELOG.md`, same number in `package.json`) and push to `main`. A push without a new version releases nothing. A hosted app has no installable file: Railway deploys the code.

## Repo setup (always)

`LICENSE` (MIT, as `package.json` declares), `SECURITY.md`, `.github/dependabot.yml` (npm and GitHub Actions, weekly, minor and patch grouped), `.github/workflows/checks.yml` (actionlint + zizmor on every push and PR, dependency review on PRs) and `.github/workflows/links.yml` (lychee weekly and on docs changes; broken links open the issue "Broken links in the docs", exclusions in `.lycheeignore`) and `.github/workflows/dependabot-merge.yml` (merges Dependabot's minor and patch package updates once all other checks pass; GitHub Actions updates and majors stay for a person). Third-party actions are pinned to commit SHAs; checkouts use `persist-credentials: false`; workflows default to `permissions: contents: read`. On GitHub: About box, ruleset "Protect main", Wiki and Projects off, Dependabot alerts, private vulnerability reporting, secret scanning with push protection and CodeQL default setup on, social preview image. Claude sessions can't change GitHub repo settings (HTTP 403): the repo is in Remy's setup script (`set-github-about`) and the social preview cards in the project docs.

## Checks and alerts (always)

Before starting work in this repo, look at its open findings and fix what the task touches or what is quick: code scanning alerts (`gh api 'repos/Supertext/Mailchimp-Supertext-Translation/code-scanning/alerts?state=open'`), secret scanning alerts (`…/secret-scanning/alerts?state=open`), open Dependabot PRs and the issue "Broken links in the docs". New workflows and workflow changes must pass actionlint and zizmor. See `docs/DEVELOPER.md` → *Code quality and security checks*.

## Demo accounts rule (always)

The demo is a Mailchimp account set up by hand (see `docs/DEVELOPER.md` → *Demo*): Mailchimp users are invited by hand, so the `DEMO_*` accounts are Mailchimp users (Admin for Supertext staff, Manager for tests and screenshots). Values never go in the repo, in chat or in logs.

## Screenshots rule (always)

The user guide and installation guide include screenshots, taken by `npm run docs:screenshots` (Playwright, `tests/docs/screenshots.ts`) against the stand-in Mailchimp and Supertext APIs, which return real translations of the sample account (`tests/standin/samples.json`), stored in `docs/images/` at 1× scale with alt text, and regenerated in the same commit whenever the UI they show changes. Screenshots of Mailchimp's own screens (the Supertext folders, a translated draft) are added from the demo account once it exists. No secrets, no customer data, no local URLs.

Demo movie: `npm run docs:movie` (`tests/docs/movie.ts`, shared kit in `tests/docs/movie/`) records `docs/images/demo.gif` (shown in the README) and a narrated MP4 that isn't committed; `npm run docs:movie:install` (`tests/docs/movie-install.ts`, same kit) records the connect and settings movie (MP4 only); see `docs/DEVELOPER.md` → *Demo movie*.

## Shared Supertext protocol

AI file translation API v1, same as the WordPress plugin: POST HTML file → poll status → GET translation → DELETE. Details in `docs/DEVELOPER.md`. Never commit API keys or the Mailchimp client secret; use environment variables or the app's settings (stored encrypted).

Lessons from the live API, apply them here: header `Authorization: Supertext-Auth-Key <key>` (strip a pasted prefix), retry HTTP 429 (per-second rate limit), keep a whole paragraph in one `data-st-id` element with formatting as inline tags (`src/mailchimp/email-html.ts`: one segment per text block), and **languages:** only the codes Supertext's `GET features` lists (the SDK's `Languages`, `supertext-sdk/v1`): bare sources (`en`); targets regional only for de/en/fr/it/pt (`de-CH`, `en-US`), `zh-Hans`/`zh-Hant`, `sr-Latn`/`sr-Cyrl`, `gsw-u-sd-chzh`/`chbe`, bare for the rest (`es`, `nl`, `sl`). **Defaults only where obvious:** the account's mapping (`Account.languageCodes`, the *Supertext code* combo box per language under Settings → Languages, options `Languages.targetOptions()`, preselected with the saved code, else `Languages.suggestTarget`), else an exact match, else the SDK default (de→de-DE, en→en-US, fr→fr-FR, it→it-IT, pt→pt-PT, zh→zh-Hans, sr→sr-Latn), else the error `unsupported_language` (nothing sent; `no` needs a mapping to `nb`); formal/informal only where `Languages.supportsPoliteness()`. See `docs/DEVELOPER.md` → *Language codes*.

**Translation review:** a checkbox per language next to the *Supertext code* under Settings → Languages (`Account.reviewLanguages`); those languages go through `SupertextClient.forReview()`, a second SDK client on `SUPERTEXT_REVIEW_URL` (`Config.reviewUrl`, default `REVIEW_URL`, '' = off and the column hidden); key check, reports and translation files never use it. See `docs/DEVELOPER.md` → *Supertext API protocol*.

**Commando Center:** version reports and the automatic API key check go through Supertext Plugin Health's `InstallationReporter` with the SDK's `checkApiKey()` in `src/reporting.ts` (one installation per Mailchimp account, site URL `https://admin.mailchimp.com/account/<id>`, state in `Account.reporter`, written only by `Store.saveReporterState`; setting `versionReports` / `SUPERTEXT_VERSION_REPORTS`). A hosted app: no ping endpoint, no callback URL. Reporting must never break a request or a translation; tests set `SUPERTEXT_REPORT_URL` to the stand-in. See `docs/DEVELOPER.md` → *Commando Center*.

## This repo

- Before committing: `npm run typecheck`, `npm test`, `npm run build`, `bash scripts/smoke.sh`.
- End-to-end tests against the real Supertext API: `.github/workflows/e2e.yml` with `tests/e2e/` (the app's Docker image, the stand-in Mailchimp, the real API; see "End-to-end tests" in `docs/DEVELOPER.md`). The key is only the GitHub secret `SUPERTEXT_API_KEY`, set by Remy; sessions don't use a live key. Behaviour changes need matching checks in `tests/e2e/live.ts`.
- All Supertext API calls go through the Supertext SDK (`supertext-sdk`, imported as `supertext-sdk/v1`), a dependency from `vendor/supertext-sdk` (built copy, `COMMIT` = SDK commit) wrapped by `src/supertext/client.ts`. Never edit `vendor/`: fix the SDK in `Supertext/Supertext-API-SDK-Guide` and run `scripts/vendor-sdk.sh [ref]`. Version reports use **Supertext Plugin Health** (`supertext-plugin-health`), a dependency from `vendor/supertext-plugin-health` (built copy) the same way: fix it in `Supertext/Commando-Center-Supertext-Translation` (`plugin-health/`) and run `scripts/vendor-plugin-health.sh <tag>`. See `docs/DEVELOPER.md` → *Supertext SDK* and *Supertext Plugin Health*.
- Merge tags (`*|…|*`) must survive every translation: they travel as `<span data-mc="N">` placeholders and a segment that loses one is refused. Keep that check.
- Changes to Mailchimp calls go through `src/mailchimp/client.ts` and the stand-in (`tests/standin/mailchimp.ts`) together. Check real Mailchimp behaviour with `npm run mailchimp:probe` before relying on it (`--write` only on a demo account).
- New settings go in `src/store/store.ts` (`Account`, stored as JSON), `src/views/settings.tsx`, the form handler in `src/app.ts` **and** the settings table in `docs/INSTALLATION.md`.
- Every page and API call needs the session cookie; POSTs also the CSRF token (`src/auth/session.ts`).
- Hosting: Railway service *Mailchimp* in *supertext-cms-demos*, building the `Dockerfile` (set on the service; Railway ignores `railway.json`), health check `/health`, its own database `mailchimp_supertext` on the shared Postgres, one instance (the poller runs in the web process). Don't export-ignore anything the Dockerfile copies.

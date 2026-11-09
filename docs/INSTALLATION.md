# Installation guide — Supertext Translation for Mailchimp

For Mailchimp account owners and administrators setting up Supertext Translation.

> **Status: in development.** The app is tested against a stand-in of the Mailchimp API. It isn't in the Mailchimp Marketplace yet and hasn't been tried on a real account. Ask Supertext before using it with a live audience.

## How it works

Supertext Translation is an app that runs on Supertext's servers and connects to your Mailchimp account. For each campaign you translate, it makes one **draft per language** in Mailchimp, next to the original: a copy with the subject line, preview text and content translated by Supertext AI, sent only to the subscribers whose language is that language. You review the drafts in Mailchimp and send them as usual.

You start a translation in one of two ways (you choose which in the settings):

- **In Mailchimp:** move a campaign into one of the *Supertext* folders the app creates, for example *Supertext → German*.
- **In the app:** pick the campaign and the languages on the app's *Translate* page.

The app never sends anything to your subscribers and never changes the original's content.

## Requirements

| | |
| --- | --- |
| Mailchimp | Any Mailchimp account. You connect it with a Mailchimp user who can create and edit campaigns (Admin or Manager). |
| Subscriber languages | Mailchimp knows each subscriber's language: it detects it from their browser when they sign up or open an email, or you set it in the audience (field *Language*, or with an import). The translations go to the subscribers with that language. |
| Supertext | An account with an API key, see [step 1](#1-get-a-supertext-account-and-api-key) |

## 1. Get a Supertext account and API key

1. **Account:** no Supertext account yet? [Log in or create one](https://www.supertext.com/person/en/account/signin) with your email address.
2. **API key:** generate it at [supertext.com → Integrations → API](https://www.supertext.com/en/integrations/api). Only users with the **Admin** role in the Supertext account can do this; otherwise ask your Supertext account admin for a key.

The app's settings page links to both, next to the API key field.

## 2. Connect Mailchimp

Open the app (Supertext sends you its address until it is listed in the Mailchimp Marketplace) and click **Connect Mailchimp**. Mailchimp asks you to log in and to allow *Supertext Translation* to access your account; confirm. You come back to the app's settings.

<img src="images/connect.png" alt="Supertext Translation for Mailchimp: what the app does in three points and the button Connect Mailchimp" width="640">

Everyone in your team who connects the same Mailchimp account shares its settings. The connection stays until you disconnect it in the app or remove the app in Mailchimp (Profile → Extras → Connected sites / apps).

## 3. Settings

Enter the API key, choose your languages, check the Supertext language in each one's box and click **Save**. Saving checks the API key automatically (free of charge, nothing is translated) and shows the result under the key: *API key checked: the connection to Supertext works.* means everything is in place. **Test connection** runs the same check again, also for a key you have typed but not saved yet.

<img src="images/settings.png" alt="Supertext settings: the saved API key with links to create a Supertext account and generate the key, the API key check result and Test connection, both saying the connection to Supertext works, the language of the campaigns (English), French, German and Italian ticked with the Supertext languages Swiss French (fr-CH), Swiss High German (de-CH) and Italian (Switzerland) (it-CH) chosen in their combo boxes, the unticked Arabic box showing — choose —, Bulgarian preselected as Bulgarian (bg) and Chinese as Simplified Chinese (zh-Hans), Translation review ticked for German only, the note on Translation review below the table, Start translations from: Mailchimp folders and The Supertext app, Send the original only to subscribers without a translated language, the form of address, Send version information to Supertext, the connected account and the version 0.1.0" width="720">

| Setting | Default | Purpose |
| --- | --- | --- |
| API key | – | Your Supertext key, with or without the `Supertext-Auth-Key` prefix; stored encrypted. *Remove the saved key* deletes it. |
| Test connection | – | Checks the key (entered or saved) with Supertext, without translating anything. The result of the saved key's check is shown under the key with its time (UTC). |
| Language of your campaigns | English | The language you write your campaigns in. *Let Supertext detect it* works too, but then the app can't leave that language out of the targets. |
| Translate into | none | The languages to translate into. Each one gets a draft per campaign and, with the folder trigger, its own Supertext folder. |
| Supertext code | Supertext's suggestion | The language mapping: a combo box per Mailchimp language with Supertext's languages as "Name (code)". It starts with Supertext's suggestion: the same code where Mailchimp's is one (`es`, `nl`, `bg` …), else the obvious default (see the table below); a language with neither (Norwegian, Arabic …) shows *— choose —* and isn't translated until you pick one (*has no Supertext language yet*). Change it where you want another variant, e.g. *Swiss High German (de-CH)* instead of *German (Germany) (de-DE)*. Saving stores the chosen codes; the page warns about ticked languages that still show *— choose —*. The same mapping gives the campaign language (`en-US` is sent as the source `en`). |
| Translation review | Off | A checkbox per language, next to its *Supertext code*: translations into a ticked language go through Supertext's review service, see [Translation review](#translation-review). The column isn't shown when Supertext has turned review off on the server. |
| Start translations from: Mailchimp folders | On | The app creates the folders *Supertext → All languages* and one per language (*Supertext → German* …) and checks them every minute. Turning it off deletes the empty Supertext folders. |
| Start translations from: The Supertext app | On | The *Translate* page offers the campaigns. At least one of the two stays on. |
| Send the original only to subscribers without a translated language | On | After translating, the original's audience gets "language is not German, not French …" added, so nobody receives two versions. Off: the original keeps its audience. |
| Form of address | Let Supertext decide | *Formal* (German "Sie", French "vous") or *Informal* ("du", "tu"). Sent only for languages where Supertext offers it; the page names the ticked languages that don't have it (English, Swiss German, Romansh, Albanian, Serbian), which are translated with Supertext's default. |
| Send version information to Supertext | On | See *Version information* below. |

Defaults when you don't change the box (Supertext's SDK, `Languages.defaultTarget`):

| Mailchimp language | Sent as |
| --- | --- |
| German `de` | `de-DE` |
| English `en` | `en-US` |
| French `fr` | `fr-FR` |
| Italian `it` | `it-IT` |
| Portuguese `pt` | `pt-PT` |
| Chinese `zh` | `zh-Hans` |
| Serbian `sr` | `sr-Latn` |
| A code Supertext uses as it is (`es`, `nl`, `bg`, `pl` …) | the same code |
| Anything else (`no` → choose `nb`, `ar`, …) | nothing: choose one |

There is no environment variable for the mapping: it is set per Mailchimp account on this page. Settings saved with an earlier version keep their codes; the boxes show them.

The folder names are written in the language of the app's interface at the moment you save the settings (top right: EN, DE, FR, IT).

The settings page also shows the app's version, linked to its release notes.

## Translation review

With **Translation review**, people check the translations and correct them: your colleagues or Supertext linguists review them with the *Supertext Localization Review* Chrome extension and fix texts in a side panel. Their corrections come back into Mailchimp.

Turn it on per language under **Settings → Languages**: tick **Translation review** in the language's row (next to its *Supertext code*) and click **Save**. Untick it to turn it off again; nothing else changes. All other languages keep going directly to Supertext.

- Translations into that language then go through Supertext's review service instead of directly to Supertext. It answers exactly like Supertext and passes everything on with your API key, so billing, languages, the form of address and error messages stay the same.
- The review service keeps every translation of your Supertext account. A text it has translated before gets the same translation again (without a new Supertext call), and once a reviewer has corrected it, the corrected text.
- **Corrections arrive with the next translation:** after a review, translate the campaign into that language again (with *Update existing drafts*) to write the corrections into its draft. As always, translating again overwrites manual changes in the draft.
- Reviewers get a review link from Supertext; nothing to set up in Mailchimp or in the app.
- The review service works with keys of the **live** Supertext API (the only one this app uses).
- *Export for translation* and *Import translation* don't use the review service, and the automatic API key check still goes directly to Supertext.
- The address of the review service is a setting of the hosted app (`SUPERTEXT_REVIEW_URL`, default: Supertext's review service), set by Supertext. If Supertext turns review off there (`SUPERTEXT_REVIEW_URL=` empty), the column disappears and every language goes directly to Supertext.

## Version information

With **Send version information to Supertext** on, the app sends a short report to Supertext's support center (the Commando Center) when you save the settings, on the first visit to the app after connecting, after the app or Node.js was updated, and when the result of the API key check changes (for example a key Supertext rejects during a translation). It contains:

- the Mailchimp account's ID as an address, `https://admin.mailchimp.com/account/<account ID>` (Mailchimp accounts have no website; no account name, login or e-mail address);
- the app's name (`Mailchimp-Supertext-Translation`) and version, `Mailchimp`, and the Node.js and Supertext SDK versions;
- whether an API key is set and the result of the key check (`ok`, `invalid`, `missing`, `unreachable` or `error`, with the time and Supertext's HTTP status).

No content, no API key and no personal data. Being a hosted app, it has no ping address and sends no callback URL. Turn it off by unticking the setting and saving: then nothing at all is sent. Supertext can turn it off for all accounts on the server with `SUPERTEXT_VERSION_REPORTS=0` (the checkbox then can't be changed). The API key check itself runs either way.

## Who can translate

Everyone who has connected the Mailchimp account in the app, and, with the folder trigger, everyone who can move campaigns between folders in Mailchimp.

**Translation files** (*Export for translation* and *Import translation* on the Translate page) need nothing to set up and no API key; the same people can use them. The export lists campaigns only with *Start translations from → The Supertext app* on. Uploads are limited to 10 MB, read in memory and never stored. See the [user guide](USER_GUIDE.md#translation-files-export-for-translation-import-translation).

## Updating

Nothing to do: the app runs on Supertext's servers and is updated there. The settings page shows the current version.

## Disconnecting

**Settings → Disconnect Mailchimp** deletes your settings, the stored token and API key, and the empty Supertext folders. Drafts already made stay in Mailchimp. To also revoke the app's access on Mailchimp's side, remove it in Mailchimp under your profile's connected apps. If you only remove it there, the app notices at its next folder check and forgets the token.

## Troubleshooting

| Message | Cause / fix |
| --- | --- |
| *This file isn't a valid XLIFF or HTML translation file* / *This file wasn't exported by the Supertext app …* | The imported file is damaged, another kind of file, or the translator removed its metadata (HTML head, XLIFF file header). Export again and ask the translator to keep the structure. |
| *The file is too large (at most 10 MB)* | Export fewer languages per file. |
| *Your session has expired* | Connect Mailchimp again on the start page. |
| *Mailchimp access wasn't granted* | You declined on Mailchimp's page. Click **Connect Mailchimp** again. |
| *Mailchimp refused the connection* | The app's access was revoked in Mailchimp, or the user who connected it left the account. Connect again. |
| *Add your Supertext API key* / *No Supertext API key configured* | Enter the key under Settings (step 3). |
| *API key checked: the connection to Supertext works.* | All good. |
| *Supertext rejected the API key …* | The saved key is wrong or revoked: copy the whole key again, or generate a new one at [supertext.com → Integrations → API](https://www.supertext.com/en/integrations/api) (Admin role required). No Supertext account yet? Create one at [supertext.com](https://www.supertext.com/person/en/account/signin). |
| *No API key is set yet …* | Enter the key under Settings and save. |
| *The API key couldn't be checked because Supertext can't be reached* | A network problem or a Supertext outage; the settings are saved. Click **Test connection** later. |
| *The API key couldn't be checked: Supertext answered with an error (…)* | Supertext answered unexpectedly (the HTTP status is shown); the settings are saved. Try again later and contact Supertext support if it stays. |
| *Authentication failed* | The key is wrong or revoked. Check it with **Test connection**; if needed, generate a new one at [supertext.com → Integrations → API](https://www.supertext.com/en/integrations/api) (Admin role required). |
| *Choose your languages* | No languages are ticked under Settings → Languages. |
| *These languages have no Supertext language yet …* / *The language “no” has no Supertext language yet, so nothing was sent* | Choose the language's Supertext language in its box under Settings → Languages → *Supertext code*, for example *Norwegian Bokmål (nb)* (`unsupported_language`: nothing is sent to Supertext for that language until it has one). |
| *Supertext doesn't know … as the language of your campaigns* | Choose the campaign language's Supertext language in its box under Languages (e.g. *Norwegian Bokmål (nb)* for Norwegian) or choose *Let Supertext detect it*. |
| *Saved, except these codes, which aren't Supertext codes …* | Choose a language from the box's list (e.g. *Swiss High German (de-CH)*). |
| *Supertext offers no formal or informal address for this language* | Set the form of address to *Let Supertext decide*. |
| *Supertext doesn't translate into …* | Check the language's box under Settings → Languages → *Supertext code*. |
| Reviewers' corrections don't show up in the draft | They arrive with the next translation: translate the campaign into that language again with *Update existing drafts*. Check that the language's *Translation review* is ticked under Settings → Languages. |
| The *Translation review* column is missing under Settings → Languages | Supertext has turned review off on the server (`SUPERTEXT_REVIEW_URL` is empty); ask Supertext support. |
| *Saved, but the Supertext folders could not be updated in Mailchimp* | Mailchimp refused to create or rename a folder. Save again later; the reason is shown. |
| *Mailchimp returned no content for this campaign* | Campaigns made with Mailchimp's new email builder may not be readable through Mailchimp's API yet. Use the classic builder or code your own. |
| *Only regular and plain-text campaigns can be translated* | A/B tests (multivariate) and RSS campaigns aren't supported. |
| *Too many requests to Supertext / Mailchimp* | The per-second limit was still exceeded after 4 automatic retries. Wait a moment and start again. |
| *Your Supertext translation limit is exceeded* | Your Supertext plan's volume is used up. |
| *The app restarted during the translation* | Start the translation again; languages already done are kept. |
| A campaign stays in a Supertext folder | Mailchimp doesn't allow moving some sent campaigns. It is translated once anyway; move it out by hand. |

## Privacy and security

- The texts you translate are sent to Supertext (api.supertext.com) and deleted there right after download (they expire after 24 hours anyway). For languages with [Translation review](#translation-review) on, they go through Supertext's review service, which keeps the translations (and reviewers' corrections) for your Supertext account.
- The app stores per Mailchimp account: the account name, the OAuth token and the Supertext API key (both encrypted), the settings above, which draft belongs to which campaign and language, where each campaign was last seen (for the folder trigger), and the list of recent translations (campaign names and results). It doesn't store your campaigns' content or any subscriber data.
- With *Send version information to Supertext* on, the reports described under *Version information* go to Supertext's support center; never content, the API key or personal data.
- The app reads campaigns and folders and creates and edits draft campaigns. It never sends or schedules a campaign.

# User guide — Supertext Translation for Mailchimp

For editors. Once the app is set up (see [INSTALLATION.md](INSTALLATION.md)), you turn a finished campaign into one draft per language. The drafts appear in Mailchimp next to the original; you review and send them like any other campaign.

*Screenshots: the app's pages with a sample account (a Swiss chocolate shop that writes its newsletter in English, translated into French, German and Italian for Switzerland).*

## Translate from a Mailchimp folder

1. Write and design the campaign in Mailchimp as usual.
2. In Mailchimp's campaign list, move it into a Supertext folder:
   - **Supertext → All languages** translates into every language set up in the app.
   - **Supertext → German** (French, Italian …) translates into that language only.
3. Within a minute or two the drafts appear, named after the original with the language code, for example *Autumn newsletter · DE*, in the original's folder. The original moves back to the folder it was in.

Moving a campaign into a Supertext folder **again** replaces its drafts with a fresh translation, including changes you made to them by hand. Edit the original and move it again when its text changes; edit a draft only for the last touches.

The app's *Translate* page lists every translation under *Recent translations*, also those started from a folder, with the result per language.

## Translate in the app

1. Open the app and go to **Translate**.
2. Under **Choose a campaign**, pick the campaign. The list shows for each language whether it has a draft already (*Draft*, a link into Mailchimp) or not.
3. Under **Choose the languages**, tick the languages. The code next to each (e.g. `de-CH`) is the variant Supertext translates into.
4. Click **Translate into 2 languages with Supertext**.

   ![Translate with Supertext: the Autumn newsletter selected, no drafts yet in French, German and Italian; French and German ticked, Italian not; Update existing drafts off; the button Translate into 2 languages with Supertext](images/translate-page.png)

5. Each language takes a few seconds. The **Translation** box shows the result per language, with a link to each draft in Mailchimp. You can leave the page meanwhile; the translation goes on.

   ![Translation of the Autumn newsletter, started in the app: Done: 2 created, 0 updated, 0 kept, 0 failed; French and German New draft, each with Open in Mailchimp; The original now goes only to subscribers without a translated language.](images/translate-results.png)

The list then shows the drafts:

![The campaign list after translating: the Autumn newsletter has a Draft in French and German, No draft in Italian](images/translated-state.png)

The app's pages are in English, German, French or Italian; switch at the top right.

![The translate page in German: Kampagne auswählen, the Advent calendar offer selected, Sprachen auswählen and the button In 3 Sprachen mit Supertext übersetzen](images/translate-page-de.png)

## Existing drafts

In the app, languages that have a draft already are **kept** (*Draft exists, kept*). To replace them with a fresh translation, tick **Update existing drafts**. The page warns you first: changes made by hand in Mailchimp are lost.

![Update existing drafts ticked, with the warning that the drafts made earlier will be replaced, including changes made by hand in Mailchimp](images/overwrite-warning.png)

A draft that was sent already is never changed: the next translation makes a new draft.

## Who gets which version

- Each draft goes to the original's audience, **limited to the subscribers with that language** (Mailchimp's *Language* condition). If the original already had a segment with "all of these" conditions, the language is added to them; otherwise the draft goes to everyone with that language, and the result says so.
- The original goes, if your administrator left that setting on, only to the subscribers **without** a translated language, so nobody receives two versions. Subscribers whose language Mailchimp doesn't know get the original.

Check the recipients in each draft before sending; you can change them in Mailchimp like for any campaign.

## Review and send

Open the draft in Mailchimp (the *Open in Mailchimp* link, or the campaign list), check subject line, preview text and content, send a test email and send or schedule it. Drafts made from a template stay editable in Mailchimp's editor. If Mailchimp didn't accept the template's sections, the result says *Saved as HTML*: you then edit that draft with Mailchimp's code editor.

**Translation review:** if your administrator turned on *Translation review* for a language, reviewers (your colleagues or Supertext linguists) check and correct its translations. Their corrections come into Mailchimp the next time you translate the campaign into that language: after a review, translate it again with *Update existing drafts*. Texts reviewed once keep their corrected wording in later translations.

## Translation files: export for translation, import translation

Instead of Supertext AI, you can have a campaign translated by someone else: a translator, a translation tool (Trados, memoQ, Phrase and other CAT tools) or Supertext's web app. The app exports the campaign's texts as a file and imports the translated file again; the result is the same draft per language as with Supertext AI. Both are on the **Translate** page, below the translate button. (The export needs the campaign list, so *Start translations from → The Supertext app* must be on in the settings; the import works either way.)

**Export for translation**

1. In the list, choose the campaign.
2. Under **Export for translation**, choose the **File format**:
   - **XLIFF 1.2 (for translation tools)**: the better choice for translators and translation tools. Formatting, links and merge tags show as tags they can move but not break or edit. One file can hold several languages.
   - **HTML (one language per file)**: for Supertext's web app or anyone who translates HTML files. Tick one language.
3. Tick the target languages. A language without a Supertext language is offered too: the file then names the Mailchimp code.
4. Click **Download file**. The file is called like `mailchimp-<campaign ID>-fr-CH.html` (`mailchimp-<campaign ID>.xlf` for several languages).

   ![Export for translation: File format HTML (one language per file) chosen; target language French (fr-CH) ticked, German and Italian not; the button Download file](images/export-for-translation.png)

The file holds the subject line, the preview text and the email's texts, exactly what Supertext AI would translate (see *What is translated*). Send it to the translator or upload it to Supertext's web app. Translators must keep the file's structure: in an HTML file, leave the head (the `supertext:` lines), the `data-st-id` attributes and the empty `<span data-mc="…">` elements (the merge tags) alone.

**Import translation**

1. Under **Import translation**, choose the translated file (**Translated file (XLIFF or HTML)**, at most 10 MB).
2. Leave **Also import texts whose source changed since the export** off unless you want translations of texts that were edited in the meantime (they then translate the old text).
3. **Update existing drafts** works as for Supertext AI: off, a language that has a draft already is kept, and nothing from the file is written for it.
4. Click **Import translation**. Each language becomes a draft next to the original, with its language segment, exactly like a translation by Supertext (and the original's audience is limited the same way, if that setting is on).

The app then shows a summary per language, with a link to the draft:

![Import translation: the file mailchimp-c-advent-fr-CH.html chosen; Advent calendar offer · French: Imported: 9, with the link New draft](images/import-summary.png)

| Line | Meaning |
| --- | --- |
| *Imported: 9* | Texts written to the draft. |
| *Skipped, source changed since the export: 1* | The original text was edited after the export, so the translation may be out of date. Import again with *Also import texts whose source changed since the export* (and *Update existing drafts*) to use it anyway, or export again. |
| *Not translated in the file: 1* | The file has no translation for it (XLIFF only). |
| *Formatting changed, not imported: 1* | The translation adds formatting or links the original doesn't have, or lost a merge tag (`*|FNAME|*` would reach subscribers broken). Fix it in the file and import again. |
| *Not in the file: 1* | The text was added to the campaign after the export. |
| *Texts not imported keep the original's wording in the draft.* | The draft is always a complete email: what wasn't imported stays in the original language there. |
| *The language's draft exists and was kept …* | Tick *Update existing drafts* to replace it. |

An HTML file can't mark a text as untranslated: imported unchanged, it writes the original text into the draft.

Messages: *This file isn't a valid XLIFF or HTML translation file* (damaged, or another kind of file), *This file wasn't exported by the Supertext app, or its header was removed* (the metadata is missing), *This file belongs to another system* (exported from another Supertext plugin), *The campaign this file was exported from no longer exists*, *The app has no language … under Settings → Languages* (the language was removed since), *The file is too large (at most 10 MB)*, *Nothing to translate*.

## What is translated

| | |
| --- | --- |
| Translated | Subject line, preview text, the email's text (headings, paragraphs, lists, buttons, footer text), image alt texts and link titles. Bold, italics and links stay where they are; each paragraph is translated as a whole. |
| Kept as it is | Merge tags such as `*|FNAME|*`, `*|UNSUB|*` or `*|IF:…|*` (put back exactly), links and their addresses, images, styles, layout, the campaign title (it gets the language code), sender name and reply-to address |
| Not translated | Parts of a template outside its editable sections, text marked `translate="no"` or with the class `notranslate`, plain-text versions (Mailchimp generates them from the translated HTML), A/B tests and RSS campaigns |

Plain-text campaigns are translated too. The app never changes the original's content.

## When something goes wrong

The result shows the reason for each language that fails; the other languages still run. Authentication and limit problems stop the whole translation.

| Message | What to do |
| --- | --- |
| *Add your Supertext API key* | An administrator needs to enter the API key under Settings. |
| *Authentication failed* | The API key is no longer valid; tell your administrator. |
| *The language “no” has no Supertext language yet, so nothing was sent* | The language has no Supertext language yet (neither chosen nor a default); nothing was sent to Supertext for it, the other languages still ran. An administrator chooses one in its box under Settings → Languages → *Supertext code* (for example *Norwegian Bokmål (nb)*). On the Translate page such a language shows *No Supertext language yet*. |
| *Supertext offers no formal or informal address for this language* | An administrator sets the form of address to *Let Supertext decide* under Settings → Translation. |
| *Supertext doesn't translate into …* | An administrator checks the language's box under Settings → Languages → *Supertext code*. |
| *Supertext returned 2 of 3 merge tags; nothing was saved for this language.* | A merge tag got lost in the translation, so no draft was saved (a lost `*|FNAME|*` would show to subscribers). Translate that language again. |
| *This campaign is a translation made by Supertext* | Translate the original instead. |
| *Mailchimp returned no content for this campaign* | The campaign was probably made with Mailchimp's new email builder; see the installation guide. |
| *Too many requests* | Wait a moment and start again. Languages already done are kept. |
| *Your Supertext translation limit is exceeded* | Your Supertext plan's volume is used up; tell your administrator. |
| *Your session has expired* | Connect Mailchimp again on the app's start page. |

## Support

Questions, problems or ideas: use the [Supertext support form](https://integrations.supertext.com/en/support?platform=mailchimp). Mention the version of Mailchimp and of the plugin, what you did and what you expected; an error message helps a lot. You get an answer by email, in your language.

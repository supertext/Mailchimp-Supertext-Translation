// Translation files: "Export for translation" and "Import translation" (XLIFF 1.2 or HTML).
//
// The Supertext SDK's TranslationFiles (vendor/supertext-sdk, `supertext-sdk`) does the
// file formats; this glue collects the campaign's texts exactly like the API translation
// (collectSegments: subject, preview, body.<n>), finds the campaign again from the job's
// reference and writes the imported texts to the language's draft like API results
// (writeDraft, rememberDraft, limitOriginal).
import {
  TranslationFileError,
  TranslationFiles,
  type FileFormat,
  type FileJob,
  type FileSegment,
  type ImportStatus,
} from 'supertext-sdk';
import { errorInfo, LocalizedError, type ErrorInfo } from '../i18n/error.js';
import { segmentResult } from '../mailchimp/email-html.js';
import type { MailchimpClient } from '../mailchimp/client.js';
import type { Account, Store } from '../store/store.js';
import { currentDraft, limitOriginal, loadCampaign, rememberDraft } from './jobs.js';
import { languageName, resolvedTarget, supertextSource } from './languages.js';
import { collectSegments, writeDraft, type CollectedCampaign } from './translate.js';

/** The `plugin` written into every file: the repository name. */
export const PLUGIN = 'Mailchimp-Supertext-Translation';

/** Uploads larger than this are refused before they are read. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

type Mailchimp = Pick<MailchimpClient, 'campaign' | 'content' | 'replicate' | 'updateCampaign' | 'setContent' | 'deleteCampaign'>;

/** The job's reference: the campaign and the Mailchimp target language, e.g. `campaign:42d7f1a9c3:de`. */
export const fileReference = (campaignId: string, language: string): string => `campaign:${campaignId}:${language}`;

/** Campaign ID and Mailchimp language of a reference, or null if it isn't one of ours. */
export function parseReference(reference: string): { campaignId: string; language: string } | null {
  const match = /^campaign:([A-Za-z0-9_-]+):([A-Za-z0-9_-]+)$/.exec(reference.trim());
  return match ? { campaignId: match[1], language: match[2] } : null;
}

/**
 * Throws `fileTooLarge` for an upload over MAX_UPLOAD_BYTES: first by the request's
 * Content-Length (before the body is read; 64 KB for the rest of the form), then by the file.
 */
export function refuseLargeUpload(contentLength: string | null | undefined, file?: { size: number }): void {
  const tooLarge = Number(contentLength ?? 0) > MAX_UPLOAD_BYTES + 64 * 1024 || (file !== undefined && file.size > MAX_UPLOAD_BYTES);
  if (tooLarge) throw new LocalizedError('The file is too large (at most 10 MB).', 'fileTooLarge');
}

/** The campaign's texts as file segments: always HTML, so merge-tag placeholders stay protected tags. */
export const fileSegments = (collected: CollectedCampaign): FileSegment[] =>
  collected.segments.map(({ key, segment }) => ({ key, text: segment.html, html: true }));

/** Supertext codes for the file: the account's mapping (or exact match, or default), else the Mailchimp code with `-`; `und` when the campaigns' language is detected automatically. */
const targetCode = (language: string, account: Account) => resolvedTarget(language, account.languageCodes) ?? language.replace(/_/g, '-');
function sourceCode(account: Account): string {
  if (!account.sourceLanguage) return 'und';
  try {
    return supertextSource(account.sourceLanguage, account.languageCodes) || account.sourceLanguage;
  } catch {
    return account.sourceLanguage.replace(/_/g, '-');
  }
}

export interface ExportedFile {
  filename: string;
  contentType: string;
  content: string;
}

/** Builds the file for one campaign; throws LocalizedError. */
export async function exportFile(
  store: Store,
  account: Account,
  mailchimp: Pick<MailchimpClient, 'campaign' | 'content'>,
  request: { campaignId: string; languages: string[]; format: FileFormat },
): Promise<ExportedFile> {
  const languages = [...new Set(request.languages)].filter((code) => account.targets.includes(code));
  if (languages.length === 0) throw new LocalizedError('Select at least one language.', 'fileSelectLanguage');
  if (request.format === 'html' && languages.length !== 1) {
    throw new LocalizedError('An HTML file holds exactly one language.', 'fileHtmlOneLanguage');
  }
  const { source, content } = await loadCampaign(store, account, mailchimp, request.campaignId);
  const segments = fileSegments(collectSegments(source, content));
  if (segments.length === 0) throw new LocalizedError('Nothing to translate.', 'nothingToTranslate');
  const jobs: FileJob[] = languages.map((language) => ({
    plugin: PLUGIN,
    reference: fileReference(source.id, language),
    sourceLanguage: sourceCode(account),
    targetLanguage: targetCode(language, account),
    segments,
  }));
  const name = languages.length === 1 ? `mailchimp-${source.id}-${jobs[0].targetLanguage}` : `mailchimp-${source.id}`;
  return request.format === 'html'
    ? { filename: `${name}.html`, contentType: 'text/html; charset=utf-8', content: TranslationFiles.exportHtml(jobs[0]) }
    : { filename: `${name}.xlf`, contentType: 'application/x-xliff+xml', content: TranslationFiles.exportXliff(jobs) };
}

export interface ImportOptions {
  /** Also write texts whose source changed since the export (off by default). */
  includeChanged: boolean;
  /** Replace the language's existing draft (as on the translate page); otherwise it is kept. */
  overwrite: boolean;
  /** The interface language, for the language names in the summary. */
  uiLocale: string;
}

export type ImportCounts = Record<ImportStatus, number>;

/** What happened to one job (the campaign in one language) of the file. */
export interface ImportSummary {
  reference: string;
  title: string | null;
  language: string | null;
  counts: ImportCounts;
  /** Texts written to the draft. */
  written: number;
  /** Translated, but the source changed since the export, and not written. */
  skippedChanged: number;
  /** The language's draft exists and Overwrite wasn't ticked: nothing written. */
  kept: boolean;
  /** The draft written or kept. */
  state?: 'created' | 'updated' | 'kept';
  webId?: number;
  error?: ErrorInfo;
}

const emptyCounts = (): ImportCounts => ({ ok: 0, source_changed: 0, untranslated: 0, invalid_markup: 0, missing: 0 });

/** The SDK's file errors as messages the user can read in their language. */
export function fileError(error: unknown): LocalizedError {
  if (error instanceof TranslationFileError) {
    const code = error.code === 'too_large' ? 'fileTooLarge' : error.code === 'missing_metadata' ? 'fileMissingMetadata' : 'fileInvalid';
    return new LocalizedError(error.message, code);
  }
  return error instanceof LocalizedError ? error : new LocalizedError(String(error), 'fileInvalid');
}

/**
 * Reads an uploaded file and writes its translations to the languages' drafts,
 * job by job. File errors are thrown; a job that can't be imported gets an
 * `error` and the others go on.
 */
export async function importFile(store: Store, account: Account, mailchimp: Mailchimp, content: string, options: ImportOptions): Promise<ImportSummary[]> {
  let files;
  try {
    files = TranslationFiles.read(content);
  } catch (error) {
    throw fileError(error);
  }
  const summaries: ImportSummary[] = [];
  const touched = new Map<string, Awaited<ReturnType<typeof loadCampaign>>['source']>();
  for (const file of files) {
    const summary: ImportSummary = { reference: file.reference, title: null, language: null, counts: emptyCounts(), written: 0, skippedChanged: 0, kept: false };
    summaries.push(summary);
    try {
      if (file.plugin !== PLUGIN) {
        throw new LocalizedError(`This file belongs to another system (${file.plugin}).`, 'fileOtherSystem', { plugin: file.plugin });
      }
      const ref = parseReference(file.reference);
      if (!ref) throw new LocalizedError('The campaign this file was exported from no longer exists.', 'fileItemGone');
      summary.language = languageName(ref.language, options.uiLocale);
      if (!account.targets.includes(ref.language)) {
        throw new LocalizedError(`There is no language ${ref.language} under Settings → Languages.`, 'fileNoLanguage', { language: ref.language });
      }
      let loaded;
      try {
        loaded = await loadCampaign(store, account, mailchimp, ref.campaignId);
      } catch (error) {
        if (error instanceof LocalizedError && error.code === 'campaignMissing') {
          throw new LocalizedError('The campaign this file was exported from no longer exists.', 'fileItemGone');
        }
        throw error;
      }
      const { source } = loaded;
      summary.title = source.settings.title || source.settings.subject_line || source.id;
      const drafts = new Map((await store.translations(account.accountId, source.id)).map((t) => [t.language, t.targetId]));
      const target = await currentDraft(mailchimp, drafts, ref.language);
      // Like a translation from the app: an existing draft is kept unless Overwrite.
      if (target && !options.overwrite) {
        Object.assign(summary, { kept: true, state: 'kept', webId: target.web_id });
        continue;
      }

      const collected = collectSegments(source, loaded.content);
      const translations = new Map<string, string>();
      for (const result of TranslationFiles.importTranslations(file, fileSegments(collected))) {
        let status = result.status;
        const write = status === 'ok' || (status === 'source_changed' && options.includeChanged);
        if (write && result.text !== null && result.text.trim() !== '') {
          // Every merge tag must survive (a lost *|FNAME|* would reach subscribers broken).
          const segment = collected.segments.find((s) => s.key === result.key)!.segment;
          try {
            segmentResult(segment, result.text);
            translations.set(result.key, result.text);
          } catch {
            status = 'invalid_markup';
          }
        }
        summary.counts[status]++;
      }
      summary.skippedChanged = options.includeChanged ? 0 : summary.counts.source_changed;
      if (translations.size === 0) continue;
      const written = await writeDraft(
        { mailchimp, source, target, language: ref.language, folderId: source.settings.folder_id ?? '' },
        collected,
        translations,
      );
      await rememberDraft(store, account, source, ref.language, written);
      Object.assign(summary, { written: translations.size, state: written.state, webId: written.webId });
      touched.set(source.id, source);
    } catch (error) {
      summary.error = errorInfo(error);
    }
  }
  // As after a translation: the original goes only to subscribers without a translation, if the account wants that.
  for (const source of touched.values()) await limitOriginal(store, account, mailchimp, source);
  return summaries;
}

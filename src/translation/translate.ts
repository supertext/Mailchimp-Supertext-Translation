import { MailchimpError, type Campaign, type CampaignContent, type MailchimpClient } from '../mailchimp/client.js';
import { EmailDocument, plainSegment, segmentResult, type EmailSegment } from '../mailchimp/email-html.js';
import type { Politeness, SupertextClient } from '../supertext/client.js';
import type { JobItem } from '../store/store.js';
import { translationSegment } from './segments.js';

/**
 * One campaign × one language: translate the subject line, preview text and
 * content in one Supertext document, then write them to the language's
 * draft — a replica of the original, made for the purpose, or the draft made
 * earlier when it is to be updated.
 */

export interface TranslateArgs {
  mailchimp: Pick<MailchimpClient, 'replicate' | 'updateCampaign' | 'setContent' | 'deleteCampaign'>;
  supertext: Pick<SupertextClient, 'translateSegments'>;
  source: Campaign;
  content: CampaignContent;
  /** The language's existing draft (status "save"), if there is one. */
  target?: Campaign;
  /** Mailchimp language code ("de"). */
  language: string;
  /** Supertext target code ("de-CH"). */
  supertextTarget: string;
  sourceLanguage: string;
  politeness: Politeness;
  /** Replace an existing draft (else it is kept). */
  overwrite: boolean;
  /** Folder of the original, where the draft goes too. */
  folderId: string;
}

export type TranslateResult = Pick<JobItem, 'state' | 'targetId' | 'webId' | 'notes'>;

const TEMPLATE_TYPES = new Set(['template', 'drag_and_drop']);

/** A campaign's texts, each with the key it has in translation files. */
export interface CollectedCampaign {
  /** subject, preview, body.<n> (the n-th text of the HTML, or the plain-text body as body.0). */
  segments: { key: string; segment: EmailSegment }[];
  plainText: boolean;
  document?: EmailDocument;
}

/**
 * The texts to translate (the API translation and translation files share it):
 * the subject line (`subject`), the preview text (`preview`) and the content
 * (`body.0`, `body.1` … in the order of EmailDocument's segments).
 */
export function collectSegments(source: Campaign, content: CampaignContent): CollectedCampaign {
  const plainText = source.type === 'plaintext';
  const document = plainText ? undefined : new EmailDocument(content.html ?? '');
  const segments: CollectedCampaign['segments'] = [];
  const subject = source.settings.subject_line ?? '';
  const preview = source.settings.preview_text ?? '';
  if (subject.trim()) segments.push({ key: 'subject', segment: plainSegment(subject) });
  if (preview.trim()) segments.push({ key: 'preview', segment: plainSegment(preview) });
  const body: EmailSegment[] = plainText ? [plainSegment(content.plain_text ?? '')] : document!.segments;
  body.forEach((segment, index) => segments.push({ key: `body.${index}`, segment }));
  return { segments, plainText, document };
}

export async function translateCampaign(args: TranslateArgs): Promise<TranslateResult> {
  const { source, content, target } = args;
  if (target && !args.overwrite) {
    return { state: 'kept', targetId: target.id, webId: target.web_id };
  }
  const collected = collectSegments(source, content);
  // All segments of one language through the SDK (packed into as few documents as the size limit allows).
  const translated = await args.supertext.translateSegments(
    collected.segments.map(({ segment }) => segment.html),
    { targetLanguage: args.supertextTarget, sourceLanguage: args.sourceLanguage, politeness: args.politeness },
  );
  const byKey = new Map(collected.segments.map(({ key }, i) => [key, translated[i]]));
  return writeDraft(args, collected, byKey);
}

export type DraftArgs = Pick<TranslateArgs, 'mailchimp' | 'source' | 'target' | 'language' | 'folderId'>;

/**
 * Writes the translations (segment key → Supertext's HTML, merge tags as
 * placeholders) to the language's draft: a replica of the original, or the
 * existing draft. A key without a translation keeps the original's text.
 */
export async function writeDraft(args: DraftArgs, collected: CollectedCampaign, translations: ReadonlyMap<string, string>): Promise<TranslateResult> {
  const { source, target } = args;
  const valueOf = (key: string, segment: EmailSegment) => translations.get(key) ?? segment.html;
  const find = (key: string) => collected.segments.find((s) => s.key === key);
  const subject = source.settings.subject_line ?? '';
  const preview = source.settings.preview_text ?? '';
  const subjectSegment = find('subject');
  const previewSegment = find('preview');
  const translatedSubject = subjectSegment ? segmentResult(subjectSegment.segment, valueOf('subject', subjectSegment.segment)) : subject;
  const translatedPreview = previewSegment ? segmentResult(previewSegment.segment, valueOf('preview', previewSegment.segment)) : preview;
  const body = collected.segments.filter(({ key }) => key.startsWith('body.'));
  const bodyTranslations = new Map<number, string>();
  body.forEach(({ key, segment }, i) => bodyTranslations.set(i, valueOf(key, segment)));
  const { document, plainText } = collected;
  // Checks every merge tag before anything is written to Mailchimp.
  const html = document ? document.apply(bodyTranslations) : undefined;
  const plain = plainText ? segmentResult(body[0].segment, bodyTranslations.get(0)!) : undefined;

  // Where it goes.
  const created = target ? undefined : await args.mailchimp.replicate(source.id);
  const draft = target ?? created!;
  const notes: string[] = [];
  try {
    const { segment, combined } = translationSegment(source.recipients?.segment_opts, args.language);
    if (!combined) notes.push('segmentNotCombined');
    await args.mailchimp.updateCampaign(draft.id, {
      settings: {
        title: `${source.settings.title || subject || source.id} · ${args.language.toUpperCase()}`,
        subject_line: translatedSubject,
        preview_text: translatedPreview,
        folder_id: args.folderId,
      },
      recipients: { list_id: source.recipients?.list_id, segment_opts: segment },
    });

    if (plainText) {
      await args.mailchimp.setContent(draft.id, { plain_text: plain });
    } else if (TEMPLATE_TYPES.has(source.content_type ?? '') && source.settings.template_id && document) {
      // Keep the draft editable in Mailchimp's builder: write the template's
      // editable sections. If Mailchimp refuses, write the HTML instead.
      const sections = document.sections();
      try {
        if (Object.keys(sections).length === 0) throw new MailchimpError('No editable sections', 'noSections');
        await args.mailchimp.setContent(draft.id, { template: { id: source.settings.template_id, sections } });
        notes.push('sections');
      } catch (error) {
        if (!(error instanceof MailchimpError) || (error.status !== undefined && error.status !== 400)) throw error;
        await args.mailchimp.setContent(draft.id, { html });
        notes.push('html');
      }
    } else {
      await args.mailchimp.setContent(draft.id, { html });
    }
  } catch (error) {
    if (created) await args.mailchimp.deleteCampaign(created.id).catch(() => undefined);
    throw error;
  }
  return { state: target ? 'updated' : 'created', targetId: draft.id, webId: draft.web_id, notes };
}

// Mailchimp subscriber languages ↔ Supertext language codes.
//
// Mailchimp stores each subscriber's language as a two-letter code ("de"),
// detected from the browser or set in the audience; the language segment
// condition takes the same code. Supertext accepts only the codes its
// `GET features` lists (the SDK's `Languages`): targets regional only for
// de/en/fr/it/pt ("de-CH"), script for zh/sr ("zh-Hans"), bare for the rest
// ("es", "nl"); sources bare ("en"). The account's own Supertext code for the
// language (Settings → Languages, a combo box per language) wins, else a
// Mailchimp code that is a Supertext code as it is ("es"), else the SDK's
// default where one is obvious (de → de-DE, en → en-US, fr → fr-FR,
// it → it-IT, pt → pt-PT, zh → zh-Hans, sr → sr-Latn), else the SDK's error
// `unsupported_language` and nothing is sent ("no" needs a mapping to "nb").
// One mapping serves both directions (`de-CH` as a source is sent as `de`).

import { Languages, type LanguageMapping } from 'supertext-sdk/v1';

/** Mailchimp's subscriber languages offered as targets (and as the campaigns' language). */
export const LANGUAGE_CODES: readonly string[] = [
  'ar', 'bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr', 'hr', 'hu', 'it', 'ja', 'ko', 'lt',
  'lv', 'nl', 'no', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sr', 'sv', 'th', 'tr', 'uk', 'vi', 'zh',
];

export const isLanguage = (code: string): boolean => LANGUAGE_CODES.includes(code);

/** The language's name in the given interface language ("de" in French → "allemand"). */
export function languageName(code: string, uiLocale: string): string {
  try {
    const name = new Intl.DisplayNames([uiLocale], { type: 'language' }).of(code === 'no' ? 'nb' : code);
    if (name && name !== code) return name.charAt(0).toLocaleUpperCase(uiLocale) + name.slice(1);
  } catch {
    // fall through
  }
  return code;
}

/** Supertext's target codes ("de-CH", "es", "zh-Hans"). */
export const SUPERTEXT_TARGETS: readonly string[] = Languages.TARGETS.map((language) => language.code);

/** A submitted Supertext code in its exact form ("de_ch" → "de-CH"), or null if Supertext doesn't offer it. */
export const supertextCodeOf = (code: string): string | null => Languages.matchTarget(code.trim());

/** What the combo box preselects for a Mailchimp language without a saved code: exact match, else the SDK default, else null. */
export const suggestedTarget = (language: string): string | null => Languages.suggestTarget(language);

/** A Supertext target's name in the interface language ("de-CH" in German → "Schweizer Hochdeutsch"); the SDK's English name where Intl has none. */
export function targetName(code: string, englishName: string, uiLocale: string): string {
  if (!code.includes('-u-')) {
    try {
      const name = new Intl.DisplayNames([uiLocale], { type: 'language' }).of(code);
      if (name && name !== code) return name.charAt(0).toLocaleUpperCase(uiLocale) + name.slice(1);
    } catch {
      // fall through
    }
  }
  return englishName;
}

/** The combo box's options: Supertext's targets, "Name (code)", sorted by the localized name. */
export function targetOptions(uiLocale: string): { code: string; label: string }[] {
  return Languages.targetOptions()
    .map((language) => ({ code: language.code, name: targetName(language.code, language.name, uiLocale) }))
    .sort((a, b) => a.name.localeCompare(b.name, uiLocale))
    .map(({ code, name }) => ({ code, label: `${name} (${code})` }));
}

/**
 * The target code sent for a Mailchimp language: the account's mapping, else an exact match,
 * else the SDK's default (de → de-DE).
 * Throws the SDK's `unsupported_language` error otherwise (see supertext/client.ts → fromSdk).
 */
export const supertextTarget = (language: string, mapping: LanguageMapping): string => Languages.target(language, mapping);

/** Like `supertextTarget`, but null for a language that has no Supertext code (for the settings and translate pages). */
export function resolvedTarget(language: string, mapping: LanguageMapping): string | null {
  try {
    return supertextTarget(language, mapping);
  } catch {
    return null;
  }
}

/**
 * The source code sent for the campaigns' language: the mapping's value in its source form
 * ("en-US" → "en"), else the bare Supertext source. '' = let Supertext detect it.
 * Throws `unsupported_language` for a language Supertext doesn't translate from.
 */
export const supertextSource = (language: string, mapping: LanguageMapping): string =>
  language ? Languages.source(language, mapping) : '';

/** Whether Supertext offers formal and informal address for this target code. */
export const supportsPoliteness = (target: string): boolean => Languages.supportsPoliteness(target) === true;

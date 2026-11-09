import { describe, expect, it } from 'vitest';
import { fromSdk, REVIEW_URL, SupertextClient } from '../src/supertext/client.js';
import { loadConfig } from '../src/config.js';
import { SupertextError as SdkError } from 'supertext-sdk/v1';

// The protocol itself is tested in the SDK repository; here only the app's layer.
describe('the app layer over the Supertext SDK', () => {
  it('refuses to start without an API key', () => {
    expect(() => new SupertextClient({ apiKey: ' ' })).toThrow(/No Supertext API key/);
  });

  it("maps the SDK's error codes to the app's", () => {
    const code = (error: SdkError) => (fromSdk(error) as { code: string }).code;
    expect(code(new SdkError('authentication_failure', { status: 401 }))).toBe('auth');
    expect(code(new SdkError('quota_exceeded'))).toBe('limitExceeded');
    expect(code(new SdkError('too_many_requests', { status: 429 }))).toBe('rateLimited');
    expect(code(new SdkError('transport_error', { detail: 'ECONNREFUSED' }))).toBe('unreachable');
    expect(code(new SdkError('incomplete_response'))).toBe('incomplete');
    expect(code(new SdkError('unexpected_status', { status: 418 }))).toBe('http');
    const pair = fromSdk(new SdkError('invalid_language_pair', { status: 400, sourceLang: 'en', targetLang: 'fr' })) as {
      code: string;
      params: Record<string, string>;
    };
    expect(pair.code).toBe('languagePair');
    expect(pair.params).toEqual({ source: 'en', target: 'fr' });
    expect(code(new SdkError('invalid_language_pair', { status: 400 }))).toBe('languagePairUnknown');
    const unsupported = fromSdk(new SdkError('unsupported_language', { targetLang: 'de' })) as { code: string; params: Record<string, string> };
    expect(unsupported.code).toBe('unsupportedLanguage');
    expect(unsupported.params).toEqual({ code: 'de' });
    expect(code(new SdkError('unsupported_feature', { status: 400, feature: 'politeness' }))).toBe('unsupportedFeature');
  });

  it('translates segments in order and sends the app as User-Agent', async () => {
    const seen: { ua?: string; target?: string; source?: string }[] = [];
    let html = '';
    const fetchFn = (async (url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      if (init.method === 'POST') {
        const form = await new Request(url, { method: 'POST', body: init.body, headers }).formData();
        html = await (form.get('file') as File).text();
        seen.push({ ua: headers['User-Agent'], target: String(form.get('target_lang')), source: String(form.get('source_lang')) });
        return Response.json({ file_id: 'f1' });
      }
      if (url.endsWith('/status')) return Response.json({ status: 'done' });
      if (url.endsWith('/translation')) return new Response(html.replace(/>Hello</g, '>Hallo<').replace(/>Bye</g, '>Tschüss<'));
      return Response.json({});
    }) as unknown as typeof fetch;
    const client = new SupertextClient({ apiKey: 'k', endpoint: 'https://api.test/v1', fetch: fetchFn });
    const out = await client.translateSegments(['Hello', '<b>Bye</b>'], { targetLanguage: 'de-DE', sourceLanguage: 'en' });
    expect(out).toEqual(['Hallo', '<b>Tschüss</b>']);
    expect(seen[0].ua).toMatch(/^supertext-sdk-typescript Mailchimp-Supertext-Translation\//);
    expect(seen[0].target).toBe('de-DE');
    expect(seen[0].source).toBe('en');
  });

  it('reports an unknown target language (HTTP 404 INVALID_LANGUAGE_PAIR) as a language pair', async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ error_code: 'INVALID_LANGUAGE_PAIR', source_lang: 'en', target_lang: 'xx-XX' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })) as unknown as typeof fetch;
    const client = new SupertextClient({ apiKey: 'k', endpoint: 'https://api.test/v1', fetch: fetchFn });
    const error = (await client
      .translateSegments(['Hello'], { targetLanguage: 'xx-XX', sourceLanguage: 'en' })
      .catch((e: unknown) => e)) as { code: string; params: Record<string, string> };
    expect(error.code).toBe('languagePair');
    expect(error.params).toEqual({ source: 'en', target: 'xx-XX' });
  });

  describe('Translation review', () => {
    /** A fake Supertext that records every call (method and URL) and translates "Hello". */
    const recorder = () => {
      const calls: string[] = [];
      let html = '';
      const fetchFn = (async (url: string, init: RequestInit) => {
        calls.push(`${init.method ?? 'GET'} ${url}`);
        const headers = init.headers as Record<string, string>;
        if (init.method === 'POST') {
          const form = await new Request(url, { method: 'POST', body: init.body, headers }).formData();
          html = await (form.get('file') as File).text();
          return Response.json({ file_id: 'f1' });
        }
        if (url.endsWith('/status')) return Response.json({ status: 'done' });
        if (url.endsWith('/translation')) return new Response(html.replace(/>Hello</g, '>Hallo<'));
        return Response.json({});
      }) as unknown as typeof fetch;
      return { calls, fetchFn };
    };

    it('sends a review language to the review service (upload, status, download, delete) and the others directly', async () => {
      const { calls, fetchFn } = recorder();
      const client = new SupertextClient({ apiKey: 'k', endpoint: 'https://api.test/v1/', reviewEndpoint: 'https://review.test/v1/', fetch: fetchFn });
      const review = client.forReview(true);
      expect(review).not.toBe(client);
      expect(client.forReview(true)).toBe(review); // created once
      expect(client.forReview(false)).toBe(client);

      expect(await review.translateSegments(['Hello'], { targetLanguage: 'de-CH', sourceLanguage: 'en' })).toEqual(['Hallo']);
      expect(calls.length).toBeGreaterThanOrEqual(4);
      expect(calls.every((call) => call.includes('https://review.test/v1/'))).toBe(true);
      for (const step of [/^POST .*\/translate\/ai\/file$/, /^GET .*\/status$/, /^GET .*\/translation$/, /^DELETE /]) {
        expect(calls.some((call) => step.test(call))).toBe(true);
      }

      calls.length = 0;
      await client.translateSegments(['Hello'], { targetLanguage: 'fr-CH', sourceLanguage: 'en' });
      expect(calls.length).toBeGreaterThanOrEqual(4);
      expect(calls.every((call) => call.includes('https://api.test/v1/'))).toBe(true);
    });

    it('is off without a review URL or when it is the API URL', () => {
      const client = new SupertextClient({ apiKey: 'k', endpoint: 'https://api.test/v1/', reviewEndpoint: '' });
      expect(client.forReview(true)).toBe(client);
      const same = new SupertextClient({ apiKey: 'k', endpoint: 'https://api.test/v1', reviewEndpoint: 'https://api.test/v1/' });
      expect(same.forReview(true)).toBe(same);
      const live = new SupertextClient({ apiKey: 'k', reviewEndpoint: 'https://api.supertext.com/v1/' });
      expect(live.forReview(true)).toBe(live);
    });

    it("defaults to Supertext's review service; SUPERTEXT_REVIEW_URL='' turns it off", () => {
      expect(REVIEW_URL).toBe('https://localizationreview-production.up.railway.app/v1/');
      expect(loadConfig({}).reviewUrl).toBe(REVIEW_URL);
      expect(loadConfig({ SUPERTEXT_REVIEW_URL: '' }).reviewUrl).toBe('');
      expect(loadConfig({ SUPERTEXT_REVIEW_URL: 'https://review.test/v1/' }).reviewUrl).toBe('https://review.test/v1/');
    });
  });
});

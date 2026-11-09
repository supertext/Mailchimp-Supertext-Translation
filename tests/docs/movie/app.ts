/**
 * The app for the movies, set up like the screenshot script: the stand-in
 * Mailchimp and Supertext APIs (real translations of the sample account) and
 * the app in-process, on free local ports. The Supertext stand-in takes a
 * moment per document (`delayMs`), so the waiting state can be seen.
 */
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createServer, type AddressInfo } from 'node:net';
import { createApp } from '../../../src/app.js';
import { loadConfig } from '../../../src/config.js';
import { MemoryStore } from '../../../src/store/store.js';
import { createMailchimpStandin } from '../../standin/mailchimp.js';
import { createSupertextStandin } from '../../standin/supertext.js';

const listen = (fetch: (request: Request) => Response | Promise<Response>, port = 0) =>
  new Promise<string>((resolve) => {
    const server = serve({ fetch, port, hostname: '127.0.0.1' }, () => {
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    });
  });

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });

/** Starts the stand-ins and the app; returns the app's address. */
export async function startApp({ delayMs = 0 } = {}): Promise<string> {
  const mailchimp = createMailchimpStandin();
  const supertext = createSupertextStandin();
  const mailchimpUrl = await listen((request) => mailchimp.handle(request));
  mailchimp.apiBase = mailchimpUrl;
  const slow = async (request: Request) => {
    if (delayMs && request.method === 'POST' && new URL(request.url).pathname.endsWith('/translate/ai/file')) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return supertext.handle(request);
  };
  const supertextUrl = await listen(slow);
  // The review service speaks the same API: a second address of the same stand-in, never the live one.
  const reviewUrl = await listen(slow);
  const port = await freePort();
  const appUrl = `http://127.0.0.1:${port}`;
  const app = createApp({
    config: loadConfig({
      APP_URL: appUrl,
      MAILCHIMP_CLIENT_ID: 'movie',
      MAILCHIMP_CLIENT_SECRET: 'movie-secret',
      MAILCHIMP_LOGIN_BASE: mailchimpUrl,
      SUPERTEXT_API_ENDPOINT: `${supertextUrl}/v1/`,
      SUPERTEXT_REVIEW_URL: `${reviewUrl}/v1/`,
      // Version reports go to the stand-in, never to the live Commando Center.
      SUPERTEXT_REPORT_URL: `${supertextUrl}/report`,
      FOLDER_POLL_SECONDS: '0',
    }),
    store: new MemoryStore(),
  });
  app.use('/static/*', serveStatic({ root: new URL('../../../public/', import.meta.url).pathname, rewriteRequestPath: (path) => path.replace(/^\/static/, '') }));
  await listen(app.fetch, port);
  return appUrl;
}

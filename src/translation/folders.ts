import { translator, resolveLocale } from '../i18n/index.js';
import type { MailchimpClient } from '../mailchimp/client.js';
import type { Account, FolderEntry, FolderTarget, Store } from '../store/store.js';
import type { JobDeps } from './jobs.js';
import { startJob } from './jobs.js';
import { languageName } from './languages.js';

/**
 * The folder trigger. The app keeps one campaign folder per target language
 * ("Supertext → Deutsch") plus "Supertext → All languages". Every poll it
 * lists where each campaign is; a campaign found in a Supertext folder is
 * moved back to the folder it was in before and translated into that
 * folder's languages. Campaigns that can't be moved (Mailchimp refuses
 * changes to some sent campaigns) are translated once and remembered until
 * they leave the folder.
 */

export const folderName = (account: Account, target: FolderTarget): string => {
  const locale = resolveLocale(account.folderLocale);
  const name = target === 'all' ? translator(locale).t('folder.all') : languageName(target, locale);
  return `Supertext → ${name}`;
};

/** The folders the account should have: all languages first, then one per language. */
export const wantedFolders = (account: Account): FolderTarget[] =>
  account.folderTrigger && account.targets.length > 0 ? ['all', ...account.targets] : [];

/**
 * Creates, renames and removes the Supertext folders to match the settings.
 * A folder that is no longer wanted is deleted only if it's empty; otherwise
 * it stays as an ordinary folder. Returns the updated account (not saved).
 */
export async function syncFolders(
  mailchimp: Pick<MailchimpClient, 'folders' | 'createFolder' | 'renameFolder' | 'deleteFolder'>,
  account: Account,
): Promise<Account> {
  const remote = new Map((await mailchimp.folders()).map((folder) => [folder.id, folder]));
  const wanted = new Set(wantedFolders(account));
  const folders: Record<string, FolderTarget> = {};
  const have = new Set<FolderTarget>();

  for (const [id, target] of Object.entries(account.folders)) {
    const folder = remote.get(id);
    if (!folder) continue; // deleted in Mailchimp: made again below if still wanted
    if (wanted.has(target) && !have.has(target)) {
      const name = folderName(account, target);
      if (folder.name !== name) await mailchimp.renameFolder(id, name);
      folders[id] = target;
      have.add(target);
    } else if (!folder.count) {
      await mailchimp.deleteFolder(id);
    }
  }
  for (const target of wanted) {
    if (have.has(target)) continue;
    const folder = await mailchimp.createFolder(folderName(account, target));
    folders[folder.id] = target;
  }
  return { ...account, folders };
}

/** Removes the account's empty Supertext folders (when disconnecting). */
export async function removeFolders(
  mailchimp: Pick<MailchimpClient, 'folders' | 'deleteFolder'>,
  account: Account,
): Promise<void> {
  const remote = new Map((await mailchimp.folders()).map((folder) => [folder.id, folder]));
  for (const id of Object.keys(account.folders)) {
    const folder = remote.get(id);
    if (folder && !folder.count) await mailchimp.deleteFolder(id).catch(() => undefined);
  }
}

export interface PollResult {
  started: string[];
}

/** One look at an account's campaigns; starts a job for each campaign found in a Supertext folder. */
export async function pollAccount(
  deps: JobDeps & { onJob?: (done: Promise<unknown>) => void },
  account: Account,
): Promise<PollResult> {
  const mailchimp = deps.mailchimp(account);
  const triggers = account.folders;
  if (Object.keys(triggers).length === 0) return { started: [] };
  const campaigns = await mailchimp.campaignFolders();
  const previous = await deps.store.folderEntries(account.accountId);
  const entries: Record<string, FolderEntry> = {};
  const started: string[] = [];

  for (const campaign of campaigns) {
    const before = previous[campaign.id];
    const target = triggers[campaign.folderId];
    if (target === undefined) {
      entries[campaign.id] = { folder: campaign.folderId };
      continue;
    }
    if (before?.handled === campaign.folderId) {
      entries[campaign.id] = before;
      continue;
    }
    const home = before && triggers[before.folder] === undefined ? before.folder : '';
    let moved = true;
    try {
      await mailchimp.updateCampaign(campaign.id, { settings: { folder_id: home } });
    } catch (error) {
      moved = false;
      console.warn('Supertext: could not move campaign %s out of the Supertext folder', campaign.id, error);
    }
    entries[campaign.id] = moved ? { folder: home } : { folder: home, handled: campaign.folderId };
    const languages = target === 'all' ? account.targets : [target];
    console.log(`Supertext: campaign ${campaign.id} found in a Supertext folder; translating into ${languages.join(', ')}`);
    const { job, done } = await startJob(deps, {
      accountId: account.accountId,
      campaignId: campaign.id,
      languages,
      // Moving a campaign into the folder again asks for a fresh translation.
      overwrite: true,
      trigger: 'folder',
      folderId: home,
    });
    deps.onJob?.(done);
    started.push(job.id);
  }
  await deps.store.saveFolderEntries(account.accountId, entries);
  return { started };
}

/** Polls every account with the folder trigger, one after the other; a run is skipped while the last one still goes. */
export function startPoller(
  deps: JobDeps & { onJob?: (done: Promise<unknown>) => void },
  seconds: number,
  onTokenRefused: (account: Account) => Promise<void>,
): () => void {
  if (seconds <= 0) return () => undefined;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      for (const account of await deps.store.folderAccounts()) {
        try {
          await pollAccount(deps, account);
        } catch (error) {
          const code = (error as { code?: string }).code;
          if (code === 'mailchimpAuth') await onTokenRefused(account);
          else console.warn('Supertext: folder check failed for account %s', account.accountId, error);
        }
      }
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(tick, seconds * 1000);
  timer.unref?.();
  void tick();
  return () => clearInterval(timer);
}

/**
 * Ternary House YouTube Qualifier — storage-isolation policy.
 *
 * Pure helpers describing how the stored API key is protected, so the policy
 * can be unit-tested without a Chrome runtime. The actual enforcement call
 * lives in the service worker.
 *
 * Background: chrome.storage.local is exposed to content scripts BY DEFAULT
 * (accessLevel TRUSTED_AND_UNTRUSTED_CONTEXTS). StorageArea.setAccessLevel()
 * applies to storage.local (as well as sync/session/managed) and can restrict
 * it to TRUSTED_CONTEXTS — extension pages and the service worker only —
 * while leaving the data persistent across browser restarts.
 */

/** The only key we persist. */
export const API_KEY_STORAGE_KEY = 'youtubeApiKey';

/**
 * A deliberately non-secret sentinel. The content script reads THIS to test
 * whether the isolation is active; it must never read the API key itself.
 */
export const ACCESS_PROBE_KEY = '__thq_access_probe__';

export const ACCESS_LEVEL_TRUSTED = 'TRUSTED_CONTEXTS';

/**
 * Collapse the service worker's lockdown result and the content script's probe
 * result into one reportable status.
 *
 * @param {{lockdown?: string, probe?: string|null}} state
 *   lockdown: 'applied' | 'unsupported' | 'failed' | 'unknown'
 *   probe:    'blocked' | 'allowed' | null (not yet run)
 */
export function describeStorageIsolation(state = {}) {
  const lockdown = state.lockdown || 'unknown';
  const probe = state.probe || null;

  if (lockdown === 'applied' && probe === 'blocked') {
    return {
      level: 'verified',
      secure: true,
      headline: 'Content scripts blocked (verified)',
      detail: 'storage.local is restricted to TRUSTED_CONTEXTS, and a YouTube page confirmed it cannot read extension storage.',
    };
  }

  if (lockdown === 'applied' && probe === 'allowed') {
    return {
      level: 'contradiction',
      secure: false,
      headline: 'Restriction did not take effect',
      detail: 'The restriction was accepted but a YouTube page could still read extension storage. Treat the key as readable by content scripts and reload the extension.',
    };
  }

  if (lockdown === 'applied') {
    return {
      level: 'applied',
      secure: true,
      headline: 'Content scripts blocked (not yet verified)',
      detail: 'storage.local is restricted to TRUSTED_CONTEXTS. Open a YouTube channel Videos tab once to confirm it from the page side.',
    };
  }

  if (lockdown === 'unsupported') {
    return {
      level: 'unsupported',
      secure: false,
      headline: 'Not supported by this Chrome build',
      detail: 'This Chrome does not expose storage.local.setAccessLevel(), so the key remains readable by this extension’s own content script. The key is still never placed in the page, logged, or sent anywhere but googleapis.com.',
    };
  }

  if (lockdown === 'failed') {
    return {
      level: 'failed',
      secure: false,
      headline: 'Restriction failed',
      detail: 'storage.local.setAccessLevel() threw. The key remains readable by this extension’s own content script.',
    };
  }

  return {
    level: 'unknown',
    secure: false,
    headline: 'Not yet determined',
    detail: 'The service worker has not reported a storage-isolation result yet.',
  };
}

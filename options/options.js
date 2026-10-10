/**
 * Ternary House YouTube Qualifier — Settings page.
 *
 * The options page is a trusted extension context, so it may read and write
 * the key directly. It never renders the key into a page the user might
 * share, and the field starts masked.
 */

'use strict';

const API_KEY_STORAGE_KEY = 'youtubeApiKey';

const input = document.getElementById('api-key');
const statusEl = document.getElementById('status');
const form = document.getElementById('key-form');
const revealBtn = document.getElementById('reveal');
const testBtn = document.getElementById('test');
const clearBtn = document.getElementById('clear');

function setStatus(text, kind = 'muted') {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`;
}

function maskedSummary(key) {
  if (!key) return '';
  const tail = key.slice(-4);
  return `••••${tail} (${key.length} characters)`;
}

async function loadKey() {
  const stored = await chrome.storage.local.get(API_KEY_STORAGE_KEY);
  const key = stored[API_KEY_STORAGE_KEY];
  if (typeof key === 'string' && key) {
    input.value = key;
    setStatus(`Configured — ${maskedSummary(key)}`, 'ok');
  } else {
    setStatus('Not configured — the extension cannot calculate until a key is saved.', 'muted');
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const key = input.value.trim();
  if (!key) {
    setStatus('Enter a key before saving.', 'bad');
    return;
  }
  await chrome.storage.local.set({ [API_KEY_STORAGE_KEY]: key });
  setStatus(`Saved — ${maskedSummary(key)}`, 'ok');
});

revealBtn.addEventListener('click', () => {
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  revealBtn.textContent = showing ? 'Show' : 'Hide';
});

testBtn.addEventListener('click', async () => {
  const key = input.value.trim();
  if (!key) {
    setStatus('Enter a key before testing.', 'bad');
    return;
  }
  testBtn.disabled = true;
  setStatus('Testing…', 'muted');
  const response = await chrome.runtime.sendMessage({ type: 'TEST_KEY', payload: { apiKey: key } });
  testBtn.disabled = false;

  if (response && response.ok) {
    setStatus('Key works — YouTube Data API v3 responded successfully.', 'ok');
  } else {
    const err = (response && response.error) || {};
    const detail = err.detail ? ` (${err.detail})` : '';
    setStatus(`${err.message || 'Key test failed.'}${detail}`, 'bad');
  }
});

clearBtn.addEventListener('click', async () => {
  await chrome.storage.local.remove(API_KEY_STORAGE_KEY);
  input.value = '';
  setStatus('Key removed from this computer.', 'muted');
});

async function loadSecurityStatus() {
  const el = document.getElementById('isolation');
  const detail = document.getElementById('isolation-detail');
  const response = await chrome.runtime.sendMessage({ type: 'SECURITY_STATUS', payload: {} });
  if (!response || !response.ok) {
    el.textContent = 'Could not determine key isolation status.';
    el.className = 'status bad';
    return;
  }
  const { status } = response;
  el.textContent = status.headline;
  el.className = `status ${status.secure ? 'ok' : 'bad'}`;
  detail.textContent = status.detail;
}

loadKey();
loadSecurityStatus();

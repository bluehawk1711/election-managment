/**
 * Per-account saved WhatsApp messages for the voter slip.
 *
 * These are drafts the operator owns, not campaign records: they live in
 * `localStorage` so the feature works on Spark with no rules deploy and no
 * cross-device write path. The account uid is part of every key, which is
 * what makes the list differ between users sharing one browser — the "different
 * users" part of the message selector.
 *
 * The built-in slip message is not stored here: it always exists, cannot be
 * edited or deleted, and is the fallback whenever a saved id no longer resolves.
 */
import {
  DEFAULT_SLIP_MESSAGE_ID,
  type SlipMessageTemplate,
} from './slip';

const PREFIX = 'slip.messages.v1';
const SELECTED_PREFIX = 'slip.selectedMessage.v1';

export const MAX_SLIP_MESSAGES = 20;
export const MAX_SLIP_MESSAGE_LABEL = 60;
export const MAX_SLIP_MESSAGE_BODY = 4000;

const templatesKey = (uid: string | null) =>
  `${PREFIX}.${uid ?? 'anon'}`;
const selectedKey = (uid: string | null) =>
  `${SELECTED_PREFIX}.${uid ?? 'anon'}`;

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function cleanTemplate(value: unknown): SlipMessageTemplate | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<SlipMessageTemplate>;
  if (typeof candidate.id !== 'string') return null;
  if (typeof candidate.label !== 'string') return null;
  if (typeof candidate.body !== 'string') return null;

  const id = candidate.id.trim();
  const label = candidate.label.trim();
  const body = candidate.body.trim();

  if (!id || id === DEFAULT_SLIP_MESSAGE_ID) return null;
  if (!label || label.length > MAX_SLIP_MESSAGE_LABEL) return null;
  if (!body || body.length > MAX_SLIP_MESSAGE_BODY) return null;

  return { id, label, body };
}

/** Saved messages for one account, newest last. Bad/older data is ignored. */
export function readSlipMessageTemplates(
  uid: string | null
): SlipMessageTemplate[] {
  const raw = readRaw(templatesKey(uid));
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const seen = new Set<string>();
    const templates: SlipMessageTemplate[] = [];
    for (const value of parsed) {
      const template = cleanTemplate(value);
      if (!template || seen.has(template.id)) continue;
      seen.add(template.id);
      templates.push(template);
      if (templates.length === MAX_SLIP_MESSAGES) break;
    }
    return templates;
  } catch {
    return [];
  }
}

/** Persists the list. Returns false for quota/private-mode failures. */
export function writeSlipMessageTemplates(
  uid: string | null,
  templates: SlipMessageTemplate[]
): boolean {
  return writeRaw(
    templatesKey(uid),
    JSON.stringify(templates.slice(0, MAX_SLIP_MESSAGES))
  );
}

/** The last message picked by this account, or the built-in id if unset. */
export function readSlipMessageSelection(uid: string | null): string {
  const value = readRaw(selectedKey(uid));
  return value && value.trim() ? value : DEFAULT_SLIP_MESSAGE_ID;
}

export function writeSlipMessageSelection(
  uid: string | null,
  id: string
): boolean {
  return writeRaw(selectedKey(uid), id);
}

/** A collision-resistant local id; the message never leaves this device. */
export function newSlipMessageId(): string {
  try {
    return `custom-${crypto.randomUUID()}`;
  } catch {
    return `custom-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

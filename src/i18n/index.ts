import { en, type Key } from './en';
import { ru } from './ru';

export type Lang = 'en' | 'ru';
export type { Key };

/**
 * A translatable message. The simulation produces these and never final text. A string
 * parameter starting with "@" is itself a key (e.g. "@module.engine-l").
 */
export interface Msg {
  key: Key;
  params?: Record<string, string | number | Msg>;
}
export const msg = (key: Key, params?: Msg['params']): Msg => ({ key, params });

const dicts: Record<Lang, Partial<Record<Key, string>>> = { en, ru };
const STORAGE = 'pixelsky.lang';
let lang: Lang = 'en';
try {
  const saved = localStorage.getItem(STORAGE);
  if (saved === 'en' || saved === 'ru') lang = saved;
} catch {
  // Storage may be unavailable (private mode, tests); English stays the default.
}
const listeners = new Set<() => void>();

export const getLang = () => lang;
export function setLang(next: Lang) {
  lang = next;
  try {
    localStorage.setItem(STORAGE, next);
  } catch {
    // Not persisted; the choice still applies to this session.
  }
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  listeners.forEach((f) => f());
}
export const onLangChange = (f: () => void) => listeners.add(f);

function value(v: string | number | Msg | undefined): string {
  if (v === undefined) return '';
  if (typeof v === 'object') return tr(v);
  if (typeof v === 'string' && v.startsWith('@')) return t(v.slice(1) as Key);
  return String(v);
}

export function t(key: Key | string, params?: Msg['params']): string {
  const raw = dicts[lang][key as Key] ?? en[key as Key] ?? key;
  return params ? raw.replace(/\{(\w+)\}/g, (_, k: string) => value(params[k])) : raw;
}
export const tr = (m: Msg) => t(m.key, m.params);

/** Fills elements marked with data-i18n (text) or data-i18n-html (markup). */
export function applyStatic(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n!);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-html]').forEach((el) => {
    el.innerHTML = t(el.dataset.i18nHtml!);
  });
}

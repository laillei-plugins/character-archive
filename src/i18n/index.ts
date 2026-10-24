// @ts-expect-error TS5097: explicit extension also supports the native Node TS tests.
import { en, ko, type TranslationKey } from "./messages.ts";

export { en, ko };
export type { TranslationKey };
export type Language = "en" | "ko";

export function isLanguage(value: unknown): value is Language {
  return value === "en" || value === "ko";
}

/** The stored choice wins. Detect Obsidian only for a genuinely fresh install. */
export function resolveLanguage(
  stored: unknown,
  readObsidianLanguage: () => unknown = () => null,
): Language {
  if (stored !== null && typeof stored === "object") {
    const language = (stored as { language?: unknown }).language;
    if (isLanguage(language)) return language;
  }
  if (stored !== null && stored !== undefined) return "ko";
  const language = readObsidianLanguage();
  return typeof language === "string" && language.startsWith("ko") ? "ko" : "en";
}

/** No Obsidian import: older hosts may not export getLanguage at all. */
export function readObsidianLanguage(
  api: { getLanguage?: unknown },
  readLegacy: () => string | null,
): unknown {
  if (typeof api.getLanguage === "function") {
    try {
      return api.getLanguage();
    } catch {
      // A broken host API is treated like an unavailable one.
    }
  }
  try {
    return readLegacy();
  } catch {
    // localStorage can be unavailable in restricted desktop/mobile contexts.
    return null;
  }
}

export type LanguageListener = (language: Language, previous: Language) => void;

/** One plugin UI language. Subscriptions return an Obsidian-registerable disposer. */
export function createLanguageSource(initial: Language) {
  let current = initial;
  const listeners = new Set<LanguageListener>();
  return {
    get current(): Language { return current; },
    set(language: Language): void {
      if (!isLanguage(language)) throw new Error("Unsupported UI language");
      if (language === current) return;
      const previous = current;
      current = language;
      for (const listener of [...listeners]) {
        try { listener(language, previous); }
        catch (error) { console.error("[charinfo] Language listener failed", error); }
      }
    },
    subscribe(listener: LanguageListener): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

// Preserve today's Korean display for pure helpers until plugin load sets the choice.
export const uiLanguage = createLanguageSource("ko");

type Variables<S extends string> =
  S extends `${string}{${infer V}}${infer Rest}` ? V | Variables<Rest> : never;
export type MessageVariables<K extends TranslationKey> = Record<
  Variables<(typeof ko)[K]>, string | number
>;
type Args<K extends TranslationKey> =
  [Variables<(typeof ko)[K]>] extends [never] ? [] : [vars: MessageVariables<K>];

function format(language: Language, key: TranslationKey, vars?: Record<string, string | number>): string {
  const message: string = (language === "ko" ? ko : en)[key];
  if (typeof message !== "string") throw new Error(`Unknown translation key: ${key}`);
  return message.replace(/\{(\w+)\}/g, (_match, name: string) => {
    if (!vars || !Object.prototype.hasOwnProperty.call(vars, name)) {
      throw new Error(`Missing translation variable: ${key}.${name}`);
    }
    return String(vars[name]);
  });
}

/** Plain-text interpolation only. Values are not HTML and are never re-interpolated. */
export function translate<K extends TranslationKey>(language: Language, key: K, ...args: Args<K>): string {
  return format(language, key, args[0]);
}

export function t<K extends TranslationKey>(key: K, ...args: Args<K>): string {
  return format(uiLanguage.current, key, args[0]);
}

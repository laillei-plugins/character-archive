/** Persisted evidence that a note was successfully reconciled against a schema. */
export interface SchemaScanCache {
  signature: string;
  files: Record<string, string>;
}

const DEVICE_CACHE_KEY = "character-archive:schema-scan-cache";

interface DeviceStorageApp {
  loadLocalStorage?: (key: string) => unknown;
  saveLocalStorage?: (key: string, value: unknown) => void;
}

type FallbackStorage = Pick<Storage, "getItem" | "setItem">;

/** Older Obsidian versions expose appId at runtime, outside the public types. */
function fallbackCacheKey(app: DeviceStorageApp): string {
  const appId = (app as { appId?: unknown }).appId;
  if (typeof appId !== "string" || !appId) {
    throw new Error("Vault identity unavailable for device cache");
  }
  return `${DEVICE_CACHE_KEY}:${appId}`;
}

export function loadDeviceSchemaScanCache(
  app: DeviceStorageApp,
  storage: () => FallbackStorage = () => window.localStorage,
): SchemaScanCache {
  try {
    const raw = typeof app.loadLocalStorage === "function"
      ? app.loadLocalStorage(DEVICE_CACHE_KEY)
      : JSON.parse(storage().getItem(fallbackCacheKey(app)) ?? "null");
    return normalizeSchemaScanCache(raw);
  } catch {
    return normalizeSchemaScanCache(null);
  }
}

export function saveDeviceSchemaScanCache(
  app: DeviceStorageApp,
  cache: SchemaScanCache,
  storage: () => FallbackStorage = () => window.localStorage,
): void {
  try {
    if (typeof app.saveLocalStorage === "function") {
      app.saveLocalStorage(DEVICE_CACHE_KEY, cache);
    } else {
      storage().setItem(fallbackCacheKey(app), JSON.stringify(cache));
    }
  } catch {
    // Cache persistence is optional; never fail a scan or write synced settings.
  }
}

export function normalizeSchemaScanCache(raw: unknown): SchemaScanCache {
  if (!raw || typeof raw !== "object") return { signature: "", files: {} };
  const value = raw as Record<string, unknown>;
  const files: Record<string, string> = {};
  if (value.files && typeof value.files === "object" && !Array.isArray(value.files)) {
    for (const [path, fingerprint] of Object.entries(value.files)) {
      if (path && typeof fingerprint === "string" && /^\d+:\d+$/.test(fingerprint)) {
        files[path] = fingerprint;
      }
    }
  }
  return {
    signature: typeof value.signature === "string" ? value.signature : "",
    files,
  };
}

export function fileFingerprint(stat: { mtime: number; size: number }): string {
  return `${stat.mtime}:${stat.size}`;
}

/** A changed note may include an editor write that this scan never inspected. */
export function isStableSchemaScan(before: string, after: string): boolean {
  return before === after;
}

export function needsSchemaScan(
  cache: SchemaScanCache,
  signature: string,
  path: string,
  fingerprint: string,
): boolean {
  return cache.signature !== signature || cache.files[path] !== fingerprint;
}

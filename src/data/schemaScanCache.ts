/** Persisted evidence that a note was successfully reconciled against a schema. */
export interface SchemaScanCache {
  signature: string;
  files: Record<string, string>;
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

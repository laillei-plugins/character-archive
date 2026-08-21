/**
 * Fixed archive schema (고정 아카이브 구조) — the storage contract for
 * `kind: character` notes.
 *
 * A missing canonical key means "empty", never "removed from this archive", so
 * the reconciler puts the key back with its default. It never overwrites an
 * existing value, coerces a type, renames a key, or deletes an unknown one.
 *
 * This file imports nothing on purpose: the planner and the work lane are the
 * two pieces worth locking with `node --test`, and Obsidian cannot load there.
 * The plugin passes `parseYaml` in as `parse` and does the writing itself.
 */

/** Keys every character note carries. Missing → restored with the default. */
export const CANONICAL_PROPERTY_KEYS = [
  "이름",
  "상태",
  "그룹",
  "관계",
  "인연",
  "코드네임",
  "본명",
  "소속",
  "태그",
] as const;

export type CanonicalPropertyKey = (typeof CANONICAL_PROPERTY_KEYS)[number];

/**
 * Identity and systemic keys the reconciler must never create.
 * `kind` is protected identity; the rest are written by their own features
 * (archive pin, ordering, cover) and an empty value there is not harmless.
 */
export const NEVER_CREATE_KEYS = [
  "kind",
  "장르",
  "작품",
  "order",
  "charinfo_order",
  "cover",
  "coverPosition",
  "cover_position",
] as const;

export const CHARACTER_KIND = "character";

/** Missing-key defaults. `상태: ""` is correct — the read layer supplies Off. */
export const CANONICAL_PROPERTY_DEFAULTS: Readonly<
  Record<CanonicalPropertyKey, string | readonly string[]>
> = Object.freeze({
  이름: "",
  상태: "",
  그룹: "",
  관계: "",
  인연: "",
  코드네임: "",
  본명: "",
  소속: "",
  태그: Object.freeze([]) as readonly string[],
});

/** Fresh default value — arrays must never be shared between notes. */
export function canonicalPropertyDefault(
  key: CanonicalPropertyKey,
): string | string[] {
  return key === "태그" ? [] : "";
}

export function isCanonicalPropertyKey(
  key: string,
): key is CanonicalPropertyKey {
  return (CANONICAL_PROPERTY_KEYS as readonly string[]).includes(key);
}

/**
 * The only keys a character note may gain automatically.
 *
 * Rules:
 * - `kind` missing or not `character` → `null` (the caller must not write)
 * - key absent → add its default
 * - key present → value and type stay exactly as they are, wrong type included
 * - nothing to add → `null`, so the caller can skip `processFrontMatter`
 */
export function planCanonicalPropertyPatch(
  fm: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!fm || typeof fm !== "object") return null;
  const kind = (fm as Record<string, unknown>).kind;
  if (typeof kind !== "string" || kind.trim() !== CHARACTER_KIND) return null;

  const patch: Record<string, unknown> = {};
  let missing = 0;
  for (const key of CANONICAL_PROPERTY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(fm, key)) continue;
    patch[key] = canonicalPropertyDefault(key);
    missing += 1;
  }
  return missing > 0 ? patch : null;
}

export type YamlParse = (raw: string) => unknown;

export type FrontmatterBlock =
  | { ok: false; reason: "absent" | "malformed" }
  | { ok: true; fm: Record<string, unknown>; kind: string };

/**
 * First `---` block of a note, parsed with the caller's YAML parser
 * (`parseYaml` from obsidian in the plugin, a stub in tests).
 *
 * No opening fence → `absent`. Unclosed fence, throwing parser, or a
 * non-mapping document → `malformed`: preserve the file, write nothing.
 */
export function parseFrontmatterBlock(
  text: string,
  parse: YamlParse,
): FrontmatterBlock {
  const lines = text.split(/\r?\n/);
  if ((lines[0] ?? "").trimEnd() !== "---") return { ok: false, reason: "absent" };

  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    const line = (lines[i] ?? "").trimEnd();
    if (line === "---" || line === "...") {
      end = i;
      break;
    }
  }
  if (end < 0) return { ok: false, reason: "malformed" };

  const raw = lines.slice(1, end).join("\n");
  let data: unknown;
  try {
    data = raw.trim() ? parse(raw) : {};
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (data == null) data = {};
  if (typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, reason: "malformed" };
  }

  const fm = data as Record<string, unknown>;
  const kindRaw = fm.kind;
  return {
    ok: true,
    fm,
    kind: typeof kindRaw === "string" ? kindRaw.trim() : "",
  };
}

/** Work a single note may need. Both bits run in one per-path lane. */
export type HealBit = "schema" | "content";

/** Deterministic order — schema restores keys before content healers run. */
export const HEAL_BIT_ORDER: readonly HealBit[] = ["schema", "content"];

/** One transient retry per batch; the second throw surfaces to the caller. */
export const MAX_LANE_ATTEMPTS = 2;

export type LaneRunner = (path: string, bits: HealBit[]) => Promise<void>;

interface LaneWaiter {
  resolve: () => void;
  reject: (reason: unknown) => void;
}

interface LaneState {
  pending: Set<HealBit>;
  running: boolean;
  waiters: LaneWaiter[];
}

/**
 * Per-path work lane. Every writer for one note (schema, collapsed embeds, NAI
 * prompts, card fields) goes through here, so two whole-file read/modify cycles
 * can never overwrite each other. Different paths still run concurrently.
 *
 * Bursts on a path coalesce into pending bits instead of queueing promises: a
 * running path finishes, then consumes whatever accumulated in one more pass.
 */
export class PathWorkLane {
  private readonly run: LaneRunner;
  private readonly maxAttempts: number;
  private readonly states = new Map<string, LaneState>();
  private stopped = false;

  constructor(run: LaneRunner, opts?: { maxAttempts?: number }) {
    this.run = run;
    this.maxAttempts = Math.max(1, opts?.maxAttempts ?? MAX_LANE_ATTEMPTS);
  }

  /** Paths with work running or pending — diagnostics and tests. */
  get busyPaths(): number {
    return this.states.size;
  }

  /**
   * Request `bit` for `path`. Resolves when this path's queue drains; rejects
   * with the last error if a batch still failed after its retry.
   */
  enqueue(path: string, bit: HealBit): Promise<void> {
    if (this.stopped) return Promise.resolve();
    let state = this.states.get(path);
    if (!state) {
      state = { pending: new Set<HealBit>(), running: false, waiters: [] };
      this.states.set(path, state);
    }
    const current = state;
    current.pending.add(bit);
    const settled = new Promise<void>((resolve, reject) => {
      current.waiters.push({ resolve, reject });
    });
    if (!current.running) {
      current.running = true;
      // Start on a microtask so bits requested in the same tick (one modify
      // asking for schema + content) land in a single pass.
      queueMicrotask(() => {
        void this.drain(path, current);
      });
    }
    return settled;
  }

  /** Unload: drop queued work. In-flight runs finish on their own. */
  dispose(): void {
    this.stopped = true;
    for (const state of this.states.values()) state.pending.clear();
  }

  private async drain(path: string, state: LaneState): Promise<void> {
    let failed = false;
    let failure: unknown = null;
    try {
      while (state.pending.size > 0 && !this.stopped) {
        const bits = HEAL_BIT_ORDER.filter((bit) => state.pending.has(bit));
        state.pending.clear();
        try {
          await this.attempt(path, bits);
        } catch (error) {
          failed = true;
          failure = error;
        }
      }
    } finally {
      // No await between the loop test and here, so nothing can be lost.
      state.running = false;
      this.states.delete(path);
      const waiters = state.waiters.splice(0);
      for (const waiter of waiters) {
        if (failed) waiter.reject(failure);
        else waiter.resolve();
      }
    }
  }

  private async attempt(path: string, bits: HealBit[]): Promise<void> {
    let last: unknown = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        await this.run(path, bits);
        return;
      } catch (error) {
        last = error;
      }
    }
    throw last;
  }
}

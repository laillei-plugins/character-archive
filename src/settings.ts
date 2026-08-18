import {
  DEFAULT_CARD_PROPERTIES,
  normalizeCardProperties,
  type CardPropertyPref,
} from "./data/cardProperties";
import {
  DEFAULT_STATUSES,
  normalizeStatuses,
  normalizeChipFilter,
  type StatusDef,
} from "./data/status";
import {
  DEFAULT_SELECT_VOCAB,
  getFilterAxis,
  normalizePrimaryFilterProperty,
  normalizeSelectVocabMap,
  type PrimaryFilterProperty,
  type SelectVocab,
} from "./data/filterAxis";
import { normalizeTagVocab, type TagDef } from "./data/tags";
import {
  DEFAULT_PROPERTY_DISPLAY_NAMES,
  normalizePropertyDisplayNames,
  type PropertyDisplayNames,
} from "./data/propertyLabels";

/** Vault-relative path normalize (no Obsidian import in settings). */
function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
}

export type MediaRootMode = "vault" | "external";
/** Where new cover/image acquires go when Imgur plugin is available. */
export type ImageUploadDestination = "vault" | "imgur";
export type SortMode = "manual" | "name";
/** `"all"` or an option id from the active filter axis vocabulary. */
export type ChipFilter = string;
export type {
  StatusDef,
  PrimaryFilterProperty,
  SelectVocab,
  TagDef,
  PropertyDisplayNames,
};
export {
  TAG_FRONTMATTER_KEY,
  parseTagIds,
  tagAxisOptions,
} from "./data/tags";
export {
  DEFAULT_STATUSES,
  STATUS_COLOR_TOKENS,
  resolveStatus,
  statusColorClass,
  suggestStatusId,
  adoptUnknownStatuses,
  guessStatusColor,
  type StatusColorToken,
} from "./data/status";
export {
  FILTER_AXIS_IDS,
  SELECT_VOCAB_PROPERTIES,
  axisFor,
  axisFrontmatterKey,
  axisIsMulti,
  axisLabel,
  countRawAxisOccupants,
  leftoverAxisIds,
  getFilterAxis,
  normalizePrimaryFilterProperty,
  recordAxisValue,
  recordAxisValues,
  recordMatchesAxisChip,
  resolveAxisOption,
  resolveFilterAxis,
  resolveRecordAxisOption,
  resolveRecordAxisOptions,
  setRecordAxisValue,
  type FilterAxis,
  type SelectVocabProperty,
} from "./data/filterAxis";
/**
 * hosted = our Cloudflare share-host (one-click; recommended when deployed).
 * github = fixed Pages URL (user PAT).
 */
export type WebShareHostMode = "hosted" | "github";
export type HostedShareTtl = "7d" | "30d" | "permanent";
/**
 * Side-panel property set when the 「속성」 header chip is on.
 * Card strip always mirrors Obsidian eye toggles (`cardProperties`).
 */
export type WebSharePanelPropsMode = "preview" | "all";
/** Frontmatter attrs header chip label in share advanced options. */
export const SHARE_ATTR_HEADER = "속성";
/** @deprecated Migrated into panel headers. */
export type WebShareContentMode = "preview" | "full";
export type { CardPropertyPref };

/** Ephemeral UI remembered per gallery note path. */
export interface GalleryPageState {
  /** Last selected archive when the page is not FM-pinned. */
  activeGenre?: string;
  /** Remembered chip value (migrated from `statusFilter`). */
  chipFilter?: string;
  /** Axis the remembered `chipFilter` belongs to — stale values are ignored. */
  chipFilterProperty?: string;
}

export interface CharinfoSettings {
  /** Folder that holds character notes (scanned for kind: character). */
  libraryFolder: string;
  /** Where new uploads go. Existing vault embeds stay untouched. */
  mediaRootMode: MediaRootMode;
  /**
   * Prefer Imgur plugin for new cover/file acquires when set to `imgur`
   * and the community plugin is enabled. Default `vault` (explicit opt-in).
   */
  imageUploadDestination: ImageUploadDestination;
  /**
   * Vault-relative folder used when mediaRootMode === "vault".
   * Keep migrated Notion assets under the library; default matches that.
   */
  vaultMediaFolder: string;
  /**
   * Absolute path used when mediaRootMode === "external".
   * Empty = not configured yet (falls back to vaultMediaFolder until set).
   */
  externalMediaPath: string;
  /** Obsidian template note path for new characters (optional override). */
  characterTemplatePath: string;
  /**
   * Per-archive (`장르`) template override. Falls back to
   * `characterTemplatePath`, then the bundled template.
   */
  characterTemplateByGenre: Record<string, string>;
  /** Start gallery in read mode (edit mode unlocks DnD / context edits). */
  defaultEditMode: boolean;
  /** Gallery sort: manual (자유/drag order) or name (이름순). */
  sortMode: SortMode;
  /**
   * Active genre shown in the gallery header (prompt-storage style).
   * Fallback for pages without per-path state; prefer `galleryPageState`.
   */
  activeGenre: string;
  /**
   * Per-archive (`장르`) section order for named `그룹` values.
   * @deprecated Prefer `groupOrderByLibrary`; kept for migration.
   */
  groupOrderByGenre: Record<string, string[]>;
  /**
   * Group section order keyed by library folder, then archive (`장르`).
   */
  groupOrderByLibrary: Record<string, Record<string, string[]>>;
  /**
   * Ephemeral UI per gallery note path (active archive when unpinned, status filter).
   */
  galleryPageState: Record<string, GalleryPageState>;
  /**
   * Card-preview property visibility/order (eye toggles).
   * Side panel always lists every non-systemic property.
   * (Persisted key kept as cardProperties for migration.)
   */
  cardProperties: CardPropertyPref[];
  /**
   * Notion Fit image: true = contain whole image; false = cover crop.
   */
  cardFitImage: boolean;
  /**
   * Status vocabulary for `상태` (filter chips + card pills).
   * Color is a preset token, not freeform hex.
   */
  statuses: StatusDef[];
  /** Default `상태` for new characters (must exist in `statuses`). */
  defaultStatusId: string;
  /**
   * Default property the gallery chip row filters on. One row, one axis.
   * A gallery note may override this with FM `primaryFilter`.
   */
  primaryFilterProperty: PrimaryFilterProperty;
  /**
   * Closed vocabularies for the non-status axes (관계 / 인연 / 소속).
   * Empty is valid — an empty axis simply can't be the chip row.
   */
  selectVocab: SelectVocab;
  /**
   * Tag vocabulary for the multi-value `태그` property. Settings-owned: ids
   * found only in notes stay gray ghosts and are never adopted back in here.
   */
  tagVocab: TagDef[];
  /**
   * Gallery-facing names for the five chip properties.
   * Note YAML keys stay `상태` / `관계` / … .
   */
  propertyDisplayNames: PropertyDisplayNames;
  /**
   * Chip filter. `"all"` or an option id of the active axis.
   * Remembered after user changes it. (Migrated from `statusFilter`.)
   */
  chipFilter: ChipFilter;
  /** Where web-share HTML is uploaded. Prefer hosted when share-host is deployed. */
  webShareHost: WebShareHostMode;
  /** Cloudflare Worker origin, e.g. https://charinfo-share-host.xxx.workers.dev */
  webShareHostedBaseUrl: string;
  /** Optional Bearer key matching Worker secret UPLOAD_KEY. */
  webShareHostedUploadKey: string;
  /** Default TTL for hosted shares. */
  webShareHostedTtl: HostedShareTtl;
  /**
   * Which note H2 headers (+ 「속성」) appear in the public side panel.
   * Card preview always follows Obsidian eye toggles.
   */
  webSharePanelHeaders: string[];
  /** When 「속성」 is included: eyes vs all frontmatter fields. */
  webSharePanelProps: WebSharePanelPropsMode;
  /** GitHub PAT (repo contents:write). Stored in plugin data — treat as secret. */
  webShareGithubToken: string;
  /** `owner/repo` that has GitHub Pages enabled. */
  webShareGithubRepo: string;
  /** Branch Pages builds from (often `main` with /docs, or `gh-pages`). */
  webShareGithubBranch: string;
  /** File path in repo, e.g. `docs/index.html`. Legacy; slug mode uses docs/{slug}/index.html. */
  webShareGithubPath: string;
  /** Last / default link name (slug) chosen when publishing. */
  webShareLinkSlug: string;
  /** Last successful public gallery URL (for copy / reopen). */
  webShareLastUrl: string;
  /** Last hosted share id (`/g/:id`). */
  webShareLastId: string;
  /** Manage key for update/delete of last hosted share (not the public URL). */
  webShareLastManageKey: string;
  /** ISO timestamp of last successful publish. */
  webShareLastAt: string;
  /**
   * Share HTML format version last published.
   * Mismatch with SHARE_HTML_VERSION → treat lastUrl as stale.
   */
  webShareHtmlVersion: number;
}

export const DEFAULT_SETTINGS: CharinfoSettings = {
  libraryFolder: "Character Archive",
  mediaRootMode: "vault",
  imageUploadDestination: "vault",
  vaultMediaFolder: "Character Archive",
  externalMediaPath: "",
  characterTemplatePath: "",
  characterTemplateByGenre: {},
  defaultEditMode: false,
  sortMode: "manual",
  activeGenre: "예시",
  groupOrderByGenre: {
    예시: ["예시"],
  },
  groupOrderByLibrary: {},
  galleryPageState: {},
  cardProperties: DEFAULT_CARD_PROPERTIES.map((p) => ({ ...p })),
  cardFitImage: false,
  statuses: DEFAULT_STATUSES.map((s) => ({ ...s })),
  defaultStatusId: "Off",
  primaryFilterProperty: "status",
  selectVocab: {
    relation: [...DEFAULT_SELECT_VOCAB.relation],
    bond: [...DEFAULT_SELECT_VOCAB.bond],
    affiliation: [...DEFAULT_SELECT_VOCAB.affiliation],
  },
  tagVocab: [],
  propertyDisplayNames: { ...DEFAULT_PROPERTY_DISPLAY_NAMES },
  chipFilter: "Off",
  webShareHost: "hosted",
  webShareHostedBaseUrl: "",
  webShareHostedUploadKey: "",
  webShareHostedTtl: "30d",
  webSharePanelHeaders: [SHARE_ATTR_HEADER, "프롬프트"],
  webSharePanelProps: "all",
  webShareGithubToken: "",
  webShareGithubRepo: "",
  webShareGithubBranch: "main",
  webShareGithubPath: "docs/index.html",
  webShareLinkSlug: "gallery",
  webShareLastUrl: "",
  webShareLastId: "",
  webShareLastManageKey: "",
  webShareLastAt: "",
  webShareHtmlVersion: 0,
};

function normalizeDefaultStatusId(
  raw: unknown,
  statuses: StatusDef[],
): string {
  if (typeof raw === "string" && statuses.some((s) => s.id === raw.trim())) {
    return raw.trim();
  }
  if (statuses.some((s) => s.id === "Off")) return "Off";
  return statuses[0]?.id ?? "Off";
}

/**
 * Per-archive template overrides. Default entries are seeded for archives the
 * user hasn't mapped yet, so shipped templates apply without re-configuring.
 */
function normalizeTemplateByGenre(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw && typeof raw === "object") {
    for (const [genre, path] of Object.entries(raw as Record<string, unknown>)) {
      const key = genre.trim();
      if (!key || typeof path !== "string" || !path.trim()) continue;
      out[key] = normalizePath(path.trim());
    }
  }
  for (const [genre, path] of Object.entries(
    DEFAULT_SETTINGS.characterTemplateByGenre,
  )) {
    if (!(genre in out)) out[genre] = path;
  }
  return out;
}

function normalizeWebShareHost(raw: unknown): WebShareHostMode {
  if (raw === "github" || raw === "hosted") return raw;
  // Legacy catbox modes → hosted
  return "hosted";
}

function normalizeHostedTtl(raw: unknown): HostedShareTtl {
  if (raw === "7d" || raw === "30d" || raw === "permanent") return raw;
  return "30d";
}

function normalizePanelPropsMode(raw: unknown): WebSharePanelPropsMode {
  if (raw === "all" || raw === "preview") return raw;
  return "preview";
}

function normalizePanelHeaders(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...DEFAULT_SETTINGS.webSharePanelHeaders];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const h = item.trim();
    if (!h || seen.has(h)) continue;
    seen.add(h);
    out.push(h);
  }
  return out.length ? out : [...DEFAULT_SETTINGS.webSharePanelHeaders];
}

function migrateShareContentFlags(raw: Record<string, unknown>): {
  webSharePanelHeaders: string[];
  webSharePanelProps: WebSharePanelPropsMode;
} {
  if ("webSharePanelHeaders" in raw) {
    return {
      webSharePanelHeaders: normalizePanelHeaders(raw.webSharePanelHeaders),
      webSharePanelProps: normalizePanelPropsMode(
        raw.webSharePanelProps ?? "all",
      ),
    };
  }

  const headers: string[] = [SHARE_ATTR_HEADER];
  const includePrompts =
    typeof raw.webShareIncludePrompts === "boolean"
      ? raw.webShareIncludePrompts
      : true;
  const includeNotes =
    typeof raw.webShareIncludeNotes === "boolean"
      ? raw.webShareIncludeNotes
      : raw.webShareContentMode === "full";
  if (includePrompts) headers.push("프롬프트");
  if (includeNotes) headers.push("메모");

  const panelProps =
    raw.webShareContentMode === "full"
      ? "all"
      : normalizePanelPropsMode(raw.webSharePanelProps ?? "preview");

  return {
    webSharePanelHeaders: headers,
    webSharePanelProps: panelProps,
  };
}

/** Merge persisted settings + normalize card property prefs. */
export function migrateSettings(
  raw?: Partial<CharinfoSettings> | null,
): CharinfoSettings {
  const src = (raw ?? {}) as Partial<CharinfoSettings>;
  let activeGenre =
    typeof src.activeGenre === "string" ? src.activeGenre.trim() : "";
  if (!activeGenre) {
    const savedOrder =
      src.groupOrderByGenre && typeof src.groupOrderByGenre === "object"
        ? Object.keys(src.groupOrderByGenre)
        : [];
    const existing = savedOrder
      .map((key) => key.trim())
      .filter((key) => key && key !== "예시");
    activeGenre = existing[0] || DEFAULT_SETTINGS.activeGenre;
  }

  const imageUploadDestination: ImageUploadDestination =
    src.imageUploadDestination === "imgur" ? "imgur" : "vault";

  const groupOrderByGenre = normalizeGroupOrderByGenre(
    src.groupOrderByGenre ?? DEFAULT_SETTINGS.groupOrderByGenre,
  );

  let libraryFolder =
    typeof src.libraryFolder === "string" && src.libraryFolder.trim()
      ? src.libraryFolder.trim()
      : DEFAULT_SETTINGS.libraryFolder;
  if (libraryFolder === "캐릭터 프롬프트") {
    libraryFolder = DEFAULT_SETTINGS.libraryFolder;
  }

  const groupOrderByLibrary = normalizeGroupOrderByLibrary(
    (src as { groupOrderByLibrary?: unknown }).groupOrderByLibrary,
    groupOrderByGenre,
    libraryFolder,
  );

  const statuses = normalizeStatuses(
    (src as { statuses?: unknown }).statuses ?? DEFAULT_SETTINGS.statuses,
  );

  const primaryFilterProperty = normalizePrimaryFilterProperty(
    (src as { primaryFilterProperty?: unknown }).primaryFilterProperty,
  );
  const selectVocab = normalizeSelectVocabMap(
    (src as { selectVocab?: unknown }).selectVocab,
  );
  const tagVocab = normalizeTagVocab((src as { tagVocab?: unknown }).tagVocab);

  // Chip filter is only meaningful against the *active* axis vocabulary.
  const axis = getFilterAxis({
    primaryFilterProperty,
    statuses,
    selectVocab,
    tagVocab,
  });
  const legacy = src as { chipFilter?: unknown; statusFilter?: unknown };
  const chipFilter = normalizeChipFilter(
    legacy.chipFilter ?? legacy.statusFilter ?? DEFAULT_SETTINGS.chipFilter,
    axis.options,
  );

  const defaultGalleryPath = normalizePath(
    `${libraryFolder}/Character Archive.md`,
  );
  let galleryPageState = normalizeGalleryPageState(
    (src as { galleryPageState?: unknown }).galleryPageState,
  );
  if (!galleryPageState[defaultGalleryPath]) {
    galleryPageState = {
      ...galleryPageState,
      [defaultGalleryPath]: {
        activeGenre,
        chipFilter,
        chipFilterProperty: axis.propertyId,
      },
    };
  }

  let vaultMediaFolder =
    typeof src.vaultMediaFolder === "string" && src.vaultMediaFolder.trim()
      ? src.vaultMediaFolder.trim()
      : DEFAULT_SETTINGS.vaultMediaFolder;
  if (vaultMediaFolder === "캐릭터 프롬프트") {
    vaultMediaFolder = DEFAULT_SETTINGS.vaultMediaFolder;
  }

  const merged: CharinfoSettings = {
    ...DEFAULT_SETTINGS,
    ...src,
    activeGenre,
    libraryFolder,
    vaultMediaFolder,
    groupOrderByGenre,
    groupOrderByLibrary,
    galleryPageState,
    imageUploadDestination,
    characterTemplateByGenre: normalizeTemplateByGenre(
      (src as { characterTemplateByGenre?: unknown }).characterTemplateByGenre,
    ),
    cardProperties: normalizeCardProperties(
      src.cardProperties ?? DEFAULT_SETTINGS.cardProperties,
    ),
    cardFitImage: Boolean(src.cardFitImage),
    statuses,
    defaultStatusId: normalizeDefaultStatusId(src.defaultStatusId, statuses),
    primaryFilterProperty,
    selectVocab,
    tagVocab,
    propertyDisplayNames: normalizePropertyDisplayNames(
      (src as { propertyDisplayNames?: unknown }).propertyDisplayNames,
    ),
    chipFilter,
    webShareHost: normalizeWebShareHost(
      src.webShareHost ?? DEFAULT_SETTINGS.webShareHost,
    ),
    webShareHostedBaseUrl:
      typeof src.webShareHostedBaseUrl === "string"
        ? src.webShareHostedBaseUrl.trim().replace(/\/+$/, "")
        : "",
    webShareHostedUploadKey:
      typeof src.webShareHostedUploadKey === "string"
        ? src.webShareHostedUploadKey.trim()
        : "",
    webShareHostedTtl: normalizeHostedTtl(
      src.webShareHostedTtl ?? DEFAULT_SETTINGS.webShareHostedTtl,
    ),
    ...migrateShareContentFlags(src as Record<string, unknown>),
    webShareGithubToken:
      typeof src.webShareGithubToken === "string" ? src.webShareGithubToken : "",
    webShareGithubRepo:
      typeof src.webShareGithubRepo === "string"
        ? src.webShareGithubRepo.trim()
        : "",
    webShareGithubBranch:
      typeof src.webShareGithubBranch === "string" && src.webShareGithubBranch.trim()
        ? src.webShareGithubBranch.trim()
        : DEFAULT_SETTINGS.webShareGithubBranch,
    webShareGithubPath:
      typeof src.webShareGithubPath === "string" && src.webShareGithubPath.trim()
        ? src.webShareGithubPath.trim().replace(/^\/+/, "")
        : DEFAULT_SETTINGS.webShareGithubPath,
    webShareLinkSlug:
      typeof src.webShareLinkSlug === "string" && src.webShareLinkSlug.trim()
        ? src.webShareLinkSlug.trim()
        : DEFAULT_SETTINGS.webShareLinkSlug,
    webShareLastUrl:
      typeof src.webShareLastUrl === "string" ? src.webShareLastUrl.trim() : "",
    webShareLastId:
      typeof src.webShareLastId === "string" ? src.webShareLastId.trim() : "",
    webShareLastManageKey:
      typeof src.webShareLastManageKey === "string"
        ? src.webShareLastManageKey.trim()
        : "",
    webShareLastAt:
      typeof src.webShareLastAt === "string" ? src.webShareLastAt.trim() : "",
    webShareHtmlVersion:
      typeof src.webShareHtmlVersion === "number" &&
      Number.isFinite(src.webShareHtmlVersion)
        ? Math.max(0, Math.floor(src.webShareHtmlVersion))
        : 0,
  };

  // Migrate-and-drop: `chipFilter` is the single source of truth from here on.
  delete (merged as unknown as Record<string, unknown>).statusFilter;
  return merged;
}

function normalizeGroupOrderByGenre(
  raw: unknown,
): Record<string, string[]> {
  if (!raw || typeof raw !== "object" || Object.keys(raw).length === 0) {
    return { ...DEFAULT_SETTINGS.groupOrderByGenre };
  }
  const base: Record<string, string[]> = {};
  for (const [genre, list] of Object.entries(raw as Record<string, unknown>)) {
    const key = genre.trim();
    if (!key || !Array.isArray(list)) continue;
    const names = list
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter(Boolean)
      .map((n) => {
        if (n === "Guide") return "가이드";
        if (n === "Sentinel") return "센티넬";
        return n;
      });
    // Dedupe, keep order
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const n of names) {
      if (seen.has(n)) continue;
      seen.add(n);
      unique.push(n);
    }
    base[key] = unique;
  }
  return base;
}

function normalizeGenreOrderMap(raw: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [genre, list] of Object.entries(raw as Record<string, unknown>)) {
    const key = genre.trim();
    if (!key || !Array.isArray(list)) continue;
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const item of list) {
      if (typeof item !== "string") continue;
      const n = item.trim();
      if (!n || seen.has(n)) continue;
      seen.add(n);
      unique.push(n);
    }
    out[key] = unique;
  }
  return out;
}

function normalizeGroupOrderByLibrary(
  raw: unknown,
  legacyByGenre: Record<string, string[]>,
  defaultLibrary: string,
): Record<string, Record<string, string[]>> {
  const out: Record<string, Record<string, string[]>> = {};
  if (raw && typeof raw === "object") {
    for (const [lib, genres] of Object.entries(
      raw as Record<string, unknown>,
    )) {
      const libKey = normalizePath(lib.trim());
      if (!libKey) continue;
      const map = normalizeGenreOrderMap(genres);
      if (Object.keys(map).length) out[libKey] = map;
    }
  }
  const def = normalizePath(defaultLibrary);
  if (!out[def] || Object.keys(out[def]).length === 0) {
    out[def] = { ...legacyByGenre };
  }
  return out;
}

function normalizeGalleryPageState(
  raw: unknown,
): Record<string, GalleryPageState> {
  const out: Record<string, GalleryPageState> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [path, state] of Object.entries(raw as Record<string, unknown>)) {
    const key = normalizePath(path.trim());
    if (!key || !state || typeof state !== "object") continue;
    const s = state as {
      activeGenre?: unknown;
      chipFilter?: unknown;
      chipFilterProperty?: unknown;
      statusFilter?: unknown;
    };
    const next: GalleryPageState = {};
    if (typeof s.activeGenre === "string" && s.activeGenre.trim()) {
      next.activeGenre = s.activeGenre.trim();
    }
    const chip =
      typeof s.chipFilter === "string" && s.chipFilter.trim()
        ? s.chipFilter.trim()
        : typeof s.statusFilter === "string" && s.statusFilter.trim()
          ? s.statusFilter.trim()
          : "";
    if (chip) {
      next.chipFilter = chip;
      // Legacy page states only ever held status values.
      next.chipFilterProperty =
        typeof s.chipFilterProperty === "string" && s.chipFilterProperty.trim()
          ? s.chipFilterProperty.trim()
          : "status";
    }
    if (next.activeGenre || next.chipFilter) out[key] = next;
  }
  return out;
}

/**
 * Forget every remembered chip value (global + per page).
 * Used when the primary axis changes — old values belong to another vocabulary.
 */
export function resetChipFilters(settings: CharinfoSettings): void {
  settings.chipFilter = "all";
  const next: Record<string, GalleryPageState> = {};
  for (const [path, state] of Object.entries(settings.galleryPageState)) {
    const { chipFilter: _chip, chipFilterProperty: _prop, ...rest } = state;
    next[path] = rest;
  }
  settings.galleryPageState = next;
}

/** Clear remembered chip values pointing at a deleted option of one axis. */
export function forgetChipFilterOption(
  settings: CharinfoSettings,
  propertyId: string,
  optionId: string,
): void {
  if (settings.primaryFilterProperty === propertyId) {
    if (settings.chipFilter === optionId) settings.chipFilter = "all";
  }
  const next: Record<string, GalleryPageState> = {};
  for (const [path, state] of Object.entries(settings.galleryPageState)) {
    if (
      state.chipFilter === optionId &&
      (state.chipFilterProperty ?? "status") === propertyId
    ) {
      const { chipFilter: _chip, chipFilterProperty: _prop, ...rest } = state;
      next[path] = rest;
      continue;
    }
    next[path] = state;
  }
  settings.galleryPageState = next;
}

/** Read group order for a library + archive. */
export function getGroupOrderFor(
  settings: CharinfoSettings,
  library: string,
  genre: string,
): string[] {
  const lib = normalizePath(library);
  const g = genre.trim();
  return (
    settings.groupOrderByLibrary[lib]?.[g] ??
    settings.groupOrderByGenre[g] ??
    []
  );
}

/** Persist group order for a library + archive. */
export function setGroupOrderFor(
  settings: CharinfoSettings,
  library: string,
  genre: string,
  order: string[],
): void {
  const lib = normalizePath(library);
  const g = genre.trim();
  if (!g) return;
  const byLib = { ...(settings.groupOrderByLibrary[lib] ?? {}) };
  byLib[g] = [...order];
  settings.groupOrderByLibrary = {
    ...settings.groupOrderByLibrary,
    [lib]: byLib,
  };
  // Keep legacy mirror for default library.
  if (lib === normalizePath(settings.libraryFolder)) {
    settings.groupOrderByGenre = {
      ...settings.groupOrderByGenre,
      [g]: [...order],
    };
  }
}

export function getGalleryPageState(
  settings: CharinfoSettings,
  pagePath: string,
): GalleryPageState {
  const key = normalizePath(pagePath);
  return settings.galleryPageState[key] ?? {};
}

export function patchGalleryPageState(
  settings: CharinfoSettings,
  pagePath: string,
  patch: GalleryPageState,
): void {
  const key = normalizePath(pagePath);
  settings.galleryPageState = {
    ...settings.galleryPageState,
    [key]: {
      ...settings.galleryPageState[key],
      ...patch,
    },
  };
}

/** Drop remembered UI when a gallery note is removed. */
export function forgetGalleryPageState(
  settings: CharinfoSettings,
  pagePath: string,
): void {
  const key = normalizePath(pagePath);
  if (!settings.galleryPageState[key]) return;
  const { [key]: _drop, ...rest } = settings.galleryPageState;
  settings.galleryPageState = rest;
}

/** Move remembered UI when a gallery note is renamed/moved. */
export function remapGalleryPageState(
  settings: CharinfoSettings,
  fromPath: string,
  toPath: string,
): void {
  const from = normalizePath(fromPath);
  const to = normalizePath(toPath);
  if (from === to) return;
  const prev = settings.galleryPageState[from];
  if (!prev) return;
  const { [from]: _drop, ...rest } = settings.galleryPageState;
  settings.galleryPageState = {
    ...rest,
    [to]: {
      ...prev,
      ...rest[to],
    },
  };
}

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
import {
  normalizeCardFieldOrder,
  normalizeCardFieldVisibility,
  normalizeFieldKeyLedgers,
  normalizeGroupKey,
  normalizeGroupSchemas,
  seedBuiltinVisibility,
  type CardFieldOrder,
  type CardFieldVisibility,
  type FieldKeyLedger,
  type GroupSchemaRecord,
} from "./data/groupSchema";
import { renameGroupOrderList } from "./data/groupRename";
import {
  decodeRouteOrder,
  encodeGroupRoute,
  encodeRouteOrder,
} from "./data/order";
import {
  characterWebShareStatePath,
  remapWebShareRecord,
} from "./share/webShareState";
import { normalizeSeenUpdateNotesVersion } from "./data/updateNotes";
import {
  normalizeLastOpenedGalleryPath,
  remapLastOpenedGalleryPath,
} from "./ui/libraryFolderOpen";
import { normalizeSchemaScanCache, type SchemaScanCache } from "./data/schemaScanCache";

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
  GroupSchemaRecord,
  FieldKeyLedger,
  CardFieldVisibility,
  CardFieldOrder,
};
export {
  TAG_FRONTMATTER_KEY,
  parseTagIds,
  tagAxisOptions,
} from "./data/tags";
export {
  DEFAULT_STATUSES,
  STATUS_COLOR_CLASSES,
  STATUS_COLOR_TOKENS,
  STATUS_CUSTOM_COLOR_CLASS,
  STATUS_CUSTOM_COLOR_VAR,
  isCustomStatusColor,
  isStatusColorPreset,
  normalizeStatusColor,
  paintStatusColor,
  resolveStatus,
  statusColorClass,
  suggestStatusId,
  adoptUnknownStatuses,
  guessStatusColor,
  type StatusColorPreset,
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

/** Public Character Archive share host — baked in so fresh vaults can make links. */
export const DEFAULT_WEB_SHARE_HOSTED_BASE_URL =
  "https://character-archive.pages.dev";
export type HostedShareTtl = "7d" | "30d" | "permanent";
/**
 * @deprecated The side panel publishes every active field either way.
 * `"preview"` is still accepted from stored settings and behaves as `"all"`:
 * card eyes are a card-preview rule and never narrow the panel. The card strip
 * keeps following the scoped eyes in `cardFieldVisibility`.
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

/**
 * Last public share published from one gallery page or character note.
 * `id` + `manageKey` are what make a link updatable/stoppable, so they must
 * never be shared across pages.
 */
export interface WebShareLastState {
  /** Explicit image-sharing choice from the last successful publish. */
  includeNoteImages?: boolean;
  /** Public URL (hosted `/g/:id` or the Pages URL). */
  url: string;
  /** Hosted share id (`/g/:id`). Empty for GitHub Pages shares. */
  id: string;
  /** Manage key for update/delete (never part of the public URL). */
  manageKey: string;
  /** ISO timestamp of the publish. */
  at: string;
  /** Share HTML format version this page was published with. */
  htmlVersion: number;
}

export interface CharinfoSettings {
  /** Successful per-note schema passes; lets routine app starts skip unchanged notes. */
  schemaScanCache: SchemaScanCache;
  /** Latest bundled update note successfully opened, or silently seeded on install. */
  lastOpenedUpdateNotesVersion: string;
  /** Last gallery note the user actually opened. Empty = fall back to libraryFolder. */
  lastOpenedGalleryPath: string;
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
   * Legacy card-preview property prefs (eye toggles + old order).
   * Migration seed only: it supplies the built-in **order** of a group's lazy
   * baseline, and `seedBuiltinVisibility` copies its eyes into scoped rows once.
   * Nothing reads it live — 보기 both reads and writes `cardFieldVisibility`.
   */
  cardProperties: CardPropertyPref[];
  /**
   * Per `(library, archive, group)` field schema — what Book decides.
   * Array store on purpose: group names are user strings, never object keys.
   */
  groupSchemas: GroupSchemaRecord[];
  /**
   * Every custom YAML key ever allocated per `(library, archive)`.
   * A removed field's key stays here so it can never be handed out twice.
   */
  fieldKeyLedgers: FieldKeyLedger[];
  /**
   * Card eye state per `(gallery page, archive, field id)`. No order.
   * Missing row → `name`/`status` on, other built-ins off, custom on.
   */
  cardFieldVisibility: CardFieldVisibility[];
  /**
   * Legacy per-page order retained for settings compatibility. Current cards,
   * peek, and public share use the active group schema order; the UI neither
   * reads nor writes this collection.
   */
  cardFieldOrder: CardFieldOrder[];
  /**
   * Notion Fit image: true = contain whole image; false = cover crop.
   */
  cardFitImage: boolean;
  /**
   * Status vocabulary for `상태` (filter chips + card pills).
   * Color is a preset token or one canonical `#RRGGBB` the user picked; every
   * stored value passes `normalizeStatusColor` on load.
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
   * The card strip follows the scoped card eyes; the panel does not.
   */
  webSharePanelHeaders: string[];
  /**
   * Legacy toggle. Kept for stored-settings compatibility — the 「속성」 panel
   * always publishes this card's group's active fields.
   */
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
  /**
   * Last published link per gallery-note key or character-note key. Update /
   * stop must read *this* record; the global `webShareLast*` fields above are
   * legacy read-only fallback (display) so one share can never manage another.
   */
  webShareByPage: Record<string, WebShareLastState>;
}

export const DEFAULT_SETTINGS: CharinfoSettings = {
  schemaScanCache: { signature: "", files: {} },
  lastOpenedUpdateNotesVersion: "",
  lastOpenedGalleryPath: "",
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
  groupSchemas: [],
  fieldKeyLedgers: [],
  cardFieldVisibility: [],
  cardFieldOrder: [],
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
  webShareHostedBaseUrl: DEFAULT_WEB_SHARE_HOSTED_BASE_URL,
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
  webShareByPage: {},
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

function normalizeWebShareState(raw: unknown): WebShareLastState | null {
  if (!raw || typeof raw !== "object") return null;
  const src = raw as Record<string, unknown>;
  const text = (value: unknown): string =>
    typeof value === "string" ? value.trim() : "";
  const state: WebShareLastState = {
    includeNoteImages: src.includeNoteImages === true,
    url: text(src.url),
    id: text(src.id),
    manageKey: text(src.manageKey),
    at: text(src.at),
    htmlVersion:
      typeof src.htmlVersion === "number" && Number.isFinite(src.htmlVersion)
        ? Math.max(0, Math.floor(src.htmlVersion))
        : 0,
  };
  // Nothing to reopen or manage — drop the row instead of keeping a stub.
  if (!state.url && !state.id) return null;
  return state;
}

function normalizeWebShareByPage(
  raw: unknown,
): Record<string, WebShareLastState> {
  const out: Record<string, WebShareLastState> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [path, value] of Object.entries(raw as Record<string, unknown>)) {
    const key = normalizePath(path.trim());
    if (!key) continue;
    const state = normalizeWebShareState(value);
    if (state) out[key] = state;
  }
  return out;
}

/**
 * One-shot adoption of legacy global hosted credentials by the default gallery
 * page — only when the vault census shows that page is the *only* gallery note.
 * Call from plugin load with real paths (settings alone cannot see the vault).
 * Returns true when credentials were moved (caller should save).
 */
export function claimLegacyWebShareIfUnambiguous(
  settings: CharinfoSettings,
  galleryPagePaths: string[],
  defaultPagePath: string,
): boolean {
  const id = settings.webShareLastId.trim();
  const manageKey = settings.webShareLastManageKey.trim();
  if (!id || !manageKey) return false;
  const def = normalizePath(defaultPagePath);
  if (settings.webShareByPage[def]) return false;
  const unique = [
    ...new Set(galleryPagePaths.map((p) => normalizePath(p)).filter(Boolean)),
  ];
  if (unique.length !== 1 || unique[0] !== def) return false;

  settings.webShareByPage = {
    ...settings.webShareByPage,
    [def]: {
      url: settings.webShareLastUrl.trim(),
      id,
      manageKey,
      at: settings.webShareLastAt.trim(),
      htmlVersion: settings.webShareHtmlVersion,
    },
  };
  // Moved, not copied — the page record now owns the management credential.
  // Keep URL/at only as a compatibility mirror; never use it for ownership.
  settings.webShareLastId = "";
  settings.webShareLastManageKey = "";
  return true;
}

function normalizeWebShareHost(raw: unknown): WebShareHostMode {
  if (raw === "github" || raw === "hosted") return raw;
  // Legacy catbox modes → hosted
  return "hosted";
}

/** Empty / missing → public default host; custom URL kept. */
export function normalizeWebShareHostedBaseUrl(raw: unknown): string {
  if (typeof raw !== "string") return DEFAULT_WEB_SHARE_HOSTED_BASE_URL;
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return DEFAULT_WEB_SHARE_HOSTED_BASE_URL;
  return trimmed;
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
  // Legacy storage label → current archive name
  if (activeGenre === "가이드버스" || activeGenre === "가이드 버스") {
    activeGenre = "Fearless";
  }
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

  // `cardProperties` stays as the migration seed; it is never wiped, and no
  // group schema is created eagerly here — an unseen group lazily takes this
  // normalized order as its baseline the first time it is resolved. Its eyes
  // reach the live surfaces only through the `seedBuiltinVisibility` rows below.
  const cardProperties = normalizeCardProperties(
    src.cardProperties ?? DEFAULT_SETTINGS.cardProperties,
  );
  const visibilityPairs = Object.entries(galleryPageState)
    .map(([page, state]) => ({
      page,
      archive: state.activeGenre?.trim() || activeGenre,
    }))
    .filter((pair) => Boolean(pair.page));
  const cardFieldVisibility = seedBuiltinVisibility(
    normalizeCardFieldVisibility(
      (src as { cardFieldVisibility?: unknown }).cardFieldVisibility,
    ),
    visibilityPairs,
    cardProperties,
  );

  const merged: CharinfoSettings = {
    ...DEFAULT_SETTINGS,
    ...src,
    schemaScanCache: normalizeSchemaScanCache(
      (src as { schemaScanCache?: unknown }).schemaScanCache,
    ),
    lastOpenedUpdateNotesVersion: normalizeSeenUpdateNotesVersion(
      src.lastOpenedUpdateNotesVersion,
    ),
    lastOpenedGalleryPath: normalizeLastOpenedGalleryPath(
      src.lastOpenedGalleryPath,
    ),
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
    cardProperties,
    groupSchemas: normalizeGroupSchemas(
      (src as { groupSchemas?: unknown }).groupSchemas,
    ),
    fieldKeyLedgers: normalizeFieldKeyLedgers(
      (src as { fieldKeyLedgers?: unknown }).fieldKeyLedgers,
    ),
    cardFieldVisibility,
    // No seeding: an absent order row *is* the baseline order, so writing one
    // here would only freeze today's built-in list into storage.
    cardFieldOrder: normalizeCardFieldOrder(
      (src as { cardFieldOrder?: unknown }).cardFieldOrder,
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
    webShareHostedBaseUrl: normalizeWebShareHostedBaseUrl(
      src.webShareHostedBaseUrl,
    ),
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
    webShareByPage: normalizeWebShareByPage(
      (src as { webShareByPage?: unknown }).webShareByPage,
    ),
  };

  // Legacy hosted credentials are claimed in plugin onload with a vault census
  // (`claimLegacyWebShareIfUnambiguous`) — settings alone cannot see gallery notes.

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

/**
 * The default-route sentinel and its codec live in `data/order.ts` — the token
 * exists only for the stored order, and that module has no run-time imports, so
 * one focused test can freeze both the codec and the ranking that reads it.
 * Re-exported here because storage callers reach for the settings surface.
 */
export {
  DEFAULT_ROUTE_TOKEN,
  decodeGroupRoute,
  encodeGroupRoute,
} from "./data/order";

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

/**
 * Read the canonical route order: the stored list, decoded, so the default
 * route reads as `""` instead of its storage token.
 */
export function getGroupRouteOrderFor(
  settings: CharinfoSettings,
  library: string,
  genre: string,
): string[] {
  return decodeRouteOrder(getGroupOrderFor(settings, library, genre));
}

/** Persist the canonical route order. `""` is written as the reserved token. */
export function setGroupRouteOrderFor(
  settings: CharinfoSettings,
  library: string,
  genre: string,
  routes: readonly string[],
): void {
  setGroupOrderFor(settings, library, genre, encodeRouteOrder(routes));
}

/**
 * Replace one route in place without changing any other rank. `from` may be
 * `""` — renaming the default route keeps the slot the user dragged it to,
 * because the token and the new name occupy the same index.
 *
 * A route with no stored rank keeps none: unranked already means "after
 * everything ranked", which is exactly where the renamed route belongs.
 */
export function renameGroupRouteInOrder(
  settings: CharinfoSettings,
  library: string,
  genre: string,
  from: string,
  to: string,
): void {
  const source = encodeGroupRoute(from);
  const target = normalizeGroupKey(to);
  if (!target || source === target) return;
  const current = getGroupOrderFor(settings, library, genre);
  if (!current.some((name) => normalizeGroupKey(name) === source)) return;
  const next = renameGroupOrderList(current, source, target);
  setGroupOrderFor(settings, library, genre, next);
}

/**
 * Drop one route from the archive's section order (both the live
 * library-scoped map and the legacy per-archive mirror).
 *
 * Part of the group-deletion commit: the schema record and this entry have to
 * disappear together, or a deleted group would keep a rank and reappear as an
 * empty section the moment 편집 모드 lists persisted groups again. `group` may
 * be `""` — the default route's rank is stored under its token, and dropping
 * that rank returns 기본 to the canonical end.
 */
export function removeGroupFromOrder(
  settings: CharinfoSettings,
  library: string,
  genre: string,
  group: string,
): void {
  const target = encodeGroupRoute(group);
  const lib = normalizePath(library);
  const g = genre.trim();
  const drop = (list: string[] | undefined): string[] | null => {
    if (!list) return null;
    const next = list.filter((name) => normalizeGroupKey(name) !== target);
    return next.length === list.length ? null : next;
  };

  const byLib = settings.groupOrderByLibrary[lib];
  const nextLib = drop(byLib?.[g]);
  if (byLib && nextLib) {
    settings.groupOrderByLibrary = {
      ...settings.groupOrderByLibrary,
      [lib]: { ...byLib, [g]: nextLib },
    };
  }
  const nextLegacy = drop(settings.groupOrderByGenre[g]);
  if (nextLegacy) {
    settings.groupOrderByGenre = {
      ...settings.groupOrderByGenre,
      [g]: nextLegacy,
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
  if (settings.galleryPageState[key]) {
    const { [key]: _drop, ...rest } = settings.galleryPageState;
    settings.galleryPageState = rest;
  }
  // Keep any hosted-share credential. The public object survives local note
  // deletion, so dropping its key here would make early unpublish impossible.
}

/** Move remembered UI when a gallery note is renamed/moved. */
export function remapGalleryPageState(
  settings: CharinfoSettings,
  fromPath: string,
  toPath: string,
): boolean {
  const from = normalizePath(fromPath);
  const to = normalizePath(toPath);
  if (from === to) return false;
  let changed = false;
  const prev = settings.galleryPageState[from];
  if (prev) {
    const { [from]: _drop, ...rest } = settings.galleryPageState;
    settings.galleryPageState = {
      ...rest,
      [to]: {
        ...prev,
        ...rest[to],
      },
    };
    changed = true;
  }
  if (remapWebShareByPage(settings, from, to)) changed = true;
  const remappedLast = remapLastOpenedGalleryPath(
    settings.lastOpenedGalleryPath,
    from,
    to,
  );
  if (remappedLast !== settings.lastOpenedGalleryPath) {
    settings.lastOpenedGalleryPath = remappedLast;
    changed = true;
  }
  return changed;
}

/** Keep a published link manageable after its gallery note moves. */
function remapWebShareByPage(
  settings: CharinfoSettings,
  from: string,
  to: string,
): boolean {
  if (!from || !to || from === to) return false;
  const remapped = remapWebShareRecord(settings.webShareByPage, from, to);
  if (!remapped.changed) return false;
  settings.webShareByPage = remapped.records;
  return true;
}

/** Keep a character share manageable after its character note moves. */
export function remapCharacterWebShareState(
  settings: CharinfoSettings,
  fromPath: string,
  toPath: string,
): boolean {
  return remapWebShareByPage(
    settings,
    characterWebShareStatePath(fromPath),
    characterWebShareStatePath(toPath),
  );
}

/** This page's last published link, or null when it never published / cleared. */
export function getWebShareForPage(
  settings: CharinfoSettings,
  pagePath: string,
): WebShareLastState | null {
  return settings.webShareByPage[normalizePath(pagePath)] ?? null;
}

/** Remember a publish result for one gallery page. */
export function setWebShareForPage(
  settings: CharinfoSettings,
  pagePath: string,
  state: WebShareLastState,
): void {
  const key = normalizePath(pagePath);
  if (!key) return;
  settings.webShareByPage = {
    ...settings.webShareByPage,
    [key]: { ...state },
  };
}

/** Forget one page's link (share stopped, or credentials no longer usable). */
export function clearWebShareForPage(
  settings: CharinfoSettings,
  pagePath: string,
): void {
  const key = normalizePath(pagePath);
  if (!settings.webShareByPage[key]) return;
  const { [key]: _drop, ...rest } = settings.webShareByPage;
  settings.webShareByPage = rest;
}

import { App, TFile, parseYaml, normalizePath } from "obsidian";
import type { SortMode } from "../settings";
import { sortCharacters } from "./order";
import { parseTagIds } from "./tags";
import { firstRemoteImageEmbed } from "./images";

export interface CharacterRecord {
  file: TFile;
  path: string;
  kind: string;
  이름: string;
  코드네임: string;
  본명: string;
  소속: string;
  장르: string;
  작품: string;
  그룹: string;
  상태: string;
  관계: string;
  인연: string;
  /** Tag ids from FM `태그` (YAML list). Empty when unset. */
  태그: string[];
  cover: string;
  /** CSS object-position percentages, e.g. "50% 40%". */
  coverPosition: string;
  order: number;
  title: string;
}

function asString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(asString).filter(Boolean).join(", ");
  return String(value);
}

function parseCover(raw: string): string {
  const trimmed = raw.trim();
  const wiki = trimmed.match(/^\[\[([^\]]+)\]\]$/);
  if (wiki?.[1]) {
    return wiki[1].split("|")[0]?.trim() ?? "";
  }
  return trimmed;
}

function parseCoverPosition(raw: unknown): string {
  if (typeof raw === "string" && /^\d{1,3}%\s+\d{1,3}%$/.test(raw.trim())) {
    return raw.trim();
  }
  if (raw && typeof raw === "object") {
    const o = raw as { x?: unknown; y?: unknown };
    const x = Number(o.x);
    const y = Number(o.y);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return `${clampPct(x)}% ${clampPct(y)}%`;
    }
  }
  return "50% 50%";
}

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function displayTitle(record: Pick<CharacterRecord, "이름" | "코드네임" | "file">): string {
  return record.이름 || record.코드네임 || record.file.basename;
}

export class CharacterStore {
  constructor(
    private app: App,
    private getLibraryFolder: () => string,
  ) {}

  async listCharacters(
    sortMode: SortMode = "manual",
    libraryFolder?: string,
  ): Promise<CharacterRecord[]> {
    const root = normalizePath(
      (libraryFolder ?? this.getLibraryFolder()).trim(),
    );
    const files = this.app.vault.getMarkdownFiles().filter((file) => {
      if (!root) return true;
      return file.path === root || file.path.startsWith(`${root}/`);
    });

    const records: CharacterRecord[] = [];
    for (const file of files) {
      const record = await this.readCharacter(file);
      if (record) records.push(record);
    }

    return sortCharacters(records, sortMode);
  }

  async readCharacter(file: TFile): Promise<CharacterRecord | null> {
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;
    let data: Record<string, unknown> = fm ? { ...fm } : {};

    if (!fm) {
      const text = await this.app.vault.cachedRead(file);
      const match = text.match(/^---\n([\s\S]*?)\n---/);
      if (!match?.[1]) return null;
      try {
        data = (parseYaml(match[1]) as Record<string, unknown>) ?? {};
      } catch {
        return null;
      }
    }

    const kind = asString(data.kind);
    if (kind !== "character") return null;

    const 이름 = asString(data.이름);
    const 코드네임 = asString(data.코드네임);
    const orderRaw = data.order ?? data.charinfo_order;
    const order = typeof orderRaw === "number" ? orderRaw : Number(orderRaw) || 0;

    let cover = parseCover(asString(data.cover));
    // Empty cover + remote markdown image (`![](https://…)`) → use that URL.
    if (!cover) {
      const text = await this.app.vault.cachedRead(file);
      cover = firstRemoteImageEmbed(text) ?? "";
    }

    const partial = {
      file,
      이름,
      코드네임,
    };

    return {
      file,
      path: file.path,
      kind,
      이름,
      코드네임,
      본명: asString(data.본명),
      소속: asString(data.소속),
      장르: asString(data.장르) || "미분류",
      작품: asString(data.작품),
      그룹: asString(data.그룹),
      상태: asString(data.상태) || asString(data.언급) || "Off",
      관계: asString(data.관계),
      인연: asString(data.인연),
      태그: parseTagIds(data.태그),
      cover,
      coverPosition: parseCoverPosition(data.coverPosition ?? data.cover_position),
      order,
      title: displayTitle(partial),
    };
  }

  groupByGenre(records: CharacterRecord[]): Map<string, CharacterRecord[]> {
    const map = new Map<string, CharacterRecord[]>();
    for (const record of records) {
      const list = map.get(record.장르) ?? [];
      list.push(record);
      map.set(record.장르, list);
    }
    return map;
  }

  groupByGroup(
    records: CharacterRecord[],
    preferredOrder: string[] = [],
  ): Map<string, CharacterRecord[]> {
    const map = new Map<string, CharacterRecord[]>();
    for (const record of records) {
      // Empty 그룹 stays "" — gallery shows no section title for those.
      const key = record.그룹.trim();
      const list = map.get(key) ?? [];
      list.push(record);
      map.set(key, list);
    }

    const rank = new Map<string, number>();
    preferredOrder.forEach((name, i) => {
      const n = name.trim();
      if (n && !rank.has(n)) rank.set(n, i);
    });

    return new Map(
      [...map.entries()].sort(([a], [b]) => {
        if (!a && b) return 1;
        if (a && !b) return -1;
        const ra = rank.has(a) ? rank.get(a)! : Number.MAX_SAFE_INTEGER;
        const rb = rank.has(b) ? rank.get(b)! : Number.MAX_SAFE_INTEGER;
        if (ra !== rb) return ra - rb;
        return a.localeCompare(b, "ko");
      }),
    );
  }

  listGenres(records: CharacterRecord[]): string[] {
    const set = new Set<string>();
    for (const record of records) {
      if (record.장르) set.add(record.장르);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "ko"));
  }
}

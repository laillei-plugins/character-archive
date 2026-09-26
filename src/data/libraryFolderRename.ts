export type LibraryFolderSettings = {
  libraryFolder: string;
  vaultMediaFolder: string;
  characterTemplatePath: string;
  characterTemplateByGenre: Record<string, string>;
  lastOpenedGalleryPath: string;
  groupOrderByLibrary: Record<string, Record<string, string[]>>;
  galleryPageState: Record<string, unknown>;
  webShareByPage: Record<string, unknown>;
  groupSchemas: Array<{ library: string }>;
  fieldKeyLedgers: Array<{ library: string }>;
  cardFieldVisibility: Array<{ page: string }>;
  cardFieldOrder: Array<{ page: string }>;
};

export function normalizeFolderPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function libraryAffectedByFolderRename(
  identity: string,
  oldFolder: string,
): boolean {
  const id = normalizeFolderPath(identity);
  const old = normalizeFolderPath(oldFolder);
  if (!id || !old) return false;
  return id === old || id.startsWith(`${old}/`);
}

export function remapFolderPrefix(
  path: string,
  oldFolder: string,
  newFolder: string,
): string {
  const value = normalizeFolderPath(path);
  const from = normalizeFolderPath(oldFolder);
  const to = normalizeFolderPath(newFolder);
  if (!value || !from || from === to) return path;
  if (value === from) return to;
  if (value.startsWith(`${from}/`)) return `${to}${value.slice(from.length)}`;
  return path;
}

export function remapPrefixedStoragePath(
  key: string,
  oldFolder: string,
  newFolder: string,
): string {
  const character = "@character/";
  if (key.startsWith(character)) {
    return (
      character +
      remapFolderPrefix(key.slice(character.length), oldFolder, newFolder)
    );
  }
  return remapFolderPrefix(key, oldFolder, newFolder);
}

export function remapLibraryIdentities(
  identities: string[],
  oldFolder: string,
  newFolder: string,
): Array<{ from: string; to: string }> {
  return identities
    .filter((identity) => libraryAffectedByFolderRename(identity, oldFolder))
    .map((from) => ({
      from: normalizeFolderPath(from),
      to: remapFolderPrefix(from, oldFolder, newFolder),
    }))
    .filter((pair) => pair.from !== pair.to);
}

export function shouldRewriteGalleryLibrary(
  explicitLibrary: string | null | undefined,
  oldIdentity: string,
): boolean {
  if (!explicitLibrary?.trim()) return false;
  return (
    normalizeFolderPath(explicitLibrary) === normalizeFolderPath(oldIdentity)
  );
}

export function rewriteImageWikiLibraryPrefix(
  markdown: string,
  fromPrefix: string,
  toPrefix: string,
): string {
  const from = normalizeFolderPath(fromPrefix);
  const to = normalizeFolderPath(toPrefix);
  if (!from || !to || from === to) return markdown;
  // Fenced code blocks hold literal text (e.g. NAI prompts), not real embeds.
  const lines = markdown.split("\n");
  let inFence = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) {
      lines[i] = line.split(`![[${from}/`).join(`![[${to}/`);
    }
  }
  return lines.join("\n");
}

export function planMirroredFolderNoteRename(input: {
  newFolder: string;
  oldFolderName: string;
  occupiedPaths: string[];
}): { from: string; to: string } | null {
  const folder = normalizeFolderPath(input.newFolder);
  const newBase = folder.split("/").pop() || "";
  const oldBase = input.oldFolderName.replace(/\/+$/, "");
  if (!folder || !oldBase || !newBase || oldBase === newBase) return null;
  const from = `${folder}/${oldBase}.md`;
  const to = `${folder}/${newBase}.md`;
  const occupied = new Set(input.occupiedPaths.map(normalizeFolderPath));
  if (occupied.has(normalizeFolderPath(to))) return null;
  return { from, to };
}

function remapKeyedRecord<T>(
  record: Record<string, T>,
  oldFolder: string,
  newFolder: string,
): Record<string, T> {
  const next: Record<string, T> = {};
  for (const [key, value] of Object.entries(record)) {
    let target = remapPrefixedStoragePath(key, oldFolder, newFolder);
    // A record already stored at the target (e.g. a retained web-share
    // credential) must never be discarded — keep the old key on collision.
    if (target !== key && Object.prototype.hasOwnProperty.call(record, target)) {
      target = key;
    }
    next[target] = value;
  }
  return next;
}

/** Idempotent settings remaps for one explorer library-folder rename. */
export function remapLibraryFolderSettings(
  settings: LibraryFolderSettings,
  oldFolder: string,
  newFolder: string,
  folderNote?: { from: string; to: string } | null,
): boolean {
  const from = normalizeFolderPath(oldFolder);
  const to = normalizeFolderPath(newFolder);
  if (!from || !to || from === to) return false;
  let changed = false;

  const applyPath = (value: string): string => {
    let next = remapFolderPrefix(value, from, to);
    if (folderNote && normalizeFolderPath(next) === normalizeFolderPath(folderNote.from)) {
      next = folderNote.to;
    }
    return next;
  };

  if (libraryAffectedByFolderRename(settings.libraryFolder, from)) {
    const next = applyPath(settings.libraryFolder);
    if (next !== settings.libraryFolder) {
      settings.libraryFolder = next;
      changed = true;
    }
  }
  if (libraryAffectedByFolderRename(settings.vaultMediaFolder, from)) {
    const next = applyPath(settings.vaultMediaFolder);
    if (next !== settings.vaultMediaFolder) {
      settings.vaultMediaFolder = next;
      changed = true;
    }
  }
  if (settings.characterTemplatePath) {
    const next = applyPath(settings.characterTemplatePath);
    if (next !== settings.characterTemplatePath) {
      settings.characterTemplatePath = next;
      changed = true;
    }
  }
  const templates: Record<string, string> = {};
  let templatesChanged = false;
  for (const [key, value] of Object.entries(settings.characterTemplateByGenre)) {
    const next = applyPath(value);
    templates[key] = next;
    if (next !== value) templatesChanged = true;
  }
  if (templatesChanged) {
    settings.characterTemplateByGenre = templates;
    changed = true;
  }

  const nextOrder = remapKeyedRecord(settings.groupOrderByLibrary, from, to);
  if (JSON.stringify(nextOrder) !== JSON.stringify(settings.groupOrderByLibrary)) {
    settings.groupOrderByLibrary = nextOrder;
    changed = true;
  }

  const nextPages = remapKeyedRecord(settings.galleryPageState, from, to);
  if (JSON.stringify(nextPages) !== JSON.stringify(settings.galleryPageState)) {
    settings.galleryPageState = nextPages;
    changed = true;
  }

  const nextShare = remapKeyedRecord(settings.webShareByPage, from, to);
  if (JSON.stringify(nextShare) !== JSON.stringify(settings.webShareByPage)) {
    settings.webShareByPage = nextShare;
    changed = true;
  }

  if (settings.lastOpenedGalleryPath) {
    const next = applyPath(settings.lastOpenedGalleryPath);
    if (next !== settings.lastOpenedGalleryPath) {
      settings.lastOpenedGalleryPath = next;
      changed = true;
    }
  }

  for (const record of settings.groupSchemas) {
    const next = applyPath(record.library);
    if (next !== record.library) {
      record.library = next;
      changed = true;
    }
  }
  for (const ledger of settings.fieldKeyLedgers) {
    const next = applyPath(ledger.library);
    if (next !== ledger.library) {
      ledger.library = next;
      changed = true;
    }
  }
  for (const row of settings.cardFieldVisibility) {
    const next = applyPath(row.page);
    if (next !== row.page) {
      row.page = next;
      changed = true;
    }
  }
  for (const row of settings.cardFieldOrder) {
    const next = applyPath(row.page);
    if (next !== row.page) {
      row.page = next;
      changed = true;
    }
  }
  return changed;
}

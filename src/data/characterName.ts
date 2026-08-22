/**
 * Character identity rules shared by the creation dialog and the vault writer.
 * This module deliberately imports nothing from Obsidian so Node tests can run
 * the real validation and collision logic.
 */

export type CharacterNameProblem =
  | "empty"
  | "dot"
  | "extension"
  | "invalid-character"
  | "trailing"
  | "reserved"
  | "too-long"
  | "collision";

const RESERVED_DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const INVALID_FILENAME_CHARACTER = /[<>:"/\\|?*\u0000-\u001f\u007f]/;

export function normalizeCharacterName(raw: unknown): string {
  return String(raw ?? "").trim();
}

export function characterNameProblem(raw: unknown): CharacterNameProblem | null {
  const name = normalizeCharacterName(raw);
  if (!name) return "empty";
  if (name === "." || name === "..") return "dot";
  if (/\.md$/i.test(name)) return "extension";
  if (INVALID_FILENAME_CHARACTER.test(name)) return "invalid-character";
  if (/[. ]$/.test(name)) return "trailing";
  if (RESERVED_DEVICE_NAME.test(name)) return "reserved";
  // Keep room for the `.md` suffix under the portable 255-byte component cap.
  if (new TextEncoder().encode(`${name}.md`).length > 255) return "too-long";
  return null;
}

export function characterNameProblemMessage(problem: CharacterNameProblem): string {
  switch (problem) {
    case "empty":
      return "이름을 입력해 주세요.";
    case "dot":
      return "이 이름은 파일 이름으로 쓸 수 없어요.";
    case "extension":
      return "이름에는 .md를 붙이지 마세요.";
    case "invalid-character":
      return "파일 이름에 쓸 수 없는 문자가 있어요.";
    case "trailing":
      return "이름 끝에 점이나 공백을 둘 수 없어요.";
    case "reserved":
      return "운영체제가 예약한 이름이라 사용할 수 없어요.";
    case "too-long":
      return "파일 이름으로 쓰기에는 너무 길어요.";
    case "collision":
      return "같은 폴더에 같은 이름의 노트가 이미 있어요.";
  }
}

export function parentPath(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? "" : path.slice(0, cut);
}

export function notePathForName(currentPath: string, rawName: unknown): string {
  const name = normalizeCharacterName(rawName);
  const parent = parentPath(currentPath);
  return parent ? `${parent}/${name}.md` : `${name}.md`;
}

/** NFC + locale-independent lowercase approximates portable file identity. */
export function portablePathIdentity(path: string): string {
  return path.normalize("NFC").toLowerCase();
}

export function hasPortablePathCollision(
  paths: readonly string[],
  sourcePath: string,
  targetPath: string,
): boolean {
  const target = portablePathIdentity(targetPath);
  return paths.some((path) => {
    // Exempt only the actual source entry. On a case-sensitive filesystem a
    // second sibling may already have the same portable identity, and that
    // still blocks a case-only rename of the source.
    return path !== sourcePath && portablePathIdentity(path) === target;
  });
}

export function basenameWithoutMarkdown(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.replace(/\.md$/i, "");
}

/** `tagMenuPath` may append `#fieldId` to a note path. */
export function remapPathKey(value: string, from: string, to: string): string {
  if (value === from) return to;
  if (value.startsWith(`${from}#`)) return `${to}${value.slice(from.length)}`;
  return value;
}

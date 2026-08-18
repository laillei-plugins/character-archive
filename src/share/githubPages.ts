import { requestUrl } from "obsidian";

export interface GithubPagesConfig {
  token: string;
  /** `owner/repo` */
  repo: string;
  branch: string;
  /** e.g. `docs/index.html` or `index.html` on gh-pages */
  path: string;
}

/** Default public repo we auto-create for normal users. */
export const DEFAULT_SHARE_REPO_NAME = "charinfo-share";

export function parseGithubRepo(repo: string): { owner: string; name: string } | null {
  const cleaned = repo.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/, "");
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0];
  const name = parts[1];
  if (!owner || !name) return null;
  return { owner, name };
}

export function isGithubShareConfigured(cfg: {
  webShareGithubToken?: string;
  webShareGithubRepo?: string;
  token?: string;
  repo?: string;
}): boolean {
  const token = (cfg.webShareGithubToken ?? cfg.token ?? "").trim();
  const repo = (cfg.webShareGithubRepo ?? cfg.repo ?? "").trim();
  return Boolean(token && parseGithubRepo(repo));
}

/** Classic PAT link — one checkbox (`repo`) is enough for normal users. */
export function githubTokenCreateUrl(): string {
  const params = new URLSearchParams({
    scopes: "repo",
    description: "Character Archive gallery share",
  });
  return `https://github.com/settings/tokens/new?${params.toString()}`;
}

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

/** Who does this token belong to? */
export async function fetchGithubLogin(token: string): Promise<string> {
  const trimmed = token.trim();
  if (!trimmed) throw new Error("위에 복사한 키를 붙여넣어 주세요.");
  const res = await requestUrl({
    url: "https://api.github.com/user",
    method: "GET",
    headers: ghHeaders(trimmed),
    throw: false,
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      "키가 잘못됐거나 권한이 부족해요. 「GitHub에서 키 만들기」로 새로 만들고, repo 가 체크된 채로 Generate token 을 눌러 주세요.",
    );
  }
  if (res.status >= 400) {
    throw new Error(`GitHub 로그인 확인 실패 (${res.status})`);
  }
  const login = (res.json as { login?: string } | undefined)?.login?.trim();
  if (!login) throw new Error("GitHub 사용자 이름을 읽지 못했어요.");
  return login;
}

async function repoExists(
  owner: string,
  name: string,
  token: string,
): Promise<boolean> {
  const res = await requestUrl({
    url: `https://api.github.com/repos/${owner}/${name}`,
    method: "GET",
    headers: ghHeaders(token),
    throw: false,
  });
  return res.status === 200;
}

async function createPublicRepo(name: string, token: string): Promise<void> {
  const res = await requestUrl({
    url: "https://api.github.com/user/repos",
    method: "POST",
    headers: {
      ...ghHeaders(token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      private: false,
      auto_init: true,
      description: "Character Archive — public gallery shares",
    }),
    throw: false,
  });
  if (res.status === 422) {
    // Already exists under this account — fine.
    return;
  }
  if (res.status >= 400) {
    throw new Error(
      `공유함 만들기 실패 (${res.status}): ${res.text?.slice(0, 200) || ""}`,
    );
  }
}

/** Best-effort: turn on Pages from /docs on main. Ignore if already on. */
async function ensurePagesFromDocs(
  owner: string,
  name: string,
  token: string,
): Promise<void> {
  const res = await requestUrl({
    url: `https://api.github.com/repos/${owner}/${name}/pages`,
    method: "POST",
    headers: {
      ...ghHeaders(token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      build_type: "legacy",
      source: { branch: "main", path: "/docs" },
    }),
    throw: false,
  });
  // 201 created, 409 already exists — both OK.
  if (res.status === 201 || res.status === 409 || res.status === 404) return;
  if (res.status >= 400 && res.status !== 422) {
    console.warn("GitHub Pages enable:", res.status, res.text?.slice(0, 200));
  }
}

/**
 * Token-only setup for normal users:
 * resolve login → ensure `charinfo-share` repo → try enable Pages → return owner/repo.
 */
export async function setupGithubShareFromToken(token: string): Promise<{
  owner: string;
  repo: string;
  branch: string;
  createdRepo: boolean;
}> {
  const trimmed = token.trim();
  const login = await fetchGithubLogin(trimmed);
  const repoName = DEFAULT_SHARE_REPO_NAME;
  const existed = await repoExists(login, repoName, trimmed);
  if (!existed) {
    await createPublicRepo(repoName, trimmed);
  }
  await ensurePagesFromDocs(login, repoName, trimmed);
  return {
    owner: login,
    repo: `${login}/${repoName}`,
    branch: "main",
    createdRepo: !existed,
  };
}

/** URL-safe link name (영문/숫자/한글/.- 허용). */
export function slugifyLinkName(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\w\uac00-\ud7a3.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || "gallery";
}

/** Always publish under docs/{slug}/index.html for stable named Pages URLs. */
export function githubPathForSlug(slug: string): string {
  return `docs/${slugifyLinkName(slug)}/index.html`;
}

/**
 * Public GitHub Pages URL for a file path.
 * Assumes Pages is enabled (docs/ on main, or root on gh-pages / user.github.io).
 */
export function githubPagesPublicUrl(
  owner: string,
  repo: string,
  filePath: string,
): string {
  let rel = filePath.replace(/^\/+/, "");
  if (rel.startsWith("docs/")) rel = rel.slice("docs/".length);
  rel = rel.replace(/\/index\.html$/i, "/").replace(/^index\.html$/i, "");
  if (rel.endsWith(".html")) {
    // keep .html files as-is (GitHub Pages serves them)
  } else if (rel && !rel.endsWith("/")) {
    rel = `${rel}/`;
  }

  if (repo.toLowerCase() === `${owner}.github.io`.toLowerCase()) {
    return rel ? `https://${owner}.github.io/${rel}` : `https://${owner}.github.io/`;
  }
  return rel
    ? `https://${owner}.github.io/${repo}/${rel}`
    : `https://${owner}.github.io/${repo}/`;
}

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function getExistingSha(
  owner: string,
  repo: string,
  path: string,
  branch: string,
  token: string,
): Promise<string | null> {
  const url =
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURI(path)}` +
    `?ref=${encodeURIComponent(branch)}`;
  const res = await requestUrl({
    url,
    method: "GET",
    headers: ghHeaders(token),
    throw: false,
  });
  if (res.status === 404) return null;
  if (res.status >= 400) {
    throw new Error(`GitHub 조회 실패 (${res.status}): ${res.text?.slice(0, 200) || ""}`);
  }
  const sha = (res.json as { sha?: string } | undefined)?.sha;
  return typeof sha === "string" ? sha : null;
}

/**
 * Create or overwrite a file on GitHub. Same path → same Pages URL.
 * Returns the public Pages URL (Pages deploy may take ~30–60s).
 */
export async function publishToGithubPages(
  html: string,
  cfg: GithubPagesConfig,
): Promise<{ url: string; updated: boolean }> {
  const parsed = parseGithubRepo(cfg.repo);
  if (!parsed) throw new Error("공유함이 아직 연결되지 않았어요.");
  const token = cfg.token.trim();
  if (!token) throw new Error("키가 비어 있어요. 연결 화면에서 다시 붙여넣어 주세요.");
  const path = cfg.path.trim().replace(/^\/+/, "");
  if (!path) throw new Error("게시 경로가 비어 있어요.");
  const branch = cfg.branch.trim() || "main";

  const sha = await getExistingSha(parsed.owner, parsed.name, path, branch, token);
  const body: Record<string, string> = {
    message: sha
      ? "chore: update Charinfo gallery share"
      : "chore: publish Charinfo gallery share",
    content: utf8ToBase64(html),
    branch,
  };
  if (sha) body.sha = sha;

  const res = await requestUrl({
    url: `https://api.github.com/repos/${parsed.owner}/${parsed.name}/contents/${encodeURI(path)}`,
    method: "PUT",
    headers: {
      ...ghHeaders(token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    throw: false,
  });

  if (res.status >= 400) {
    throw new Error(
      `올리기 실패 (${res.status}): ${res.text?.slice(0, 300) || "unknown"}`,
    );
  }

  return {
    url: githubPagesPublicUrl(parsed.owner, parsed.name, path),
    updated: Boolean(sha),
  };
}

/** Kept for rare manual reconnect checks. */
export async function testGithubConnection(cfg: {
  token: string;
  repo: string;
}): Promise<string> {
  const parsed = parseGithubRepo(cfg.repo);
  if (!parsed) throw new Error("공유함 이름이 없어요.");
  const token = cfg.token.trim();
  if (!token) throw new Error("키가 비어 있어요. 연결 화면에서 다시 붙여넣어 주세요.");
  const res = await requestUrl({
    url: `https://api.github.com/repos/${parsed.owner}/${parsed.name}`,
    method: "GET",
    headers: ghHeaders(token),
    throw: false,
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      "키 권한이 없어요. 「GitHub에서 키 만들기」로 repo 가 체크된 키를 새로 발급해 주세요.",
    );
  }
  if (res.status === 404) {
    throw new Error("공유함을 찾지 못했어요.");
  }
  if (res.status >= 400) {
    throw new Error(`연결 실패 (${res.status})`);
  }
  return `연결됨 · ${parsed.owner}/${parsed.name}`;
}

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path: string): string => fs.readFileSync(path, "utf8");

test("public-host network use and retention are disclosed", () => {
  const readme = read("README.md");
  const readmeKo = read("README.ko.md");
  const privacy = read("PRIVACY.md");
  assert.match(readme, /character-archive\.pages\.dev/);
  assert.match(readme, /Anyone with the link can view it/);
  assert.match(readme, /7 days, 30 days, or 1 year/);
  assert.match(readme, /without an account/);
  assert.match(readmeKo, /링크가 있는 사람은 누구나 볼 수 있습니다/);
  assert.match(readmeKo, /7일, 30일, 1년/);
  assert.match(readmeKo, /계정 없이 새 공유/);
  assert.match(privacy, /does not add analytics or telemetry/);
  assert.match(privacy, /not included in generated public share HTML/);
  assert.match(privacy, /Show added images on the web/);
  assert.match(privacy, /option is off by default/);
  assert.match(privacy, /remote note images/);
});

test("hosted-share UI warns before publish and labels one-year retention honestly", () => {
  const modal = read("src/ui/ShareGalleryModal.ts");
  const settings = read("src/ui/SettingTab.ts");
  assert.match(modal, /링크가 있는 사람은 누구나 볼 수 있어요/);
  assert.match(modal, /id: "permanent", label: "1년"/);
  assert.match(settings, /addOption\("permanent", "1년"\)/);
  assert.doesNotMatch(modal, /id: "permanent", label: "상시"/);
  assert.match(modal, /이미 열린 사본은 잠시 남을 수 있어요/);
});

test("the deployed Pages handlers are audited and hardened", () => {
  const create = read("share-host/functions/api/v1/share/index.ts");
  const shared = read("share-host/functions/_lib/share.ts");
  const tsconfig = read("share-host/tsconfig.json");
  assert.match(tsconfig, /functions\/\*\*\/\*\.ts/);
  assert.match(create, /isCharacterArchiveHtml/);
  assert.match(create, /randomHexToken\(16\)/);
  assert.match(create, /randomHexToken\(32\)/);
  assert.match(shared, /content-security-policy/);
  assert.match(shared, /frame-ancestors 'none'/);
  assert.match(shared, /noindex, noarchive/);
  assert.match(shared, /\{8,64\}/);
});

test("GitHub connection keeps an unverified token out of saved settings", () => {
  const modal = read("src/ui/ShareGalleryModal.ts");
  const github = read("src/share/githubPages.ts");
  assert.match(modal, /this\.pendingGithubToken = paste\.value\.trim\(\)/);
  assert.doesNotMatch(
    modal,
    /addEventListener\("input", \(\) => \{\s*this\.plugin\.settings\.webShareGithubToken/s,
  );
  assert.match(github, /scopes: "public_repo"/);
});

test("published links remain manageable after note lifecycle changes", () => {
  const main = read("src/main.ts");
  const settings = read("src/settings.ts");
  const settingTab = read("src/ui/SettingTab.ts");
  const shareModal = read("src/ui/ShareGalleryModal.ts");

  assert.match(main, /onLayoutReady\(\(\) => \{\s*void this\.claimLegacyWebShareAfterMetadata\(\)/s);
  assert.match(main, /this\.app\.vault\.on\("rename"/);
  assert.match(main, /remapGalleryPageState/);
  assert.match(main, /remapCharacterWebShareState/);
  assert.match(settings, /Keep any hosted-share credential/);
  assert.match(settingTab, /노트를 옮기거나 지워도 여기서 공개 링크를 확인하고 멈출 수 있어요/);
  assert.match(settingTab, /멈추지 못했어요\. 링크는 아직 열려 있어요/);
  assert.match(settingTab, /label: "이전 링크"/);
  assert.match(settingTab, /원본 노트 연결 안 됨/);
  assert.match(settingTab, /hostedShareBaseFromUrl\(state\.url\)/);
  assert.match(settingTab, /uploadKeyForHostedTarget/);
  assert.doesNotMatch(settingTab, /마지막 갤러리 링크/);
  assert.doesNotMatch(
    shareModal,
    /page\?\.url\.trim\(\)\s*\|\|\s*this\.plugin\.settings\.webShareLastUrl/,
  );
});

test("Pages self-hosting instructions configure the Pages secret surface", () => {
  const hostReadme = read("share-host/README.md");
  assert.match(hostReadme, /wrangler pages secret put UPLOAD_KEY/);
  assert.doesNotMatch(hostReadme, /npx wrangler secret put UPLOAD_KEY/);
});

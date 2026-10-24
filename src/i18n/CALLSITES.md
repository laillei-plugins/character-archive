# Phase 1A translation call sites

Owner: Character Archive maintainer. Source: plugin TypeScript. Scope: display text only.
Verification: `tests/i18n*.test.ts`, `npm test`, `npx tsc -noEmit -skipLibCheck`. Keep this index through Phase 1B's swaps.

Locations and exact source literals below refer to baseline `f7a3dc19cad1d05e1ec5980c459a34aecc528247` (before Phase 1A).
The tables use cooked string values; template expressions become ordered `{arg1}`, `{arg2}`, etc.
Each template row records the exact expressions to pass to `t(key, vars)`.
Whitespace, punctuation, newlines and Korean wording are retained. Repeated literals share keys.

## Phase 1B wiring

- Import `t` from `src/i18n` at UI call sites. Read `plugin.settings.language`; call `await plugin.setLanguage(value)`.
- Add the stock Setting dropdown as the FIRST settings row (before the glossary), with the fixed literal `Language / 언어`, options `ko: 한국어` and `en: English`. No Auto, popover row, CSS or new layout.
- `uiLanguage.subscribe(listener)` returns a disposer suitable for `this.register`. Main already subscribes, updates commands/ribbon and refreshes every open gallery plus the visible settings tab after a successful save. View refresh respects pending write guards.
- For constants created at module load, use a getter or call `t` when rendering. Do not freeze the current language in an exported string or option array.
- Use `displayPropertyLabel`, `displayFieldLabel`, `displayColorLabel`, and `displayStatusLabel` from `src/i18n/display` in UI. They keep user-renamed labels. Keep the raw data helpers for schema seeding and web-share output.
- Raw built-in definitions, default property names, status ids, group/archive identities and YAML keys stay Korean in storage. **Do not mechanically replace their metadata rows below.** Replace their UI consumers using display helpers instead.
- `DEFAULT_ROUTE_LABEL` is also a reserved name checked during validation. Keep it unchanged; render the empty route with `t("default")`. `UNGROUPED_LABEL` / `UNCLASSIFIED_ARCHIVE` also participate in identity; translate only a confirmed generated display fallback, never a user group/archive name.
- The profile parser in `cleanBody.ts` and `noteSections.ts` remains untouched. Only the paint/copy controls at cleanBody lines 490 onward are Phase 1B swaps; shared web-share rendering must retain its existing output (use the parse mode/context).
- Web-share HTML/modules, bundled template and update notes remain out of scope. Sharing **dialogs and settings** are in scope. Parsed heading `프롬프트` and fallback archive identity `미분류` in ShareGalleryModal are data, not direct swaps.
- UI notices in `src/page/**` and `src/media/**` are indexed but outside this run's hard write grant. They also need the same swaps in a follow-up with the appropriate path grant.
- New runtime imports in helpers use explicit `.ts` extensions with a TS5097 directive because existing native Node tests load these modules directly; the unchanged project tsc configuration does not enable allowImportingTsExtensions.

## Indexed strings

Columns: translation key; original file:line; exact original literal; template variable expressions.

| Key | Original location | Exact source literal | Variables |
| --- | --- | --- | --- |
| <code>valueIsReservedForCardsWithoutAnArchive</code> | <code>src/data/archiveRegistry.ts:147</code> | <code>`「${name}」는 아카이브가 없는 카드를 모아 두는 이름이라 쓸 수 없어요.`</code> | <code>arg1 = name</code> |
| <code>valueIsReservedForTheGalleryNotesFolder</code> | <code>src/data/archiveRegistry.ts:150</code> | <code>`「${name}」는 갤러리 노트 폴더 이름이라 쓸 수 없어요.`</code> | <code>arg1 = name</code> |
| <code>valueIsReservedForTheExampleCardsFolder</code> | <code>src/data/archiveRegistry.ts:153</code> | <code>`「${name}」는 예시 카드 폴더 이름이라 쓸 수 없어요.`</code> | <code>arg1 = name</code> |
| <code>valueIsReservedForInternalPluginUse</code> | <code>src/data/archiveRegistry.ts:158</code> | <code>`「${name}」는 플러그인 안에서 쓰는 이름이라 쓸 수 없어요.`</code> | <code>arg1 = name</code> |
| <code>anArchiveNamedValueAlreadyExistsChooseAnother</code> | <code>src/data/archiveRegistry.ts:197</code> | <code>`「${name}」 아카이브가 이미 있어요. 다른 이름을 정해 주세요.`</code> | <code>arg1 = name</code> |
| <code>theFolderValueAlreadyExistsChooseAnotherName</code> | <code>src/data/archiveRegistry.ts:208</code> | <code>`「${folder}」 폴더가 이미 있어요. 다른 이름을 정해 주세요.`</code> | <code>arg1 = folder</code> |
| <code>renamedArchiveToValueValueNotes</code> | <code>src/data/archiveRegistry.ts:288</code> | <code>`아카이브 이름을 「${next}」로 바꿨어요 · 노트 ${count}개`</code> | <code>arg1 = next</code>; <code>arg2 = count</code> |
| <code>renamedArchiveToValue</code> | <code>src/data/archiveRegistry.ts:289</code> | <code>`아카이브 이름을 「${next}」로 바꿨어요`</code> | <code>arg1 = next</code> |
| <code>renamedNotesToValueButCouldNotSave</code> | <code>src/data/archiveRegistry.ts:293</code> | <code>`노트는 「${next}」로 바꿨지만 설정 저장에 실패했어요${reason}`</code> | <code>arg1 = next</code>; <code>arg2 = reason</code> |
| <code>couldNotRenameArchiveCouldNotSaveSettings</code> | <code>src/data/archiveRegistry.ts:294</code> | <code>`아카이브 이름을 바꾸지 못했어요 · 설정 저장에 실패했어요${reason}`</code> | <code>arg1 = reason</code> |
| <code>chooseAGroupToMoveTo</code> | <code>src/data/batchGroupMove.ts:55</code> | <code>"이동할 그룹을 골라 주세요."</code> |  |
| <code>allSelectedCharactersAreAlreadyInThisGroup</code> | <code>src/data/batchGroupMove.ts:399</code> | <code>"이미 모두 이 그룹에 있어요"</code> |  |
| <code>valueSelectedCharactersAreAlreadyInThisGroup</code> | <code>src/data/batchGroupMove.ts:401</code> | <code>`선택한 ${row.alreadyThere}명은 이미 이 그룹에 있어요`</code> | <code>arg1 = row.alreadyThere</code> |
| <code>emptyGroup</code> | <code>src/data/batchGroupMove.ts:403</code> | <code>"비어 있는 그룹"</code> |  |
| <code>allSelectedCharactersAreAlreadyInTheValue</code> | <code>src/data/batchGroupMove.ts:413</code> | <code>`이미 모두 ${group} 그룹에 있어요.`</code> | <code>arg1 = group</code> |
| <code>movedValueCharactersToTheValueGroup</code> | <code>src/data/batchGroupMove.ts:414</code> | <code>`${changed}명을 ${group} 그룹으로 옮겼어요.`</code> | <code>arg1 = changed</code>; <code>arg2 = group</code> |
| <code>couldNotChangeGroupCouldNotRestoreValue</code> | <code>src/data/batchGroupMove.ts:425</code> | <code>`그룹을 바꾸지 못했어요 · ${error.rollbackFailures.length}명은 되돌리지 못했어요. 노트를 확인해 주세요.${tail}`</code> | <code>arg1 = error.rollbackFailures.length</code>; <code>arg2 = tail</code> |
| <code>couldNotChangeGroupAllChangesWereRestored</code> | <code>src/data/batchGroupMove.ts:427</code> | <code>`그룹을 바꾸지 못했어요. 모두 원래대로 돌려놓았어요.${tail}`</code> | <code>arg1 = tail</code> |
| <code>name</code> | <code>src/data/cardProperties.ts:45</code> | <code>"이름"</code> |  |
| <code>status</code> | <code>src/data/cardProperties.ts:46</code> | <code>"상태"</code> |  |
| <code>group</code> | <code>src/data/cardProperties.ts:47</code> | <code>"그룹"</code> |  |
| <code>relationship</code> | <code>src/data/cardProperties.ts:48</code> | <code>"관계"</code> |  |
| <code>bond</code> | <code>src/data/cardProperties.ts:49</code> | <code>"인연"</code> |  |
| <code>codename</code> | <code>src/data/cardProperties.ts:50</code> | <code>"코드네임"</code> |  |
| <code>realName</code> | <code>src/data/cardProperties.ts:51</code> | <code>"본명"</code> |  |
| <code>affiliation</code> | <code>src/data/cardProperties.ts:52</code> | <code>"소속"</code> |  |
| <code>tags</code> | <code>src/data/cardProperties.ts:53</code> | <code>"태그"</code> |  |
| <code>enterAName</code> | <code>src/data/characterName.ts:40</code> | <code>"이름을 입력해 주세요."</code> |  |
| <code>thisNameCannotBeUsedAsAFile</code> | <code>src/data/characterName.ts:42</code> | <code>"이 이름은 파일 이름으로 쓸 수 없어요."</code> |  |
| <code>doNotAddMdToTheName</code> | <code>src/data/characterName.ts:44</code> | <code>"이름에는 .md를 붙이지 마세요."</code> |  |
| <code>theNameContainsCharactersThatCannotBeUsed</code> | <code>src/data/characterName.ts:46</code> | <code>"파일 이름에 쓸 수 없는 문자가 있어요."</code> |  |
| <code>aNameCannotEndWithAPeriodOr</code> | <code>src/data/characterName.ts:48</code> | <code>"이름 끝에 점이나 공백을 둘 수 없어요."</code> |  |
| <code>thisNameIsReservedByTheOperatingSystem</code> | <code>src/data/characterName.ts:50</code> | <code>"운영체제가 예약한 이름이라 사용할 수 없어요."</code> |  |
| <code>thisNameIsTooLongForAFile</code> | <code>src/data/characterName.ts:52</code> | <code>"파일 이름으로 쓰기에는 너무 길어요."</code> |  |
| <code>aNoteWithThisNameAlreadyExistsIn</code> | <code>src/data/characterName.ts:54</code> | <code>"같은 폴더에 같은 이름의 노트가 이미 있어요."</code> |  |
| <code>status</code> | <code>src/data/filterAxis.ts:53</code> | <code>"상태"</code> |  |
| <code>status</code> | <code>src/data/filterAxis.ts:53</code> | <code>"상태"</code> |  |
| <code>relationship</code> | <code>src/data/filterAxis.ts:54</code> | <code>"관계"</code> |  |
| <code>relationship</code> | <code>src/data/filterAxis.ts:54</code> | <code>"관계"</code> |  |
| <code>bond</code> | <code>src/data/filterAxis.ts:55</code> | <code>"인연"</code> |  |
| <code>bond</code> | <code>src/data/filterAxis.ts:55</code> | <code>"인연"</code> |  |
| <code>affiliation</code> | <code>src/data/filterAxis.ts:56</code> | <code>"소속"</code> |  |
| <code>affiliation</code> | <code>src/data/filterAxis.ts:56</code> | <code>"소속"</code> |  |
| <code>tags</code> | <code>src/data/filterAxis.ts:57</code> | <code>"태그"</code> |  |
| <code>tags</code> | <code>src/data/filterAxis.ts:57</code> | <code>"태그"</code> |  |
| <code>none</code> | <code>src/data/filterAxis.ts:254</code> | <code>"없음"</code> |  |
| <code>default</code> | <code>src/data/groupRename.ts:2</code> | <code>"기본"</code> |  |
| <code>enterAName</code> | <code>src/data/groupRename.ts:61</code> | <code>"이름을 입력해 주세요."</code> |  |
| <code>aGroupWithThisNameAlreadyExistsEnter</code> | <code>src/data/groupRename.ts:63</code> | <code>"이미 같은 이름의 그룹이 있어요. 다른 이름을 입력해 주세요."</code> |  |
| <code>valueIsReservedForTheDefaultGroupEnter</code> | <code>src/data/groupRename.ts:66</code> | <code>`「${DEFAULT_ROUTE_LABEL}」은 기본 그룹의 이름이라 쓸 수 없어요. 다른 이름을 입력해 주세요.`</code> | <code>arg1 = DEFAULT_ROUTE_LABEL</code> |
| <code>theDefaultRouteIsNotAGroupAnd</code> | <code>src/data/groupRename.ts:68</code> | <code>"기본은 그룹이 아니라서 이름을 바꿀 수 없어요."</code> |  |
| <code>valueNotes</code> | <code>src/data/groupRename.ts:76</code> | <code>`노트 ${notes}개`</code> | <code>arg1 = notes</code> |
| <code>emptyGroup2</code> | <code>src/data/groupRename.ts:76</code> | <code>"빈 그룹"</code> |  |
| <code>renamedGroupValueToValueValue</code> | <code>src/data/groupRename.ts:78</code> | <code>`「${source}」 그룹 이름을 「${normalizeRenameInput(to)}」로 바꿨어요 · ${suffix}`</code> | <code>arg1 = source</code>; <code>arg2 = normalizeRenameInput(to)</code>; <code>arg3 = suffix</code> |
| <code>unclassified</code> | <code>src/data/groupSchema.ts:280</code> | <code>"미분류"</code> |  |
| <code>select</code> | <code>src/data/groupSchema.ts:442</code> | <code>"선택"</code> |  |
| <code>multipleValues</code> | <code>src/data/groupSchema.ts:443</code> | <code>"여러 값"</code> |  |
| <code>text</code> | <code>src/data/groupSchema.ts:444</code> | <code>"글"</code> |  |
| <code>theDefaultRouteIsNotAGroupAnd</code> | <code>src/data/groupSchema.ts:589</code> | <code>"기본은 그룹이 아니라서 이름을 바꿀 수 없어요."</code> |  |
| <code>enterAName</code> | <code>src/data/groupSchema.ts:612</code> | <code>"이름을 입력해 주세요."</code> |  |
| <code>groupValueAlreadyExists</code> | <code>src/data/groupSchema.ts:616</code> | <code>`그룹 「${next}」가 이미 있어요.`</code> | <code>arg1 = next</code> |
| <code>archiveValueAlreadyExists</code> | <code>src/data/groupSchema.ts:731</code> | <code>`아카이브 「${next}」가 이미 있어요`</code> | <code>arg1 = next</code> |
| <code>theNoteChangedSoThisCannotBeUndone</code> | <code>src/data/imageEmbeds.ts:409</code> | <code>"노트가 바뀌어 되돌리지 못했어요. 노트에서 이미지를 다시 넣어 주세요."</code> |  |
| <code>coverUrlsMustStartWithHttps</code> | <code>src/data/images.ts:447</code> | <code>"커버 URL은 https:// 로 시작해야 해요."</code> |  |
| <code>thisIsTheCurrentCoverChooseAnotherCover</code> | <code>src/data/images.ts:703</code> | <code>"현재 커버예요. 먼저 다른 이미지를 커버로 골라 주세요."</code> |  |
| <code>couldNotRestoreTheImageBecauseTheFile</code> | <code>src/data/images.ts:720</code> | <code>"이미지 파일을 찾을 수 없어 복원하지 못했어요."</code> |  |
| <code>theCoverChangedSoThisCannotBeUndone</code> | <code>src/data/images.ts:725</code> | <code>"커버가 바뀌어 되돌리지 못했어요. 노트에서 이미지를 다시 넣어 주세요."</code> |  |
| <code>couldNotSaveValueWhileRenamingToValue</code> | <code>src/data/order.ts:288</code> | <code>`「${next}」로 바꾸는 중 ${record.path} 저장에 실패했어요`</code> | <code>arg1 = next</code>; <code>arg2 = record.path</code> |
| <code>couldNotRestoreValueNotesValue</code> | <code>src/data/order.ts:290</code> | <code>`되돌리지 못한 노트 ${stranded.length}개: ${stranded.join(", ")}`</code> | <code>arg1 = stranded.length</code>; <code>arg2 = stranded.join(", ")</code> |
| <code>changedNotesWereRestored</code> | <code>src/data/order.ts:291</code> | <code>"바뀐 노트는 되돌렸어요"</code> |  |
| <code>status</code> | <code>src/data/propertyLabels.ts:16</code> | <code>"상태"</code> |  |
| <code>relationship</code> | <code>src/data/propertyLabels.ts:17</code> | <code>"관계"</code> |  |
| <code>bond</code> | <code>src/data/propertyLabels.ts:18</code> | <code>"인연"</code> |  |
| <code>affiliation</code> | <code>src/data/propertyLabels.ts:19</code> | <code>"소속"</code> |  |
| <code>tags</code> | <code>src/data/propertyLabels.ts:20</code> | <code>"태그"</code> |  |
| <code>green</code> | <code>src/data/status.ts:41</code> | <code>"초록"</code> |  |
| <code>gray</code> | <code>src/data/status.ts:42</code> | <code>"회색"</code> |  |
| <code>amber</code> | <code>src/data/status.ts:43</code> | <code>"호박"</code> |  |
| <code>blue</code> | <code>src/data/status.ts:44</code> | <code>"파랑"</code> |  |
| <code>red</code> | <code>src/data/status.ts:45</code> | <code>"빨강"</code> |  |
| <code>violet</code> | <code>src/data/status.ts:46</code> | <code>"보라"</code> |  |
| <code>cyan</code> | <code>src/data/status.ts:47</code> | <code>"청록"</code> |  |
| <code>pink</code> | <code>src/data/status.ts:48</code> | <code>"분홍"</code> |  |
| <code>olive</code> | <code>src/data/status.ts:49</code> | <code>"올리브"</code> |  |
| <code>indigo</code> | <code>src/data/status.ts:50</code> | <code>"남색"</code> |  |
| <code>lime</code> | <code>src/data/status.ts:51</code> | <code>"라임"</code> |  |
| <code>yellow</code> | <code>src/data/status.ts:52</code> | <code>"노랑"</code> |  |
| <code>couldNotFollowTheFolderRenameCheckFolder</code> | <code>src/main.ts:274</code> | <code>"폴더 이름을 따라가지 못했어요 — 설정의 「카드가 있는 폴더」를 확인해 주세요."</code> |  |
| <code>couldNotParseFrontmatterYaml</code> | <code>src/main.ts:446</code> | <code>"frontmatter YAML 파싱 실패"</code> |  |
| <code>couldNotRestorePropertiesValue</code> | <code>src/main.ts:768</code> | <code>`속성 복구 실패 · ${basename}`</code> | <code>arg1 = basename</code> |
| <code>couldNotFindTheGalleryNote</code> | <code>src/main.ts:872</code> | <code>"갤러리 노트를 찾지 못했어요."</code> |  |
| <code>couldNotRestoreTheFolderAutoOpenSetting</code> | <code>src/main.ts:917</code> | <code>"폴더 자동 열기 설정을 되돌리지 못했어요."</code> |  |
| <code>couldNotOpenTheVaultGallery</code> | <code>src/main.ts:920</code> | <code>"보관함 갤러리를 열지 못했어요."</code> |  |
| <code>imagesReconnectedValueNotes</code> | <code>src/main.ts:1085</code> | <code>`이미지 다시 연결됨 · 노트 ${rewrittenNotes}개`</code> | <code>arg1 = rewrittenNotes</code> |
| <code>thePluginHasClosed</code> | <code>src/main.ts:1285</code> | <code>"플러그인이 닫혔어요."</code> |  |
| <code>theNameChangedElsewhereReopenAndTryAgain</code> | <code>src/main.ts:1293</code> | <code>"이름이 다른 곳에서 바뀌었어요. 다시 열고 시도해 주세요."</code> |  |
| <code>couldNotRenameTheNoteValue</code> | <code>src/main.ts:1317</code> | <code>`노트 이름을 바꾸지 못했어요: ${error instanceof Error ? error.message : String(error)}`</code> | <code>arg1 = error instanceof Error ? error.message : String(error)</code> |
| <code>theFileWasRenamedButTheNameProperty</code> | <code>src/main.ts:1355</code> | <code>`파일명은 바뀌었지만 이름 속성을 저장하지 못했어요: ${error instanceof Error ? error.message : String(error)}`</code> | <code>arg1 = error instanceof Error ? error.message : String(error)</code> |
| <code>theFileWasRenamedButTheNameChanged</code> | <code>src/main.ts:1364</code> | <code>"파일명은 바뀌었지만 이름이 다시 수정됐어요. 최신 값을 확인해 주세요."</code> |  |
| <code>valueRestoredTheNameToMatchTheFile</code> | <code>src/main.ts:1457</code> | <code>`${message} 파일명에 맞춰 이름을 되돌렸어요.`</code> | <code>arg1 = message</code> |
| <code>changedTheNameAndNoteFileName</code> | <code>src/main.ts:1465</code> | <code>"이름과 노트 파일명을 바꿨어요."</code> |  |
| <code>couldNotRenameTheNoteSoTheName</code> | <code>src/main.ts:1470</code> | <code>`노트 이름을 바꾸지 못해 이름 속성을 되돌렸어요: ${error instanceof Error ? error.message : String(error)}`</code> | <code>arg1 = error instanceof Error ? error.message : String(error)</code> |
| <code>couldNotRestoreTheNamePropertyCheckIt</code> | <code>src/main.ts:1488</code> | <code>"이름 속성을 되돌리지 못했어요. 파일명을 기준으로 다시 확인해 주세요."</code> |  |
| <code>changedTheNameToMatchTheNoteFile</code> | <code>src/main.ts:1519</code> | <code>"노트 파일명에 맞춰 이름을 바꿨어요."</code> |  |
| <code>theFileWasRenamedButTheNameProperty2</code> | <code>src/main.ts:1522</code> | <code>"파일명은 바뀌었지만 이름 속성을 저장하지 못했어요."</code> |  |
| <code>couldNotOpenTheGallery</code> | <code>src/main.ts:1731</code> | <code>"갤러리를 열지 못했어요."</code> |  |
| <code>externalFoldersAreAvailableOnDesktopOnlySaving</code> | <code>src/media/MediaService.ts:64</code> | <code>"바깥 폴더는 데스크톱에서만 쓸 수 있어요. 보관함 그림 폴더로 저장합니다."</code> |  |
| <code>theImgurPluginIsMissingOrDisabled</code> | <code>src/media/imgurAdapter.ts:44</code> | <code>"Imgur 플러그인이 없거나 꺼져 있어요."</code> |  |
| <code>theImgurUploaderIsUnavailable</code> | <code>src/media/imgurAdapter.ts:49</code> | <code>"Imgur 업로더를 쓸 수 없어요."</code> |  |
| <code>imgurDidNotReturnAValidHttpsUrl</code> | <code>src/media/imgurAdapter.ts:54</code> | <code>"Imgur가 유효한 HTTPS 주소를 주지 않았어요."</code> |  |
| <code>gallery</code> | <code>src/page/galleryPage.ts:221</code> | <code>"갤러리"</code> |  |
| <code>copyLink</code> | <code>src/page/galleryPage.ts:232</code> | <code>"링크 복사"</code> |  |
| <code>couldNotFindTheGalleryNote</code> | <code>src/page/galleryPage.ts:237</code> | <code>"갤러리 노트를 찾지 못했어요."</code> |  |
| <code>refresh</code> | <code>src/page/galleryPage.ts:244</code> | <code>"새로고침"</code> |  |
| <code>galleryNoteValueMd</code> | <code>src/page/galleryPage.ts:349</code> | <code>`갤러리 노트 → ${GALLERY_ENTRY_BASENAME}.md`</code> | <code>arg1 = GALLERY_ENTRY_BASENAME</code> |
| <code>thereIsNoAvailableLocationForAGallery</code> | <code>src/page/galleryPage.ts:400</code> | <code>"이 보관함에는 갤러리 노트를 만들 자리가 없어요."</code> |  |
| <code>appLinkCopied</code> | <code>src/page/galleryPage.ts:452</code> | <code>"앱 링크를 복사했어요"</code> |  |
| <code>couldNotCopy</code> | <code>src/page/galleryPage.ts:452</code> | <code>"복사에 실패했어요"</code> |  |
| <code>galleryValueToReopenUseTheRibbonGrid</code> | <code>src/page/galleryPage.ts:522</code> | <code>`갤러리: ${file.path}\n다시 열려면 리본 격자 아이콘 또는 «${OPEN_GALLERY_NAME}»`</code> | <code>arg1 = file.path</code>; <code>arg2 = OPEN_GALLERY_NAME</code> |
| <code>openedTheExistingGalleryPageValue</code> | <code>src/page/galleryPage.ts:544</code> | <code>`이미 있는 갤러리 페이지를 열었어요 · ${existing.path}`</code> | <code>arg1 = existing.path</code> |
| <code>aNoteNamedValueAlreadyExistsChooseAnother</code> | <code>src/page/galleryPage.ts:548</code> | <code>`「${base}」 노트가 이미 있어요. 다른 페이지 이름을 정해 주세요.`</code> | <code>arg1 = base</code> |
| <code>galleryValue</code> | <code>src/page/galleryPage.ts:566</code> | <code>`갤러리: ${file.path}`</code> | <code>arg1 = file.path</code> |
| <code>archiveValue</code> | <code>src/page/galleryPage.ts:567</code> | <code>`아카이브 ${archive}`</code> | <code>arg1 = archive</code> |
| <code>archiveSwitchingEnabled</code> | <code>src/page/galleryPage.ts:567</code> | <code>"아카이브 전환 가능"</code> |  |
| <code>folderValue</code> | <code>src/page/galleryPage.ts:569</code> | <code>`폴더 ${library}`</code> | <code>arg1 = library</code> |
| <code>newCharacter</code> | <code>src/page/galleryPage.ts:679</code> | <code>"새 캐릭터"</code> |  |
| <code>create</code> | <code>src/page/galleryPage.ts:681</code> | <code>"만들기"</code> |  |
| <code>preparing</code> | <code>src/page/galleryPage.ts:682</code> | <code>"준비 중…"</code> |  |
| <code>noCardWasCreatedBecauseGroupPropertiesCould</code> | <code>src/page/galleryPage.ts:738</code> | <code>`그룹 속성을 저장하지 못해 카드를 만들지 않았어요: ${error instanceof Error ? error.message : String(error)}`</code> | <code>arg1 = error instanceof Error ? error.message : String(error)</code> |
| <code>couldNotCreateCharacterNoteValue</code> | <code>src/page/galleryPage.ts:749</code> | <code>`캐릭터 노트 생성 실패: ${error instanceof Error ? error.message : String(error)}`</code> | <code>arg1 = error instanceof Error ? error.message : String(error)</code> |
| <code>couldNotWritePropertiesTheNoteWasKept</code> | <code>src/page/galleryPage.ts:781</code> | <code>`속성을 쓰지 못했어요. 노트는 남겨 두고 복구를 예약했어요 · ${file.basename}`</code> | <code>arg1 = file.basename</code> |
| <code>addedACharacterToValue</code> | <code>src/page/galleryPage.ts:810</code> | <code>`「${genre}」에 캐릭터를 추가했어요`</code> | <code>arg1 = genre</code> |
| <code>addedACharacter</code> | <code>src/page/galleryPage.ts:810</code> | <code>"캐릭터를 추가했어요"</code> |  |
| <code>groupValue</code> | <code>src/page/galleryPage.ts:811</code> | <code>`그룹 ${group}`</code> | <code>arg1 = group</code> |
| <code>statusValue</code> | <code>src/page/galleryPage.ts:812</code> | <code>`상태 ${defaultStatus &#124;&#124; "Off"}`</code> | <code>arg1 = defaultStatus &#124;&#124; "Off"</code> |
| <code>andValueMore</code> | <code>src/page/orphanCleanup.ts:126</code> | <code>`\n외 ${names.length - shown.length}개`</code> | <code>arg1 = names.length - shown.length</code> |
| <code>noEmptyFoldersRemain</code> | <code>src/page/orphanCleanup.ts:135</code> | <code>"남은 빈 폴더가 없어요."</code> |  |
| <code>valueEmptyFolders</code> | <code>src/page/orphanCleanup.ts:139</code> | <code>`빈 폴더 ${folders.length}개`</code> | <code>arg1 = folders.length</code> |
| <code>onlyEmptyFoldersWillBeMovedToTrash</code> | <code>src/page/orphanCleanup.ts:141</code> | <code>"빈 폴더만 휴지통으로 보냅니다. 카드는 그대로입니다."</code> |  |
| <code>removedValueEmptyFolders</code> | <code>src/page/orphanCleanup.ts:145</code> | <code>`빈 폴더 ${n}개를 치웠어요.`</code> | <code>arg1 = n</code> |
| <code>thereAreNoEmptyFoldersToDelete</code> | <code>src/page/orphanCleanup.ts:145</code> | <code>"지울 빈 폴더가 없어요."</code> |  |
| <code>noUnusedGalleryTabsRemain</code> | <code>src/page/orphanCleanup.ts:153</code> | <code>"남은 갤러리 창이 없어요."</code> |  |
| <code>valueUnusedGalleryTabs</code> | <code>src/page/orphanCleanup.ts:157</code> | <code>`남은 갤러리 창 ${pages.length}개`</code> | <code>arg1 = pages.length</code> |
| <code>onlyTabNotesWillBeMovedToTrash</code> | <code>src/page/orphanCleanup.ts:159</code> | <code>"창 노트만 휴지통으로 보냅니다. 카드는 그대로입니다."</code> |  |
| <code>removedValueGalleryTabs</code> | <code>src/page/orphanCleanup.ts:163</code> | <code>`갤러리 창 ${n}개를 치웠어요.`</code> | <code>arg1 = n</code> |
| <code>thereAreNoTabsToDelete</code> | <code>src/page/orphanCleanup.ts:163</code> | <code>"지울 창이 없어요."</code> |  |
| <code>groupsManageProperties</code> | <code>src/ui/AttrManageModal.ts:123</code> | <code>"그룹 · 속성 관리"</code> |  |
| <code>text</code> | <code>src/ui/AttrManageModal.ts:163</code> | <code>"글"</code> |  |
| <code>select</code> | <code>src/ui/AttrManageModal.ts:169</code> | <code>"선택"</code> |  |
| <code>multipleValues</code> | <code>src/ui/AttrManageModal.ts:170</code> | <code>"여러 값"</code> |  |
| <code>couldNotSave</code> | <code>src/ui/AttrManageModal.ts:326</code> | <code>"저장하지 못했어요."</code> |  |
| <code>defaultValue</code> | <code>src/ui/AttrManageModal.ts:331</code> | <code>"기본값"</code> |  |
| <code>backToPropertyList</code> | <code>src/ui/AttrManageModal.ts:381</code> | <code>"속성 목록으로 돌아가기"</code> |  |
| <code>backToPropertyList</code> | <code>src/ui/AttrManageModal.ts:382</code> | <code>"속성 목록으로 돌아가기"</code> |  |
| <code>valueNoGroup</code> | <code>src/ui/AttrManageModal.ts:505</code> | <code>`${label} (그룹 없음)`</code> | <code>arg1 = label</code> |
| <code>group</code> | <code>src/ui/AttrManageModal.ts:566</code> | <code>"그룹"</code> |  |
| <code>addGroup</code> | <code>src/ui/AttrManageModal.ts:583</code> | <code>"그룹 추가"</code> |  |
| <code>addGroup</code> | <code>src/ui/AttrManageModal.ts:584</code> | <code>"그룹 추가"</code> |  |
| <code>group</code> | <code>src/ui/AttrManageModal.ts:593</code> | <code>"그룹"</code> |  |
| <code>reorderGroupValue</code> | <code>src/ui/AttrManageModal.ts:624</code> | <code>`「${title}」 그룹 순서 바꾸기`</code> | <code>arg1 = title</code> |
| <code>dragOrUseAltToReorder</code> | <code>src/ui/AttrManageModal.ts:625</code> | <code>"드래그하거나 Alt+←/→로 순서 바꾸기"</code> |  |
| <code>groupValueValueCharacters</code> | <code>src/ui/AttrManageModal.ts:647</code> | <code>`「${title}」 그룹 · 캐릭터 ${members}명`</code> | <code>arg1 = title</code>; <code>arg2 = members</code> |
| <code>renameGroupValue</code> | <code>src/ui/AttrManageModal.ts:666</code> | <code>`「${title}」 그룹 이름 바꾸기`</code> | <code>arg1 = title</code> |
| <code>deleteGroupValue</code> | <code>src/ui/AttrManageModal.ts:680</code> | <code>`「${title}」 그룹 삭제`</code> | <code>arg1 = title</code> |
| <code>groupName</code> | <code>src/ui/AttrManageModal.ts:729</code> | <code>"그룹 이름"</code> |  |
| <code>newNameForGroupValue</code> | <code>src/ui/AttrManageModal.ts:731</code> | <code>`「${title}」 새 그룹 이름`</code> | <code>arg1 = title</code> |
| <code>newGroupName</code> | <code>src/ui/AttrManageModal.ts:731</code> | <code>"새 그룹 이름"</code> |  |
| <code>saveGroupName</code> | <code>src/ui/AttrManageModal.ts:738</code> | <code>"그룹 이름 저장"</code> |  |
| <code>addGroup</code> | <code>src/ui/AttrManageModal.ts:738</code> | <code>"그룹 추가"</code> |  |
| <code>cancelRename</code> | <code>src/ui/AttrManageModal.ts:753</code> | <code>"이름 바꾸기 취소"</code> |  |
| <code>cancelAddingGroup</code> | <code>src/ui/AttrManageModal.ts:753</code> | <code>"그룹 추가 취소"</code> |  |
| <code>cancel</code> | <code>src/ui/AttrManageModal.ts:754</code> | <code>"취소"</code> |  |
| <code>closedWithoutSavingValue</code> | <code>src/ui/AttrManageModal.ts:814</code> | <code>`입력한 「${draft}」은 저장하지 않고 닫았어요.`</code> | <code>arg1 = draft</code> |
| <code>name</code> | <code>src/ui/AttrManageModal.ts:869</code> | <code>"이름"</code> |  |
| <code>add</code> | <code>src/ui/AttrManageModal.ts:901</code> | <code>"추가"</code> |  |
| <code>order</code> | <code>src/ui/AttrManageModal.ts:949</code> | <code>"순서"</code> |  |
| <code>saveOrCancelFirst</code> | <code>src/ui/AttrManageModal.ts:1062</code> | <code>"먼저 저장하거나 취소해 주세요."</code> |  |
| <code>confirmDeletingGroupValue</code> | <code>src/ui/AttrManageModal.ts:1109</code> | <code>`「${title}」 그룹 삭제 확인`</code> | <code>arg1 = title</code> |
| <code>deleteGroupValue</code> | <code>src/ui/AttrManageModal.ts:1113</code> | <code>`「${title}」 그룹 삭제`</code> | <code>arg1 = title</code> |
| <code>moveTo</code> | <code>src/ui/AttrManageModal.ts:1128</code> | <code>"옮길 위치"</code> |  |
| <code>moveAndDelete</code> | <code>src/ui/AttrManageModal.ts:1143</code> | <code>"옮기고 삭제"</code> |  |
| <code>thereAreNoOtherGroupsToMoveTo</code> | <code>src/ui/AttrManageModal.ts:1154</code> | <code>"옮길 다른 그룹이 없어요. 먼저 그룹을 추가해 주세요."</code> |  |
| <code>moveValueCharactersToTrashAndDelete</code> | <code>src/ui/AttrManageModal.ts:1164</code> | <code>`캐릭터 ${members}명을 휴지통으로 보내고 삭제`</code> | <code>arg1 = members</code> |
| <code>cancel</code> | <code>src/ui/AttrManageModal.ts:1175</code> | <code>"취소"</code> |  |
| <code>delete</code> | <code>src/ui/AttrManageModal.ts:1188</code> | <code>"삭제"</code> |  |
| <code>valueRemainsAfterDeletionMoveItsValueCharacters</code> | <code>src/ui/AttrManageModal.ts:1198</code> | <code>`「${DEFAULT_ROUTE_LABEL}」은 지워도 사라지지 않아요. 캐릭터 ${members}명을 옮기거나 휴지통으로 보내고, 이 그룹의 속성 목록만 처음 상태로 돌아가요.`</code> | <code>arg1 = DEFAULT_ROUTE_LABEL</code>; <code>arg2 = members</code> |
| <code>valueRemainsAfterDeletionOnlyItsPropertyList</code> | <code>src/ui/AttrManageModal.ts:1199</code> | <code>`「${DEFAULT_ROUTE_LABEL}」은 지워도 사라지지 않아요. 속성 목록만 처음 상태로 돌아가고, 노트의 값은 지워지지 않아요.`</code> | <code>arg1 = DEFAULT_ROUTE_LABEL</code> |
| <code>moveThisGroupSValueCharactersElsewhereOr</code> | <code>src/ui/AttrManageModal.ts:1202</code> | <code>`이 그룹의 캐릭터 ${members}명을 옮기거나 휴지통으로 보내야 해요. 옮기면 속성 값은 지워지지 않아요.`</code> | <code>arg1 = members</code> |
| <code>thereAreNoCharactersToMoveOnlyThe</code> | <code>src/ui/AttrManageModal.ts:1203</code> | <code>"옮길 캐릭터가 없어요. 속성 목록만 사라지고, 값은 지워지지 않아요."</code> |  |
| <code>delete</code> | <code>src/ui/AttrManageModal.ts:1224</code> | <code>"삭제"</code> |  |
| <code>deletedGroupValueAndMovedValueNotesTo</code> | <code>src/ui/AttrManageModal.ts:1236</code> | <code>`「${scopeLabel(from)}」 그룹을 지우고 노트 ${members}개를 휴지통으로 보냈어요. 복구는 옵시디언 휴지통 설정에 따라요.`</code> | <code>arg1 = scopeLabel(from)</code>; <code>arg2 = members</code> |
| <code>reorderValue</code> | <code>src/ui/AttrManageModal.ts:1284</code> | <code>`${this.fieldName(field)} 순서 바꾸기`</code> | <code>arg1 = this.fieldName(field)</code> |
| <code>dragOrUseAltToReorder2</code> | <code>src/ui/AttrManageModal.ts:1285</code> | <code>"드래그하거나 Alt+↑/↓로 순서 바꾸기"</code> |  |
| <code>openProperty</code> | <code>src/ui/AttrManageModal.ts:1307</code> | <code>"속성 열기"</code> |  |
| <code>removeValueFromList</code> | <code>src/ui/AttrManageModal.ts:1323</code> | <code>`${this.fieldName(field)} 목록에서 빼기`</code> | <code>arg1 = this.fieldName(field)</code> |
| <code>removePropertyAlsoDeletesValuesFromNotes</code> | <code>src/ui/AttrManageModal.ts:1324</code> | <code>"속성 빼기 (노트의 값도 지워져요)"</code> |  |
| <code>order</code> | <code>src/ui/AttrManageModal.ts:1382</code> | <code>"순서"</code> |  |
| <code>propertyName</code> | <code>src/ui/AttrManageModal.ts:1418</code> | <code>"속성 이름"</code> |  |
| <code>enterAName</code> | <code>src/ui/AttrManageModal.ts:1432</code> | <code>"이름을 입력해 주세요."</code> |  |
| <code>name</code> | <code>src/ui/AttrManageModal.ts:1443</code> | <code>"이름"</code> |  |
| <code>name</code> | <code>src/ui/AttrManageModal.ts:1456</code> | <code>"이름"</code> |  |
| <code>valueTypeValue</code> | <code>src/ui/AttrManageModal.ts:1506</code> | <code>`${this.fieldName(field)} 종류 · ${label}`</code> | <code>arg1 = this.fieldName(field)</code>; <code>arg2 = label</code> |
| <code>valueTypeValue</code> | <code>src/ui/AttrManageModal.ts:1523</code> | <code>`${this.fieldName(field)} 종류 · ${label}`</code> | <code>arg1 = this.fieldName(field)</code>; <code>arg2 = label</code> |
| <code>changePropertyType</code> | <code>src/ui/AttrManageModal.ts:1524</code> | <code>"속성 종류 바꾸기"</code> |  |
| <code>propertyType</code> | <code>src/ui/AttrManageModal.ts:1569</code> | <code>"속성 종류"</code> |  |
| <code>propertyType</code> | <code>src/ui/AttrManageModal.ts:1573</code> | <code>"속성 종류"</code> |  |
| <code>theTypeOfNameCannotBeChanged</code> | <code>src/ui/AttrManageModal.ts:1724</code> | <code>"「이름」은 종류를 바꿀 수 없어요."</code> |  |
| <code>cannotChangeToValueBecauseValueCardsHave</code> | <code>src/ui/AttrManageModal.ts:1731</code> | <code>`값이 2개 이상인 카드가 ${lossy.length}장 있어서 「${fieldTypeLabel(type)}」으로 바꿀 수 없어요. 먼저 값을 하나로 줄여 주세요.`</code> | <code>arg1 = lossy.length</code>; <code>arg2 = fieldTypeLabel(type)</code> |
| <code>type</code> | <code>src/ui/AttrManageModal.ts:1737</code> | <code>"종류"</code> |  |
| <code>optionsAreKeptTheyWillReappearWhenYou</code> | <code>src/ui/AttrManageModal.ts:1752</code> | <code>"선택 항목은 보관돼요. 선택 종류로 돌아오면 다시 보여요."</code> |  |
| <code>existingValuesOutsideTheListAppearInGray</code> | <code>src/ui/AttrManageModal.ts:1754</code> | <code>"목록에 없는 기존 값은 회색으로 보여요."</code> |  |
| <code>valueCardsInValueHaveAValueFor</code> | <code>src/ui/AttrManageModal.ts:1797</code> | <code>`「${this.fieldName(field)}」 값이 있는 카드가 「${scope}」에 ${used}장 있어요. `</code> | <code>arg1 = this.fieldName(field)</code>; <code>arg2 = scope</code>; <code>arg3 = used</code> |
| <code>thisIsABuiltInProperty</code> | <code>src/ui/AttrManageModal.ts:1798</code> | <code>"이 항목은 기본 속성이에요. "</code> |  |
| <code>valueItWillBeRemovedFromTheList</code> | <code>src/ui/AttrManageModal.ts:1803</code> | <code>`${usage}목록에서 빠지고, 카드 속성에서도 값이 지워져요. 되돌릴 수 없어요.`</code> | <code>arg1 = usage</code> |
| <code>confirmRemovingValue</code> | <code>src/ui/AttrManageModal.ts:1827</code> | <code>`${this.fieldName(field)} 빼기 확인`</code> | <code>arg1 = this.fieldName(field)</code> |
| <code>cancel</code> | <code>src/ui/AttrManageModal.ts:1844</code> | <code>"취소"</code> |  |
| <code>remove</code> | <code>src/ui/AttrManageModal.ts:1855</code> | <code>"빼기"</code> |  |
| <code>remove</code> | <code>src/ui/AttrManageModal.ts:1875</code> | <code>"빼기"</code> |  |
| <code>removedPropertyValueItsNoteValuesWillAlso</code> | <code>src/ui/AttrManageModal.ts:1903</code> | <code>`「${name}」 속성을 뺐어요. 노트의 값도 함께 정리해요.`</code> | <code>arg1 = name</code> |
| <code>addProperty</code> | <code>src/ui/AttrManageModal.ts:1943</code> | <code>"속성 추가"</code> |  |
| <code>addProperty</code> | <code>src/ui/AttrManageModal.ts:1950</code> | <code>"속성 추가"</code> |  |
| <code>name</code> | <code>src/ui/AttrManageModal.ts:1970</code> | <code>"이름"</code> |  |
| <code>newPropertyName</code> | <code>src/ui/AttrManageModal.ts:1972</code> | <code>"새 속성 이름"</code> |  |
| <code>propertyType</code> | <code>src/ui/AttrManageModal.ts:1987</code> | <code>"속성 종류"</code> |  |
| <code>addProperty</code> | <code>src/ui/AttrManageModal.ts:2011</code> | <code>"속성 추가"</code> |  |
| <code>addProperty</code> | <code>src/ui/AttrManageModal.ts:2012</code> | <code>"속성 추가"</code> |  |
| <code>cancelAddingProperty</code> | <code>src/ui/AttrManageModal.ts:2027</code> | <code>"속성 추가 취소"</code> |  |
| <code>cancel</code> | <code>src/ui/AttrManageModal.ts:2028</code> | <code>"취소"</code> |  |
| <code>add</code> | <code>src/ui/AttrManageModal.ts:2047</code> | <code>"추가"</code> |  |
| <code>couldNotFindThisProperty</code> | <code>src/ui/AttrManageModal.ts:2148</code> | <code>"이 속성을 찾지 못했어요."</code> |  |
| <code>propertyName</code> | <code>src/ui/AttrManageModal.ts:2158</code> | <code>"속성 이름"</code> |  |
| <code>rename</code> | <code>src/ui/AttrManageModal.ts:2171</code> | <code>"이름 바꾸기"</code> |  |
| <code>propertyType</code> | <code>src/ui/AttrManageModal.ts:2189</code> | <code>"속성 종류"</code> |  |
| <code>namesAndOptionsAreSharedAcrossAllGroups</code> | <code>src/ui/AttrManageModal.ts:2210</code> | <code>`이름과 선택 항목은 모든 그룹이 함께 써요. 종류는 「${scopeLabel(this.group)}」에서만 바뀌어요.`</code> | <code>arg1 = scopeLabel(this.group)</code> |
| <code>removeValueFromList</code> | <code>src/ui/AttrManageModal.ts:2228</code> | <code>`${this.fieldName(field)} 목록에서 빼기`</code> | <code>arg1 = this.fieldName(field)</code> |
| <code>removePropertyAlsoDeletesValuesFromNotes</code> | <code>src/ui/AttrManageModal.ts:2229</code> | <code>"속성 빼기 (노트의 값도 지워져요)"</code> |  |
| <code>removeProperty</code> | <code>src/ui/AttrManageModal.ts:2238</code> | <code>"속성 빼기"</code> |  |
| <code>options</code> | <code>src/ui/AttrManageModal.ts:2259</code> | <code>"선택 항목"</code> |  |
| <code>valueOptions</code> | <code>src/ui/AttrManageModal.ts:2264</code> | <code>`선택 항목 ${options.length}개`</code> | <code>arg1 = options.length</code> |
| <code>addOption</code> | <code>src/ui/AttrManageModal.ts:2277</code> | <code>"선택 항목 추가"</code> |  |
| <code>addOption</code> | <code>src/ui/AttrManageModal.ts:2287</code> | <code>"선택 항목 추가"</code> |  |
| <code>newOptionName</code> | <code>src/ui/AttrManageModal.ts:2320</code> | <code>"새 선택 항목 이름"</code> |  |
| <code>newOptionName</code> | <code>src/ui/AttrManageModal.ts:2322</code> | <code>"새 선택 항목 이름"</code> |  |
| <code>addOption</code> | <code>src/ui/AttrManageModal.ts:2333</code> | <code>"선택 항목 추가"</code> |  |
| <code>addOption</code> | <code>src/ui/AttrManageModal.ts:2334</code> | <code>"선택 항목 추가"</code> |  |
| <code>cancelAddingOption</code> | <code>src/ui/AttrManageModal.ts:2345</code> | <code>"선택 항목 추가 취소"</code> |  |
| <code>cancel</code> | <code>src/ui/AttrManageModal.ts:2346</code> | <code>"취소"</code> |  |
| <code>enterAName</code> | <code>src/ui/AttrManageModal.ts:2355</code> | <code>"이름을 입력해 주세요."</code> |  |
| <code>reorderValue</code> | <code>src/ui/AttrManageModal.ts:2415</code> | <code>`${option.label} 순서 바꾸기`</code> | <code>arg1 = option.label</code> |
| <code>dragOrUseAltToReorder2</code> | <code>src/ui/AttrManageModal.ts:2416</code> | <code>"드래그하거나 Alt+↑/↓로 순서 바꾸기"</code> |  |
| <code>optionName</code> | <code>src/ui/AttrManageModal.ts:2446</code> | <code>"선택 항목 이름"</code> |  |
| <code>changeNameAndColor</code> | <code>src/ui/AttrManageModal.ts:2479</code> | <code>"이름과 색 바꾸기"</code> |  |
| <code>rename</code> | <code>src/ui/AttrManageModal.ts:2479</code> | <code>"이름 바꾸기"</code> |  |
| <code>default</code> | <code>src/ui/AttrManageModal.ts:2501</code> | <code>"기본"</code> |  |
| <code>removeValueFromList</code> | <code>src/ui/AttrManageModal.ts:2510</code> | <code>`${option.label} 목록에서 빼기`</code> | <code>arg1 = option.label</code> |
| <code>removeFromListSavedCardValuesWillBe</code> | <code>src/ui/AttrManageModal.ts:2511</code> | <code>"목록에서 빼기 (카드에 저장된 값은 그대로 남아요)"</code> |  |
| <code>order</code> | <code>src/ui/AttrManageModal.ts:2554</code> | <code>"순서"</code> |  |
| <code>enterAName</code> | <code>src/ui/AttrManageModal.ts:2613</code> | <code>"이름을 입력해 주세요."</code> |  |
| <code>name</code> | <code>src/ui/AttrManageModal.ts:2620</code> | <code>"이름"</code> |  |
| <code>name</code> | <code>src/ui/AttrManageModal.ts:2628</code> | <code>"이름"</code> |  |
| <code>enterAName</code> | <code>src/ui/AttrManageModal.ts:2644</code> | <code>"이름을 입력해 주세요."</code> |  |
| <code>add</code> | <code>src/ui/AttrManageModal.ts:2651</code> | <code>"추가"</code> |  |
| <code>add</code> | <code>src/ui/AttrManageModal.ts:2663</code> | <code>"추가"</code> |  |
| <code>atLeastOneSelectableValueIsRequired</code> | <code>src/ui/AttrManageModal.ts:2693</code> | <code>"고를 수 있는 값이 하나는 필요해요."</code> |  |
| <code>thisIsTheDefaultForNewCardsChoose</code> | <code>src/ui/AttrManageModal.ts:2697</code> | <code>"새 카드 기본값으로 쓰는 중이에요. 다른 기본값을 고른 뒤에 빼 주세요."</code> |  |
| <code>valueCardsAcrossAllArchivesUseValueValue</code> | <code>src/ui/AttrManageModal.ts:2715</code> | <code>`‘${option.label}’을 쓰는 카드가 모든 아카이브 합쳐 ${library}장 있어요. 이 아카이브에는 ${archive}장 있어요. 목록에서만 빠지고, 카드에 저장된 값은 그대로 남아요. 카드는 회색 ‘${option.id}’으로 보일 수 있어요.`</code> | <code>arg1 = option.label</code>; <code>arg2 = library</code>; <code>arg3 = archive</code>; <code>arg4 = option.id</code> |
| <code>valueCardsInThisGroupUseValueOnly</code> | <code>src/ui/AttrManageModal.ts:2728</code> | <code>`‘${option.label}’을 쓰는 카드가 이 그룹에 ${used}장 있어요. 목록에서만 빠지고, 카드에 저장된 값은 그대로 남아요. 카드는 회색 ‘${option.id}’으로 보일 수 있어요.`</code> | <code>arg1 = option.label</code>; <code>arg2 = used</code>; <code>arg3 = option.id</code> |
| <code>cancel</code> | <code>src/ui/AttrManageModal.ts:2758</code> | <code>"취소"</code> |  |
| <code>remove</code> | <code>src/ui/AttrManageModal.ts:2767</code> | <code>"빼기"</code> |  |
| <code>remove</code> | <code>src/ui/AttrManageModal.ts:2778</code> | <code>"빼기"</code> |  |
| <code>remove</code> | <code>src/ui/AttrManageModal.ts:2794</code> | <code>"빼기"</code> |  |
| <code>colors</code> | <code>src/ui/AttrManageModal.ts:2822</code> | <code>"색상"</code> |  |
| <code>color</code> | <code>src/ui/AttrManageModal.ts:2825</code> | <code>"색"</code> |  |
| <code>chooseACustomColor</code> | <code>src/ui/AttrManageModal.ts:2865</code> | <code>"색 직접 고르기"</code> |  |
| <code>chooseACustomColor</code> | <code>src/ui/AttrManageModal.ts:2879</code> | <code>"색 직접 고르기"</code> |  |
| <code>color</code> | <code>src/ui/AttrManageModal.ts:2919</code> | <code>"색"</code> |  |
| <code>defaultForNewCards</code> | <code>src/ui/AttrManageModal.ts:2939</code> | <code>"새 카드 기본값"</code> |  |
| <code>defaultForNewCards</code> | <code>src/ui/AttrManageModal.ts:2947</code> | <code>"새 카드 기본값"</code> |  |
| <code>statusToPrefillInNewCards</code> | <code>src/ui/AttrManageModal.ts:2948</code> | <code>"새 카드에 미리 넣을 상태"</code> |  |
| <code>oneDefaultValueIsRequiredChooseAnotherValue</code> | <code>src/ui/AttrManageModal.ts:2959</code> | <code>"기본값은 하나가 필요해요. 다른 값을 기본값으로 골라 주세요."</code> |  |
| <code>defaultValue</code> | <code>src/ui/AttrManageModal.ts:2963</code> | <code>"기본값"</code> |  |
| <code>valueValuesOutsideTheListInValueValue</code> | <code>src/ui/AttrManageModal.ts:2984</code> | <code>`${this.leftoverOpen ? "▾" : "▸"} ${axis ? "이 아카이브" : "이 그룹"}에서 목록에 없는 값 · ${leftovers.length}개`</code> | <code>arg1 = this.leftoverOpen ? "▾" : "▸"</code>; <code>arg2 = axis ? "이 아카이브" : "이 그룹"</code>; <code>arg3 = leftovers.length</code> |
| <code>thisArchive</code> | <code>src/ui/AttrManageModal.ts:2984</code> | <code>"이 아카이브"</code> |  |
| <code>thisGroup</code> | <code>src/ui/AttrManageModal.ts:2984</code> | <code>"이 그룹"</code> |  |
| <code>addToList</code> | <code>src/ui/AttrManageModal.ts:2997</code> | <code>"목록에 넣기"</code> |  |
| <code>saving</code> | <code>src/ui/AttrManageModal.ts:3055</code> | <code>"저장 중…"</code> |  |
| <code>tryAgain</code> | <code>src/ui/AttrManageModal.ts:3065</code> | <code>"다시 시도"</code> |  |
| <code>thereIsNoActionToRetryInThe</code> | <code>src/ui/AttrManageModal.ts:3073</code> | <code>"현재 그룹에서 다시 시도할 작업이 없어요."</code> |  |
| <code>saved</code> | <code>src/ui/AttrManageModal.ts:3088</code> | <code>"저장했어요."</code> |  |
| <code>couldNotSave</code> | <code>src/ui/AttrManageModal.ts:3131</code> | <code>"저장하지 못했어요."</code> |  |
| <code>include</code> | <code>src/ui/AttrManageModal.ts:3194</code> | <code>"넣기"</code> |  |
| <code>include</code> | <code>src/ui/AttrManageModal.ts:3209</code> | <code>"넣기"</code> |  |
| <code>destinationGroup</code> | <code>src/ui/BatchGroupMoveDialog.ts:140</code> | <code>"이동할 그룹"</code> |  |
| <code>valueSelected</code> | <code>src/ui/BatchGroupMoveDialog.ts:145</code> | <code>`${this.opts.selectedCount}명 선택`</code> | <code>arg1 = this.opts.selectedCount</code> |
| <code>changingTheGroupOfValueCharacters</code> | <code>src/ui/BatchGroupMoveDialog.ts:216</code> | <code>`${this.opts.selectedCount}명의 그룹을 바꾸는 중…`</code> | <code>arg1 = this.opts.selectedCount</code> |
| <code>destinationGroup</code> | <code>src/ui/BatchGroupMoveDialog.ts:264</code> | <code>"이동할 그룹"</code> |  |
| <code>valueCharacters</code> | <code>src/ui/BatchGroupMoveDialog.ts:303</code> | <code>`${row.total}명`</code> | <code>arg1 = row.total</code> |
| <code>createANewGroup</code> | <code>src/ui/BatchGroupMoveDialog.ts:336</code> | <code>"새 그룹 만들기"</code> |  |
| <code>nameItAndMoveRightAway</code> | <code>src/ui/BatchGroupMoveDialog.ts:340</code> | <code>"이름을 정하고 바로 옮겨요"</code> |  |
| <code>backToGroupList</code> | <code>src/ui/BatchGroupMoveDialog.ts:366</code> | <code>"그룹 목록으로"</code> |  |
| <code>newGroupName</code> | <code>src/ui/BatchGroupMoveDialog.ts:380</code> | <code>"새 그룹 이름"</code> |  |
| <code>eGSupportingCast</code> | <code>src/ui/BatchGroupMoveDialog.ts:389</code> | <code>"예: 조연"</code> |  |
| <code>createAGroupAndMoveTheValueSelected</code> | <code>src/ui/BatchGroupMoveDialog.ts:396</code> | <code>`새 그룹을 만들고 선택한 ${this.opts.selectedCount}명을 바로 옮겨요.`</code> | <code>arg1 = this.opts.selectedCount</code> |
| <code>cancel</code> | <code>src/ui/BatchGroupMoveDialog.ts:414</code> | <code>"취소"</code> |  |
| <code>moveValueCharacters</code> | <code>src/ui/BatchGroupMoveDialog.ts:421</code> | <code>`${this.opts.selectedCount}명 옮기기`</code> | <code>arg1 = this.opts.selectedCount</code> |
| <code>thisGroupAlreadyExistsChooseItFromThe</code> | <code>src/ui/BatchGroupMoveDialog.ts:477</code> | <code>"이미 있는 그룹이에요. 그룹 목록에서 선택해 주세요."</code> |  |
| <code>allSelectedCharactersAreAlreadyInValueEnter</code> | <code>src/ui/BatchGroupMoveDialog.ts:478</code> | <code>`선택한 캐릭터가 이미 모두 ‘${name}’ 그룹에 있어요. 다른 이름을 입력해 주세요.`</code> | <code>arg1 = name</code> |
| <code>moveValueCharacters</code> | <code>src/ui/BatchGroupMoveDialog.ts:492</code> | <code>`${this.opts.selectedCount}명 옮기기`</code> | <code>arg1 = this.opts.selectedCount</code> |
| <code>createAndMoveValueCharacters</code> | <code>src/ui/BatchGroupMoveDialog.ts:496</code> | <code>`만들고 ${this.opts.selectedCount}명 옮기기`</code> | <code>arg1 = this.opts.selectedCount</code> |
| <code>name</code> | <code>src/ui/CharacterNameModal.ts:51</code> | <code>"이름"</code> |  |
| <code>characterName</code> | <code>src/ui/CharacterNameModal.ts:60</code> | <code>"캐릭터 이름"</code> |  |
| <code>cover</code> | <code>src/ui/CoverPickerModal.ts:99</code> | <code>"커버"</code> |  |
| <code>add</code> | <code>src/ui/CoverPickerModal.ts:127</code> | <code>"추가"</code> |  |
| <code>file</code> | <code>src/ui/CoverPickerModal.ts:144</code> | <code>"파일"</code> |  |
| <code>youCanSelectSeveralImagesAtOnce</code> | <code>src/ui/CoverPickerModal.ts:146</code> | <code>"여러 이미지를 한 번에 선택할 수 있어요"</code> |  |
| <code>link</code> | <code>src/ui/CoverPickerModal.ts:167</code> | <code>"링크"</code> |  |
| <code>httpsOrVaultPath</code> | <code>src/ui/CoverPickerModal.ts:182</code> | <code>"https://… 또는 vault 경로"</code> |  |
| <code>apply</code> | <code>src/ui/CoverPickerModal.ts:191</code> | <code>"적용"</code> |  |
| <code>resetToDefault</code> | <code>src/ui/CoverPickerModal.ts:204</code> | <code>"기본으로"</code> |  |
| <code>automaticallyUseTheNoteSFirstImage</code> | <code>src/ui/CoverPickerModal.ts:208</code> | <code>"노트의 첫 이미지를 자동으로 사용"</code> |  |
| <code>noCover</code> | <code>src/ui/CoverPickerModal.ts:218</code> | <code>"커버 없음"</code> |  |
| <code>hideTheCardCoverAndKeepTheImages</code> | <code>src/ui/CoverPickerModal.ts:222</code> | <code>"이미지는 남기고 카드 커버만 숨김"</code> |  |
| <code>currentCover</code> | <code>src/ui/CoverPickerModal.ts:245</code> | <code>"현재 커버"</code> |  |
| <code>currentCover</code> | <code>src/ui/CoverPickerModal.ts:249</code> | <code>"현재 커버"</code> |  |
| <code>noCover</code> | <code>src/ui/CoverPickerModal.ts:249</code> | <code>"커버 없음"</code> |  |
| <code>choose</code> | <code>src/ui/CoverPickerModal.ts:252</code> | <code>"고르기"</code> |  |
| <code>valueImagesTotal</code> | <code>src/ui/CoverPickerModal.ts:253</code> | <code>`총 ${this.images.length}장`</code> | <code>arg1 = this.images.length</code> |
| <code>addAnImage</code> | <code>src/ui/CoverPickerModal.ts:255</code> | <code>"이미지를 추가해 주세요."</code> |  |
| <code>selectImageValueValueAsCover</code> | <code>src/ui/CoverPickerModal.ts:262</code> | <code>`${position + 1}번 ${label} 커버로 선택`</code> | <code>arg1 = position + 1</code>; <code>arg2 = label</code> |
| <code>current</code> | <code>src/ui/CoverPickerModal.ts:266</code> | <code>"현재"</code> |  |
| <code>valueAltArrowKeysToReorder</code> | <code>src/ui/CoverPickerModal.ts:273</code> | <code>`${label} · Alt + 방향키로 순서 변경`</code> | <code>arg1 = label</code> |
| <code>removeImageValue</code> | <code>src/ui/CoverPickerModal.ts:281</code> | <code>`${position + 1}번 이미지 제거`</code> | <code>arg1 = position + 1</code> |
| <code>chooseAnotherCoverImageBeforeRemovingThisOne</code> | <code>src/ui/CoverPickerModal.ts:282</code> | <code>"다른 이미지를 커버로 선택한 뒤 제거할 수 있어요"</code> |  |
| <code>removeImage</code> | <code>src/ui/CoverPickerModal.ts:282</code> | <code>"이미지 제거"</code> |  |
| <code>couldNotReorder</code> | <code>src/ui/CoverPickerModal.ts:294</code> | <code>"순서를 바꾸지 못했어요."</code> |  |
| <code>couldNotReloadTheViewTryAgain</code> | <code>src/ui/CoverPickerModal.ts:320</code> | <code>"화면을 새로 불러오지 못했어요. 다시 시도해 주세요."</code> |  |
| <code>couldNotReorder</code> | <code>src/ui/CoverPickerModal.ts:333</code> | <code>"순서를 바꾸지 못했어요."</code> |  |
| <code>imageRemoved</code> | <code>src/ui/CoverPickerModal.ts:350</code> | <code>"이미지를 제거했어요. "</code> |  |
| <code>undo</code> | <code>src/ui/CoverPickerModal.ts:351</code> | <code>"되돌리기"</code> |  |
| <code>undoImageRemoval</code> | <code>src/ui/CoverPickerModal.ts:351</code> | <code>"이미지 제거 되돌리기"</code> |  |
| <code>couldNotUndo</code> | <code>src/ui/CoverPickerModal.ts:359</code> | <code>"되돌리지 못했어요."</code> |  |
| <code>couldNotRemoveTheImage</code> | <code>src/ui/CoverPickerModal.ts:365</code> | <code>"이미지를 제거하지 못했어요."</code> |  |
| <code>imageAdded</code> | <code>src/ui/CoverPickerModal.ts:379</code> | <code>"이미지를 추가했어요."</code> |  |
| <code>thisImageHasAlreadyBeenAdded</code> | <code>src/ui/CoverPickerModal.ts:379</code> | <code>"이미 추가한 이미지예요."</code> |  |
| <code>webImage</code> | <code>src/ui/CoverPickerModal.ts:390</code> | <code>"웹 이미지"</code> |  |
| <code>uploadingValueValue</code> | <code>src/ui/CoverPickerModal.ts:485</code> | <code>`올리는 중… ${index + 1}/${files.length}`</code> | <code>arg1 = index + 1</code>; <code>arg2 = files.length</code> |
| <code>valueNotAnImageFile</code> | <code>src/ui/CoverPickerModal.ts:487</code> | <code>`${file.name}: 이미지 파일 아님`</code> | <code>arg1 = file.name</code> |
| <code>valueMaximum25mb</code> | <code>src/ui/CoverPickerModal.ts:491</code> | <code>`${file.name}: 최대 25MB`</code> | <code>arg1 = file.name</code> |
| <code>saveFailed</code> | <code>src/ui/CoverPickerModal.ts:510</code> | <code>"저장 실패"</code> |  |
| <code>coverRemainsHidden</code> | <code>src/ui/CoverPickerModal.ts:528</code> | <code>" · 커버 숨김 유지"</code> |  |
| <code>firstImageIsTheCover</code> | <code>src/ui/CoverPickerModal.ts:530</code> | <code>" · 첫 이미지가 커버"</code> |  |
| <code>coverUnchanged</code> | <code>src/ui/CoverPickerModal.ts:531</code> | <code>" · 커버 그대로"</code> |  |
| <code>valueImagesSavedInVault</code> | <code>src/ui/CoverPickerModal.ts:532</code> | <code>` · ${vaultFallbacks}장 vault에 저장`</code> | <code>arg1 = vaultFallbacks</code> |
| <code>valueImagesFailedValueValue</code> | <code>src/ui/CoverPickerModal.ts:534</code> | <code>` · ${failed.length}장 실패: ${failed.slice(0, 2).join(", ")}${failed.length &gt; 2 ? " 외" : ""}`</code> | <code>arg1 = failed.length</code>; <code>arg2 = failed.slice(0, 2).join(", ")</code>; <code>arg3 = failed.length &gt; 2 ? " 외" : ""</code> |
| <code>andMore</code> | <code>src/ui/CoverPickerModal.ts:534</code> | <code>" 외"</code> |  |
| <code>reopenTheGalleryToCheck</code> | <code>src/ui/CoverPickerModal.ts:536</code> | <code>" · 갤러리를 다시 열어 확인하세요"</code> |  |
| <code>addedValueImagesValueValueValueValue</code> | <code>src/ui/CoverPickerModal.ts:537</code> | <code>`${added}장 추가${coverMessage}${fallbackMessage}${failedMessage}${refreshMessage}`</code> | <code>arg1 = added</code>; <code>arg2 = coverMessage</code>; <code>arg3 = fallbackMessage</code>; <code>arg4 = failedMessage</code>; <code>arg5 = refreshMessage</code> |
| <code>valueImagesFailedValue</code> | <code>src/ui/CoverPickerModal.ts:542</code> | <code>` · ${failed.length}장 실패: ${failed.slice(0, 2).join(", ")}`</code> | <code>arg1 = failed.length</code>; <code>arg2 = failed.slice(0, 2).join(", ")</code> |
| <code>failedValue</code> | <code>src/ui/CoverPickerModal.ts:544</code> | <code>`실패: ${String(error)}`</code> | <code>arg1 = String(error)</code> |
| <code>enterALink</code> | <code>src/ui/CoverPickerModal.ts:554</code> | <code>"링크를 입력하세요."</code> |  |
| <code>processing</code> | <code>src/ui/CoverPickerModal.ts:561</code> | <code>"처리 중…"</code> |  |
| <code>onlyHttpsIsSupported</code> | <code>src/ui/CoverPickerModal.ts:571</code> | <code>"https만 가능해요."</code> |  |
| <code>couldNotFindTheImage</code> | <code>src/ui/CoverPickerModal.ts:583</code> | <code>"이미지를 찾지 못했어요."</code> |  |
| <code>failedValue</code> | <code>src/ui/CoverPickerModal.ts:588</code> | <code>`실패: ${error instanceof Error ? error.message : String(error)}`</code> | <code>arg1 = error instanceof Error ? error.message : String(error)</code> |
| <code>couldNotSaveValue</code> | <code>src/ui/CoverPickerModal.ts:654</code> | <code>`저장 실패: ${error instanceof Error ? error.message : String(error)}`</code> | <code>arg1 = error instanceof Error ? error.message : String(error)</code> |
| <code>couldNotSaveCover</code> | <code>src/ui/CoverPickerModal.ts:657</code> | <code>"커버 저장 실패"</code> |  |
| <code>keepTheFolderUnchangedToSeeTheSame</code> | <code>src/ui/CreateGalleryModal.ts:48</code> | <code>"같은 카드를 보려면 폴더를 그대로 두세요. 카드를 따로 나누려면 아래에 새 폴더 이름을 적으세요."</code> |  |
| <code>tabName</code> | <code>src/ui/CreateGalleryModal.ts:52</code> | <code>"탭 이름"</code> |  |
| <code>nameShownInTheFileListAndTab</code> | <code>src/ui/CreateGalleryModal.ts:53</code> | <code>"파일 목록과 탭에 보이는 이름"</code> |  |
| <code>nameToShowInTheTab</code> | <code>src/ui/CreateGalleryModal.ts:56</code> | <code>"탭에 보일 이름"</code> |  |
| <code>folderContainingCards</code> | <code>src/ui/CreateGalleryModal.ts:64</code> | <code>"카드가 있는 폴더"</code> |  |
| <code>theCardLibraryForThisTabKeepIt</code> | <code>src/ui/CreateGalleryModal.ts:66</code> | <code>"이 탭이 볼 카드 상자입니다. 그대로 두면 지금과 같은 카드예요. 나누고 싶으면 새 이름을 적으세요. 없는 폴더는 만들어 줍니다."</code> |  |
| <code>archiveNameAboveTheGallery</code> | <code>src/ui/CreateGalleryModal.ts:78</code> | <code>"맨 위 작품 이름"</code> |  |
| <code>theNameAboveTheGalleryLeaveBlankTo</code> | <code>src/ui/CreateGalleryModal.ts:80</code> | <code>"갤러리 맨 위에 있는 그 이름입니다. 비우면 이름을 눌러 다른 작품으로 바꿀 수 있어요. 적으면 이 탭은 그 작품만 보고, 이름을 눌러도 바뀌지 않아요."</code> |  |
| <code>leaveBlankToAllowSwitchingByClick</code> | <code>src/ui/CreateGalleryModal.ts:84</code> | <code>"비우면 눌러서 바꿀 수 있음"</code> |  |
| <code>filterChipsForThisTabOptional</code> | <code>src/ui/CreateGalleryModal.ts:92</code> | <code>"이 창의 칩 (선택)"</code> |  |
| <code>whatTheOnOffChipsFilterLeaveBlank</code> | <code>src/ui/CreateGalleryModal.ts:93</code> | <code>"맨 위 On/Off 칩이 무엇을 거를지. 비우면 설정을 따릅니다."</code> |  |
| <code>usePluginDefault</code> | <code>src/ui/CreateGalleryModal.ts:95</code> | <code>"설정 기본값 따르기"</code> |  |
| <code>create</code> | <code>src/ui/CreateGalleryModal.ts:115</code> | <code>"만들기"</code> |  |
| <code>initialChipOptional</code> | <code>src/ui/CreateGalleryModal.ts:131</code> | <code>"처음 켤 칩 (선택)"</code> |  |
| <code>theChipSelectedWhenThisTabFirstOpens</code> | <code>src/ui/CreateGalleryModal.ts:132</code> | <code>"이 창을 처음 열 때 고를 칩. 비워도 됩니다."</code> |  |
| <code>followSettings</code> | <code>src/ui/CreateGalleryModal.ts:134</code> | <code>"설정값 따르기"</code> |  |
| <code>all</code> | <code>src/ui/CreateGalleryModal.ts:135</code> | <code>"전체"</code> |  |
| <code>couldNotCreateValue</code> | <code>src/ui/CreateGalleryModal.ts:168</code> | <code>`만들기 실패: ${error instanceof Error ? error.message : String(error)}`</code> | <code>arg1 = error instanceof Error ? error.message : String(error)</code> |
| <code>renameGroup</code> | <code>src/ui/GroupRenameDialog.ts:68</code> | <code>"그룹 이름 바꾸기"</code> |  |
| <code>newGroupName</code> | <code>src/ui/GroupRenameDialog.ts:75</code> | <code>"새 그룹 이름"</code> |  |
| <code>cancel</code> | <code>src/ui/GroupRenameDialog.ts:100</code> | <code>"취소"</code> |  |
| <code>rename</code> | <code>src/ui/GroupRenameDialog.ts:106</code> | <code>"이름 바꾸기"</code> |  |
| <code>renamingGroup</code> | <code>src/ui/GroupRenameDialog.ts:158</code> | <code>"그룹 이름을 바꾸는 중…"</code> |  |
| <code>archiveName</code> | <code>src/ui/RenameGenreModal.ts:29</code> | <code>"아카이브 이름"</code> |  |
| <code>youCanChooseANewArchiveName</code> | <code>src/ui/RenameGenreModal.ts:33</code> | <code>"원하는 아카이브 이름으로 바꿀 수 있어요."</code> |  |
| <code>newName</code> | <code>src/ui/RenameGenreModal.ts:39</code> | <code>"새 이름"</code> |  |
| <code>change</code> | <code>src/ui/RenameGenreModal.ts:59</code> | <code>"바꾸기"</code> |  |
| <code>enterAnArchiveName</code> | <code>src/ui/RenameGenreModal.ts:73</code> | <code>"아카이브 이름을 입력하세요."</code> |  |
| <code>stopSharing</code> | <code>src/ui/SettingTab.ts:52</code> | <code>"공유 중지할까요?"</code> |  |
| <code>thePublicPageForValueWillBeRemoved</code> | <code>src/ui/SettingTab.ts:54</code> | <code>`${this.label}의 공개 페이지를 서버에서 지웁니다. 이미 열린 사본은 잠시 남을 수 있어요.`</code> | <code>arg1 = this.label</code> |
| <code>cancel</code> | <code>src/ui/SettingTab.ts:66</code> | <code>"취소"</code> |  |
| <code>stopSharing2</code> | <code>src/ui/SettingTab.ts:71</code> | <code>"공유 중지"</code> |  |
| <code>couldNotStopSharingTheLinkIsStill</code> | <code>src/ui/SettingTab.ts:81</code> | <code>"멈추지 못했어요. 링크는 아직 열려 있어요."</code> |  |
| <code>archiveTheNameAboveTheGallery</code> | <code>src/ui/SettingTab.ts:109</code> | <code>"큰 묶음 = 갤러리 맨 위에 있는 이름"</code> |  |
| <code>groupTheHeadingAboveARowOfCards</code> | <code>src/ui/SettingTab.ts:110</code> | <code>"작은 묶음 = 카드 줄 위에 있는 제목"</code> |  |
| <code>tabAnotherViewOfTheSameCardsIt</code> | <code>src/ui/SettingTab.ts:112</code> | <code>"창 = 같은 카드를 다른 탭으로 보는 것."</code> |  |
| <code>folderContainingCards</code> | <code>src/ui/SettingTab.ts:116</code> | <code>"카드가 있는 폴더"</code> |  |
| <code>theLibraryContainingCharacterNotesChangingItMay</code> | <code>src/ui/SettingTab.ts:118</code> | <code>"캐릭터 노트가 들어 있는 상자입니다. 여기를 바꾸면 카드가 안 보일 수 있어요."</code> |  |
| <code>imagesReconnectedValueNotesValueValue</code> | <code>src/ui/SettingTab.ts:147</code> | <code>`이미지 다시 연결됨 · 노트 ${n}개\n(${fromFolder} → ${toFolder})`</code> | <code>arg1 = n</code>; <code>arg2 = fromFolder</code>; <code>arg3 = toFolder</code> |
| <code>initialArchive</code> | <code>src/ui/SettingTab.ts:157</code> | <code>"처음 보여줄 큰 묶음"</code> |  |
| <code>theArchiveShownWhenOpeningTheGalleryUse</code> | <code>src/ui/SettingTab.ts:159</code> | <code>"갤러리를 열면 맨 위에 나올 이름입니다. 화면에 보이는 글자와 같아야 해요. 각 창은 마지막으로 고른 묶음을 따로 기억합니다."</code> |  |
| <code>nameToShowAboveTheGallery</code> | <code>src/ui/SettingTab.ts:163</code> | <code>"맨 위에 보일 이름"</code> |  |
| <code>newCardTemplate</code> | <code>src/ui/SettingTab.ts:173</code> | <code>"새 카드 양식"</code> |  |
| <code>aBlankNoteUsedToCreateNewCards</code> | <code>src/ui/SettingTab.ts:174</code> | <code>"새 카드를 만들 때 쓰는 빈 노트. 비워 두면 플러그인 기본 양식."</code> |  |
| <code>leaveBlankForTheBuiltInTemplate</code> | <code>src/ui/SettingTab.ts:177</code> | <code>"비우면 플러그인 기본 템플릿"</code> |  |
| <code>perArchiveTemplateLocationsValue</code> | <code>src/ui/SettingTab.ts:190</code> | <code>`아카이브별로 다른 템플릿을 쓰는 곳: ${templateOverrides&#10;            .map(([genre, path]) =&gt; `${genre} → ${path}`)&#10;            .join(", ")}`</code> | <code>arg1 = templateOverrides&#10;            .map(([genre, path]) =&gt; `${genre} → ${path}`)&#10;            .join(", ")</code> |
| <code>pathsForSeparateArchiveTemplatesAppearHere</code> | <code>src/ui/SettingTab.ts:193</code> | <code>"큰 묶음마다 다른 양식을 쓰려면 여기에 경로가 나타납니다."</code> |  |
| <code>images</code> | <code>src/ui/SettingTab.ts:199</code> | <code>"그림"</code> |  |
| <code>existingImagesStayUnchangedOnlyNewlyUploadedFiles</code> | <code>src/ui/SettingTab.ts:201</code> | <code>"이미 넣은 그림은 그대로 둡니다. 새로 올리는 파일만 아래 위치에 저장됩니다."</code> |  |
| <code>newImageLocation</code> | <code>src/ui/SettingTab.ts:206</code> | <code>"새 그림 위치"</code> |  |
| <code>theVaultFolderIsTheDefaultUseAn</code> | <code>src/ui/SettingTab.ts:207</code> | <code>"보관함 폴더가 기본입니다. 바깥 폴더는 용량이 클 때만."</code> |  |
| <code>vaultFolderDefault</code> | <code>src/ui/SettingTab.ts:210</code> | <code>"보관함 폴더 (기본)"</code> |  |
| <code>externalFolderOptional</code> | <code>src/ui/SettingTab.ts:211</code> | <code>"바깥 폴더 (선택)"</code> |  |
| <code>coverFileUploads</code> | <code>src/ui/SettingTab.ts:222</code> | <code>"커버 / 파일 업로드"</code> |  |
| <code>theCoverPickerShowsFilesAndLinksOnly</code> | <code>src/ui/SettingTab.ts:225</code> | <code>"커버 팝업은 파일/링크만 보여요. Imgur로 올릴지는 여기서만 고릅니다."</code> |  |
| <code>theCoverPickerShowsFilesAndLinksOnly2</code> | <code>src/ui/SettingTab.ts:226</code> | <code>"커버 팝업은 파일/링크만 보여요. Imgur 플러그인을 켜면 여기서 원격 업로드를 고를 수 있어요."</code> |  |
| <code>vaultDefault</code> | <code>src/ui/SettingTab.ts:229</code> | <code>"보관함 (기본)"</code> |  |
| <code>imgurPlugin</code> | <code>src/ui/SettingTab.ts:230</code> | <code>"Imgur 플러그인"</code> |  |
| <code>imageFolderInVault</code> | <code>src/ui/SettingTab.ts:245</code> | <code>"보관함 안 그림 폴더"</code> |  |
| <code>usedWhenSavingNewImagesInTheVault</code> | <code>src/ui/SettingTab.ts:246</code> | <code>"새 그림 위치가 보관함일 때. 보관함 기준 상대 경로."</code> |  |
| <code>externalImageFolder</code> | <code>src/ui/SettingTab.ts:260</code> | <code>"바깥 그림 폴더"</code> |  |
| <code>fullPathOnYourComputerRequiredOnlyWhen</code> | <code>src/ui/SettingTab.ts:262</code> | <code>"컴퓨터 전체 경로. 새 그림 위치를 바깥 폴더로 골랐을 때만 필요해요."</code> |  |
| <code>createImageFolder</code> | <code>src/ui/SettingTab.ts:275</code> | <code>"그림 폴더 만들기"</code> |  |
| <code>createsTheImageFolderIfItDoesNot</code> | <code>src/ui/SettingTab.ts:276</code> | <code>"없으면 그림 폴더를 만듭니다."</code> |  |
| <code>createFolder</code> | <code>src/ui/SettingTab.ts:278</code> | <code>"폴더 만들기"</code> |  |
| <code>theImageFolderIsReady</code> | <code>src/ui/SettingTab.ts:280</code> | <code>"그림 폴더를 준비했어요."</code> |  |
| <code>defaultEditMode</code> | <code>src/ui/SettingTab.ts:285</code> | <code>"기본 편집 모드"</code> |  |
| <code>openTheGalleryInEditModeWhenEnabled</code> | <code>src/ui/SettingTab.ts:286</code> | <code>"켜면 갤러리를 편집 모드로 엽니다. 끄면 읽기(드래그·일괄 편집 잠금)."</code> |  |
| <code>webSharing</code> | <code>src/ui/SettingTab.ts:294</code> | <code>"웹 공유"</code> |  |
| <code>onlyWhenYouShareSelectedCardDetailsAnd</code> | <code>src/ui/SettingTab.ts:296</code> | <code>"공유를 누를 때만 선택한 카드 정보와 표지를 기본 공개 서버에 올려 링크를 만들어요. 다른 서버를 쓸 때만 주소를 바꾸세요. GitHub는 선택이에요."</code> |  |
| <code>shareServerAddress</code> | <code>src/ui/SettingTab.ts:301</code> | <code>"공유 주소"</code> |  |
| <code>leaveBlankToUseTheDefaultShareServer</code> | <code>src/ui/SettingTab.ts:302</code> | <code>"비우면 기본 공유 서버로 돌아가요. 끝의 / 는 빼 주세요."</code> |  |
| <code>uploadKeyOptional</code> | <code>src/ui/SettingTab.ts:317</code> | <code>"업로드 열쇠 (선택)"</code> |  |
| <code>enterOnlyIfYourOwnShareServerRequires</code> | <code>src/ui/SettingTab.ts:318</code> | <code>"직접 운영한 공유 서버가 열쇠를 요구할 때만 입력하세요."</code> |  |
| <code>defaultLinkLifetime</code> | <code>src/ui/SettingTab.ts:332</code> | <code>"기본 유지 기간"</code> |  |
| <code>howLongTheLinkStaysAvailableYouCan</code> | <code>src/ui/SettingTab.ts:333</code> | <code>"링크가 얼마나 살아 있을지. 공유 창에서도 바꿀 수 있어요."</code> |  |
| <code>7Days</code> | <code>src/ui/SettingTab.ts:336</code> | <code>"7일"</code> |  |
| <code>30Days</code> | <code>src/ui/SettingTab.ts:337</code> | <code>"30일"</code> |  |
| <code>1Year</code> | <code>src/ui/SettingTab.ts:338</code> | <code>"1년"</code> |  |
| <code>githubBackupConnection</code> | <code>src/ui/SettingTab.ts:351</code> | <code>"GitHub 백업 연결"</code> |  |
| <code>connectedValue</code> | <code>src/ui/SettingTab.ts:354</code> | <code>`연결됨 · ${this.plugin.settings.webShareGithubRepo &#124;&#124; "—"}`</code> | <code>arg1 = this.plugin.settings.webShareGithubRepo &#124;&#124; "—"</code> |
| <code>neededOnlyToPublishToYourGithubInstead</code> | <code>src/ui/SettingTab.ts:355</code> | <code>"공유 주소 대신 내 GitHub에 올릴 때만 필요해요. 갤러리 → 지구본 → 「내 GitHub에 연결」."</code> |  |
| <code>disconnect</code> | <code>src/ui/SettingTab.ts:358</code> | <code>"연결 끊기"</code> |  |
| <code>help</code> | <code>src/ui/SettingTab.ts:358</code> | <code>"안내"</code> |  |
| <code>openTheGalleryThenChooseShareGlobeIcon</code> | <code>src/ui/SettingTab.ts:361</code> | <code>"갤러리를 연 뒤 공유(지구본) → 아래쪽 「내 GitHub에 연결」을 누르세요."</code> |  |
| <code>disconnectedFromGithub</code> | <code>src/ui/SettingTab.ts:368</code> | <code>"GitHub 연결을 해제했어요."</code> |  |
| <code>untitledNote</code> | <code>src/ui/SettingTab.ts:393</code> | <code>"이름 없는 노트"</code> |  |
| <code>character</code> | <code>src/ui/SettingTab.ts:398</code> | <code>"캐릭터"</code> |  |
| <code>gallery</code> | <code>src/ui/SettingTab.ts:398</code> | <code>"갤러리"</code> |  |
| <code>sourceNoteMissing</code> | <code>src/ui/SettingTab.ts:401</code> | <code>"원본 노트 없음"</code> |  |
| <code>previousLink</code> | <code>src/ui/SettingTab.ts:427</code> | <code>"이전 링크"</code> |  |
| <code>sourceNoteNotLinked</code> | <code>src/ui/SettingTab.ts:428</code> | <code>"원본 노트 연결 안 됨"</code> |  |
| <code>youCanCheckAndStopPublicLinksHere</code> | <code>src/ui/SettingTab.ts:451</code> | <code>"노트를 옮기거나 지워도 여기서 공개 링크를 확인하고 멈출 수 있어요."</code> |  |
| <code>thereAreNoActivePublicLinks</code> | <code>src/ui/SettingTab.ts:452</code> | <code>"공개 중인 링크가 없어요."</code> |  |
| <code>copy</code> | <code>src/ui/SettingTab.ts:464</code> | <code>"복사"</code> |  |
| <code>linkCopied</code> | <code>src/ui/SettingTab.ts:466</code> | <code>"링크를 복사했어요."</code> |  |
| <code>couldNotCopyTheLink</code> | <code>src/ui/SettingTab.ts:466</code> | <code>"링크를 복사하지 못했어요."</code> |  |
| <code>stopSharing2</code> | <code>src/ui/SettingTab.ts:471</code> | <code>"공유 중지"</code> |  |
| <code>couldNotDetermineTheShareLinkAddress</code> | <code>src/ui/SettingTab.ts:495</code> | <code>"공유 링크 주소를 확인할 수 없어요."</code> |  |
| <code>sharingStoppedCopiesAlreadyOpenMayRemainBriefly</code> | <code>src/ui/SettingTab.ts:509</code> | <code>"공유를 중지했어요. 이미 열린 사본은 잠시 남을 수 있어요."</code> |  |
| <code>filters</code> | <code>src/ui/SettingTab.ts:514</code> | <code>"필터"</code> |  |
| <code>toChangeLabelsSuchAsStatusAndRelationship</code> | <code>src/ui/SettingTab.ts:517</code> | <code>"상태·관계 같은 이름과 값은 갤러리에서 연필을 켠 뒤 책 아이콘으로 바꿉니다. 여기는 기본값만 둡니다."</code> |  |
| <code>propertyFilteredByTheChips</code> | <code>src/ui/SettingTab.ts:522</code> | <code>"맨 위 칩이 거르는 항목"</code> |  |
| <code>whichFieldChipsSuchAsOnOffFilter</code> | <code>src/ui/SettingTab.ts:524</code> | <code>"On/Off 같은 칩이 어떤 칸을 보는지. 바꾸면 칩은 전체로 돌아갑니다."</code> |  |
| <code>valueHasNoOptionsAddThemInGallery</code> | <code>src/ui/SettingTab.ts:548</code> | <code>`«${axisLabel(this.plugin.settings.primaryFilterProperty, this.plugin.settings.propertyDisplayNames)}»에 고를 값이 없어요. 갤러리 편집 → 속성 관리에서 추가해 주세요.`</code> | <code>arg1 = axisLabel(this.plugin.settings.primaryFilterProperty, this.plugin.settings.propertyDisplayNames)</code> |
| <code>defaultStatusForNewCharacters</code> | <code>src/ui/SettingTab.ts:553</code> | <code>"새 캐릭터 기본 상태"</code> |  |
| <code>theStatusInitiallySetOnNewlyCreatedCards</code> | <code>src/ui/SettingTab.ts:554</code> | <code>"새로 만든 카드에 처음 넣을 상태."</code> |  |
| <code>valueAndValueMore</code> | <code>src/ui/ShareGalleryModal.ts:252</code> | <code>`${archives[0]} 외 ${archives.length - 1}`</code> | <code>arg1 = archives[0]</code>; <code>arg2 = archives.length - 1</code> |
| <code>shareCharacter</code> | <code>src/ui/ShareGalleryModal.ts:285</code> | <code>"캐릭터 공유"</code> |  |
| <code>shareGallery</code> | <code>src/ui/ShareGalleryModal.ts:285</code> | <code>"갤러리 공유"</code> |  |
| <code>invalidShareServerAddressCheckSettings</code> | <code>src/ui/ShareGalleryModal.ts:294</code> | <code>"공유 주소가 올바르지 않아요. 설정에서 확인하세요."</code> |  |
| <code>thisPublicLinkUsesAnOlderFormatUpdate</code> | <code>src/ui/ShareGalleryModal.ts:320</code> | <code>"이 공개 링크는 이전 형식이에요. 지금 형식으로 업데이트하거나 공유를 중지할 수 있어요."</code> |  |
| <code>aPublicLinkExistsUpdateItAfterChanging</code> | <code>src/ui/ShareGalleryModal.ts:321</code> | <code>"공개 링크가 있어요. 내용을 바꾼 뒤 업데이트하거나, 공유를 중지할 수 있어요."</code> |  |
| <code>thisDeviceCannotUpdateOrStopTheOld</code> | <code>src/ui/ShareGalleryModal.ts:323</code> | <code>"예전에 만든 링크는 이 기기에서 갱신·중지할 수 없어요. 새 링크를 만드세요."</code> |  |
| <code>chooseArchivesGroupsAndContentToIncludeThen</code> | <code>src/ui/ShareGalleryModal.ts:324</code> | <code>"넣을 아카이브·그룹과 범위를 고른 뒤 공유하세요."</code> |  |
| <code>sharingUploadsSelectedCardDetailsAndCoversTo</code> | <code>src/ui/ShareGalleryModal.ts:329</code> | <code>"공유하면 선택한 카드 정보와 표지가 공개 페이지로 올라가요. 링크가 있는 사람은 누구나 볼 수 있어요."</code> |  |
| <code>updateThisLink</code> | <code>src/ui/ShareGalleryModal.ts:344</code> | <code>"이 링크 업데이트"</code> |  |
| <code>createNewLink</code> | <code>src/ui/ShareGalleryModal.ts:350</code> | <code>"새 링크 만들기"</code> |  |
| <code>createShareLink</code> | <code>src/ui/ShareGalleryModal.ts:350</code> | <code>"공유 링크 만들기"</code> |  |
| <code>archive</code> | <code>src/ui/ShareGalleryModal.ts:377</code> | <code>"아카이브"</code> |  |
| <code>selectArchives</code> | <code>src/ui/ShareGalleryModal.ts:380</code> | <code>"아카이브 선택"</code> |  |
| <code>group</code> | <code>src/ui/ShareGalleryModal.ts:384</code> | <code>"그룹"</code> |  |
| <code>selectGroups</code> | <code>src/ui/ShareGalleryModal.ts:387</code> | <code>"그룹 선택"</code> |  |
| <code>none</code> | <code>src/ui/ShareGalleryModal.ts:404</code> | <code>"없음"</code> |  |
| <code>none</code> | <code>src/ui/ShareGalleryModal.ts:443</code> | <code>"없음"</code> |  |
| <code>all2</code> | <code>src/ui/ShareGalleryModal.ts:450</code> | <code>"모두"</code> |  |
| <code>noCardsSelected</code> | <code>src/ui/ShareGalleryModal.ts:484</code> | <code>"선택된 카드가 없어요."</code> |  |
| <code>valueCardsIncluded</code> | <code>src/ui/ShareGalleryModal.ts:484</code> | <code>`${n}장 포함`</code> | <code>arg1 = n</code> |
| <code>noteImages</code> | <code>src/ui/ShareGalleryModal.ts:493</code> | <code>"노트 이미지"</code> |  |
| <code>showAddedImagesOnTheWebToo</code> | <code>src/ui/ShareGalleryModal.ts:502</code> | <code>"추가한 이미지도 웹에 표시"</code> |  |
| <code>informationInTheSidePanel</code> | <code>src/ui/ShareGalleryModal.ts:506</code> | <code>"옆 패널에 보일 정보"</code> |  |
| <code>sidePanelHeadings</code> | <code>src/ui/ShareGalleryModal.ts:509</code> | <code>"옆 패널 헤더"</code> |  |
| <code>noHeadings</code> | <code>src/ui/ShareGalleryModal.ts:561</code> | <code>"헤더 없음"</code> |  |
| <code>informationGroups</code> | <code>src/ui/ShareGalleryModal.ts:569</code> | <code>"정보 그룹"</code> |  |
| <code>valueDetails</code> | <code>src/ui/ShareGalleryModal.ts:616</code> | <code>`${group.label} 세부`</code> | <code>arg1 = group.label</code> |
| <code>lifetime</code> | <code>src/ui/ShareGalleryModal.ts:690</code> | <code>"유지 기간"</code> |  |
| <code>linkLifetime</code> | <code>src/ui/ShareGalleryModal.ts:693</code> | <code>"링크 유지 기간"</code> |  |
| <code>7Days</code> | <code>src/ui/ShareGalleryModal.ts:703</code> | <code>"7일"</code> |  |
| <code>30Days</code> | <code>src/ui/ShareGalleryModal.ts:704</code> | <code>"30일"</code> |  |
| <code>1Year</code> | <code>src/ui/ShareGalleryModal.ts:705</code> | <code>"1년"</code> |  |
| <code>publicLink</code> | <code>src/ui/ShareGalleryModal.ts:740</code> | <code>"공개 링크"</code> |  |
| <code>stopSharing2</code> | <code>src/ui/ShareGalleryModal.ts:745</code> | <code>"공유 중지"</code> |  |
| <code>thisLinkCannotBeUpdatedCreateANew</code> | <code>src/ui/ShareGalleryModal.ts:752</code> | <code>"이 링크는 업데이트할 수 없어요. 위에서 새 링크를 만드세요."</code> |  |
| <code>sharingMethod</code> | <code>src/ui/ShareGalleryModal.ts:760</code> | <code>"공유 방식"</code> |  |
| <code>sharingMethod</code> | <code>src/ui/ShareGalleryModal.ts:763</code> | <code>"공유 방식"</code> |  |
| <code>defaultLink</code> | <code>src/ui/ShareGalleryModal.ts:766</code> | <code>"기본 링크"</code> |  |
| <code>otherMethodsOptional</code> | <code>src/ui/ShareGalleryModal.ts:799</code> | <code>"다른 방법 (선택)"</code> |  |
| <code>connectMyGithub</code> | <code>src/ui/ShareGalleryModal.ts:806</code> | <code>"내 GitHub에 연결"</code> |  |
| <code>forAPermanentAddressUnderYourOwnAccount</code> | <code>src/ui/ShareGalleryModal.ts:810</code> | <code>"내 계정에 고정 주소로 올려 두고 싶을 때 (한 번만 설정)"</code> |  |
| <code>publicLink</code> | <code>src/ui/ShareGalleryModal.ts:847</code> | <code>"공개 링크"</code> |  |
| <code>copy</code> | <code>src/ui/ShareGalleryModal.ts:864</code> | <code>"복사"</code> |  |
| <code>myGithubConnection</code> | <code>src/ui/ShareGalleryModal.ts:871</code> | <code>"내 GitHub 연결"</code> |  |
| <code>uploadYourGalleryPageToGithubToShare</code> | <code>src/ui/ShareGalleryModal.ts:874</code> | <code>"내 GitHub에 갤러리 페이지를 올려 두면, 바뀌지 않는 주소로 공유할 수 있어요. 아래는 한 번만 하면 됩니다."</code> |  |
| <code>followTheseSteps</code> | <code>src/ui/ShareGalleryModal.ts:880</code> | <code>"이렇게 하세요"</code> |  |
| <code>clickCreateAGithubKeyToOpenYour</code> | <code>src/ui/ShareGalleryModal.ts:884</code> | <code>"「GitHub에서 키 만들기」를 눌러 브라우저를 엽니다."</code> |  |
| <code>clickTheGreenGenerateTokenButtonLeavePublic</code> | <code>src/ui/ShareGalleryModal.ts:887</code> | <code>"초록 버튼 Generate token 을 누릅니다. (public_repo 칸이 이미 체크돼 있으면 그대로 두세요.)"</code> |  |
| <code>copyTheLongKeyShownOnScreenPaste</code> | <code>src/ui/ShareGalleryModal.ts:890</code> | <code>"화면에 나온 긴 글자(키)를 복사한 뒤, 아래 칸에 붙여넣고 「연결하기」를 누릅니다."</code> |  |
| <code>githubShowsTheKeyOnlyOnceItIs</code> | <code>src/ui/ShareGalleryModal.ts:894</code> | <code>"키는 GitHub가 한 번만 보여 줍니다. 이 앱 설정에만 저장되며, 다른 사람과 나누지 마세요."</code> |  |
| <code>createAGithubKey</code> | <code>src/ui/ShareGalleryModal.ts:899</code> | <code>"GitHub에서 키 만들기"</code> |  |
| <code>pasteTheCopiedKey</code> | <code>src/ui/ShareGalleryModal.ts:906</code> | <code>"복사한 키 붙여넣기"</code> |  |
| <code>pasteHere</code> | <code>src/ui/ShareGalleryModal.ts:911</code> | <code>"여기에 붙여넣기"</code> |  |
| <code>connect</code> | <code>src/ui/ShareGalleryModal.ts:921</code> | <code>"연결하기"</code> |  |
| <code>useDefaultSharing</code> | <code>src/ui/ShareGalleryModal.ts:927</code> | <code>"기본 공유로"</code> |  |
| <code>connecting</code> | <code>src/ui/ShareGalleryModal.ts:940</code> | <code>"연결 중…"</code> |  |
| <code>connectedASharingRepositoryWasAlsoCreatedValue</code> | <code>src/ui/ShareGalleryModal.ts:952</code> | <code>`연결됐어요. 공유용 저장소도 만들어 두었습니다.\n${setup.repo}`</code> | <code>arg1 = setup.repo</code> |
| <code>connectedValue2</code> | <code>src/ui/ShareGalleryModal.ts:953</code> | <code>`연결됐어요 · ${setup.repo}`</code> | <code>arg1 = setup.repo</code> |
| <code>couldNotConnectValue</code> | <code>src/ui/ShareGalleryModal.ts:960</code> | <code>`연결에 실패했어요: ${error instanceof Error ? error.message : String(error)}`</code> | <code>arg1 = error instanceof Error ? error.message : String(error)</code> |
| <code>couldNotConnectCheckTheKeyAgain</code> | <code>src/ui/ShareGalleryModal.ts:962</code> | <code>"연결에 실패했어요. 키를 다시 확인해 주세요."</code> |  |
| <code>shareViaGithub</code> | <code>src/ui/ShareGalleryModal.ts:970</code> | <code>"GitHub로 공유"</code> |  |
| <code>updatesTheContentAtTheSameGithubLink</code> | <code>src/ui/ShareGalleryModal.ts:981</code> | <code>"같은 GitHub 링크로 내용만 덮어씁니다. 받는 사람 주소를 바꿀 필요 없어요."</code> |  |
| <code>theAddressBelowIsPermanentClickUploadTo</code> | <code>src/ui/ShareGalleryModal.ts:982</code> | <code>"아래 주소가 고정 링크예요. 「GitHub에 올리기」로 바로 게시할 수 있어요."</code> |  |
| <code>publicLink</code> | <code>src/ui/ShareGalleryModal.ts:993</code> | <code>"공개 링크"</code> |  |
| <code>updateThisLink</code> | <code>src/ui/ShareGalleryModal.ts:997</code> | <code>"이 링크 업데이트"</code> |  |
| <code>uploadToGithub</code> | <code>src/ui/ShareGalleryModal.ts:997</code> | <code>"GitHub에 올리기"</code> |  |
| <code>uploadToGithub</code> | <code>src/ui/ShareGalleryModal.ts:1001</code> | <code>"GitHub에 올리기"</code> |  |
| <code>reconnectAccount</code> | <code>src/ui/ShareGalleryModal.ts:1009</code> | <code>"계정 다시 연결"</code> |  |
| <code>useDefaultSharing</code> | <code>src/ui/ShareGalleryModal.ts:1018</code> | <code>"기본 공유로"</code> |  |
| <code>thereIsNoLinkYet</code> | <code>src/ui/ShareGalleryModal.ts:1052</code> | <code>"아직 링크가 없어요."</code> |  |
| <code>linkCopied2</code> | <code>src/ui/ShareGalleryModal.ts:1056</code> | <code>"링크 복사됨"</code> |  |
| <code>copyFailed</code> | <code>src/ui/ShareGalleryModal.ts:1056</code> | <code>"복사 실패"</code> |  |
| <code>thereAreNoCardsToShareSelectArchives</code> | <code>src/ui/ShareGalleryModal.ts:1129</code> | <code>"공유할 카드가 없어요. 아카이브·그룹을 선택하세요."</code> |  |
| <code>theKeyToUpdateThisLinkIsMissing</code> | <code>src/ui/ShareGalleryModal.ts:1141</code> | <code>"업데이트할 링크 열쇠가 없어요. 새 링크를 만드세요."</code> |  |
| <code>updating</code> | <code>src/ui/ShareGalleryModal.ts:1147</code> | <code>"업데이트 중…"</code> |  |
| <code>creating</code> | <code>src/ui/ShareGalleryModal.ts:1147</code> | <code>"만드는 중…"</code> |  |
| <code>updating2</code> | <code>src/ui/ShareGalleryModal.ts:1155</code> | <code>"업데이트"</code> |  |
| <code>uploading</code> | <code>src/ui/ShareGalleryModal.ts:1155</code> | <code>"올리는 중"</code> |  |
| <code>1Year</code> | <code>src/ui/ShareGalleryModal.ts:1195</code> | <code>"1년"</code> |  |
| <code>7Days</code> | <code>src/ui/ShareGalleryModal.ts:1197</code> | <code>"7일"</code> |  |
| <code>30Days</code> | <code>src/ui/ShareGalleryModal.ts:1198</code> | <code>"30일"</code> |  |
| <code>contentUpdatedAtTheSameLink</code> | <code>src/ui/ShareGalleryModal.ts:1200</code> | <code>"같은 링크 내용이 갱신됐어요."</code> |  |
| <code>linkCreatedAvailableForValue</code> | <code>src/ui/ShareGalleryModal.ts:1201</code> | <code>`링크 생성됨 · ${ttlLabel} 유지.`</code> | <code>arg1 = ttlLabel</code> |
| <code>connectGithubFirst</code> | <code>src/ui/ShareGalleryModal.ts:1204</code> | <code>"먼저 GitHub를 연결하세요."</code> |  |
| <code>uploadingValueKb</code> | <code>src/ui/ShareGalleryModal.ts:1208</code> | <code>`올리는 중… ${Math.round(html.length / 1024)} KB`</code> | <code>arg1 = Math.round(html.length / 1024)</code> |
| <code>valueUpdatedRefreshInAboutAMinute</code> | <code>src/ui/ShareGalleryModal.ts:1219</code> | <code>`「${slug}」 갱신됨. 약 1분 후 새로고침.`</code> | <code>arg1 = slug</code> |
| <code>valuePublished</code> | <code>src/ui/ShareGalleryModal.ts:1220</code> | <code>`「${slug}」 게시됨.`</code> | <code>arg1 = slug</code> |
| <code>updatedCopyLink</code> | <code>src/ui/ShareGalleryModal.ts:1235</code> | <code>"업데이트됨 · 링크 복사"</code> |  |
| <code>linkCopied2</code> | <code>src/ui/ShareGalleryModal.ts:1235</code> | <code>"링크 복사됨"</code> |  |
| <code>published</code> | <code>src/ui/ShareGalleryModal.ts:1235</code> | <code>"게시 완료"</code> |  |
| <code>valueCopied</code> | <code>src/ui/ShareGalleryModal.ts:1240</code> | <code>`${note} 복사됨.`</code> | <code>arg1 = note</code> |
| <code>valueCopied</code> | <code>src/ui/ShareGalleryModal.ts:1244</code> | <code>`${note} 복사됨.`</code> | <code>arg1 = note</code> |
| <code>failedValue</code> | <code>src/ui/ShareGalleryModal.ts:1249</code> | <code>`실패: ${error instanceof Error ? error.message : String(error)}`</code> | <code>arg1 = error instanceof Error ? error.message : String(error)</code> |
| <code>updateFailed</code> | <code>src/ui/ShareGalleryModal.ts:1251</code> | <code>"업데이트 실패"</code> |  |
| <code>webPublishingFailed</code> | <code>src/ui/ShareGalleryModal.ts:1251</code> | <code>"웹 게시 실패"</code> |  |
| <code>theKeyToStopSharingThisLinkIs</code> | <code>src/ui/ShareGalleryModal.ts:1266</code> | <code>"중지할 링크 열쇠가 없어요."</code> |  |
| <code>stoppingSharing</code> | <code>src/ui/ShareGalleryModal.ts:1271</code> | <code>"공유 중지 중…"</code> |  |
| <code>sharingStoppedCopiesAlreadyOpenMayRemainBriefly2</code> | <code>src/ui/ShareGalleryModal.ts:1287</code> | <code>"공유 중지됨 · 이미 열린 사본은 잠시 남을 수 있어요."</code> |  |
| <code>sharingStoppedCachedCopiesMayRemainBriefly</code> | <code>src/ui/ShareGalleryModal.ts:1290</code> | <code>"공유가 중지됐어요. 캐시된 사본은 잠시 남을 수 있어요."</code> |  |
| <code>failedValue</code> | <code>src/ui/ShareGalleryModal.ts:1294</code> | <code>`실패: ${error instanceof Error ? error.message : String(error)}`</code> | <code>arg1 = error instanceof Error ? error.message : String(error)</code> |
| <code>couldNotStopSharing</code> | <code>src/ui/ShareGalleryModal.ts:1296</code> | <code>"공유 중지 실패"</code> |  |
| <code>chooseTags</code> | <code>src/ui/TagChecklistPopover.ts:40</code> | <code>"태그 고르기"</code> |  |
| <code>tags</code> | <code>src/ui/TagChecklistPopover.ts:112</code> | <code>"태그"</code> |  |
| <code>addTagsInSettingsTagOptionsFirst</code> | <code>src/ui/TagChecklistPopover.ts:121</code> | <code>"설정 → 태그 옵션에서 태그를 먼저 추가하세요."</code> |  |
| <code>deletedTag</code> | <code>src/ui/TagChecklistPopover.ts:160</code> | <code>"삭제된 태그"</code> |  |
| <code>viewSettings</code> | <code>src/ui/ViewSettingsPopover.ts:169</code> | <code>"보기 설정"</code> |  |
| <code>setTheOrderInManageProperties</code> | <code>src/ui/ViewSettingsPopover.ts:172</code> | <code>"순서는 속성 관리에서 정해요."</code> |  |
| <code>thereAreNoFieldsToShowInThis</code> | <code>src/ui/ViewSettingsPopover.ts:184</code> | <code>"이 아카이브에 보일 항목이 없어요."</code> |  |
| <code>fitImage</code> | <code>src/ui/ViewSettingsPopover.ts:196</code> | <code>"이미지 맞추기"</code> |  |
| <code>fitImage</code> | <code>src/ui/ViewSettingsPopover.ts:204</code> | <code>"이미지 맞추기"</code> |  |
| <code>share</code> | <code>src/ui/ViewSettingsPopover.ts:241</code> | <code>"공유"</code> |  |
| <code>manageProperties</code> | <code>src/ui/ViewSettingsPopover.ts:249</code> | <code>"속성 관리"</code> |  |
| <code>refresh</code> | <code>src/ui/ViewSettingsPopover.ts:287</code> | <code>"새로고침"</code> |  |
| <code>galleryFilterChips</code> | <code>src/ui/ViewSettingsPopover.ts:335</code> | <code>"맨 위 필터 칩"</code> |  |
| <code>chooseThePropertyUsedByTheGalleryFilter</code> | <code>src/ui/ViewSettingsPopover.ts:339</code> | <code>"갤러리 맨 위 칩에 쓸 속성을 고르세요."</code> |  |
| <code>galleryFilterChips</code> | <code>src/ui/ViewSettingsPopover.ts:360</code> | <code>"맨 위 필터 칩"</code> |  |
| <code>useDefault</code> | <code>src/ui/ViewSettingsPopover.ts:366</code> | <code>"기본값 사용"</code> |  |
| <code>followingPluginSettingsCurrentValue</code> | <code>src/ui/ViewSettingsPopover.ts:367</code> | <code>`전체 설정을 따라요 · 현재: ${this.handlers.axisName(globalAxis)}`</code> | <code>arg1 = this.handlers.axisName(globalAxis)</code> |
| <code>overrideForThisPage</code> | <code>src/ui/ViewSettingsPopover.ts:374</code> | <code>"이 페이지만 바꾸기"</code> |  |
| <code>currentlySelectedAddOptionsInManageProperties</code> | <code>src/ui/ViewSettingsPopover.ts:382</code> | <code>"현재 선택됨 · 속성 관리에서 선택 항목을 추가해 주세요."</code> |  |
| <code>currentlySelectedThisArchiveDoesNotUseThis</code> | <code>src/ui/ViewSettingsPopover.ts:383</code> | <code>"현재 선택됨 · 이 아카이브에서 쓰지 않는 속성이에요."</code> |  |
| <code>valueAvailableAfterAddingOptionsInManageProperties</code> | <code>src/ui/ViewSettingsPopover.ts:407</code> | <code>`${emptyAxes&#10;            .map((axis) =&gt; this.handlers.axisName(axis.id))&#10;            .join(" · ")}: 속성 관리에서 선택 항목을 추가하면 쓸 수 있어요.`</code> | <code>arg1 = emptyAxes&#10;            .map((axis) =&gt; this.handlers.axisName(axis.id))&#10;            .join(" · ")</code> |
| <code>valueThisArchiveDoesNotUseThisProperty</code> | <code>src/ui/ViewSettingsPopover.ts:414</code> | <code>`${unreachableAxes&#10;            .map((axis) =&gt; this.handlers.axisName(axis.id))&#10;            .join(" · ")}: 이 아카이브에서 쓰지 않는 속성이에요.`</code> | <code>arg1 = unreachableAxes&#10;            .map((axis) =&gt; this.handlers.axisName(axis.id))&#10;            .join(" · ")</code> |
| <code>all</code> | <code>src/ui/ViewSettingsPopover.ts:424</code> | <code>"전체"</code> |  |
| <code>valueAndValueMore2</code> | <code>src/ui/ViewSettingsPopover.ts:426</code> | <code>`${preview} · 외 ${rest}개`</code> | <code>arg1 = preview</code>; <code>arg2 = rest</code> |
| <code>couldNotSaveFilterTryAgain</code> | <code>src/ui/ViewSettingsPopover.ts:493</code> | <code>"필터 저장에 실패했어요. 다시 시도해 주세요."</code> |  |
| <code>hideOnCards</code> | <code>src/ui/ViewSettingsPopover.ts:518</code> | <code>"카드에서 숨기기"</code> |  |
| <code>showOnCards</code> | <code>src/ui/ViewSettingsPopover.ts:518</code> | <code>"카드에 보이기"</code> |  |
| <code>thereIsNoProfileContentToDisplay</code> | <code>src/ui/cleanBody.ts:490</code> | <code>"표시할 프로필 본문이 없어요."</code> |  |
| <code>prompts</code> | <code>src/ui/cleanBody.ts:498</code> | <code>"프롬프트"</code> |  |
| <code>copyValue</code> | <code>src/ui/cleanBody.ts:517</code> | <code>`${prompt.label} 복사`</code> | <code>arg1 = prompt.label</code> |
| <code>copyValue</code> | <code>src/ui/cleanBody.ts:518</code> | <code>`${prompt.label} 복사`</code> | <code>arg1 = prompt.label</code> |
| <code>empty</code> | <code>src/ui/cleanBody.ts:547</code> | <code>"비어 있음"</code> |  |
| <code>copy</code> | <code>src/ui/cleanBody.ts:548</code> | <code>"복사"</code> |  |
| <code>copied</code> | <code>src/ui/cleanBody.ts:552</code> | <code>"복사됨"</code> |  |
| <code>failed</code> | <code>src/ui/cleanBody.ts:552</code> | <code>"실패"</code> |  |
| <code>copy</code> | <code>src/ui/cleanBody.ts:556</code> | <code>"복사"</code> |  |
| <code>openGallery</code> | <code>src/ui/commandSurface.ts:3</code> | <code>"갤러리 열기"</code> |  |
| <code>createNewGallery</code> | <code>src/ui/commandSurface.ts:5</code> | <code>"새 갤러리 만들기"</code> |  |
| <code>toggleGalleryEditMode</code> | <code>src/ui/commandSurface.ts:23</code> | <code>"갤러리 편집 켜기 / 끄기"</code> |  |
| <code>noCover</code> | <code>src/ui/holdDrag.ts:187</code> | <code>"커버 없음"</code> |  |
| <code>finishMultipleSelection</code> | <code>src/ui/searchDisclosure.ts:282</code> | <code>"여러 선택 끝내기"</code> |  |
| <code>multipleSelection</code> | <code>src/ui/searchDisclosure.ts:282</code> | <code>"여러 선택"</code> |  |
| <code>turnOnEditModePencilToSelectMultiple</code> | <code>src/views/GalleryView.ts:523</code> | <code>"편집 모드(연필)를 켜면 여러 캐릭터를 고를 수 있어요."</code> |  |
| <code>couldNotRefreshTryAgain</code> | <code>src/views/GalleryView.ts:547</code> | <code>"새로고침에 실패했어요. 다시 시도해 주세요."</code> |  |
| <code>shareGallery</code> | <code>src/views/GalleryView.ts:759</code> | <code>"갤러리 공유"</code> |  |
| <code>thisArchiveHasNoCardsToShareYet</code> | <code>src/views/GalleryView.ts:783</code> | <code>"이 아카이브에는 공유할 카드가 아직 없어요."</code> |  |
| <code>thisGalleryHasNoLinkedNote</code> | <code>src/views/GalleryView.ts:795</code> | <code>"이 갤러리에 연결된 노트가 없어요."</code> |  |
| <code>thisGalleryHasNoLinkedNote</code> | <code>src/views/GalleryView.ts:803</code> | <code>"이 갤러리에 연결된 노트가 없어요."</code> |  |
| <code>noteLinkCopied</code> | <code>src/views/GalleryView.ts:807</code> | <code>"노트 링크를 복사했어요"</code> |  |
| <code>couldNotCopy</code> | <code>src/views/GalleryView.ts:807</code> | <code>"복사에 실패했어요"</code> |  |
| <code>newArchive</code> | <code>src/views/GalleryView.ts:986</code> | <code>"새 아카이브"</code> |  |
| <code>archiveName</code> | <code>src/views/GalleryView.ts:987</code> | <code>"아카이브 이름"</code> |  |
| <code>create</code> | <code>src/views/GalleryView.ts:988</code> | <code>"만들기"</code> |  |
| <code>creating</code> | <code>src/views/GalleryView.ts:989</code> | <code>"만드는 중…"</code> |  |
| <code>couldNotSaveArchiveValue</code> | <code>src/views/GalleryView.ts:1030</code> | <code>`아카이브를 저장하지 못했어요 · ${error instanceof Error ? error.message : String(error)}`</code> | <code>arg1 = error instanceof Error ? error.message : String(error)</code> |
| <code>createdArchiveValue</code> | <code>src/views/GalleryView.ts:1034</code> | <code>`「${created}」 아카이브를 만들었어요.`</code> | <code>arg1 = created</code> |
| <code>valueChooseAnotherName</code> | <code>src/views/GalleryView.ts:1110</code> | <code>`${error instanceof Error ? error.message : String(error)} · 다른 이름을 정해 주세요.`</code> | <code>arg1 = error instanceof Error ? error.message : String(error)</code> |
| <code>couldNotRenameArchiveValue</code> | <code>src/views/GalleryView.ts:1143</code> | <code>`아카이브 이름을 바꾸지 못했어요 · ${error instanceof Error ? error.message : String(error)}`</code> | <code>arg1 = error instanceof Error ? error.message : String(error)</code> |
| <code>backToGallery</code> | <code>src/views/GalleryView.ts:1356</code> | <code>"갤러리로 돌아가기"</code> |  |
| <code>close</code> | <code>src/views/GalleryView.ts:1356</code> | <code>"닫기"</code> |  |
| <code>gallery</code> | <code>src/views/GalleryView.ts:1357</code> | <code>"갤러리"</code> |  |
| <code>backToGallery</code> | <code>src/views/GalleryView.ts:1401</code> | <code>"갤러리로 돌아가기"</code> |  |
| <code>close</code> | <code>src/views/GalleryView.ts:1401</code> | <code>"닫기"</code> |  |
| <code>gallery</code> | <code>src/views/GalleryView.ts:1402</code> | <code>"갤러리"</code> |  |
| <code>panelWidth</code> | <code>src/views/GalleryView.ts:1410</code> | <code>"패널 너비"</code> |  |
| <code>renamingIsStillInProgress</code> | <code>src/views/GalleryView.ts:1717</code> | <code>"이름 바꾸기가 아직 진행 중이에요."</code> |  |
| <code>couldNotFindNoteValue</code> | <code>src/views/GalleryView.ts:1768</code> | <code>`노트를 찾지 못했어요: ${record.path}`</code> | <code>arg1 = record.path</code> |
| <code>movedOnlyValueOfValueNotesToTrash</code> | <code>src/views/GalleryView.ts:1778</code> | <code>`노트 ${total}개 중 ${trashed.size}개만 휴지통으로 보냈어요 · 그룹은 그대로 있어요`</code> | <code>arg1 = total</code>; <code>arg2 = trashed.size</code> |
| <code>movedValueNotesToTrashButCouldNot</code> | <code>src/views/GalleryView.ts:1796</code> | <code>`노트 ${trashed.size}개는 휴지통으로 보냈지만 그룹 설정을 지우지 못했어요 · 다시 시도해 주세요`</code> | <code>arg1 = trashed.size</code> |
| <code>chooseAnotherDestination</code> | <code>src/views/GalleryView.ts:1837</code> | <code>"다른 위치를 골라 주세요."</code> |  |
| <code>couldNotFindTheDestination</code> | <code>src/views/GalleryView.ts:1838</code> | <code>"옮길 위치를 찾지 못했어요."</code> |  |
| <code>couldNotFindNoteValue</code> | <code>src/views/GalleryView.ts:1850</code> | <code>`노트를 찾지 못했어요: ${path}`</code> | <code>arg1 = path</code> |
| <code>theGroupChangedElsewhereValue</code> | <code>src/views/GalleryView.ts:1857</code> | <code>`그룹이 다른 곳에서 바뀌었어요: ${file.basename}`</code> | <code>arg1 = file.basename</code> |
| <code>couldNotRestoreValueNotes</code> | <code>src/views/GalleryView.ts:1876</code> | <code>` · 되돌리지 못한 노트 ${failed}개`</code> | <code>arg1 = failed</code> |
| <code>couldNotDeleteGroupValueValue</code> | <code>src/views/GalleryView.ts:1888</code> | <code>`그룹을 지우지 못했어요${stranded(failed)} · ${error instanceof Error ? error.message : String(error)}`</code> | <code>arg1 = stranded(failed)</code>; <code>arg2 = error instanceof Error ? error.message : String(error)</code> |
| <code>couldNotSaveSettingsValueValue</code> | <code>src/views/GalleryView.ts:1920</code> | <code>`설정을 저장하지 못했어요${stranded(failed)} · ${error instanceof Error ? error.message : String(error)}`</code> | <code>arg1 = stranded(failed)</code>; <code>arg2 = error instanceof Error ? error.message : String(error)</code> |
| <code>couldNotFindNoteValue</code> | <code>src/views/GalleryView.ts:2065</code> | <code>`노트를 찾지 못했어요: ${path}`</code> | <code>arg1 = path</code> |
| <code>theGroupChangedElsewhereValue</code> | <code>src/views/GalleryView.ts:2071</code> | <code>`그룹이 다른 곳에서 바뀌었어요: ${file.basename}`</code> | <code>arg1 = file.basename</code> |
| <code>couldNotRestoreValueNotes</code> | <code>src/views/GalleryView.ts:2089</code> | <code>` · 되돌리지 못한 노트 ${failed}개`</code> | <code>arg1 = failed</code> |
| <code>couldNotRenameGroupValueValue</code> | <code>src/views/GalleryView.ts:2101</code> | <code>`그룹 이름을 바꾸지 못했어요${stranded(failed)} · ${error instanceof Error ? error.message : String(error)}`</code> | <code>arg1 = stranded(failed)</code>; <code>arg2 = error instanceof Error ? error.message : String(error)</code> |
| <code>couldNotSaveSettingsValueValue</code> | <code>src/views/GalleryView.ts:2120</code> | <code>`설정을 저장하지 못했어요${stranded(failed)} · ${error instanceof Error ? error.message : String(error)}`</code> | <code>arg1 = stranded(failed)</code>; <code>arg2 = error instanceof Error ? error.message : String(error)</code> |
| <code>selectedCharacters</code> | <code>src/views/GalleryView.ts:2254</code> | <code>"선택한 캐릭터"</code> |  |
| <code>valueSelected</code> | <code>src/views/GalleryView.ts:2258</code> | <code>`${this.batchSelection.size}명 선택`</code> | <code>arg1 = this.batchSelection.size</code> |
| <code>clearSelection</code> | <code>src/views/GalleryView.ts:2264</code> | <code>"선택 해제"</code> |  |
| <code>moveToGroup</code> | <code>src/views/GalleryView.ts:2271</code> | <code>"그룹 이동"</code> |  |
| <code>valueSelected</code> | <code>src/views/GalleryView.ts:2284</code> | <code>`${this.batchSelection.size}명 선택`</code> | <code>arg1 = this.batchSelection.size</code> |
| <code>couldNotChangeGroupValue</code> | <code>src/views/GalleryView.ts:2654</code> | <code>`그룹을 바꾸지 못했어요 · ${failure instanceof Error ? failure.message : String(failure)}`</code> | <code>arg1 = failure instanceof Error ? failure.message : String(failure)</code> |
| <code>couldNotFindNoteValue2</code> | <code>src/views/GalleryView.ts:2726</code> | <code>`노트를 찾지 못했어요 · ${entry.path}`</code> | <code>arg1 = entry.path</code> |
| <code>valueWasMovedOutsideThisLibrary</code> | <code>src/views/GalleryView.ts:2732</code> | <code>`「${file.basename}」이(가) 이 서재 밖으로 옮겨졌어요.`</code> | <code>arg1 = file.basename</code> |
| <code>theArchiveForValueChangedInTheMeantime</code> | <code>src/views/GalleryView.ts:2745</code> | <code>`「${file.basename}」의 아카이브가 그 사이에 바뀌었어요.`</code> | <code>arg1 = file.basename</code> |
| <code>theGroupForValueChangedInTheMeantime</code> | <code>src/views/GalleryView.ts:2757</code> | <code>`「${file.basename}」의 그룹이 그 사이에 바뀌었어요.`</code> | <code>arg1 = file.basename</code> |
| <code>couldNotRestoreBecauseTheNoteWasNot</code> | <code>src/views/GalleryView.ts:2785</code> | <code>`노트를 찾지 못해 되돌리지 못했어요 · ${entry.path}`</code> | <code>arg1 = entry.path</code> |
| <code>theGroupChangedAgainBeforeUndoValue</code> | <code>src/views/GalleryView.ts:2800</code> | <code>`되돌리기 전에 그룹이 또 바뀌었어요 · ${entry.path}`</code> | <code>arg1 = entry.path</code> |
| <code>waitForTheGroupRenameToFinishBefore</code> | <code>src/views/GalleryView.ts:2850</code> | <code>"그룹 이름 변경이 끝난 뒤 편집 모드를 바꿀 수 있어요."</code> |  |
| <code>waitForTheGroupMoveToFinishBefore</code> | <code>src/views/GalleryView.ts:2856</code> | <code>"그룹 이동이 끝난 뒤 편집 모드를 바꿀 수 있어요."</code> |  |
| <code>finishMultipleSelectionBeforeChangingEditMode</code> | <code>src/views/GalleryView.ts:2857</code> | <code>"여러 선택을 끝낸 뒤 편집 모드를 바꿀 수 있어요."</code> |  |
| <code>chooseASortOrderInDisplayOrderAnd</code> | <code>src/views/GalleryView.ts:2872</code> | <code>"위쪽 「표시 순서」에서 정렬을 고르고, 카드의 이미지 아이콘으로 커버를 바꿔 보세요."</code> |  |
| <code>valueFilter</code> | <code>src/views/GalleryView.ts:3336</code> | <code>`${axis.label} 필터`</code> | <code>arg1 = axis.label</code> |
| <code>addValuesFirst</code> | <code>src/views/GalleryView.ts:3340</code> | <code>"값을 먼저 추가하세요."</code> |  |
| <code>all</code> | <code>src/views/GalleryView.ts:3352</code> | <code>"전체"</code> |  |
| <code>noArchive</code> | <code>src/views/GalleryView.ts:3414</code> | <code>"아카이브 없음"</code> |  |
| <code>archive</code> | <code>src/views/GalleryView.ts:3422</code> | <code>"아카이브"</code> |  |
| <code>switchArchive</code> | <code>src/views/GalleryView.ts:3431</code> | <code>"아카이브 바꾸기"</code> |  |
| <code>selectArchives</code> | <code>src/views/GalleryView.ts:3432</code> | <code>"아카이브 선택"</code> |  |
| <code>noArchive</code> | <code>src/views/GalleryView.ts:3438</code> | <code>"아카이브 없음"</code> |  |
| <code>archive</code> | <code>src/views/GalleryView.ts:3438</code> | <code>"아카이브"</code> |  |
| <code>createNewArchive</code> | <code>src/views/GalleryView.ts:3465</code> | <code>"새 아카이브 만들기"</code> |  |
| <code>renameArchive</code> | <code>src/views/GalleryView.ts:3486</code> | <code>"아카이브 이름 바꾸기"</code> |  |
| <code>renameArchive</code> | <code>src/views/GalleryView.ts:3487</code> | <code>"아카이브 이름 바꾸기"</code> |  |
| <code>sort</code> | <code>src/views/GalleryView.ts:3507</code> | <code>"정렬"</code> |  |
| <code>displayOrder</code> | <code>src/views/GalleryView.ts:3511</code> | <code>"표시 순서"</code> |  |
| <code>useTheLeftHandleToReorderCards</code> | <code>src/views/GalleryView.ts:3513</code> | <code>"왼쪽 핸들로 카드 순서를 바꿔 보세요"</code> |  |
| <code>manual</code> | <code>src/views/GalleryView.ts:3517</code> | <code>"자유"</code> |  |
| <code>name2</code> | <code>src/views/GalleryView.ts:3518</code> | <code>"이름순"</code> |  |
| <code>search</code> | <code>src/views/GalleryView.ts:3541</code> | <code>"검색"</code> |  |
| <code>search</code> | <code>src/views/GalleryView.ts:3542</code> | <code>"검색"</code> |  |
| <code>closeSearch</code> | <code>src/views/GalleryView.ts:3583</code> | <code>"검색 닫기"</code> |  |
| <code>closeSearch</code> | <code>src/views/GalleryView.ts:3584</code> | <code>"검색 닫기"</code> |  |
| <code>search</code> | <code>src/views/GalleryView.ts:3599</code> | <code>"검색"</code> |  |
| <code>search</code> | <code>src/views/GalleryView.ts:3600</code> | <code>"검색"</code> |  |
| <code>finishMultipleSelectionToSwitchToReadMode</code> | <code>src/views/GalleryView.ts:3621</code> | <code>"여러 선택을 끝내면 읽기 모드로 바꿀 수 있어요"</code> |  |
| <code>switchToReadMode</code> | <code>src/views/GalleryView.ts:3623</code> | <code>"읽기 모드로"</code> |  |
| <code>editModeYouCanChangeTheDisplayOrder</code> | <code>src/views/GalleryView.ts:3624</code> | <code>"편집 모드 — 표시 순서를 바꿀 수 있어요"</code> |  |
| <code>readModeFinishMultipleSelectionToSwitch</code> | <code>src/views/GalleryView.ts:3626</code> | <code>"읽기 모드 — 여러 선택을 끝내면 바꿀 수 있어요"</code> |  |
| <code>readMode</code> | <code>src/views/GalleryView.ts:3628</code> | <code>"읽기 모드"</code> |  |
| <code>editMode</code> | <code>src/views/GalleryView.ts:3629</code> | <code>"편집 모드"</code> |  |
| <code>selectMultipleCharactersAvailableInEditMode</code> | <code>src/views/GalleryView.ts:3649</code> | <code>"여러 캐릭터 선택 — 편집 모드에서 열려요"</code> |  |
| <code>selectMultipleCharactersAvailableInEditMode</code> | <code>src/views/GalleryView.ts:3652</code> | <code>"여러 캐릭터 선택 — 편집 모드에서 열려요"</code> |  |
| <code>managePropertiesFieldsInThisGroup</code> | <code>src/views/GalleryView.ts:3672</code> | <code>"속성 관리 — 이 그룹의 항목"</code> |  |
| <code>finishMultipleSelectionToManageProperties</code> | <code>src/views/GalleryView.ts:3674</code> | <code>"여러 선택을 끝내면 속성을 관리할 수 있어요"</code> |  |
| <code>managePropertiesAvailableInEditMode</code> | <code>src/views/GalleryView.ts:3675</code> | <code>"속성 관리 — 편집 모드에서 열려요"</code> |  |
| <code>manageProperties</code> | <code>src/views/GalleryView.ts:3677</code> | <code>"속성 관리"</code> |  |
| <code>managePropertiesFinishMultipleSelectionToOpen</code> | <code>src/views/GalleryView.ts:3679</code> | <code>"속성 관리 — 여러 선택을 끝내면 열려요"</code> |  |
| <code>managePropertiesAvailableInEditMode</code> | <code>src/views/GalleryView.ts:3680</code> | <code>"속성 관리 — 편집 모드에서 열려요"</code> |  |
| <code>finishMultipleSelectionToOpenManageProperties</code> | <code>src/views/GalleryView.ts:3690</code> | <code>"여러 선택을 끝내면 속성 관리를 열 수 있어요."</code> |  |
| <code>turnOnEditModePencilToOpenManage</code> | <code>src/views/GalleryView.ts:3693</code> | <code>"편집 모드(연필)를 켜면 속성 관리를 열 수 있어요."</code> |  |
| <code>viewSettings</code> | <code>src/views/GalleryView.ts:3705</code> | <code>"보기 설정"</code> |  |
| <code>viewSettings</code> | <code>src/views/GalleryView.ts:3706</code> | <code>"보기 설정"</code> |  |
| <code>share</code> | <code>src/views/GalleryView.ts:3780</code> | <code>"공유"</code> |  |
| <code>share</code> | <code>src/views/GalleryView.ts:3781</code> | <code>"공유"</code> |  |
| <code>refresh</code> | <code>src/views/GalleryView.ts:3795</code> | <code>"새로고침"</code> |  |
| <code>refresh</code> | <code>src/views/GalleryView.ts:3796</code> | <code>"새로고침"</code> |  |
| <code>noCharactersYet</code> | <code>src/views/GalleryView.ts:3830</code> | <code>"캐릭터가 없어요."</code> |  |
| <code>noCharactersYet</code> | <code>src/views/GalleryView.ts:3834</code> | <code>"캐릭터가 없어요."</code> |  |
| <code>createYourFirstCardWithTheButtonBelow</code> | <code>src/views/GalleryView.ts:3835</code> | <code>"아래 버튼으로 첫 카드를 만드세요."</code> |  |
| <code>thereAreNoCardsInThisArchive</code> | <code>src/views/GalleryView.ts:3837</code> | <code>"이 아카이브에 카드가 없어요."</code> |  |
| <code>createYourFirstCardWithTheButtonBelow</code> | <code>src/views/GalleryView.ts:3839</code> | <code>"아래 버튼으로 첫 카드를 만드세요."</code> |  |
| <code>chooseAnotherArchiveOrAddACharacter</code> | <code>src/views/GalleryView.ts:3840</code> | <code>"다른 아카이브를 고르거나 캐릭터를 추가하세요."</code> |  |
| <code>noSearchResults</code> | <code>src/views/GalleryView.ts:3842</code> | <code>"검색 결과가 없어요."</code> |  |
| <code>searchValueFilterValueCharactersInThisArchive</code> | <code>src/views/GalleryView.ts:3843</code> | <code>`검색 + ${filterDef.label} 필터 · 이 아카이브 ${allCount}명`</code> | <code>arg1 = filterDef.label</code>; <code>arg2 = allCount</code> |
| <code>noSearchResults</code> | <code>src/views/GalleryView.ts:3845</code> | <code>"검색 결과가 없어요."</code> |  |
| <code>noMatchesAmongValueCharactersInThisArchive</code> | <code>src/views/GalleryView.ts:3846</code> | <code>`이 아카이브 ${allCount}명 중에서 찾지 못했어요.`</code> | <code>arg1 = allCount</code> |
| <code>noCharactersWithValue</code> | <code>src/views/GalleryView.ts:3848</code> | <code>`${filterDef.label}인 캐릭터가 없어요.`</code> | <code>arg1 = filterDef.label</code> |
| <code>valueCharactersInThisArchiveCurrentFilterValue</code> | <code>src/views/GalleryView.ts:3854</code> | <code>`이 아카이브 ${allCount}명 · 지금 ${filterDef.label} 필터 (${others})`</code> | <code>arg1 = allCount</code>; <code>arg2 = filterDef.label</code>; <code>arg3 = others</code> |
| <code>valueCharactersInThisArchiveCurrentFilterValue2</code> | <code>src/views/GalleryView.ts:3855</code> | <code>`이 아카이브 ${allCount}명 · 지금 ${filterDef.label} 필터`</code> | <code>arg1 = allCount</code>; <code>arg2 = filterDef.label</code> |
| <code>thereAreNoCardsToDisplay</code> | <code>src/views/GalleryView.ts:3857</code> | <code>"표시할 카드가 없어요."</code> |  |
| <code>couldNotAddValue</code> | <code>src/views/GalleryView.ts:3880</code> | <code>`추가 실패: ${error instanceof Error ? error.message : String(error)}`</code> | <code>arg1 = error instanceof Error ? error.message : String(error)</code> |
| <code>showAll</code> | <code>src/views/GalleryView.ts:3891</code> | <code>"전체 보기"</code> |  |
| <code>showOnlyValue</code> | <code>src/views/GalleryView.ts:3900</code> | <code>`${s.label}만 보기`</code> | <code>arg1 = s.label</code> |
| <code>addCharacter</code> | <code>src/views/GalleryView.ts:3909</code> | <code>"캐릭터 추가"</code> |  |
| <code>clearFilterAll</code> | <code>src/views/GalleryView.ts:3920</code> | <code>"필터 끄기 (전체)"</code> |  |
| <code>clearSearch</code> | <code>src/views/GalleryView.ts:3928</code> | <code>"검색 지우기"</code> |  |
| <code>clearSearch</code> | <code>src/views/GalleryView.ts:3940</code> | <code>"검색 지우기"</code> |  |
| <code>addCharacter</code> | <code>src/views/GalleryView.ts:3952</code> | <code>"캐릭터 추가"</code> |  |
| <code>dragToReorderGroups</code> | <code>src/views/GalleryView.ts:4029</code> | <code>"드래그해서 그룹 순서 변경"</code> |  |
| <code>reorderGroups</code> | <code>src/views/GalleryView.ts:4030</code> | <code>"그룹 순서 변경"</code> |  |
| <code>renameGroup</code> | <code>src/views/GalleryView.ts:4065</code> | <code>"그룹 이름 바꾸기"</code> |  |
| <code>renameGroupValue</code> | <code>src/views/GalleryView.ts:4066</code> | <code>`「${rawGroup}」 그룹 이름 바꾸기`</code> | <code>arg1 = rawGroup</code> |
| <code>expandGroupValue</code> | <code>src/views/GalleryView.ts:4114</code> | <code>`「${group}」 그룹 펼치기`</code> | <code>arg1 = group</code> |
| <code>collapseGroupValue</code> | <code>src/views/GalleryView.ts:4114</code> | <code>`「${group}」 그룹 접기`</code> | <code>arg1 = group</code> |
| <code>expand</code> | <code>src/views/GalleryView.ts:4117</code> | <code>"펼치기"</code> |  |
| <code>collapse</code> | <code>src/views/GalleryView.ts:4117</code> | <code>"접기"</code> |  |
| <code>expandAll</code> | <code>src/views/GalleryView.ts:4171</code> | <code>"모두 펼치기"</code> |  |
| <code>collapseAll</code> | <code>src/views/GalleryView.ts:4172</code> | <code>"모두 접기"</code> |  |
| <code>valueAllGroups</code> | <code>src/views/GalleryView.ts:4180</code> | <code>`모든 그룹 ${state.allCollapsed ? "펼치기" : "접기"}`</code> | <code>arg1 = state.allCollapsed ? "펼치기" : "접기"</code> |
| <code>expand</code> | <code>src/views/GalleryView.ts:4180</code> | <code>"펼치기"</code> |  |
| <code>collapse</code> | <code>src/views/GalleryView.ts:4180</code> | <code>"접기"</code> |  |
| <code>moveToTop</code> | <code>src/views/GalleryView.ts:4215</code> | <code>"맨 위로"</code> |  |
| <code>moveUp</code> | <code>src/views/GalleryView.ts:4227</code> | <code>"위로"</code> |  |
| <code>moveDown</code> | <code>src/views/GalleryView.ts:4239</code> | <code>"아래로"</code> |  |
| <code>moveToBottom</code> | <code>src/views/GalleryView.ts:4251</code> | <code>"맨 아래로"</code> |  |
| <code>addCharacter</code> | <code>src/views/GalleryView.ts:4303</code> | <code>"캐릭터 추가"</code> |  |
| <code>couldNotAddValue</code> | <code>src/views/GalleryView.ts:4333</code> | <code>`추가 실패: ${error instanceof Error ? error.message : String(error)}`</code> | <code>arg1 = error instanceof Error ? error.message : String(error)</code> |
| <code>selectValue</code> | <code>src/views/GalleryView.ts:4364</code> | <code>`${record.title} 선택`</code> | <code>arg1 = record.title</code> |
| <code>dragToReorder</code> | <code>src/views/GalleryView.ts:4405</code> | <code>"드래그해서 순서 변경"</code> |  |
| <code>reorder</code> | <code>src/views/GalleryView.ts:4406</code> | <code>"순서 변경"</code> |  |
| <code>noCover</code> | <code>src/views/GalleryView.ts:4448</code> | <code>"커버 없음"</code> |  |
| <code>changeValue</code> | <code>src/views/GalleryView.ts:4539</code> | <code>`${axis.label} 바꾸기`</code> | <code>arg1 = axis.label</code> |
| <code>moveToAnotherGroup</code> | <code>src/views/GalleryView.ts:4704</code> | <code>"다른 그룹으로 옮기기"</code> |  |
| <code>fillInValue</code> | <code>src/views/GalleryView.ts:4705</code> | <code>`${this.fieldDisplayLabel(field)} 채우기`</code> | <code>arg1 = this.fieldDisplayLabel(field)</code> |
| <code>couldNotSaveValue</code> | <code>src/views/GalleryView.ts:4767</code> | <code>`저장 실패: ${error instanceof Error ? error.message : String(error)}`</code> | <code>arg1 = error instanceof Error ? error.message : String(error)</code> |
| <code>group</code> | <code>src/views/GalleryView.ts:4792</code> | <code>"그룹"</code> |  |
| <code>couldNotSaveGroupValue</code> | <code>src/views/GalleryView.ts:4795</code> | <code>`그룹 저장 실패: ${error instanceof Error ? error.message : String(error)}`</code> | <code>arg1 = error instanceof Error ? error.message : String(error)</code> |
| <code>properties</code> | <code>src/views/GalleryView.ts:4916</code> | <code>"속성"</code> |  |
| <code>changeValue</code> | <code>src/views/GalleryView.ts:4939</code> | <code>`${this.fieldDisplayLabel(field)} 바꾸기`</code> | <code>arg1 = this.fieldDisplayLabel(field)</code> |
| <code>noValuesToChooseAddThemUsingThe</code> | <code>src/views/GalleryView.ts:5007</code> | <code>"고를 값이 없어요 · 책에서 추가"</code> |  |
| <code>none</code> | <code>src/views/GalleryView.ts:5012</code> | <code>"없음"</code> |  |
| <code>couldNotSaveValue</code> | <code>src/views/GalleryView.ts:5031</code> | <code>`저장 실패: ${error instanceof Error ? error.message : String(error)}`</code> | <code>arg1 = error instanceof Error ? error.message : String(error)</code> |
| <code>chooseValue</code> | <code>src/views/GalleryView.ts:5084</code> | <code>`${this.fieldDisplayLabel(field)} 고르기`</code> | <code>arg1 = this.fieldDisplayLabel(field)</code> |
| <code>chooseValue</code> | <code>src/views/GalleryView.ts:5116</code> | <code>`${this.fieldDisplayLabel(field)} 고르기`</code> | <code>arg1 = this.fieldDisplayLabel(field)</code> |
| <code>chooseValue</code> | <code>src/views/GalleryView.ts:5117</code> | <code>`${this.fieldDisplayLabel(field)} 고르기`</code> | <code>arg1 = this.fieldDisplayLabel(field)</code> |
| <code>couldNotSaveValue</code> | <code>src/views/GalleryView.ts:5163</code> | <code>`저장 실패: ${error instanceof Error ? error.message : String(error)}`</code> | <code>arg1 = error instanceof Error ? error.message : String(error)</code> |
| <code>chooseTags</code> | <code>src/views/GalleryView.ts:5234</code> | <code>"태그 고르기"</code> |  |
| <code>chooseTags</code> | <code>src/views/GalleryView.ts:5253</code> | <code>"태그 고르기"</code> |  |
| <code>chooseTags</code> | <code>src/views/GalleryView.ts:5254</code> | <code>"태그 고르기"</code> |  |
| <code>couldNotSaveTagsValue</code> | <code>src/views/GalleryView.ts:5309</code> | <code>`태그 저장 실패: ${error instanceof Error ? error.message : String(error)}`</code> | <code>arg1 = error instanceof Error ? error.message : String(error)</code> |
| <code>changeValue</code> | <code>src/views/GalleryView.ts:5396</code> | <code>`${axis.label} 바꾸기`</code> | <code>arg1 = axis.label</code> |
| <code>none</code> | <code>src/views/GalleryView.ts:5432</code> | <code>"없음"</code> |  |
| <code>couldNotSaveValueValue</code> | <code>src/views/GalleryView.ts:5480</code> | <code>`${axis.label} 저장 실패: ${error instanceof Error ? error.message : String(error)}`</code> | <code>arg1 = axis.label</code>; <code>arg2 = error instanceof Error ? error.message : String(error)</code> |
| <code>openNote</code> | <code>src/views/GalleryView.ts:5582</code> | <code>"노트 열기"</code> |  |
| <code>share</code> | <code>src/views/GalleryView.ts:5590</code> | <code>"공유"</code> |  |
| <code>changeCover</code> | <code>src/views/GalleryView.ts:5598</code> | <code>"커버 바꾸기"</code> |  |
| <code>openNote</code> | <code>src/views/GalleryView.ts:5613</code> | <code>"노트 열기"</code> |  |
| <code>share</code> | <code>src/views/GalleryView.ts:5621</code> | <code>"공유"</code> |  |
| <code>changeCover</code> | <code>src/views/GalleryView.ts:5629</code> | <code>"커버 바꾸기"</code> |  |
| <code>delete</code> | <code>src/views/GalleryView.ts:5638</code> | <code>"삭제"</code> |  |
| <code>deleteNoteValueItWillBeMovedTo</code> | <code>src/views/GalleryView.ts:5651</code> | <code>`「${label}」 노트를 삭제할까요?\n휴지통으로 이동합니다.`</code> | <code>arg1 = label</code> |
| <code>couldNotDeleteValue</code> | <code>src/views/GalleryView.ts:5662</code> | <code>`삭제 실패: ${error instanceof Error ? error.message : String(error)}`</code> | <code>arg1 = error instanceof Error ? error.message : String(error)</code> |
| <code>deletedValue</code> | <code>src/views/GalleryView.ts:5673</code> | <code>`「${label}」을(를) 삭제했어요`</code> | <code>arg1 = label</code> |
| <code>dragReposition</code> | <code>src/views/GalleryView.ts:5693</code> | <code>"드래그 · 위치"</code> |  |
| <code>clickAddCover</code> | <code>src/views/GalleryView.ts:5693</code> | <code>"클릭 · 커버 추가"</code> |  |
| <code>changeCover</code> | <code>src/views/GalleryView.ts:5700</code> | <code>"커버 바꾸기"</code> |  |
| <code>changeCover</code> | <code>src/views/GalleryView.ts:5701</code> | <code>"커버 바꾸기"</code> |  |
| <code>positioning</code> | <code>src/views/GalleryView.ts:5772</code> | <code>"놓는 중…"</code> |  |
| <code>dragReposition</code> | <code>src/views/GalleryView.ts:5799</code> | <code>"드래그 · 위치"</code> |  |
| <code>theCoverChangedReopenTheViewToCheck</code> | <code>src/views/GalleryView.ts:5851</code> | <code>"커버는 바뀌었어요. 화면을 다시 열어 확인해 주세요."</code> |  |
| <code>anImageChangeIsInProgressTryAgain</code> | <code>src/views/GalleryView.ts:5855</code> | <code>"이미지 변경 중이에요. 잠시 후 다시 시도해 주세요."</code> |  |
| <code>couldNotUpdateTheNoteSavedImagesRemain</code> | <code>src/views/GalleryView.ts:5862</code> | <code>"노트 반영 실패 · 저장된 이미지는 남아 있어요. 다시 추가해 주세요."</code> |  |
| <code>imagesWereAddedButTheViewCouldNot</code> | <code>src/views/GalleryView.ts:5871</code> | <code>"이미지는 추가됐지만 화면 갱신에 실패했어요. 갤러리를 다시 열어 확인하세요."</code> |  |
| <code>theOrderChangedReopenTheViewToCheck</code> | <code>src/views/GalleryView.ts:5908</code> | <code>"순서는 바뀌었어요. 화면을 다시 열어 확인해 주세요."</code> |  |
| <code>theOrderChangedReopenTheViewToCheck</code> | <code>src/views/GalleryView.ts:5914</code> | <code>"순서는 바뀌었어요. 화면을 다시 열어 확인해 주세요."</code> |  |
| <code>anImageChangeIsInProgressTryAgain</code> | <code>src/views/GalleryView.ts:5947</code> | <code>"이미지 변경 중이에요. 잠시 후 다시 시도해 주세요."</code> |  |
| <code>couldNotChangeCover</code> | <code>src/views/GalleryView.ts:5998</code> | <code>"커버 변경에 실패했어요"</code> |  |
| <code>changedCoverToValue</code> | <code>src/views/GalleryView.ts:6021</code> | <code>`커버를 「${intent.file.basename}」으로 바꿨어요`</code> | <code>arg1 = intent.file.basename</code> |
| <code>changedCoverToARemoteImage</code> | <code>src/views/GalleryView.ts:6023</code> | <code>"원격 이미지로 커버를 바꿨어요"</code> |  |
| <code>hidTheCardCover</code> | <code>src/views/GalleryView.ts:6025</code> | <code>"카드 커버를 숨겼어요"</code> |  |
| <code>theNoteSFirstImageWillBeUsed</code> | <code>src/views/GalleryView.ts:6027</code> | <code>"노트 첫 이미지를 커버로 쓸게요"</code> |  |
| <code>couldNotReorder</code> | <code>src/views/GalleryView.ts:6079</code> | <code>"순서를 바꾸지 못했어요."</code> |  |
| <code>couldNotReorder</code> | <code>src/views/GalleryView.ts:6091</code> | <code>"순서를 바꾸지 못했어요."</code> |  |
| <code>anImageChangeIsInProgressTryAgain</code> | <code>src/views/GalleryView.ts:6134</code> | <code>"이미지 변경 중이에요. 잠시 후 다시 시도해 주세요."</code> |  |
| <code>imageRemoved</code> | <code>src/views/GalleryView.ts:6147</code> | <code>"이미지를 제거했어요. "</code> |  |
| <code>undo</code> | <code>src/views/GalleryView.ts:6149</code> | <code>"되돌리기"</code> |  |
| <code>anImageChangeIsInProgressTryAgain</code> | <code>src/views/GalleryView.ts:6156</code> | <code>"이미지 변경 중이에요. 잠시 후 다시 시도해 주세요."</code> |  |
| <code>theNoteChangedSoTheImageWasAdded</code> | <code>src/views/GalleryView.ts:6164</code> | <code>"노트가 바뀌어 끝에 다시 넣었어요"</code> |  |
| <code>addedBack</code> | <code>src/views/GalleryView.ts:6164</code> | <code>"다시 넣었어요"</code> |  |
| <code>theImageWasRestoredReopenTheViewTo</code> | <code>src/views/GalleryView.ts:6166</code> | <code>"이미지는 복원됐어요. 화면을 다시 열어 확인해 주세요."</code> |  |
| <code>couldNotUndoTryAgain</code> | <code>src/views/GalleryView.ts:6176</code> | <code>"되돌리지 못했어요. 다시 시도해 주세요."</code> |  |
| <code>theNoteWasUpdatedReopenTheViewTo</code> | <code>src/views/GalleryView.ts:6181</code> | <code>"노트에 반영됐어요. 화면을 다시 열어 확인해 주세요."</code> |  |
| <code>couldNotRemoveTryAgain</code> | <code>src/views/GalleryView.ts:6184</code> | <code>"제거하지 못했어요. 다시 시도해 주세요."</code> |  |
| <code>thisIsTheCurrentCoverChooseAnotherCover2</code> | <code>src/views/GalleryView.ts:6230</code> | <code>"현재 커버예요 · 먼저 다른 이미지를 커버로 골라 주세요"</code> |  |
| <code>removeFromNote</code> | <code>src/views/GalleryView.ts:6230</code> | <code>"노트에서 제거"</code> |  |
| <code>currentCover</code> | <code>src/views/GalleryView.ts:6234</code> | <code>"현재 커버"</code> |  |
| <code>noCover</code> | <code>src/views/GalleryView.ts:6277</code> | <code>"커버 없음"</code> |  |
| <code>displayOrderSetToManualSavingTheCurrent</code> | <code>src/views/GalleryView.ts:6333</code> | <code>"표시 순서를 「자유」로 맞춰 두고, 지금 자리를 저장해요"</code> |  |
| <code>couldNotSaveOrder</code> | <code>src/views/GalleryView.ts:6390</code> | <code>"순서를 저장하지 못했어요."</code> |  |
| <code>close</code> | <code>src/views/GalleryView.ts:6431</code> | <code>"닫기"</code> |  |
| <code>backToGallery</code> | <code>src/views/GalleryView.ts:6434</code> | <code>"갤러리로 돌아가기"</code> |  |
| <code>close</code> | <code>src/views/GalleryView.ts:6434</code> | <code>"닫기"</code> |  |
| <code>gallery</code> | <code>src/views/GalleryView.ts:6435</code> | <code>"갤러리"</code> |  |
| <code>rename</code> | <code>src/views/GalleryView.ts:6445</code> | <code>"이름 바꾸기"</code> |  |
| <code>rename</code> | <code>src/views/GalleryView.ts:6446</code> | <code>"이름 바꾸기"</code> |  |
| <code>renameCharacter</code> | <code>src/views/GalleryView.ts:6453</code> | <code>"캐릭터 이름 바꾸기"</code> |  |
| <code>rename</code> | <code>src/views/GalleryView.ts:6455</code> | <code>"이름 바꾸기"</code> |  |
| <code>renaming</code> | <code>src/views/GalleryView.ts:6456</code> | <code>"바꾸는 중…"</code> |  |
| <code>couldNotRename</code> | <code>src/views/GalleryView.ts:6463</code> | <code>"이름을 바꾸지 못했어요."</code> |  |
| <code>changedTheNameAndNoteFileName</code> | <code>src/views/GalleryView.ts:6468</code> | <code>"이름과 노트 파일명을 바꿨어요."</code> |  |
| <code>openNote</code> | <code>src/views/GalleryView.ts:6491</code> | <code>"노트 열기"</code> |  |
| <code>openNote</code> | <code>src/views/GalleryView.ts:6492</code> | <code>"노트 열기"</code> |  |
| <code>share</code> | <code>src/views/GalleryView.ts:6503</code> | <code>"공유"</code> |  |
| <code>share</code> | <code>src/views/GalleryView.ts:6504</code> | <code>"공유"</code> |  |
| <code>properties</code> | <code>src/views/GalleryView.ts:6517</code> | <code>"속성"</code> |  |
| <code>couldNotReadTheNoteTryRefreshing</code> | <code>src/views/GalleryView.ts:6535</code> | <code>"노트를 읽지 못했어요. 새로고침해 보세요."</code> |  |
| <code>couldNotRenderTheBody</code> | <code>src/views/GalleryView.ts:6568</code> | <code>"본문을 그리지 못했어요."</code> |  |
| <code>webImage</code> | <code>src/views/GalleryView.ts:6603</code> | <code>"웹 이미지"</code> |  |
| <code>enlargeImage</code> | <code>src/views/GalleryView.ts:6701</code> | <code>"이미지 크게 보기"</code> |  |
| <code>previousImage</code> | <code>src/views/GalleryView.ts:6732</code> | <code>"이전 이미지"</code> |  |
| <code>nextImage</code> | <code>src/views/GalleryView.ts:6746</code> | <code>"다음 이미지"</code> |  |
| <code>close</code> | <code>src/views/GalleryView.ts:6759</code> | <code>"닫기"</code> |  |
| <code>imagesTapToSetCover</code> | <code>src/views/GalleryView.ts:6865</code> | <code>"이미지 · 탭하면 커버"</code> |  |
| <code>images2</code> | <code>src/views/GalleryView.ts:6865</code> | <code>"이미지"</code> |  |
| <code>thereAreNoImagesAddThemToThe</code> | <code>src/views/GalleryView.ts:6873</code> | <code>"이미지가 없어요. 노트에 넣은 뒤 새로고침하세요."</code> |  |
| <code>noImages</code> | <code>src/views/GalleryView.ts:6874</code> | <code>"이미지 없음"</code> |  |
| <code>enlargeImage</code> | <code>src/views/GalleryView.ts:6888</code> | <code>"이미지 크게 보기"</code> |  |
| <code>previousImage</code> | <code>src/views/GalleryView.ts:6894</code> | <code>"이전 이미지"</code> |  |
| <code>nextImage</code> | <code>src/views/GalleryView.ts:6896</code> | <code>"다음 이미지"</code> |  |
| <code>currentCover</code> | <code>src/views/GalleryView.ts:6923</code> | <code>"현재 커버"</code> |  |
| <code>moveValueValue</code> | <code>src/views/GalleryView.ts:6972</code> | <code>`${imageLabel} ${direction &lt; 0 ? "왼쪽" : "오른쪽"}으로 이동`</code> | <code>arg1 = imageLabel</code>; <code>arg2 = direction &lt; 0 ? "왼쪽" : "오른쪽"</code> |
| <code>left</code> | <code>src/views/GalleryView.ts:6972</code> | <code>"왼쪽"</code> |  |
| <code>right</code> | <code>src/views/GalleryView.ts:6972</code> | <code>"오른쪽"</code> |  |
| <code>moveLeft</code> | <code>src/views/GalleryView.ts:6973</code> | <code>"왼쪽으로 이동"</code> |  |
| <code>moveRight</code> | <code>src/views/GalleryView.ts:6973</code> | <code>"오른쪽으로 이동"</code> |  |
| <code>removeValueFromNote</code> | <code>src/views/GalleryView.ts:7002</code> | <code>`${imageLabel} 노트에서 제거`</code> | <code>arg1 = imageLabel</code> |
| <code>thisIsTheCurrentCoverChooseAnotherCover2</code> | <code>src/views/GalleryView.ts:7003</code> | <code>"현재 커버예요 · 먼저 다른 이미지를 커버로 골라 주세요"</code> |  |
| <code>removeFromNote</code> | <code>src/views/GalleryView.ts:7003</code> | <code>"노트에서 제거"</code> |  |
| <code>remove2</code> | <code>src/views/GalleryView.ts:7007</code> | <code>"제거"</code> |  |
| <code>couldNotRemoveTheImage</code> | <code>src/views/GalleryView.ts:7012</code> | <code>"이미지를 제거하지 못했어요."</code> |  |
| <code>absolutePathToMedia</code> | <code>src/ui/SettingTab.ts:266</code> | <code>"/absolute/path/to/media"</code> |  |
| <code>optional</code> | <code>src/ui/SettingTab.ts:321</code> | <code>"optional"</code> |  |
| <code>pluginName</code> | <code>src/ui/CreateGalleryModal.ts:70</code> | <code>"Character Archive"</code> | Brand display only; keep storage defaults separate. |
| <code>pluginName</code> | <code>src/ui/SettingTab.ts:122</code> | <code>"Character Archive"</code> | Brand display only; keep storage defaults separate. |
| <code>pluginName</code> | <code>src/ui/SettingTab.ts:249</code> | <code>"Character Archive"</code> | Brand display only; keep storage defaults separate. |
| <code>pluginName</code> | <code>src/ui/ShareGalleryModal.ts:253</code> | <code>"Character Archive"</code> | Brand display only; keep storage defaults separate. |
| <code>pluginName</code> | <code>src/views/GalleryView.ts:713</code> | <code>"Character Archive"</code> | Brand display only; keep storage defaults separate. |
| <code>pluginName</code> | <code>src/views/GalleryView.ts:786</code> | <code>"Character Archive"</code> | Brand display only; keep storage defaults separate. |
| <code>externalMediaFallback</code> | <code>src/media/MediaService.ts:84</code> | <code>"External media write failed. Falling back to vault media folder."</code> | Existing English Notice; both language values remain identical. |

New keys with no baseline call site: `languageSettingName`, `languageKorean`, `languageEnglish` (Phase 1B first settings row); `statusOn` / `statusOff` (existing built-in labels are already English and remain On/Off).

## Phase 1B additions

| Key | Location | Exact Korean literal | Variables |
| --- | --- | --- | --- |
| <code>languageSettingDescription</code> | <code>src/ui/SettingTab.ts:112</code> | <code>"플러그인 버튼, 메뉴, 항목 이름의 언어예요. 노트 내용은 바뀌지 않아요."</code> | |
| <code>expandAllGroups</code> | <code>src/views/GalleryView.ts:4178</code> | <code>"모든 그룹 펼치기"</code> | |
| <code>collapseAllGroups</code> | <code>src/views/GalleryView.ts:4179</code> | <code>"모든 그룹 접기"</code> | |

Phase 1B swaps the granted UI consumers at render time. Raw command-label compatibility exports, note parser headings, archive identities, share panel-header values, and share titles retain Korean for out-of-scope consumers and shared output. Gallery language refresh remains owned by the existing `src/main.ts` subscription.

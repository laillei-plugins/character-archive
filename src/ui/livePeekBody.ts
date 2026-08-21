/**
 * Gallery peek body — same structured sheet as before, with live note logic.
 *
 * Paint stays `renderCleanBody` (props grid, ability cards, prompt copy).
 * Peek visibility uses literal H2 titles and does not allowlist-drop sections.
 * Share HTML still calls `parseDetailDoc` in fail-closed share mode.
 */

import { renderCleanBody } from "./cleanBody";
import { PRIVATE_SECTION_MARKER } from "./noteSections";

export { PRIVATE_SECTION_MARKER };

/**
 * Render the selected character note into the side-panel body.
 * Signature stays async so GalleryView staging does not change.
 */
export async function renderLivePeekBody(
  _app: unknown,
  _component: unknown,
  container: HTMLElement,
  markdown: string,
  _sourcePath: string,
): Promise<void> {
  renderCleanBody(container, markdown, "peek");
}

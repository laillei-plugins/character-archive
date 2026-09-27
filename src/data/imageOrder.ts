/**
 * New key order for one image drag.
 * The dragged key is removed before the anchor is located, so moving an
 * earlier key later uses the anchor's index in the remaining list.
 * One occurrence is moved. Other keys, including duplicates, stay.
 */

export function moveImageKey(
  keys: readonly string[],
  key: string,
  anchor: string,
  place: "before" | "after",
): string[] {
  if (place !== "before" && place !== "after") {
    throw new Error("invalid place");
  }
  if (key === anchor) return keys.slice();
  const from = keys.indexOf(key);
  if (from < 0 || keys.indexOf(anchor) < 0) return keys.slice();
  const next = keys.slice();
  next.splice(from, 1);
  const at = next.indexOf(anchor);
  if (at < 0) return keys.slice();
  next.splice(place === "before" ? at : at + 1, 0, key);
  return next;
}

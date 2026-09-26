/** Export note images only after the user explicitly opts in to public sharing. */
export async function exportShareNoteImages<T>(args: {
  include: boolean;
  noteTitle: string;
  cover: T | null;
  coverDataUrl: string | null;
  candidates: () => T[];
  key: (image: T) => string;
  encode: (image: T) => Promise<string | null>;
  label: (image: T) => string;
}): Promise<{ dataUrls: string[]; coverIndex: number }> {
  if (!args.include) return { dataUrls: [], coverIndex: -1 };

  const images = args.candidates();
  const coverKey = args.cover ? args.key(args.cover) : null;
  const dataUrls: string[] = [];
  let coverIndex = -1;
  for (const [index, image] of images.entries()) {
    const isCover = coverKey != null && args.key(image) === coverKey;
    if (isCover) coverIndex = index;
    const dataUrl = isCover
      ? args.coverDataUrl
      : await args.encode(image);
    if (!dataUrl) {
      throw new Error(
        `「${args.noteTitle}」 이미지 ${index + 1} (${args.label(image)})를 읽을 수 없어요.`,
      );
    }
    dataUrls.push(dataUrl);
  }
  return { dataUrls, coverIndex };
}

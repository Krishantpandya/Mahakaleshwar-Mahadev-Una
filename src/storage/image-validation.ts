import sharp from "sharp";

export type SupportedImageMime = "image/jpeg" | "image/png" | "image/webp" | "image/avif";

/** Fast container-signature check. This alone does not prove an image can be decoded. */
export function matchesImageSignature(buffer: Buffer, mimeType: string): boolean {
  if (mimeType === "image/jpeg") {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimeType === "image/png") {
    return buffer.length >= 8 && buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
  }
  if (mimeType === "image/webp") {
    return buffer.length >= 12 &&
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP";
  }
  if (mimeType === "image/avif") {
    if (buffer.length < 16 || buffer.toString("ascii", 4, 8) !== "ftyp") return false;
    const brands = [buffer.toString("ascii", 8, 12)];
    for (let offset = 16; offset + 4 <= buffer.length; offset += 4) {
      brands.push(buffer.toString("ascii", offset, offset + 4));
    }
    return brands.some((brand) => brand === "avif" || brand === "avis");
  }
  return false;
}

/**
 * Fully decodes the image with a pixel limit. Original bytes are retained for storage;
 * the tiny output prevents a second full-size decoded pixel buffer from being retained.
 */
export async function isDecodableImage(buffer: Buffer, mimeType: SupportedImageMime): Promise<boolean> {
  if (!matchesImageSignature(buffer, mimeType)) return false;
  try {
    const image = sharp(buffer, { failOn: "error", limitInputPixels: 20_000_000 });
    const metadata = await image.metadata();
    const expectedFormat = {
      "image/jpeg": ["jpeg"],
      "image/png": ["png"],
      "image/webp": ["webp"],
      "image/avif": ["heif"]
    }[mimeType];
    if (!metadata.format || !expectedFormat.includes(metadata.format)) return false;
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > 20_000_000) return false;
    if (mimeType === "image/avif" && metadata.compression !== "av1") return false;
    await sharp(buffer, { failOn: "error", limitInputPixels: 20_000_000 })
      .rotate()
      .resize({ width: 1, height: 1, fit: "inside" })
      .toBuffer();
    return true;
  } catch {
    return false;
  }
}

export type SupportedImageMime = "image/jpeg" | "image/png" | "image/webp" | "image/avif";

/**
 * Checks the container signature against the multipart Content-Type.
 * This is a format check, not a full image decode or malware scan.
 */
export function matchesImageSignature(buffer: Buffer, mimeType: string): buffer is Buffer {
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

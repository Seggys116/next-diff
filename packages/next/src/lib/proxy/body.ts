/** Reads a request body, giving up (null) as soon as it passes `limit` bytes. */
export async function readLimited(request: Request, limit: number): Promise<Buffer | null> {
  const declared = Number(request.headers.get("content-length"));
  if (declared > limit) return null;
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

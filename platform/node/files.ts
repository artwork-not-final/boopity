import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { ObjectStore } from "../contracts";

const MAX_BYTES = 10 * 1024 * 1024;

/** Opaque hashed filenames: object keys and uploaded filenames never become filesystem paths. */
export class LocalFiles implements ObjectStore {
  constructor(readonly directory: string) {}
  private path(key: string) {
    if (!key || key.length > 1024 || key.includes("\0"))
      throw new Error("Invalid object key");
    return join(this.directory, createHash("sha256").update(key).digest("hex"));
  }
  async put(
    key: string,
    value: ReadableStream<Uint8Array> | ArrayBuffer | ArrayBufferView | string,
  ) {
    const destination = this.path(key);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = join(this.directory, `.upload-${randomUUID()}`);
    const file = await open(temporary, "wx", 0o600);
    let size = 0;
    try {
      const stream =
        value instanceof ReadableStream
          ? value
          : new Response(
              ArrayBuffer.isView(value)
                ? Uint8Array.from(
                    new Uint8Array(
                      value.buffer,
                      value.byteOffset,
                      value.byteLength,
                    ),
                  )
                : value,
            ).body!;
      const reader = stream.getReader();
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > MAX_BYTES) {
            await reader.cancel();
            throw new Error("Object exceeds upload limit");
          }
          // writeFile handles partial writes; each call advances the open file's position.
          await file.writeFile(chunk.value);
        }
      } finally {
        reader.releaseLock();
      }
      await file.sync();
      await file.close();
      await rename(temporary, destination);
      return { size };
    } catch (error) {
      await file.close().catch(() => {});
      await unlink(temporary).catch(() => {});
      throw error;
    }
  }
  async get(key: string) {
    let file;
    try {
      file = await open(
        this.path(key),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > MAX_BYTES)
        throw new Error("Invalid stored object");
      // Bounded files are read before closing; clients cannot keep file descriptors open indefinitely.
      const bytes = await file.readFile();
      return {
        size: bytes.length,
        body: new Response(bytes).body!,
        writeHttpMetadata(headers: Headers) {
          headers.set("content-type", "application/octet-stream");
        },
      };
    } finally {
      await file.close();
    }
  }
  async delete(key: string) {
    try {
      await unlink(this.path(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

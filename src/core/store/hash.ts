import { createHash } from "node:crypto";
import type { Sha256Hex } from "../contracts/index.ts";
import type { ReadonlyFs } from "./fs-port.ts";

export function sha256Hex(bytes: Uint8Array): Sha256Hex {
  return createHash("sha256").update(bytes).digest("hex");
}

/** null when the file is absent or unreadable. */
export function sha256File(fs: ReadonlyFs, absolutePath: string): Sha256Hex | null {
  try {
    return sha256Hex(fs.readFileSync(absolutePath));
  } catch {
    return null;
  }
}

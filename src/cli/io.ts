import { createInterface } from "node:readline";

export type CliIo = {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  isTTY: boolean;
  readLine: () => Promise<string | null>;
};

/** Real terminal streams; `readLine` resolves with one stdin line, or null at EOF. */
export function processIo(input: NodeJS.ReadableStream = process.stdin): CliIo {
  return {
    stdout: (text) => void process.stdout.write(text),
    stderr: (text) => void process.stderr.write(text),
    isTTY: process.stdin.isTTY === true && process.stdout.isTTY === true,
    readLine: () =>
      new Promise<string | null>((resolve) => {
        const lines = createInterface({ input });
        lines.once("line", (line) => {
          resolve(line); // before close(): closing emits "close", which resolves null
          lines.close();
        });
        lines.once("close", () => resolve(null));
      }),
  };
}

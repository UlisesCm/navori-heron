#!/usr/bin/env -S bun --no-env-file --config=/dev/null
import { runCli } from "../src/cli/main.ts";
import { processIo } from "../src/cli/io.ts";

process.exit(await runCli(process.argv.slice(2), processIo()));

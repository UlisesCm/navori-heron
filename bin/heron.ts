#!/usr/bin/env bun
import { runCli } from "../src/cli/main.ts";
import { processIo } from "../src/cli/io.ts";

process.exit(await runCli(process.argv.slice(2), processIo()));

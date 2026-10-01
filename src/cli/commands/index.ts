import type { CommandSpec } from "../command.ts";
import { brandCommand } from "./brand.ts";
import { doctorCommand } from "./doctor.ts";
import { gateCommand } from "./gate.ts";
import { initCommand } from "./init.ts";
import { referencesCommand } from "./references.ts";
import { researchCommand } from "./research.ts";
import { statusCommand } from "./status.ts";

/** Every CLI command; a command group registers here and nowhere else. */
export const COMMANDS: readonly CommandSpec[] = [
  initCommand,
  statusCommand,
  doctorCommand,
  gateCommand,
  referencesCommand,
  brandCommand,
  researchCommand,
];

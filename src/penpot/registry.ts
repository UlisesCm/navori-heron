import { mcpGateway } from "./adapters/mcp/index.ts";
import type { PenpotGateway } from "./ports.ts";

export const defaultPenpotGateway: PenpotGateway = mcpGateway;

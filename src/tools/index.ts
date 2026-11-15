import type { ToolDefinition, WooyaConfig } from '../types.js';
import { makeGrepTool } from './grep.js';
import { makeReadSourceTool } from './read.js';
import { makeListSourcesTool } from './list.js';

export function buildTools(cfg: WooyaConfig): ToolDefinition[] {
  return [makeGrepTool(cfg), makeReadSourceTool(cfg), makeListSourcesTool(cfg)];
}

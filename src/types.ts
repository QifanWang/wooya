export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; args: Record<string, unknown> };
}

export interface ChatMessage {
  role: Role;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<string>;
}

export interface SourceMeta {
  id: string;
  type: 'url' | 'repo' | 'file';
  origin: string;
  title: string;
  ingestedAt: string;
  sha?: string;
  path: string;
}

export interface LearnState {
  concept: string;
  startedAt: string;
  transcript: { speaker: 'agent' | 'user'; text: string }[];
  toolTrace: { name: string; args: Record<string, unknown> }[];
}

export interface SessionState {
  messages: ChatMessage[];
  mode: 'default' | 'learn';
  learn: LearnState | null;
}

export interface WooyaConfig {
  rootDir: string;
  sourcesDir: string;
  outputsDir: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  modelSource: 'config' | 'provider' | 'session' | 'default';
  providerName: string | null;
}

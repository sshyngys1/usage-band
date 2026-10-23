export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export type Tokens = { input: number; output: number; cached: number }

declare module 'claude-code' {
  interface PluginState {
    'usage-band': { limits: Limit[]; tokens: Tokens }
  }
}

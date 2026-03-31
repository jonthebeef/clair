/**
 * Terminal UI — structured display for Clair's output.
 * Formats assistant messages, collapses tool calls, highlights status.
 */

const DIM = '\x1b[2m'
const RESET = '\x1b[0m'
const CYAN = '\x1b[36m'
const YELLOW = '\x1b[33m'
const GREEN = '\x1b[32m'
const MAGENTA = '\x1b[35m'
const RED = '\x1b[31m'

export type ToolCallInfo = {
  name: string
  id?: string
  input?: Record<string, unknown>
}

export type ToolResultInfo = {
  name?: string
  output?: string
  isError?: boolean
}

export function formatClairText(text: string): string {
  return `${YELLOW}clair:${RESET} ${text}`
}

export function formatCastMessage(author: string, content: string, thread?: string): string {
  const threadTag = thread ? ` ${DIM}(thread)${RESET}` : ''
  return `${MAGENTA}cast:${RESET} ${author}: ${content}${threadTag}`
}

export function formatToolCall(tool: ToolCallInfo): string {
  const inputPreview = tool.input
    ? ` ${DIM}${truncate(JSON.stringify(tool.input), 80)}${RESET}`
    : ''
  return `${DIM}  → ${tool.name}${inputPreview}${RESET}`
}

export function formatToolResult(result: ToolResultInfo): string {
  if (result.isError) {
    return `${RED}  ✗ ${result.name ?? 'tool'} error: ${truncate(result.output ?? '', 100)}${RESET}`
  }
  const preview = result.output ? truncate(result.output, 60) : 'ok'
  return `${DIM}  ← ${result.name ?? 'tool'}: ${preview}${RESET}`
}

export function formatSleep(duration: string, ms: number): string {
  return `${DIM}clair: sleeping ${duration} (next tick in ${Math.round(ms / 1000)}s)${RESET}`
}

export function formatPermissionRequest(tool: string, code: string): string {
  return `${CYAN}clair:${RESET} ${RED}Permission needed${RESET} — ${tool}\n       Reply on Cast: ${GREEN}yes ${code}${RESET} or ${RED}no ${code}${RESET}`
}

export function formatBoot(version: string): string {
  return `${CYAN}clair${RESET} v${version}`
}

export function formatStatus(message: string): string {
  return `${GREEN}✓${RESET} ${message}`
}

export function formatShutdown(): string {
  return `\n${CYAN}clair:${RESET} shutting down...`
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s
  return s.slice(0, maxLen - 3) + '...'
}

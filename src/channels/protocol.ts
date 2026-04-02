const SAFE_META_KEY = /^[a-zA-Z_][a-zA-Z0-9_]*$/

export function escapeXmlAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function wrapCdata(content: string, closingTag: string): string {
  if (!content.includes(closingTag)) return content
  return `<![CDATA[${content.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`
}

export function wrapChannelMessage(
  source: string,
  content: string,
  meta?: Record<string, string>,
): string {
  const attrs = Object.entries(meta ?? {})
    .filter(([k]) => SAFE_META_KEY.test(k))
    .map(([k, v]) => ` ${k}="${escapeXmlAttr(v)}"`)
    .join('')
  const safeContent = wrapCdata(content, '</channel>')
  return `<channel source="${escapeXmlAttr(source)}"${attrs}>\n${safeContent}\n</channel>`
}

export const CHANNEL_NOTIFICATION_METHOD = 'notifications/claude/channel'
export const CHANNEL_PERMISSION_METHOD = 'notifications/claude/channel/permission'
export const CHANNEL_PERMISSION_REQUEST_METHOD = 'notifications/claude/channel/permission_request'

export type ChannelNotification = {
  content: string
  meta?: Record<string, string>
}

export type PermissionNotification = {
  request_id: string
  behavior: 'allow' | 'deny'
}

export type PermissionRequest = {
  request_id: string
  tool_name: string
  description: string
  input_preview: string
}

export function parseChannelNotification(
  msg: unknown,
): ChannelNotification | null {
  if (!msg || typeof msg !== 'object') return null
  const { method, params } = msg as Record<string, unknown>
  if (method !== CHANNEL_NOTIFICATION_METHOD) return null
  if (!params || typeof params !== 'object') return null
  const { content, meta } = params as Record<string, unknown>
  if (typeof content !== 'string') return null
  return {
    content,
    meta: meta as Record<string, string> | undefined,
  }
}

export function parsePermissionNotification(
  msg: unknown,
): PermissionNotification | null {
  if (!msg || typeof msg !== 'object') return null
  const { method, params } = msg as Record<string, unknown>
  if (method !== CHANNEL_PERMISSION_METHOD) return null
  if (!params || typeof params !== 'object') return null
  const { request_id, behavior } = params as Record<string, unknown>
  if (typeof request_id !== 'string') return null
  if (behavior !== 'allow' && behavior !== 'deny') return null
  return { request_id, behavior }
}

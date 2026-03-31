export const PERMISSION_REPLY_RE = /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i

const ID_ALPHABET = 'abcdefghijkmnopqrstuvwxyz'

const ID_AVOID_SUBSTRINGS = [
  'fuck','shit','cunt','cock','dick','twat','piss','crap','bitch','whore',
  'ass','tit','cum','fag','dyke','nig','kike','rape','nazi','damn',
  'poo','pee','wank','anus',
]

function hashToId(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  h = h >>> 0
  let s = ''
  for (let i = 0; i < 5; i++) {
    s += ID_ALPHABET[h % 25]
    h = Math.floor(h / 25)
  }
  return s
}

export function shortRequestId(toolUseID: string): string {
  let candidate = hashToId(toolUseID)
  for (let salt = 0; salt < 10; salt++) {
    if (!ID_AVOID_SUBSTRINGS.some(bad => candidate.includes(bad))) {
      return candidate
    }
    candidate = hashToId(`${toolUseID}:${salt}`)
  }
  return candidate
}

export type PermissionResponse = {
  behavior: 'allow' | 'deny'
  fromServer: string
}

export type PermissionCallbacks = {
  onResponse(
    requestId: string,
    handler: (response: PermissionResponse) => void,
  ): () => void
  resolve(
    requestId: string,
    behavior: 'allow' | 'deny',
    fromServer: string,
  ): boolean
}

export function createPermissionCallbacks(): PermissionCallbacks {
  const pending = new Map<string, (response: PermissionResponse) => void>()

  return {
    onResponse(requestId, handler) {
      const key = requestId.toLowerCase()
      pending.set(key, handler)
      return () => { pending.delete(key) }
    },

    resolve(requestId, behavior, fromServer) {
      const key = requestId.toLowerCase()
      const resolver = pending.get(key)
      if (!resolver) return false
      pending.delete(key)
      resolver({ behavior, fromServer })
      return true
    },
  }
}

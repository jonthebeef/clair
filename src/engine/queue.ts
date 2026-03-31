export type QueueMessage = {
  type: 'tick' | 'channel' | 'cron' | 'user'
  content: string
  priority?: 'normal' | 'next'
  meta?: Record<string, string>
}

type Waiter = (msg: QueueMessage) => void

export type MessageQueue = {
  enqueue(msg: QueueMessage): void
  dequeue(): QueueMessage | undefined
  hasMessages(): boolean
  waitForMessage(): Promise<QueueMessage>
  drain(): QueueMessage[]
}

export function createMessageQueue(): MessageQueue {
  const normal: QueueMessage[] = []
  const urgent: QueueMessage[] = []
  const waiters: Waiter[] = []

  return {
    enqueue(msg) {
      if (waiters.length > 0) {
        const waiter = waiters.shift()!
        waiter(msg)
        return
      }
      if (msg.priority === 'next') {
        urgent.push(msg)
      } else {
        normal.push(msg)
      }
    },

    dequeue() {
      if (urgent.length > 0) return urgent.shift()
      return normal.shift()
    },

    hasMessages() {
      return urgent.length > 0 || normal.length > 0
    },

    waitForMessage() {
      const existing = this.dequeue()
      if (existing) return Promise.resolve(existing)
      return new Promise<QueueMessage>(resolve => {
        waiters.push(resolve)
      })
    },

    drain() {
      const all = [...urgent, ...normal]
      urgent.length = 0
      normal.length = 0
      return all
    },
  }
}

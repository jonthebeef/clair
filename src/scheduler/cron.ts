import type { ScheduledTask } from './types'
import type { MessageQueue } from '../engine/queue'

export function nextCronTime(
  expr: string,
  after: Date,
): Date | null {
  try {
    const fields = expr.trim().split(/\s+/)
    if (fields.length !== 5) return null

    const matchers = fields.map(parseCronField)
    if (matchers.some(m => m === null)) return null

    const limit = 24 * 60
    const candidate = new Date(after)
    candidate.setSeconds(0, 0)
    candidate.setMinutes(candidate.getMinutes() + 1)

    for (let i = 0; i < limit; i++) {
      const min = candidate.getMinutes()
      const hour = candidate.getHours()
      const dom = candidate.getDate()
      const month = candidate.getMonth() + 1
      const dow = candidate.getDay()

      if (
        matchers[0]!(min) &&
        matchers[1]!(hour) &&
        matchers[2]!(dom) &&
        matchers[3]!(month) &&
        matchers[4]!(dow)
      ) {
        return candidate
      }
      candidate.setMinutes(candidate.getMinutes() + 1)
    }
    return null
  } catch {
    return null
  }
}

function parseCronField(field: string): ((value: number) => boolean) | null {
  if (field === '*') return () => true

  const stepMatch = field.match(/^\*\/(\d+)$/)
  if (stepMatch) {
    const step = parseInt(stepMatch[1], 10)
    return (v: number) => v % step === 0
  }

  const num = parseInt(field, 10)
  if (!isNaN(num) && field === String(num)) return (v: number) => v === num

  if (field.includes(',')) {
    const values = field.split(',').map(Number)
    if (values.some(isNaN)) return null
    return (v: number) => values.includes(v)
  }

  const rangeMatch = field.match(/^(\d+)-(\d+)$/)
  if (rangeMatch) {
    const lo = parseInt(rangeMatch[1], 10)
    const hi = parseInt(rangeMatch[2], 10)
    return (v: number) => v >= lo && v <= hi
  }

  return null
}

export function addJitter(date: Date): Date {
  const jitterMs = 1000 + Math.floor(Math.random() * 29_000)
  return new Date(date.getTime() + jitterMs)
}

export type Scheduler = {
  addTask(task: Omit<ScheduledTask, 'id' | 'createdAt' | 'nextRun'>): ScheduledTask
  removeTask(id: string): boolean
  getTasks(): ScheduledTask[]
  start(queue: MessageQueue): void
  stop(): void
}

export function createScheduler(maxJobs = 50): Scheduler {
  const tasks = new Map<string, ScheduledTask>()
  let timer: ReturnType<typeof setInterval> | null = null

  function computeNextRun(cron: string): string {
    const next = nextCronTime(cron, new Date())
    return next ? addJitter(next).toISOString() : ''
  }

  return {
    addTask(input) {
      if (tasks.size >= maxJobs) throw new Error(`Max ${maxJobs} scheduled tasks`)
      const task: ScheduledTask = {
        id: crypto.randomUUID().slice(0, 8),
        cron: input.cron,
        prompt: input.prompt,
        durable: input.durable,
        createdAt: new Date().toISOString(),
        nextRun: computeNextRun(input.cron),
      }
      tasks.set(task.id, task)
      return task
    },

    removeTask(id) {
      return tasks.delete(id)
    },

    getTasks() {
      return Array.from(tasks.values())
    },

    start(queue) {
      timer = setInterval(() => {
        const now = Date.now()
        for (const task of tasks.values()) {
          if (!task.nextRun) continue
          const nextMs = new Date(task.nextRun).getTime()
          if (now >= nextMs) {
            queue.enqueue({
              type: 'cron',
              content: `<cron task_id="${task.id}">\n${task.prompt}\n</cron>`,
            })
            task.lastRun = new Date().toISOString()
            task.nextRun = computeNextRun(task.cron)
          }
        }
      }, 10_000)
    },

    stop() {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    },
  }
}

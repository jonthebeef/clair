import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import type { ScheduledTask } from './types'

const TASKS_PATH = join(homedir(), '.clair', 'scheduled_tasks.json')

export function loadTasks(): ScheduledTask[] {
  try {
    if (!existsSync(TASKS_PATH)) return []
    const text = readFileSync(TASKS_PATH, 'utf-8')
    const tasks = JSON.parse(text)
    return Array.isArray(tasks) ? tasks.filter((t: ScheduledTask) => t.durable) : []
  } catch {
    return []
  }
}

export function saveTasks(tasks: ScheduledTask[]): void {
  const dir = dirname(TASKS_PATH)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const durable = tasks.filter(t => t.durable)
  writeFileSync(TASKS_PATH, JSON.stringify(durable, null, 2))
}

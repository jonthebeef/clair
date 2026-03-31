export type ScheduledTask = {
  id: string
  cron: string
  prompt: string
  durable: boolean
  createdAt: string
  lastRun?: string
  nextRun: string
}

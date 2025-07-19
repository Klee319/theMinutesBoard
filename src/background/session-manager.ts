import { Meeting, SharedState, Transcript } from '@/types'
import { TranscriptBuffer } from '@/utils/transcript-buffer'
import { performanceMonitor } from '@/utils/performance-monitor'
import { logger } from '@/utils/logger'
import { STORAGE_CONFIG } from '@/constants/config'

interface SessionData {
  meetingId: string
  transcriptBuffer: TranscriptBuffer
  lastActivity: number
  memoryPressure: boolean
}

export class SessionManager {
  private sessions: Map<string, SessionData> = new Map()
  private sessionTimeouts: Map<string, NodeJS.Timeout> = new Map()
  private readonly SESSION_TIMEOUT = 30 * 60 * 1000 // 30 minutes
  private readonly MAX_SESSIONS = 10
  private readonly MEMORY_CHECK_INTERVAL = 60 * 1000 // 1 minute
  private memoryCheckTimer: NodeJS.Timeout | null = null

  constructor() {
    this.startMemoryMonitoring()
  }

  private startMemoryMonitoring() {
    this.memoryCheckTimer = setInterval(() => {
      this.checkMemoryPressure()
    }, this.MEMORY_CHECK_INTERVAL)
  }

  private checkMemoryPressure() {
    const memoryUsage = performanceMonitor.measureMemory()
    if (!memoryUsage) return

    const usageRatio = memoryUsage.usedJSHeapSize / memoryUsage.jsHeapSizeLimit
    const isHighPressure = usageRatio > 0.8

    if (isHighPressure) {
      logger.warn('High memory pressure detected', { usageRatio })
      this.handleMemoryPressure()
    }

    // Update session memory pressure flags
    this.sessions.forEach((session, id) => {
      session.memoryPressure = isHighPressure
      if (isHighPressure) {
        // Trim old pages from transcript buffer
        session.transcriptBuffer.trimOldPages(5)
      }
    })
  }

  private handleMemoryPressure() {
    // Find and clean up inactive sessions
    const now = Date.now()
    const inactiveSessions = Array.from(this.sessions.entries())
      .filter(([_, session]) => now - session.lastActivity > 10 * 60 * 1000) // 10 minutes
      .sort((a, b) => a[1].lastActivity - b[1].lastActivity)

    // Remove oldest inactive sessions
    for (const [id] of inactiveSessions.slice(0, Math.floor(inactiveSessions.length / 2))) {
      this.endSession(id)
    }
  }

  createSession(meetingId: string): SessionData {
    // Check if we need to remove old sessions
    if (this.sessions.size >= this.MAX_SESSIONS) {
      const oldestSession = Array.from(this.sessions.entries())
        .sort((a, b) => a[1].lastActivity - b[1].lastActivity)[0]
      
      if (oldestSession) {
        this.endSession(oldestSession[0])
      }
    }

    const session: SessionData = {
      meetingId,
      transcriptBuffer: new TranscriptBuffer(),
      lastActivity: Date.now(),
      memoryPressure: false
    }

    this.sessions.set(meetingId, session)
    this.resetSessionTimeout(meetingId)

    logger.info('Session created', { meetingId, totalSessions: this.sessions.size })
    return session
  }

  getSession(meetingId: string): SessionData | undefined {
    const session = this.sessions.get(meetingId)
    if (session) {
      session.lastActivity = Date.now()
      this.resetSessionTimeout(meetingId)
    }
    return session
  }

  addTranscript(meetingId: string, transcript: Transcript): boolean {
    const session = this.getSession(meetingId)
    if (!session) {
      logger.warn('Session not found for transcript', { meetingId })
      return false
    }

    session.transcriptBuffer.add(transcript)
    
    // Record performance metric
    performanceMonitor.recordMetric({
      transcriptCount: session.transcriptBuffer.getTotalCount()
    })

    // Check memory usage
    const memoryEstimate = session.transcriptBuffer.getMemoryEstimate()
    if (memoryEstimate > STORAGE_CONFIG.MAX_MEMORY_PER_SESSION) {
      logger.warn('Session memory limit approaching', { 
        meetingId, 
        memoryEstimateMB: (memoryEstimate / 1024 / 1024).toFixed(2) 
      })
      session.transcriptBuffer.trimOldPages(3)
    }

    return true
  }

  getTranscripts(meetingId: string, count?: number): Transcript[] {
    const session = this.getSession(meetingId)
    if (!session) return []

    return count ? session.transcriptBuffer.getRecent(count) : session.transcriptBuffer.getAll()
  }

  endSession(meetingId: string): Transcript[] {
    const session = this.sessions.get(meetingId)
    if (!session) return []

    // Get all transcripts before cleanup
    const allTranscripts = session.transcriptBuffer.getAll()

    // Clear timeout
    const timeout = this.sessionTimeouts.get(meetingId)
    if (timeout) {
      clearTimeout(timeout)
      this.sessionTimeouts.delete(meetingId)
    }

    // Remove session
    this.sessions.delete(meetingId)

    logger.info('Session ended', { 
      meetingId, 
      transcriptCount: allTranscripts.length,
      remainingSessions: this.sessions.size 
    })

    return allTranscripts
  }

  private resetSessionTimeout(meetingId: string) {
    // Clear existing timeout
    const existingTimeout = this.sessionTimeouts.get(meetingId)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
    }

    // Set new timeout
    const timeout = setTimeout(() => {
      logger.info('Session timeout reached', { meetingId })
      this.endSession(meetingId)
    }, this.SESSION_TIMEOUT)

    this.sessionTimeouts.set(meetingId, timeout)
  }

  getSessionStats() {
    const stats = Array.from(this.sessions.entries()).map(([id, session]) => ({
      meetingId: id,
      transcriptCount: session.transcriptBuffer.getTotalCount(),
      memoryEstimateMB: (session.transcriptBuffer.getMemoryEstimate() / 1024 / 1024).toFixed(2),
      lastActivityAgo: Math.floor((Date.now() - session.lastActivity) / 1000 / 60), // minutes
      memoryPressure: session.memoryPressure
    }))

    return {
      totalSessions: this.sessions.size,
      sessions: stats,
      memoryUsage: performanceMonitor.measureMemory()
    }
  }

  cleanup() {
    // Clear all timeouts
    this.sessionTimeouts.forEach(timeout => clearTimeout(timeout))
    this.sessionTimeouts.clear()

    // Clear memory monitoring
    if (this.memoryCheckTimer) {
      clearInterval(this.memoryCheckTimer)
      this.memoryCheckTimer = null
    }

    // Clear all sessions
    this.sessions.clear()
  }
}

export const sessionManager = new SessionManager()
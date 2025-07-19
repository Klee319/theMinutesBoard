interface PerformanceMetrics {
  memoryUsage: {
    usedJSHeapSize: number
    totalJSHeapSize: number
    jsHeapSizeLimit: number
  }
  renderTime: number
  apiCallTime: number
  transcriptCount: number
  timestamp: number
}

export class PerformanceMonitor {
  private metrics: PerformanceMetrics[] = []
  private readonly MAX_METRICS = 100

  measureMemory(): PerformanceMetrics['memoryUsage'] | null {
    if ('memory' in performance && performance.memory) {
      return {
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit
      }
    }
    return null
  }

  recordMetric(metric: Partial<PerformanceMetrics>) {
    const fullMetric: PerformanceMetrics = {
      memoryUsage: this.measureMemory() || {
        usedJSHeapSize: 0,
        totalJSHeapSize: 0,
        jsHeapSizeLimit: 0
      },
      renderTime: 0,
      apiCallTime: 0,
      transcriptCount: 0,
      timestamp: Date.now(),
      ...metric
    }

    this.metrics.push(fullMetric)
    
    // Keep only recent metrics
    if (this.metrics.length > this.MAX_METRICS) {
      this.metrics.shift()
    }
  }

  getMetrics(): PerformanceMetrics[] {
    return [...this.metrics]
  }

  getAverageMetrics(): Partial<PerformanceMetrics> {
    if (this.metrics.length === 0) return {}

    const sum = this.metrics.reduce((acc, metric) => ({
      memoryUsage: {
        usedJSHeapSize: acc.memoryUsage.usedJSHeapSize + metric.memoryUsage.usedJSHeapSize,
        totalJSHeapSize: acc.memoryUsage.totalJSHeapSize + metric.memoryUsage.totalJSHeapSize,
        jsHeapSizeLimit: metric.memoryUsage.jsHeapSizeLimit // Same for all
      },
      renderTime: acc.renderTime + metric.renderTime,
      apiCallTime: acc.apiCallTime + metric.apiCallTime,
      transcriptCount: acc.transcriptCount + metric.transcriptCount
    }), {
      memoryUsage: { usedJSHeapSize: 0, totalJSHeapSize: 0, jsHeapSizeLimit: 0 },
      renderTime: 0,
      apiCallTime: 0,
      transcriptCount: 0
    })

    const count = this.metrics.length
    return {
      memoryUsage: {
        usedJSHeapSize: sum.memoryUsage.usedJSHeapSize / count,
        totalJSHeapSize: sum.memoryUsage.totalJSHeapSize / count,
        jsHeapSizeLimit: sum.memoryUsage.jsHeapSizeLimit
      },
      renderTime: sum.renderTime / count,
      apiCallTime: sum.apiCallTime / count,
      transcriptCount: sum.transcriptCount / count
    }
  }

  measureRenderTime<T>(fn: () => T): T {
    const start = performance.now()
    const result = fn()
    const renderTime = performance.now() - start
    this.recordMetric({ renderTime })
    return result
  }

  async measureApiCall<T>(fn: () => Promise<T>): Promise<T> {
    const start = performance.now()
    try {
      const result = await fn()
      const apiCallTime = performance.now() - start
      this.recordMetric({ apiCallTime })
      return result
    } catch (error) {
      const apiCallTime = performance.now() - start
      this.recordMetric({ apiCallTime })
      throw error
    }
  }

  logPerformanceReport(): void {
    const avg = this.getAverageMetrics()
    console.log('Performance Report:', {
      averageMemoryUsageMB: avg.memoryUsage ? (avg.memoryUsage.usedJSHeapSize / 1024 / 1024).toFixed(2) : 'N/A',
      averageRenderTimeMs: avg.renderTime?.toFixed(2) || 'N/A',
      averageApiCallTimeMs: avg.apiCallTime?.toFixed(2) || 'N/A',
      averageTranscriptCount: avg.transcriptCount?.toFixed(0) || 'N/A'
    })
  }
}

export const performanceMonitor = new PerformanceMonitor()
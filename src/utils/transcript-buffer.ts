import { Transcript } from '@/types'

export class TranscriptBuffer {
  private pages: Map<number, Transcript[]> = new Map()
  private currentPage = 0
  private readonly PAGE_SIZE = 100
  private totalCount = 0

  add(transcript: Transcript): void {
    if (!this.pages.has(this.currentPage)) {
      this.pages.set(this.currentPage, [])
    }
    
    const page = this.pages.get(this.currentPage)!
    page.push(transcript)
    this.totalCount++
    
    if (page.length >= this.PAGE_SIZE) {
      this.currentPage++
    }
  }

  addBatch(transcripts: Transcript[]): void {
    transcripts.forEach(transcript => this.add(transcript))
  }

  getRecent(count: number): Transcript[] {
    const result: Transcript[] = []
    
    // Start from the current page and work backwards
    for (let pageNum = this.currentPage; pageNum >= 0 && result.length < count; pageNum--) {
      const page = this.pages.get(pageNum)
      if (!page) continue
      
      // Add items from this page (in reverse order for most recent first)
      for (let i = page.length - 1; i >= 0 && result.length < count; i--) {
        result.push(page[i])
      }
    }
    
    return result.reverse() // Reverse to get chronological order
  }

  getAll(): Transcript[] {
    const result: Transcript[] = []
    
    for (let pageNum = 0; pageNum <= this.currentPage; pageNum++) {
      const page = this.pages.get(pageNum)
      if (page) {
        result.push(...page)
      }
    }
    
    return result
  }

  getPage(pageNumber: number): Transcript[] {
    return this.pages.get(pageNumber) || []
  }

  getTotalCount(): number {
    return this.totalCount
  }

  getPageCount(): number {
    return this.currentPage + 1
  }

  clear(): void {
    this.pages.clear()
    this.currentPage = 0
    this.totalCount = 0
  }

  // Memory optimization: remove old pages if memory pressure is high
  trimOldPages(keepPages: number): void {
    const startPage = Math.max(0, this.currentPage - keepPages + 1)
    
    for (let pageNum = 0; pageNum < startPage; pageNum++) {
      this.pages.delete(pageNum)
    }
  }

  // Get memory estimate in bytes
  getMemoryEstimate(): number {
    let totalSize = 0
    
    this.pages.forEach(page => {
      if (!page) return
      
      page.forEach(transcript => {
        if (!transcript) return
        
        // Rough estimate: each character is 2 bytes in memory
        totalSize += (transcript.text?.length || 0) * 2
        totalSize += (transcript.speaker?.length || 0) * 2
        totalSize += 100 // Overhead for object structure
      })
    })
    
    return totalSize
  }

  // Iterator for efficient traversal
  *[Symbol.iterator](): Iterator<Transcript> {
    for (let pageNum = 0; pageNum <= this.currentPage; pageNum++) {
      const page = this.pages.get(pageNum)
      if (page) {
        for (const transcript of page) {
          yield transcript
        }
      }
    }
  }
}
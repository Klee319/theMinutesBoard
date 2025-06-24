import { Meeting } from '@/types'

/**
 * 会議の主題を議事録から抽出する
 * @param meeting 会議データ
 * @returns 抽出された主題、または会議タイトル
 */
export function extractMeetingTopic(meeting: Meeting): string {
  if (!meeting.minutes?.content) {
    return meeting.title
  }

  const content = meeting.minutes.content
  
  // パターン1: "会議の目的: XXX" を探す
  const purposeMatch = content.match(/会議の目的[:：]\s*(.+?)[\n\r]/i)
  if (purposeMatch && purposeMatch[1]) {
    return purposeMatch[1].trim()
  }
  
  // パターン2: "## 概要" セクションから目的を探す
  const overviewSection = content.match(/##\s*概要[\s\S]*?(?=##|$)/i)
  if (overviewSection) {
    const purposeInOverview = overviewSection[0].match(/目的[:：]\s*(.+?)[\n\r]/i)
    if (purposeInOverview && purposeInOverview[1]) {
      return purposeInOverview[1].trim()
    }
  }
  
  // パターン3: 最初の見出しを使用
  const firstHeading = content.match(/^#+\s+(.+?)$/m)
  if (firstHeading && firstHeading[1] && firstHeading[1] !== '会議議事録') {
    return firstHeading[1].trim()
  }
  
  // パターン4: 最初の段落から要約を作成（50文字まで）
  const firstParagraph = content.split('\n').find(line => 
    line.trim() && !line.startsWith('#') && !line.startsWith('*') && !line.startsWith('-')
  )
  if (firstParagraph) {
    const summary = firstParagraph.trim()
    return summary.length > 50 ? summary.substring(0, 47) + '...' : summary
  }
  
  // デフォルト: 元のタイトルを返す
  return meeting.title
}
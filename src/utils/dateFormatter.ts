/**
 * 日付フォーマット用のユーティリティ関数
 */

/**
 * 日付を日本語ロケールでフォーマットする
 * @param date - Date オブジェクト、文字列、またはundefined
 * @param defaultText - 無効な日付の場合に返すデフォルトテキスト
 * @returns フォーマットされた日付文字列
 */
export function formatDate(date: Date | string | undefined, defaultText: string = '期限未設定'): string {
  if (!date) {
    return defaultText
  }

  try {
    const dateObj = date instanceof Date ? date : new Date(date)
    
    // Invalid Date チェック
    if (isNaN(dateObj.getTime())) {
      return defaultText
    }
    
    return dateObj.toLocaleDateString('ja-JP')
  } catch (error) {
    console.warn('Date formatting error:', error)
    return defaultText
  }
}

/**
 * 日付と時刻を日本語ロケールでフォーマットする
 * @param date - Date オブジェクト、文字列、またはundefined
 * @param defaultText - 無効な日付の場合に返すデフォルトテキスト
 * @returns フォーマットされた日時文字列
 */
export function formatDateTime(date: Date | string | undefined, defaultText: string = '未設定'): string {
  if (!date) {
    return defaultText
  }

  try {
    const dateObj = date instanceof Date ? date : new Date(date)
    
    // Invalid Date チェック
    if (isNaN(dateObj.getTime())) {
      return defaultText
    }
    
    return dateObj.toLocaleString('ja-JP')
  } catch (error) {
    console.warn('DateTime formatting error:', error)
    return defaultText
  }
}

/**
 * 日付の相対的な表示（例：今日、明日、3日後）を返す
 * @param date - Date オブジェクト、文字列、またはundefined
 * @param includeTime - 時刻も含めるかどうか
 * @returns 相対的な日付表現
 */
export function formatRelativeDate(date: Date | string | undefined, includeTime: boolean = false): string {
  if (!date) {
    return '期限未設定'
  }

  try {
    const dateObj = date instanceof Date ? date : new Date(date)
    
    // Invalid Date チェック
    if (isNaN(dateObj.getTime())) {
      return '期限未設定'
    }

    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const targetDate = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate())
    
    const diffTime = targetDate.getTime() - today.getTime()
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
    
    let relativePart = ''
    
    if (diffDays === 0) {
      relativePart = '今日'
    } else if (diffDays === 1) {
      relativePart = '明日'
    } else if (diffDays === -1) {
      relativePart = '昨日'
    } else if (diffDays > 0 && diffDays <= 7) {
      relativePart = `${diffDays}日後`
    } else if (diffDays < 0 && diffDays >= -7) {
      relativePart = `${Math.abs(diffDays)}日前`
    } else {
      return formatDate(dateObj)
    }
    
    if (includeTime) {
      const time = dateObj.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
      return `${relativePart} ${time}`
    }
    
    return relativePart
  } catch (error) {
    console.warn('Relative date formatting error:', error)
    return '期限未設定'
  }
}

/**
 * 期限切れかどうかをチェックする
 * @param date - Date オブジェクト、文字列、またはundefined
 * @returns 期限切れの場合はtrue
 */
export function isOverdue(date: Date | string | undefined): boolean {
  if (!date) {
    return false
  }

  try {
    const dateObj = date instanceof Date ? date : new Date(date)
    
    // Invalid Date チェック
    if (isNaN(dateObj.getTime())) {
      return false
    }
    
    return dateObj < new Date()
  } catch (error) {
    console.warn('Overdue check error:', error)
    return false
  }
}

/**
 * 日付を安全にDateオブジェクトに変換する
 * @param date - Date オブジェクト、文字列、またはundefined
 * @returns 有効なDateオブジェクトまたはundefined
 */
export function toSafeDate(date: Date | string | undefined): Date | undefined {
  if (!date) {
    return undefined
  }

  try {
    const dateObj = date instanceof Date ? date : new Date(date)
    
    // Invalid Date チェック
    if (isNaN(dateObj.getTime())) {
      return undefined
    }
    
    return dateObj
  } catch (error) {
    console.warn('Date conversion error:', error)
    return undefined
  }
}
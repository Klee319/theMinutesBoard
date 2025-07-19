/**
 * Markdownを簡易的なHTMLに変換する
 * @param markdown Markdown形式のテキスト
 * @returns HTML形式のテキスト
 */
export function formatMarkdownToHTML(markdown: string): string {
  // nullまたはundefinedチェック
  if (!markdown) {
    return ''
  }
  
  let html = markdown
  
  // 折りたたみマーカーを含むセクションヘッダーを処理
  // ## [HH:MM] 議題名 [ヘッドライン] ▼ 形式を折りたたみ可能なHTMLに変換
  const sections: string[] = []
  let sectionId = 0
  
  html = html.replace(
    /^## (\[\d{2}:\d{2}\].+?) ▼$/gm,
    (match, content) => {
      const id = `section-${sectionId++}`
      sections.push(id)
      return `<details class="topic-section" id="${id}">
<summary class="topic-header">
<h2 class="inline-block">${content}</h2>
</summary>
<div class="topic-content">`
    }
  )
  
  // 各セクションの終わりに閉じタグを追加
  const lines = html.split('\n')
  const result: string[] = []
  let inSection = false
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    
    if (line.includes('<details class="topic-section"')) {
      if (inSection) {
        result.push('</div></details>')
      }
      inSection = true
    } else if (line.startsWith('---') && inSection) {
      result.push('</div></details>')
      inSection = false
    }
    
    result.push(line)
  }
  
  if (inSection) {
    result.push('</div></details>')
  }
  
  html = result.join('\n')
  
  // 通常のMarkdown変換
  html = html
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/^\* (.+)$/gim, '<li>$1</li>')
    .replace(/^\- (.+)$/gim, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>')
  
  // スタイルを追加
  return `
    <style>
      .topic-section {
        margin-bottom: 1rem;
        border: 1px solid #e5e7eb;
        border-radius: 0.5rem;
        overflow: hidden;
      }
      .topic-header {
        padding: 0.75rem 1rem;
        background-color: #f9fafb;
        cursor: pointer;
        list-style: none;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        user-select: none;
      }
      .topic-header:hover {
        background-color: #f3f4f6;
      }
      .topic-header::before {
        content: '▶';
        font-size: 0.75rem;
        transition: transform 0.2s;
        display: inline-block;
      }
      details[open] .topic-header::before {
        transform: rotate(90deg);
      }
      .topic-header h2 {
        margin: 0;
        font-size: 1.125rem;
        font-weight: 600;
      }
      .topic-content {
        padding: 1rem;
        border-top: 1px solid #e5e7eb;
      }
    </style>
    ${html}
  `
}
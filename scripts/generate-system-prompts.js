import { readFileSync, writeFileSync, readdirSync } from 'fs'
import { join, basename } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// マークダウンファイルを読み込んでTypeScript定数として生成
function generateSystemPrompts() {
  const promptsDir = join(process.cwd(), 'src', 'system-prompts')
  const outputFile = join(promptsDir, 'index.ts')
  
  // .mdファイルを全て取得
  const mdFiles = readdirSync(promptsDir).filter(file => file.endsWith('.md'))
  
  let output = '// このファイルは自動生成されています。直接編集しないでください。\n'
  output += '// マークダウンファイルを編集し、ビルドを実行してください。\n\n'
  
  const exports = []
  
  mdFiles.forEach(file => {
    const filePath = join(promptsDir, file)
    const content = readFileSync(filePath, 'utf-8')
    
    // ファイル名から定数名を生成 (例: minutes-generation.md -> MINUTES_GENERATION_PROMPT)
    const baseName = basename(file, '.md')
    const constName = baseName.toUpperCase().replace(/-/g, '_') + '_PROMPT'
    
    // バッククォートをエスケープ
    let escapedContent = content.replace(/`/g, '\\`').replace(/\$/g, '\\$')
    
    // minutes-generation.mdの場合、Unknown置換の指示を追加
    if (file === 'minutes-generation.md' && !content.includes('Unknown')) {
      escapedContent += '\n- **重要**: 発言者名が「Unknown」と記録されている場合は、すべて「{{userName}}」に置換して議事録を作成すること'
    }
    
    output += `export const ${constName} = \`${escapedContent}\`;\n\n`
    exports.push(constName)
  })
  
  // エクスポート一覧を追加
  output += `// 全てのプロンプトをエクスポート\n`
  output += `export const SYSTEM_PROMPTS = {\n`
  exports.forEach(constName => {
    output += `  ${constName},\n`
  })
  output += `};\n`
  
  writeFileSync(outputFile, output)
  console.log(`✅ Generated ${outputFile} from ${mdFiles.length} markdown files`)
}

generateSystemPrompts()
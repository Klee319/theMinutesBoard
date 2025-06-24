import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// プロンプトファイルのマッピング
const promptFiles = [
  {
    input: 'system-prompts/chat-assistant.md',
    outputName: 'CHAT_ASSISTANT_PROMPT'
  },
  {
    input: 'system-prompts/minutes-generation.md',
    outputName: 'MINUTES_GENERATION_PROMPT'
  },
  {
    input: 'system-prompts/nextsteps-generation.md',
    outputName: 'NEXTSTEPS_GENERATION_PROMPT'
  }
];

// 出力ファイルのヘッダー
const outputHeader = `// このファイルは自動生成されています。直接編集しないでください。
// マークダウンファイルを編集し、ビルドを実行してください。

`;

// プロンプトをTypeScript定数に変換
function convertToTypeScript() {
  let output = outputHeader;
  
  promptFiles.forEach(({ input, outputName }) => {
    const filePath = path.join(__dirname, '..', input);
    const content = fs.readFileSync(filePath, 'utf8');
    
    // バッククォートをエスケープ
    const escapedContent = content.replace(/`/g, '\\`');
    
    output += `export const ${outputName} = \`${escapedContent}\`;\n\n`;
  });
  
  // すべてのプロンプトをエクスポート
  output += `// 全てのプロンプトをエクスポート
export const SYSTEM_PROMPTS = {
${promptFiles.map(({ outputName }) => `  ${outputName},`).join('\n')}
};
`;
  
  // 出力ファイルに書き込み
  const outputPath = path.join(__dirname, '..', 'src', 'system-prompts', 'index.ts');
  fs.writeFileSync(outputPath, output, 'utf8');
  
  console.log('✅ System prompts built successfully!');
}

// 実行
convertToTypeScript();
#!/usr/bin/env node

/**
 * パフォーマンステスト実行スクリプト
 * Node.js環境でテストを実行する
 */

import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runTests() {
  console.log('theMinutesBoard パフォーマンステストを開始します...\n');
  
  const browser = await chromium.launch({
    headless: false, // UIを表示してテスト実行を確認
    devtools: true
  });

  try {
    const context = await browser.newContext({
      // 拡張機能のコンテキストで実行
      viewport: { width: 1280, height: 800 }
    });
    
    const page = await context.newPage();
    
    // テストページを開く
    const testPagePath = `file://${path.resolve(__dirname, '../tests/performance/index.html')}`;
    await page.goto(testPagePath);
    
    console.log('テストページを開きました:', testPagePath);
    console.log('「全テスト実行」ボタンをクリックしてテストを開始してください。\n');
    
    // テスト完了を待つ
    await page.waitForSelector('#downloadReport:not([disabled])', {
      timeout: 600000 // 10分のタイムアウト
    });
    
    console.log('\nテストが完了しました！');
    
    // レポート内容を取得
    const reportContent = await page.textContent('#reportContent');
    console.log('\n=== パフォーマンステストレポート ===\n');
    console.log(reportContent);
    
    // レポートをファイルに保存
    const fs = await import('fs/promises');
    const reportPath = path.resolve(__dirname, `../../performance-report-${new Date().toISOString().split('T')[0]}.md`);
    await fs.writeFile(reportPath, reportContent);
    console.log(`\nレポートを保存しました: ${reportPath}`);
    
  } catch (error) {
    console.error('テスト実行中にエラーが発生しました:', error);
  } finally {
    await browser.close();
  }
}

// メイン実行
runTests().catch(console.error);
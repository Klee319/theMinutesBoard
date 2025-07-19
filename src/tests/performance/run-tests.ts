/**
 * パフォーマンステスト実行スクリプト
 * コマンドラインから直接実行可能
 */

// グローバルオブジェクトのモック
(global as any).chrome = {
  storage: {
    local: {
      get: (keys: string[], callback: Function) => {
        callback({ meetings: [] });
      },
      set: (data: any, callback?: Function) => {
        if (callback) callback();
      },
      remove: (keys: string[], callback?: Function) => {
        if (callback) callback();
      }
    }
  },
  runtime: {
    lastError: null,
    getManifest: () => ({ update_url: undefined })
  }
};

(global as any).window = {
  setInterval: global.setInterval,
  clearInterval: global.clearInterval,
  setTimeout: global.setTimeout,
  clearTimeout: global.clearTimeout
};

(global as any).performance = {
  now: () => Date.now(),
  memory: {
    usedJSHeapSize: 50 * 1024 * 1024, // 50MB
    totalJSHeapSize: 100 * 1024 * 1024,
    jsHeapSizeLimit: 2048 * 1024 * 1024
  },
  mark: () => {},
  measure: () => {},
  getEntriesByName: () => [{ duration: Math.random() * 100 }],
  getEntries: () => []
};

(global as any).PerformanceObserver = class {
  observe() {}
  disconnect() {}
};

(global as any).document = {
  createElement: () => ({
    textContent: '',
    style: {},
    click: () => {},
    href: ''
  })
};

(global as any).URL = {
  createObjectURL: () => 'blob:mock',
  revokeObjectURL: () => {}
};

(global as any).Blob = class {
  constructor(public parts: any[], public options: any) {}
};

// navigator.getBattery のモック
(global as any).navigator = {
  getBattery: async () => ({
    level: 0.85
  })
};

import { PerformanceTestSuite } from './performance-test';
import { PerformanceReportGenerator } from './performance-report';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('🚀 theMinutesBoard パフォーマンステストを開始します...\n');
  
  const suite = new PerformanceTestSuite();
  const generator = new PerformanceReportGenerator();
  
  try {
    console.log('📊 テスト1: 議事録生成時間の測定...');
    const minutesGeneration = await suite.testMinutesGenerationTime();
    console.log(`  結果: ${minutesGeneration.passed ? '✅ 合格' : '❌ 不合格'}`);
    console.log(`  平均時間: ${minutesGeneration.averageTime.toFixed(2)}秒`);
    console.log(`  最大時間: ${minutesGeneration.maxTime.toFixed(2)}秒\n`);
    
    console.log('🧪 テスト2: 3時間会議シミュレーション...');
    const threeHourMeeting = await suite.test3HourMeetingSimulation();
    console.log(`  結果: ${threeHourMeeting.passed ? '✅ 合格' : '❌ 不合格'}`);
    console.log(`  トランスクリプト数: ${threeHourMeeting.transcriptCount}件`);
    console.log(`  メモリ増加: ${((threeHourMeeting.memoryUsage.final - threeHourMeeting.memoryUsage.initial) / threeHourMeeting.memoryUsage.initial * 100).toFixed(1)}%\n`);
    
    console.log('💾 テスト3: メモリ使用量の継続的監視...');
    const memoryUsage = await suite.testMemoryUsageContinuous();
    console.log(`  結果: ${memoryUsage.passed ? '✅ 合格' : '❌ 不合格'}`);
    console.log(`  メモリリーク: ${memoryUsage.leakDetected ? '⚠️ 検出' : '✅ なし'}\n`);
    
    console.log('⚡ テスト4: CPU使用率の測定...');
    const cpuUsage = await suite.testCPUUsage();
    console.log(`  平均CPU時間: ${cpuUsage.averageCPU.toFixed(2)}ms`);
    console.log(`  ピークCPU時間: ${cpuUsage.peakCPU.toFixed(2)}ms\n`);
    
    console.log('🔋 テスト5: バッテリー消費量への影響評価...');
    const batteryImpact = await suite.testBatteryImpact();
    if (batteryImpact.supported) {
      console.log(`  バッテリー消費: ${batteryImpact.batteryLevel?.consumed.toFixed(1)}%`);
    } else {
      console.log('  Battery Status APIがサポートされていません');
    }
    
    // 結果をまとめる
    const results = {
      minutesGeneration,
      threeHourMeeting,
      memoryUsage,
      cpuUsage,
      batteryImpact
    };
    
    // レポート生成
    console.log('\n📝 レポートを生成しています...');
    const report = generator.generateReport(results);
    
    // レポートをファイルに保存
    const reportPath = path.join(__dirname, `../../../performance-report-${new Date().toISOString().split('T')[0]}.md`);
    fs.writeFileSync(reportPath, report);
    console.log(`✅ レポートを保存しました: ${reportPath}`);
    
    // 全体の結果サマリー
    console.log('\n🎯 テスト結果サマリー:');
    console.log('=====================================');
    console.log(`議事録生成時間目標（15秒以内）: ${minutesGeneration.passed ? '✅ 達成' : '❌ 未達成'}`);
    console.log(`3時間会議メモリ使用量: ${threeHourMeeting.passed ? '✅ 合格' : '❌ 不合格'}`);
    console.log(`メモリリーク: ${!memoryUsage.leakDetected ? '✅ なし' : '⚠️ 検出'}`);
    console.log('=====================================');
    
    const allPassed = minutesGeneration.passed && threeHourMeeting.passed && memoryUsage.passed;
    console.log(`\n総合評価: ${allPassed ? '✅ すべてのテストに合格しました！' : '⚠️ 一部のテストが不合格です'}`);
    
  } catch (error) {
    console.error('\n❌ テスト実行中にエラーが発生しました:', error);
    process.exit(1);
  }
}

// 実行
main().catch(console.error);
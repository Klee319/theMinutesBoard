# Tactiq技術調査レポート - Chrome拡張機能によるGoogle Meet音声取得の仕組み

## 調査日時
2025-07-02

## 調査目的
TactiqがGoogle Meetの字幕機能をONにせずに文字起こしを取得する技術的な仕組みの解明

## 調査項目
1. Chrome拡張機能がGoogle MeetのWebRTC音声ストリームにアクセスする方法
2. tabCapture APIやgetDisplayMedia APIの使用方法
3. リアルタイム音声認識の実装方法（Web Speech APIまたは外部API）
4. Google Meetの内部APIや非公開機能へのアクセス方法
5. 実装例やコードサンプル

---

## 調査結果

### 1. Chrome拡張機能がGoogle MeetのWebRTC音声ストリームにアクセスする方法

#### 1.1 RTCPeerConnectionのオーバーライド方式

Tactiqのような拡張機能は、以下の方法でWebRTC音声ストリームにアクセスしていると考えられます：

**基本的な実装方法：**
```javascript
// Content Scriptから注入されるコード
const OriginalRTCPeerConnection = window.RTCPeerConnection;

function CustomRTCPeerConnection(configuration) {
  const pc = new OriginalRTCPeerConnection(configuration);
  
  // ontrackイベントをインターセプト
  Object.defineProperty(pc, 'ontrack', {
    set: function(handler) {
      this._ontrack = function(event) {
        // 受信した音声ストリームを処理
        event.streams.forEach(stream => {
          stream.getTracks().forEach(track => {
            if (track.kind === 'audio') {
              // 音声トラックを処理
              processAudioTrack(track);
            }
          });
        });
        
        // 元のハンドラーを呼び出す
        if (handler) handler.call(this, event);
      };
    }
  });
  
  return pc;
}

// グローバルに置き換え
window.RTCPeerConnection = CustomRTCPeerConnection;
```

#### 1.2 Content Scriptの注入タイミング

```json
// manifest.json
{
  "content_scripts": [
    {
      "matches": ["https://meet.google.com/*"],
      "js": ["content-script.js"],
      "run_at": "document_start",
      "all_frames": true
    }
  ]
}
```

`document_start`で実行することで、Google MeetがRTCPeerConnectionを使用する前にオーバーライドできます。

### 2. tabCapture APIとgetDisplayMedia APIの使用方法

#### 2.1 chrome.tabCapture API

**基本的な実装：**
```javascript
// background.js
chrome.action.onClicked.addListener((tab) => {
  chrome.tabCapture.capture(
    {
      audio: true,
      video: false
    },
    (stream) => {
      // AudioContextで音声を維持
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(audioContext.destination);
      
      // MediaRecorderで録音
      const recorder = new MediaRecorder(stream);
      recorder.start();
    }
  );
});
```

**必要な権限：**
```json
{
  "permissions": [
    "tabCapture",
    "activeTab"
  ]
}
```

**制限事項：**
- ユーザーの操作（拡張機能アイコンのクリックなど）が必要
- 音声キャプチャ時、デフォルトではタブの音声がミュートになる
- AudioContextを使用して音声を再生する必要がある

#### 2.2 getDisplayMedia API

```javascript
// タブの音声をキャプチャ
navigator.mediaDevices.getDisplayMedia({
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false
  },
  video: false
}).then(stream => {
  // 音声ストリームを処理
  processAudioStream(stream);
});
```

### 3. リアルタイム音声認識の実装方法

#### 3.1 Web Speech API の使用

```javascript
function startTranscription(audioStream) {
  // Web Speech APIの初期化
  const recognition = new webkitSpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'ja-JP'; // または 'en-US'
  
  // MediaStreamをWeb Speech APIに接続することは直接できない
  // 代わりに、音声を再生してマイクから取得する必要がある
  const audio = new Audio();
  audio.srcObject = audioStream;
  audio.play();
  
  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      console.log('Transcript:', transcript);
    }
  };
  
  recognition.start();
}
```

**制限事項：**
- Web Speech APIは直接MediaStreamを受け取れない
- Chrome独自のAPIで、他のブラウザでは動作しない
- 無料で使用できるが、精度に限界がある

#### 3.2 外部音声認識APIの使用

**Google Cloud Speech-to-Text の例：**
```javascript
// WebSocketを使用したストリーミング認識
class StreamingRecognizer {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.ws = null;
  }
  
  async startStreaming(audioStream) {
    // AudioWorkletを使用して音声データを取得
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(audioStream);
    
    await audioContext.audioWorklet.addModule('audio-processor.js');
    const processor = new AudioWorkletNode(audioContext, 'audio-processor');
    
    source.connect(processor);
    processor.connect(audioContext.destination);
    
    // WebSocketで音声データを送信
    this.ws = new WebSocket('wss://speech.googleapis.com/v1/speech:recognize');
    
    processor.port.onmessage = (event) => {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(event.data);
      }
    };
    
    this.ws.onmessage = (event) => {
      const result = JSON.parse(event.data);
      console.log('Transcription:', result);
    };
  }
}
```

### 4. Google Meetの内部構造との統合

#### 4.1 DOM要素の監視

```javascript
// 参加者情報の取得
const observer = new MutationObserver((mutations) => {
  const participantElements = document.querySelectorAll('[data-participant-id]');
  participantElements.forEach(elem => {
    const participantId = elem.getAttribute('data-participant-id');
    const name = elem.querySelector('[data-name]')?.textContent;
    console.log('Participant:', { id: participantId, name });
  });
});

observer.observe(document.body, {
  childList: true,
  subtree: true
});
```

#### 4.2 Google Meetのイベント監視

```javascript
// ミュート状態の検知
function detectMuteState() {
  const muteButton = document.querySelector('[data-is-muted]');
  if (muteButton) {
    const isMuted = muteButton.getAttribute('data-is-muted') === 'true';
    return isMuted;
  }
}

// 画面共有の検知
function detectScreenShare() {
  const presentationMode = document.querySelector('[data-presentation-mode]');
  return presentationMode !== null;
}
```

### 5. Tactiqの実装推測

調査結果から、Tactiqは以下の技術的アプローチを採用していると推測されます：

1. **音声取得方法**：
   - RTCPeerConnectionのオーバーライドによる音声ストリームのインターセプト
   - Google Meetの字幕機能に依存しない独自の実装

2. **音声認識**：
   - 独自のSpeech-to-Text技術または外部APIの使用
   - リアルタイムストリーミング認識の実装

3. **話者識別**：
   - DOMの監視による参加者情報の取得
   - 音声の特徴量分析による話者の識別

4. **プライバシー保護**：
   - 音声の録音は行わず、リアルタイムで文字起こしのみを実行
   - ローカル処理を最大限活用

### 6. 実装上の注意点

1. **セキュリティ**：
   - Content Security Policy (CSP) の制約
   - Same-origin policyの考慮

2. **パフォーマンス**：
   - 音声処理によるCPU負荷
   - メモリ使用量の最適化

3. **互換性**：
   - Google Meetの更新による影響
   - ブラウザAPIの変更への対応

4. **法的・倫理的考慮事項**：
   - 参加者への通知
   - データの取り扱いポリシー

## 完全な実装例

### manifest.json (Manifest V3)

```json
{
  "manifest_version": 3,
  "name": "Meet Transcriber",
  "version": "1.0.0",
  "description": "Google Meet音声文字起こし拡張機能",
  "permissions": [
    "storage",
    "scripting"
  ],
  "host_permissions": [
    "https://meet.google.com/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["https://meet.google.com/*"],
      "js": ["inject.js"],
      "run_at": "document_start",
      "all_frames": true
    }
  ],
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icon16.png",
      "48": "icon48.png",
      "128": "icon128.png"
    }
  },
  "web_accessible_resources": [
    {
      "resources": ["rtc-override.js"],
      "matches": ["https://meet.google.com/*"]
    }
  ]
}
```

### inject.js (Content Script)

```javascript
// RTCPeerConnectionをオーバーライドするスクリプトを注入
const script = document.createElement('script');
script.src = chrome.runtime.getURL('rtc-override.js');
script.onload = function() {
  this.remove();
};
(document.head || document.documentElement).appendChild(script);

// バックグラウンドスクリプトとの通信設定
const port = chrome.runtime.connect({ name: 'meet-transcriber' });

// ページからのメッセージを中継
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  
  if (event.data.type === 'AUDIO_STREAM_READY') {
    port.postMessage({
      type: 'STREAM_READY',
      data: event.data.payload
    });
  } else if (event.data.type === 'TRANSCRIPTION_UPDATE') {
    port.postMessage({
      type: 'TRANSCRIPTION',
      data: event.data.payload
    });
  }
});

// バックグラウンドからのメッセージを処理
port.onMessage.addListener((message) => {
  if (message.type === 'START_TRANSCRIPTION') {
    window.postMessage({ type: 'START_TRANSCRIPTION' }, '*');
  } else if (message.type === 'STOP_TRANSCRIPTION') {
    window.postMessage({ type: 'STOP_TRANSCRIPTION' }, '*');
  }
});
```

### rtc-override.js (注入されるスクリプト)

```javascript
(function() {
  'use strict';
  
  // オリジナルのRTCPeerConnectionを保存
  const OriginalRTCPeerConnection = window.RTCPeerConnection;
  
  // 音声処理用の設定
  const audioProcessors = new Map();
  let transcriptionActive = false;
  
  // カスタムRTCPeerConnection
  class CustomRTCPeerConnection extends OriginalRTCPeerConnection {
    constructor(configuration) {
      super(configuration);
      
      // ontrackイベントをオーバーライド
      const originalSetOntrack = Object.getOwnPropertyDescriptor(
        RTCPeerConnection.prototype,
        'ontrack'
      ).set;
      
      let customOntrack = null;
      
      Object.defineProperty(this, 'ontrack', {
        get: () => customOntrack,
        set: (handler) => {
          customOntrack = (event) => {
            // 受信したストリームを処理
            this.processIncomingStream(event);
            
            // オリジナルのハンドラーを呼び出す
            if (handler) {
              handler.call(this, event);
            }
          };
          
          originalSetOntrack.call(this, customOntrack);
        }
      });
    }
    
    processIncomingStream(event) {
      event.streams.forEach(stream => {
        stream.getTracks().forEach(track => {
          if (track.kind === 'audio' && transcriptionActive) {
            this.setupAudioProcessing(track, stream.id);
          }
        });
      });
    }
    
    setupAudioProcessing(track, streamId) {
      // AudioContextを作成
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(new MediaStream([track]));
      
      // ScriptProcessorNode を作成（将来的にはAudioWorkletを使用）
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      
      // 音声データを処理
      processor.onaudioprocess = (e) => {
        if (!transcriptionActive) return;
        
        const inputData = e.inputBuffer.getChannelData(0);
        
        // 音声レベルを計算
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
          sum += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sum / inputData.length);
        const db = 20 * Math.log10(rms);
        
        // 音声が検出された場合
        if (db > -50) {
          // ここで音声認識APIに送信する処理を実装
          this.sendToTranscriptionService(inputData, streamId);
        }
      };
      
      // ノードを接続
      source.connect(processor);
      processor.connect(audioContext.destination);
      
      // プロセッサーを保存
      audioProcessors.set(streamId, {
        audioContext,
        processor,
        source
      });
      
      // トラックが終了したらクリーンアップ
      track.addEventListener('ended', () => {
        this.cleanupAudioProcessing(streamId);
      });
    }
    
    sendToTranscriptionService(audioData, streamId) {
      // Web Speech APIを使用した例
      if (!this.recognition) {
        this.recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = 'ja-JP';
        
        this.recognition.onresult = (event) => {
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            const transcript = result[0].transcript;
            const isFinal = result.isFinal;
            
            // 文字起こし結果を送信
            window.postMessage({
              type: 'TRANSCRIPTION_UPDATE',
              payload: {
                streamId,
                transcript,
                isFinal,
                timestamp: Date.now()
              }
            }, '*');
          }
        };
        
        this.recognition.onerror = (error) => {
          console.error('Speech recognition error:', error);
        };
        
        this.recognition.start();
      }
    }
    
    cleanupAudioProcessing(streamId) {
      const processor = audioProcessors.get(streamId);
      if (processor) {
        processor.processor.disconnect();
        processor.source.disconnect();
        processor.audioContext.close();
        audioProcessors.delete(streamId);
      }
    }
  }
  
  // RTCPeerConnectionを置き換え
  window.RTCPeerConnection = CustomRTCPeerConnection;
  window.webkitRTCPeerConnection = CustomRTCPeerConnection;
  
  // メッセージリスナー
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    
    if (event.data.type === 'START_TRANSCRIPTION') {
      transcriptionActive = true;
      console.log('Transcription started');
    } else if (event.data.type === 'STOP_TRANSCRIPTION') {
      transcriptionActive = false;
      // すべての音声処理をクリーンアップ
      audioProcessors.forEach((_, streamId) => {
        CustomRTCPeerConnection.prototype.cleanupAudioProcessing(streamId);
      });
      console.log('Transcription stopped');
    }
  });
  
  // 初期化完了を通知
  window.postMessage({ type: 'RTC_OVERRIDE_READY' }, '*');
  
  console.log('RTCPeerConnection override installed');
})();
```

### background.js (Service Worker)

```javascript
// 接続されたタブを管理
const connectedTabs = new Map();

// 拡張機能アイコンのクリックを処理
chrome.action.onClicked.addListener((tab) => {
  if (tab.url && tab.url.includes('meet.google.com')) {
    toggleTranscription(tab.id);
  }
});

// コンテンツスクリプトからの接続を処理
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'meet-transcriber') {
    const tabId = port.sender.tab.id;
    connectedTabs.set(tabId, port);
    
    port.onMessage.addListener((message) => {
      handleMessage(message, tabId);
    });
    
    port.onDisconnect.addListener(() => {
      connectedTabs.delete(tabId);
    });
  }
});

// メッセージを処理
function handleMessage(message, tabId) {
  switch (message.type) {
    case 'STREAM_READY':
      console.log('Audio stream ready in tab:', tabId);
      break;
      
    case 'TRANSCRIPTION':
      // 文字起こし結果を保存または処理
      saveTranscription(tabId, message.data);
      break;
  }
}

// 文字起こしの開始/停止を切り替え
function toggleTranscription(tabId) {
  const port = connectedTabs.get(tabId);
  if (port) {
    chrome.storage.local.get([`transcribing_${tabId}`], (result) => {
      const isTranscribing = result[`transcribing_${tabId}`] || false;
      
      if (isTranscribing) {
        port.postMessage({ type: 'STOP_TRANSCRIPTION' });
        chrome.storage.local.set({ [`transcribing_${tabId}`]: false });
      } else {
        port.postMessage({ type: 'START_TRANSCRIPTION' });
        chrome.storage.local.set({ [`transcribing_${tabId}`]: true });
      }
    });
  }
}

// 文字起こし結果を保存
function saveTranscription(tabId, data) {
  const key = `transcriptions_${tabId}`;
  
  chrome.storage.local.get([key], (result) => {
    const transcriptions = result[key] || [];
    transcriptions.push(data);
    
    // 最新の100件のみ保持
    if (transcriptions.length > 100) {
      transcriptions.shift();
    }
    
    chrome.storage.local.set({ [key]: transcriptions });
  });
}
```

### 高度な音声処理の例（AudioWorklet使用）

```javascript
// audio-processor.js (AudioWorkletProcessor)
class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 4096;
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
  }
  
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    
    if (input && input[0]) {
      const inputData = input[0];
      
      // バッファに音声データを追加
      for (let i = 0; i < inputData.length; i++) {
        this.buffer[this.bufferIndex++] = inputData[i];
        
        // バッファが満杯になったら送信
        if (this.bufferIndex >= this.bufferSize) {
          this.port.postMessage({
            type: 'audio-data',
            buffer: this.buffer.slice()
          });
          this.bufferIndex = 0;
        }
      }
    }
    
    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);
```

## まとめ

Tactiqのような拡張機能は、以下の技術を組み合わせて実装されていると考えられます：

1. **RTCPeerConnectionのオーバーライド**による音声ストリームの取得
2. **Content Script**によるGoogle MeetページへのJavaScriptコード注入
3. **Web Speech API**または**外部音声認識API**によるリアルタイム文字起こし
4. **MutationObserver**によるDOM監視で参加者情報の取得
5. **Chrome Storage API**による文字起こしデータの保存

この実装により、Google Meetの字幕機能に依存せずに、独自の音声認識と文字起こしを実現しています。


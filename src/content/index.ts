import { ChromeMessage } from '@/types'
import { logger } from '@/utils/logger'
import { ChromeErrorHandler, ServiceWorkerKeepAlive } from '@/utils/chrome-error-handler'
import { formatMarkdownToHTML } from '@/utils/markdown'
import './styles.css'

class TranscriptCapture {
  private observer: MutationObserver | null = null
  private isRecording = false
  private captionsContainer: Element | null = null
  private lastCaption = ''
  private currentSpeaker = ''
  private isMinutesExpanded = false
  private currentMinutes: any = null
  private viewerTabId: number | null = null
  private hasGeneratedMinutes = false
  private callStatusObserver: MutationObserver | null = null
  private isCallActive = true
  private lastCallCheck = Date.now()
  private currentUserName: string | null = null
  private participantsObserver: MutationObserver | null = null
  private currentParticipants: Set<string> = new Set()
  private cleanupTimeouts: Set<number> = new Set()
  private cleanupIntervals: Set<number> = new Set()
  
  // メモリ管理用の変数
  private transcriptBuffer: any[] = []
  private lastFlushTime = Date.now()
  private flushInterval = 5000 // 5秒ごとにバッファをフラッシュ
  private maxBufferSize = 50 // 最大バッファサイズ
  
  constructor() {
    this.initAsync()
    this.setupErrorHandling()
  }
  
  private setupErrorHandling() {
    // エラーハンドリングのセットアップ
    ChromeErrorHandler.onReconnectionNeeded(() => {
      logger.warn('Extension context invalidated - showing reconnection UI')
      this.showReconnectionNotification()
    })
    
    // Service Workerのキープアライブを開始
    ServiceWorkerKeepAlive.start()
    
    // ページ離脱時にキープアライブを停止
    window.addEventListener('beforeunload', () => {
      ServiceWorkerKeepAlive.stop()
    })
  }
  
  private showReconnectionNotification() {
    const notification = document.createElement('div')
    notification.className = 'minutes-notification error'
    notification.innerHTML = `
      <div style="display: flex; align-items: center; gap: 10px;">
        <span>拡張機能との接続が切断されました</span>
        <button onclick="location.reload()" style="
          background: white;
          color: #dc2626;
          border: 1px solid #dc2626;
          padding: 4px 12px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
        ">再読み込み</button>
      </div>
    `
    document.body.appendChild(notification)
    
    // 10秒後に自動的に削除
    setTimeout(() => notification.remove(), 10000)
  }
  
  private async initAsync() {
    await this.loadUserName()
    this.init()
  }
  
  private replaceYouWithUserName(speaker: string): string {
    if (!this.currentUserName) return speaker
    
    if (speaker === 'あなた' || speaker === 'You' || speaker === '自分') {
      logger.debug(`Replacing "${speaker}" with user name: ${this.currentUserName}`)
      return this.currentUserName
    }
    
    return speaker
  }
  
  private async loadUserName() {
    // Sync storageから利用者名を取得
    const result = await chrome.storage.sync.get(['settings'])
    if (result.settings?.userName) {
      this.currentUserName = result.settings.userName
      logger.debug('Loaded user name:', this.currentUserName)
    } else {
      logger.debug('No user name found in settings')
    }
  }
  
  private init() {
    this.injectUI()
    this.setupMessageListener()
    this.waitForCaptions()
    this.setupCallStatusMonitoring()
    this.setupParticipantsMonitoring()
    this.checkExistingSession()
  }
  
  private async checkExistingSession() {
    // 既存のセッションがあるか確認
    const result = await chrome.storage.local.get(['currentMeetingId'])
    if (result.currentMeetingId) {
      logger.debug('Restoring existing session:', result.currentMeetingId)
      this.isRecording = true
      this.updateRecordingUI(true)
      
      // Background scriptに現在のタブIDを通知
      ChromeErrorHandler.sendMessage({ 
        type: 'RESTORE_SESSION',
        payload: { tabId: chrome.runtime.id }
      }).catch(error => {
        logger.error('Failed to restore session:', error)
      })
    }
  }
  
  private updateRecordingUI(recording: boolean) {
    const toggleBtn = document.getElementById('minutes-toggle-recording')
    const generateBtn = document.getElementById('minutes-generate')
    
    if (toggleBtn) {
      if (recording) {
        toggleBtn.classList.add('recording')
        const btnText = toggleBtn.querySelector('.btn-text')
        if (btnText) btnText.textContent = '記録停止'
      } else {
        toggleBtn.classList.remove('recording')
        const btnText = toggleBtn.querySelector('.btn-text')
        if (btnText) btnText.textContent = '記録開始'
      }
    }
    
    if (generateBtn) {
      if (recording) {
        generateBtn.removeAttribute('disabled')
      } else {
        generateBtn.setAttribute('disabled', 'true')
      }
    }
  }
  
  private injectUI() {
    // フローティングコントロールパネルを作成
    const controlPanel = document.createElement('div')
    controlPanel.id = 'minutes-board-control-panel'
    controlPanel.className = 'minutes-floating-panel'
    controlPanel.innerHTML = `
      <div class="panel-header">
        <span class="panel-title">議事録</span>
        <button class="minimize-btn" title="最小化">_</button>
      </div>
      <div class="panel-content">
        <button id="minutes-toggle-recording" class="control-btn">
          <span class="record-icon"></span>
          <span class="btn-text">記録開始</span>
        </button>
        <button id="minutes-generate" class="control-btn" disabled>
          <span class="generate-icon"></span>
          <span class="btn-text">議事録生成</span>
        </button>
        <button id="minutes-open-tab" class="control-btn" style="display:none;">
          <span class="tab-icon"></span>
          <span class="btn-text">別タブで開く</span>
        </button>
      </div>
      <div class="tab-container">
        <div class="tab-buttons">
          <button id="minutes-tab" class="tab-btn active" data-tab="minutes">
            議事録
          </button>
          <button id="nextsteps-tab" class="tab-btn" data-tab="nextsteps">
            ネクストステップ
          </button>
        </div>
        <div id="minutes-content" class="tab-content minutes-content-area active">
          <div id="minutes-loading" class="minutes-loading" style="display:none;">
            <div class="spinner"></div>
            <span class="loading-text">AIが処理中...</span>
          </div>
          <div id="minutes-text" class="minutes-text-display">
            <p class="empty-message">記録を開始して議事録を生成してください</p>
          </div>
        </div>
        <div id="nextsteps-content" class="tab-content nextsteps-content-area" style="display:none;">
          <div id="nextsteps-panel"></div>
        </div>
      </div>
    `
    
    // 最小化状態のボタン
    const minimizedBtn = document.createElement('button')
    minimizedBtn.id = 'minutes-board-minimized'
    minimizedBtn.className = 'minutes-minimized-btn'
    minimizedBtn.innerHTML = '📝'
    minimizedBtn.title = 'theMinutesBoard'
    minimizedBtn.style.display = 'none'
    
    const checkAndInject = () => {
      if (!document.getElementById('minutes-board-control-panel')) {
        document.body.appendChild(controlPanel)
        document.body.appendChild(minimizedBtn)
        this.setupControlListeners()
        this.setupPanelControls()
      } else {
        setTimeout(checkAndInject, 1000)
      }
    }
    
    // ページ読み込み後に挿入
    if (document.readyState === 'complete') {
      checkAndInject()
    } else {
      window.addEventListener('load', checkAndInject)
    }
  }
  
  private setupControlListeners() {
    const toggleBtn = document.getElementById('minutes-toggle-recording')
    const generateBtn = document.getElementById('minutes-generate')
    const openTabBtn = document.getElementById('minutes-open-tab')
    
    toggleBtn?.addEventListener('click', () => {
      if (this.isRecording) {
        this.stopRecording()
      } else {
        this.startRecording()
      }
    })
    
    generateBtn?.addEventListener('click', () => {
      this.generateMinutes()
    })
    
    openTabBtn?.addEventListener('click', () => {
      this.openInNewTab()
    })
    
    // タブ切り替え機能
    this.setupTabSwitching()
    
    // ネクストステップパネルの初期化
    this.initializeNextStepsPanel()
  }
  
  private setupPanelControls() {
    const panel = document.getElementById('minutes-board-control-panel')
    const minimizedBtn = document.getElementById('minutes-board-minimized')
    const minimizeBtn = panel?.querySelector('.minimize-btn')
    
    // 最小化ボタン
    minimizeBtn?.addEventListener('click', () => {
      if (panel) {
        panel.style.display = 'none'
        if (minimizedBtn) {
          minimizedBtn.style.display = 'flex'
        }
      }
    })
    
    // 最小化状態から復元
    minimizedBtn?.addEventListener('click', () => {
      if (panel) {
        panel.style.display = 'block'
        minimizedBtn.style.display = 'none'
      }
    })
    
    // パネルをドラッグ可能にする
    this.makeDraggable(panel)
  }
  
  private makeDraggable(element: HTMLElement | null) {
    if (!element) return
    
    const header = element.querySelector('.panel-header') as HTMLElement
    if (!header) return
    
    let isDragging = false
    let currentX: number
    let currentY: number
    let initialX: number
    let initialY: number
    
    header.style.cursor = 'move'
    
    header.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).classList.contains('minimize-btn')) return
      
      isDragging = true
      initialX = e.clientX - element.offsetLeft
      initialY = e.clientY - element.offsetTop
    })
    
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return
      
      e.preventDefault()
      currentX = e.clientX - initialX
      currentY = e.clientY - initialY
      
      element.style.left = `${currentX}px`
      element.style.top = `${currentY}px`
    })
    
    document.addEventListener('mouseup', () => {
      isDragging = false
    })
  }
  
  private setupMessageListener() {
    // 設定変更を監視
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === 'sync' && changes.settings) {
        const newSettings = changes.settings.newValue
        if (newSettings?.userName) {
          this.currentUserName = newSettings.userName
          logger.debug('Updated user name:', this.currentUserName)
        }
      }
    })
    
    // 定期的なバッファフラッシュ
    const flushBufferInterval = setInterval(() => {
      if (this.transcriptBuffer.length > 0) {
        this.flushTranscriptBuffer()
      }
    }, this.flushInterval)
    this.cleanupIntervals.add(flushBufferInterval)
    
    chrome.runtime.onMessage.addListener((message: ChromeMessage, sender, sendResponse) => {
      logger.debug('Content script received message:', message.type)
      
      // エラーチェック
      const error = ChromeErrorHandler.checkLastError()
      if (error) {
        sendResponse({ success: false, error: error.message })
        return true
      }
      
      switch (message.type) {
        case 'GET_RECORDING_STATUS':
          sendResponse({ isRecording: this.isRecording })
          break
          
        case 'START_RECORDING':
          // 字幕チェックを再実行
          this.checkForCaptions()
          
          if (!this.captionsContainer) {
            logger.warn('Captions not available, cannot start recording')
            this.showNotification('字幕が有効になっていません。Google Meetの字幕をONにしてから記録を開始してください。', 'error')
            sendResponse({ success: false, error: '字幕が有効になっていません。Google Meetの字幕をONにしてください。' })
          } else {
            logger.info('Captions container found, notifying background script')
            // Background scriptに字幕チェック済みの記録開始を通知
            chrome.runtime.sendMessage({
              type: 'START_RECORDING_CONFIRMED',
              payload: message.payload
            }).then(() => {
              this.startRecording()
              sendResponse({ success: true })
            }).catch(error => {
              logger.error('Failed to start recording via background:', error)
              sendResponse({ success: false, error: error.message })
            })
          }
          break
          
        case 'STOP_RECORDING':
          this.stopRecording()
          sendResponse({ success: true })
          break
          
        case 'GENERATE_MINUTES':
          this.generateMinutes()
          sendResponse({ success: true })
          break
          
        case 'MINUTES_GENERATED':
          this.showMinutesPreview(message.payload.minutes)
          sendResponse({ success: true })
          break
          
        case 'MINUTES_UPDATE':
          this.showMinutesPreview(message.payload)
          sendResponse({ success: true })
          break
          
        case 'VIEWER_TAB_OPENED':
          this.viewerTabId = message.payload.tabId
          sendResponse({ success: true })
          break
          
        case 'RECORDING_STOPPED':
          // 停止完了の通知を受け取った場合
          this.isRecording = false
          this.updateRecordingUI(false)
          this.showNotification('記録を停止しました', 'info')
          sendResponse({ success: true })
          break
          
        case 'STATE_SYNC':
          // 状態同期メッセージを受信
          if (message.payload.isRecording !== this.isRecording) {
            this.isRecording = message.payload.isRecording
            this.updateRecordingUI(this.isRecording)
          }
          if (message.payload.isMinutesGenerating) {
            this.showLoadingState(true)
          } else {
            this.showLoadingState(false)
          }
          sendResponse({ success: true })
          break
          
        case 'MINUTES_GENERATION_STARTED':
          this.showLoadingState(true)
          sendResponse({ success: true })
          break
          
        case 'MINUTES_GENERATION_FAILED':
          this.showLoadingState(false)
          if (message.payload?.error) {
            this.showNotification(`エラー: ${message.payload.error}`, 'error')
          }
          sendResponse({ success: true })
          break
          
        case 'STORAGE_WARNING':
          const percentage = message.payload?.percentage || 0
          this.showNotification(
            `ストレージ容量が${percentage.toFixed(0)}%に達しました。古いデータは自動削除されます。`,
            'error'
          )
          sendResponse({ success: true })
          break
          
        case 'API_PROGRESS':
          // API進捗表示の更新
          if (message.payload?.operation === 'generateMinutes') {
            this.updateLoadingProgress(message.payload.percentage)
          }
          sendResponse({ success: true })
          break
          
        default:
          sendResponse({ success: false, error: 'Unknown message type' })
      }
      return true // 非同期レスポンスのため
    })
  }
  
  private waitForCaptions() {
    // 複数の可能なセレクタを試す
    const captionSelectors = [
      '[jsname="dsyhDe"]',
      '[jsname="tgaKEf"]',
      '.a4cQT',
      '[role="region"][aria-live="polite"]',
      '.TBMuR.bj4p3b',
      '.iOzk7[jsname="tgaKEf"]'
    ]
    
    const checkInterval = setInterval(() => {
      let captionsFound = false
      
      for (const selector of captionSelectors) {
        const element = document.querySelector(selector)
        if (element) {
          // 字幕コンテナが実際に表示されているか確認
          const isVisible = (element as HTMLElement).offsetParent !== null
          if (isVisible) {
            this.captionsContainer = element
            captionsFound = true
            logger.debug('Captions container found with selector:', selector)
            break
          }
        }
      }
      
      if (captionsFound) {
        clearInterval(checkInterval)
        this.cleanupIntervals.delete(checkInterval)
      }
    }, 1000)
    this.cleanupIntervals.add(checkInterval)
  }
  
  private checkForCaptions() {
    const captionSelectors = [
      '[jsname="dsyhDe"]',
      '[jsname="tgaKEf"]',
      '.a4cQT',
      '[role="region"][aria-live="polite"]',
      '.TBMuR.bj4p3b',
      '.iOzk7[jsname="tgaKEf"]'
    ]
    
    for (const selector of captionSelectors) {
      const element = document.querySelector(selector)
      if (element && (element as HTMLElement).offsetParent !== null) {
        // 実際に字幕が表示されているかを確認
        const hasVisibleContent = element.textContent && element.textContent.trim().length > 0
        const isVisible = element.offsetWidth > 0 && element.offsetHeight > 0
        
        if (isVisible) {
          this.captionsContainer = element
          logger.debug('Captions container found with selector:', selector)
          logger.debug('Caption element visible:', isVisible, 'has content:', hasVisibleContent)
          return true
        }
      }
    }
    return false
  }
  
  private startRecording() {
    if (this.isRecording) {
      logger.debug('Already recording')
      return
    }
    
    // 字幕コンテナを再度チェック
    this.checkForCaptions()
    
    if (!this.captionsContainer) {
      logger.warn('No captions container found')
      this.showNotification('字幕が有効になっていません。字幕をONにしてください。', 'error')
      return
    }
    
    this.isRecording = true
    this.hasGeneratedMinutes = false // 新しい記録開始時にリセット
    this.updateGenerateButtonText() // ボタンテキストを初期状態に戻す
    
    // 現在の参加者を検出して初期リストとする
    this.detectParticipants()
    const initialParticipants = Array.from(this.currentParticipants)
    logger.debug('Initial participants:', initialParticipants)
    
    ChromeErrorHandler.sendMessage({ 
      type: 'START_RECORDING',
      payload: {
        initialParticipants: initialParticipants
      }
    }).then(response => {
      logger.debug('Recording started successfully')
    }).catch(error => {
      logger.error('Error sending START_RECORDING:', error)
      this.showNotification(
        ChromeErrorHandler.getUserFriendlyMessage(error), 
        'error'
      )
      // 記録状態を元に戻す
      this.isRecording = false
      this.updateRecordingUI(false)
    })
    
    this.updateRecordingUI(true)
    
    // 別タブで開くボタンを表示（記録開始時）
    const openTabBtn = document.getElementById('minutes-open-tab')
    if (openTabBtn) {
      openTabBtn.style.display = 'flex'
    }
    
    this.observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
          this.processCaptions()
        }
      })
    })
    
    this.observer.observe(this.captionsContainer, {
      childList: true,
      subtree: true
    })
    
    logger.info('Recording started')
    this.showNotification('記録を開始しました')
  }
  
  private stopRecording() {
    if (!this.isRecording) return
    
    this.isRecording = false
    ChromeErrorHandler.sendMessage({ type: 'STOP_RECORDING' })
      .then(() => {
        logger.debug('Recording stopped successfully')
      })
      .catch(error => {
        logger.error('Error stopping recording:', error)
        this.showNotification(
          ChromeErrorHandler.getUserFriendlyMessage(error), 
          'error'
        )
      })
    
    this.updateRecordingUI(false)
    
    if (this.observer) {
      this.observer.disconnect()
      this.observer = null
    }
    
    // 別タブで開くボタンは表示したまま（停止後も押せるように）
    // const openTabBtn = document.getElementById('minutes-open-tab')
    // if (openTabBtn) {
    //   openTabBtn.style.display = 'flex'  // 非表示にしない
    // }
    
    logger.info('Recording stopped')
  }

  private setupCallStatusMonitoring() {
    // URLの変更を監視（ページ離脱検知）
    const currentUrl = window.location.href
    const meetingId = currentUrl.split('/').pop() || ''
    logger.debug('Setting up call status monitoring for URL:', currentUrl, 'Meeting ID:', meetingId)
    
    // ページが会議画面から離脱したか監視
    const checkUrl = () => {
      const newUrl = window.location.href
      // 会議IDが変わった、またはmeet.google.comから離れた場合
      if (!newUrl.includes('meet.google.com') || 
          (meetingId && !newUrl.includes(meetingId))) {
        logger.info('URL changed, call likely ended:', newUrl)
        this.handleCallEnded('URL change detected')
      }
    }
    
    // URLの変更を定期的にチェック
    const urlCheckInterval = setInterval(checkUrl, 1000)
    this.cleanupIntervals.add(urlCheckInterval)
    
    // popstateイベントでも監視（ブラウザの戻る/進むボタン）
    window.addEventListener('popstate', () => {
      logger.debug('Browser navigation detected')
      checkUrl()
    })
    
    // ページ離脱時のイベント監視
    window.addEventListener('beforeunload', () => {
      this.handleCallEnded('Page unload')
      clearInterval(urlCheckInterval)
    })
    
    // 通話終了ボタンの監視
    this.monitorCallEndButton()
    
    // 会議画面の要素消失を監視
    this.monitorMeetingElements()
  }

  private monitorCallEndButton() {
    // Google Meetの通話終了ボタンを監視
    const callEndSelectors = [
      '[data-tooltip*="通話を終了"]',
      '[aria-label*="通話を終了"]',
      '[aria-label*="Leave call"]',
      '[aria-label*="End call"]',
      '[data-tooltip*="Leave call"]',
      '[data-tooltip*="End call"]',
      'button[aria-label*="離"]',
      'button[data-tooltip*="離"]',
      '[aria-label*="退出"]',
      '[data-tooltip*="退出"]',
      '[jsname="CQylAd"]', // 通話終了ボタンのjsname
      '.VfPpkd-LgbsSe-OWXEXe-Bz112c-M1Soyc[aria-label*="call"]',
      '.VfPpkd-LgbsSe-OWXEXe-Bz112c-M1Soyc[data-tooltip*="call"]'
    ]
    
    const checkCallEndButton = () => {
      for (const selector of callEndSelectors) {
        const button = document.querySelector(selector) as HTMLButtonElement
        if (button) {
          // まだイベントリスナーが追加されていない場合のみ追加
          if (!button.dataset.callEndListenerAdded) {
            button.dataset.callEndListenerAdded = 'true'
            button.addEventListener('click', () => {
              logger.debug('Call end button clicked')
              // 少し遅延を入れて実際に通話が終了するのを待つ
              setTimeout(() => {
                this.handleCallEnded('Call end button clicked')
              }, 1000)
            })
            logger.debug('Added call end button listener to:', selector)
          }
        }
      }
    }
    
    // 定期的にボタンをチェック（動的に追加される可能性があるため）
    const checkButtonInterval = setInterval(checkCallEndButton, 3000)
    this.cleanupIntervals.add(checkButtonInterval)
    checkCallEndButton() // 初回実行
  }

  private monitorMeetingElements() {
    // Google Meetの会議ページかどうかを確認
    const isInMeeting = window.location.pathname.includes('/') && 
                       window.location.pathname.length > 1 &&
                       !window.location.pathname.includes('landing')
    
    if (!isInMeeting) {
      logger.debug('Not in a meeting page, skipping element monitoring')
      return
    }
    
    // 会議画面の重要な要素が消失したかを監視
    const criticalSelectors = [
      '[data-self-name]', // 自分の名前表示
      '[data-allocation-index]', // 参加者表示エリア
      '[role="main"]', // メイン会議エリア
      '[jsname="VOlAQe"]', // Google Meet特有の会議エリア
      '[jscontroller="IQKKlf"]', // 会議コントロール
      '.z38b6', // 会議画面全体
      '.crqnQb', // ビデオグリッド
      '.Gv1mTb-aTv5jf' // 会議情報バー
    ]
    
    const checkMeetingElements = () => {
      // 会議ページでない場合はチェックしない
      if (!window.location.pathname.includes('/') || 
          window.location.pathname.length <= 1 ||
          window.location.pathname.includes('landing')) {
        return
      }
      
      let elementsFound = 0
      
      for (const selector of criticalSelectors) {
        if (document.querySelector(selector)) {
          elementsFound++
        }
      }
      
      // 重要な要素が大幅に減った場合は通話終了と判断
      if (elementsFound === 0 && this.isCallActive && this.isRecording) {
        logger.warn('Critical meeting elements disappeared')
        this.handleCallEnded('Meeting elements disappeared')
      }
    }
    
    // 定期的にチェック
    const elementsCheckInterval = setInterval(checkMeetingElements, 3000)
    this.cleanupIntervals.add(elementsCheckInterval)
    
    // MutationObserverでもメイン要素の削除を監視
    this.callStatusObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList' && mutation.removedNodes.length > 0) {
          // 重要な要素が削除されたかチェック
          mutation.removedNodes.forEach((node) => {
            if (node instanceof Element) {
              for (const selector of criticalSelectors) {
                if (node.matches(selector) || node.querySelector(selector)) {
                  logger.debug('Important meeting element removed:', selector)
                  // 少し待ってから再チェック（一時的な削除の可能性があるため）
                  setTimeout(() => {
                    checkMeetingElements()
                  }, 1000)
                  break
                }
              }
            }
          })
        }
      })
    })
    
    // bodyタグを監視
    this.callStatusObserver.observe(document.body, {
      childList: true,
      subtree: true
    })
  }

  private setupParticipantsMonitoring() {
    logger.debug('Setting up participants monitoring')
    
    // 参加者リストの要素を定期的にチェック
    const checkParticipants = () => {
      this.detectParticipants()
    }
    
    // 初回チェック
    const initialTimeout = setTimeout(checkParticipants, 3000)
    this.cleanupTimeouts.add(initialTimeout)
    
    // 定期的なチェック
    const intervalId = setInterval(checkParticipants, 10000)
    this.cleanupIntervals.add(intervalId)
  }
  
  private detectParticipants() {
    // 複数の可能なセレクタを試す
    const participantSelectors = [
      // 参加者パネルのセレクタ
      '[role="list"][aria-label*="participant"]',
      '[role="list"][aria-label*="参加者"]',
      '[jsname="jrQDbd"]', // 参加者リスト
      '[jsname="QpN8Cf"]', // 参加者パネル
      '[jsname="UJrCaf"]', // 参加者項目
      '.VfPpkd-rymPhb', // リストコンテナ
      '.XAJgFc', // 参加者アイテム
      '.GvcuGe', // 参加者名
      '.ZjFb7c', // 参加者名（別パターン）
      '.KV1GEc', // 参加者コンテナ
      '.kvLJWc', // 参加者エリア
      '[data-participant-id]', // 参加者ID属性
      '[data-self-name]', // 自分の名前
      '[data-requested-participant-id]', // 参加者ID
      // 右側パネルの参加者リスト
      '.c8mSod .VfPpkd-rymPhb-ibnC6b',
      '.rua5Nb', // 参加者カウント
      '.wnPUne', // 参加者数表示
      // タイルビューの参加者
      '[data-allocation-index]',
      '[data-participant-placement-index]',
      '[jsname="EydYod"]', // ビデオタイル
      '[jsname="qcH9Lc"]', // 名前ラベル
      '.dwSJ2e', // 参加者の名前表示
      '.zWGUib', // 参加者の名前（タイルビュー）
    ]
    
    const foundParticipants = new Set<string>()
    
    // 各セレクタを試す
    for (const selector of participantSelectors) {
      try {
        const elements = document.querySelectorAll(selector)
        
        elements.forEach(element => {
          // 名前を取得する複数の方法を試す
          let participantName = ''
          
          // 方法1: テキストコンテンツから直接取得
          const textContent = element.textContent?.trim()
          if (textContent && textContent.length > 0 && textContent.length < 100) {
            // 不要な文字を除去
            const cleanName = textContent
              .replace(/\(あなた\)/g, '')
              .replace(/\(You\)/g, '')
              .replace(/\(自分\)/g, '')
              .replace(/\(主催者\)/g, '')
              .replace(/\(Host\)/g, '')
              .replace(/\(プレゼンテーション中\)/g, '')
              .replace(/\(画面を固定\)/g, '')
              .replace(/\s+/g, ' ')
              .trim()
            
            if (cleanName && cleanName.length > 1) {
              participantName = cleanName
            }
          }
          
          // 方法2: aria-label属性から取得
          const ariaLabel = element.getAttribute('aria-label')
          if (ariaLabel && ariaLabel.includes('参加者') === false) {
            participantName = ariaLabel.trim()
          }
          
          // 方法3: data属性から取得
          const dataName = element.getAttribute('data-participant-name') || 
                          element.getAttribute('data-self-name')
          if (dataName) {
            participantName = dataName.trim()
          }
          
          // 方法4: 子要素から名前を探す
          if (!participantName) {
            const nameElements = element.querySelectorAll('.GvcuGe, .ZjFb7c, .dwSJ2e, .zWGUib, [jsname="qcH9Lc"]')
            nameElements.forEach(nameEl => {
              const name = nameEl.textContent?.trim()
              if (name && name.length > 1 && name.length < 100) {
                participantName = name
              }
            })
          }
          
          // 有効な名前が見つかった場合は追加
          if (participantName && participantName.length > 1) {
            foundParticipants.add(participantName)
            logger.debug(`Found participant: ${participantName} (selector: ${selector})`)
          }
        })
      } catch (error) {
        logger.error(`Error with selector ${selector}:`, error)
      }
    }
    
    // 参加者リストが更新された場合
    if (foundParticipants.size > 0) {
      const participantsArray = Array.from(foundParticipants)
      
      // 新しい参加者を検出
      const newParticipants = participantsArray.filter(p => !this.currentParticipants.has(p))
      const leftParticipants = Array.from(this.currentParticipants).filter(p => !foundParticipants.has(p))
      
      if (newParticipants.length > 0 || leftParticipants.length > 0) {
        logger.debug('Participants update detected')
        logger.debug('Current participants:', participantsArray)
        logger.debug('New participants:', newParticipants)
        logger.debug('Left participants:', leftParticipants)
        
        // 現在の参加者リストを更新
        this.currentParticipants = new Set(participantsArray)
        
        // 記録中の場合、参加者の変更を記録
        if (this.isRecording) {
          newParticipants.forEach(participant => {
            ChromeErrorHandler.sendMessage({
              type: 'PARTICIPANT_UPDATE',
              payload: {
                action: 'joined',
                participant: participant,
                timestamp: new Date().toISOString()
              }
            }).catch(error => {
              logger.error('Failed to send participant update:', error)
            })
          })
          
          leftParticipants.forEach(participant => {
            ChromeErrorHandler.sendMessage({
              type: 'PARTICIPANT_UPDATE',
              payload: {
                action: 'left',
                participant: participant,
                timestamp: new Date().toISOString()
              }
            }).catch(error => {
              logger.error('Failed to send participant update:', error)
            })
          })
        }
      }
    }
    
    // 参加者数のカウントも試みる
    const countSelectors = [
      '.rua5Nb', // 参加者カウント
      '.wnPUne', // 参加者数
      '.gV3Svc>span', // 参加者数の別パターン
      '[jsname="EydYod"]' // ビデオタイルの数をカウント
    ]
    
    for (const selector of countSelectors) {
      const countElement = document.querySelector(selector)
      if (countElement) {
        const countText = countElement.textContent?.trim()
        if (countText && /\d+/.test(countText)) {
          logger.debug(`Participant count from ${selector}: ${countText}`)
        }
      }
    }
  }

  private handleCallEnded(reason: string) {
    if (!this.isCallActive) return // 既に処理済み
    
    logger.info('Call ended detected:', reason)
    this.isCallActive = false
    
    // 記録中の場合は自動停止
    if (this.isRecording) {
      logger.info('Auto-stopping recording due to call end')
      this.stopRecording()
      this.showNotification('通話が終了したため、記録を自動停止しました', 'info')
      
      // バックグラウンドにも通知
      ChromeErrorHandler.sendMessage({ 
        type: 'CALL_ENDED',
        reason: reason,
        timestamp: new Date().toISOString()
      }).catch(error => {
        logger.error('Failed to send call ended message:', error)
      })
    }
    
    // オブザーバーのクリーンアップ
    if (this.callStatusObserver) {
      this.callStatusObserver.disconnect()
      this.callStatusObserver = null
    }
    
    // 参加者オブザーバーのクリーンアップ
    if (this.participantsObserver) {
      this.participantsObserver.disconnect()
      this.participantsObserver = null
    }
  }
  
  private processCaptions() {
    if (!this.captionsContainer) return
    
    // より詳細なデバッグログ
    logger.debug('Processing captions from container:', this.captionsContainer)
    
    // Google Meetの字幕要素の包括的なセレクタパターン
    const captionSelectors = [
      // 新しいGoogle Meetの字幕セレクタ（2024年更新）
      '[data-use-drivesdk-live-captions]',
      '[jsname="YSg9Nc"]',
      '[jsname="dsyhDe"] [jsname="YSg9Nc"]',
      '.iOzk7',
      '.TBMuR.bj4p3b .iOzk7',
      '[data-is-speakable="true"]',
      // 追加のパターン
      '[role="region"][aria-live="polite"] > div',
      '.a4cQT > div',
      '[jsname="tgaKEf"] > div'
    ]
    
    let captionElements: NodeListOf<Element> | null = null
    let usedSelector = ''
    
    for (const selector of captionSelectors) {
      const elements = this.captionsContainer.querySelectorAll(selector)
      if (elements.length > 0) {
        captionElements = elements
        usedSelector = selector
        logger.debug(`Found caption elements with selector: ${selector}, count: ${elements.length}`)
        break
      }
    }
    
    if (!captionElements) {
      logger.debug('No caption elements found, using fallback')
      // フォールバック: 直接テキストを取得
      const allText = this.captionsContainer.textContent?.trim()
      if (allText && allText !== this.lastCaption && allText.length > 2) {
        this.lastCaption = allText
        
        // フォールバックでも「あなた」チェックを行う
        let speaker = 'Unknown'
        if (this.currentUserName && (allText.includes('あなた:') || allText.includes('You:') || allText.includes('自分:'))) {
          speaker = this.currentUserName
          logger.debug('Fallback: detected "あなた" pattern, using user name:', this.currentUserName)
        }
        
        ChromeErrorHandler.sendMessage({
          type: 'TRANSCRIPT_UPDATE',
          payload: {
            speaker: speaker,
            content: allText
          }
        }).catch(error => {
          logger.error('Failed to send transcript update:', error)
        })
        
        logger.debug(`[${speaker}]: ${allText}`)
      }
      return
    }
    
    captionElements.forEach((element, index) => {
        logger.debug(`Processing caption element ${index}:`, element)
      
      // より詳細なスピーカーとテキストの検出パターン
      const speakerPatterns = [
        '[jsname="r5DJGb"]',
        '[jsname="BHMnZ"]', // 新しいパターン
        '.zs7s8d',
        '.name',
        // 追加のパターン
        '[data-speaker-name]',
        '.caption-speaker',
        'span[style*="font-weight"]'
      ]
      
      const textPatterns = [
        '[jsname="XcTWac"]',
        '[jsname="K4r5Ff"]', // 新しいパターン
        '.zs7s8d',
        '.text',
        // 追加のパターン
        '[data-caption-text]',
        '.caption-text',
        'span:not([jsname="r5DJGb"]):not([jsname="BHMnZ"])'
      ]
      
      let speakerElement: Element | null = null
      let textElement: Element | null = null
      
      // スピーカー要素を探す
      for (const pattern of speakerPatterns) {
        speakerElement = element.querySelector(pattern)
        if (speakerElement && speakerElement.textContent?.trim()) {
          logger.debug(`Found speaker with pattern ${pattern}:`, speakerElement.textContent)
          break
        }
      }
      
      // テキスト要素を探す
      for (const pattern of textPatterns) {
        textElement = element.querySelector(pattern)
        if (textElement && textElement.textContent?.trim()) {
          logger.debug(`Found text with pattern ${pattern}:`, textElement.textContent)
          break
        }
      }
      
      // より詳細な構造解析
      if (!speakerElement || !textElement) {
        logger.debug('Alternative parsing: analyzing element structure')
        const allChildren = element.children
        
        if (allChildren.length >= 2) {
          // 最初の子要素がスピーカー、2番目以降がテキストの可能性
          const firstChild = allChildren[0] as Element
          const secondChild = allChildren[1] as Element
          
          if (!speakerElement && firstChild.textContent?.trim().includes(':')) {
            speakerElement = firstChild
            logger.debug('Found speaker from first child:', firstChild.textContent)
          }
          
          if (!textElement && secondChild.textContent?.trim()) {
            textElement = secondChild
            logger.debug('Found text from second child:', secondChild.textContent)
          }
        }
        
        // 全体テキストからスピーカーを分離する試み
        if (!speakerElement && !textElement) {
          const fullText = element.textContent?.trim() || ''
          const colonIndex = fullText.indexOf(':')
          
          if (colonIndex > 0 && colonIndex < 50) {
            // コロンがある場合、前がスピーカー、後がテキスト
            const possibleSpeaker = fullText.substring(0, colonIndex).trim()
            const possibleText = fullText.substring(colonIndex + 1).trim()
            
            if (possibleSpeaker && possibleText) {
              logger.debug(`Parsed from full text - Speaker: ${possibleSpeaker}, Text: ${possibleText}`)
              
              // 「あなた」を利用者名に置換
              let finalSpeaker = this.replaceYouWithUserName(possibleSpeaker)
              
              if (possibleText !== this.lastCaption && possibleText.length > 2) {
                this.lastCaption = possibleText
                this.currentSpeaker = finalSpeaker
                
                this.addToTranscriptBuffer({
                  speaker: finalSpeaker,
                  content: possibleText
                })
                
                logger.debug(`[${finalSpeaker}]: ${possibleText}`)
              }
              return
            }
          }
        }
      }
      
      // デフォルトの処理
      if (!textElement) {
        textElement = element
      }
      
      let speaker = speakerElement?.textContent?.trim() || 'Unknown'
      const text = textElement?.textContent?.trim() || ''
      
      // 「あなた」または「You」を利用者名に置換
      speaker = this.replaceYouWithUserName(speaker)
      
      // speakerがUnknownで、実際は「あなた」である場合をチェック
      if (speaker === 'Unknown' && this.currentUserName) {
        const fullText = element.textContent?.trim() || ''
        // 複数のパターンで「あなた」を検出
        if (fullText.includes('あなた:') || fullText.includes('You:') || fullText.includes('自分:') ||
            fullText.startsWith('あなた ') || fullText.startsWith('You ') || fullText.startsWith('自分 ') ||
            fullText.includes('あなた') || fullText.includes('You') || fullText.includes('自分')) {
          // より正確なチェック：speakerElementが「あなた」を含んでいるか
          const speakerText = speakerElement?.textContent?.trim() || ''
          if (speakerText.includes('あなた') || speakerText.includes('You') || speakerText.includes('自分') ||
              fullText.indexOf('あなた') < 10 || fullText.indexOf('You') < 10 || fullText.indexOf('自分') < 10) {
            speaker = this.currentUserName
          }
        }
      }
      
      // スピーカー名がテキストに含まれている場合は除去
      let cleanText = text
      if (speaker !== 'Unknown' && text.startsWith(speaker)) {
        cleanText = text.substring(speaker.length).replace(/^[:\s]+/, '').trim()
      }
      
      if (cleanText && cleanText !== this.lastCaption && cleanText.length > 2) {
        this.lastCaption = cleanText
        this.currentSpeaker = speaker
        
        // speakerがUnknownの場合は、ここでも「あなた」チェックを行う
        if (speaker === 'Unknown' && this.currentUserName) {
          // フォールバック処理でUnknownになった場合の再チェック
          const fullText = element.textContent?.trim() || ''
          if (fullText.includes('あなた:') || fullText.includes('You:') || fullText.includes('自分:') ||
              fullText.includes('あなた') || fullText.includes('You') || fullText.includes('自分')) {
            // より詳細なチェック
            const speakerText = speakerElement?.textContent?.trim() || ''
            if (speakerText.includes('あなた') || speakerText.includes('You') || speakerText.includes('自分') ||
                fullText.indexOf('あなた') < 10 || fullText.indexOf('You') < 10 || fullText.indexOf('自分') < 10) {
              speaker = this.currentUserName
            }
          }
        }
        
        // バッファに追加
        this.addToTranscriptBuffer({
          speaker,
          content: cleanText
        })
        
        logger.debug(`[${speaker}]: ${cleanText}`)
      }
    })
  }
  
  private generateMinutes() {
    this.showNotification('議事録を生成中...', 'info')
    this.showLoadingState(true)
    
    ChromeErrorHandler.sendMessage({ type: 'GENERATE_MINUTES' })
      .then(response => {
        if (response.success) {
          this.showNotification('議事録の生成を開始しました')
          // 成功時もローディング状態は継続（MINUTES_GENERATEDで解除）
        } else {
          this.showNotification('エラー: ' + response.error, 'error')
          this.showLoadingState(false)
        }
      })
      .catch(error => {
        logger.error('Extension context error:', error)
        this.showNotification(
          ChromeErrorHandler.getUserFriendlyMessage(error), 
          'error'
        )
        this.showLoadingState(false)
      })
  }
  
  private showMinutesPreview(minutes: any) {
    this.currentMinutes = minutes
    this.hasGeneratedMinutes = true
    
    // ローディング状態を解除
    this.showLoadingState(false)
    
    // ボタンテキストを更新
    this.updateGenerateButtonText()
    
    // 生成ボタンを再度有効化
    const generateBtn = document.getElementById('minutes-generate')
    if (generateBtn) {
      generateBtn.removeAttribute('disabled')
    }
    
    // 初回生成時は拡張表示に切り替え
    if (!this.isMinutesExpanded) {
      this.expandMinutesPanel()
    } else {
      // 2回目以降は部分更新
      this.updateMinutesContent(minutes)
    }
    
    this.showNotification('議事録が生成されました！', 'success')
  }
  
  private updateGenerateButtonText() {
    const generateBtn = document.getElementById('minutes-generate')
    const btnText = generateBtn?.querySelector('.btn-text')
    
    if (btnText) {
      if (this.hasGeneratedMinutes) {
        btnText.textContent = '議事録を更新'
        generateBtn?.querySelector('.generate-icon')?.classList.remove('generate-icon')
        generateBtn?.querySelector('span')?.classList.add('update-icon')
      } else {
        btnText.textContent = '議事録生成'
        generateBtn?.querySelector('.update-icon')?.classList.remove('update-icon')
        generateBtn?.querySelector('span')?.classList.add('generate-icon')
      }
    }
  }
  
  private expandMinutesPanel() {
    this.isMinutesExpanded = true
    
    const panel = document.getElementById('minutes-board-control-panel')
    const minutesContent = document.getElementById('minutes-content')
    const openTabBtn = document.getElementById('minutes-open-tab')
    
    if (panel && minutesContent) {
      // パネルを拡張
      panel.style.width = '500px'
      panel.style.height = '600px'
      panel.style.maxHeight = '80vh'
      
      // 議事録コンテンツエリアを表示
      minutesContent.style.display = 'block'
      
      // 別タブで開くボタンを表示
      if (openTabBtn) {
        openTabBtn.style.display = 'flex'
      }
      
      // 議事録内容を更新
      if (this.currentMinutes) {
        this.updateMinutesContent(this.currentMinutes)
      }
    }
  }
  
  private updateMinutesContent(minutes: any) {
    const minutesText = document.getElementById('minutes-text')
    if (minutesText) {
      minutesText.innerHTML = formatMarkdownToHTML(minutes.content)
    }
  }
  
  private openInNewTab() {
    chrome.storage.local.get(['currentMeetingId'], (result) => {
      if (result.currentMeetingId) {
        ChromeErrorHandler.sendMessage({
          type: 'OPEN_VIEWER_TAB',
          payload: { meetingId: result.currentMeetingId }
        }).then(response => {
          if (response?.success && response.tabId) {
            this.viewerTabId = response.tabId
          }
        }).catch(error => {
          logger.error('Failed to open viewer tab:', error)
          this.showNotification(
            ChromeErrorHandler.getUserFriendlyMessage(error), 
            'error'
          )
        })
      }
    })
  }
  
  private showLoadingState(show: boolean) {
    const loadingDiv = document.getElementById('minutes-loading')
    const minutesText = document.getElementById('minutes-text')
    
    if (loadingDiv) {
      loadingDiv.style.display = show ? 'flex' : 'none'
    }
    
    if (minutesText && show) {
      minutesText.style.opacity = '0.5'
    } else if (minutesText) {
      minutesText.style.opacity = '1'
    }
  }
  
  private updateLoadingProgress(percentage: number) {
    const loadingText = document.querySelector('.loading-text')
    if (loadingText) {
      loadingText.textContent = `AIが処理中... ${percentage}%`
    }
  }
  
  // トランスクリプトバッファに追加
  private addToTranscriptBuffer(transcript: { speaker: string; content: string }) {
    this.transcriptBuffer.push(transcript)
    
    // バッファサイズが上限に達したら即座にフラッシュ
    if (this.transcriptBuffer.length >= this.maxBufferSize) {
      this.flushTranscriptBuffer()
    }
  }
  
  // バッファをフラッシュ
  private flushTranscriptBuffer() {
    if (this.transcriptBuffer.length === 0) return
    
    const transcriptsToSend = [...this.transcriptBuffer]
    this.transcriptBuffer = [] // バッファをクリア
    
    // バッチで送信
    transcriptsToSend.forEach(transcript => {
      ChromeErrorHandler.sendMessage({
        type: 'TRANSCRIPT_UPDATE',
        payload: transcript
      }).catch(error => {
        logger.error('Failed to send transcript update:', error)
        // 失敗した場合はバッファに戻す
        this.transcriptBuffer.push(transcript)
      })
    })
    
    this.lastFlushTime = Date.now()
  }
  
  
  private setupModalListeners(modal: HTMLElement, minutes: any) {
    // 閉じるボタン
    const closeButtons = modal.querySelectorAll('.modal-close, .modal-close-btn')
    closeButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        modal.remove()
      })
    })
    
    // 背景クリックで閉じる
    const backdrop = modal.querySelector('.modal-backdrop')
    backdrop?.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        modal.remove()
      }
    })
    
    // エクスポートボタン
    const exportButtons = modal.querySelectorAll('.btn-export')
    exportButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const format = (btn as HTMLElement).dataset.format
        if (format) {
          this.exportMinutes(minutes, format)
        }
      })
    })
  }
  
  private exportMinutes(minutes: any, format: string) {
    let content = ''
    let filename = `minutes_${new Date().toISOString().split('T')[0]}`
    let mimeType = ''
    
    switch (format) {
      case 'markdown':
        content = minutes.content
        filename += '.md'
        mimeType = 'text/markdown'
        break
      case 'txt':
        content = minutes.content.replace(/[#*`]/g, '')
        filename += '.txt'
        mimeType = 'text/plain'
        break
    }
    
    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
    
    this.showNotification(`${format.toUpperCase()}ファイルをダウンロードしました`, 'success')
  }
  
  
  private showNotification(message: string, type: 'success' | 'error' | 'info' = 'success') {
    const notification = document.createElement('div')
    notification.className = `minutes-notification ${type}`
    notification.textContent = message
    document.body.appendChild(notification)
    
    const fadeTimeout = setTimeout(() => {
      notification.classList.add('fade-out')
      const removeTimeout = setTimeout(() => notification.remove(), 300)
      this.cleanupTimeouts.add(removeTimeout)
    }, 3000)
    this.cleanupTimeouts.add(fadeTimeout)
  }

  private setupTabSwitching() {
    const tabButtons = document.querySelectorAll('.tab-btn')
    const tabContents = document.querySelectorAll('.tab-content')
    
    tabButtons.forEach(button => {
      button.addEventListener('click', () => {
        const targetTab = button.getAttribute('data-tab')
        
        // タブボタンのアクティブ状態を切り替え
        tabButtons.forEach(btn => btn.classList.remove('active'))
        button.classList.add('active')
        
        // タブコンテンツの表示を切り替え
        tabContents.forEach(content => {
          if (content.id === `${targetTab}-content`) {
            content.style.display = 'block'
            content.classList.add('active')
          } else {
            content.style.display = 'none'
            content.classList.remove('active')
          }
        })
      })
    })
  }

  private initializeNextStepsPanel() {
    // 動的にNextStepsPanelコンポーネントをインポートして初期化
    const panelContainer = document.getElementById('nextsteps-panel')
    if (!panelContainer) return
    
    // シンプルなネクストステップUIを作成
    panelContainer.innerHTML = `
      <div class="nextsteps-inner">
        <div class="nextsteps-header">
          <button id="generate-nextsteps" class="generate-btn">
            <span class="icon">✨</span>
            ネクストステップ生成
          </button>
        </div>
        <div id="nextsteps-list" class="nextsteps-list">
          <p class="empty-message">記録を開始してネクストステップを生成してください</p>
        </div>
      </div>
    `
    
    // ネクストステップ生成ボタンのイベントリスナー
    const generateBtn = document.getElementById('generate-nextsteps')
    generateBtn?.addEventListener('click', () => {
      this.generateNextSteps()
    })
  }

  private async generateNextSteps() {
    if (!this.currentMinutes) {
      this.showNotification('先に議事録を生成してください', 'error')
      return
    }
    
    const generateBtn = document.getElementById('generate-nextsteps') as HTMLButtonElement
    const listContainer = document.getElementById('nextsteps-list')
    
    if (!generateBtn || !listContainer) return
    
    // ローディング状態
    generateBtn.disabled = true
    generateBtn.innerHTML = '<span class="spinner"></span> 生成中...'
    listContainer.innerHTML = '<div class="loading">ネクストステップを生成中...</div>'
    
    try {
      const response = await ChromeErrorHandler.sendMessage({
        type: 'GENERATE_NEXTSTEPS',
        payload: {
          meetingId: this.currentMinutes.meetingId,
          userPrompt: ''
        }
      })
      
      if (response.success && response.nextSteps) {
        this.displayNextSteps(response.nextSteps)
      } else {
        throw new Error(response.error || 'ネクストステップの生成に失敗しました')
      }
    } catch (error) {
      logger.error('Error generating next steps:', error)
      this.showNotification('ネクストステップの生成に失敗しました', 'error')
      listContainer.innerHTML = '<p class="error-message">生成に失敗しました。もう一度お試しください。</p>'
    } finally {
      generateBtn.disabled = false
      generateBtn.innerHTML = '<span class="icon">✨</span> ネクストステップ生成'
    }
  }

  private displayNextSteps(nextSteps: any[]) {
    const listContainer = document.getElementById('nextsteps-list')
    if (!listContainer) return
    
    if (nextSteps.length === 0) {
      listContainer.innerHTML = '<p class="empty-message">ネクストステップが見つかりませんでした</p>'
      return
    }
    
    listContainer.innerHTML = nextSteps.map(step => `
      <div class="nextstep-item ${step.isPending ? 'pending' : ''} ${step.status === 'completed' ? 'completed' : ''}">
        <div class="nextstep-header">
          <span class="status-icon">${this.getStatusIcon(step.status)}</span>
          <span class="task-text ${step.isPending ? 'text-red' : ''}">${step.task}</span>
          ${step.priority ? `<span class="priority-badge priority-${step.priority}">${this.getPriorityLabel(step.priority)}</span>` : ''}
        </div>
        <div class="nextstep-meta">
          ${step.assignee ? `<span class="assignee">👤 ${step.assignee}</span>` : ''}
          ${step.dueDate ? `<span class="due-date">📅 ${new Date(step.dueDate).toLocaleDateString('ja-JP')}</span>` : ''}
          ${step.notes ? `<span class="notes" title="${step.notes}">📝</span>` : ''}
        </div>
      </div>
    `).join('')
  }

  private getStatusIcon(status: string): string {
    switch (status) {
      case 'pending': return '○'
      case 'confirmed': return '●'
      case 'in_progress': return '◐'
      case 'completed': return '✓'
      default: return '○'
    }
  }

  private getPriorityLabel(priority: string): string {
    switch (priority) {
      case 'high': return '高'
      case 'medium': return '中'
      case 'low': return '低'
      default: return ''
    }
  }

  // クリーンアップメソッド
  private cleanup() {
    logger.debug('Cleaning up TranscriptCapture')
    
    // 最後のバッファをフラッシュ
    if (this.transcriptBuffer.length > 0) {
      this.flushTranscriptBuffer()
    }
    
    // MutationObserverの停止
    if (this.observer) {
      this.observer.disconnect()
      this.observer = null
    }
    
    if (this.callStatusObserver) {
      this.callStatusObserver.disconnect()
      this.callStatusObserver = null
    }
    
    if (this.participantsObserver) {
      this.participantsObserver.disconnect()
      this.participantsObserver = null
    }
    
    // タイムアウトのクリア
    this.cleanupTimeouts.forEach(timeout => clearTimeout(timeout))
    this.cleanupTimeouts.clear()
    
    // インターバルのクリア
    this.cleanupIntervals.forEach(interval => clearInterval(interval))
    this.cleanupIntervals.clear()
    
    // メモリ解放
    this.transcriptBuffer = []
    this.currentMinutes = null
    this.currentParticipants.clear()
    
    // DOM要素の削除
    const panel = document.getElementById('minutes-board-control-panel')
    const minimizedBtn = document.getElementById('minutes-board-minimized')
    panel?.remove()
    minimizedBtn?.remove()
  }
}

// ページ離脱時のクリーンアップ
const transcriptCapture = new TranscriptCapture()

window.addEventListener('beforeunload', () => {
  (transcriptCapture as any).cleanup()
})
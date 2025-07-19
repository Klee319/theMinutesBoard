import { ChromeMessage } from '@/types'
import { logger } from '@/utils/logger'
import { ChromeErrorHandler, ServiceWorkerKeepAlive } from '@/utils/chrome-error-handler'
import { formatMarkdownToHTML } from '@/utils/markdown'
import { CAPTION_SELECTORS, CAPTION_BUTTON_SELECTORS, SPEAKER_SELECTORS, LEAVE_BUTTON_SELECTORS, LEAVE_CONFIRM_SELECTORS } from '@/constants/selectors'
import { TIMING_CONFIG } from '@/constants/config'
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
  private captionCheckInterval: NodeJS.Timer | null = null
  private lastCaptionCheckTime = Date.now()
  private captionStatusInterval: NodeJS.Timer | null = null
  
  // メモリ管理用の変数
  private transcriptBuffer: any[] = []
  private lastFlushTime = Date.now()
  private flushInterval = TIMING_CONFIG.TRANSCRIPT_BUFFER_FLUSH_INTERVAL // 5秒ごとにバッファをフラッシュ
  private maxBufferSize = TIMING_CONFIG.TRANSCRIPT_BUFFER_SIZE // 最大バッファサイズ
  
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
    
    // 定期的にコンテキストの有効性をチェック
    setInterval(async () => {
      const isValid = await ChromeErrorHandler.checkContextValidity()
      if (!isValid) {
        logger.warn('Context validity check failed - showing reconnection UI')
        this.showReconnectionNotification()
      }
    }, 30000) // 30秒ごとにチェック
  }
  
  private showReconnectionNotification() {
    // 既に通知が表示されている場合は何もしない
    if (document.querySelector('.minutes-notification.error')) return
    
    const notification = document.createElement('div')
    notification.className = 'minutes-notification error'
    notification.innerHTML = `
      <div style="display: flex; align-items: center; gap: 10px;">
        <span>拡張機能との接続が切断されました</span>
        <button id="reload-extension-btn" style="
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
    
    // イベントリスナーを追加
    const reloadBtn = notification.querySelector('#reload-extension-btn')
    if (reloadBtn) {
      reloadBtn.addEventListener('click', () => {
        location.reload()
      })
    }
    
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
    // Google Meetページにいる場合は通訷がアクティブとみなす
    this.isCallActive = true
    
    this.injectUI()
    this.setupMessageListener()
    this.waitForCaptions()
    this.setupCallStatusMonitoring()
    this.setupParticipantsMonitoring()
    this.checkExistingSession()
    
    // 初期化完了後にボタン状態を更新
    setTimeout(() => {
      this.updateRecordingButtonState()
    }, 1000)
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
    logger.debug('Updating recording UI, recording:', recording)
    
    const toggleBtn = document.getElementById('minutes-toggle-recording')
    const generateBtn = document.getElementById('minutes-generate')
    
    if (toggleBtn) {
      const btnText = toggleBtn.querySelector('.btn-text')
      if (recording) {
        toggleBtn.classList.add('recording')
        if (btnText) {
          btnText.textContent = '記録停止'
          logger.debug('UI updated: button text changed to "記録停止"')
        }
        // 記録中は常にボタンを有効化
        toggleBtn.removeAttribute('disabled')
      } else {
        toggleBtn.classList.remove('recording')
        if (btnText) {
          btnText.textContent = '記録開始'
          logger.debug('UI updated: button text changed to "記録開始"')
        }
        // 記録していない時は字幕の状態をチェック（初期化時を除く）
        if (this.isCallActive) {
          this.updateRecordingButtonState()
        }
      }
    } else {
      logger.debug('Toggle button not found in updateRecordingUI')
    }
    
    if (generateBtn) {
      if (recording) {
        generateBtn.removeAttribute('disabled')
      } else {
        try {
          generateBtn.setAttribute('disabled', 'true')
        } catch (error) {
          logger.error('Failed to set disabled attribute on generateBtn:', error)
        }
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
        <button id="minutes-toggle-recording" class="control-btn" style="pointer-events: auto;">
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
    
    toggleBtn?.addEventListener('click', async (e) => {
      e.preventDefault() // デフォルト動作を防ぐ
      e.stopPropagation() // イベントの伝播を停止
      
      logger.debug('Toggle button clicked, isRecording:', this.isRecording)
      
      if (this.isRecording) {
        logger.debug('Calling stopRecording...')
        this.stopRecording()
      } else {
        // 記録開始前に字幕の状態を確認
        logger.debug('Checking captions before starting recording...')
        
        // まず字幕ボタンの状態を確認
        const isCaptionEnabled = this.isCaptionButtonEnabled()
        if (!isCaptionEnabled) {
          logger.debug('Caption button is OFF, canceling recording start')
          this.showNotification('字幕をONにしてから、もう一度記録開始ボタンをクリックしてください。', 'error')
          this.highlightCaptionButton()
          // ボタンの状態を確実に元に戻す
          this.updateRecordingButtonState()
          return
        }
        
        // 字幕コンテナを探す（複数回試行）
        let captionsFound = false
        for (let i = 0; i < 3; i++) {
          if (this.checkForCaptions(true)) { // forceオプションを追加
            captionsFound = true
            break
          }
          if (i < 2) {
            await new Promise(resolve => setTimeout(resolve, 500))
            logger.debug(`Caption check attempt ${i + 1} failed, retrying...`)
          }
        }
        
        if (!captionsFound || !this.captionsContainer) {
          logger.debug('Captions container not found, canceling recording start')
          this.showNotification('字幕要素が見つかりません。字幕が正しく表示されていることを確認してください。', 'error')
          this.highlightCaptionButton()
          // ボタンの状態を確実に元に戻す
          this.updateRecordingButtonState()
          return
        }
        
        logger.debug('Captions found, calling startRecording...')
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
        
        case 'CHECK_CAPTIONS':
          // 字幕の状態をチェック
          this.checkForCaptions()
          sendResponse({ 
            success: !!this.captionsContainer,
            hasCaptions: !!this.captionsContainer 
          })
          break
          
        case 'START_RECORDING':
          // 字幕チェックを再実行
          this.checkForCaptions()
          
          if (!this.captionsContainer) {
            // 字幕が無効な場合はエラーレスポンスを返す（コンソールログは削除）
            this.showNotification('字幕が有効になっていません。Google Meetの字幕をONにしてから記録を開始してください。', 'error')
            sendResponse({ success: false, error: '字幕が有効になっていません。Google Meetの字幕をONにしてください。' })
          } else {
            // 字幕が有効な場合のみ記録を開始
            this.startRecording().then(() => {
              sendResponse({ success: true })
            }).catch(error => {
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
    // 新しいセレクタリストを使用
    let attemptCount = 0
    const maxAttempts = 30 // 30秒まで待つ
    
    const checkInterval = setInterval(() => {
      attemptCount++
      
      if (this.checkForCaptions()) {
        clearInterval(checkInterval)
        this.cleanupIntervals.delete(checkInterval)
        logger.info('Captions container found after waiting')
        // 字幕が見つかったらボタンの状態を更新
        this.updateRecordingButtonState()
      } else if (attemptCount >= maxAttempts) {
        clearInterval(checkInterval)
        this.cleanupIntervals.delete(checkInterval)
        logger.debug('Captions container not found after maximum attempts')
        // 字幕が見つからなかったらボタンを無効化
        this.updateRecordingButtonState()
      } else if (attemptCount % 5 === 0) {
        logger.debug(`Still waiting for captions... (attempt ${attemptCount}/${maxAttempts})`)
        // 定期的にボタンの状態を更新
        this.updateRecordingButtonState()
      }
    }, TIMING_CONFIG.CAPTIONS_MAX_WAIT_TIME / 30)
    
    this.cleanupIntervals.add(checkInterval)
  }
  
  // 記録開始ボタンの有効/無効を制御する新しいメソッド
  private updateRecordingButtonState() {
    const toggleBtn = document.getElementById('minutes-toggle-recording')
    if (!toggleBtn || this.isRecording) return // 記録中は変更しない
    
    // 字幕ボタンの状態を確認
    const captionStatus = this.getCaptionStatus()
    
    // toggleBtnの存在チェック
    if (!toggleBtn) {
      logger.error('Toggle button not found in updateCaptionButtonUI')
      return
    }

    // デフォルトでボタンを有効化（字幕ボタンが見つからない場合もユーザーが操作できるように）
    if (captionStatus === 'on' || captionStatus === 'unknown') {
      toggleBtn.removeAttribute('disabled')
      try {
        toggleBtn.setAttribute('title', '記録を開始')
      } catch (error) {
        logger.error('Failed to set title attribute on toggleBtn:', error)
      }
      // 強制的にスタイルもリセット
      (toggleBtn as HTMLElement).style.opacity = '1';
      (toggleBtn as HTMLElement).style.cursor = 'pointer';
    } else {
      // 字幕が明確にOFFの場合のみ無効化
      try {
        toggleBtn.setAttribute('disabled', 'true')
        toggleBtn.setAttribute('title', '字幕をONにしてから記録を開始してください')
      } catch (error) {
        logger.error('Failed to set attributes on toggleBtn:', error)
      }
    }
  }

  // 字幕の状態を取得（on/off/unknown）
  private getCaptionStatus(): 'on' | 'off' | 'unknown' {
    // 1. jsname="r8qRAd"のボタンを最優先で探す
    const captionButton = document.querySelector('button[jsname="r8qRAd"]')
    if (captionButton) {
      const ariaLabel = captionButton.getAttribute('aria-label') || ''
      const iconElement = captionButton.querySelector('i.google-symbols')
      const iconText = iconElement?.textContent?.trim() || ''
      
      // aria-labelまたはアイコンテキストで判定
      if (ariaLabel.includes('オンにする') || iconText === 'closed_caption_off') {
        return 'off'
      } else if (ariaLabel.includes('オフにする') || iconText === 'closed_caption') {
        return 'on'
      }
    }
    
    // 2. その他のセレクタでも探す
    const captionButtonSelectors = [
      'button[aria-label*="字幕"]',
      'button[aria-label*="caption"]',
      'button[data-tooltip*="字幕"]',
      'button[data-tooltip*="caption"]'
    ]
    
    for (const selector of captionButtonSelectors) {
      const element = document.querySelector(selector)
      if (element) {
        const ariaLabel = element.getAttribute('aria-label') || ''
        const dataTooltip = element.getAttribute('data-tooltip') || ''
        
        if (ariaLabel.includes('オンにする') || dataTooltip.includes('オンにする')) {
          return 'off'
        } else if (ariaLabel.includes('オフにする') || dataTooltip.includes('オフにする')) {
          return 'on'
        }
      }
    }
    
    // 3. 字幕コンテナの存在でも判断
    const captionContainers = document.querySelectorAll('.a4cQT, [jsname="tgaKEf"], .iOzk7')
    if (captionContainers.length > 0) {
      return 'on'
    }
    
    return 'unknown'
  }
  
  // 字幕ボタンがONになっているかを確認するメソッド（後方互換性のため残す）
  private isCaptionButtonEnabled(): boolean {
    return this.getCaptionStatus() === 'on'
  }

  private checkForCaptions(force: boolean = false) {
    const captionSelectors = CAPTION_SELECTORS
    
    logger.debug('Checking for captions with selectors:', captionSelectors)
    
    // forceオプションが有効で、字幕ボタンがONの場合は簡略化したチェックを行う
    if (force && this.isCaptionButtonEnabled()) {
      logger.debug('Force mode enabled and caption button is ON, using simplified check')
      
      // 字幕コンテナの候補を広く探す
      for (const selector of captionSelectors) {
        const element = document.querySelector(selector)
        if (element) {
          this.captionsContainer = element
          logger.info('Captions container found with selector (force mode):', selector)
          return true
        }
      }
    }
    
    // ページ内のすべての字幕関連要素を探す（デバッグ用）
    const debugSelectors = [
      '[aria-label*="字幕"]',
      '[aria-label*="caption"]',
      '[class*="caption"]',
      '.a4cQT',
      '.iOzk7'
    ]
    
    debugSelectors.forEach(selector => {
      const elements = document.querySelectorAll(selector)
      if (elements.length > 0) {
        logger.info(`[CAPTION DEBUG] Found elements with selector "${selector}":`, elements.length)
        elements.forEach((el, index) => {
          if (index < 3) {  // 最初の3つだけログ
            logger.info(`[CAPTION DEBUG] Element ${index}:`, {
              className: (el as HTMLElement).className,
              innerHTML: (el as HTMLElement).innerHTML?.substring(0, 200)
            })
          }
        })
      }
    })
    
    for (const selector of captionSelectors) {
      const element = document.querySelector(selector)
      if (element) {
        const htmlElement = element as HTMLElement
        const isHidden = htmlElement.offsetParent === null
        const hasContent = element.textContent && element.textContent.trim().length > 0
        const hasSize = htmlElement.offsetWidth > 0 && htmlElement.offsetHeight > 0
        const computedStyle = window.getComputedStyle(htmlElement)
        const isDisplayNone = computedStyle.display === 'none'
        const isVisibilityHidden = computedStyle.visibility === 'hidden'
        
        logger.debug(`Selector ${selector}:`, {
          found: true,
          isHidden,
          hasContent,
          hasSize,
          isDisplayNone,
          isVisibilityHidden,
          textContent: element.textContent?.substring(0, 50)
        })
        
        // より緩い条件で字幕コンテナを判定
        if (!isDisplayNone && !isVisibilityHidden) {
          this.captionsContainer = element
          logger.info('Captions container found with selector:', selector)
          return true
        }
      }
    }
    
    logger.debug('No captions container found after checking all selectors')
    return false
  }
  
  private async startRecording() {
    if (this.isRecording) {
      logger.debug('Already recording')
      return
    }
    
    // 字幕コンテナの最終確認（ボタンクリックハンドラーでもチェック済みだが念のため）
    if (!this.captionsContainer) {
      logger.error('Captions container not found in startRecording')
      this.showNotification('字幕を有効にしてから、もう一度記録開始ボタンをクリックしてください。', 'error')
      this.highlightCaptionButton()
      return
    }
    
    // コンテキストの有効性をチェック
    const isContextValid = await ChromeErrorHandler.checkContextValidity()
    if (!isContextValid) {
      logger.error('Extension context is not available')
      this.showNotification('拡張機能との接続が失われました。ページを再読み込みしてください。', 'error')
      this.showReconnectionNotification()
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
      
      // コンテキストエラーの場合は特別な処理
      if (ChromeErrorHandler.isExtensionContextError(error)) {
        this.showReconnectionNotification()
      } else {
        this.showNotification(
          ChromeErrorHandler.getUserFriendlyMessage(error), 
          'error'
        )
      }
      
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
    
    // 字幕コンテナがある場合のみオブザーバーを設定
    if (this.captionsContainer) {
      this.observer = new MutationObserver((mutations) => {
        // 記録中でない場合は処理をスキップ
        if (!this.isRecording) {
          logger.debug('MutationObserver fired but not recording, skipping')
          return
        }
        
        logger.info(`[CAPTION DEBUG] MutationObserver fired, ${mutations.length} mutations`)
        
        mutations.forEach((mutation) => {
          if (mutation.type === 'childList') {
            logger.info('[CAPTION DEBUG] childList mutation detected, calling processCaptions')
            this.processCaptions()
          }
        })
      })
      
      this.observer.observe(this.captionsContainer, {
        childList: true,
        subtree: true
      })
      
      logger.info('MutationObserver set up for captions')
    } else {
      logger.debug('No captions container, MutationObserver not set up')
      // 定期的に字幕コンテナをチェック
      this.startCaptionPolling()
    }
    
    logger.info('Recording started')
    this.showNotification('記録を開始しました')
    
    // 字幕監視を開始
    this.startCaptionMonitoring()
  }
  
  private stopRecording() {
    if (!this.isRecording) {
      logger.warn('stopRecording called but not recording')
      return
    }
    
    logger.info('Stopping recording...')
    
    // 即座に記録フラグをfalseに設定（重複実行を防ぐ）
    this.isRecording = false
    
    // UIを即座に更新
    this.updateRecordingUI(false)
    
    // オブザーバーを即座に停止
    if (this.observer) {
      this.observer.disconnect()
      this.observer = null
      logger.debug('MutationObserver disconnected')
    }
    
    // キャプションコンテナの参照をクリア
    this.captionsContainer = null
    
    // 字幕監視を停止
    if (this.captionCheckInterval) {
      clearInterval(this.captionCheckInterval)
      this.captionCheckInterval = null
    }
    
    // 通知を即座に表示
    this.showNotification('記録を停止しました', 'info')
    
    // バックグラウンドへの通知（非同期、失敗しても継続）
    ChromeErrorHandler.checkContextValidity()
      .then(isValid => {
        if (isValid) {
          return ChromeErrorHandler.sendMessage({ type: 'STOP_RECORDING' })
        } else {
          logger.warn('Extension context invalidated, skipping stop recording message')
          return Promise.resolve({ success: true })
        }
      })
      .then((response) => {
        if (response?.success) {
          logger.debug('Background notified of recording stop')
        }
      })
      .catch(error => {
        // エラーがあっても記録は既に停止しているため、ログのみ
        if (ChromeErrorHandler.isExtensionContextError(error)) {
          logger.warn('Extension context invalidated during stop recording:', error)
        } else {
          logger.error('Error notifying background of stop:', error)
        }
      })
    
    logger.info('Recording stopped successfully')
  }

  private setupCallStatusMonitoring() {
    // URLの変更を監視（ページ離脱検知）
    const currentUrl = window.location.href
    const meetingId = currentUrl.split('/').pop() || ''
    logger.debug('Setting up call status monitoring for URL:', currentUrl, 'Meeting ID:', meetingId)
    
    // 字幕の状態を定期的に監視
    this.startCaptionStatusMonitoring()
    
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
    
    // URLの変更を定期的にチェック（デバウンス処理付き）
    let lastUrl = currentUrl
    let urlChangeTimer: NodeJS.Timeout | null = null
    
    const debouncedCheckUrl = () => {
      const newUrl = window.location.href
      if (newUrl !== lastUrl) {
        if (urlChangeTimer) {
          clearTimeout(urlChangeTimer)
        }
        urlChangeTimer = setTimeout(() => {
          checkUrl()
          lastUrl = newUrl
        }, 500) // 500ms待機してから実行
      }
    }
    
    const urlCheckInterval = setInterval(debouncedCheckUrl, TIMING_CONFIG.URL_CHECK_INTERVAL) // 0.5秒ごとにチェック（退出をより早く検知）
    this.cleanupIntervals.add(urlCheckInterval)
    
    // popstateイベントでも監視（ブラウザの戻る/進むボタン）
    window.addEventListener('popstate', () => {
      logger.debug('Browser navigation detected')
      checkUrl()
    })
    
    // ページ離脱時のイベント監視
    window.addEventListener('beforeunload', () => {
      // ページ離脱前にクリーンアップを実行
      if (this.isRecording) {
        // 通話終了として処理
        this.handleCallEnded('Page unload')
        
        this.isRecording = false
        this.updateRecordingUI(false)
        if (this.observer) {
          this.observer.disconnect()
          this.observer = null
        }
      }
      clearInterval(urlCheckInterval)
      logger.info('Page unloading, call ended message sent')
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
    const checkButtonInterval = setInterval(checkCallEndButton, TIMING_CONFIG.TRANSCRIPT_CHECK_INTERVAL)
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
    const elementsCheckInterval = setInterval(checkMeetingElements, TIMING_CONFIG.TRANSCRIPT_CHECK_INTERVAL)
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
          // コンテキストが有効な場合のみ送信
          ChromeErrorHandler.checkContextValidity().then(isValid => {
            if (!isValid) {
              logger.warn('Extension context invalidated, skipping participant updates')
              return
            }
            
            newParticipants.forEach(participant => {
              ChromeErrorHandler.sendMessage({
                type: 'PARTICIPANT_UPDATE',
                payload: {
                  action: 'joined',
                  participant: participant,
                  timestamp: new Date().toISOString()
                }
              }).catch(error => {
                if (!ChromeErrorHandler.isExtensionContextError(error)) {
                  logger.error('Failed to send participant update:', error)
                }
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
                if (!ChromeErrorHandler.isExtensionContextError(error)) {
                  logger.error('Failed to send participant update:', error)
                }
              })
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
      
      // ページ離脱以外の理由の場合のみ通知を表示
      if (reason !== 'Page unload') {
        this.showNotification('通話が終了したため、記録を自動停止しました', 'info')
      }
      
      // バックグラウンドにも通知（コンテキストが有効な場合のみ）
      ChromeErrorHandler.checkContextValidity().then(isValid => {
        if (isValid) {
          return ChromeErrorHandler.sendMessage({ 
            type: 'CALL_ENDED',
            reason: reason,
            timestamp: new Date().toISOString()
          })
        } else {
          logger.warn('Extension context invalidated, skipping call ended message')
        }
      }).catch(error => {
        if (!ChromeErrorHandler.isExtensionContextError(error)) {
          logger.error('Failed to send call ended message:', error)
        }
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
    // 記録中でない場合は即座にリターン
    if (!this.isRecording) {
      logger.debug('processCaptions called but not recording, skipping')
      return
    }
    
    logger.info('[CAPTION DEBUG] processCaptions called, captionsContainer:', this.captionsContainer)
    
    if (!this.captionsContainer) {
      logger.debug('processCaptions called but no captionsContainer')
      return
    }
    
    // より詳細なデバッグログ
    logger.debug('Processing captions from container:', this.captionsContainer)
    
    // Google Meetの字幕要素の包括的なセレクタパターン
    const captionSelectors = [
      // 最新のGoogle Meet字幕構造（2024年12月）
      '.nMcdL.bj4p3b',  // 字幕の内容を含むdiv
      '.ZPyPXe',        // 字幕の親要素
      '[role="region"][aria-label="字幕"]',  // aria-labelによる検索
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
    
    logger.info(`[CAPTION DEBUG] Found ${captionElements.length} caption elements`)
    
    captionElements.forEach((element, index) => {
        logger.debug(`Processing caption element ${index}:`, element)
      logger.info(`[CAPTION DEBUG] Full element text: "${element.textContent?.trim()}"`)
      logger.info(`[CAPTION DEBUG] Element innerHTML:`, element.innerHTML)
      
      // より詳細なスピーカーとテキストの検出パターン
      const speakerPatterns = [
        '.NWpY1d',           // 最新のGoogle Meet話者名セレクタ
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
        '.ygicle.VbkSUe',  // 最新のGoogle Meet字幕テキストセレクタ
        '.ygicle',         // フォールバック
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
          logger.info(`[CAPTION DEBUG] textElement HTML:`, textElement.innerHTML)
          logger.info(`[CAPTION DEBUG] textElement parent HTML:`, textElement.parentElement?.innerHTML)
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
        
        logger.info(`[CAPTION DEBUG] Captured: [${speaker}]: ${cleanText}`)
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
      // ライブダイジェスト部分のみを抽出
      const content = minutes.content
      const liveDigestMatch = content.match(/## ライブダイジェスト[\s\S]*?(?=\n---\n\n## |$)/)
      
      if (liveDigestMatch) {
        // ライブダイジェストのみを表示
        minutesText.innerHTML = formatMarkdownToHTML(liveDigestMatch[0])
      } else {
        // ライブダイジェストが見つからない場合は全体を表示
        minutesText.innerHTML = formatMarkdownToHTML(content)
      }
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
    logger.info(`[CAPTION DEBUG] Added to buffer. Buffer size: ${this.transcriptBuffer.length}`)
    
    // バッファサイズが上限に達したら即座にフラッシュ
    if (this.transcriptBuffer.length >= this.maxBufferSize) {
      logger.info('[CAPTION DEBUG] Buffer full, flushing...')
      this.flushTranscriptBuffer()
    }
  }
  
  // バッファをフラッシュ
  private flushTranscriptBuffer() {
    if (this.transcriptBuffer.length === 0) return
    
    logger.info(`[CAPTION DEBUG] Flushing ${this.transcriptBuffer.length} transcripts to background`)
    
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
        content = (minutes.content || '').replace(/[#*`]/g, '')
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
    notification.innerHTML = message.replace(/\n/g, '<br>')
    document.body.appendChild(notification)
    
    const fadeTimeout = setTimeout(() => {
      notification.classList.add('fade-out')
      const removeTimeout = setTimeout(() => notification.remove(), 300)
      this.cleanupTimeouts.add(removeTimeout)
    }, type === 'error' ? TIMING_CONFIG.TOAST_DISPLAY_TIME.ERROR : TIMING_CONFIG.TOAST_DISPLAY_TIME.SUCCESS) // エラーメッセージは長めに表示
    this.cleanupTimeouts.add(fadeTimeout)
  }
  
  private startCaptionPolling() {
    // 記録中に定期的に字幕コンテナをチェック
    const pollingInterval = setInterval(() => {
      if (!this.isRecording) {
        clearInterval(pollingInterval)
        this.cleanupIntervals.delete(pollingInterval)
        return
      }
      
      if (this.checkForCaptions() && this.captionsContainer) {
        logger.info('Captions container found during polling')
        clearInterval(pollingInterval)
        this.cleanupIntervals.delete(pollingInterval)
        
        // オブザーバーを設定
        if (!this.observer) {
          this.observer = new MutationObserver((mutations) => {
            if (!this.isRecording) return
            
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
          
          logger.info('MutationObserver set up after polling')
          this.showNotification('字幕が有効になりました', 'info')
        }
      }
    }, 2000) // 2秒ごとにチェック
    
    this.cleanupIntervals.add(pollingInterval)
  }
  
  private startCaptionMonitoring() {
    // 記録中に字幕がOFFになっていないか定期的にチェック
    if (this.captionCheckInterval) {
      clearInterval(this.captionCheckInterval)
    }
    
    this.captionCheckInterval = setInterval(() => {
      if (!this.isRecording) {
        if (this.captionCheckInterval) {
          clearInterval(this.captionCheckInterval)
          this.captionCheckInterval = null
        }
        return
      }
      
      // 字幕コンテナの存在と表示状態をチェック
      const captionsAvailable = this.checkForCaptions()
      const now = Date.now()
      
      if (!captionsAvailable || !this.captionsContainer) {
        // 最後のチェックから5秒以上経過している場合のみ警告
        if (now - this.lastCaptionCheckTime > 5000) {
          logger.debug('Captions turned off during recording')
          this.showNotification('警告：字幕がOFFになっています。字幕をONにしないと文字起こしが記録されません。', 'error')
          this.highlightCaptionButton()
          this.lastCaptionCheckTime = now
        }
      } else {
        // 字幕が復活した場合
        this.lastCaptionCheckTime = now
      }
    }, 3000) // 3秒ごとにチェック
  }
  
  // 字幕の状態を定期的に監視し、ボタンの状態を更新
  private startCaptionStatusMonitoring() {
    // 既存の監視をクリア
    if (this.captionStatusInterval) {
      clearInterval(this.captionStatusInterval)
      this.cleanupIntervals.delete(this.captionStatusInterval as unknown as number)
    }
    
    logger.info('[MONITOR DEBUG] Starting caption status monitoring...')
    
    // 2秒ごとに字幕状態をチェック
    this.captionStatusInterval = setInterval(() => {
      if (!this.isRecording && this.isCallActive) {
        logger.info('[MONITOR DEBUG] Running periodic check...')
        this.updateRecordingButtonState()
      }
    }, 2000)
    
    this.cleanupIntervals.add(this.captionStatusInterval as unknown as number)
    
    // 初回チェックを遅延実行（DOMが完全にロードされるまで待つ）
    setTimeout(() => {
      logger.info('[MONITOR DEBUG] Running initial check after delay...')
      this.updateRecordingButtonState()
    }, 1000)
  }

  private highlightCaptionButton() {
    logger.debug('Looking for caption button...')
    
    for (const selector of CAPTION_BUTTON_SELECTORS) {
      const button = document.querySelector(selector)
      if (button) {
        const htmlButton = button as HTMLElement
        
        // 既存のスタイルを保存
        const originalStyle = {
          animation: htmlButton.style.animation,
          border: htmlButton.style.border,
          boxShadow: htmlButton.style.boxShadow
        }
        
        // ハイライト効果を追加
        htmlButton.style.animation = 'pulse 2s infinite'
        htmlButton.style.border = '3px solid #ff0000'
        htmlButton.style.boxShadow = '0 0 10px #ff0000'
        
        // スタイルを追加
        const style = document.createElement('style')
        style.textContent = `
          @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.7; }
            100% { opacity: 1; }
          }
        `
        document.head.appendChild(style)
        
        // 5秒後にハイライトを削除
        setTimeout(() => {
          htmlButton.style.animation = originalStyle.animation
          htmlButton.style.border = originalStyle.border
          htmlButton.style.boxShadow = originalStyle.boxShadow
          style.remove()
        }, 5000)
        
        logger.info('Caption button highlighted:', selector)
        break
      }
    }
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
    
    // 記録中の場合は停止
    if (this.isRecording) {
      logger.info('Stopping recording due to page unload')
      this.stopRecording()
    }
    
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
    
    // 字幕監視のクリア
    if (this.captionCheckInterval) {
      clearInterval(this.captionCheckInterval)
      this.captionCheckInterval = null
    }
    
    // 字幕状態監視のクリア
    if (this.captionStatusInterval) {
      clearInterval(this.captionStatusInterval)
      this.captionStatusInterval = null
    }
    
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
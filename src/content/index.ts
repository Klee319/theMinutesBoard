import { ChromeMessage } from '@/types'
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
  
  constructor() {
    this.init()
    this.loadUserName()
  }
  
  private async loadUserName() {
    // Sync storageから利用者名を取得
    const result = await chrome.storage.sync.get(['settings'])
    if (result.settings?.userName) {
      this.currentUserName = result.settings.userName
    }
  }
  
  private init() {
    this.injectUI()
    this.setupMessageListener()
    this.waitForCaptions()
    this.setupCallStatusMonitoring()
    this.checkExistingSession()
  }
  
  private async checkExistingSession() {
    // 既存のセッションがあるか確認
    const result = await chrome.storage.local.get(['currentMeetingId'])
    if (result.currentMeetingId) {
      console.log('Restoring existing session:', result.currentMeetingId)
      this.isRecording = true
      this.updateRecordingUI(true)
      
      // Background scriptに現在のタブIDを通知
      chrome.runtime.sendMessage({ 
        type: 'RESTORE_SESSION',
        payload: { tabId: chrome.runtime.id }
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
      <div id="minutes-content" class="minutes-content-area" style="display:none;">
        <div id="minutes-loading" class="minutes-loading" style="display:none;">
          <div class="spinner"></div>
          <span class="loading-text">AIが処理中...</span>
        </div>
        <div id="minutes-text" class="minutes-text-display">
          議事録を生成中...
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
          console.log('Updated user name:', this.currentUserName)
        }
      }
    })
    
    chrome.runtime.onMessage.addListener((message: ChromeMessage, sender, sendResponse) => {
      console.log('Content script received message:', message.type)
      
      switch (message.type) {
        case 'GET_RECORDING_STATUS':
          sendResponse({ isRecording: this.isRecording })
          break
          
        case 'START_RECORDING':
          if (!this.captionsContainer) {
            this.showNotification('字幕が有効になっていません。字幕をONにしてください。', 'error')
            sendResponse({ success: false, error: '字幕が有効になっていません' })
          } else {
            this.startRecording()
            sendResponse({ success: true })
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
            console.log('Captions container found with selector:', selector)
            break
          }
        }
      }
      
      if (captionsFound) {
        clearInterval(checkInterval)
      }
    }, 1000)
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
        this.captionsContainer = element
        console.log('Captions container found with selector:', selector)
        return true
      }
    }
    return false
  }
  
  private startRecording() {
    if (this.isRecording) {
      console.log('Already recording')
      return
    }
    
    // 字幕コンテナを再度チェック
    this.checkForCaptions()
    
    if (!this.captionsContainer) {
      console.log('No captions container found')
      this.showNotification('字幕が有効になっていません。字幕をONにしてください。', 'error')
      return
    }
    
    this.isRecording = true
    this.hasGeneratedMinutes = false // 新しい記録開始時にリセット
    this.updateGenerateButtonText() // ボタンテキストを初期状態に戻す
    
    chrome.runtime.sendMessage({ type: 'START_RECORDING' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Error sending START_RECORDING:', chrome.runtime.lastError)
      }
    })
    
    this.updateRecordingUI(true)
    
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
    
    console.log('Recording started')
    this.showNotification('記録を開始しました')
  }
  
  private stopRecording() {
    if (!this.isRecording) return
    
    this.isRecording = false
    chrome.runtime.sendMessage({ type: 'STOP_RECORDING' })
    
    this.updateRecordingUI(false)
    
    if (this.observer) {
      this.observer.disconnect()
      this.observer = null
    }
    
    console.log('Recording stopped')
  }

  private setupCallStatusMonitoring() {
    // URLの変更を監視（ページ離脱検知）
    const currentUrl = window.location.href
    console.log('Setting up call status monitoring for URL:', currentUrl)
    
    // ページが会議画面から離脱したか監視
    const checkUrl = () => {
      const newUrl = window.location.href
      if (!newUrl.includes('meet.google.com') || 
          (currentUrl.includes('/') && !newUrl.includes(currentUrl.split('/').pop() || ''))) {
        console.log('URL changed, call likely ended:', newUrl)
        this.handleCallEnded('URL change detected')
      }
    }
    
    // URLの変更を定期的にチェック
    setInterval(checkUrl, 2000)
    
    // ページ離脱時のイベント監視
    window.addEventListener('beforeunload', () => {
      this.handleCallEnded('Page unload')
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
      'button[data-tooltip*="離"]'
    ]
    
    const checkCallEndButton = () => {
      for (const selector of callEndSelectors) {
        const button = document.querySelector(selector) as HTMLButtonElement
        if (button) {
          // まだイベントリスナーが追加されていない場合のみ追加
          if (!button.dataset.callEndListenerAdded) {
            button.dataset.callEndListenerAdded = 'true'
            button.addEventListener('click', () => {
              console.log('Call end button clicked')
              // 少し遅延を入れて実際に通話が終了するのを待つ
              setTimeout(() => {
                this.handleCallEnded('Call end button clicked')
              }, 1000)
            })
            console.log('Added call end button listener to:', selector)
          }
        }
      }
    }
    
    // 定期的にボタンをチェック（動的に追加される可能性があるため）
    setInterval(checkCallEndButton, 3000)
    checkCallEndButton() // 初回実行
  }

  private monitorMeetingElements() {
    // 会議画面の重要な要素が消失したかを監視
    const criticalSelectors = [
      '[data-self-name]', // 自分の名前表示
      '[data-allocation-index]', // 参加者表示エリア
      '[role="main"]', // メイン会議エリア
      '[jsname="VOlAQe"]' // Google Meet特有の会議エリア
    ]
    
    const checkMeetingElements = () => {
      let elementsFound = 0
      
      for (const selector of criticalSelectors) {
        if (document.querySelector(selector)) {
          elementsFound++
        }
      }
      
      // 重要な要素が大幅に減った場合は通話終了と判断
      if (elementsFound === 0 && this.isCallActive) {
        console.log('Critical meeting elements disappeared')
        this.handleCallEnded('Meeting elements disappeared')
      }
    }
    
    // 定期的にチェック
    setInterval(checkMeetingElements, 5000)
  }

  private handleCallEnded(reason: string) {
    if (!this.isCallActive) return // 既に処理済み
    
    console.log('Call ended detected:', reason)
    this.isCallActive = false
    
    // 記録中の場合は自動停止
    if (this.isRecording) {
      console.log('Auto-stopping recording due to call end')
      this.stopRecording()
      this.showNotification('通話が終了したため、記録を自動停止しました', 'info')
      
      // バックグラウンドにも通知
      chrome.runtime.sendMessage({ 
        type: 'CALL_ENDED',
        reason: reason,
        timestamp: new Date().toISOString()
      })
    }
    
    // オブザーバーのクリーンアップ
    if (this.callStatusObserver) {
      this.callStatusObserver.disconnect()
      this.callStatusObserver = null
    }
  }
  
  private processCaptions() {
    if (!this.captionsContainer) return
    
    // より詳細なデバッグログ
    console.log('Processing captions from container:', this.captionsContainer)
    
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
        console.log(`Found caption elements with selector: ${selector}, count: ${elements.length}`)
        break
      }
    }
    
    if (!captionElements) {
      console.log('No caption elements found, using fallback')
      // フォールバック: 直接テキストを取得
      const allText = this.captionsContainer.textContent?.trim()
      if (allText && allText !== this.lastCaption && allText.length > 2) {
        this.lastCaption = allText
        chrome.runtime.sendMessage({
          type: 'TRANSCRIPT_UPDATE',
          payload: {
            speaker: 'Unknown',
            content: allText
          }
        })
        
        console.log(`[Unknown]: ${allText}`)
      }
      return
    }
    
    captionElements.forEach((element, index) => {
      console.log(`Processing caption element ${index}:`, element)
      
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
          console.log(`Found speaker with pattern ${pattern}:`, speakerElement.textContent)
          break
        }
      }
      
      // テキスト要素を探す
      for (const pattern of textPatterns) {
        textElement = element.querySelector(pattern)
        if (textElement && textElement.textContent?.trim()) {
          console.log(`Found text with pattern ${pattern}:`, textElement.textContent)
          break
        }
      }
      
      // より詳細な構造解析
      if (!speakerElement || !textElement) {
        console.log('Alternative parsing: analyzing element structure')
        const allChildren = element.children
        
        if (allChildren.length >= 2) {
          // 最初の子要素がスピーカー、2番目以降がテキストの可能性
          const firstChild = allChildren[0] as Element
          const secondChild = allChildren[1] as Element
          
          if (!speakerElement && firstChild.textContent?.trim().includes(':')) {
            speakerElement = firstChild
            console.log('Found speaker from first child:', firstChild.textContent)
          }
          
          if (!textElement && secondChild.textContent?.trim()) {
            textElement = secondChild
            console.log('Found text from second child:', secondChild.textContent)
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
              console.log(`Parsed from full text - Speaker: ${possibleSpeaker}, Text: ${possibleText}`)
              
              // 「あなた」を利用者名に置換
              let finalSpeaker = possibleSpeaker
              if ((possibleSpeaker === 'あなた' || possibleSpeaker === 'You' || possibleSpeaker === '自分') && this.currentUserName) {
                finalSpeaker = this.currentUserName
              }
              
              if (possibleText !== this.lastCaption && possibleText.length > 2) {
                this.lastCaption = possibleText
                this.currentSpeaker = finalSpeaker
                
                chrome.runtime.sendMessage({
                  type: 'TRANSCRIPT_UPDATE',
                  payload: {
                    speaker: finalSpeaker,
                    content: possibleText
                  }
                })
                
                console.log(`[${finalSpeaker}]: ${possibleText}`)
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
      if ((speaker === 'あなた' || speaker === 'You' || speaker === '自分') && this.currentUserName) {
        speaker = this.currentUserName
      }
      
      // スピーカー名がテキストに含まれている場合は除去
      let cleanText = text
      if (speaker !== 'Unknown' && text.startsWith(speaker)) {
        cleanText = text.substring(speaker.length).replace(/^[:\s]+/, '').trim()
      }
      
      if (cleanText && cleanText !== this.lastCaption && cleanText.length > 2) {
        this.lastCaption = cleanText
        this.currentSpeaker = speaker
        
        chrome.runtime.sendMessage({
          type: 'TRANSCRIPT_UPDATE',
          payload: {
            speaker,
            content: cleanText
          }
        })
        
        console.log(`[${speaker}]: ${cleanText}`)
      }
    })
  }
  
  private generateMinutes() {
    this.showNotification('議事録を生成中...', 'info')
    this.showLoadingState(true)
    
    chrome.runtime.sendMessage({ type: 'GENERATE_MINUTES' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Extension context error:', chrome.runtime.lastError)
        this.showNotification('エラー: 拡張機能を再読み込みしてください', 'error')
        this.showLoadingState(false)
        return
      }
      
      if (response.success) {
        this.showNotification('議事録の生成を開始しました')
        // 成功時もローディング状態は継続（MINUTES_GENERATEDで解除）
      } else {
        this.showNotification('エラー: ' + response.error, 'error')
        this.showLoadingState(false)
      }
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
      minutesText.innerHTML = this.formatMarkdownToHTML(minutes.content)
    }
  }
  
  private openInNewTab() {
    chrome.storage.local.get(['currentMeetingId'], (result) => {
      if (result.currentMeetingId) {
        chrome.runtime.sendMessage({
          type: 'OPEN_VIEWER_TAB',
          payload: { meetingId: result.currentMeetingId }
        }, (response) => {
          if (response?.success && response.tabId) {
            this.viewerTabId = response.tabId
          }
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
  
  private formatMarkdownToHTML(markdown: string): string {
    return markdown
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')
      .replace(/^# (.*$)/gim, '<h1>$1</h1>')
      .replace(/^\* (.+)$/gim, '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
      .replace(/\*\*(.*)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br>')
  }
  
  private showNotification(message: string, type: 'success' | 'error' | 'info' = 'success') {
    const notification = document.createElement('div')
    notification.className = `minutes-notification ${type}`
    notification.textContent = message
    document.body.appendChild(notification)
    
    setTimeout(() => {
      notification.classList.add('fade-out')
      setTimeout(() => notification.remove(), 300)
    }, 3000)
  }


}

new TranscriptCapture()
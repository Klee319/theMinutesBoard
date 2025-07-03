/**
 * DOM Selectors Constants
 * Google Meet UI要素のセレクタ定義
 */

export const CAPTION_SELECTORS = [
  '.a4cQT',  // メインの字幕コンテナ
  '.iOzk7',  // 字幕要素のラッパー
  '[jsname="dsyhDe"]',  // 字幕要素の別セレクタ
  '[jsname="YSg9Nc"]',
  '[jscontroller="GCpkte"]',
  '[jsname="tgaKEf"]',
  '[class*="caption"]',
  '[class*="subtitle"]',
  '[class*="transcript"]',
  '[role="region"][aria-live="polite"]'
];

export const CAPTION_BUTTON_SELECTORS = [
  '[aria-label*="字幕"]',
  '[aria-label*="キャプション"]',
  '[aria-label*="caption"]',
  '[aria-label*="subtitle"]',
  '[aria-label*="CC"]',
  '[data-tooltip*="字幕"]',
  '[data-tooltip*="caption"]',
  'button[jsname="r8qRAd"]',
  'button[aria-pressed]'
];

export const SPEAKER_SELECTORS = [
  '.zs7s8d.jxFHg'
];

export const LEAVE_BUTTON_SELECTORS = [
  '[aria-label="通話から退出"]',
  '[aria-label="Leave call"]',
  '[aria-label="退出"]',
  '[jsname="CQylAd"]',
  '.s1GInc.zCbbgf'
];

export const LEAVE_CONFIRM_SELECTORS = [
  '[jsname="V67aGc"]:not([disabled])',
  'button.VfPpkd-LgbsSe[jsname="V67aGc"]',
  '.VfPpkd-vQzf8d:has-text("退出")',
  'button:has-text("Leave")'
];
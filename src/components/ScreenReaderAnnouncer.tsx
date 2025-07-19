import React from 'react'

export const ScreenReaderAnnouncer: React.FC = () => {
  return (
    <>
      {/* ポライトアナウンス用（通常の通知） */}
      <div
        id="sr-live-polite"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      />
      
      {/* アサーティブアナウンス用（重要な通知） */}
      <div
        id="sr-live-assertive"
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
      />
    </>
  )
}
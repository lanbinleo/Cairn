import { invoke } from '@tauri-apps/api/core'

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown
  }
}

function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function logFrontendMessage(message: string, level: 'info' | 'error' = 'info'): Promise<void> {
  if (!isTauriRuntime()) {
    if (level === 'error') {
      console.error(message)
    } else {
      console.info(message)
    }
    return
  }
  try {
    await invoke('frontend_log', { message, level })
  } catch (err) {
    console.error('failed to write frontend log', err, message)
  }
}

export function logFrontendError(message: string): Promise<void> {
  return logFrontendMessage(message, 'error')
}

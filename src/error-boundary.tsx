import { Component, type ErrorInfo, type ReactNode } from 'react'

import { logFrontendError } from '@/lib/frontend-log'

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    void logFrontendError(`react error: ${error.stack ?? error.message}\n${info.componentStack}`)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-svh bg-background p-8 text-foreground">
          <div className="mx-auto flex max-w-2xl flex-col gap-3 rounded-lg border bg-card p-5">
            <h1 className="text-lg font-semibold">Cairn 前端启动失败</h1>
            <p className="text-sm text-muted-foreground">
              错误已经写入本地日志。请在设置页查看 `cairn.log`。
            </p>
            <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs">
              {this.state.error.stack ?? this.state.error.message}
            </pre>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

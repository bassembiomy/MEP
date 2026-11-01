import React from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

interface Props {
  /** Short name of the protected area, shown in the message. */
  area: string
  children: React.ReactNode
  /** Optional extra action (e.g. reset the design) offered next to "Retry". */
  onReset?: () => void
  resetLabel?: string
}

interface State {
  error: Error | null
}

/**
 * Contains rendering errors to one area of the UI instead of blanking the whole application window.
 * Shows the error with a Retry button (and an optional reset action).
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error(`[${this.props.area}]`, error, info.componentStack)
  }

  render(): React.ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="flex flex-col gap-3 bg-red-950/30 border border-red-800/60 rounded-2xl p-5 text-xs text-red-200">
        <div className="flex items-center gap-2 font-bold uppercase tracking-wider">
          <AlertTriangle size={16} />
          {this.props.area} could not be displayed
        </div>
        <div className="font-mono text-[11px] text-red-300/90 break-words">{error.message}</div>
        <div className="flex gap-2">
          <button
            onClick={() => this.setState({ error: null })}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-900 text-neutral-200 hover:bg-neutral-800 cursor-pointer"
          >
            <RotateCcw size={13} /> Retry
          </button>
          {this.props.onReset && (
            <button
              onClick={() => {
                this.props.onReset?.()
                this.setState({ error: null })
              }}
              className="px-3 py-1.5 rounded-lg bg-red-700 text-white hover:bg-red-600 cursor-pointer"
            >
              {this.props.resetLabel ?? 'Reset'}
            </button>
          )}
        </div>
      </div>
    )
  }
}

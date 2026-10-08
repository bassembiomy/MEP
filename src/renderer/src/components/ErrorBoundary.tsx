import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught React Error caught by ErrorBoundary:', error, errorInfo);
    this.setState({ error, errorInfo });
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen w-screen bg-[#09090b] text-neutral-100 flex flex-col items-center justify-center p-6 select-none font-sans">
          <div className="max-w-xl w-full bg-neutral-900 border border-neutral-800 p-6 rounded-2xl shadow-2xl flex flex-col gap-4">
            <div className="flex items-center gap-3 text-amber-400">
              <AlertTriangle size={28} />
              <div>
                <h2 className="text-base font-bold text-neutral-100">Application Error Encountered</h2>
                <p className="text-xs text-neutral-400">The application caught a rendering exception.</p>
              </div>
            </div>

            <div className="bg-neutral-950 p-3.5 rounded-xl border border-neutral-850 font-mono text-xs text-rose-400 overflow-x-auto max-h-48">
              {this.state.error?.message || 'Unknown Error'}
              {this.state.errorInfo?.componentStack && (
                <div className="text-[10px] text-neutral-500 mt-2 font-mono whitespace-pre-wrap">
                  {this.state.errorInfo.componentStack}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={this.handleReset}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs px-4 py-2 rounded-xl transition-all cursor-pointer"
              >
                <RefreshCw size={14} />
                Reload Application
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

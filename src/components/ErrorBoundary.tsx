import React from "react";
import { AlertTriangle } from "lucide-react";

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    console.error("🚨 ErrorBoundary caught error:", error);
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("🚨 ErrorBoundary component stack:", error, errorInfo.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen w-screen items-center justify-center bg-slate-950">
          <div className="max-w-md rounded-2xl border border-rose-500/30 bg-rose-500/10 p-8 text-center">
            <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-rose-400" />
            <h1 className="mb-2 text-xl font-bold text-rose-300">Something went wrong</h1>
            <p className="mb-4 text-sm text-rose-200/80">
              {this.state.error?.message || "An unexpected error occurred"}
            </p>
            <div className="mb-4 max-h-32 overflow-auto rounded bg-slate-900/50 p-2 text-left text-xs font-mono text-slate-300">
              {this.state.error?.stack}
            </div>
            <button
              onClick={() => {
                console.log("ErrorBoundary: Reloading page");
                window.location.reload();
              }}
              className="w-full rounded-lg bg-rose-600 px-4 py-2.5 font-bold text-white hover:bg-rose-500 transition"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

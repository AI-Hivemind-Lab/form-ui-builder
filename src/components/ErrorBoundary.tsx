import { Component, type ReactNode } from 'react';

/** Last-resort guard: a render error shows a message instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="crash" role="alert">
          <h2>Something went wrong rendering this form</h2>
          <pre>{this.state.error.message}</pre>
          <button type="button" className="btn" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

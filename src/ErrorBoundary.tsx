// If a screen ever throws while drawing, show a friendly reload card instead of a blank page.
// Nothing is lost: the event is remembered on the device and rejoining is automatic.
import { Component, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('screen error:', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="landing">
        <div className="landing-card" data-testid="error-screen">
          <div className="logo">🗺️</div>
          <h1>Oops, that tripped</h1>
          <p className="tagline">Something went wrong drawing this screen. Your event is still there. Reload and you will be right back in it.</p>
          <button className="btn btn-big" onClick={() => location.reload()}>🔄 Reload</button>
        </div>
      </div>
    );
  }
}

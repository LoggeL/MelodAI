import { Component, type ErrorInfo, type ReactNode } from 'react'
import { PageState } from './PageState'

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('Unable to render this page', error, info.componentStack) }
  render() {
    if (this.state.failed) return <PageState error title="Diese Seite konnte nicht angezeigt werden."
      description="Lade die Seite neu und versuch es noch einmal."
      action={<button type="button" className="btn" onClick={() => window.location.reload()}>Erneut versuchen</button>} />
    return this.props.children
  }
}

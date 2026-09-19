import { Component, type ErrorInfo, type ReactNode } from 'react'
import { PageState } from './PageState'

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('Unable to render this page', error, info.componentStack) }
  render() {
    if (this.state.failed) return <PageState title="This page could not be displayed" description="Reload the page to try again."
      action={<button className="button" onClick={() => window.location.reload()}>Reload page</button>} />
    return this.props.children
  }
}

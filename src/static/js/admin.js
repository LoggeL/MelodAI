/**
 * MelodAI Admin Shared JavaScript
 * Dark mode toggle and common admin functionality
 */

// Dark Mode Management
class ThemeManager {
  constructor() {
    this.theme = localStorage.getItem('theme') || 'light'
    this.init()
  }

  init() {
    // Apply saved theme on load
    this.applyTheme(this.theme)

    // Create theme toggle button if it doesn't exist
    if (!document.querySelector('.theme-toggle')) {
      this.createThemeToggle()
    }
  }

  applyTheme(theme) {
    this.theme = theme
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
    this.updateToggleButton()
  }

  toggleTheme() {
    const newTheme = this.theme === 'light' ? 'dark' : 'light'
    this.applyTheme(newTheme)
  }

  createThemeToggle() {
    // Find the button container in the header
    const btnContainer =
      document.querySelector('.btn-container') ||
      document.querySelector('.header-actions')

    if (!btnContainer) return

    const themeToggle = document.createElement('button')
    themeToggle.className = 'theme-toggle'
    themeToggle.setAttribute('aria-label', 'Toggle dark mode')
    themeToggle.setAttribute('title', 'Toggle dark mode')

    this.updateToggleButtonContent(themeToggle)

    themeToggle.addEventListener('click', () => {
      this.toggleTheme()
    })

    // Insert as the last button in the container
    btnContainer.appendChild(themeToggle)
  }

  updateToggleButton() {
    const toggleBtn = document.querySelector('.theme-toggle')
    if (toggleBtn) {
      this.updateToggleButtonContent(toggleBtn)
    }
  }

  updateToggleButtonContent(button) {
    if (this.theme === 'dark') {
      button.innerHTML = '<i class="fas fa-sun"></i> Light Mode'
    } else {
      button.innerHTML = '<i class="fas fa-moon"></i> Dark Mode'
    }
  }
}

// Initialize theme manager when DOM is ready
let themeManager
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    themeManager = new ThemeManager()
  })
} else {
  themeManager = new ThemeManager()
}

// Export for global access
window.themeManager = themeManager

/**
 * MelodAI Common Utilities
 * Shared functionality across all pages
 */

// Theme Management
const ThemeManager = {
  STORAGE_KEY: 'theme',
  DEFAULT_THEME: 'light',

  getTheme() {
    return localStorage.getItem(this.STORAGE_KEY) || this.DEFAULT_THEME;
  },

  setTheme(theme) {
    localStorage.setItem(this.STORAGE_KEY, theme);
    document.documentElement.setAttribute('data-theme', theme);
    this.updateIcons(theme);
  },

  toggleTheme() {
    const newTheme = this.getTheme() === 'light' ? 'dark' : 'light';
    this.setTheme(newTheme);
    return newTheme;
  },

  updateIcons(theme) {
    // Update all theme icons on the page
    document.querySelectorAll('#themeIcon, .theme-icon').forEach(icon => {
      icon.className = theme === 'light' ? 'fas fa-moon' : 'fas fa-sun';
    });
  },

  init() {
    this.setTheme(this.getTheme());
  }
};

// Notification System
const Notifications = {
  show(message, type = 'success') {
    const container = document.getElementById('toastContainer') || this.createContainer();
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;

    const icons = {
      success: 'fa-check-circle',
      error: 'fa-exclamation-circle',
      warning: 'fa-exclamation-triangle',
      info: 'fa-info-circle'
    };

    notification.innerHTML = `
      <i class="fas ${icons[type] || icons.info}"></i>
      <span>${this.escapeHtml(message)}</span>
    `;

    container.appendChild(notification);

    setTimeout(() => {
      notification.style.animation = 'fadeOut 0.3s ease forwards';
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  },

  createContainer() {
    const container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
    return container;
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
};

// Format utilities
const Format = {
  time(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  },

  dateTime(dateStr) {
    if (!dateStr) return 'Unknown';
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return dateStr;
      return date.toLocaleString();
    } catch {
      return dateStr;
    }
  },

  fileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
};

// API utilities
const API = {
  async fetch(url, options = {}) {
    const defaults = {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    };

    const response = await fetch(url, { ...defaults, ...options });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || error.message || 'Request failed');
    }

    return response.json();
  },

  async checkAuth() {
    try {
      const data = await this.fetch('/auth/check');
      return data;
    } catch {
      return { authenticated: false };
    }
  }
};

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
  ThemeManager.init();
});

// Export for use in other scripts
window.MelodAI = {
  Theme: ThemeManager,
  Notify: Notifications,
  Format: Format,
  API: API
};

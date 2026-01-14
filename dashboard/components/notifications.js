/**
 * Revenue Radar - Real-time Notification System
 *
 * Provides:
 * - Toast notifications for immediate alerts
 * - Notification bell with unread count badge
 * - Notification center dropdown with history
 * - Sound alerts for high-priority opportunities
 * - Desktop notifications (with permission)
 * - WebSocket/SSE support for real-time updates
 */

class NotificationSystem {
  constructor(options = {}) {
    this.options = {
      position: 'top-right',
      maxToasts: 5,
      toastDuration: 5000,
      enableSound: true,
      enableDesktopNotifications: true,
      pollInterval: 30000, // Poll every 30 seconds for new notifications
      ...options
    };

    this.notifications = [];
    this.unreadCount = 0;
    this.toastContainer = null;
    this.bellElement = null;
    this.dropdownElement = null;
    this.soundElement = null;
    this.eventSource = null;
    this.pollTimer = null;

    this.init();
  }

  init() {
    this.createStyles();
    this.createToastContainer();
    this.createNotificationBell();
    this.createSoundElement();
    this.requestDesktopPermission();
    this.loadNotifications();
    this.startPolling();
    this.connectRealtime();
  }

  createStyles() {
    if (document.getElementById('notification-system-styles')) return;

    const styles = document.createElement('style');
    styles.id = 'notification-system-styles';
    styles.textContent = `
      /* Toast Container */
      .rr-toast-container {
        position: fixed;
        z-index: 10000;
        display: flex;
        flex-direction: column;
        gap: 12px;
        max-width: 420px;
        pointer-events: none;
      }

      .rr-toast-container.top-right {
        top: 24px;
        right: 24px;
      }

      .rr-toast-container.top-left {
        top: 24px;
        left: 24px;
      }

      .rr-toast-container.bottom-right {
        bottom: 24px;
        right: 24px;
      }

      .rr-toast-container.bottom-left {
        bottom: 24px;
        left: 24px;
      }

      /* Toast */
      .rr-toast {
        pointer-events: auto;
        display: flex;
        align-items: flex-start;
        gap: 14px;
        padding: 16px 20px;
        background: linear-gradient(135deg, rgba(17, 21, 37, 0.98) 0%, rgba(15, 19, 32, 0.98) 100%);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 14px;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05);
        backdrop-filter: blur(20px);
        animation: toastSlideIn 0.3s ease-out;
        cursor: pointer;
        transition: transform 0.2s, box-shadow 0.2s;
      }

      .rr-toast:hover {
        transform: translateX(-4px);
        box-shadow: 0 12px 50px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(251, 191, 36, 0.2);
      }

      .rr-toast.removing {
        animation: toastSlideOut 0.3s ease-in forwards;
      }

      @keyframes toastSlideIn {
        from {
          opacity: 0;
          transform: translateX(100%);
        }
        to {
          opacity: 1;
          transform: translateX(0);
        }
      }

      @keyframes toastSlideOut {
        from {
          opacity: 1;
          transform: translateX(0);
        }
        to {
          opacity: 0;
          transform: translateX(100%);
        }
      }

      .rr-toast-icon {
        width: 42px;
        height: 42px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 12px;
        flex-shrink: 0;
      }

      .rr-toast-icon svg {
        width: 22px;
        height: 22px;
      }

      .rr-toast.opportunity .rr-toast-icon {
        background: linear-gradient(135deg, rgba(251, 191, 36, 0.2) 0%, rgba(245, 158, 11, 0.2) 100%);
        color: #fbbf24;
      }

      .rr-toast.success .rr-toast-icon {
        background: rgba(34, 197, 94, 0.2);
        color: #22c55e;
      }

      .rr-toast.warning .rr-toast-icon {
        background: rgba(251, 191, 36, 0.2);
        color: #fbbf24;
      }

      .rr-toast.error .rr-toast-icon {
        background: rgba(239, 68, 68, 0.2);
        color: #ef4444;
      }

      .rr-toast.info .rr-toast-icon {
        background: rgba(59, 130, 246, 0.2);
        color: #3b82f6;
      }

      .rr-toast-content {
        flex: 1;
        min-width: 0;
      }

      .rr-toast-title {
        font-weight: 600;
        color: #ffffff;
        margin-bottom: 4px;
        font-size: 14px;
        line-height: 1.4;
      }

      .rr-toast-message {
        color: #94a3b8;
        font-size: 13px;
        line-height: 1.5;
      }

      .rr-toast-value {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        margin-top: 8px;
        padding: 4px 10px;
        background: rgba(251, 191, 36, 0.1);
        border-radius: 6px;
        font-size: 13px;
        font-weight: 600;
        color: #fbbf24;
      }

      .rr-toast-close {
        position: absolute;
        top: 8px;
        right: 8px;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: transparent;
        border: none;
        color: #64748b;
        cursor: pointer;
        opacity: 0;
        transition: opacity 0.2s, color 0.2s;
      }

      .rr-toast:hover .rr-toast-close {
        opacity: 1;
      }

      .rr-toast-close:hover {
        color: #ffffff;
      }

      .rr-toast-progress {
        position: absolute;
        bottom: 0;
        left: 0;
        height: 3px;
        background: linear-gradient(90deg, #fbbf24, #f59e0b);
        border-radius: 0 0 14px 14px;
        animation: toastProgress linear forwards;
      }

      @keyframes toastProgress {
        from { width: 100%; }
        to { width: 0%; }
      }

      /* Notification Bell */
      .rr-notification-bell {
        position: relative;
        width: 44px;
        height: 44px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 12px;
        cursor: pointer;
        transition: all 0.2s;
        color: #94a3b8;
      }

      .rr-notification-bell:hover {
        background: rgba(251, 191, 36, 0.1);
        border-color: rgba(251, 191, 36, 0.3);
        color: #fbbf24;
      }

      .rr-notification-bell.has-unread {
        animation: bellPulse 2s ease-in-out infinite;
      }

      @keyframes bellPulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.05); }
      }

      .rr-notification-badge {
        position: absolute;
        top: -4px;
        right: -4px;
        min-width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0 6px;
        background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
        border-radius: 10px;
        font-size: 11px;
        font-weight: 700;
        color: #ffffff;
        box-shadow: 0 2px 8px rgba(239, 68, 68, 0.4);
      }

      .rr-notification-badge.hidden {
        display: none;
      }

      /* Notification Dropdown */
      .rr-notification-dropdown {
        position: absolute;
        top: calc(100% + 12px);
        right: 0;
        width: 400px;
        max-height: 500px;
        background: linear-gradient(135deg, rgba(17, 21, 37, 0.98) 0%, rgba(15, 19, 32, 0.98) 100%);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 16px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(20px);
        overflow: hidden;
        opacity: 0;
        visibility: hidden;
        transform: translateY(-10px);
        transition: all 0.2s ease-out;
        z-index: 1000;
      }

      .rr-notification-dropdown.open {
        opacity: 1;
        visibility: visible;
        transform: translateY(0);
      }

      .rr-dropdown-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 20px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      }

      .rr-dropdown-title {
        font-weight: 600;
        color: #ffffff;
        font-size: 15px;
      }

      .rr-dropdown-actions {
        display: flex;
        gap: 8px;
      }

      .rr-dropdown-action {
        padding: 6px 12px;
        background: transparent;
        border: none;
        color: #64748b;
        font-size: 12px;
        cursor: pointer;
        transition: color 0.2s;
      }

      .rr-dropdown-action:hover {
        color: #fbbf24;
      }

      .rr-dropdown-body {
        max-height: 400px;
        overflow-y: auto;
      }

      .rr-dropdown-body::-webkit-scrollbar {
        width: 6px;
      }

      .rr-dropdown-body::-webkit-scrollbar-track {
        background: transparent;
      }

      .rr-dropdown-body::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.1);
        border-radius: 3px;
      }

      .rr-notification-item {
        display: flex;
        align-items: flex-start;
        gap: 14px;
        padding: 16px 20px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        cursor: pointer;
        transition: background 0.2s;
      }

      .rr-notification-item:hover {
        background: rgba(251, 191, 36, 0.05);
      }

      .rr-notification-item.unread {
        background: rgba(251, 191, 36, 0.03);
      }

      .rr-notification-item.unread::before {
        content: '';
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        width: 3px;
        background: #fbbf24;
      }

      .rr-notification-item-icon {
        width: 36px;
        height: 36px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 10px;
        flex-shrink: 0;
      }

      .rr-notification-item-icon.opportunity {
        background: rgba(251, 191, 36, 0.15);
        color: #fbbf24;
      }

      .rr-notification-item-icon.success {
        background: rgba(34, 197, 94, 0.15);
        color: #22c55e;
      }

      .rr-notification-item-icon.warning {
        background: rgba(245, 158, 11, 0.15);
        color: #f59e0b;
      }

      .rr-notification-item-icon.info {
        background: rgba(59, 130, 246, 0.15);
        color: #3b82f6;
      }

      .rr-notification-item-content {
        flex: 1;
        min-width: 0;
      }

      .rr-notification-item-title {
        font-weight: 500;
        color: #ffffff;
        font-size: 13px;
        margin-bottom: 2px;
        line-height: 1.4;
      }

      .rr-notification-item-message {
        color: #94a3b8;
        font-size: 12px;
        line-height: 1.4;
      }

      .rr-notification-item-time {
        font-size: 11px;
        color: #64748b;
        margin-top: 4px;
      }

      .rr-notification-empty {
        padding: 40px 20px;
        text-align: center;
        color: #64748b;
      }

      .rr-notification-empty svg {
        width: 48px;
        height: 48px;
        margin-bottom: 12px;
        opacity: 0.5;
      }

      /* Sound indicator */
      .rr-sound-indicator {
        position: fixed;
        bottom: 24px;
        left: 24px;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 16px;
        background: rgba(17, 21, 37, 0.9);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        font-size: 12px;
        color: #64748b;
        cursor: pointer;
        opacity: 0;
        transition: opacity 0.2s;
        z-index: 100;
      }

      .rr-sound-indicator:hover {
        opacity: 1 !important;
      }

      .rr-sound-indicator.muted svg {
        color: #ef4444;
      }
    `;
    document.head.appendChild(styles);
  }

  createToastContainer() {
    this.toastContainer = document.createElement('div');
    this.toastContainer.className = `rr-toast-container ${this.options.position}`;
    document.body.appendChild(this.toastContainer);
  }

  createNotificationBell() {
    // Create wrapper for positioning
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position: relative; display: inline-block;';

    // Create bell button
    this.bellElement = document.createElement('button');
    this.bellElement.className = 'rr-notification-bell';
    this.bellElement.innerHTML = `
      <svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/>
      </svg>
      <span class="rr-notification-badge hidden">0</span>
    `;

    // Create dropdown
    this.dropdownElement = document.createElement('div');
    this.dropdownElement.className = 'rr-notification-dropdown';
    this.dropdownElement.innerHTML = `
      <div class="rr-dropdown-header">
        <span class="rr-dropdown-title">Notifications</span>
        <div class="rr-dropdown-actions">
          <button class="rr-dropdown-action" data-action="mark-all-read">Mark all read</button>
          <button class="rr-dropdown-action" data-action="settings">Settings</button>
        </div>
      </div>
      <div class="rr-dropdown-body">
        <div class="rr-notification-empty">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/>
          </svg>
          <p>No notifications yet</p>
        </div>
      </div>
    `;

    wrapper.appendChild(this.bellElement);
    wrapper.appendChild(this.dropdownElement);

    // Event listeners
    this.bellElement.addEventListener('click', () => this.toggleDropdown());
    document.addEventListener('click', (e) => {
      if (!wrapper.contains(e.target)) {
        this.dropdownElement.classList.remove('open');
      }
    });

    this.dropdownElement.querySelector('[data-action="mark-all-read"]').addEventListener('click', () => {
      this.markAllRead();
    });

    // Store reference for external use
    this.bellWrapper = wrapper;
  }

  createSoundElement() {
    // Create audio element for notification sounds
    this.soundElement = document.createElement('audio');
    this.soundElement.id = 'rr-notification-sound';
    // Base64 encoded short "ding" sound
    this.soundElement.src = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYbq6zLBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/+1DEAAAGAAGn9AAAIwAANP8AAABMAAP+AAAD8PhQFBUXCoeHh4eHh8f//8f/x//H/8f/x//H/4eHh4eHh4eHh4eHh4eH//h4e//l////8v///8PDw8PDw8PDw8PDw8PDw8PDw8P/+1DEEwPAAAGkAAAAIAAANIAAAAT/w8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw//Dw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8P/+1DEKwPAAAGkAAAAIAAANIAAAATPDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8A==';
    document.body.appendChild(this.soundElement);
  }

  requestDesktopPermission() {
    if (this.options.enableDesktopNotifications && 'Notification' in window) {
      if (Notification.permission === 'default') {
        Notification.requestPermission();
      }
    }
  }

  // Mount the bell into an existing element
  mountBell(targetSelector) {
    const target = document.querySelector(targetSelector);
    if (target) {
      target.appendChild(this.bellWrapper);
    }
  }

  toggleDropdown() {
    this.dropdownElement.classList.toggle('open');
    if (this.dropdownElement.classList.contains('open')) {
      this.renderNotificationList();
    }
  }

  // Show a toast notification
  toast(options) {
    const {
      type = 'info',
      title,
      message,
      value,
      duration = this.options.toastDuration,
      onClick,
      data
    } = options;

    // Create toast element
    const toast = document.createElement('div');
    toast.className = `rr-toast ${type}`;
    toast.style.position = 'relative';

    const icon = this.getIcon(type);

    toast.innerHTML = `
      <div class="rr-toast-icon">${icon}</div>
      <div class="rr-toast-content">
        <div class="rr-toast-title">${this.escapeHtml(title)}</div>
        ${message ? `<div class="rr-toast-message">${this.escapeHtml(message)}</div>` : ''}
        ${value ? `<div class="rr-toast-value">${this.escapeHtml(value)}</div>` : ''}
      </div>
      <button class="rr-toast-close">
        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
        </svg>
      </button>
      <div class="rr-toast-progress" style="animation-duration: ${duration}ms;"></div>
    `;

    // Event listeners
    toast.querySelector('.rr-toast-close').addEventListener('click', (e) => {
      e.stopPropagation();
      this.removeToast(toast);
    });

    if (onClick) {
      toast.addEventListener('click', () => {
        onClick(data);
        this.removeToast(toast);
      });
    }

    // Add to container
    this.toastContainer.appendChild(toast);

    // Limit max toasts
    const toasts = this.toastContainer.querySelectorAll('.rr-toast');
    if (toasts.length > this.options.maxToasts) {
      this.removeToast(toasts[0]);
    }

    // Play sound for opportunities
    if (type === 'opportunity' && this.options.enableSound) {
      this.playSound();
    }

    // Show desktop notification
    if (type === 'opportunity' && this.options.enableDesktopNotifications) {
      this.showDesktopNotification(title, message);
    }

    // Auto remove
    setTimeout(() => {
      this.removeToast(toast);
    }, duration);

    return toast;
  }

  removeToast(toast) {
    if (!toast || toast.classList.contains('removing')) return;
    toast.classList.add('removing');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }

  getIcon(type) {
    const icons = {
      opportunity: `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
      </svg>`,
      success: `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
      </svg>`,
      warning: `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
      </svg>`,
      error: `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
      </svg>`,
      info: `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
      </svg>`
    };
    return icons[type] || icons.info;
  }

  playSound() {
    if (this.soundElement) {
      this.soundElement.currentTime = 0;
      this.soundElement.play().catch(() => {});
    }
  }

  showDesktopNotification(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, {
        body: body,
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        tag: 'revenue-radar',
        requireInteraction: false
      });
    }
  }

  // Add notification to history
  addNotification(notification) {
    const notif = {
      id: notification.id || Date.now(),
      type: notification.type || 'info',
      title: notification.title,
      message: notification.message,
      value: notification.value,
      data: notification.data,
      timestamp: notification.timestamp || new Date().toISOString(),
      read: false
    };

    this.notifications.unshift(notif);
    this.unreadCount++;
    this.updateBadge();

    // Show toast
    this.toast({
      type: notif.type,
      title: notif.title,
      message: notif.message,
      value: notif.value,
      data: notif.data,
      onClick: notification.onClick
    });

    // Save to localStorage for persistence
    this.saveNotifications();

    return notif;
  }

  updateBadge() {
    const badge = this.bellElement.querySelector('.rr-notification-badge');
    if (this.unreadCount > 0) {
      badge.textContent = this.unreadCount > 99 ? '99+' : this.unreadCount;
      badge.classList.remove('hidden');
      this.bellElement.classList.add('has-unread');
    } else {
      badge.classList.add('hidden');
      this.bellElement.classList.remove('has-unread');
    }
  }

  renderNotificationList() {
    const body = this.dropdownElement.querySelector('.rr-dropdown-body');

    if (this.notifications.length === 0) {
      body.innerHTML = `
        <div class="rr-notification-empty">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/>
          </svg>
          <p>No notifications yet</p>
        </div>
      `;
      return;
    }

    body.innerHTML = this.notifications.slice(0, 20).map(notif => `
      <div class="rr-notification-item ${notif.read ? '' : 'unread'}" data-id="${notif.id}" style="position: relative;">
        <div class="rr-notification-item-icon ${notif.type}">
          ${this.getIcon(notif.type)}
        </div>
        <div class="rr-notification-item-content">
          <div class="rr-notification-item-title">${this.escapeHtml(notif.title)}</div>
          ${notif.message ? `<div class="rr-notification-item-message">${this.escapeHtml(notif.message)}</div>` : ''}
          <div class="rr-notification-item-time">${this.formatTime(notif.timestamp)}</div>
        </div>
      </div>
    `).join('');

    // Add click handlers
    body.querySelectorAll('.rr-notification-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = parseInt(item.dataset.id);
        this.markAsRead(id);
        const notif = this.notifications.find(n => n.id === id);
        if (notif && notif.data && notif.data.url) {
          window.location.href = notif.data.url;
        }
      });
    });
  }

  markAsRead(id) {
    const notif = this.notifications.find(n => n.id === id);
    if (notif && !notif.read) {
      notif.read = true;
      this.unreadCount = Math.max(0, this.unreadCount - 1);
      this.updateBadge();
      this.saveNotifications();
    }
  }

  markAllRead() {
    this.notifications.forEach(n => n.read = true);
    this.unreadCount = 0;
    this.updateBadge();
    this.renderNotificationList();
    this.saveNotifications();
  }

  formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
    return date.toLocaleDateString();
  }

  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Persistence
  saveNotifications() {
    try {
      localStorage.setItem('rr_notifications', JSON.stringify({
        notifications: this.notifications.slice(0, 50),
        unreadCount: this.unreadCount
      }));
    } catch (e) {
      console.warn('Could not save notifications:', e);
    }
  }

  loadNotifications() {
    try {
      const saved = localStorage.getItem('rr_notifications');
      if (saved) {
        const data = JSON.parse(saved);
        this.notifications = data.notifications || [];
        this.unreadCount = data.unreadCount || 0;
        this.updateBadge();
      }
    } catch (e) {
      console.warn('Could not load notifications:', e);
    }
  }

  // Real-time updates
  startPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);

    this.pollTimer = setInterval(() => {
      this.fetchNewNotifications();
    }, this.options.pollInterval);
  }

  async fetchNewNotifications() {
    try {
      const authToken = localStorage.getItem('accessToken');
      if (!authToken) return;

      const response = await fetch('/api/notifications/unread', {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.notifications && data.notifications.length > 0) {
          data.notifications.forEach(notif => {
            if (!this.notifications.find(n => n.id === notif.id)) {
              this.addNotification(notif);
            }
          });
        }
      }
    } catch (error) {
      // Silent fail for polling
    }
  }

  connectRealtime() {
    // Try WebSocket first, fallback to SSE
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws/notifications`);

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'notification') {
            this.addNotification(data.notification);
          }
        } catch (e) {}
      };

      ws.onerror = () => {
        // Fallback to SSE
        this.connectSSE();
      };
    } catch (e) {
      this.connectSSE();
    }
  }

  connectSSE() {
    try {
      const authToken = localStorage.getItem('accessToken');
      if (!authToken) return;

      this.eventSource = new EventSource(`/api/notifications/stream?token=${authToken}`);

      this.eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.addNotification(data);
        } catch (e) {}
      };

      this.eventSource.onerror = () => {
        // Silent fail, polling will handle it
      };
    } catch (e) {
      // SSE not supported, rely on polling
    }
  }

  // Cleanup
  destroy() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.eventSource) this.eventSource.close();
    if (this.toastContainer) this.toastContainer.remove();
    if (this.bellWrapper) this.bellWrapper.remove();
    if (this.soundElement) this.soundElement.remove();
  }
}

// Helper function to format currency
function formatCurrency(cents) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(cents / 100);
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = NotificationSystem;
}

// Auto-initialize on pages that include this script
if (typeof window !== 'undefined') {
  window.NotificationSystem = NotificationSystem;

  // Auto-init when DOM is ready
  document.addEventListener('DOMContentLoaded', () => {
    // Create global instance
    window.notifications = new NotificationSystem();

    // Mount bell to header if exists
    const header = document.querySelector('.nav-right, .header-actions, [data-notification-target]');
    if (header) {
      window.notifications.mountBell(header.tagName.toLowerCase());
    }
  });
}

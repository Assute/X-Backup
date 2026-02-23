// Content Script - 作为 inject.js 和 background.js 之间的桥梁

(function() {
  'use strict';

  // 注入脚本到页面
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('inject.js');
  script.onload = function() { this.remove(); };

  const target = document.head || document.documentElement;
  if (target) {
    target.insertBefore(script, target.firstChild);
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      (document.head || document.documentElement).appendChild(script);
    });
  }

  // 监听来自 inject.js 的消息
  window.addEventListener('message', function(event) {
    if (event.source !== window) return;
    if (!event.data || event.data.source !== 'x-backup-inject') return;

    const { type, action, user, tweet } = event.data;

    // 转发消息给 background
    if (type === 'SYNC_FOLLOW' || type === 'SYNC_LIKE') {
      chrome.runtime.sendMessage({ type, action, user, tweet });
    }
  });

})();

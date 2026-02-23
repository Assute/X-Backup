// Inject script - 注入到页面中拦截请求
// 这个脚本运行在页面的主环境中

(function() {
  'use strict';

  // 防止重复注入
  if (window.__xBackupInjected) return;
  window.__xBackupInjected = true;

  // 发送消息给 content script
  function sendToContentScript(data) {
    window.postMessage({ source: 'x-backup-inject', ...data }, '*');
  }

  // ===== 拦截 fetch =====
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const [url, options] = args;
    const response = await originalFetch.apply(this, args);
    processRequest(url, options?.method, options?.body, response.clone());
    return response;
  };

  // ===== 拦截 XMLHttpRequest =====
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._xbackup_method = method;
    this._xbackup_url = url;
    return originalXHROpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function(body) {
    const xhr = this;
    const url = xhr._xbackup_url;
    const method = xhr._xbackup_method;

    xhr.addEventListener('load', function() {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const responseText = xhr.responseText;
          const responseData = JSON.parse(responseText);
          processXHRResponse(url, method, body, responseData);
        } catch (e) {
          // 忽略非 JSON 响应
        }
      }
    });

    return originalXHRSend.apply(this, arguments);
  };

  // 处理请求（fetch）
  async function processRequest(url, method, body, response) {
    if (typeof url !== 'string' || method !== 'POST') return;

    try {
      if (url.includes('FavoriteTweet')) {
        const data = await response.json();
        handleLikeAction(body, data);
      } else if (url.includes('UnfavoriteTweet')) {
        const data = await response.json();
        handleUnlikeAction(body, data);
      } else if (url.includes('friendships/create.json')) {
        // REST API 关注
        const data = await response.json();
        handleFollowAction(body, data);
      } else if (url.includes('friendships/destroy.json')) {
        // REST API 取消关注
        const data = await response.json();
        handleUnfollowAction(body, data);
      }
    } catch (e) {
      // 忽略错误
    }
  }

  // 处理 XHR 响应
  function processXHRResponse(url, method, body, data) {
    if (typeof url !== 'string' || method !== 'POST') return;

    try {
      if (url.includes('FavoriteTweet')) {
        handleLikeAction(body, data);
      } else if (url.includes('UnfavoriteTweet')) {
        handleUnlikeAction(body, data);
      } else if (url.includes('friendships/create.json')) {
        handleFollowAction(body, data);
      } else if (url.includes('friendships/destroy.json')) {
        handleUnfollowAction(body, data);
      }
    } catch (e) {
      // 忽略错误
    }
  }

  // 处理关注操作
  function handleFollowAction(body, data) {
    try {
      // REST API 返回格式: { id, id_str, screen_name, name, ... }
      // GraphQL 返回格式: { data: { user: { result: { rest_id, legacy: { screen_name, name } } } } }
      let userId, username, name, avatar;

      if (data.id_str || data.id) {
        // REST API 格式
        userId = data.id_str || String(data.id);
        username = data.screen_name;
        name = data.name;
        avatar = data.profile_image_url_https;
      } else if (data.data?.user?.result) {
        // GraphQL 格式
        const result = data.data.user.result;
        userId = result.rest_id;
        username = result.legacy?.screen_name;
        name = result.legacy?.name;
        avatar = result.legacy?.profile_image_url_https;
      }

      if (userId && username) {
        console.log('[X Backup] 关注:', username);
        sendToContentScript({
          type: 'SYNC_FOLLOW',
          action: 'add',
          user: { id: userId, username, name, avatar }
        });
      }
    } catch (e) {}
  }

  // 处理取消关注操作
  function handleUnfollowAction(body, data) {
    try {
      let userId, username;

      if (data.id_str || data.id) {
        userId = data.id_str || String(data.id);
        username = data.screen_name;
      } else if (data.data?.user?.result) {
        const result = data.data.user.result;
        userId = result.rest_id;
        username = result.legacy?.screen_name;
      }

      if (userId && username) {
        console.log('[X Backup] 取消关注:', username);
        sendToContentScript({
          type: 'SYNC_FOLLOW',
          action: 'remove',
          user: { id: userId, username }
        });
      }
    } catch (e) {}
  }

  // 处理点赞操作
  function handleLikeAction(body, data) {
    try {
      let tweetId = null;
      if (body) {
        try {
          const bodyObj = typeof body === 'string' ? JSON.parse(body) : body;
          tweetId = bodyObj.variables?.tweet_id || bodyObj.id;
        } catch (e) {}
      }

      if (data.data?.favorite_tweet || tweetId) {
        console.log('[X Backup] 点赞:', tweetId);

        sendToContentScript({
          type: 'SYNC_LIKE',
          action: 'add',
          tweet: { id: tweetId }
        });
      }
    } catch (e) {}
  }

  // 处理取消点赞操作
  function handleUnlikeAction(body, data) {
    try {
      let tweetId = null;
      if (body) {
        try {
          const bodyObj = typeof body === 'string' ? JSON.parse(body) : body;
          tweetId = bodyObj.variables?.tweet_id || bodyObj.id;
        } catch (e) {}
      }

      if (data.data?.unfavorite_tweet || tweetId) {
        console.log('[X Backup] 取消点赞:', tweetId);

        sendToContentScript({
          type: 'SYNC_LIKE',
          action: 'remove',
          tweet: { id: tweetId }
        });
      }
    } catch (e) {}
  }

})();

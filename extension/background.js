// Background service worker

const API_BASE = 'http://localhost:5500/api';

chrome.runtime.onInstalled.addListener(() => {
  console.log('[X Backup] 插件已安装');
});

// 监听来自popup和content script的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_COOKIES') {
    getCookies().then(sendResponse);
    return true;
  }

  if (message.type === 'SYNC_FOLLOW') {
    handleSyncFollow(message.action, message.user);
    sendResponse({ received: true });
    return false;
  }

  if (message.type === 'SYNC_LIKE') {
    handleSyncLike(message.action, message.tweet);
    sendResponse({ received: true });
    return false;
  }
});

// 获取X网站的cookies
async function getCookies() {
  try {
    const cookies = await chrome.cookies.getAll({ domain: '.x.com' });
    return { success: true, cookies };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// 从 cookies 获取当前登录的 X 账号 ID
async function getCurrentXUserIdFromCookies() {
  try {
    const cookies = await chrome.cookies.getAll({ domain: '.x.com' });
    const twidCookie = cookies.find(c => c.name === 'twid');
    if (twidCookie) {
      const decoded = decodeURIComponent(twidCookie.value);
      const match = decoded.match(/u=(\d+)/);
      if (match) return match[1];
    }
    return null;
  } catch (e) {
    return null;
  }
}

// 获取存储的认证信息和当前 X 账号
async function getAuthInfo() {
  return new Promise(async (resolve) => {
    chrome.storage.local.get(['token', 'xAccounts'], async (result) => {
      const token = result.token;
      const xAccounts = result.xAccounts || [];
      const currentXUserId = await getCurrentXUserIdFromCookies();

      // 调试：显示匹配信息
      console.log('[X Backup] Cookie 中的用户ID:', currentXUserId);
      console.log('[X Backup] 已保存的账号:', xAccounts.map(a => `${a.username}(${a.xUserId})`).join(', '));

      let currentXAccountId = null;
      if (currentXUserId && xAccounts.length > 0) {
        const matchedAccount = xAccounts.find(acc => acc.xUserId === currentXUserId);
        if (matchedAccount) {
          currentXAccountId = matchedAccount.id;
          console.log('[X Backup] 匹配到账号:', matchedAccount.username);
        } else {
          console.log('[X Backup] 未匹配到账号，请打开插件刷新账号列表');
        }
      }

      resolve({ token, currentXAccountId });
    });
  });
}

// 处理关注同步
async function handleSyncFollow(action, user) {
  try {
    const { token, currentXAccountId } = await getAuthInfo();
    if (!token || !currentXAccountId) return;

    const response = await fetch(`${API_BASE}/sync/following`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ xAccountId: currentXAccountId, action, user })
    });

    const result = await response.json();
    if (!result.success) {
      console.error('[X Backup] 关注同步失败:', result.error);
    }
  } catch (e) {
    console.error('[X Backup] 关注同步错误:', e);
  }
}

// 处理点赞同步
async function handleSyncLike(action, tweet) {
  try {
    const { token, currentXAccountId } = await getAuthInfo();
    if (!token || !currentXAccountId) return;

    const response = await fetch(`${API_BASE}/sync/likes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ xAccountId: currentXAccountId, action, tweet })
    });

    const result = await response.json();
    if (!result.success) {
      console.error('[X Backup] 点赞同步失败:', result.error);
    }
  } catch (e) {
    console.error('[X Backup] 点赞同步错误:', e);
  }
}

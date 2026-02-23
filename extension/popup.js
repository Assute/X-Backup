// 配置
let API_BASE = '';

// X API 配置
const X_BEARER_TOKEN = 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

// 状态
let token = null;
let currentUser = null;
let accounts = [];

// DOM 元素
const $ = id => document.getElementById(id);

// 获取保存的服务器URL
function getServerUrl() {
  return localStorage.getItem('serverUrl') || '';
}

// 保存服务器URL
function saveServerUrl(url) {
  // 去掉末尾的斜杠
  url = url.replace(/\/+$/, '');
  localStorage.setItem('serverUrl', url);
  // 同步到 chrome.storage.local 供 background.js 使用
  chrome.storage.local.set({ serverUrl: url });
  API_BASE = url + '/api';
  return url;
}

// 从cookie字符串解析 ct0 (csrf token)
function parseCt0FromCookie(cookieStr) {
  const match = cookieStr.match(/ct0=([^;]+)/);
  return match ? match[1] : '';
}

// 从cookie获取用户ID
function parseUserIdFromCookie(cookieStr) {
  const match = cookieStr.match(/twid=u%3D(\d+)/);
  return match ? match[1] : null;
}

// 直接调用X API获取用户信息（在浏览器中调用，绕过Cloudflare）
async function fetchXUserInfo(cookieStr, userId) {
  const ct0 = parseCt0FromCookie(cookieStr);

  const headers = {
    'accept': '*/*',
    'accept-language': 'zh-CN,zh;q=0.9',
    'authorization': X_BEARER_TOKEN,
    'content-type': 'application/json',
    'x-csrf-token': ct0,
    'x-twitter-active-user': 'yes',
    'x-twitter-auth-type': 'OAuth2Session',
    'x-twitter-client-language': 'zh-cn'
  };

  const variables = {
    userId: userId,
    withSafetyModeUserFields: true
  };

  const features = {
    hidden_profile_subscriptions_enabled: true,
    rweb_tipjar_consumption_enabled: true,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    highlights_tweets_tab_ui_enabled: true,
    responsive_web_twitter_article_notes_tab_enabled: true,
    subscriptions_feature_can_gift_premium: true,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    responsive_web_graphql_timeline_navigation_enabled: true
  };

  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(features)
  });

  const url = `https://x.com/i/api/graphql/Lxg1V9AiIzzXEiP2c8dRnw/UserByRestId?${params}`;

  const response = await fetch(url, {
    method: 'GET',
    headers,
    credentials: 'include'
  });

  const data = await response.json();

  if (data.errors) {
    throw new Error(data.errors[0]?.message || '获取用户信息失败');
  }

  const user = data?.data?.user?.result;
  if (!user) {
    throw new Error('用户不存在');
  }

  const legacy = user.legacy || {};
  return {
    id: user.rest_id || userId,
    username: legacy.screen_name || user.screen_name,
    name: legacy.name || user.name,
    followingCount: legacy.friends_count || 0,
    followersCount: legacy.followers_count || 0
  };
}

// 获取关注列表的features配置
const xFeatures = {
  "rweb_video_screen_enabled": false,
  "profile_label_improvements_pcf_label_in_post_enabled": true,
  "responsive_web_graphql_timeline_navigation_enabled": true,
  "responsive_web_graphql_skip_user_profile_image_extensions_enabled": false,
  "creator_subscriptions_tweet_preview_api_enabled": true,
  "c9s_tweet_anatomy_moderator_badge_enabled": true,
  "responsive_web_grok_analyze_post_followups_enabled": true,
  "responsive_web_edit_tweet_api_enabled": true,
  "graphql_is_translatable_rweb_tweet_is_translatable_enabled": true,
  "view_counts_everywhere_api_enabled": true,
  "longform_notetweets_consumption_enabled": true,
  "responsive_web_twitter_article_tweet_consumption_enabled": true,
  "freedom_of_speech_not_reach_fetch_enabled": true,
  "standardized_nudges_misinfo": true,
  "tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled": true,
  "longform_notetweets_rich_text_read_enabled": true,
  "longform_notetweets_inline_media_enabled": true,
  "responsive_web_enhance_cards_enabled": false
};

// 获取关注列表
async function fetchFollowing(cookieStr, userId, cursor = null) {
  const ct0 = parseCt0FromCookie(cookieStr);
  const headers = {
    'accept': '*/*',
    'authorization': X_BEARER_TOKEN,
    'content-type': 'application/json',
    'x-csrf-token': ct0,
    'x-twitter-active-user': 'yes',
    'x-twitter-auth-type': 'OAuth2Session'
  };

  const variables = {
    userId: userId,
    count: 20,
    includePromotedContent: false
  };
  if (cursor) variables.cursor = cursor;

  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(xFeatures)
  });

  const url = `https://x.com/i/api/graphql/M3LO-sJg6BCWdEliN_C2fQ/Following?${params}`;
  const response = await fetch(url, { method: 'GET', headers, credentials: 'include' });
  return response.json();
}

// 获取点赞列表
async function fetchLikes(cookieStr, userId, cursor = null) {
  const ct0 = parseCt0FromCookie(cookieStr);
  const headers = {
    'accept': '*/*',
    'authorization': X_BEARER_TOKEN,
    'content-type': 'application/json',
    'x-csrf-token': ct0,
    'x-twitter-active-user': 'yes',
    'x-twitter-auth-type': 'OAuth2Session'
  };

  const variables = {
    userId: userId,
    count: 20,
    includePromotedContent: false,
    withClientEventToken: false,
    withBirdwatchNotes: false,
    withVoice: true
  };
  if (cursor) variables.cursor = cursor;

  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(xFeatures),
    fieldToggles: JSON.stringify({ withArticlePlainText: false })
  });

  const url = `https://x.com/i/api/graphql/JPxbOQGc_tXQ0Y29mvHKSw/Likes?${params}`;
  const response = await fetch(url, { method: 'GET', headers, credentials: 'include' });
  return response.json();
}

// 解析关注列表
function parseFollowingData(data) {
  const users = [];
  let nextCursor = null;

  try {
    const entries = data?.data?.user?.result?.timeline?.timeline?.instructions
      ?.find(i => i.type === 'TimelineAddEntries')?.entries || [];

    for (const entry of entries) {
      if (entry.content?.itemContent?.user_results?.result) {
        const user = entry.content.itemContent.user_results.result;
        const legacy = user.legacy || {};

        // 尝试多个可能的路径获取 screen_name (X API 结构变化，现在在 core 里)
        const screenName = user.core?.screen_name || legacy.screen_name || user.screen_name;
        const name = user.core?.name || legacy.name || user.name;
        users.push({
          id: user.rest_id,
          username: screenName,
          name: name
        });
      }
      if (entry.content?.cursorType === 'Bottom') {
        nextCursor = entry.content.value;
      }
    }
  } catch (e) {
    console.error('解析关注列表错误:', e.message);
  }

  return { users, nextCursor };
}

// 解析点赞列表
function parseLikesData(data) {
  const tweets = [];
  let nextCursor = null;

  try {
    const entries = data?.data?.user?.result?.timeline_v2?.timeline?.instructions
      ?.find(i => i.type === 'TimelineAddEntries')?.entries
      || data?.data?.user?.result?.timeline?.timeline?.instructions
      ?.find(i => i.type === 'TimelineAddEntries')?.entries
      || [];

    for (const entry of entries) {
      const tweetResult = entry.content?.itemContent?.tweet_results?.result;
      if (tweetResult) {
        const tweet = tweetResult.__typename === 'TweetWithVisibilityResults'
          ? tweetResult.tweet
          : tweetResult;
        const legacy = tweet?.legacy;
        const userResults = tweet?.core?.user_results?.result;
        const userLegacy = userResults?.legacy;

        // 尝试多个可能的路径获取 screen_name (X API 结构变化，现在在 core 里)
        const screenName = userResults?.core?.screen_name || userLegacy?.screen_name || userResults?.screen_name;
        if (legacy) {
          tweets.push({
            id: legacy.id_str,
            username: screenName,
            name: legacy.full_text?.substring(0, 50)
          });
        }
      }
      if (entry.content?.cursorType === 'Bottom') {
        nextCursor = entry.content.value;
      }
    }
  } catch (e) {
    console.error('解析点赞列表错误:', e.message);
  }

  return { tweets, nextCursor };
}

// 获取所有关注
async function fetchAllFollowing(cookieStr, userId, onProgress) {
  const allUsers = [];
  let cursor = null;
  let page = 1;

  while (true) {
    if (onProgress) onProgress(`获取关注第 ${page} 页...`);
    const data = await fetchFollowing(cookieStr, userId, cursor);

    if (data.errors) {
      throw new Error(data.errors[0]?.message || '获取关注失败');
    }

    const { users, nextCursor } = parseFollowingData(data);
    if (users.length === 0) break;

    allUsers.push(...users);
    if (users.length < 20 || !nextCursor) break;

    cursor = nextCursor;
    page++;
    await new Promise(r => setTimeout(r, 500));
  }

  return allUsers;
}

// 获取所有点赞
async function fetchAllLikes(cookieStr, userId, onProgress, maxPages = 50) {
  const allTweets = [];
  let cursor = null;
  let page = 1;

  while (page <= maxPages) {
    if (onProgress) onProgress(`获取点赞第 ${page} 页...`);
    const data = await fetchLikes(cookieStr, userId, cursor);

    if (data.errors) {
      throw new Error(data.errors[0]?.message || '获取点赞失败');
    }

    const { tweets, nextCursor } = parseLikesData(data);
    if (tweets.length === 0) break;

    allTweets.push(...tweets);
    if (tweets.length < 20 || !nextCursor) break;

    cursor = nextCursor;
    page++;
    await new Promise(r => setTimeout(r, 500));
  }

  return allTweets;
}

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
  // 加载服务器URL
  const savedUrl = getServerUrl();

  if (savedUrl) {
    $('server-url').value = savedUrl;
    $('modal-server-url').value = savedUrl;
    API_BASE = savedUrl + '/api';

    // 已配置URL，显示登录界面
    $('url-section').classList.add('hidden');
    $('auth-section').classList.remove('hidden');

    // 从存储加载token
    const stored = await chrome.storage.local.get(['token', 'user']);
    if (stored.token && stored.user) {
      token = stored.token;
      currentUser = stored.user;
      showMainSection();
      loadAccounts();
      loadTasks();
    }
  } else {
    // 未配置URL，显示URL配置界面
    $('url-section').classList.remove('hidden');
    $('auth-section').classList.add('hidden');
  }

  bindEvents();
});

// 绑定事件
function bindEvents() {
  // 服务器URL保存（首次配置）
  $('save-url-btn').onclick = async () => {
    const url = $('server-url').value.trim();
    if (!url) {
      $('url-error-msg').textContent = '请输入服务器地址';
      return;
    }
    $('url-error-msg').textContent = '';

    // 尝试连接服务器
    showLoading();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      saveServerUrl(url);
      $('modal-server-url').value = url;
      showToast('服务器连接成功');

      // 切换到登录界面
      $('url-section').classList.add('hidden');
      $('auth-section').classList.remove('hidden');
      checkServerStatus();
    } catch (e) {
      $('url-error-msg').textContent = '无法连接到服务器，请检查地址是否正确';
    }
    hideLoading();
  };

  // 头部设置按钮
  $('header-settings-btn').onclick = () => {
    $('modal-server-url').value = getServerUrl();
    $('url-modal').classList.remove('hidden');
  };

  // 弹窗中保存URL
  $('modal-save-url-btn').onclick = async () => {
    const url = $('modal-server-url').value.trim();
    if (!url) {
      showToast('请输入服务器地址');
      return;
    }

    showLoading();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      saveServerUrl(url);
      $('server-url').value = url;
      $('url-modal').classList.add('hidden');
      showToast('服务器地址已保存');
      checkServerStatus();
    } catch (e) {
      showToast('无法连接到服务器');
    }
    hideLoading();
  };

  // 登录注册
  $('login-btn').onclick = login;
  $('register-btn').onclick = register;
  $('logout-btn').onclick = logout;

  // 标签页切换
  document.querySelectorAll('.tab').forEach(tab => {
    tab.onclick = () => switchTab(tab.dataset.tab);
  });

  // 获取当前账号
  $('capture-btn').onclick = captureCurrentAccount;

  // 创建任务
  $('create-task-btn').onclick = showTaskModal;
  $('confirm-task-btn').onclick = createTask;

  // 设置
  $('settings-btn').onclick = showSettingsModal;
  $('save-settings-btn').onclick = saveSettings;

  // 账号管理
  $('account-settings-btn').onclick = showAccountSettingsModal;
  $('save-account-btn').onclick = saveAccountSettings;

  // 关闭弹窗
  document.querySelectorAll('.close-btn').forEach(btn => {
    btn.onclick = () => btn.closest('.modal').classList.add('hidden');
  });

  // 确认弹窗按钮
  $('confirm-ok-btn').onclick = () => {
    const callback = confirmCallback;
    hideConfirm();
    if (callback) callback();
  };
  $('confirm-cancel-btn').onclick = hideConfirm;

  // 回车登录
  $('password').onkeypress = e => {
    if (e.key === 'Enter') login();
  };

  // 加载保存的设置
  loadSettings();

  // 检查服务器状态
  checkServerStatus();
}

// 检查服务器状态
async function checkServerStatus() {
  const statusDot = document.querySelector('.status-dot');
  const statusText = document.querySelector('.status-text');

  if (!API_BASE) {
    statusDot.classList.remove('online');
    statusDot.classList.add('offline');
    statusText.textContent = '未配置';
    return;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    await fetch(API_BASE.replace('/api', ''), { signal: controller.signal });
    clearTimeout(timeoutId);

    statusDot.classList.remove('offline');
    statusDot.classList.add('online');
    statusText.textContent = '在线';
  } catch (e) {
    statusDot.classList.remove('online');
    statusDot.classList.add('offline');
    statusText.textContent = '离线';
  }
}

// API 请求
async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  };

  try {
    const res = await fetch(API_BASE + path, {
      ...options,
      headers: { ...headers, ...options.headers }
    });
    return await res.json();
  } catch (e) {
    return { success: false, error: '网络错误，请检查服务器是否运行' };
  }
}

// 显示/隐藏加载
function showLoading() { $('loading').classList.remove('hidden'); }
function hideLoading() { $('loading').classList.add('hidden'); }

// 显示错误
function showError(msg) {
  $('error-msg').textContent = msg;
  setTimeout(() => $('error-msg').textContent = '', 3000);
}

// 显示提示（小提示）
function showToast(msg) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}

// 自定义确认弹窗
let confirmCallback = null;

function showConfirm(message, onConfirm) {
  $('confirm-message').textContent = message;
  confirmCallback = onConfirm;
  $('confirm-modal').classList.remove('hidden');
}

function hideConfirm() {
  $('confirm-modal').classList.add('hidden');
  confirmCallback = null;
}

// 切换到主界面
function showMainSection() {
  $('url-section').classList.add('hidden');
  $('auth-section').classList.add('hidden');
  $('main-section').classList.remove('hidden');
  $('header-user').classList.remove('hidden');
  $('header-settings-btn').classList.add('hidden');
  $('current-user').textContent = currentUser.username;
}

// 登录
async function login() {
  const username = $('username').value.trim();
  const password = $('password').value;

  if (!username || !password) {
    return showError('请输入用户名和密码');
  }

  showLoading();
  const res = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });
  hideLoading();

  if (res.success) {
    token = res.token;
    currentUser = res.user;
    await chrome.storage.local.set({ token, user: currentUser });
    showMainSection();
    loadAccounts();
    loadTasks();
  } else {
    showError(res.error);
  }
}

// 注册
async function register() {
  const username = $('username').value.trim();
  const password = $('password').value;

  if (!username || !password) {
    return showError('请输入用户名和密码');
  }

  if (password.length < 6) {
    return showError('密码至少6位');
  }

  showLoading();
  const res = await api('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });
  hideLoading();

  if (res.success) {
    token = res.token;
    currentUser = res.user;
    await chrome.storage.local.set({ token, user: currentUser });
    showMainSection();
    loadAccounts();
    loadTasks();
  } else {
    showError(res.error);
  }
}

// 退出
async function logout() {
  token = null;
  currentUser = null;
  await chrome.storage.local.remove(['token', 'user', 'currentXAccountId']);
  $('main-section').classList.add('hidden');
  $('header-user').classList.add('hidden');
  $('header-settings-btn').classList.remove('hidden');
  $('auth-section').classList.remove('hidden');
  $('username').value = '';
  $('password').value = '';
}

// 切换标签页
function switchTab(tabName) {
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-content').forEach(c => {
    c.classList.toggle('active', c.id === tabName + '-tab');
  });

  if (tabName === 'tasks') {
    loadTasks();
  }
}

// 获取当前X账号的cookie
async function captureCurrentAccount() {
  showLoading();

  try {
    // 获取x.com的cookies
    const cookies = await chrome.cookies.getAll({ domain: '.x.com' });
    console.log('获取到cookies数量:', cookies.length);

    if (cookies.length === 0) {
      // 尝试不带点的域名
      const cookies2 = await chrome.cookies.getAll({ domain: 'x.com' });
      console.log('尝试x.com域名, cookies数量:', cookies2.length);

      if (cookies2.length === 0) {
        hideLoading();
        return showError('请先登录X网站');
      }
      cookies.push(...cookies2);
    }

    // 组装cookie字符串
    const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    console.log('cookie包含auth_token:', cookieStr.includes('auth_token'));
    console.log('cookie包含ct0:', cookieStr.includes('ct0'));

    // 检查是否有必要的cookie
    if (!cookieStr.includes('auth_token') || !cookieStr.includes('ct0')) {
      hideLoading();
      return showError('请先登录X网站');
    }

    // 解析用户ID
    const xUserId = parseUserIdFromCookie(cookieStr);
    console.log('解析到xUserId:', xUserId);
    if (!xUserId) {
      hideLoading();
      return showError('无法从cookie解析用户ID');
    }

    // 直接在浏览器中调用X API获取用户信息
    let userInfo;
    try {
      console.log('正在从X API获取用户信息...');
      userInfo = await fetchXUserInfo(cookieStr, xUserId);
      console.log('获取到用户信息:', userInfo);
    } catch (e) {
      hideLoading();
      return showError('获取X用户信息失败: ' + e.message);
    }

    // 发送用户信息和cookie到服务器
    const res = await api('/accounts', {
      method: 'POST',
      body: JSON.stringify({
        cookie: cookieStr,
        xUserId: userInfo.id,
        xUsername: userInfo.username,
        xName: userInfo.name,
        followingCount: userInfo.followingCount,
        followersCount: userInfo.followersCount
      })
    });

    if (res.success) {
      const accountId = res.account.id;

      // 保存当前X账号ID用于自动同步
      await chrome.storage.local.set({ currentXAccountId: accountId });

      hideLoading();
      loadAccounts();

      // 自动开始同步数据（使用浏览器端获取）
      setTimeout(() => syncAccountById(accountId, cookieStr, userInfo.id), 500);
    } else {
      hideLoading();
      showError(res.error);
    }

  } catch (e) {
    hideLoading();
    showError('获取cookie失败: ' + e.message);
  }
}

// 加载账号列表
async function loadAccounts() {
  const res = await api('/accounts');

  if (!res.success) {
    $('accounts-list').innerHTML = '<div class="empty">加载失败</div>';
    return;
  }

  accounts = res.accounts;

  // 保存账号列表到 chrome.storage，用于自动同步时匹配当前登录的 X 账号
  const xAccounts = accounts.map(acc => ({
    id: acc._id,
    xUserId: acc.xUserId,
    username: acc.xUsername
  }));
  await chrome.storage.local.set({ xAccounts });

  if (accounts.length === 0) {
    $('accounts-list').innerHTML = '<div class="empty">暂无账号，点击上方按钮添加</div>';
    return;
  }

  $('accounts-list').innerHTML = accounts.map(acc => `
    <div class="list-item" data-id="${acc._id}">
      <div class="list-item-header">
        <span class="list-item-title">@${acc.xUsername}</span>
        <span class="list-item-subtitle">${acc.xName || ''}</span>
      </div>
      <div class="list-item-stats">
        <span>关注: ${acc.followingCount}</span>
        <span>点赞: ${acc.likesCount}</span>
      </div>
      <div class="list-item-subtitle">
        ${acc.lastSyncAt ? '上次同步: ' + formatTime(acc.lastSyncAt) : '未同步'}
      </div>
      <div class="list-item-actions">
        <button class="btn primary sync-btn" data-id="${acc._id}">同步数据</button>
        <button class="btn view-btn" data-id="${acc._id}">查看备份</button>
        <button class="btn danger delete-btn" data-id="${acc._id}">删除</button>
      </div>
    </div>
  `).join('');

  // 绑定按钮事件
  document.querySelectorAll('.sync-btn').forEach(btn => {
    btn.onclick = () => syncAccount(btn.dataset.id);
  });
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.onclick = () => viewBackup(btn.dataset.id);
  });
  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.onclick = () => deleteAccount(btn.dataset.id);
  });
}

// 轮询同步状态
function pollSyncStatus(accountId, maxTries = 20) {
  let tries = 0;
  const interval = setInterval(async () => {
    tries++;
    const res = await api(`/accounts/${accountId}/sync-status`);

    if (res.success && res.account.lastSyncAt) {
      clearInterval(interval);
      showToast('同步完成');
      loadAccounts();
    } else if (tries >= maxTries) {
      clearInterval(interval);
    }
  }, 1000); // 每1秒检查一次
}

// 同步账号数据（在浏览器端获取数据）
async function syncAccount(id) {
  // 找到账号
  const acc = accounts.find(a => a._id === id);
  if (!acc) {
    return showError('账号不存在');
  }

  // 获取cookie
  const cookies = await chrome.cookies.getAll({ domain: '.x.com' });
  if (cookies.length === 0) {
    return showError('请先登录X网站');
  }
  const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');

  // 验证cookie中的用户ID与账号匹配
  const xUserId = parseUserIdFromCookie(cookieStr);
  if (xUserId !== acc.xUserId) {
    return showError('当前登录的X账号与选择的账号不匹配');
  }

  await syncAccountById(id, cookieStr, acc.xUserId);
}

// 根据ID同步账号数据（带cookie和userId参数）
async function syncAccountById(id, cookieStr, xUserId) {
  showLoading();
  showToast('正在同步数据...');

  try {
    // 从浏览器获取关注和点赞数据
    const following = await fetchAllFollowing(cookieStr, xUserId, (msg) => {
      console.log(msg);
    });
    console.log('获取到关注数量:', following.length);

    const likes = await fetchAllLikes(cookieStr, xUserId, (msg) => {
      console.log(msg);
    });
    console.log('获取到点赞数量:', likes.length);

    // 发送数据到服务器保存
    const res = await api(`/accounts/${id}/sync-data`, {
      method: 'POST',
      body: JSON.stringify({ following, likes })
    });

    hideLoading();

    if (res.success) {
      showToast('同步完成');
      loadAccounts();
    } else {
      showError(res.error);
    }
  } catch (e) {
    hideLoading();
    showError('同步失败: ' + e.message);
  }
}

// 查看备份
async function viewBackup(id) {
  showLoading();
  const res = await api(`/accounts/${id}/backup`);
  hideLoading();

  if (!res.success) {
    return showError(res.error);
  }

  const acc = accounts.find(a => a._id === id);
  $('modal-title').textContent = `@${acc?.xUsername || '未知'} 的备份`;

  const { following, likes } = res.backup;

  $('modal-body').innerHTML = `
    <div class="backup-section">
      <h4>关注列表 (${following.length})</h4>
      <div class="backup-list">
        ${following.length ? following.map(u => `
          <div class="backup-item">@${u.username} - ${u.name || ''}</div>
        `).join('') : '<div class="empty">暂无数据</div>'}
      </div>
    </div>
    <div class="backup-section">
      <h4>点赞列表 (${likes.length})</h4>
      <div class="backup-list">
        ${likes.length ? likes.map(t => `
          <div class="backup-item">@${t.username}: ${t.name || ''}</div>
        `).join('') : '<div class="empty">暂无数据</div>'}
      </div>
    </div>
  `;

  $('account-modal').classList.remove('hidden');
}

// 删除账号
async function deleteAccount(id) {
  showConfirm('确定要删除此账号吗？备份数据也会被删除。', async () => {
    showLoading();
    const res = await api(`/accounts/${id}`, { method: 'DELETE' });
    hideLoading();

    if (res.success) {
      loadAccounts();
    } else {
      showError(res.error);
    }
  });
}

// 显示创建任务弹窗
function showTaskModal() {
  if (accounts.length < 2) {
    return showError('需要至少2个账号才能创建转移任务');
  }

  const options = '<option value="">请选择账号</option>' + accounts.map(acc =>
    `<option value="${acc._id}">@${acc.xUsername}</option>`
  ).join('');

  $('source-account').innerHTML = options;
  $('target-account').innerHTML = options;

  $('task-modal').classList.remove('hidden');
}

// 创建任务
async function createTask() {
  const sourceAccountId = $('source-account').value;
  const targetAccountId = $('target-account').value;

  if (!sourceAccountId || !targetAccountId) {
    return alert('请选择源账号和目标账号');
  }

  if (sourceAccountId === targetAccountId) {
    return alert('源账号和目标账号不能相同');
  }

  // 获取当前设置的限制参数
  const settings = getSettings();

  showLoading();
  const res = await api('/transfer', {
    method: 'POST',
    body: JSON.stringify({
      sourceAccountId,
      targetAccountId,
      rateLimit: {
        intervalMinutes: settings.interval,
        followsPerHour: settings.followPerHour,
        likesPerHour: settings.likePerHour,
        followsPerDay: settings.followPerDay,
        likesPerDay: settings.likePerDay
      }
    })
  });
  hideLoading();

  if (res.success) {
    $('task-modal').classList.add('hidden');
    switchTab('tasks');
    loadTasks();
  } else {
    alert(res.error);
  }
}

// 加载任务列表
async function loadTasks() {
  const res = await api('/transfer');

  if (!res.success) {
    $('tasks-list').innerHTML = '<div class="empty">加载失败</div>';
    return;
  }

  if (res.tasks.length === 0) {
    $('tasks-list').innerHTML = '<div class="empty">暂无任务</div>';
    return;
  }

  $('tasks-list').innerHTML = res.tasks.map(task => `
    <div class="list-item" data-id="${task.id}">
      <div class="list-item-header">
        <span class="list-item-title">${task.sourceAccount} → ${task.targetAccount}</span>
        <span class="status ${task.status}">${statusText(task.status)}</span>
      </div>
      <div class="list-item-stats">
        <span>待关注: ${task.pendingFollows || 0}</span>
        <span>待点赞: ${task.pendingLikes || 0}</span>
      </div>
      <div class="list-item-actions">
        ${task.status === 'running' ?
          `<button class="btn pause-task-btn" data-id="${task.id}">暂停</button>` :
          task.status !== 'completed' ?
          `<button class="btn success start-task-btn" data-id="${task.id}">启动</button>` : ''
        }
        <button class="btn detail-task-btn" data-id="${task.id}">详情</button>
        <button class="btn danger delete-task-btn" data-id="${task.id}">删除</button>
      </div>
    </div>
  `).join('');

  // 绑定事件
  document.querySelectorAll('.start-task-btn').forEach(btn => {
    btn.onclick = () => startTask(btn.dataset.id);
  });
  document.querySelectorAll('.pause-task-btn').forEach(btn => {
    btn.onclick = () => pauseTask(btn.dataset.id);
  });
  document.querySelectorAll('.detail-task-btn').forEach(btn => {
    btn.onclick = () => viewTaskDetail(btn.dataset.id);
  });
  document.querySelectorAll('.delete-task-btn').forEach(btn => {
    btn.onclick = () => deleteTask(btn.dataset.id);
  });
}

// 启动任务
async function startTask(id) {
  showLoading();
  const res = await api(`/transfer/${id}/start`, { method: 'POST' });
  hideLoading();

  if (res.success) {
    loadTasks();
  } else {
    showError(res.error);
  }
}

// 暂停任务
async function pauseTask(id) {
  showLoading();
  const res = await api(`/transfer/${id}/pause`, { method: 'POST' });
  hideLoading();

  if (res.success) {
    loadTasks();
  } else {
    showError(res.error);
  }
}

// 查看任务详情
async function viewTaskDetail(id) {
  showLoading();
  const res = await api(`/transfer/${id}`);
  hideLoading();

  if (!res.success) {
    return showError(res.error);
  }

  const task = res.task;
  const total = task.pendingFollows + task.completedFollows + task.pendingLikes + task.completedLikes;
  const completed = task.completedFollows + task.completedLikes;
  const progress = total > 0 ? Math.round(completed / total * 100) : 0;

  // 计算预估时间
  const estimateTime = calculateEstimateTime(task);

  // 获取限流配置
  const config = task.rateLimitConfig || {};
  const followLimit = `${config.followsPerHour || 5}/h, ${config.followsPerDay || 20}/d`;
  const likeLimit = `${config.likesPerHour || 10}/h, ${config.likesPerDay || 30}/d`;

  $('task-detail-body').innerHTML = `
    <div class="list-item">
      <div class="list-item-header">
        <span>${task.sourceAccount} → ${task.targetAccount}</span>
        <span class="status ${task.status}">${statusText(task.status)}</span>
      </div>
      <div class="progress-bar">
        <div class="fill" style="width: ${progress}%"></div>
      </div>
      <div class="list-item-stats">
        <span>已关注: ${task.completedFollows}/${task.completedFollows + task.pendingFollows}</span>
        <span>已点赞: ${task.completedLikes}/${task.completedLikes + task.pendingLikes}</span>
      </div>
      <div class="list-item-subtitle">
        限制: 关注 ${followLimit} | 点赞 ${likeLimit}
      </div>
      <div class="list-item-subtitle" style="color: #1da1f2; margin-top: 4px;">
        ${estimateTime}
      </div>
    </div>
    <h4 style="margin: 12px 0 8px">日志</h4>
    <div class="logs">
      ${task.logs.map(log => `
        <div class="log-item">
          <span class="log-time">[${formatTime(log.time)}]</span> ${log.msg}
        </div>
      `).join('')}
    </div>
  `;

  $('task-detail-modal').classList.remove('hidden');
}

// 删除任务
async function deleteTask(id) {
  showConfirm('确定要删除此任务吗？', async () => {
    showLoading();
    const res = await api(`/transfer/${id}`, { method: 'DELETE' });
    hideLoading();

    if (res.success) {
      loadTasks();
    } else {
      showError(res.error);
    }
  });
}

// 计算预估完成时间
function calculateEstimateTime(task) {
  const pendingFollows = task.pendingFollows || 0;
  const pendingLikes = task.pendingLikes || 0;

  if (pendingFollows === 0 && pendingLikes === 0) {
    return '已完成全部任务';
  }

  const config = task.rateLimitConfig || {};
  const followsPerDay = Math.min((config.followsPerHour || 5) * 24, config.followsPerDay || 20);
  const likesPerDay = Math.min((config.likesPerHour || 10) * 24, config.likesPerDay || 30);

  // 计算需要的天数
  const followDays = followsPerDay > 0 ? Math.ceil(pendingFollows / followsPerDay) : 0;
  const likeDays = likesPerDay > 0 ? Math.ceil(pendingLikes / likesPerDay) : 0;
  const totalDays = Math.max(followDays, likeDays);

  if (totalDays === 0) {
    return '预计今天内完成';
  } else if (totalDays === 1) {
    return '预计需要 1 天完成';
  } else {
    return `预计需要 ${totalDays} 天完成`;
  }
}

// 辅助函数
function formatTime(str) {
  if (!str) return '';
  const d = new Date(str);
  return `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function statusText(status) {
  const map = {
    pending: '等待中',
    running: '运行中',
    paused: '已暂停',
    completed: '已完成',
    error: '错误'
  };
  return map[status] || status;
}

// 默认设置
const DEFAULT_SETTINGS = {
  interval: 5,          // 每5分钟执行一次
  followPerHour: 5,     // 每小时关注5个
  likePerHour: 10,      // 每小时点赞10个
  followPerDay: 20,     // 每天关注20个
  likePerDay: 30        // 每天点赞30个
};

// 获取设置
function getSettings() {
  const saved = localStorage.getItem('taskSettings');
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch (e) {
      return DEFAULT_SETTINGS;
    }
  }
  return DEFAULT_SETTINGS;
}

// 加载设置到表单
function loadSettings() {
  const settings = getSettings();
  $('setting-interval').value = settings.interval;
  $('setting-follow-per-hour').value = settings.followPerHour;
  $('setting-like-per-hour').value = settings.likePerHour;
  $('setting-follow-per-day').value = settings.followPerDay;
  $('setting-like-per-day').value = settings.likePerDay;
}

// 显示设置弹窗
function showSettingsModal() {
  loadSettings();
  $('settings-modal').classList.remove('hidden');
}

// 保存设置
function saveSettings() {
  const settings = {
    interval: parseInt($('setting-interval').value) || DEFAULT_SETTINGS.interval,
    followPerHour: parseInt($('setting-follow-per-hour').value) || DEFAULT_SETTINGS.followPerHour,
    likePerHour: parseInt($('setting-like-per-hour').value) || DEFAULT_SETTINGS.likePerHour,
    followPerDay: parseInt($('setting-follow-per-day').value) || DEFAULT_SETTINGS.followPerDay,
    likePerDay: parseInt($('setting-like-per-day').value) || DEFAULT_SETTINGS.likePerDay
  };

  localStorage.setItem('taskSettings', JSON.stringify(settings));
  $('settings-modal').classList.add('hidden');
  showToast('设置已保存');
}

// 显示账号管理弹窗
function showAccountSettingsModal() {
  $('new-username').value = '';
  $('new-password').value = '';
  $('account-settings-modal').classList.remove('hidden');
}

// 保存账号设置
async function saveAccountSettings() {
  const newUsername = $('new-username').value.trim();
  const newPassword = $('new-password').value;

  if (!newUsername && !newPassword) {
    return showToast('请输入新用户名或新密码');
  }

  showLoading();
  const res = await api('/auth/update', {
    method: 'POST',
    body: JSON.stringify({ newUsername, newPassword })
  });
  hideLoading();

  if (res.success) {
    // 更新本地存储
    token = res.token;
    currentUser = res.user;
    await chrome.storage.local.set({ token, user: currentUser });
    $('current-user').textContent = currentUser.username;
    $('account-settings-modal').classList.add('hidden');
    showToast('账号信息已更新');
  } else {
    showToast(res.error || '修改失败');
  }
}

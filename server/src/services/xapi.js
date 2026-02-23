const http = require('http');
const https = require('https');
const net = require('net');

// 代理配置（从环境变量读取）
let proxyConfig = {
  enabled: process.env.PROXY_ENABLED === 'true',
  type: process.env.PROXY_TYPE || 'http',
  host: process.env.PROXY_HOST || '127.0.0.1',
  port: parseInt(process.env.PROXY_PORT) || 10808
};

function setProxy(config) {
  proxyConfig = { ...proxyConfig, ...config };
}

function getProxy() {
  return { ...proxyConfig };
}

// SOCKS5 连接
function socks5Connect(targetHost, targetPort) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(proxyConfig.port, proxyConfig.host, () => {
      socket.write(Buffer.from([0x05, 0x01, 0x00]));
    });

    let step = 'greeting';

    socket.on('data', (data) => {
      if (step === 'greeting') {
        if (data[0] !== 0x05 || data[1] !== 0x00) {
          socket.destroy();
          reject(new Error('SOCKS5 握手失败'));
          return;
        }

        step = 'connect';
        const hostBuf = Buffer.from(targetHost);
        const portBuf = Buffer.alloc(2);
        portBuf.writeUInt16BE(targetPort);

        const request = Buffer.concat([
          Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]),
          hostBuf,
          portBuf
        ]);
        socket.write(request);

      } else if (step === 'connect') {
        if (data[0] !== 0x05 || data[1] !== 0x00) {
          socket.destroy();
          reject(new Error('SOCKS5 连接失败'));
          return;
        }
        resolve(socket);
      }
    });

    socket.on('error', reject);
    socket.setTimeout(10000, () => {
      socket.destroy();
      reject(new Error('SOCKS5 连接超时'));
    });
  });
}

// HTTP 代理连接
function httpProxyConnect(targetHost, targetPort) {
  return new Promise((resolve, reject) => {
    const proxyReq = http.request({
      host: proxyConfig.host,
      port: proxyConfig.port,
      method: 'CONNECT',
      path: `${targetHost}:${targetPort}`
    });

    proxyReq.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP 代理连接失败: ${res.statusCode}`));
        return;
      }
      resolve(socket);
    });

    proxyReq.on('error', reject);
    proxyReq.setTimeout(10000, () => {
      proxyReq.destroy();
      reject(new Error('HTTP 代理连接超时'));
    });
    proxyReq.end();
  });
}

// 通过代理发送 HTTPS 请求
function httpsRequestViaProxy(url, options, body = null) {
  return new Promise(async (resolve, reject) => {
    const urlObj = new URL(url);
    const targetHost = urlObj.hostname;
    const targetPort = 443;

    try {
      if (!proxyConfig.enabled || proxyConfig.type === 'none') {
        const req = https.request({
          ...options,
          host: targetHost,
          path: urlObj.pathname + urlObj.search
        }, (response) => {
          let data = '';
          response.on('data', chunk => data += chunk);
          response.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              resolve(data);
            }
          });
        });

        req.on('error', reject);
        if (body) req.write(body);
        req.end();
        return;
      }

      let socket;
      if (proxyConfig.type === 'socks5') {
        socket = await socks5Connect(targetHost, targetPort);
      } else {
        socket = await httpProxyConnect(targetHost, targetPort);
      }

      const req = https.request({
        ...options,
        host: targetHost,
        path: urlObj.pathname + urlObj.search,
        socket: socket,
        agent: false
      }, (response) => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve(data);
          }
        });
      });

      req.on('error', reject);
      if (body) req.write(body);
      req.end();

    } catch (e) {
      reject(e);
    }
  });
}

// 从 cookie 字符串解析 ct0 (csrf token)
function parseCt0FromCookie(cookieStr) {
  const match = cookieStr.match(/ct0=([^;]+)/);
  return match ? match[1] : '';
}

// 从 cookie 获取用户 ID
function parseUserIdFromCookie(cookieStr) {
  const match = cookieStr.match(/twid=u%3D(\d+)/);
  return match ? match[1] : null;
}

// 构建请求头
function buildHeaders(cookieStr) {
  const ct0 = parseCt0FromCookie(cookieStr);
  return {
    "accept": "*/*",
    "accept-language": "zh-CN,zh;q=0.9",
    "authorization": "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA",
    "content-type": "application/json",
    "x-csrf-token": ct0,
    "x-twitter-active-user": "yes",
    "x-twitter-auth-type": "OAuth2Session",
    "x-twitter-client-language": "zh-cn",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    "cookie": cookieStr
  };
}

const features = {
  "rweb_video_screen_enabled": false,
  "profile_label_improvements_pcf_label_in_post_enabled": true,
  "responsive_web_profile_redirect_enabled": false,
  "rweb_tipjar_consumption_enabled": false,
  "verified_phone_label_enabled": false,
  "creator_subscriptions_tweet_preview_api_enabled": true,
  "responsive_web_graphql_timeline_navigation_enabled": true,
  "responsive_web_graphql_skip_user_profile_image_extensions_enabled": false,
  "premium_content_api_read_enabled": false,
  "communities_web_enable_tweet_community_results_fetch": true,
  "c9s_tweet_anatomy_moderator_badge_enabled": true,
  "responsive_web_grok_analyze_button_fetch_trends_enabled": false,
  "responsive_web_grok_analyze_post_followups_enabled": true,
  "responsive_web_jetfuel_frame": true,
  "responsive_web_grok_share_attachment_enabled": true,
  "responsive_web_grok_annotations_enabled": true,
  "articles_preview_enabled": true,
  "responsive_web_edit_tweet_api_enabled": true,
  "graphql_is_translatable_rweb_tweet_is_translatable_enabled": true,
  "view_counts_everywhere_api_enabled": true,
  "longform_notetweets_consumption_enabled": true,
  "responsive_web_twitter_article_tweet_consumption_enabled": true,
  "tweet_awards_web_tipping_enabled": false,
  "responsive_web_grok_show_grok_translated_post": false,
  "responsive_web_grok_analysis_button_from_backend": true,
  "post_ctas_fetch_enabled": false,
  "freedom_of_speech_not_reach_fetch_enabled": true,
  "standardized_nudges_misinfo": true,
  "tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled": true,
  "longform_notetweets_rich_text_read_enabled": true,
  "longform_notetweets_inline_media_enabled": true,
  "responsive_web_grok_image_annotation_enabled": true,
  "responsive_web_grok_imagine_annotation_enabled": true,
  "responsive_web_grok_community_note_auto_translation_is_enabled": false,
  "responsive_web_enhance_cards_enabled": false
};

// 获取用户信息
async function getUserInfo(cookieStr, userId) {
  const headers = buildHeaders(cookieStr);

  const variables = {
    userId: userId,
    withSafetyModeUserFields: true
  };

  const userFeatures = {
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
    features: JSON.stringify(userFeatures)
  });

  const url = `https://x.com/i/api/graphql/Lxg1V9AiIzzXEiP2c8dRnw/UserByRestId?${params}`;

  console.log('获取用户信息 - userId:', userId);
  console.log('请求URL:', url.substring(0, 100) + '...');

  const data = await httpsRequestViaProxy(url, { method: 'GET', headers });

  console.log('API响应:', JSON.stringify(data).substring(0, 500));

  if (data.errors) {
    console.log('API错误:', JSON.stringify(data.errors));
    throw new Error(data.errors[0]?.message || '获取用户信息失败');
  }

  // 尝试多种可能的数据结构
  let user = data?.data?.user?.result;

  // 如果 result 是 User 类型的包装
  if (user?.__typename === 'User') {
    // 已经是正确结构
  } else if (user?.user?.result) {
    user = user.user.result;
  }

  console.log('解析的用户数据:', user ? JSON.stringify(user).substring(0, 300) : 'null');

  if (!user) {
    console.log('完整响应数据:', JSON.stringify(data));
    throw new Error('用户不存在');
  }

  // 兼容不同的字段位置
  const legacy = user.legacy || {};
  const screenName = legacy.screen_name || user.screen_name || user.core?.screen_name;
  const displayName = legacy.name || user.name || user.core?.name;

  return {
    id: user.rest_id || userId,
    username: screenName,
    name: displayName,
    followingCount: legacy.friends_count || 0,
    followersCount: legacy.followers_count || 0
  };
}

// 获取关注列表
async function getFollowing(cookieStr, userId, cursor = null) {
  const headers = buildHeaders(cookieStr);
  const variables = {
    userId: userId,
    count: 20,
    includePromotedContent: false,
    withGrokTranslatedBio: false
  };
  if (cursor) variables.cursor = cursor;

  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(features)
  });

  const url = `https://x.com/i/api/graphql/M3LO-sJg6BCWdEliN_C2fQ/Following?${params}`;
  return httpsRequestViaProxy(url, { method: 'GET', headers });
}

// 获取点赞列表
async function getLikes(cookieStr, userId, cursor = null) {
  const headers = buildHeaders(cookieStr);
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
    features: JSON.stringify(features),
    fieldToggles: JSON.stringify({ withArticlePlainText: false })
  });

  const url = `https://x.com/i/api/graphql/JPxbOQGc_tXQ0Y29mvHKSw/Likes?${params}`;
  return httpsRequestViaProxy(url, { method: 'GET', headers });
}

// 关注用户
async function followUser(cookieStr, userId) {
  const headers = buildHeaders(cookieStr);
  headers['content-type'] = 'application/x-www-form-urlencoded';

  const body = new URLSearchParams({
    include_profile_interstitial_type: '1',
    include_blocking: '1',
    include_blocked_by: '1',
    include_followed_by: '1',
    include_want_retweets: '1',
    include_mute_edge: '1',
    include_can_dm: '1',
    include_can_media_tag: '1',
    include_ext_is_blue_verified: '1',
    include_ext_verified_type: '1',
    include_ext_profile_image_shape: '1',
    skip_status: '1',
    user_id: userId
  }).toString();

  const url = 'https://x.com/i/api/1.1/friendships/create.json';
  return httpsRequestViaProxy(url, { method: 'POST', headers }, body);
}

// 点赞推文
async function likeTweet(cookieStr, tweetId) {
  const headers = buildHeaders(cookieStr);

  const body = JSON.stringify({
    variables: { tweet_id: tweetId },
    queryId: 'lI07N6Otwv1PhnEgXILM7A'
  });

  const url = 'https://x.com/i/api/graphql/lI07N6Otwv1PhnEgXILM7A/FavoriteTweet';
  return httpsRequestViaProxy(url, { method: 'POST', headers }, body);
}

// 解析关注列表
function parseFollowing(data) {
  const users = [];
  let nextCursor = null;

  try {
    const entries = data?.data?.user?.result?.timeline?.timeline?.instructions
      ?.find(i => i.type === 'TimelineAddEntries')?.entries || [];

    for (const entry of entries) {
      if (entry.content?.itemContent?.user_results?.result) {
        const user = entry.content.itemContent.user_results.result;
        const core = user.core || {};
        users.push({
          id: user.rest_id,
          username: core.screen_name,
          name: core.name
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
function parseLikes(data) {
  const tweets = [];
  let nextCursor = null;

  try {
    const entries = data?.data?.user?.result?.timeline?.timeline?.instructions
      ?.find(i => i.type === 'TimelineAddEntries')?.entries || [];

    for (const entry of entries) {
      const tweetResult = entry.content?.itemContent?.tweet_results?.result;
      if (tweetResult) {
        const tweet = tweetResult.__typename === 'TweetWithVisibilityResults'
          ? tweetResult.tweet
          : tweetResult;
        const legacy = tweet?.legacy;
        const userCore = tweet?.core?.user_results?.result?.core;
        if (legacy) {
          tweets.push({
            id: legacy.id_str,
            username: userCore?.screen_name,
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
async function getAllFollowing(cookieStr, userId, onProgress) {
  const allUsers = [];
  let cursor = null;
  let page = 1;

  while (true) {
    if (onProgress) onProgress(`获取关注第 ${page} 页...`);
    const data = await getFollowing(cookieStr, userId, cursor);

    if (data.errors) {
      throw new Error(data.errors[0]?.message || '获取关注失败');
    }

    const { users, nextCursor } = parseFollowing(data);
    if (users.length === 0) break;

    allUsers.push(...users);
    if (users.length < 20 || !nextCursor) break;

    cursor = nextCursor;
    page++;
    await new Promise(r => setTimeout(r, 1000));
  }

  return allUsers;
}

// 获取所有点赞
async function getAllLikes(cookieStr, userId, onProgress, maxPages = 50) {
  const allTweets = [];
  let cursor = null;
  let page = 1;

  while (page <= maxPages) {
    if (onProgress) onProgress(`获取点赞第 ${page} 页...`);
    const data = await getLikes(cookieStr, userId, cursor);

    if (data.errors) {
      throw new Error(data.errors[0]?.message || '获取点赞失败');
    }

    const { tweets, nextCursor } = parseLikes(data);
    if (tweets.length === 0) break;

    allTweets.push(...tweets);
    if (tweets.length < 20 || !nextCursor) break;

    cursor = nextCursor;
    page++;
    await new Promise(r => setTimeout(r, 1000));
  }

  return allTweets;
}

module.exports = {
  parseUserIdFromCookie,
  getUserInfo,
  getAllFollowing,
  getAllLikes,
  followUser,
  likeTweet,
  setProxy,
  getProxy
};

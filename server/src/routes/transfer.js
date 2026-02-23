const express = require('express');
const { v4: uuidv4 } = require('uuid');
const auth = require('../middleware/auth');
const { xAccounts, backups, tasks } = require('../services/db');
const xapi = require('../services/xapi');

const router = express.Router();

// 所有路由都需要认证
router.use(auth);

// 任务执行器（内存中运行）
const taskIntervals = new Map();

// 默认限流配置
const DEFAULT_RATE_LIMIT = {
  intervalMinutes: 5,
  followsPerHour: 5,
  likesPerHour: 10,
  followsPerDay: 20,
  likesPerDay: 30
};

// 检查限流
function checkRateLimit(task) {
  const now = Date.now();
  const hourAgo = now - 60 * 60 * 1000;
  const dayAgo = now - 24 * 60 * 60 * 1000;

  // 获取任务的限流配置
  const limit = task.rateLimitConfig || DEFAULT_RATE_LIMIT;

  // 清理过期记录
  task.followHistory = (task.followHistory || []).filter(t => new Date(t).getTime() > dayAgo);
  task.likeHistory = (task.likeHistory || []).filter(t => new Date(t).getTime() > dayAgo);

  const followsLastHour = task.followHistory.filter(t => new Date(t).getTime() > hourAgo).length;
  const likesLastHour = task.likeHistory.filter(t => new Date(t).getTime() > hourAgo).length;
  const followsLastDay = task.followHistory.length;
  const likesLastDay = task.likeHistory.length;

  return {
    canFollow: followsLastHour < limit.followsPerHour && followsLastDay < limit.followsPerDay,
    canLike: likesLastHour < limit.likesPerHour && likesLastDay < limit.likesPerDay,
    stats: { followsLastHour, likesLastHour, followsLastDay, likesLastDay }
  };
}

// 执行任务
async function executeTask(taskId) {
  const task = tasks.findById(taskId);
  if (!task || task.status !== 'running') return;

  const targetAccount = xAccounts.findById(task.targetAccountId);
  if (!targetAccount) {
    task.status = 'error';
    task.logs.push({ time: new Date().toISOString(), msg: '❌ 目标账号不存在' });
    tasks.update(taskId, task);
    stopTaskInterval(taskId);
    return;
  }

  const rateLimit = checkRateLimit(task);

  // 执行关注
  if (rateLimit.canFollow && task.pendingFollows.length > 0) {
    const user = task.pendingFollows[0];
    try {
      task.logs.push({ time: new Date().toISOString(), msg: `正在关注 @${user.username}...` });
      tasks.update(taskId, { logs: task.logs });

      const result = await xapi.followUser(targetAccount.cookie, user.id);

      if (result.id || result.screen_name) {
        task.completedFollows.push({ id: user.id, username: user.username, completedAt: new Date().toISOString() });
        task.pendingFollows.shift();
        task.followHistory.push(new Date().toISOString());
        task.logs.push({ time: new Date().toISOString(), msg: `✅ 成功关注 @${user.username}` });

        // 更新目标账号的关注数量
        xAccounts.update(task.targetAccountId, {
          followingCount: (targetAccount.followingCount || 0) + 1
        });

        // 同步到目标账号的备份数据
        let targetBackup = backups.findOne({ xAccountId: task.targetAccountId, type: 'following' });
        if (!targetBackup) {
          targetBackup = {
            _id: `backup_${Date.now()}`,
            xAccountId: task.targetAccountId,
            type: 'following',
            data: [],
            createdAt: new Date().toISOString()
          };
          backups.create(targetBackup);
          targetBackup = backups.findOne({ xAccountId: task.targetAccountId, type: 'following' });
        }
        const followData = targetBackup.data || [];
        if (!followData.some(item => item.id === user.id)) {
          followData.unshift({
            id: user.id,
            username: user.username,
            name: user.name,
            syncedAt: new Date().toISOString()
          });
          backups.update(targetBackup._id, { data: followData });
        }
      } else if (result.errors) {
        const errMsg = result.errors[0]?.message || '';
        if (errMsg.includes('already') || errMsg.includes('following')) {
          task.logs.push({ time: new Date().toISOString(), msg: `⚠️ 已关注过 @${user.username}，跳过` });
        } else {
          task.logs.push({ time: new Date().toISOString(), msg: `❌ 关注失败: ${errMsg}` });
        }
        task.pendingFollows.shift();
      }
    } catch (e) {
      task.logs.push({ time: new Date().toISOString(), msg: `❌ 关注错误: ${e.message}` });
    }
    tasks.update(taskId, task);
  }

  // 执行点赞（与关注同时进行）
  if (rateLimit.canLike && task.pendingLikes.length > 0) {
    const tweet = task.pendingLikes[0];
    try {
      task.logs.push({ time: new Date().toISOString(), msg: `正在点赞 ${tweet.id}...` });
      tasks.update(taskId, { logs: task.logs });

      const result = await xapi.likeTweet(targetAccount.cookie, tweet.id);

      if (result?.data?.favorite_tweet === 'Done') {
        task.completedLikes.push({ id: tweet.id, completedAt: new Date().toISOString() });
        task.pendingLikes.shift();
        task.likeHistory.push(new Date().toISOString());
        task.logs.push({ time: new Date().toISOString(), msg: `✅ 成功点赞 ${tweet.id}` });

        // 更新目标账号的点赞数量
        xAccounts.update(task.targetAccountId, {
          likesCount: (targetAccount.likesCount || 0) + 1
        });

        // 同步到目标账号的备份数据
        let targetBackup = backups.findOne({ xAccountId: task.targetAccountId, type: 'likes' });
        if (!targetBackup) {
          targetBackup = {
            _id: `backup_${Date.now()}_likes`,
            xAccountId: task.targetAccountId,
            type: 'likes',
            data: [],
            createdAt: new Date().toISOString()
          };
          backups.create(targetBackup);
          targetBackup = backups.findOne({ xAccountId: task.targetAccountId, type: 'likes' });
        }
        const likeData = targetBackup.data || [];
        if (!likeData.some(item => item.id === tweet.id)) {
          likeData.unshift({
            id: tweet.id,
            syncedAt: new Date().toISOString()
          });
          backups.update(targetBackup._id, { data: likeData });
        }
      } else if (result?.errors) {
        const errMsg = result.errors[0]?.message || '';
        if (errMsg.includes('already favorited')) {
          task.logs.push({ time: new Date().toISOString(), msg: `⚠️ 已点赞过，跳过` });
        } else {
          task.logs.push({ time: new Date().toISOString(), msg: `❌ 点赞失败: ${errMsg}` });
        }
        task.pendingLikes.shift();
      }
    } catch (e) {
      task.logs.push({ time: new Date().toISOString(), msg: `❌ 点赞错误: ${e.message}` });
    }
    tasks.update(taskId, task);
    return;
  }

  // 检查是否完成
  if (task.pendingFollows.length === 0 && task.pendingLikes.length === 0) {
    task.status = 'completed';
    task.logs.push({ time: new Date().toISOString(), msg: '🎉 所有任务已完成!' });
    tasks.update(taskId, task);
    stopTaskInterval(taskId);
  }
}

function startTaskInterval(taskId) {
  if (taskIntervals.has(taskId)) return;
  const task = tasks.findById(taskId);
  const intervalMinutes = task?.rateLimitConfig?.intervalMinutes || DEFAULT_RATE_LIMIT.intervalMinutes;
  const interval = setInterval(() => executeTask(taskId), intervalMinutes * 60 * 1000);
  taskIntervals.set(taskId, interval);
  executeTask(taskId);
}

function stopTaskInterval(taskId) {
  const interval = taskIntervals.get(taskId);
  if (interval) {
    clearInterval(interval);
    taskIntervals.delete(taskId);
  }
}

// 获取任务列表
router.get('/', (req, res) => {
  try {
    const taskList = tasks.findAll({ userId: req.userId }).map(t => {
      const sourceAccount = xAccounts.findById(t.sourceAccountId);
      const targetAccount = xAccounts.findById(t.targetAccountId);

      return {
        id: t._id,
        sourceAccount: sourceAccount ? `@${sourceAccount.xUsername}` : '已删除',
        targetAccount: targetAccount ? `@${targetAccount.xUsername}` : '已删除',
        status: t.status,
        pendingFollows: t.pendingFollows?.length || 0,
        pendingLikes: t.pendingLikes?.length || 0,
        completedFollows: t.completedFollows?.length || 0,
        completedLikes: t.completedLikes?.length || 0,
        createdAt: t.createdAt
      };
    }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ success: true, tasks: taskList });
  } catch (err) {
    console.error('获取任务列表错误:', err);
    res.status(500).json({ success: false, error: '服务器错误' });
  }
});

// 创建转移任务
router.post('/', async (req, res) => {
  try {
    const { sourceAccountId, targetAccountId, rateLimit } = req.body;

    if (!sourceAccountId || !targetAccountId) {
      return res.status(400).json({ success: false, error: '请提供源账号和目标账号' });
    }

    if (sourceAccountId === targetAccountId) {
      return res.status(400).json({ success: false, error: '源账号和目标账号不能相同' });
    }

    // 验证账号所有权
    const sourceAccount = xAccounts.findOne({ _id: sourceAccountId, userId: req.userId });
    const targetAccount = xAccounts.findOne({ _id: targetAccountId, userId: req.userId });

    if (!sourceAccount || !targetAccount) {
      return res.status(404).json({ success: false, error: '账号不存在' });
    }

    // 检查源账号是否有备份数据
    const followingBackup = backups.findOne({ xAccountId: sourceAccountId, type: 'following' });
    const likesBackup = backups.findOne({ xAccountId: sourceAccountId, type: 'likes' });

    if (!followingBackup && !likesBackup) {
      return res.status(400).json({ success: false, error: '源账号没有备份数据，请先同步' });
    }

    // 获取目标账号已关注列表用于去重
    let existingFollowIds = new Set();
    try {
      const existingFollowing = await xapi.getAllFollowing(targetAccount.cookie, targetAccount.xUserId);
      existingFollowIds = new Set(existingFollowing.map(u => u.id));
    } catch (e) {
      console.error('获取目标账号关注列表失败:', e.message);
    }

    // 过滤已关注的用户
    const pendingFollows = (followingBackup?.data || []).filter(u => !existingFollowIds.has(u.id));
    const pendingLikes = likesBackup?.data || [];

    // 创建任务
    const rateLimitConfig = {
      intervalMinutes: rateLimit?.intervalMinutes || DEFAULT_RATE_LIMIT.intervalMinutes,
      followsPerHour: rateLimit?.followsPerHour || DEFAULT_RATE_LIMIT.followsPerHour,
      likesPerHour: rateLimit?.likesPerHour || DEFAULT_RATE_LIMIT.likesPerHour,
      followsPerDay: rateLimit?.followsPerDay || DEFAULT_RATE_LIMIT.followsPerDay,
      likesPerDay: rateLimit?.likesPerDay || DEFAULT_RATE_LIMIT.likesPerDay
    };

    const task = {
      _id: uuidv4(),
      userId: req.userId,
      sourceAccountId,
      targetAccountId,
      status: 'paused',
      rateLimitConfig,
      pendingFollows,
      pendingLikes,
      completedFollows: [],
      completedLikes: [],
      followHistory: [],
      likeHistory: [],
      logs: [
        { time: new Date().toISOString(), msg: '任务创建成功' },
        { time: new Date().toISOString(), msg: `待关注: ${pendingFollows.length} 个，待点赞: ${pendingLikes.length} 条` },
        { time: new Date().toISOString(), msg: `限制: 每${rateLimitConfig.intervalMinutes}分钟执行，关注${rateLimitConfig.followsPerHour}/h ${rateLimitConfig.followsPerDay}/d，点赞${rateLimitConfig.likesPerHour}/h ${rateLimitConfig.likesPerDay}/d` }
      ],
      createdAt: new Date().toISOString()
    };

    tasks.create(task);

    res.json({
      success: true,
      message: '任务创建成功',
      task: {
        id: task._id,
        pendingFollows: pendingFollows.length,
        pendingLikes: pendingLikes.length
      }
    });

  } catch (err) {
    console.error('创建任务错误:', err);
    res.status(500).json({ success: false, error: '服务器错误' });
  }
});

// 获取任务详情
router.get('/:id', (req, res) => {
  try {
    const task = tasks.findOne({ _id: req.params.id, userId: req.userId });

    if (!task) {
      return res.status(404).json({ success: false, error: '任务不存在' });
    }

    const sourceAccount = xAccounts.findById(task.sourceAccountId);
    const targetAccount = xAccounts.findById(task.targetAccountId);
    const rateLimit = checkRateLimit(task);

    res.json({
      success: true,
      task: {
        id: task._id,
        sourceAccount: sourceAccount ? `@${sourceAccount.xUsername}` : '已删除',
        targetAccount: targetAccount ? `@${targetAccount.xUsername}` : '已删除',
        status: task.status,
        pendingFollows: task.pendingFollows.length,
        pendingLikes: task.pendingLikes.length,
        completedFollows: task.completedFollows.length,
        completedLikes: task.completedLikes.length,
        rateLimit: rateLimit.stats,
        rateLimitConfig: task.rateLimitConfig || DEFAULT_RATE_LIMIT,
        logs: task.logs.slice(-50),
        createdAt: task.createdAt
      }
    });
  } catch (err) {
    console.error('获取任务详情错误:', err);
    res.status(500).json({ success: false, error: '服务器错误' });
  }
});

// 启动任务
router.post('/:id/start', (req, res) => {
  try {
    const task = tasks.findOne({ _id: req.params.id, userId: req.userId });

    if (!task) {
      return res.status(404).json({ success: false, error: '任务不存在' });
    }

    if (task.status === 'completed') {
      return res.status(400).json({ success: false, error: '任务已完成' });
    }

    task.status = 'running';
    task.logs.push({ time: new Date().toISOString(), msg: '▶️ 任务已启动' });
    tasks.update(task._id, task);

    startTaskInterval(task._id);

    res.json({ success: true, message: '任务已启动' });
  } catch (err) {
    console.error('启动任务错误:', err);
    res.status(500).json({ success: false, error: '服务器错误' });
  }
});

// 暂停任务
router.post('/:id/pause', (req, res) => {
  try {
    const task = tasks.findOne({ _id: req.params.id, userId: req.userId });

    if (!task) {
      return res.status(404).json({ success: false, error: '任务不存在' });
    }

    task.status = 'paused';
    task.logs.push({ time: new Date().toISOString(), msg: '⏸️ 任务已暂停' });
    tasks.update(task._id, task);

    stopTaskInterval(task._id);

    res.json({ success: true, message: '任务已暂停' });
  } catch (err) {
    console.error('暂停任务错误:', err);
    res.status(500).json({ success: false, error: '服务器错误' });
  }
});

// 删除任务
router.delete('/:id', (req, res) => {
  try {
    const task = tasks.findOne({ _id: req.params.id, userId: req.userId });

    if (!task) {
      return res.status(404).json({ success: false, error: '任务不存在' });
    }

    stopTaskInterval(task._id);
    tasks.delete(task._id);

    res.json({ success: true, message: '任务已删除' });
  } catch (err) {
    console.error('删除任务错误:', err);
    res.status(500).json({ success: false, error: '服务器错误' });
  }
});

module.exports = router;

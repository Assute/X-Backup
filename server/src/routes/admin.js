const express = require('express');
const { users, xAccounts, backups, tasks } = require('../services/db');

const router = express.Router();

// 管理员账号
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'admin';

// 简单的管理员认证中间件
function adminAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return res.status(401).json({ success: false, error: '需要管理员认证' });
  }

  const base64 = authHeader.slice(6);
  const decoded = Buffer.from(base64, 'base64').toString();
  const [username, password] = decoded.split(':');

  if (username !== ADMIN_USER || password !== ADMIN_PASS) {
    return res.status(401).json({ success: false, error: '管理员账号或密码错误' });
  }

  next();
}

// 管理员登录验证
router.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (username === ADMIN_USER && password === ADMIN_PASS) {
    res.json({ success: true, message: '登录成功' });
  } else {
    res.status(401).json({ success: false, error: '账号或密码错误' });
  }
});

// 获取所有用户列表（带账号统计）
router.get('/users', adminAuth, (req, res) => {
  try {
    const allUsers = users.findAll();

    const userList = allUsers.map(user => {
      const accountCount = xAccounts.findAll({ userId: user._id }).length;
      const taskCount = tasks.findAll({ userId: user._id }).length;
      return {
        _id: user._id,
        username: user.username,
        createdAt: user.createdAt,
        accountCount,
        taskCount
      };
    });

    res.json({ success: true, users: userList });
  } catch (err) {
    console.error('获取用户列表错误:', err);
    res.status(500).json({ success: false, error: '服务器错误' });
  }
});

// 获取用户详情（包括其所有X账号）
router.get('/users/:id', adminAuth, (req, res) => {
  try {
    const user = users.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, error: '用户不存在' });
    }

    const userAccounts = xAccounts.findAll({ userId: user._id }).map(acc => {
      const followingBackup = backups.findOne({ xAccountId: acc._id, type: 'following' });
      const likesBackup = backups.findOne({ xAccountId: acc._id, type: 'likes' });

      return {
        _id: acc._id,
        xUserId: acc.xUserId,
        xUsername: acc.xUsername,
        xName: acc.xName,
        followingCount: acc.followingCount || 0,
        likesCount: acc.likesCount || 0,
        lastSyncAt: acc.lastSyncAt,
        createdAt: acc.createdAt,
        hasFollowingBackup: !!followingBackup,
        hasLikesBackup: !!likesBackup
      };
    });

    // 获取用户的任务
    const userTasks = tasks.findAll({ userId: user._id }).map(task => {
      const sourceAccount = xAccounts.findById(task.sourceAccountId);
      const targetAccount = xAccounts.findById(task.targetAccountId);
      return {
        _id: task._id,
        status: task.status,
        sourceAccount: sourceAccount ? {
          xUsername: sourceAccount.xUsername,
          xName: sourceAccount.xName
        } : null,
        targetAccount: targetAccount ? {
          xUsername: targetAccount.xUsername,
          xName: targetAccount.xName
        } : null,
        pendingFollows: task.pendingFollows?.length || 0,
        pendingLikes: task.pendingLikes?.length || 0,
        completedFollows: task.completedFollows?.length || 0,
        completedLikes: task.completedLikes?.length || 0,
        rateLimitConfig: task.rateLimitConfig,
        createdAt: task.createdAt
      };
    });

    res.json({
      success: true,
      user: {
        _id: user._id,
        username: user.username,
        createdAt: user.createdAt
      },
      accounts: userAccounts,
      tasks: userTasks
    });
  } catch (err) {
    console.error('获取用户详情错误:', err);
    res.status(500).json({ success: false, error: '服务器错误' });
  }
});

// 修改用户密码
router.put('/users/:id/password', adminAuth, (req, res) => {
  try {
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 3) {
      return res.status(400).json({ success: false, error: '密码长度至少3位' });
    }

    const user = users.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, error: '用户不存在' });
    }

    users.update(req.params.id, { password: newPassword });

    res.json({ success: true, message: '密码修改成功' });
  } catch (err) {
    console.error('修改密码错误:', err);
    res.status(500).json({ success: false, error: '服务器错误' });
  }
});

// 删除用户
router.delete('/users/:id', adminAuth, (req, res) => {
  try {
    const user = users.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, error: '用户不存在' });
    }

    // 删除用户的所有X账号和备份
    const userAccounts = xAccounts.findAll({ userId: user._id });
    for (const acc of userAccounts) {
      // 删除账号的备份
      const accountBackups = backups.findAll({ xAccountId: acc._id });
      for (const backup of accountBackups) {
        backups.delete(backup._id);
      }
      // 删除账号
      xAccounts.delete(acc._id);
    }

    // 删除用户
    users.delete(req.params.id);

    res.json({ success: true, message: '用户已删除' });
  } catch (err) {
    console.error('删除用户错误:', err);
    res.status(500).json({ success: false, error: '服务器错误' });
  }
});

// 获取X账号的备份数据
router.get('/accounts/:id/backup', adminAuth, (req, res) => {
  try {
    const account = xAccounts.findById(req.params.id);
    if (!account) {
      return res.status(404).json({ success: false, error: '账号不存在' });
    }

    const followingBackup = backups.findOne({ xAccountId: account._id, type: 'following' });
    const likesBackup = backups.findOne({ xAccountId: account._id, type: 'likes' });

    res.json({
      success: true,
      following: followingBackup?.data || [],
      likes: likesBackup?.data || []
    });
  } catch (err) {
    console.error('获取备份数据错误:', err);
    res.status(500).json({ success: false, error: '服务器错误' });
  }
});

// 获取统计数据
router.get('/stats', adminAuth, (req, res) => {
  try {
    const totalUsers = users.findAll().length;
    const totalAccounts = xAccounts.findAll().length;
    const totalBackups = backups.findAll().length;

    res.json({
      success: true,
      stats: {
        totalUsers,
        totalAccounts,
        totalBackups
      }
    });
  } catch (err) {
    console.error('获取统计数据错误:', err);
    res.status(500).json({ success: false, error: '服务器错误' });
  }
});

module.exports = router;

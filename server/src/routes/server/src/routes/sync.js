const express = require('express');
const { xAccounts, backups } = require('../services/db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// 同步关注
router.post('/following', authMiddleware, (req, res) => {
  try {
    const { xAccountId, action, user } = req.body;
    const userId = req.userId;

    // 验证账号归属
    const account = xAccounts.findById(xAccountId);
    if (!account || account.userId !== userId) {
      return res.status(403).json({ success: false, error: '无权操作该账号' });
    }

    // 获取当前备份
    let backup = backups.findOne({ xAccountId, type: 'following' });

    if (!backup) {
      // 如果没有备份，创建一个新的
      const newId = `backup_${Date.now()}`;
      backup = {
        _id: newId,
        xAccountId,
        type: 'following',
        data: [],
        createdAt: new Date().toISOString()
      };
      backups.create(backup);
      backup = backups.findOne({ xAccountId, type: 'following' });
    }

    let data = backup.data || [];

    if (action === 'add') {
      // 添加关注 - 检查是否已存在
      const exists = data.some(item => item.id === user.id);
      if (!exists && user.id) {
        data.unshift({
          id: user.id,
          username: user.username,
          name: user.name,
          avatar: user.avatar,
          syncedAt: new Date().toISOString()
        });
      }
    } else if (action === 'remove') {
      // 取消关注 - 从列表中移除
      const index = data.findIndex(item => item.id === user.id);
      if (index !== -1) {
        data.splice(index, 1);
      }
    }

    // 更新备份
    backups.update(backup._id, { data });

    // 更新账号的关注数量
    xAccounts.update(xAccountId, {
      followingCount: data.length,
      lastSyncAt: new Date().toISOString()
    });

    res.json({ success: true, count: data.length });
  } catch (err) {
    console.error('同步关注错误:', err);
    res.status(500).json({ success: false, error: '服务器错误' });
  }
});

// 同步点赞
router.post('/likes', authMiddleware, (req, res) => {
  try {
    const { xAccountId, action, tweet } = req.body;
    const userId = req.userId;

    // 验证账号归属
    const account = xAccounts.findById(xAccountId);
    if (!account || account.userId !== userId) {
      return res.status(403).json({ success: false, error: '无权操作该账号' });
    }

    // 获取当前备份
    let backup = backups.findOne({ xAccountId, type: 'likes' });

    if (!backup) {
      const newId = `backup_${Date.now()}`;
      backup = {
        _id: newId,
        xAccountId,
        type: 'likes',
        data: [],
        createdAt: new Date().toISOString()
      };
      backups.create(backup);
      backup = backups.findOne({ xAccountId, type: 'likes' });
    }

    let data = backup.data || [];

    if (action === 'add') {
      // 添加点赞
      const exists = data.some(item => item.id === tweet.id);
      if (!exists && tweet.id) {
        data.unshift({
          id: tweet.id,
          syncedAt: new Date().toISOString()
        });
      }
    } else if (action === 'remove') {
      // 取消点赞
      const index = data.findIndex(item => item.id === tweet.id);
      if (index !== -1) {
        data.splice(index, 1);
      }
    }

    // 更新备份
    backups.update(backup._id, { data });

    // 更新账号的点赞数量
    xAccounts.update(xAccountId, {
      likesCount: data.length,
      lastSyncAt: new Date().toISOString()
    });

    res.json({ success: true, count: data.length });
  } catch (err) {
    console.error('同步点赞错误:', err);
    res.status(500).json({ success: false, error: '服务器错误' });
  }
});

module.exports = router;

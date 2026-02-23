const express = require('express');
const { v4: uuidv4 } = require('uuid');
const auth = require('../middleware/auth');
const { xAccounts, backups } = require('../services/db');
const xapi = require('../services/xapi');

const router = express.Router();

// 所有路由都需要认证
router.use(auth);

// 获取账号列表
router.get('/', (req, res) => {
  try {
    const accounts = xAccounts.findAll({ userId: req.userId })
      .map(acc => ({
        _id: acc._id,
        xUserId: acc.xUserId,
        xUsername: acc.xUsername,
        xName: acc.xName,
        followingCount: acc.followingCount || 0,
        likesCount: acc.likesCount || 0,
        lastSyncAt: acc.lastSyncAt
      }))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ success: true, accounts });
  } catch (err) {
    console.error('获取账号列表错误:', err);
    res.status(500).json({ success: false, error: '服务器错误' });
  }
});

// 添加/更新X账号
router.post('/', async (req, res) => {
  try {
    const { cookie, xUserId, xUsername, xName, followingCount } = req.body;

    if (!cookie) {
      return res.status(400).json({ success: false, error: '请提供cookie' });
    }

    // 优先使用插件传来的用户信息，否则从服务器获取
    let userInfo;
    let userId = xUserId;

    if (xUserId && xUsername) {
      // 插件已经获取了用户信息
      console.log('使用插件提供的用户信息:', { xUserId, xUsername, xName });
      userInfo = {
        id: xUserId,
        username: xUsername,
        name: xName,
        followingCount: followingCount || 0
      };
    } else {
      // 回退：从cookie解析并从服务器获取
      userId = xapi.parseUserIdFromCookie(cookie);
      console.log('解析到xUserId:', userId);
      if (!userId) {
        return res.status(400).json({ success: false, error: '无法从cookie解析用户ID，请确保cookie正确' });
      }

      try {
        console.log('正在从服务器获取用户信息...');
        userInfo = await xapi.getUserInfo(cookie, userId);
        console.log('获取到用户信息:', userInfo);
      } catch (e) {
        console.error('获取用户信息失败:', e.message);
        return res.status(400).json({ success: false, error: `获取X账号信息失败: ${e.message}` });
      }
    }

    // 查找是否已存在
    let account = xAccounts.findOne({ userId: req.userId, xUserId: userId });

    if (account) {
      // 更新现有账号
      xAccounts.update(account._id, {
        cookie,
        xUsername: userInfo.username,
        xName: userInfo.name
      });

      res.json({
        success: true,
        message: '账号已更新',
        account: {
          id: account._id,
          xUserId: account.xUserId,
          xUsername: userInfo.username,
          xName: userInfo.name,
          followingCount: account.followingCount || 0,
          likesCount: account.likesCount || 0,
          lastSyncAt: account.lastSyncAt
        }
      });
    } else {
      // 创建新账号
      account = {
        _id: uuidv4(),
        userId: req.userId,
        xUserId: userId,
        xUsername: userInfo.username,
        xName: userInfo.name,
        cookie,
        followingCount: 0,
        likesCount: 0,
        lastSyncAt: null,
        createdAt: new Date().toISOString()
      };
      xAccounts.create(account);

      res.json({
        success: true,
        message: '账号添加成功',
        account: {
          id: account._id,
          xUserId: account.xUserId,
          xUsername: account.xUsername,
          xName: account.xName,
          followingCount: 0,
          likesCount: 0,
          lastSyncAt: null
        }
      });
    }

  } catch (err) {
    console.error('添加账号错误:', err);
    res.status(500).json({ success: false, error: '服务器错误' });
  }
});

// 删除账号
router.delete('/:id', (req, res) => {
  try {
    const account = xAccounts.findOne({ _id: req.params.id, userId: req.userId });

    if (!account) {
      return res.status(404).json({ success: false, error: '账号不存在' });
    }

    // 删除相关备份
    backups.deleteMany({ xAccountId: account._id });

    // 删除账号
    xAccounts.delete(account._id);

    res.json({ success: true, message: '账号已删除' });
  } catch (err) {
    console.error('删除账号错误:', err);
    res.status(500).json({ success: false, error: '服务器错误' });
  }
});

// 同步账号数据（获取关注和点赞并保存）
router.post('/:id/sync', async (req, res) => {
  try {
    const account = xAccounts.findOne({ _id: req.params.id, userId: req.userId });

    if (!account) {
      return res.status(404).json({ success: false, error: '账号不存在' });
    }

    // 获取现有备份数据
    const existingFollowing = backups.findOne({ xAccountId: account._id, type: 'following' });
    const existingLikes = backups.findOne({ xAccountId: account._id, type: 'likes' });
    const oldFollowingCount = existingFollowing?.data?.length || 0;
    const oldLikesCount = existingLikes?.data?.length || 0;

    // 先返回响应，后台执行同步
    res.json({ success: true, message: '同步已开始' });

    // 获取关注列表
    const following = await xapi.getAllFollowing(account.cookie, account.xUserId);

    // 获取点赞列表
    const likes = await xapi.getAllLikes(account.cookie, account.xUserId);

    // 数据保护：如果新数据为空但旧数据不为空，或新数据量小于旧数据的30%，跳过更新
    const shouldUpdateFollowing = !oldFollowingCount || following.length > 0 && following.length >= oldFollowingCount * 0.3;
    const shouldUpdateLikes = !oldLikesCount || likes.length > 0 && likes.length >= oldLikesCount * 0.3;

    // 保存关注备份（带保护）
    if (shouldUpdateFollowing) {
      if (existingFollowing) {
        backups.update(existingFollowing._id, { data: following, createdAt: new Date().toISOString() });
      } else {
        backups.create({
          _id: uuidv4(),
          xAccountId: account._id,
          type: 'following',
          data: following,
          createdAt: new Date().toISOString()
        });
      }
    } else {
      console.log(`[保护] 关注数据异常，跳过更新。旧数据: ${oldFollowingCount}, 新数据: ${following.length}`);
    }

    // 保存点赞备份（带保护）
    if (shouldUpdateLikes) {
      if (existingLikes) {
        backups.update(existingLikes._id, { data: likes, createdAt: new Date().toISOString() });
      } else {
        backups.create({
          _id: uuidv4(),
          xAccountId: account._id,
          type: 'likes',
          data: likes,
          createdAt: new Date().toISOString()
        });
      }
    } else {
      console.log(`[保护] 点赞数据异常，跳过更新。旧数据: ${oldLikesCount}, 新数据: ${likes.length}`);
    }

    // 更新账号统计（只更新成功同步的数据）
    const updateData = { lastSyncAt: new Date().toISOString() };
    if (shouldUpdateFollowing) updateData.followingCount = following.length;
    if (shouldUpdateLikes) updateData.likesCount = likes.length;
    xAccounts.update(account._id, updateData);

  } catch (err) {
    console.error('同步账号错误:', err);
  }
});

// 获取同步状态
router.get('/:id/sync-status', (req, res) => {
  try {
    const account = xAccounts.findOne({ _id: req.params.id, userId: req.userId });

    if (!account) {
      return res.status(404).json({ success: false, error: '账号不存在' });
    }

    res.json({
      success: true,
      account: {
        id: account._id,
        xUserId: account.xUserId,
        xUsername: account.xUsername,
        xName: account.xName,
        followingCount: account.followingCount || 0,
        likesCount: account.likesCount || 0,
        lastSyncAt: account.lastSyncAt
      }
    });
  } catch (err) {
    console.error('获取同步状态错误:', err);
    res.status(500).json({ success: false, error: '服务器错误' });
  }
});

// 接收浏览器端同步的数据
router.post('/:id/sync-data', (req, res) => {
  try {
    const account = xAccounts.findOne({ _id: req.params.id, userId: req.userId });

    if (!account) {
      return res.status(404).json({ success: false, error: '账号不存在' });
    }

    const { following, likes } = req.body;

    // 获取现有备份数据
    const existingFollowing = backups.findOne({ xAccountId: account._id, type: 'following' });
    const existingLikes = backups.findOne({ xAccountId: account._id, type: 'likes' });
    const oldFollowingCount = existingFollowing?.data?.length || 0;
    const oldLikesCount = existingLikes?.data?.length || 0;

    const newFollowingCount = following?.length || 0;
    const newLikesCount = likes?.length || 0;

    // 数据保护：如果新数据为空但旧数据不为空，或新数据量小于旧数据的30%，跳过更新
    const shouldUpdateFollowing = !oldFollowingCount || newFollowingCount > 0 && newFollowingCount >= oldFollowingCount * 0.3;
    const shouldUpdateLikes = !oldLikesCount || newLikesCount > 0 && newLikesCount >= oldLikesCount * 0.3;

    let skippedFollowing = false;
    let skippedLikes = false;

    // 保存关注备份（带保护）
    if (shouldUpdateFollowing) {
      if (existingFollowing) {
        backups.update(existingFollowing._id, { data: following || [], createdAt: new Date().toISOString() });
      } else {
        backups.create({
          _id: uuidv4(),
          xAccountId: account._id,
          type: 'following',
          data: following || [],
          createdAt: new Date().toISOString()
        });
      }
    } else {
      skippedFollowing = true;
      console.log(`[保护] 关注数据异常，跳过更新。旧数据: ${oldFollowingCount}, 新数据: ${newFollowingCount}`);
    }

    // 保存点赞备份（带保护）
    if (shouldUpdateLikes) {
      if (existingLikes) {
        backups.update(existingLikes._id, { data: likes || [], createdAt: new Date().toISOString() });
      } else {
        backups.create({
          _id: uuidv4(),
          xAccountId: account._id,
          type: 'likes',
          data: likes || [],
          createdAt: new Date().toISOString()
        });
      }
    } else {
      skippedLikes = true;
      console.log(`[保护] 点赞数据异常，跳过更新。旧数据: ${oldLikesCount}, 新数据: ${newLikesCount}`);
    }

    // 更新账号统计（只更新成功同步的数据）
    const updateData = { lastSyncAt: new Date().toISOString() };
    if (shouldUpdateFollowing) updateData.followingCount = newFollowingCount;
    if (shouldUpdateLikes) updateData.likesCount = newLikesCount;
    xAccounts.update(account._id, updateData);

    // 返回结果
    if (skippedFollowing || skippedLikes) {
      const skipped = [];
      if (skippedFollowing) skipped.push('关注');
      if (skippedLikes) skipped.push('点赞');
      res.json({
        success: true,
        message: `同步完成，但${skipped.join('和')}数据因数量异常已跳过（防止误覆盖）`
      });
    } else {
      res.json({ success: true, message: '同步数据已保存' });
    }
  } catch (err) {
    console.error('保存同步数据错误:', err);
    res.status(500).json({ success: false, error: '服务器错误' });
  }
});

// 获取备份详情
router.get('/:id/backup', (req, res) => {
  try {
    const account = xAccounts.findOne({ _id: req.params.id, userId: req.userId });

    if (!account) {
      return res.status(404).json({ success: false, error: '账号不存在' });
    }

    const followingBackup = backups.findOne({ xAccountId: account._id, type: 'following' });
    const likesBackup = backups.findOne({ xAccountId: account._id, type: 'likes' });

    res.json({
      success: true,
      backup: {
        following: followingBackup?.data || [],
        likes: likesBackup?.data || [],
        followingUpdatedAt: followingBackup?.createdAt,
        likesUpdatedAt: likesBackup?.createdAt
      }
    });
  } catch (err) {
    console.error('获取备份详情错误:', err);
    res.status(500).json({ success: false, error: '服务器错误' });
  }
});

module.exports = router;

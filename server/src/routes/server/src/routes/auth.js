const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { users } = require('../services/db');

const router = express.Router();

// 注册
router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, error: '用户名和密码不能为空' });
    }

    if (username.length < 3 || username.length > 20) {
      return res.status(400).json({ success: false, error: '用户名长度需要3-20个字符' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, error: '密码长度至少6个字符' });
    }

    // 检查用户名是否存在
    const existingUser = users.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ success: false, error: '用户名已存在' });
    }

    // 创建用户
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = {
      _id: uuidv4(),
      username,
      password: hashedPassword,
      createdAt: new Date().toISOString()
    };
    users.create(user);

    // 生成token
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        username: user.username
      }
    });

  } catch (err) {
    console.error('注册错误:', err);
    res.status(500).json({ success: false, error: '服务器错误' });
  }
});

// 登录
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, error: '用户名和密码不能为空' });
    }

    // 查找用户
    const user = users.findOne({ username });
    if (!user) {
      return res.status(401).json({ success: false, error: '用户名或密码错误' });
    }

    // 验证密码
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, error: '用户名或密码错误' });
    }

    // 生成token
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        username: user.username
      }
    });

  } catch (err) {
    console.error('登录错误:', err);
    res.status(500).json({ success: false, error: '服务器错误' });
  }
});

// 获取当前用户信息
router.get('/me', require('../middleware/auth'), (req, res) => {
  try {
    const user = users.findById(req.userId);
    if (!user) {
      return res.status(404).json({ success: false, error: '用户不存在' });
    }

    res.json({
      success: true,
      user: {
        id: user._id,
        username: user.username,
        createdAt: user.createdAt
      }
    });

  } catch (err) {
    console.error('获取用户信息错误:', err);
    res.status(500).json({ success: false, error: '服务器错误' });
  }
});

// 修改账号信息
router.post('/update', require('../middleware/auth'), async (req, res) => {
  try {
    const { newUsername, newPassword } = req.body;

    const user = users.findById(req.userId);
    if (!user) {
      return res.status(404).json({ success: false, error: '用户不存在' });
    }

    const updates = {};

    // 修改用户名
    if (newUsername && newUsername !== user.username) {
      if (newUsername.length < 3 || newUsername.length > 20) {
        return res.status(400).json({ success: false, error: '用户名长度需要3-20个字符' });
      }
      const existingUser = users.findOne({ username: newUsername });
      if (existingUser) {
        return res.status(400).json({ success: false, error: '用户名已存在' });
      }
      updates.username = newUsername;
    }

    // 修改密码
    if (newPassword) {
      if (newPassword.length < 6) {
        return res.status(400).json({ success: false, error: '新密码长度至少6个字符' });
      }
      updates.password = await bcrypt.hash(newPassword, 10);
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, error: '没有需要修改的内容' });
    }

    users.update(user._id, updates);

    // 重新生成token
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        username: updates.username || user.username
      },
      message: '账号信息已更新'
    });

  } catch (err) {
    console.error('修改账号信息错误:', err);
    res.status(500).json({ success: false, error: '服务器错误' });
  }
});

module.exports = router;

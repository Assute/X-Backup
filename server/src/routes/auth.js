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

module.exports = router;

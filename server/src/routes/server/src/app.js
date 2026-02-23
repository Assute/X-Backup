require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDB } = require('./services/db');

const authRoutes = require('./routes/auth');
const accountsRoutes = require('./routes/accounts');
const transferRoutes = require('./routes/transfer');
const adminRoutes = require('./routes/admin');
const syncRoutes = require('./routes/sync');

const app = express();
const PORT = process.env.PORT || 3001;

// 中间件
app.use(cors());
app.use(express.json());

// 静态文件
app.use(express.static(path.join(__dirname, '../public')));

// 路由
app.use('/api/auth', authRoutes);
app.use('/api/accounts', accountsRoutes);
app.use('/api/transfer', transferRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/sync', syncRoutes);

// 管理后台页面
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

app.get('/admin/user', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin-user.html'));
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// 初始化数据库并启动服务器
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('数据库初始化失败:', err);
  process.exit(1);
});

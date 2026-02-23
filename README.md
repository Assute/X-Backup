# X Backup

一个用于备份和转移 X (Twitter) 账号关注列表和点赞数据的 Chrome 扩展工具。

## 功能特性

- **账号管理** - 支持添加多个 X 账号，自动获取账号信息
- **数据备份** - 一键同步并备份关注列表和点赞记录
- **实时同步** - 自动监听并同步你在 X 上的关注/取关、点赞/取消点赞操作
- **数据转移** - 将一个账号的关注和点赞数据批量转移到另一个账号
- **限流保护** - 可配置的执行频率，避免触发 X 的风控限制
- **任务管理** - 支持暂停、继续、删除转移任务，实时查看执行日志

## 项目结构

```
x关注/
├── extension/          # Chrome 扩展
│   ├── manifest.json   # 扩展配置
│   ├── popup.html      # 弹窗界面
│   ├── popup.js        # 弹窗逻辑
│   ├── popup.css       # 样式
│   ├── background.js   # 后台服务
│   ├── content.js      # 内容脚本
│   ├── inject.js       # 注入脚本（监听请求）
│   └── icons/          # 图标
└── server/             # 后端服务
    ├── src/
    │   ├── index.js    # 入口文件
    │   ├── routes/     # API 路由
    │   └── services/   # 服务层
    ├── data/           # SQLite 数据库
    └── .env            # 环境配置
```

## 安装

### 1. 启动后端服务

**快速下载：**

```bash
wget https://github.com/Assute/X-Backup/releases/latest/download/server.zip && unzip server.zip && cd server && npm install && npm start
```

**或使用 curl：**

```bash
curl -L -o server.zip https://github.com/Assute/X-Backup/releases/latest/download/server.zip && unzip server.zip && cd server && npm install && npm start
```

**或使用 Git 克隆：**

```bash
git clone https://github.com/Assute/X-Backup.git
cd X-Backup/server
npm install
npm start
```

服务默认运行在 `http://localhost:5500`

### 2. 安装 Chrome 扩展

1. 打开 Chrome 浏览器，进入 `chrome://extensions/`
2. 开启右上角的「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `extension` 文件夹

## 使用说明

### 配置服务器

1. 点击扩展图标打开面板
2. 首次使用会显示服务器配置页面
3. 输入后端服务器地址（如 `http://localhost:5500`）
4. 点击「连接服务器」，连接成功后进入登录页面
5. 登录后如需修改服务器地址，点击右上角齿轮图标

### 添加账号

1. 先在浏览器中登录你的 X 账号
2. 点击扩展图标打开面板
3. 注册/登录后，点击「获取当前X账号」
4. 系统会自动获取账号信息并同步数据

### 数据同步

- **手动同步**: 点击账号卡片上的「同步数据」按钮
- **自动同步**: 当你在 X 上进行关注/点赞操作时，扩展会自动同步到服务器

### 创建转移任务

1. 确保已添加至少 2 个账号
2. 切换到「任务」标签页
3. 点击「创建转移任务」
4. 选择源账号（数据来源）和目标账号（数据转入）
5. 点击「设置」可配置执行频率限制
6. 创建任务后点击「启动」开始执行

### 限流设置

默认配置：
- 执行间隔：5 分钟
- 每小时关注上限：5 个
- 每小时点赞上限：10 个
- 每天关注上限：20 个
- 每天点赞上限：30 个

## 环境配置

编辑 `server/.env` 文件：

```env
# 服务端口
PORT=5500

# JWT 密钥
JWT_SECRET=your-secret-key

# 代理配置（可选）
# PROXY_ENABLED=true
# PROXY_TYPE=http
# PROXY_HOST=127.0.0.1
# PROXY_PORT=10808
```

## 技术栈

- **前端**: Chrome Extension (Manifest V3)
- **后端**: Node.js + Express
- **数据库**: SQLite (sql.js)
- **认证**: JWT

## 注意事项

- 请合理使用本工具，避免频繁操作导致账号被限制
- 建议在限流设置中使用保守的数值
- 转移任务会在后台持续运行，关闭浏览器后任务会暂停
- 数据存储在本地服务器，请妥善保管

## License

MIT

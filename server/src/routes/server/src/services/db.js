const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'x-backup.db');

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let db = null;

// 初始化数据库
async function initDB() {
  const SQL = await initSqlJs();

  // 如果数据库文件存在，加载它
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // 初始化表
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      _id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      createdAt TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS x_accounts (
      _id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      xUserId TEXT NOT NULL,
      xUsername TEXT,
      xName TEXT,
      cookie TEXT,
      followingCount INTEGER DEFAULT 0,
      likesCount INTEGER DEFAULT 0,
      lastSyncAt TEXT,
      createdAt TEXT,
      UNIQUE(userId, xUserId)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS backups (
      _id TEXT PRIMARY KEY,
      xAccountId TEXT NOT NULL,
      type TEXT NOT NULL,
      data TEXT,
      createdAt TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      _id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      sourceAccountId TEXT,
      targetAccountId TEXT,
      status TEXT DEFAULT 'pending',
      rateLimitConfig TEXT,
      pendingFollows TEXT,
      pendingLikes TEXT,
      completedFollows TEXT,
      completedLikes TEXT,
      followHistory TEXT,
      likeHistory TEXT,
      logs TEXT,
      createdAt TEXT
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_xaccounts_user ON x_accounts(userId)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_backups_account ON backups(xAccountId, type)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(userId)`);

  // 迁移：添加缺失的列
  try {
    db.run(`ALTER TABLE tasks ADD COLUMN rateLimitConfig TEXT`);
  } catch (e) { /* 列已存在 */ }
  try {
    db.run(`ALTER TABLE tasks ADD COLUMN pendingFollows TEXT`);
  } catch (e) { /* 列已存在 */ }
  try {
    db.run(`ALTER TABLE tasks ADD COLUMN pendingLikes TEXT`);
  } catch (e) { /* 列已存在 */ }
  try {
    db.run(`ALTER TABLE tasks ADD COLUMN completedFollows TEXT`);
  } catch (e) { /* 列已存在 */ }
  try {
    db.run(`ALTER TABLE tasks ADD COLUMN completedLikes TEXT`);
  } catch (e) { /* 列已存在 */ }
  try {
    db.run(`ALTER TABLE tasks ADD COLUMN followHistory TEXT`);
  } catch (e) { /* 列已存在 */ }
  try {
    db.run(`ALTER TABLE tasks ADD COLUMN likeHistory TEXT`);
  } catch (e) { /* 列已存在 */ }
  try {
    db.run(`ALTER TABLE tasks ADD COLUMN logs TEXT`);
  } catch (e) { /* 列已存在 */ }

  saveDB();
}

// 保存数据库到文件
function saveDB() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }
}

// 包装器类
class Table {
  constructor(tableName, jsonFields = []) {
    this.table = tableName;
    this.jsonFields = jsonFields;
  }

  _parseRow(row) {
    if (!row) return null;
    const result = { ...row };
    for (const field of this.jsonFields) {
      if (result[field]) {
        try {
          result[field] = JSON.parse(result[field]);
        } catch (e) {
          result[field] = [];
        }
      }
    }
    return result;
  }

  _stringifyFields(data) {
    const result = { ...data };
    for (const field of this.jsonFields) {
      if (result[field] !== undefined) {
        result[field] = JSON.stringify(result[field]);
      }
    }
    return result;
  }

  _rowsToObjects(result) {
    if (!result || result.length === 0) return [];
    const columns = result[0].columns;
    const values = result[0].values;
    return values.map(row => {
      const obj = {};
      columns.forEach((col, i) => obj[col] = row[i]);
      return this._parseRow(obj);
    });
  }

  findAll(filter = {}) {
    const keys = Object.keys(filter);
    let sql = `SELECT * FROM ${this.table}`;
    let params = [];

    if (keys.length > 0) {
      const where = keys.map(k => `${k} = ?`).join(' AND ');
      sql += ` WHERE ${where}`;
      params = keys.map(k => filter[k]);
    }

    const result = db.exec(sql, params);
    return this._rowsToObjects(result);
  }

  findOne(filter) {
    const keys = Object.keys(filter);
    const where = keys.map(k => `${k} = ?`).join(' AND ');
    const params = keys.map(k => filter[k]);

    const result = db.exec(`SELECT * FROM ${this.table} WHERE ${where} LIMIT 1`, params);
    const rows = this._rowsToObjects(result);
    return rows[0] || null;
  }

  findById(id) {
    const result = db.exec(`SELECT * FROM ${this.table} WHERE _id = ?`, [id]);
    const rows = this._rowsToObjects(result);
    return rows[0] || null;
  }

  create(item) {
    const data = this._stringifyFields(item);
    const keys = Object.keys(data);
    const placeholders = keys.map(() => '?').join(', ');
    const values = keys.map(k => data[k]);

    db.run(`INSERT INTO ${this.table} (${keys.join(', ')}) VALUES (${placeholders})`, values);
    saveDB();
    return item;
  }

  update(id, updates) {
    const data = this._stringifyFields(updates);
    const keys = Object.keys(data);
    const setClause = keys.map(k => `${k} = ?`).join(', ');
    const values = [...keys.map(k => data[k]), id];

    db.run(`UPDATE ${this.table} SET ${setClause} WHERE _id = ?`, values);
    saveDB();
    return this.findById(id);
  }

  delete(id) {
    db.run(`DELETE FROM ${this.table} WHERE _id = ?`, [id]);
    saveDB();
    return true;
  }

  deleteMany(filter) {
    const keys = Object.keys(filter);
    const where = keys.map(k => `${k} = ?`).join(' AND ');
    const values = keys.map(k => filter[k]);
    db.run(`DELETE FROM ${this.table} WHERE ${where}`, values);
    saveDB();
    return true;
  }
}

// 数据库实例
const users = new Table('users');
const xAccounts = new Table('x_accounts');
const backups = new Table('backups', ['data']);
const tasks = new Table('tasks', ['rateLimitConfig', 'pendingFollows', 'pendingLikes', 'completedFollows', 'completedLikes', 'followHistory', 'likeHistory', 'logs']);

module.exports = {
  initDB,
  users,
  xAccounts,
  backups,
  tasks
};

/**
 * db.js — IndexedDB 简易封装
 *
 * 数据库：rss-reader
 * 表：
 *   feeds    → { id, url, title, articleCount }
 *   articles → { id, feedId, title, link, pubDate, summary, aiTags }
 *
 * 用法：
 *   await DB.open()
 *   await DB.feeds.put(feedObj)
 *   const all = await DB.feeds.getAll()
 *   await DB.articles.getByIndex('feedId', someFeedId)
 */

const DB = (() => {
  const DB_NAME    = 'rss-reader';
  const DB_VERSION = 1;

  let db = null;

  // ----- 内部：获取 / 创建对象仓库 -----
  function getStore(storeName, mode = 'readonly') {
    if (!db) throw new Error('数据库未打开，请先调用 DB.open()');
    const tx = db.transaction(storeName, mode);
    return tx.objectStore(storeName);
  }

  // ----- 打开 / 升级数据库 -----
  async function open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const _db = event.target.result;

        // feeds 表 — id 作主键
        if (!_db.objectStoreNames.contains('feeds')) {
          _db.createObjectStore('feeds', { keyPath: 'id' });
        }

        // articles 表 — id 作主键，feedId 建索引
        if (!_db.objectStoreNames.contains('articles')) {
          const store = _db.createObjectStore('articles', { keyPath: 'id' });
          store.createIndex('feedId', 'feedId', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        db = event.target.result;
        resolve();
      };

      request.onerror = () => reject(new Error('打开数据库失败: ' + request.error.message));
    });
  }

  // ----- 工具：生成通用 CRUD -----
  function createCRUD(storeName) {
    return {
      // 增 / 改
      put(obj) {
        return new Promise((resolve, reject) => {
          const store = getStore(storeName, 'readwrite');
          const req = store.put(obj);
          req.onsuccess = () => resolve();
          req.onerror   = () => reject(new Error(`写入 ${storeName} 失败: ${req.error.message}`));
        });
      },

      // 批量写入
      putAll(objs) {
        return new Promise((resolve, reject) => {
          const store = getStore(storeName, 'readwrite');
          let completed = 0;
          objs.forEach((obj, i, arr) => {
            const req = store.put(obj);
            req.onsuccess = () => {
              completed++;
              if (completed === arr.length) resolve();
            };
            req.onerror = () => reject(new Error(`批量写入 ${storeName} 失败: ${req.error.message}`));
          });
        });
      },

      // 查全部
      getAll() {
        return new Promise((resolve, reject) => {
          const store = getStore(storeName, 'readonly');
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result);
          req.onerror   = () => reject(new Error(`读取 ${storeName} 失败: ${req.error.message}`));
        });
      },

      // 查单个
      get(id) {
        return new Promise((resolve, reject) => {
          const store = getStore(storeName, 'readonly');
          const req = store.get(id);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror   = () => reject(new Error(`读取 ${storeName} 失败: ${req.error.message}`));
        });
      },

      // 删
      del(id) {
        return new Promise((resolve, reject) => {
          const store = getStore(storeName, 'readwrite');
          const req = store.delete(id);
          req.onsuccess = () => resolve();
          req.onerror   = () => reject(new Error(`删除 ${storeName} 失败: ${req.error.message}`));
        });
      },

      // 清空
      clear() {
        return new Promise((resolve, reject) => {
          const store = getStore(storeName, 'readwrite');
          const req = store.clear();
          req.onsuccess = () => resolve();
          req.onerror   = () => reject(new Error(`清空 ${storeName} 失败: ${req.error.message}`));
        });
      },

      // 按索引查
      getByIndex(indexName, value) {
        return new Promise((resolve, reject) => {
          const store = getStore(storeName, 'readonly');
          const index = store.index(indexName);
          const req = index.getAll(value);
          req.onsuccess = () => resolve(req.result);
          req.onerror   = () => reject(new Error(`索引查询失败: ${req.error.message}`));
        });
      },
    };
  }

  // ----- 公开 API -----
  return {
    open,
    feeds:    createCRUD('feeds'),
    articles: createCRUD('articles'),
  };
})();

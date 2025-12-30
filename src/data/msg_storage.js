/**
 * 数据层：用户消息的缓存
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { deriveStorageKey, encryptStorageData, decryptStorageData } from '../crypto/encryption.js';
import { hashData } from '../crypto/digest.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// src/data/msg_storage.js -> ../../data/user/messages
const CACHE_DIR = path.join(__dirname, '../../data/user/messages');

// Memory cache: { username: { msgId: msgData } }
const memoryCache = {};

// Storage keys: { username: Buffer }
const storageKeys = {};

/**
 * 使用用户身份初始化储存
 * @param {string} username - 用户名
 * @param {string} password - 密码
 */
export function initStorage(username, password) {
  storageKeys[username] = deriveStorageKey(username, password);
}

/**
 * 将对话信息加入到缓存中
 * @param {string} username - 用户名
 * @param {Object} messageData - 消息数据
 */
export function cacheMessage(username, messageData) {
  if (!memoryCache[username]) {
    memoryCache[username] = {};
  }

  // ID，唯一标识信息
  const idInput = `${messageData.senderPublicKey || 'unknown'}:${messageData.timestamp}:${messageData.content}`;
  const id = hashData(idInput);

  memoryCache[username][id] = {
    date: new Date(messageData.timestamp).toISOString(), // 消息的日期，用于排序
    content: messageData.content,                        // 消息的具体内容
    timestamp: messageData.timestamp,                    // 消息的时间戳，用于排序
    senderPublicKey: messageData.senderPublicKey,        // 自己的公钥
    senderName: messageData.senderName,                  // 自己的用户名
    peerPublicKey: messageData.peerPublicKey,            // 对方的公钥，两个公钥确定唯一会话
    // groupId: messageData.groupId,                        // 群组消息数据（群组消息缓存未实现）
    type: messageData.type                               // 消息类型
  };
}

/**
 * 将缓存储存到磁盘当中
 * @param {string} username - 特定用户缓存的 flush，不指定默认全部
 */
export function flushCache(username = null) {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }

    const usersToFlush = username ? [username] : Object.keys(memoryCache);
    const DAYS_MS = 3 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    for (const user of usersToFlush) {
      const filePath = path.join(CACHE_DIR, `${user}.json`);
      let messages = {};

      if (fs.existsSync(filePath)) {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        try {
          messages = JSON.parse(fileContent);
        } catch (e) {
          // console.error(`消息数据 Json 解析失败。 ${user}:`, e);
          messages = {};
        }
      }

      // flush 到磁盘上的内容需要提前加密，防止被攻击
      const key = storageKeys[user];
      const newMessages = memoryCache[user] || {};

      for (const [msgId, msgData] of Object.entries(newMessages)) {
        const msgToSave = { ...msgData };
        // 加密内存中的所有明文信息
        if (key && msgToSave.content && !msgToSave.isEncrypted) {
          msgToSave.content = encryptStorageData(msgToSave.content, key);
          msgToSave.isEncrypted = true;
        }
        messages[msgId] = msgToSave;
      }

      // 清理超过3天的消息
      for (const [msgId, msgData] of Object.entries(messages)) {
        const msgTime = new Date(msgData.timestamp).getTime();
        if (now - msgTime > DAYS_MS) {
          delete messages[msgId];
        }
      }

      fs.writeFileSync(filePath, JSON.stringify(messages, null, 2), 'utf8');
      
      // Clear memory cache for this user
      if (memoryCache[user]) {
        memoryCache[user] = {};
      }
    }
  } catch (error) {
    // console.error('缓存失败:', error);
  }
}

/**
 * 加载对话缓存
 * @param {string} username - 当前用户
 * @param {string} targetId - 对方的公钥
 * @param {string} type - 'direct' or 'group'
 * @returns {Array} 按时间排序的信息
 */
export function loadHistory(username, targetId, type) {
  try {
    const filePath = path.join(CACHE_DIR, `${username}.json`);
    let messages = {};
    if (fs.existsSync(filePath)) {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      try {
        messages = JSON.parse(fileContent);
      } catch (e) {
        messages = {};
      }
    }

    const history = [];
    const key = storageKeys[username];

    // 检查是否存在没有被缓存的信息
    const memMessages = memoryCache[username] || {};
    const allMessages = { ...messages, ...memMessages };

    for (const msg of Object.values(allMessages)) {
      // Decrypt if needed
      let content = msg.content;
      if (msg.isEncrypted && key) {
          const decrypted = decryptStorageData(msg.content, key);
          if (decrypted) {
              content = decrypted;
          } else {
              content = '[无法解密的消息]';
          }
      } else if (msg.isEncrypted && !key) {
          content = '[未解锁的消息]';
      }

      const decodedMsg = { ...msg, content };

      if (type === 'direct') {
        // For DM, we want messages where:
        // 1. peerPublicKey == targetId (messages I sent to them, or they sent to me in a context where I recorded them as peer)
        // OR
        // 2. senderPublicKey == targetId (messages they sent to me)
        // AND
        // 3. type is direct_message
        
        // Note: When I send a message, I should record peerPublicKey = receiver.
        // When I receive a message, senderPublicKey is the sender.
        
        if (decodedMsg.type === 'direct_message') {
           if (decodedMsg.peerPublicKey === targetId || decodedMsg.senderPublicKey === targetId) {
             history.push(decodedMsg);
           }
        }
      } else if (type === 'group') {
        if (decodedMsg.type === 'group_message' && decodedMsg.groupId === targetId) {
          history.push(decodedMsg);
        }
      }
    }

    // 使用时间戳排序
    return history.sort((a, b) => new Date(a.date) - new Date(b.date));
  } catch (error) {
    console.error('Error loading history:', error);
    return [];
  }
}

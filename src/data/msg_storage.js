import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { deriveStorageKey, encryptStorageData, decryptStorageData } from '../crypto/encryption.js';
import { hashData } from '../crypto/digest.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CACHE_DIR = path.join(__dirname, '../../data/user/messages');

const memoryCache = {};
const storageKeys = {};

export function initStorage(username, password) {
  storageKeys[username] = deriveStorageKey(username, password);
}

// 用senderPublicKey+timestamp+content生成唯一ID
export function cacheMessage(username, messageData) {
  if (!memoryCache[username]) {
    memoryCache[username] = {};
  }

  const idInput = `${messageData.senderPublicKey || 'unknown'}:${messageData.timestamp}:${messageData.content}`;
  const id = hashData(idInput);

  memoryCache[username][id] = {
    date: new Date(messageData.timestamp).toISOString(),
    content: messageData.content,
    timestamp: messageData.timestamp,
    senderPublicKey: messageData.senderPublicKey,
    senderName: messageData.senderName,
    peerPublicKey: messageData.peerPublicKey,
    type: messageData.type
  };
}

// 写入磁盘前加密，清理3天前的消息
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
          messages = {};
        }
      }

      const key = storageKeys[user];
      const newMessages = memoryCache[user] || {};

      for (const [msgId, msgData] of Object.entries(newMessages)) {
        const msgToSave = { ...msgData };
        // 只加密明文，已加密的不重复加密
        if (key && msgToSave.content && !msgToSave.isEncrypted) {
          msgToSave.content = encryptStorageData(msgToSave.content, key);
          msgToSave.isEncrypted = true;
        }
        messages[msgId] = msgToSave;
      }

      // 删除3天前的消息
      for (const [msgId, msgData] of Object.entries(messages)) {
        const msgTime = new Date(msgData.timestamp).getTime();
        if (now - msgTime > DAYS_MS) {
          delete messages[msgId];
        }
      }

      fs.writeFileSync(filePath, JSON.stringify(messages, null, 2), 'utf8');
      
      if (memoryCache[user]) {
        memoryCache[user] = {};
      }
    }
  } catch (error) {
    // 忽略错误
  }
}

// 私聊匹配：peerPublicKey或senderPublicKey等于targetId
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

    const memMessages = memoryCache[username] || {};
    const allMessages = { ...messages, ...memMessages };

    for (const msg of Object.values(allMessages)) {
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

    return history.sort((a, b) => new Date(a.date) - new Date(b.date));
  } catch (error) {
    return [];
  }
}

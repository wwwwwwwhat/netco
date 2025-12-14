import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// src/data/msg_storage.js -> ../../data/user/messages
const CACHE_DIR = path.join(__dirname, '../../data/user/messages');

// Memory cache: { username: { msgId: msgData } }
const memoryCache = {};

/**
 * Add a message to the memory cache
 * @param {string} username - The username of the current user
 * @param {Object} messageData - The message data
 */
export function cacheMessage(username, messageData) {
  if (!memoryCache[username]) {
    memoryCache[username] = {};
  }

  // Generate ID
  const idInput = `${messageData.senderPublicKey || 'unknown'}:${messageData.timestamp}:${messageData.content}`;
  const id = crypto.createHash('sha256').update(idInput).digest('hex');

  memoryCache[username][id] = {
    date: new Date(messageData.timestamp).toISOString(),
    content: messageData.content,
    timestamp: messageData.timestamp,
    senderPublicKey: messageData.senderPublicKey,
    senderName: messageData.senderName,
    peerPublicKey: messageData.peerPublicKey, // The other party in DM
    groupId: messageData.groupId, // Group ID if group chat
    type: messageData.type // 'direct_message' or 'group_message'
  };
  
  // Flush immediately for persistence
  flushCache(username);
}

/**
 * Flush memory cache to disk
 * @param {string} username - The username to flush (optional, if null flush all)
 */
export function flushCache(username = null) {
  try {
    // Ensure directory exists
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }

    const usersToFlush = username ? [username] : Object.keys(memoryCache);

    for (const user of usersToFlush) {
      if (!memoryCache[user] || Object.keys(memoryCache[user]).length === 0) continue;

      const filePath = path.join(CACHE_DIR, `${user}.json`);
      let messages = {};

      if (fs.existsSync(filePath)) {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        try {
          messages = JSON.parse(fileContent);
        } catch (e) {
          console.error(`Error parsing message cache for ${user}:`, e);
          messages = {};
        }
      }

      // Merge memory cache into file cache
      Object.assign(messages, memoryCache[user]);

      fs.writeFileSync(filePath, JSON.stringify(messages, null, 2), 'utf8');
      console.log(`💾 [${user}] 缓存已写入磁盘 (${Object.keys(memoryCache[user]).length} 条新消息)`);
      
      // Clear memory cache for this user
      memoryCache[user] = {};
    }
  } catch (error) {
    console.error('Failed to flush cache:', error);
  }
}

/**
 * Load chat history with a specific peer or group
 * @param {string} username - Current username
 * @param {string} targetId - Peer Public Key or Group ID
 * @param {string} type - 'direct' or 'group'
 * @returns {Array} Sorted messages
 */
export function loadHistory(username, targetId, type) {
  try {
    const filePath = path.join(CACHE_DIR, `${username}.json`);
    if (!fs.existsSync(filePath)) {
      return [];
    }

    const fileContent = fs.readFileSync(filePath, 'utf8');
    const messages = JSON.parse(fileContent);
    const history = [];

    // Also check memory cache for latest messages not yet flushed
    const memMessages = memoryCache[username] || {};
    const allMessages = { ...messages, ...memMessages };

    for (const msg of Object.values(allMessages)) {
      if (type === 'direct') {
        // For DM, we want messages where:
        // 1. peerPublicKey == targetId (messages I sent to them, or they sent to me in a context where I recorded them as peer)
        // OR
        // 2. senderPublicKey == targetId (messages they sent to me)
        // AND
        // 3. type is direct_message
        
        // Note: When I send a message, I should record peerPublicKey = receiver.
        // When I receive a message, senderPublicKey is the sender.
        
        if (msg.type === 'direct_message') {
           if (msg.peerPublicKey === targetId || msg.senderPublicKey === targetId) {
             history.push(msg);
           }
        }
      } else if (type === 'group') {
        if (msg.type === 'group_message' && msg.groupId === targetId) {
          history.push(msg);
        }
      }
    }

    // Sort by timestamp
    return history.sort((a, b) => new Date(a.date) - new Date(b.date));
  } catch (error) {
    console.error('Error loading history:', error);
    return [];
  }
}

// Deprecated: saveMessage (kept for backward compatibility if needed, but redirected)
export function saveMessage(username, messageData) {
  cacheMessage(username, messageData);
}

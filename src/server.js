/**
 * HTTP API服务器 + WebSocket服务器
 * 为前端提供RESTful API和实时消息推送
 */

import './polyfill.js';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import { SecureSocialNetwork } from './index.js';
import { saveUser, loadUser } from './data/user_storage.js';
import { hashData } from './crypto/digest.js';
import { restoreKeyPair } from './crypto/identity.js';
import { cacheMessage, loadHistory, flushCache } from './data/msg_storage.js';
import { logError } from './data/logger.js';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Flush cache every 10 minutes
setInterval(() => {
  console.log('⏰ 定时缓存同步...');
  flushCache();
}, 10 * 60 * 1000);

// Flush cache on exit
process.on('exit', () => flushCache());
process.on('SIGINT', () => {
  flushCache();
  process.exit();
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 存储所有客户端实例和WebSocket连接
const clients = new Map(); // sessionId -> { network, ws, messageQueue }

/**
 * 创建WebSocket连接
 */
wss.on('connection', (ws, req) => {
  console.log('新的WebSocket连接');
  
  let sessionId = null;
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      
      if (data.type === 'register') {
        sessionId = data.sessionId;
        const client = clients.get(sessionId);
        if (client) {
          client.ws = ws;
          // 发送队列中的消息
          if (client.messageQueue && client.messageQueue.length > 0) {
            client.messageQueue.forEach(msg => {
              ws.send(JSON.stringify(msg));
            });
            client.messageQueue = [];
          }
        }
      }
    } catch (error) {
      console.error('WebSocket消息处理错误:', error);
    }
  });
  
  ws.on('close', () => {
    console.log('WebSocket连接关闭');
    // Flush cache for the user associated with this session if possible
    // Since we don't have easy access to username here without tracking it, we flush all for simplicity or improve tracking
    flushCache();
  });
});

/**
 * 发送消息到客户端
 */
function sendToClient(sessionId, message) {
  const client = clients.get(sessionId);
  if (!client) return;
  
  if (client.ws && client.ws.readyState === 1) {
    client.ws.send(JSON.stringify(message));
  } else {
    // WebSocket未连接，加入队列
    if (!client.messageQueue) {
      client.messageQueue = [];
    }
    client.messageQueue.push(message);
  }
}

/**
 * 设置消息处理器，将消息发送到前端并缓存
 */
function setupMessageHandlers(network, sessionId, username) {
  // 设置群组消息回调
  network.groupChat.setMessageCallback((messageData) => {
    // Save to cache
    cacheMessage(username, {
      ...messageData,
      type: 'group_message'
    });

    sendToClient(sessionId, {
      type: 'group_message',
      ...messageData
    });
  });
  
  // 设置私聊消息回调
  network.directMessage.setMessageCallback((messageData) => {
    // Save to cache
    cacheMessage(username, {
      ...messageData,
      type: 'direct_message'
    });

    sendToClient(sessionId, {
      type: 'direct_message',
      ...messageData
    });
  });

  // 设置好友请求回调
  network.directMessage.setContactRequestCallback((request) => {
    sendToClient(sessionId, {
      type: 'contact_request',
      ...request
    });
  });

  // 设置好友添加回调
  network.directMessage.setContactAddedCallback((contact) => {
    // Save to disk
    const currentUser = loadUser(username);
    const contacts = currentUser.contacts || [];
    const exists = contacts.some(c => c.publicKey === contact.publicKey);
    if (!exists) {
        contacts.push(contact);
        saveUser({
            username,
            contacts
        });
    }

    sendToClient(sessionId, {
      type: 'contact_added',
      contact
    });
  });

  // 设置状态变更回调
  network.directMessage.onContactStatusChangeCallback = (contact) => {
      sendToClient(sessionId, {
          type: 'contact_status_change',
          contact
      });
  };
}

// ========== API路由 ==========

/**
 * 注册
 */
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, port, bootstrapPeers } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }

    if (loadUser(username)) {
      return res.status(409).json({ error: '用户已存在' });
    }
    
    const sessionId = `${username}_${Date.now()}`;
    const network = new SecureSocialNetwork();
    
    await network.initialize(username, password, port || 0, bootstrapPeers || []);
    
    setupMessageHandlers(network, sessionId, username);
    
    clients.set(sessionId, {
      network,
      ws: null,
      messageQueue: []
    });
    
    saveUser({
      username,
      password,
      publicKey: network.getPublicKey(),
      secretKey: network.userKeyPair.secretKey,
      port: port || 0
    });
    
    res.json({
      sessionId,
      publicKey: network.getPublicKey(),
      username: network.getUsername(),
      nodeInfo: network.getNodeInfo()
    });
  } catch (error) {
    console.error('注册错误:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 登录
 */
app.post('/api/login', async (req, res) => {
  try {
    const { username, password, port, bootstrapPeers } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }

    const existingUser = loadUser(username);
    if (!existingUser) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const inputHash = hashData(password);
    if (existingUser.password !== inputHash && existingUser.password !== password) {
      return res.status(401).json({ error: '密码错误' });
    }
    
    const sessionId = `${username}_${Date.now()}`;
    const network = new SecureSocialNetwork();
    
    console.log(`📖 从文件加载用户 ${username} 的信息`);
    const keys = restoreKeyPair(existingUser.publicKey, existingUser.secretKey);

    await network.initialize(username, password, port || 0, bootstrapPeers || [], keys);
    
    // Load contacts from file
    if (existingUser.contacts) {
        console.log(`👥 加载 ${existingUser.contacts.length} 个联系人`);
        network.directMessage.loadContacts(existingUser.contacts);
    }

    // Auto-connect to other local clients (for testing/simulation)
    // This is crucial for local testing where MDNS might be slow or blocked
    setTimeout(async () => {
        console.log(`🔄 尝试自动连接其他本地客户端...`);
        for (const [otherSessionId, otherClient] of clients.entries()) {
          if (otherSessionId !== sessionId) {
            const otherAddresses = otherClient.network.p2pNode.getAddresses();
            let connected = false;
            for (const addr of otherAddresses) {
              // Try to connect to all available addresses
              try {
                 console.log(`   正在连接 ${otherClient.network.username} (${addr})...`);
                 await network.p2pNode.dial(addr);
                 console.log(`   ✅ 成功连接到 ${otherClient.network.username}`);
                 connected = true;
                 
                 // Also make the other node dial us back to ensure full connectivity (bidirectional)
                 const myAddresses = network.p2pNode.getAddresses();
                 for (const myAddr of myAddresses) {
                     try {
                        await otherClient.network.p2pNode.dial(myAddr);
                     } catch(e) {}
                 }
                 break; 
              } catch (e) {
                  console.log(`   ❌ 连接失败: ${e.message}`);
              }
            }
          }
        }
    }, 2000); // Wait 2 seconds for node to fully start

    setupMessageHandlers(network, sessionId, username);
    
    clients.set(sessionId, {
      network,
      ws: null,
      messageQueue: []
    });
    
    saveUser({
      username,
      password,
      publicKey: network.getPublicKey(),
      secretKey: network.userKeyPair.secretKey,
      port: port || 0
    });
    
    res.json({
      sessionId,
      publicKey: network.getPublicKey(),
      username: network.getUsername(),
      nodeInfo: network.getNodeInfo()
    });
  } catch (error) {
    console.error('登录错误:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 初始化 (兼容旧接口，自动判断登录或注册)
 */
app.post('/api/initialize', async (req, res) => {
  try {
    const { username, password, port, bootstrapPeers } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }
    
    const sessionId = `${username}_${Date.now()}`;
    const network = new SecureSocialNetwork();
    
    // Check if user exists
    const existingUser = loadUser(username);
    let keys = null;

    if (existingUser) {
      // Verify password
      const inputHash = hashData(password);
      // Handle legacy users without password hash or with plain text password
      const storedPassword = existingUser.password;
      
      // If stored password is not hashed (legacy), we might want to allow it or migrate it.
      // But for now, let's assume if it matches hash OR matches plain text (for backward compat if needed, though we just added hashing)
      // Actually, we just implemented hashing. Old users might have plain text.
      // Let's check if storedPassword matches inputHash.
      
      if (storedPassword !== inputHash) {
         // Fallback for legacy plain text password (optional, but good for dev)
         if (storedPassword !== password) {
             return res.status(401).json({ error: '密码错误' });
         }
      }
      
      console.log(`📖 从文件加载用户 ${username} 的信息`);
      keys = restoreKeyPair(existingUser.publicKey, existingUser.secretKey);
    }

    await network.initialize(username, password, port || 0, bootstrapPeers || [], keys);
    
    // 设置消息处理器
    setupMessageHandlers(network, sessionId, username);
    
    clients.set(sessionId, {
      network,
      ws: null,
      messageQueue: []
    });
    
    // Save user data (update last login)
    saveUser({
      username,
      password, // saveUser handles hashing
      publicKey: network.getPublicKey(),
      secretKey: network.userKeyPair.secretKey,
      port: port || 0
    });

    // Load contacts if any
    if (existingUser && existingUser.contacts) {
      existingUser.contacts.forEach(c => {
        network.directMessage.addContact(c.publicKey, c.username, c.peerId);
      });
    }
    
    res.json({
      sessionId,
      publicKey: network.getPublicKey(),
      username: network.getUsername(),
      nodeInfo: network.getNodeInfo()
    });
  } catch (error) {
    console.error('初始化错误:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 创建群组
 */
app.post('/api/groups', (req, res) => {
  try {
    const { sessionId, groupName } = req.body;
    const client = clients.get(sessionId);
    
    if (!client) {
      return res.status(404).json({ error: '会话不存在' });
    }
    
    const group = client.network.createGroup(groupName);
    res.json(group);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 加入群组
 */
app.post('/api/groups/join', (req, res) => {
  try {
    const { sessionId, groupId, groupName, sharedKey } = req.body;
    const client = clients.get(sessionId);
    
    if (!client) {
      return res.status(404).json({ error: '会话不存在' });
    }
    
    client.network.joinGroup(groupId, groupName, sharedKey);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 发送群组消息
 */
app.post('/api/groups/:groupId/messages', async (req, res) => {
  try {
    const { sessionId, content } = req.body;
    const { groupId } = req.params;
    const client = clients.get(sessionId);
    
    if (!client) {
      return res.status(404).json({ error: '会话不存在' });
    }
    
    await client.network.sendGroupMessage(groupId, content);

    // Cache sent message
    cacheMessage(client.network.getUsername(), {
      groupId,
      content,
      senderPublicKey: client.network.getPublicKey(),
      senderName: client.network.getUsername(),
      timestamp: Date.now(),
      type: 'group_message'
    });

    res.json({ success: true });
  } catch (error) {
    logError('API:sendGroupMessage', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 获取群组列表
 */
app.get('/api/groups', (req, res) => {
  try {
    const { sessionId } = req.query;
    const client = clients.get(sessionId);
    
    if (!client) {
      return res.status(404).json({ error: '会话不存在' });
    }
    
    const groups = client.network.listGroups();
    res.json(groups);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 离开群组
 */
app.delete('/api/groups/:groupId', (req, res) => {
  try {
    const { sessionId } = req.body;
    const { groupId } = req.params;
    const client = clients.get(sessionId);
    
    if (!client) {
      return res.status(404).json({ error: '会话不存在' });
    }
    
    client.network.leaveGroup(groupId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 开始私聊
 */
app.post('/api/direct-messages', (req, res) => {
  try {
    const { sessionId, peerPublicKey, peerName } = req.body;
    const client = clients.get(sessionId);
    
    if (!client) {
      return res.status(404).json({ error: '会话不存在' });
    }
    
    const conversationId = client.network.startDirectMessage(peerPublicKey, peerName);
    res.json({ conversationId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 发送私聊消息
 */
app.post('/api/direct-messages/:conversationId/messages', async (req, res) => {
  try {
    const { sessionId, content } = req.body;
    const { conversationId } = req.params;
    const client = clients.get(sessionId);
    
    if (!client) {
      return res.status(404).json({ error: '会话不存在' });
    }
    
    await client.network.sendDirectMessage(conversationId, content);

    // Cache sent message
    // Need to find peerPublicKey from conversationId
    const conversation = client.network.directMessage.conversations.get(conversationId);
    if (conversation) {
      cacheMessage(client.network.getUsername(), {
        peerPublicKey: conversation.peerPublicKey,
        content,
        senderPublicKey: client.network.getPublicKey(),
        senderName: client.network.getUsername(),
        timestamp: Date.now(),
        type: 'direct_message'
      });
    }

    res.json({ success: true });
  } catch (error) {
    logError('API:sendDirectMessage', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 获取联系人列表
 */
app.get('/api/contacts', (req, res) => {
  try {
    const { sessionId } = req.query;
    const client = clients.get(sessionId);
    
    if (!client) {
      return res.status(404).json({ error: '会话不存在' });
    }
    
    // Convert Map to Array
    const contacts = Array.from(client.network.directMessage.contacts.values());
    res.json(contacts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 发送好友请求
 */
app.post('/api/contacts/request', async (req, res) => {
  try {
    const { sessionId, targetPublicKey } = req.body;
    const client = clients.get(sessionId);
    
    if (!client) {
      return res.status(404).json({ error: '会话不存在' });
    }
    
    await client.network.directMessage.sendContactRequest(targetPublicKey);
    res.json({ success: true });
  } catch (error) {
    logError('API:sendContactRequest', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 响应好友请求
 */
app.post('/api/contacts/respond', async (req, res) => {
  try {
    const { sessionId, targetPublicKey, accepted, targetUsername, targetPeerId } = req.body;
    const client = clients.get(sessionId);
    
    if (!client) {
      return res.status(404).json({ error: '会话不存在' });
    }
    
    await client.network.directMessage.respondToContactRequest(targetPublicKey, accepted);
    
    if (accepted) {
      // Add to memory
      client.network.directMessage.addContact(targetPublicKey, targetUsername, targetPeerId);
      
      // Save to disk
      const currentUser = loadUser(client.network.getUsername());
      const contacts = currentUser.contacts || [];
      
      // Check if already exists
      const exists = contacts.some(c => c.publicKey === targetPublicKey);
      if (!exists) {
        contacts.push({ publicKey: targetPublicKey, username: targetUsername, peerId: targetPeerId, addedAt: Date.now() });
        saveUser({
          username: client.network.getUsername(),
          contacts
        });
      }
    }
    
    res.json({ success: true });
  } catch (error) {
    logError('API:respondContactRequest', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 获取节点信息
 */
app.get('/api/node-info', (req, res) => {
  try {
    const { sessionId } = req.query;
    const client = clients.get(sessionId);
    
    if (!client) {
      return res.status(404).json({ error: '会话不存在' });
    }
    
    const nodeInfo = client.network.getNodeInfo();
    res.json(nodeInfo);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 手动连接节点
 */
app.post('/api/network/connect', async (req, res) => {
  try {
    const { sessionId, multiaddr } = req.body;
    const client = clients.get(sessionId);
    
    if (!client) {
      return res.status(404).json({ error: '会话不存在' });
    }
    
    console.log(`🔗 手动连接节点: ${multiaddr}`);
    await client.network.p2pNode.dial(multiaddr);
    res.json({ success: true });
  } catch (error) {
    console.error('手动连接失败:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 获取用户公钥
 */
app.get('/api/public-key', (req, res) => {
  try {
    const { sessionId } = req.query;
    const client = clients.get(sessionId);
    
    if (!client) {
      return res.status(404).json({ error: '会话不存在' });
    }
    
    const publicKey = client.network.getPublicKey();
    res.json({ publicKey });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 获取历史消息
 */
app.get('/api/history', (req, res) => {
  try {
    const { sessionId, targetId, type } = req.query;
    const client = clients.get(sessionId);
    
    if (!client) {
      return res.status(404).json({ error: '会话不存在' });
    }
    
    const history = loadHistory(client.network.getUsername(), targetId, type);
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 服务器已启动`);
  console.log(`📡 HTTP API: http://localhost:${PORT}`);
  console.log(`🔌 WebSocket: ws://localhost:${PORT}`);
  console.log(`🌐 前端界面: http://localhost:${PORT}\n`);
});


/**
 * HTTP API服务器 + WebSocket服务器
 * 为前端提供RESTful API和实时消息推送
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import { SecureSocialNetwork } from './index.js';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

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
 * 设置消息处理器，将消息发送到前端
 */
function setupMessageHandlers(network, sessionId) {
  // 设置群组消息回调
  network.groupChat.setMessageCallback((messageData) => {
    sendToClient(sessionId, {
      type: 'group_message',
      ...messageData
    });
  });
  
  // 设置私聊消息回调
  network.directMessage.setMessageCallback((messageData) => {
    sendToClient(sessionId, {
      type: 'direct_message',
      ...messageData
    });
  });
}

// ========== API路由 ==========

/**
 * 初始化/登录
 */
app.post('/api/initialize', async (req, res) => {
  try {
    const { username, password, port, bootstrapPeers } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }
    
    const sessionId = `${username}_${Date.now()}`;
    const network = new SecureSocialNetwork();
    
    await network.initialize(username, password, port || 0, bootstrapPeers || []);
    
    // 设置消息处理器
    setupMessageHandlers(network, sessionId);
    
    clients.set(sessionId, {
      network,
      ws: null,
      messageQueue: []
    });
    
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
    res.json({ success: true });
  } catch (error) {
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
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 获取私聊列表
 */
app.get('/api/direct-messages', (req, res) => {
  try {
    const { sessionId } = req.query;
    const client = clients.get(sessionId);
    
    if (!client) {
      return res.status(404).json({ error: '会话不存在' });
    }
    
    const conversations = client.network.listDirectMessages();
    res.json(conversations);
  } catch (error) {
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 服务器已启动`);
  console.log(`📡 HTTP API: http://localhost:${PORT}`);
  console.log(`🔌 WebSocket: ws://localhost:${PORT}`);
  console.log(`🌐 前端界面: http://localhost:${PORT}\n`);
});


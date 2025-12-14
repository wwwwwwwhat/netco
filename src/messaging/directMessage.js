/**
 * 点对点即时通讯 (IM)
 * 通过共享频道ID实现两人私聊
 */

import crypto from 'crypto';
import { encryptMessage, decryptMessage } from '../crypto/encryption.js';

/**
 * 直接消息管理器
 */
export class DirectMessage {
  constructor(p2pNode, userKeyPair, username) {
    this.p2pNode = p2pNode;
    this.userKeyPair = userKeyPair;
    this.username = username;
    this.conversations = new Map(); // conversationId -> { peerPublicKey, peerName, topic }
    this.contacts = new Map(); // publicKey -> { username, peerId, status: 'online'|'offline' }
    this.onMessageCallback = null; // 消息回调函数
    this.onContactRequestCallback = null; // 好友请求回调
    this.onContactAddedCallback = null; // 好友添加回调
    this.onContactStatusChangeCallback = null; // 状态变更回调
    
    // 订阅自己的收件箱
    this.subscribeToInbox();

    // 启动心跳检测
    this.startHeartbeatLoop();
  }

  /**
   * 设置消息回调
   */
  setMessageCallback(callback) {
    this.onMessageCallback = callback;
  }

  /**
   * 设置好友请求回调
   */
  setContactRequestCallback(callback) {
    this.onContactRequestCallback = callback;
  }

  /**
   * 设置好友添加回调
   */
  setContactAddedCallback(callback) {
    this.onContactAddedCallback = callback;
  }

  /**
   * 设置状态变更回调
   */
  setContactStatusChangeCallback(callback) {
    this.onContactStatusChangeCallback = callback;
  }

  /**
   * 启动心跳循环
   */
  startHeartbeatLoop() {
    const HEARTBEAT_INTERVAL = 5 * 60 * 1000; // 5 minutes
    // const HEARTBEAT_INTERVAL = 30 * 1000; // 30 seconds for testing

    setInterval(() => {
        this.sendHeartbeats();
        this.checkOfflineStatus();
    }, HEARTBEAT_INTERVAL);
  }

  /**
   * 发送心跳包给所有联系人
   */
  async sendHeartbeats() {
    for (const [hexKey, contact] of this.contacts) {
        const topic = `inbox/${hexKey}`;
        const heartbeat = {
            type: 'heartbeat',
            senderPublicKey: Buffer.from(this.userKeyPair.publicKey, 'base64').toString('hex'),
            timestamp: Date.now()
        };
        
        // Fire and forget
        this.p2pNode.publish(topic, JSON.stringify(heartbeat)).catch(() => {});
    }
  }

  /**
   * 检查离线状态
   */
  checkOfflineStatus() {
    const TIMEOUT = 10 * 60 * 1000; // 10 minutes without heartbeat = offline
    const now = Date.now();
    
    for (const [hexKey, contact] of this.contacts) {
        if (contact.lastSeen && (now - contact.lastSeen > TIMEOUT)) {
            if (contact.status !== 'offline') {
                contact.status = 'offline';
                console.log(`💤 联系人 ${contact.username} 已离线 (超时)`);
                if (this.onContactStatusChangeCallback) {
                    this.onContactStatusChangeCallback(contact);
                }
            }
        }
    }
  }

  /**
   * 加载联系人列表
   */
  loadContacts(contactsList) {
    if (!contactsList || !Array.isArray(contactsList)) return;
    
    contactsList.forEach(c => {
        // 确保 Key 是 Hex
        let hexKey = c.publicKey;
        if (/[^0-9a-fA-F]/.test(c.publicKey)) {
             hexKey = Buffer.from(c.publicKey, 'base64').toString('hex');
        }
        
        this.contacts.set(hexKey, {
            ...c,
            publicKey: hexKey,
            status: 'offline', // 初始默认为离线，等待心跳或连接确认
            lastSeen: 0
        });
        
        // 尝试直接连接 (如果已知地址)
        if (c.addresses && Array.isArray(c.addresses)) {
            c.addresses.forEach(addr => {
                this.p2pNode.dial(addr).then(() => {
                    // 连接成功，标记为在线
                    const contact = this.contacts.get(hexKey);
                    if (contact) {
                        contact.status = 'online';
                        contact.lastSeen = Date.now();
                        if (this.onContactStatusChangeCallback) {
                            this.onContactStatusChangeCallback(contact);
                        }
                    }
                }).catch(() => {});
            });
        }

        // 发送握手请求以检测在线状态
        setTimeout(() => {
            this.sendContactRequest(hexKey).catch(() => {});
        }, 2000);
    });
  }

  /**
   * 订阅个人收件箱 (用于接收好友请求)
   */
  subscribeToInbox() {
    // 确保使用 Hex 格式订阅，避免 Base64 特殊字符问题
    // userKeyPair.publicKey 是 Base64 字符串 (由 restoreKeyPair 返回)
    // 我们需要将其解码为 Buffer 然后转为 Hex
    let myPublicKeyHex;
    if (typeof this.userKeyPair.publicKey === 'string') {
        // 假设是 Base64
        myPublicKeyHex = Buffer.from(this.userKeyPair.publicKey, 'base64').toString('hex');
    } else {
        // 假设是 Uint8Array/Buffer
        myPublicKeyHex = Buffer.from(this.userKeyPair.publicKey).toString('hex');
    }

    const inboxTopic = `inbox/${myPublicKeyHex}`;
    
    console.log(`📥 订阅收件箱: ${inboxTopic}`);
    
    this.p2pNode.subscribe(inboxTopic, (message) => {
      this.handleInboxMessage(message);
    });
  }

  /**
   * 处理收件箱消息
   */
  handleInboxMessage(message) {
    try {
      const data = JSON.parse(message.data);
      // console.log(`📨 收到消息: ${data.type} 来自 ${data.senderPublicKey || 'unknown'}`);
      
      if (data.type === 'contact_request') {
        console.log(`📩 收到好友请求: ${data.sender.username}`);
        
        // Normalize sender key to hex
        let senderHex = data.sender.publicKey;
        if (/[^0-9a-fA-F]/.test(senderHex)) {
             senderHex = Buffer.from(senderHex, 'base64').toString('hex');
        }

        if (this.contacts.has(senderHex)) {
            console.log(`🤝 自动接受已知联系人请求: ${data.sender.username}`);
            this.respondToContactRequest(senderHex, true);
            this.updateContactStatus(senderHex, 'online');
            
            // Update peerId if needed
            const contact = this.contacts.get(senderHex);
            if (contact && data.sender.peerId) {
                contact.peerId = data.sender.peerId;
            }
        } else {
            if (this.onContactRequestCallback) {
              this.onContactRequestCallback(data);
            }
        }
      } else if (data.type === 'contact_response_encrypted') {
        // 解密响应
        const senderKeyBytes = new Uint8Array(Buffer.from(data.senderPublicKey, 'hex'));
        const mySecretKeyBytes = new Uint8Array(Buffer.from(this.userKeyPair.secretKey, 'base64'));
        
        const decryptedStr = decryptMessage(data.data, senderKeyBytes, mySecretKeyBytes);
        
        if (decryptedStr) {
            const info = JSON.parse(decryptedStr);
            console.log(`📩 收到加密好友响应: ${info.username} (${info.accepted ? '接受' : '拒绝'})`);
            
            if (info.accepted) {
                this.addContact(info.publicKey, info.username, info.userId, info.addresses);
                this.updateContactStatus(info.publicKey, 'online');
            }
        } else {
            console.error('❌ 解密好友响应失败');
        }
      } else if (data.type === 'heartbeat') {
          // 收到心跳，回复 ACK
          const senderHex = data.senderPublicKey;
          const topic = `inbox/${senderHex}`;
          const ack = {
              type: 'heartbeat_ack',
              senderPublicKey: Buffer.from(this.userKeyPair.publicKey, 'base64').toString('hex'),
              timestamp: Date.now()
          };
          this.p2pNode.publish(topic, JSON.stringify(ack)).catch(() => {});
          
          // 同时更新发送者状态为在线
          this.updateContactStatus(senderHex, 'online');
          
      } else if (data.type === 'heartbeat_ack') {
          // 收到 ACK，更新状态
          this.updateContactStatus(data.senderPublicKey, 'online');
      } else if (data.type === 'direct_message') {
        // 处理私聊消息
        const senderKeyBytes = new Uint8Array(Buffer.from(data.senderPublicKey, 'hex'));
        const mySecretKeyBytes = new Uint8Array(Buffer.from(this.userKeyPair.secretKey, 'base64'));
        
        const decryptedContent = decryptMessage(data.content, senderKeyBytes, mySecretKeyBytes);
        
        if (decryptedContent && this.onMessageCallback) {
            const contact = this.contacts.get(data.senderPublicKey);
            const senderName = contact ? contact.username : 'Unknown';
            
            // Update status to online immediately upon receiving a message
            this.updateContactStatus(data.senderPublicKey, 'online');

            this.onMessageCallback({
                sender: senderName,
                senderPublicKey: data.senderPublicKey,
                content: decryptedContent,
                timestamp: data.timestamp
            });
        }
      }
    } catch (error) {
      console.error('处理收件箱消息失败:', error);
    }
  }

  /**
   * 更新联系人状态
   */
  updateContactStatus(publicKeyHex, status) {
      const contact = this.contacts.get(publicKeyHex);
      if (contact) {
          contact.lastSeen = Date.now();
          if (contact.status !== status) {
              contact.status = status;
              console.log(`📶 联系人 ${contact.username} 状态更新: ${status}`);
              if (this.onContactStatusChangeCallback) {
                  this.onContactStatusChangeCallback(contact);
              }
          }
      }
  }

  /**
   * 开始与某人对话
   */
  startConversation(peerPublicKey, peerName) {
    // Check if conversation already exists
    for (const [id, conv] of this.conversations) {
        if (conv.peerPublicKey === peerPublicKey) {
            return id;
        }
    }
    
    const conversationId = crypto.randomUUID();
    this.conversations.set(conversationId, {
        peerPublicKey,
        peerName,
        topic: `inbox/${peerPublicKey}`
    });
    
    return conversationId;
  }

  /**
   * 发送好友请求
   */
  async sendContactRequest(targetPublicKey) {
    // 统一转换为 Hex 格式作为 Topic
    let hexKey;
    
    // 检测是否为 Base64 (包含非 Hex 字符)
    const isBase64 = /[^0-9a-fA-F]/.test(targetPublicKey);
    
    if (typeof targetPublicKey === 'string') {
        if (isBase64) {
            // Base64 -> Hex
            hexKey = Buffer.from(targetPublicKey, 'base64').toString('hex');
        } else {
            // 已经是 Hex
            hexKey = targetPublicKey;
        }
    } else {
        // Buffer/Uint8Array -> Hex
        hexKey = Buffer.from(targetPublicKey).toString('hex');
    }
    
    const topic = `inbox/${hexKey}`;
    
    // 获取自己的 Hex 公钥
    let myPublicKeyHex;
    if (typeof this.userKeyPair.publicKey === 'string') {
        myPublicKeyHex = Buffer.from(this.userKeyPair.publicKey, 'base64').toString('hex');
    } else {
        myPublicKeyHex = Buffer.from(this.userKeyPair.publicKey).toString('hex');
    }

    const request = {
      type: 'contact_request',
      sender: {
        publicKey: myPublicKeyHex,
        username: this.username,
        peerId: this.p2pNode.getPeerId()
      },
      timestamp: Date.now()
    };
    
    console.log(`📤 发送好友请求到: ${topic}`);
    await this.waitForSubscribersAndPublish(topic, JSON.stringify(request));
  }

  /**
   * 等待订阅者并发布消息
   */
  async waitForSubscribersAndPublish(topic, message) {
    let attempts = 0;
    const maxAttempts = 20; // 10 seconds total
    
    // 立即尝试一次
    const initialSubscribers = this.p2pNode.getSubscribers(topic);
    if (initialSubscribers.length > 0) {
        console.log(`✅ 目标主题 ${topic} 有 ${initialSubscribers.length} 个订阅者 (立即发送)`);
        await this.p2pNode.publish(topic, message);
        return;
    }

    console.log(`⏳ 等待订阅者出现 (${topic})...`);
    
    while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const subscribers = this.p2pNode.getSubscribers(topic);
        if (subscribers.length > 0) {
            console.log(`✅ 目标主题 ${topic} 有 ${subscribers.length} 个订阅者 (尝试 ${attempts + 1})`);
            break;
        }
        
        // 如果是最后一次尝试，我们尝试强制刷新一下连接（如果可能）
        if (attempts === maxAttempts - 2) {
             console.log(`⚠️  订阅者仍未出现，尝试重新广播...`);
        }
        
        attempts++;
    }
    
    // 无论是否找到订阅者，最后都尝试发送一次（也许是 floodsub 生效了但 getSubscribers 没更新）
    await this.p2pNode.publish(topic, message);
  }

  /**
   * 响应好友请求
   */
  async respondToContactRequest(targetPublicKey, accepted) {
    // 统一转换为 Hex 格式作为 Topic
    let hexKey;
    // 检测是否为 Base64 (包含非 Hex 字符)
    const isBase64 = /[^0-9a-fA-F]/.test(targetPublicKey);
    
    if (typeof targetPublicKey === 'string') {
        if (isBase64) {
            hexKey = Buffer.from(targetPublicKey, 'base64').toString('hex');
        } else {
            hexKey = targetPublicKey;
        }
    } else {
        hexKey = Buffer.from(targetPublicKey).toString('hex');
    }

    const topic = `inbox/${hexKey}`;
    
    let responseData;
    
    // 获取自己的 Hex 公钥
    let myPublicKeyHex;
    if (typeof this.userKeyPair.publicKey === 'string') {
        myPublicKeyHex = Buffer.from(this.userKeyPair.publicKey, 'base64').toString('hex');
    } else {
        myPublicKeyHex = Buffer.from(this.userKeyPair.publicKey).toString('hex');
    }

    // 准备自己的私钥 (Uint8Array)
    let mySecretKeyBytes;
    if (typeof this.userKeyPair.secretKey === 'string') {
        mySecretKeyBytes = new Uint8Array(Buffer.from(this.userKeyPair.secretKey, 'base64'));
    } else {
        mySecretKeyBytes = this.userKeyPair.secretKey;
    }

    if (accepted) {
        const myInfo = {
            accepted: true,
            username: this.username,
            userId: this.p2pNode.getPeerId(),
            publicKey: myPublicKeyHex,
            addresses: this.p2pNode.getAddresses(),
            status: 'online'
        };
        
        // 加密信息
        const targetKeyBytes = new Uint8Array(Buffer.from(hexKey, 'hex'));
        const encrypted = encryptMessage(JSON.stringify(myInfo), targetKeyBytes, mySecretKeyBytes);
        
        responseData = {
            type: 'contact_response_encrypted',
            senderPublicKey: myInfo.publicKey,
            data: encrypted
        };
    } else {
        // 拒绝时只发送基本信息
        const targetKeyBytes = new Uint8Array(Buffer.from(hexKey, 'hex'));
        const encrypted = encryptMessage(JSON.stringify({ accepted: false, username: this.username }), targetKeyBytes, mySecretKeyBytes);

        responseData = {
            type: 'contact_response_encrypted',
            senderPublicKey: myPublicKeyHex,
            data: encrypted
        };
    }
    
    console.log(`📤 发送好友响应到: ${topic}`);
    await this.waitForSubscribersAndPublish(topic, JSON.stringify(responseData));
  }

  /**
   * 发送私聊消息
   */
  async sendMessage(recipientOrConvId, content) {
    let recipientPublicKey = recipientOrConvId;
    
    // Check if it's a conversation ID
    if (this.conversations.has(recipientOrConvId)) {
        recipientPublicKey = this.conversations.get(recipientOrConvId).peerPublicKey;
    }

    // 1. Normalize recipient key to Hex
    let hexKey = recipientPublicKey;
    if (/[^0-9a-fA-F]/.test(recipientPublicKey)) {
         hexKey = Buffer.from(recipientPublicKey, 'base64').toString('hex');
    }

    // 2. Prepare keys
    const targetKeyBytes = new Uint8Array(Buffer.from(hexKey, 'hex'));
    let mySecretKeyBytes;
    if (typeof this.userKeyPair.secretKey === 'string') {
        mySecretKeyBytes = new Uint8Array(Buffer.from(this.userKeyPair.secretKey, 'base64'));
    } else {
        mySecretKeyBytes = this.userKeyPair.secretKey;
    }
    
    // 3. Encrypt content
    const encryptedContent = encryptMessage(content, targetKeyBytes, mySecretKeyBytes);
    
    // 4. Prepare message payload
    let myPublicKeyHex;
    if (typeof this.userKeyPair.publicKey === 'string') {
        myPublicKeyHex = Buffer.from(this.userKeyPair.publicKey, 'base64').toString('hex');
    } else {
        myPublicKeyHex = Buffer.from(this.userKeyPair.publicKey).toString('hex');
    }

    const message = {
        type: 'direct_message',
        senderPublicKey: myPublicKeyHex,
        content: encryptedContent,
        timestamp: Date.now()
    };

    // 5. Publish
    const topic = `inbox/${hexKey}`;
    console.log(`📤 发送私聊消息到: ${topic}`);
    await this.waitForSubscribersAndPublish(topic, JSON.stringify(message));
    
    return message;
  }

  /**
   * 添加联系人
   */
  addContact(publicKey, username, peerId, addresses = []) {
    let hexKey;
    
    if (typeof publicKey === 'string') {
        // Check if it contains non-hex characters (likely Base64)
        if (/[^0-9a-fA-F]/.test(publicKey)) {
             hexKey = Buffer.from(publicKey, 'base64').toString('hex');
        } else {
             hexKey = publicKey;
        }
    } else {
        hexKey = Buffer.from(publicKey).toString('hex');
    }
    
    const contact = {
        publicKey: hexKey,
        username,
        peerId,
        addresses,
        status: 'online', // 初始状态在线
        addedAt: Date.now(),
        lastSeen: Date.now()
    };

    if (!this.contacts.has(hexKey)) {
      this.contacts.set(hexKey, contact);
      console.log(`✅ 添加联系人: ${username}`);
      
      if (this.onContactAddedCallback) {
          this.onContactAddedCallback(contact);
      }
    } else {
        // Update existing contact
        const existing = this.contacts.get(hexKey);
        Object.assign(existing, contact);
        // If we are updating, we might want to notify UI too if status changed or just to be safe
        if (this.onContactAddedCallback) {
             this.onContactAddedCallback(existing);
        }
    }
  }
}

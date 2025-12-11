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
    this.onMessageCallback = null; // 消息回调函数
  }

  /**
   * 设置消息回调
   * @param {Function} callback - 回调函数 (conversationId, peerName, senderName, content, timestamp)
   */
  setMessageCallback(callback) {
    this.onMessageCallback = callback;
  }

  /**
   * 生成会话ID (基于两个公钥的哈希)
   * @param {string} publicKey1 - 公钥1
   * @param {string} publicKey2 - 公钥2
   * @returns {string} 会话ID
   */
  static generateConversationId(publicKey1, publicKey2) {
    // 确保会话ID对于两个用户是相同的 (排序后哈希)
    const keys = [publicKey1, publicKey2].sort();
    return crypto
      .createHash('sha256')
      .update(keys.join(':'))
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * 开始与某人的对话
   * @param {string} peerPublicKey - 对方的公钥
   * @param {string} peerName - 对方的用户名 (可选)
   * @returns {string} 会话ID
   */
  startConversation(peerPublicKey, peerName = 'Unknown') {
    // 生成会话ID
    const conversationId = DirectMessage.generateConversationId(
      this.userKeyPair.publicKey,
      peerPublicKey
    );

    // 检查是否已存在
    if (this.conversations.has(conversationId)) {
      console.log(`⚠️  已经有与 ${peerName} 的对话`);
      return conversationId;
    }

    // 生成主题 (私密频道)
    const topic = `dm/${conversationId}`;

    const conversation = {
      id: conversationId,
      peerPublicKey: peerPublicKey,
      peerName: peerName,
      topic: topic,
      startedAt: Date.now()
    };

    this.conversations.set(conversationId, conversation);

    // 订阅该频道
    this.subscribeToConversation(conversationId);

    console.log(`✅ 开始与 ${peerName} 的对话 (会话ID: ${conversationId})`);

    return conversationId;
  }

  /**
   * 订阅会话主题
   * @param {string} conversationId - 会话ID
   */
  subscribeToConversation(conversationId) {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      console.log(`⚠️  会话不存在: ${conversationId}`);
      return;
    }

    this.p2pNode.subscribe(conversation.topic, (message) => {
      this.handleDirectMessage(conversationId, message);
    });
  }

  /**
   * 处理接收到的直接消息
   * @param {string} conversationId - 会话ID
   * @param {Object} message - 收到的消息
   */
  handleDirectMessage(conversationId, message) {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return;

    try {
      // 解析消息
      const payload = JSON.parse(message.data);

      // 检查发送者是否是对话伙伴
      if (payload.senderPublicKey !== conversation.peerPublicKey) {
        console.log(`⚠️  收到未知发送者的消息`);
        return;
      }

      // 解密消息
      const decryptedContent = decryptMessage(
        payload.encryptedContent,
        this.userKeyPair.secretKeyRaw,
        Buffer.from(payload.senderPublicKey, 'base64')
      );

      if (!decryptedContent) {
        console.log(`⚠️  无法解密消息`);
        return;
      }

      // 显示消息
      console.log(`\n💬 [私聊] ${payload.senderName}: ${decryptedContent}`);
      console.log(`   时间: ${new Date(payload.timestamp).toLocaleString()}`);

      // 触发回调
      if (this.onMessageCallback) {
        this.onMessageCallback({
          conversationId: conversationId,
          peerName: conversation.peerName,
          senderName: payload.senderName,
          senderPublicKey: payload.senderPublicKey,
          content: decryptedContent,
          timestamp: payload.timestamp
        });
      }

    } catch (error) {
      console.error(`处理直接消息失败:`, error.message);
    }
  }

  /**
   * 发送直接消息
   * @param {string} conversationId - 会话ID
   * @param {string} content - 消息内容
   */
  async sendMessage(conversationId, content) {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      console.log(`⚠️  会话不存在: ${conversationId}`);
      return;
    }

    // 使用对方公钥加密消息
    const encryptedContent = encryptMessage(
      content,
      Buffer.from(conversation.peerPublicKey, 'base64'),
      this.userKeyPair.secretKeyRaw
    );

    // 构造消息载荷
    const payload = {
      type: 'direct_message',
      conversationId: conversationId,
      senderPublicKey: this.userKeyPair.publicKey,
      senderName: this.username,
      encryptedContent: encryptedContent,
      timestamp: Date.now()
    };

    // 发布到会话主题
    await this.p2pNode.publish(conversation.topic, JSON.stringify(payload));

    console.log(`✉️  已发送消息给 ${conversation.peerName}`);
  }

  /**
   * 结束会话
   * @param {string} conversationId - 会话ID
   */
  endConversation(conversationId) {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      console.log(`⚠️  会话不存在: ${conversationId}`);
      return;
    }

    // 取消订阅
    this.p2pNode.unsubscribe(conversation.topic);

    // 删除会话
    this.conversations.delete(conversationId);

    console.log(`👋 已结束与 ${conversation.peerName} 的对话`);
  }

  /**
   * 列出所有会话
   * @returns {Array} 会话列表
   */
  listConversations() {
    return Array.from(this.conversations.values()).map(conv => ({
      id: conv.id,
      peerName: conv.peerName,
      peerPublicKey: conv.peerPublicKey.substring(0, 16) + '...',
      topic: conv.topic
    }));
  }

  /**
   * 获取会话信息
   * @param {string} conversationId - 会话ID
   * @returns {Object|null} 会话信息
   */
  getConversation(conversationId) {
    return this.conversations.get(conversationId) || null;
  }

  /**
   * 通过对方公钥查找会话
   * @param {string} peerPublicKey - 对方公钥
   * @returns {Object|null} 会话信息
   */
  findConversationByPeerKey(peerPublicKey) {
    for (const conv of this.conversations.values()) {
      if (conv.peerPublicKey === peerPublicKey) {
        return conv;
      }
    }
    return null;
  }
}

export default DirectMessage;

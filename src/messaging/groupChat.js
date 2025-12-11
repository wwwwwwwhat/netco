/**
 * 群组聊天功能
 * 使用对称加密 + GossipSub主题实现
 */

import crypto from 'crypto';
import { symmetricEncrypt, symmetricDecrypt, generateTag } from '../crypto/encryption.js';

/**
 * 群组聊天管理器
 */
export class GroupChat {
  constructor(p2pNode, userKeyPair) {
    this.p2pNode = p2pNode;
    this.userKeyPair = userKeyPair;
    this.groups = new Map(); // groupId -> { name, sharedKey, members, topic }
    this.onMessageCallback = null; // 消息回调函数
  }

  /**
   * 设置消息回调
   * @param {Function} callback - 回调函数 (groupId, groupName, senderName, content, timestamp)
   */
  setMessageCallback(callback) {
    this.onMessageCallback = callback;
  }

  /**
   * 创建群组
   * @param {string} groupName - 群组名称
   * @param {string} groupId - 群组ID (可选,默认自动生成)
   * @returns {Object} 群组信息
   */
  createGroup(groupName, groupId = null) {
    // 生成群组ID (基于名称和时间戳)
    if (!groupId) {
      groupId = crypto
        .createHash('sha256')
        .update(`${groupName}:${Date.now()}`)
        .digest('hex')
        .substring(0, 16);
    }

    // 生成群组共享密钥 (32字节随机密钥)
    const sharedKey = crypto.randomBytes(32);

    // 生成GossipSub主题
    const topic = `group/${groupId}`;

    const group = {
      id: groupId,
      name: groupName,
      sharedKey: sharedKey,
      sharedKeyBase64: sharedKey.toString('base64'),
      members: [this.userKeyPair.publicKey],
      topic: topic,
      createdAt: Date.now()
    };

    this.groups.set(groupId, group);

    // 订阅群组主题
    this.subscribeToGroup(groupId);

    console.log(`✅ 群组已创建: ${groupName} (ID: ${groupId})`);
    console.log(`🔑 共享密钥: ${group.sharedKeyBase64}`);

    return {
      groupId: group.id,
      groupName: group.name,
      sharedKey: group.sharedKeyBase64,
      topic: group.topic
    };
  }

  /**
   * 加入群组 (需要群组ID和共享密钥)
   * @param {string} groupId - 群组ID
   * @param {string} groupName - 群组名称
   * @param {string} sharedKeyBase64 - Base64编码的共享密钥
   */
  joinGroup(groupId, groupName, sharedKeyBase64) {
    if (this.groups.has(groupId)) {
      console.log(`⚠️  已经加入群组: ${groupName}`);
      return;
    }

    const sharedKey = Buffer.from(sharedKeyBase64, 'base64');
    const topic = `group/${groupId}`;

    const group = {
      id: groupId,
      name: groupName,
      sharedKey: sharedKey,
      sharedKeyBase64: sharedKeyBase64,
      members: [],
      topic: topic,
      joinedAt: Date.now()
    };

    this.groups.set(groupId, group);

    // 订阅群组主题
    this.subscribeToGroup(groupId);

    console.log(`✅ 已加入群组: ${groupName} (ID: ${groupId})`);
  }

  /**
   * 订阅群组主题
   * @param {string} groupId - 群组ID
   */
  subscribeToGroup(groupId) {
    const group = this.groups.get(groupId);
    if (!group) {
      console.log(`⚠️  群组不存在: ${groupId}`);
      return;
    }

    this.p2pNode.subscribe(group.topic, (message) => {
      this.handleGroupMessage(groupId, message);
    });
  }

  /**
   * 处理接收到的群组消息
   * @param {string} groupId - 群组ID
   * @param {Object} message - 收到的消息
   */
  handleGroupMessage(groupId, message) {
    const group = this.groups.get(groupId);
    if (!group) return;

    try {
      // 解析消息
      const payload = JSON.parse(message.data);

      // 解密消息内容
      const decryptedContent = symmetricDecrypt(
        payload.encryptedContent,
        group.sharedKey
      );

      if (!decryptedContent) {
        console.log(`⚠️  无法解密群组消息 (可能不是群成员)`);
        return;
      }

      // 显示消息
      console.log(`\n💬 [${group.name}] ${payload.senderName}: ${decryptedContent}`);
      console.log(`   时间: ${new Date(payload.timestamp).toLocaleString()}`);

      // 触发回调
      if (this.onMessageCallback) {
        this.onMessageCallback({
          groupId: groupId,
          groupName: group.name,
          senderName: payload.senderName,
          senderPublicKey: payload.senderPublicKey,
          content: decryptedContent,
          timestamp: payload.timestamp
        });
      }

    } catch (error) {
      console.error(`处理群组消息失败:`, error.message);
    }
  }

  /**
   * 发送群组消息
   * @param {string} groupId - 群组ID
   * @param {string} content - 消息内容
   * @param {string} senderName - 发送者名称
   */
  async sendMessage(groupId, content, senderName) {
    const group = this.groups.get(groupId);
    if (!group) {
      console.log(`⚠️  群组不存在: ${groupId}`);
      return;
    }

    // 使用共享密钥加密消息
    const encryptedContent = symmetricEncrypt(content, group.sharedKey);

    // 构造消息载荷
    const payload = {
      type: 'group_message',
      groupId: groupId,
      senderPublicKey: this.userKeyPair.publicKey,
      senderName: senderName,
      encryptedContent: encryptedContent,
      timestamp: Date.now()
    };

    // 发布到群组主题
    await this.p2pNode.publish(group.topic, JSON.stringify(payload));

    console.log(`✉️  已发送群组消息到 [${group.name}]`);
  }

  /**
   * 离开群组
   * @param {string} groupId - 群组ID
   */
  leaveGroup(groupId) {
    const group = this.groups.get(groupId);
    if (!group) {
      console.log(`⚠️  群组不存在: ${groupId}`);
      return;
    }

    // 取消订阅
    this.p2pNode.unsubscribe(group.topic);

    // 删除群组
    this.groups.delete(groupId);

    console.log(`👋 已离开群组: ${group.name}`);
  }

  /**
   * 列出所有群组
   * @returns {Array} 群组列表
   */
  listGroups() {
    return Array.from(this.groups.values()).map(group => ({
      id: group.id,
      name: group.name,
      topic: group.topic,
      sharedKey: group.sharedKeyBase64,
      memberCount: group.members.length || '未知'
    }));
  }

  /**
   * 获取群组信息
   * @param {string} groupId - 群组ID
   * @returns {Object|null} 群组信息
   */
  getGroup(groupId) {
    return this.groups.get(groupId) || null;
  }
}

export default GroupChat;

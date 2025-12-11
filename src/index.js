/**
 * 去中心化安全社交网络 - 主入口
 * 整合身份层、网络层、安全层
 */

import { generateKeyPairFromCredentials, getUserId } from './crypto/identity.js';
import { createP2PNode, P2PNode } from './network/p2pNode.js';
import { GroupChat } from './messaging/groupChat.js';
import { DirectMessage } from './messaging/directMessage.js';

/**
 * 安全社交网络客户端
 */
export class SecureSocialNetwork {
  constructor() {
    this.userKeyPair = null;
    this.username = null;
    this.p2pNode = null;
    this.groupChat = null;
    this.directMessage = null;
    this.isInitialized = false;
  }

  /**
   * 初始化客户端 (登录/注册)
   * @param {string} username - 用户名
   * @param {string} password - 密码
   * @param {number} port - P2P监听端口
   * @param {Array} bootstrapPeers - 引导节点地址
   */
  async initialize(username, password, port = 0, bootstrapPeers = []) {
    console.log(`\n🚀 正在初始化安全社交网络...`);
    console.log(`👤 用户名: ${username}`);

    // 1. 生成密钥对
    console.log(`🔐 正在生成密钥对...`);
    this.userKeyPair = await generateKeyPairFromCredentials(username, password);
    this.username = username;

    const userId = getUserId(this.userKeyPair.publicKey);
    console.log(`✅ 密钥对已生成`);
    console.log(`   用户ID: ${userId}`);
    console.log(`   公钥: ${this.userKeyPair.publicKey.substring(0, 32)}...`);

    // 2. 创建P2P节点
    console.log(`\n🌐 正在创建P2P节点...`);
    const libp2pNode = await createP2PNode(port, bootstrapPeers);
    this.p2pNode = new P2PNode(libp2pNode);

    // 3. 初始化消息模块
    this.groupChat = new GroupChat(this.p2pNode, this.userKeyPair);
    this.directMessage = new DirectMessage(this.p2pNode, this.userKeyPair, this.username);

    this.isInitialized = true;
    console.log(`\n✅ 客户端初始化完成!`);
    console.log(`\n📝 可用功能:`);
    console.log(`   - 群组聊天 (Group Chat)`);
    console.log(`   - 点对点即时通讯 (Direct Message)`);
    console.log(`   - 端到端加密消息传输`);
  }

  /**
   * 检查是否已初始化
   */
  checkInitialized() {
    if (!this.isInitialized) {
      throw new Error('客户端未初始化,请先调用 initialize()');
    }
  }

  // === 群组功能 ===

  /**
   * 创建群组
   * @param {string} groupName - 群组名称
   * @returns {Object} 群组信息 (包含groupId和sharedKey)
   */
  createGroup(groupName) {
    this.checkInitialized();
    return this.groupChat.createGroup(groupName);
  }

  /**
   * 加入群组
   * @param {string} groupId - 群组ID
   * @param {string} groupName - 群组名称
   * @param {string} sharedKey - 共享密钥
   */
  joinGroup(groupId, groupName, sharedKey) {
    this.checkInitialized();
    this.groupChat.joinGroup(groupId, groupName, sharedKey);
  }

  /**
   * 发送群组消息
   * @param {string} groupId - 群组ID
   * @param {string} content - 消息内容
   */
  async sendGroupMessage(groupId, content) {
    this.checkInitialized();
    await this.groupChat.sendMessage(groupId, content, this.username);
  }

  /**
   * 离开群组
   * @param {string} groupId - 群组ID
   */
  leaveGroup(groupId) {
    this.checkInitialized();
    this.groupChat.leaveGroup(groupId);
  }

  /**
   * 列出所有群组
   * @returns {Array} 群组列表
   */
  listGroups() {
    this.checkInitialized();
    return this.groupChat.listGroups();
  }

  // === 点对点消息功能 ===

  /**
   * 开始与某人对话
   * @param {string} peerPublicKey - 对方的公钥
   * @param {string} peerName - 对方的用户名
   * @returns {string} 会话ID
   */
  startDirectMessage(peerPublicKey, peerName) {
    this.checkInitialized();
    return this.directMessage.startConversation(peerPublicKey, peerName);
  }

  /**
   * 发送私聊消息
   * @param {string} conversationId - 会话ID
   * @param {string} content - 消息内容
   */
  async sendDirectMessage(conversationId, content) {
    this.checkInitialized();
    await this.directMessage.sendMessage(conversationId, content);
  }

  /**
   * 结束对话
   * @param {string} conversationId - 会话ID
   */
  endDirectMessage(conversationId) {
    this.checkInitialized();
    this.directMessage.endConversation(conversationId);
  }

  /**
   * 列出所有对话
   * @returns {Array} 对话列表
   */
  listDirectMessages() {
    this.checkInitialized();
    return this.directMessage.listConversations();
  }

  // === 网络信息 ===

  /**
   * 获取节点信息
   * @returns {Object} 节点信息
   */
  getNodeInfo() {
    this.checkInitialized();
    return {
      peerId: this.p2pNode.getPeerId(),
      addresses: this.p2pNode.getAddresses(),
      connectedPeers: this.p2pNode.getConnectedPeers()
    };
  }

  /**
   * 获取用户公钥
   * @returns {string} 公钥
   */
  getPublicKey() {
    this.checkInitialized();
    return this.userKeyPair.publicKey;
  }

  /**
   * 获取用户名
   * @returns {string} 用户名
   */
  getUsername() {
    this.checkInitialized();
    return this.username;
  }

  /**
   * 停止客户端
   */
  async stop() {
    if (this.p2pNode) {
      await this.p2pNode.stop();
    }
    this.isInitialized = false;
    console.log(`\n👋 客户端已停止`);
  }
}

export default SecureSocialNetwork;

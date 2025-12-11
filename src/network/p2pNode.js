/**
 * 网络层 - libp2p节点封装
 * 使用 GossipSub 实现发布订阅模式
 */

import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { noise } from '@chainsafe/libp2p-noise';
import { mplex } from '@libp2p/mplex';
import { floodsub } from '@libp2p/floodsub';
import { identify } from '@libp2p/identify';

/**
 * 创建 libp2p 节点
 * @param {number} port - 监听端口
 * @param {Array} bootstrapPeers - 引导节点地址
 * @returns {Promise<Libp2p>} libp2p实例
 */
export async function createP2PNode(port = 0, bootstrapPeers = []) {
  const node = await createLibp2p({
    addresses: {
      listen: [`/ip4/0.0.0.0/tcp/${port}`]
    },
    transports: [tcp()],
    streamMuxers: [mplex()],
    connectionEncryption: [noise()],
    services: {
      identify: identify(),
      pubsub: floodsub(),
    },
    connectionManager: {
      minConnections: 0,
    },
  });

  // 启动节点
  await node.start();

  console.log(`✅ P2P节点已启动`);
  console.log(`📍 节点ID: ${node.peerId.toString()}`);

  const listenAddrs = node.getMultiaddrs();
  console.log(`🌐 监听地址:`);
  listenAddrs.forEach(addr => {
    console.log(`   ${addr.toString()}`);
  });

  // 连接到引导节点
  if (bootstrapPeers && bootstrapPeers.length > 0) {
    console.log(`🔗 正在连接引导节点...`);
    for (const peerAddr of bootstrapPeers) {
      try {
        await node.dial(peerAddr);
        console.log(`   ✓ 已连接: ${peerAddr}`);
      } catch (error) {
        console.log(`   ✗ 连接失败: ${peerAddr} - ${error.message}`);
      }
    }
  }

  return node;
}

/**
 * P2P节点包装类
 */
export class P2PNode {
  constructor(libp2pNode) {
    this.node = libp2pNode;
    this.subscriptions = new Map(); // topic -> callback
  }

  /**
   * 订阅主题
   * @param {string} topic - 主题名称
   * @param {Function} callback - 收到消息时的回调函数
   */
  subscribe(topic, callback) {
    if (this.subscriptions.has(topic)) {
      console.log(`⚠️  已经订阅了主题: ${topic}`);
      return;
    }

    // 订阅GossipSub主题
    this.node.services.pubsub.subscribe(topic);

    // 设置消息处理器
    const handler = (message) => {
      callback({
        from: message.from.toString(),
        data: new TextDecoder().decode(message.data),
        topic: message.topic
      });
    };

    this.node.services.pubsub.addEventListener('message', handler);
    this.subscriptions.set(topic, handler);

    console.log(`📻 已订阅主题: ${topic}`);
  }

  /**
   * 取消订阅主题
   * @param {string} topic - 主题名称
   */
  unsubscribe(topic) {
    if (!this.subscriptions.has(topic)) {
      console.log(`⚠️  未订阅主题: ${topic}`);
      return;
    }

    const handler = this.subscriptions.get(topic);
    this.node.services.pubsub.removeEventListener('message', handler);
    this.node.services.pubsub.unsubscribe(topic);
    this.subscriptions.delete(topic);

    console.log(`📻 已取消订阅: ${topic}`);
  }

  /**
   * 发布消息到主题
   * @param {string} topic - 主题名称
   * @param {string} message - 消息内容
   */
  async publish(topic, message) {
    const data = new TextEncoder().encode(message);
    await this.node.services.pubsub.publish(topic, data);
    console.log(`📤 已发送消息到主题 ${topic}: ${message.substring(0, 50)}...`);
  }

  /**
   * 获取订阅该主题的对等节点列表
   * @param {string} topic - 主题名称
   * @returns {Array} 对等节点ID数组
   */
  getPeers(topic) {
    return this.node.services.pubsub.getSubscribers(topic).map(peer => peer.toString());
  }

  /**
   * 获取连接的对等节点
   * @returns {Array} 对等节点ID数组
   */
  getConnectedPeers() {
    return this.node.getPeers().map(peer => peer.toString());
  }

  /**
   * 停止节点
   */
  async stop() {
    await this.node.stop();
    console.log(`🛑 P2P节点已停止`);
  }

  /**
   * 获取节点地址
   * @returns {Array} 多地址数组
   */
  getAddresses() {
    return this.node.getMultiaddrs().map(addr => addr.toString());
  }

  /**
   * 获取节点ID
   * @returns {string} 节点ID
   */
  getPeerId() {
    return this.node.peerId.toString();
  }
}

export default {
  createP2PNode,
  P2PNode
};

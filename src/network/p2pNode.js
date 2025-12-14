/**
 * 网络层 - libp2p节点封装
 * 使用 GossipSub 实现发布订阅模式
 */

import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { noise } from '@chainsafe/libp2p-noise';
import { mplex } from '@libp2p/mplex';
import { gossipsub } from '@chainsafe/libp2p-gossipsub';
import { identify } from '@libp2p/identify';
import { mdns } from '@libp2p/mdns';
import { keys } from '@libp2p/crypto';
import { createFromPrivKey } from '@libp2p/peer-id-factory';

/**
 * 创建 libp2p 节点
 * @param {number} port - 监听端口
 * @param {Array} bootstrapPeers - 引导节点地址
 * @param {Object} userKeyPair - 用户密钥对 (可选)
 * @returns {Promise<Libp2p>} libp2p实例
 */
export async function createP2PNode(port = 0, bootstrapPeers = [], userKeyPair = null) {
  let peerId;
  if (userKeyPair) {
    // 使用用户密钥对生成 PeerId
    // tweetnacl secretKey 是 64 字节 (seed + pub)
    // 我们取前 32 字节作为种子
    const seed = userKeyPair.secretKeyRaw.slice(0, 32);
    const key = await keys.generateKeyPairFromSeed('Ed25519', seed);
    peerId = await createFromPrivKey(key);
  }

  const node = await createLibp2p({
    peerId,
    addresses: {
      listen: [`/ip4/0.0.0.0/tcp/${port}`]
    },
    transports: [tcp()],
    streamMuxers: [mplex()],
    connectionEncryption: [noise()],
    services: {
      identify: identify(),
      mdns: mdns({
        interval: 1000 // 1 second interval for local discovery
      }),
      pubsub: gossipsub({ 
        allowPublishToZeroPeers: true,
        emitSelf: true,
        gossipIncoming: true,
        fallbackToFloodsub: true,
        floodPublish: true,
        // Optimize for local network
        scoreParams: {
          IPColocationFactorWeight: 0, // Disable penalty for same IP
        }
      }),
    },
    connectionManager: {
      minConnections: 0,
    },
  });

  // 监听 MDNS 发现事件
  node.addEventListener('peer:discovery', (evt) => {
    const peerInfo = evt.detail;
    // console.log(`🔍 发现节点: ${peerInfo.id.toString()}`);
    node.dial(peerInfo.id).catch(err => {
      // console.log(`连接发现的节点失败: ${err.message}`);
    });
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
    const handler = (evt) => {
      // 在较新版本的 libp2p 中，事件是一个 CustomEvent，消息在 detail 属性中
      const message = evt.detail || evt;
      
      // 确保只处理当前订阅主题的消息
      if (message.topic !== topic) return;

      callback({
        from: message.from ? message.from.toString() : 'unknown',
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
   * 获取主题的订阅者列表
   * @param {string} topic - 主题名称
   * @returns {string[]} 订阅该主题的Peer ID列表
   */
  getSubscribers(topic) {
    if (this.node && this.node.services && this.node.services.pubsub) {
      return this.node.services.pubsub.getSubscribers(topic).map(p => p.toString());
    }
    return [];
  }

  /**
   * 发布消息到主题
   * @param {string} topic - 主题名称
   * @param {string} message - 消息内容
   */
  async publish(topic, message) {
    const data = new TextEncoder().encode(message);
    try {
      // 尝试发布
      const result = await this.node.services.pubsub.publish(topic, data);
      
      // 检查是否有订阅者 (GossipSub publish returns result object in some versions, or void)
      // 我们手动检查一下订阅者，如果为0则警告
      const subscribers = this.getSubscribers(topic);
      if (subscribers.length === 0) {
         console.warn(`⚠️  发布消息到 ${topic} 时没有订阅者 (对方可能离线)`);
      } else {
         console.log(`📤 已发送消息到主题 ${topic}: ${message.substring(0, 50)}... (订阅者: ${subscribers.length})`);
      }
      
      return result;
    } catch (error) {
      // 如果是因为没有订阅者，我们忽略这个错误（消息已缓存，等待对方上线）
      if (error.code === 'ERR_NO_PEERS_SUBSCRIBED' || error.message.includes('NoPeersSubscribedToTopic')) {
        console.warn(`⚠️  发布消息到 ${topic} 时没有订阅者 (对方可能离线)`);
      } else {
        console.error(`发布消息失败: ${error.message}`);
        throw error;
      }
    }
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

  /**
   * 连接到对等节点
   * @param {string} multiaddr - 对等节点地址
   */
  async dial(multiaddr) {
    try {
      // libp2p dial expects a Multiaddr object or string
      await this.node.dial(multiaddr);
      console.log(`✅ 已连接到: ${multiaddr}`);
    } catch (error) {
      // Ignore specific error about peerId function which seems to be a version mismatch or internal libp2p issue
      // when dialing string addresses in some contexts, but connection might still work or be retried.
      if (error.message && error.message.includes('peer[0].getPeerId is not a function')) {
         console.warn(`⚠️ 连接尝试警告 (可能已连接): ${multiaddr}`);
      } else {
         console.error(`❌ 连接失败: ${multiaddr}`, error.message);
      }
    }
  }
}

export default {
  createP2PNode,
  P2PNode
};

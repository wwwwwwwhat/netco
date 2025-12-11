/**
 * 简化的P2P节点 - 不使用PubSub,改用自定义协议
 * 作为演示和教学用途
 */

import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { noise } from '@chainsafe/libp2p-noise';
import { mplex } from '@libp2p/mplex';
import { identify } from '@libp2p/identify';
import { pipe } from 'it-pipe';
import * as lp from 'it-length-prefixed';
import map from 'it-map';

/**
 * 创建简化的 P2P 节点
 */
export async function createSimpleP2PNode(port = 0, bootstrapPeers = []) {
  const node = await createLibp2p({
    addresses: {
      listen: [`/ip4/0.0.0.0/tcp/${port}`]
    },
    transports: [tcp()],
    streamMuxers: [mplex()],
    connectionEncryption: [noise()],
    services: {
      identify: identify()
    }
  });

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
 * 简化的P2P节点类
 */
export class SimpleP2PNode {
  constructor(libp2pNode) {
    this.node = libp2pNode;
    this.handlers = new Map(); // protocol -> handler
  }

  /**
   * 注册协议处理器
   */
  registerProtocol(protocol, handler) {
    this.node.handle(protocol, async ({ stream }) => {
      try {
        await pipe(
          stream,
          lp.decode,
          async function* (source) {
            for await (const msg of source) {
              const data = new TextDecoder().decode(msg.subarray());
              yield await handler(data);
            }
          },
          map(str => new TextEncoder().encode(str)),
          lp.encode,
          stream
        );
      } catch (error) {
        console.error(`协议处理错误:`, error.message);
      }
    });
    this.handlers.set(protocol, handler);
    console.log(`📝 已注册协议: ${protocol}`);
  }

  /**
   * 向对等节点发送消息
   */
  async sendToPeer(peerIdStr, protocol, message) {
    try {
      const stream = await this.node.dialProtocol(peerIdStr, protocol);

      await pipe(
        [new TextEncoder().encode(message)],
        lp.encode,
        stream,
        lp.decode,
        async function (source) {
          for await (const msg of source) {
            // 读取响应
            const response = new TextDecoder().decode(msg.subarray());
            console.log(`收到响应: ${response}`);
          }
        }
      );
    } catch (error) {
      console.error(`发送消息失败:`, error.message);
    }
  }

  /**
   * 广播消息给所有连接的节点
   */
  async broadcast(protocol, message) {
    const peers = this.node.getPeers();
    for (const peer of peers) {
      await this.sendToPeer(peer.toString(), protocol, message);
    }
  }

  /**
   * 获取连接的对等节点
   */
  getConnectedPeers() {
    return this.node.getPeers().map(peer => peer.toString());
  }

  /**
   * 获取节点地址
   */
  getAddresses() {
    return this.node.getMultiaddrs().map(addr => addr.toString());
  }

  /**
   * 获取节点ID
   */
  getPeerId() {
    return this.node.peerId.toString();
  }

  /**
   * 停止节点
   */
  async stop() {
    await this.node.stop();
    console.log(`🛑 P2P节点已停止`);
  }
}

export default {
  createSimpleP2PNode,
  SimpleP2PNode
};

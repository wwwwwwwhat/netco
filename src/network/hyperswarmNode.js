/**
 * 现代化网络层 - 基于 Hyperswarm
 * Hyperswarm 是专为 P2P 设计的现代框架
 *
 * 优势:
 * - 自动 NAT 穿透
 * - 内置 DHT 节点发现
 * - 自动连接管理
 * - 在同一台机器上也能工作
 * - 2024年仍在活跃维护
 */

import Hyperswarm from 'hyperswarm';
import b4a from 'b4a';
import crypto from 'crypto';

/**
 * Hyperswarm 节点包装类 (简化版)
 */
export class HyperswarmNode {
  constructor() {
    this.swarm = new Hyperswarm();
    this.topics = new Map(); // topic -> { key, discovery, handler }
    this.connections = new Set(); // 所有活跃连接

    console.log(`✅ Hyperswarm 节点已创建`);

    // 全局连接处理器 - 只设置一次
    this.swarm.on('connection', (conn) => {
      console.log(`🔗 新连接建立! 总连接数: ${this.connections.size + 1}`);

      this.connections.add(conn);

      // 处理接收到的消息
      conn.on('data', (data) => {
        try {
          const message = JSON.parse(data.toString());
          const topicName = message.topic;

          // 找到对应的主题处理器
          const topicData = this.topics.get(topicName);
          if (topicData && topicData.handler) {
            topicData.handler({
              from: message.from,
              data: message.content,
              topic: message.topic
            });
          }
        } catch (error) {
          // 忽略非JSON消息或解析错误
        }
      });

      conn.on('close', () => {
        this.connections.delete(conn);
        console.log(`🔌 连接关闭. 剩余连接数: ${this.connections.size}`);
      });

      conn.on('error', (err) => {
        console.error(`❌ 连接错误: ${err.message}`);
      });
    });
  }

  /**
   * 加入主题 (相当于订阅)
   * @param {string} topic - 主题名称
   * @param {Function} messageHandler - 消息处理函数
   */
  async joinTopic(topic, messageHandler) {
    if (this.topics.has(topic)) {
      console.log(`⚠️  已经加入主题: ${topic}`);
      return;
    }

    // 将主题字符串转换为 32 字节的 topic key
    const topicKey = crypto.createHash('sha256').update(topic).digest();

    // 加入 Hyperswarm topic
    const discovery = this.swarm.join(topicKey, {
      client: true,  // 作为客户端连接到其他节点
      server: true   // 也接受其他节点的连接
    });

    // 等待 DHT 发现完成
    await discovery.flushed();

    this.topics.set(topic, {
      key: topicKey,
      discovery: discovery,
      handler: messageHandler
    });

    console.log(`📻 已加入主题: ${topic}`);
    console.log(`   主题Key: ${b4a.toString(topicKey, 'hex').substring(0, 16)}...`);
  }

  /**
   * 离开主题
   * @param {string} topic - 主题名称
   */
  async leaveTopic(topic) {
    const topicData = this.topics.get(topic);
    if (!topicData) {
      console.log(`⚠️  未加入主题: ${topic}`);
      return;
    }

    // 离开主题 (停止发现)
    await topicData.discovery.destroy();

    this.topics.delete(topic);
    console.log(`📻 已离开主题: ${topic}`);
  }

  /**
   * 发布消息到主题
   * @param {string} topic - 主题名称
   * @param {string} message - 消息内容
   * @param {string} from - 发送者标识
   */
  async publish(topic, message, from = 'anonymous') {
    if (!this.topics.has(topic)) {
      console.log(`⚠️  未加入主题: ${topic}`);
      return;
    }

    const payload = JSON.stringify({
      topic: topic,
      from: from,
      content: message,
      timestamp: Date.now()
    });

    const buffer = Buffer.from(payload);

    // 发送到所有连接
    let sentCount = 0;
    for (const conn of this.connections) {
      try {
        conn.write(buffer);
        sentCount++;
      } catch (error) {
        console.error(`发送失败:`, error.message);
      }
    }

    // 简化日志：只显示主题和连接数，不显示消息内容
    if (sentCount > 0) {
      console.log(`📤 发送到 ${topic} (${sentCount} 个连接)`);
    }
  }

  /**
   * 获取节点统计信息
   * @returns {Object} 统计信息
   */
  getStats() {
    return {
      totalConnections: this.connections.size,
      topics: Array.from(this.topics.keys())
    };
  }

  /**
   * 停止节点
   */
  async stop() {
    // 离开所有主题
    for (const topic of Array.from(this.topics.keys())) {
      await this.leaveTopic(topic);
    }

    // 关闭所有连接
    for (const conn of this.connections) {
      conn.destroy();
    }

    // 关闭 swarm
    await this.swarm.destroy();
    console.log(`🛑 Hyperswarm 节点已停止`);
  }
}

export default HyperswarmNode;

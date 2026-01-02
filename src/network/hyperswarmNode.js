import Hyperswarm from 'hyperswarm';
import b4a from 'b4a';
import crypto from 'crypto';

export class HyperswarmNode {
  constructor() {
    this.swarm = new Hyperswarm();
    this.topics = new Map();
    this.connections = new Set();

    console.log(`✅ Hyperswarm 节点已创建`);

    this.swarm.on('connection', (conn) => {
      console.log(`🔗 新连接建立! 总连接数: ${this.connections.size + 1}`);

      this.connections.add(conn);

      conn.on('data', (data) => {
        try {
          const message = JSON.parse(data.toString());
          const topicName = message.topic;

          const topicData = this.topics.get(topicName);
          if (topicData && topicData.handler) {
            topicData.handler({
              from: message.from,
              data: message.content,
              topic: message.topic
            });
          }
        } catch (error) {
          // 忽略解析错误
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

  // 主题名hash成32字节key，等待DHT发现完成
  async joinTopic(topic, messageHandler) {
    if (this.topics.has(topic)) {
      console.log(`⚠️  已经加入主题: ${topic}`);
      return;
    }

    const topicKey = crypto.createHash('sha256').update(topic).digest();

    const discovery = this.swarm.join(topicKey, {
      client: true,
      server: true
    });

    await discovery.flushed();

    this.topics.set(topic, {
      key: topicKey,
      discovery: discovery,
      handler: messageHandler
    });

    console.log(`📻 已加入主题: ${topic}`);
    console.log(`   主题Key: ${b4a.toString(topicKey, 'hex').substring(0, 16)}...`);
  }

  async leaveTopic(topic) {
    const topicData = this.topics.get(topic);
    if (!topicData) {
      console.log(`⚠️  未加入主题: ${topic}`);
      return;
    }

    await topicData.discovery.destroy();

    this.topics.delete(topic);
    console.log(`📻 已离开主题: ${topic}`);
  }

  // 广播到所有连接，不保证送达
  async publish(topic, message, from = 'anonymous', silent = false) {
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

    let sentCount = 0;
    for (const conn of this.connections) {
      try {
        conn.write(buffer);
        sentCount++;
      } catch (error) {
        console.error(`发送失败:`, error.message);
      }
    }

    if (!silent && sentCount > 0) {
      console.log(`📤 发送到 ${topic} (${sentCount} 个连接)`);
    }
  }

  getStats() {
    return {
      totalConnections: this.connections.size,
      topics: Array.from(this.topics.keys())
    };
  }

  async stop() {
    for (const topic of Array.from(this.topics.keys())) {
      await this.leaveTopic(topic);
    }

    for (const conn of this.connections) {
      conn.destroy();
    }

    await this.swarm.destroy();
    console.log(`🛑 Hyperswarm 节点已停止`);
  }
}

export default HyperswarmNode;

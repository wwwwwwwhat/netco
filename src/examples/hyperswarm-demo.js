import '../polyfill.js';

/**
 * Hyperswarm 演示 - 现代化 P2P 网络
 * 可以在同一台机器上运行多个节点进行测试!
 */

import HyperswarmNode from '../network/hyperswarmNode.js';
import { generateKeyPairFromCredentials } from '../crypto/identity.js';
import { symmetricEncrypt, symmetricDecrypt } from '../crypto/encryption.js';
import crypto from 'crypto';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runDemo() {
  console.log(`\n========================================`);
  console.log(`  Hyperswarm 去中心化网络演示`);
  console.log(`  (同一台机器也能工作!)`)
  console.log(`========================================\n`);

  // 创建 Alice 的节点
  console.log(`👤 创建 Alice 的节点...`);
  const alice = new HyperswarmNode();
  const aliceKeys = await generateKeyPairFromCredentials('alice', 'password123');
  console.log(`✅ Alice: ${aliceKeys.publicKey.substring(0, 16)}...\n`);

  await sleep(1000);

  // 创建 Bob 的节点
  console.log(`👤 创建 Bob 的节点...`);
  const bob = new HyperswarmNode();
  const bobKeys = await generateKeyPairFromCredentials('bob', 'password456');
  console.log(`✅ Bob: ${bobKeys.publicKey.substring(0, 16)}...\n`);

  await sleep(1000);

  // === 演示: 群组聊天 ===
  console.log(`========================================`);
  console.log(`  群组聊天 (对称加密)`);
  console.log(`========================================\n`);

  // 生成群组共享密钥
  const groupKey = crypto.randomBytes(32);
  const groupTopic = 'test-group-123';

  console.log(`🔑 群组密钥: ${groupKey.toString('hex').substring(0, 32)}...`);
  console.log(`📻 群组主题: ${groupTopic}\n`);

  // Alice 加入群组
  console.log(`📻 Alice 加入群组...`);
  await alice.joinTopic(groupTopic, (message) => {
    try {
      const data = JSON.parse(message.data);
      const decrypted = symmetricDecrypt(data.content, groupKey);
      if (decrypted) {
        console.log(`\n💬 [群组] ${data.sender}: ${decrypted}`);
      }
    } catch (error) {
      // 忽略解密失败
    }
  });

  await sleep(1000);

  // Bob 加入群组
  console.log(`📻 Bob 加入群组...`);
  await bob.joinTopic(groupTopic, (message) => {
    try {
      const data = JSON.parse(message.data);
      const decrypted = symmetricDecrypt(data.content, groupKey);
      if (decrypted) {
        console.log(`\n💬 [群组] ${data.sender}: ${decrypted}`);
      }
    } catch (error) {
      // 忽略解密失败
    }
  });

  // 等待 DHT 发现和连接建立
  console.log(`\n⏳ 等待节点发现 (Hyperswarm 通过 DHT 自动连接)...`);
  await sleep(5000);

  // 显示当前状态
  console.log(`\n📊 当前连接状态:`);
  console.log(`   Alice: ${alice.getStats().totalConnections} 个连接`);
  console.log(`   Bob: ${bob.getStats().totalConnections} 个连接\n`);

  // Alice 发送消息
  console.log(`💬 Alice 发送消息...`);
  const aliceMsg = symmetricEncrypt('大家好! 这是 Hyperswarm!', groupKey);
  await alice.publish(
    groupTopic,
    JSON.stringify({ sender: 'Alice', content: aliceMsg })
  );

  await sleep(2000);

  // Bob 发送消息
  console.log(`\n💬 Bob 发送消息...`);
  const bobMsg = symmetricEncrypt('你好! 同一台机器也能通信!', groupKey);
  await bob.publish(
    groupTopic,
    JSON.stringify({ sender: 'Bob', content: bobMsg })
  );

  await sleep(2000);

  // 再发几条测试消息
  console.log(`\n💬 Alice 再发一条...`);
  const aliceMsg2 = symmetricEncrypt('Hyperswarm 自动 NAT 穿透真方便!', groupKey);
  await alice.publish(
    groupTopic,
    JSON.stringify({ sender: 'Alice', content: aliceMsg2 })
  );

  await sleep(1000);

  console.log(`\n💬 Bob 回复...`);
  await bob.publish(
    groupTopic,
    JSON.stringify({ sender: 'Bob', content: symmetricEncrypt('比 libp2p 配置简单多了!', groupKey) })
  );

  await sleep(3000);

  // 最终统计
  console.log(`\n\n========================================`);
  console.log(`  最终统计`);
  console.log(`========================================\n`);

  console.log(`Alice 节点:`);
  console.log(`  连接数: ${alice.getStats().totalConnections}`);
  console.log(`  主题: ${alice.getStats().topics.join(', ')}`);

  console.log(`\nBob 节点:`);
  console.log(`  连接数: ${bob.getStats().totalConnections}`);
  console.log(`  主题: ${bob.getStats().topics.join(', ')}`);

  console.log(`\n✅ 演示完成!`);
  console.log(`\n💡 Hyperswarm 优势:`);
  console.log(`   ✓ 自动 NAT 穿透`);
  console.log(`   ✓ 内置 DHT 节点发现`);
  console.log(`   ✓ 同一台机器也能工作`);
  console.log(`   ✓ 无需配置引导节点`);
  console.log(`   ✓ 2024年仍在维护 (比古老的 libp2p v0.46 更现代)`);

  // 保持运行
  console.log(`\n⏱️  保持运行 15 秒...`);
  await sleep(15000);

  // 清理
  console.log(`\n🧹 正在清理...`);
  await alice.stop();
  await bob.stop();

  console.log(`\n👋 测试结束!`);
  process.exit(0);
}

// 运行演示
runDemo().catch(error => {
  console.error('❌ 演示失败:', error);
  process.exit(1);
});

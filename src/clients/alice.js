/**
 * Alice 客户端 - 交互式聊天
 * 在一个终端窗口中运行
 */

import HyperswarmNode from '../network/hyperswarmNode.js';
import { generateKeyPairFromCredentials } from '../crypto/identity.js';
import { symmetricEncrypt, symmetricDecrypt } from '../crypto/encryption.js';
import crypto from 'crypto';
import * as readline from 'readline';

// 群组配置（Alice 和 Bob 事先约定好的）
const GROUP_TOPIC = 'secure-chat-demo';
// 共享密钥（实际应用中通过安全渠道分享，这里演示用固定值）
const SHARED_KEY = Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex');

console.log(`
╔═══════════════════════════════════════════════════════════╗
║                   Alice 的安全聊天客户端                     ║
╚═══════════════════════════════════════════════════════════╝
`);

async function main() {
  // 生成 Alice 的身份密钥
  console.log('🔐 正在生成 Alice 的身份密钥...');
  const aliceKeys = await generateKeyPairFromCredentials('alice', 'alice_password_123');
  console.log(`✅ Alice 的公钥: ${aliceKeys.publicKey.substring(0, 32)}...`);
  console.log(`📋 群组主题: ${GROUP_TOPIC}`);
  console.log(`🔑 共享密钥: ${SHARED_KEY.toString('hex').substring(0, 32)}...\n`);

  // 创建 P2P 节点
  console.log('🌐 正在创建 P2P 节点...');
  const alice = new HyperswarmNode();

  // 加入群组
  console.log(`📻 正在加入群组 "${GROUP_TOPIC}"...\n`);
  await alice.joinTopic(GROUP_TOPIC, (message) => {
    try {
      const data = JSON.parse(message.data);

      // 尝试解密
      const decrypted = symmetricDecrypt(data.content, SHARED_KEY);

      if (decrypted) {
        // 成功解密 - 显示消息
        const timestamp = new Date(data.timestamp).toLocaleTimeString();
        if (data.sender !== 'Alice') {
          console.log(`\n💬 [${timestamp}] ${data.sender}: ${decrypted}`);
          console.log('Alice> '); // 重新显示提示符
          process.stdout.write(''); // 刷新输出
        }
      } else {
        console.log(`\n⚠️  收到无法解密的消息（可能来自未授权者）`);
      }
    } catch (error) {
      // 忽略解析错误
    }
  });

  // 等待连接建立
  console.log('⏳ 等待其他节点加入...');
  await new Promise(resolve => setTimeout(resolve, 3000));

  console.log(`\n✅ 就绪！当前连接数: ${alice.getStats().totalConnections}`);
  console.log(`\n💡 提示：`);
  console.log(`   - 输入消息按回车发送`);
  console.log(`   - 输入 'exit' 退出`);
  console.log(`   - 输入 'stats' 查看统计信息\n`);

  // 创建交互式输入界面
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'Alice> '
  });

  rl.prompt();

  rl.on('line', async (input) => {
    const message = input.trim();

    if (message === 'exit') {
      console.log('\n👋 正在退出...');
      await alice.stop();
      rl.close();
      process.exit(0);
    } else if (message === 'stats') {
      const stats = alice.getStats();
      console.log(`\n📊 统计信息:`);
      console.log(`   连接数: ${stats.totalConnections}`);
      console.log(`   主题: ${stats.topics.join(', ')}\n`);
    } else if (message) {
      // 加密并发送消息
      const encrypted = symmetricEncrypt(message, SHARED_KEY);
      await alice.publish(
        GROUP_TOPIC,
        JSON.stringify({
          sender: 'Alice',
          content: encrypted,
          timestamp: Date.now()
        })
      );
      console.log(`✓ 已发送（加密）`);
    }

    rl.prompt();
  });

  rl.on('close', async () => {
    console.log('\n👋 Goodbye!');
    await alice.stop();
    process.exit(0);
  });
}

main().catch(error => {
  console.error('❌ 错误:', error);
  process.exit(1);
});

import '../polyfill.js';

/**
 * Eve 客户端 - 窃听者/攻击者
 * 在第三个终端窗口中运行
 * 演示：没有正确密钥的情况下无法解密消息
 */

import HyperswarmNode from '../network/hyperswarmNode.js';
import { generateKeyPairFromCredentials } from '../crypto/identity.js';
import { symmetricDecrypt } from '../crypto/encryption.js';
import crypto from 'crypto';
import * as readline from 'readline';

// Eve 知道群组主题（通过网络嗅探获得）
const GROUP_TOPIC = 'secure-chat-demo';

// Eve 尝试猜测密钥（但这是错误的）
const WRONG_KEY_1 = crypto.randomBytes(32);
const WRONG_KEY_2 = Buffer.from('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'hex');
const WRONG_KEY_3 = Buffer.from('0000000000000000000000000000000000000000000000000000000000000000', 'hex');

console.log(`
╔═══════════════════════════════════════════════════════════╗
║              Eve 的窃听程序（攻击者/未授权者）                  ║
║                                                           ║
║  演示：即使能监听到消息，没有正确密钥也无法解密               ║
╚═══════════════════════════════════════════════════════════╝
`);

async function main() {
  // 生成 Eve 的身份密钥
  console.log('🔐 正在生成 Eve 的身份密钥...');
  const eveKeys = await generateKeyPairFromCredentials('eve', 'eve_trying_to_hack');
  console.log(`✅ Eve 的公钥: ${eveKeys.publicKey.substring(0, 32)}...`);
  console.log(`📋 发现的群组主题: ${GROUP_TOPIC}`);
  console.log(`\n❌ Eve 没有正确的共享密钥！\n`);
  console.log(`🔍 Eve 尝试用以下密钥解密:`);
  console.log(`   密钥1: ${WRONG_KEY_1.toString('hex').substring(0, 32)}...`);
  console.log(`   密钥2: ${WRONG_KEY_2.toString('hex').substring(0, 32)}...`);
  console.log(`   密钥3: ${WRONG_KEY_3.toString('hex').substring(0, 32)}...\n`);

  // 创建 P2P 节点
  console.log('🌐 正在创建 P2P 节点（准备窃听）...');
  const eve = new HyperswarmNode();

  let messageCount = 0;
  let decryptAttempts = 0;

  // 加入群组（作为窃听者）
  console.log(`📻 正在加入群组 "${GROUP_TOPIC}" 进行监听...\n`);
  await eve.joinTopic(GROUP_TOPIC, (message) => {
    try {
      const data = JSON.parse(message.data);
      messageCount++;

      console.log(`\n🕵️  [监听 #${messageCount}] 截获加密消息！`);
      console.log(`   发送者: ${data.sender}`);
      console.log(`   时间: ${new Date(data.timestamp).toLocaleTimeString()}`);
      console.log(`   加密内容（前64字符）: ${data.content.substring(0, 64)}...`);
      console.log(`\n🔓 尝试破解...`);

      // 尝试用不同的密钥解密
      const keys = [WRONG_KEY_1, WRONG_KEY_2, WRONG_KEY_3];
      let cracked = false;

      for (let i = 0; i < keys.length; i++) {
        decryptAttempts++;
        const result = symmetricDecrypt(data.content, keys[i]);

        if (result) {
          console.log(`   ✓ 密钥${i + 1} 破解成功！内容: ${result}`);
          cracked = true;
          break;
        } else {
          console.log(`   ✗ 密钥${i + 1} 解密失败`);
        }
      }

      if (!cracked) {
        console.log(`\n❌ 破解失败！无法解密消息内容。`);
        console.log(`💡 这证明了端到端加密的安全性！`);
      }

      console.log(`\n📊 统计: 已截获 ${messageCount} 条消息，尝试解密 ${decryptAttempts} 次，成功 0 次`);
      console.log(`\nEve> `);
      process.stdout.write('');

    } catch (error) {
      // 忽略解析错误
    }
  });

  // 等待连接建立
  console.log('⏳ 等待网络连接...');
  await new Promise(resolve => setTimeout(resolve, 3000));

  console.log(`\n✅ 窃听程序就绪！当前连接数: ${eve.getStats().totalConnections}`);
  console.log(`\n💡 提示：`);
  console.log(`   - Eve 可以看到所有加密消息`);
  console.log(`   - 但无法解密它们`);
  console.log(`   - 这演示了端到端加密的重要性`);
  console.log(`   - 输入 'exit' 退出\n`);

  // 创建交互式输入界面（Eve 不能发消息，只能监听）
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'Eve> '
  });

  rl.prompt();

  rl.on('line', async (input) => {
    const message = input.trim();

    if (message === 'exit') {
      console.log('\n👋 停止窃听...');
      await eve.stop();
      rl.close();
      process.exit(0);
    } else if (message === 'stats') {
      const stats = eve.getStats();
      console.log(`\n📊 窃听统计:`);
      console.log(`   连接数: ${stats.totalConnections}`);
      console.log(`   截获消息: ${messageCount} 条`);
      console.log(`   解密尝试: ${decryptAttempts} 次`);
      console.log(`   成功破解: 0 次 (0%)`);
      console.log(`   安全性: ✅ 加密有效！\n`);
    } else if (message) {
      console.log(`\n⚠️  Eve 没有发送权限（不知道正确密钥）\n`);
    }

    rl.prompt();
  });

  rl.on('close', async () => {
    console.log('\n👋 停止窃听！');
    await eve.stop();
    process.exit(0);
  });
}

main().catch(error => {
  console.error('❌ 错误:', error);
  process.exit(1);
});

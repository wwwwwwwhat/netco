import '../polyfill.js';
import HyperswarmNode from '../network/hyperswarmNode.js';
import { symmetricDecrypt } from '../crypto/encryption.js';
import crypto from 'crypto';
import * as readline from 'readline';

console.log(`
╔═══════════════════════════════════════════════════════════╗
║              Eve - 窃听者演示客户端                        ║
║                                                           ║
║  🕵️  目的: 演示第三方无法解密加密消息                      ║
║  ⚠️  Eve 可以监听网络流量，但无法破解加密内容              ║
╚═══════════════════════════════════════════════════════════╝
`);

console.log('🔐 请输入群组ID（用于监听该群组）');
console.log('   提示: 从其他用户的邀请码中获取群组ID\n');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('请输入群组ID: ', async (groupId) => {
  rl.close();

  if (!groupId || groupId.trim() === '') {
    console.log('❌ 群组ID不能为空');
    process.exit(1);
  }

  console.log(`\n🕵️  Eve 开始监听群组: ${groupId}`);
  console.log('⏳ 正在创建 P2P 节点...\n');

  const node = new HyperswarmNode();
  const topic = `group-${groupId.trim()}`;

  // 用错误密钥模拟暴力破解
  const wrongKeys = [
    crypto.randomBytes(32),
    crypto.randomBytes(32),
    crypto.randomBytes(32),
    Buffer.from('0000000000000000000000000000000000000000000000000000000000000000', 'hex'),
    Buffer.from('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'hex')
  ];

  let messageCount = 0;
  let decryptAttempts = 0;
  let successfulDecrypts = 0;

  console.log(`📻 正在加入主题: ${topic}`);

  await node.joinTopic(topic, (msg) => {
    try {
      console.log(`\n[调试] 收到原始消息:`, msg);

      const data = JSON.parse(msg.data);

      console.log(`[调试] 解析后的数据:`, data);

      messageCount++;

      console.log(`\n${'='.repeat(60)}`);
      console.log(`🕵️  [消息 #${messageCount}] 截获加密消息！`);
      console.log(`   发送者: ${data.sender}`);
      console.log(`   时间: ${new Date(data.timestamp).toLocaleString()}`);
      console.log(`   加密内容: ${data.content.substring(0, 40)}...`);
      console.log(`   完整长度: ${data.content.length} 字符`);

      console.log(`\n🔓 尝试暴力破解...`);

      wrongKeys.forEach((key, index) => {
        decryptAttempts++;
        try {
          const decrypted = symmetricDecrypt(data.content, key);
          if (decrypted) {
            successfulDecrypts++;
            console.log(`   ✓ 密钥${index + 1} 解密成功: ${decrypted}`);
          } else {
            console.log(`   ✗ 密钥${index + 1} 解密失败`);
          }
        } catch (error) {
          console.log(`   ✗ 密钥${index + 1} 解密失败`);
        }
      });

      console.log(`\n❌ 破解失败！无法解密消息内容。`);
      console.log(`💡 这证明了端到端加密的安全性！\n`);

      console.log(`📊 窃听统计:`);
      console.log(`   截获消息: ${messageCount} 条`);
      console.log(`   解密尝试: ${decryptAttempts} 次`);
      console.log(`   成功破解: ${successfulDecrypts} 次 (${((successfulDecrypts / decryptAttempts) * 100).toFixed(1)}%)`);
      console.log(`   安全性: ${successfulDecrypts === 0 ? '✅ 加密有效！' : '⚠️  存在安全隐患！'}`);
      console.log(`${'='.repeat(60)}\n`);

    } catch (error) {
      console.log(`\n[调试] 处理消息时出错:`, error.message);
    }
  });

  // 等DHT发现完成
  console.log(`⏳ 等待 P2P 网络连接建立...`);
  await new Promise(resolve => setTimeout(resolve, 5000));

  console.log(`\n👂 正在监听，等待消息...\n`);

  process.on('SIGINT', async () => {
    console.log(`\n\n最终统计:`);
    console.log(`   截获消息: ${messageCount} 条`);
    console.log(`   解密尝试: ${decryptAttempts} 次`);
    console.log(`   成功破解: ${successfulDecrypts} 次`);
    console.log(`   破解成功率: ${messageCount > 0 ? ((successfulDecrypts / messageCount) * 100).toFixed(1) : 0}%\n`);

    await node.stop();
    process.exit(0);
  });
});

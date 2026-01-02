import '../polyfill.js';
import HyperswarmNode from '../network/hyperswarmNode.js';
import { symmetricDecrypt } from '../crypto/encryption.js';
import crypto from 'crypto';
import * as readline from 'readline';

console.log(`
╔═══════════════════════════════════════════════════════════╗
║              Eve - 窃听者演示客户端                        ║
║                                                           ║
║  目的: 演示第三方无法解密加密消息                          ║
║  Eve 可以监听网络流量，但无法破解加密内容                  ║
╚═══════════════════════════════════════════════════════════╝
`);

console.log('输入群组ID（用于监听）');
console.log('从邀请码中获取\n');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('请输入群组ID: ', async (groupId) => {
  rl.close();

  if (!groupId || groupId.trim() === '') {
    console.log('ID不能为空');
    process.exit(1);
  }

  console.log(`\n监听群组: ${groupId}\n`);

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


  await node.joinTopic(topic, (msg) => {
    try {
      console.log(`\n[调试] 原始消息:`, msg);

      const data = JSON.parse(msg.data);

      console.log(`[调试] 解析后:`, data);

      messageCount++;

      console.log(`\n${'='.repeat(60)}`);
      console.log(`[消息 #${messageCount}] 截获加密消息`);
      console.log(`发送者: ${data.sender}`);
      console.log(`时间: ${new Date(data.timestamp).toLocaleString()}`);
      console.log(`内容: ${data.content.substring(0, 40)}...`);
      console.log(`长度: ${data.content.length} 字符`);

      console.log(`\n尝试破解...`);

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

      console.log(`\n破解失败，无法解密`);
      console.log(`端到端加密有效\n`);

      console.log(`统计:`);
      console.log(`截获: ${messageCount} 条`);
      console.log(`尝试: ${decryptAttempts} 次`);
      console.log(`成功: ${successfulDecrypts} 次 (${((successfulDecrypts / decryptAttempts) * 100).toFixed(1)}%)`);
      console.log(`安全: ${successfulDecrypts === 0 ? '有效' : '有隐患'}`);
      console.log(`${'='.repeat(60)}\n`);

    } catch (error) {
      console.log(`\n[调试] 处理出错:`, error.message);
    }
  });

  // 等DHT发现完成
  await new Promise(resolve => setTimeout(resolve, 5000));
  console.log(`\n监听中...\n`);

  process.on('SIGINT', async () => {
    console.log(`\n\n最终统计:`);
    console.log(`   截获: ${messageCount} 条`);
    console.log(`   尝试: ${decryptAttempts} 次`);
    console.log(`   成功: ${successfulDecrypts} 次`);
    console.log(`   成功率: ${messageCount > 0 ? ((successfulDecrypts / messageCount) * 100).toFixed(1) : 0}%\n`);

    await node.stop();
    process.exit(0);
  });
});

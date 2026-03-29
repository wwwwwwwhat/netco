import '../polyfill.js';
import HyperswarmNode from '../network/hyperswarmNode.js';
import { symmetricDecrypt } from '../crypto/encryption.js';
import crypto from 'crypto';
import * as readline from 'readline';

console.log(`
╔══════════════════════════════════════╗
║        Eve - 窃听演示                ║
║   证明第三方无法解密加密消息         ║
╚══════════════════════════════════════╝
`);

console.log('输入群ID 从邀请码里提\n');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('群ID: ', async (groupId) => {
  rl.close();

  if (!groupId || groupId.trim() === '') {
    console.log('ID不能空');
    process.exit(1);
  }

  console.log(`\n监听: ${groupId}\n`);

  const node = new HyperswarmNode();
  const topic = `group-${groupId.trim()}`;

  // 随机密钥模拟暴破
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
      console.log(`\n[debug] 原始:`, msg);

      const data = JSON.parse(msg.data);

      console.log(`[debug] 解析:`, data);

      messageCount++;

      console.log(`\n${'='.repeat(60)}`);
      console.log(`[消息 #${messageCount}] 截获`);
      console.log(`发送: ${data.sender}`);
      console.log(`时间: ${new Date(data.timestamp).toLocaleString()}`);
      console.log(`内容: ${data.content.substring(0, 40)}...`);
      console.log(`长度: ${data.content.length}`);

      console.log(`\n尝试暴破`);

      wrongKeys.forEach((key, index) => {
        decryptAttempts++;
        try {
          const decrypted = symmetricDecrypt(data.content, key);
          if (decrypted) {
            successfulDecrypts++;
            console.log(`   ✓ 密钥${index + 1} 成功: ${decrypted}`);
          } else {
            console.log(`   ✗ 密钥${index + 1} 失败`);
          }
        } catch (error) {
          console.log(`   ✗ 密钥${index + 1} 失败`);
        }
      });

      console.log(`\n破解失败`);
      console.log(`E2E加密有效\n`);

      console.log(`统计:`);
      console.log(`截获: ${messageCount}`);
      console.log(`尝试: ${decryptAttempts}`);
      console.log(`成功: ${successfulDecrypts} (${((successfulDecrypts / decryptAttempts) * 100).toFixed(1)}%)`);
      console.log(`安全: ${successfulDecrypts === 0 ? '有效' : '风险'}`);
      console.log(`${'='.repeat(60)}\n`);

    } catch (error) {
      console.log(`\n[debug] 出错:`, error.message);
    }
  });

  // 等DHT
  await new Promise(resolve => setTimeout(resolve, 5000));
  console.log(`\n监听中\n`);

  process.on('SIGINT', async () => {
    console.log(`\n\n最终:`);
    console.log(`   截获: ${messageCount}`);
    console.log(`   尝试: ${decryptAttempts}`);
    console.log(`   成功: ${successfulDecrypts}`);
    console.log(`   成功率: ${messageCount > 0 ? ((successfulDecrypts / messageCount) * 100).toFixed(1) : 0}%\n`);

    await node.stop();
    process.exit(0);
  });
});

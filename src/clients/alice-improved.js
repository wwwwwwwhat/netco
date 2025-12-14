/**
 * Alice 客户端 - 改进版（支持邀请码）
 * 用户友好的群组创建和分享
 */

import '../polyfill.js';
import HyperswarmNode from '../network/hyperswarmNode.js';
import { generateKeyPairFromCredentials } from '../crypto/identity.js';
import { symmetricEncrypt, symmetricDecrypt } from '../crypto/encryption.js';
import { createInviteCode, formatInviteCode } from '../utils/inviteCode.js';
import { promptLogin, showLoginSuccess } from '../utils/login.js';
import crypto from 'crypto';
import * as readline from 'readline';

console.log(`
╔═══════════════════════════════════════════════════════════╗
║              安全聊天客户端 (改进版)                         ║
║                                                           ║
║  ✨ 新功能:                                               ║
║  - 用户登录系统                                            ║
║  - 一键创建群组并生成邀请码                                ║
║  - 分享邀请码给朋友                                        ║
╚═══════════════════════════════════════════════════════════╝
`);

async function main() {
  // 用户登录
  console.log('🔐 请登录以继续\n');
  const credentials = await promptLogin('alice');

  // 生成身份密钥
  console.log('🔐 正在生成身份密钥...');
  const userKeys = await generateKeyPairFromCredentials(credentials.username, credentials.password);
  showLoginSuccess(credentials.username, userKeys.publicKey);

  // 创建 P2P 节点
  console.log('🌐 正在创建 P2P 节点...');
  const node = new HyperswarmNode();

  // 群组信息
  let currentGroup = null;

  console.log(`\n✅ 节点已创建！\n`);
  console.log(`💡 命令帮助:`);
  console.log(`   /create <群组名>  - 创建新群组并生成邀请码`);
  console.log(`   /invite           - 显示当前群组的邀请码`);
  console.log(`   /stats            - 查看统计信息`);
  console.log(`   /exit             - 退出程序`);
  console.log(`   直接输入消息      - 发送到当前群组\n`);

  // 创建交互式输入界面
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${credentials.username}> `
  });

  rl.prompt();

  rl.on('line', async (input) => {
    const message = input.trim();

    // 处理命令
    if (message.startsWith('/')) {
      const [cmd, ...args] = message.split(' ');

      switch (cmd) {
        case '/create':
          {
            const groupName = args.join(' ') || '未命名群组';

            // 生成群组ID和密钥
            const groupId = crypto.randomBytes(8).toString('hex');
            const sharedKey = crypto.randomBytes(32);
            const topic = `group-${groupId}`;

            // 创建邀请码
            const inviteCode = createInviteCode(groupId, sharedKey, groupName, credentials.username);
            const formatted = formatInviteCode(inviteCode);

            // 保存当前群组信息
            currentGroup = {
              id: groupId,
              name: groupName,
              key: sharedKey,
              topic: topic,
              inviteCode: inviteCode
            };

            console.log(`\n✅ 群组已创建: "${groupName}"`);
            console.log(`📋 群组ID: ${groupId}`);
            console.log(`\n🎟️  邀请码（分享给朋友）:`);
            console.log(`   ${formatted}`);
            console.log(`\n💡 朋友可以这样加入:`);
            console.log(`   npm run bob-improved`);
            console.log(`   然后输入: /join ${inviteCode.substring(0, 48)}...`);
            console.log(`\n正在加入群组...`);

            // 用户加入自己创建的群组
            await node.joinTopic(topic, (msg) => {
              try {
                const data = JSON.parse(msg.data);
                const decrypted = symmetricDecrypt(data.content, currentGroup.key);

                if (decrypted && data.sender !== credentials.username) {
                  const timestamp = new Date(data.timestamp).toLocaleTimeString();
                  console.log(`\n💬 [${timestamp}] ${data.sender}: ${decrypted}`);
                  rl.prompt();
                }
              } catch (error) {
                // 忽略
              }
            });

            console.log(`\n⏳ 等待其他成员加入（局域网可能需要10-15秒）...`);

            // 等待连接（局域网需要更长时间）
            await new Promise(resolve => setTimeout(resolve, 10000));

            const stats = node.getStats();
            console.log(`\n✅ 就绪！当前连接数: ${stats.totalConnections}`);

            if (stats.totalConnections === 0) {
              console.log(`\n⚠️  提示: 连接数为0可能是因为:`);
              console.log(`   - 其他成员还未加入`);
              console.log(`   - 防火墙阻止了连接`);
              console.log(`   - 需要等待更长时间让 DHT 发现节点`);
            }
          }
          break;

        case '/invite':
          if (!currentGroup) {
            console.log(`\n⚠️  请先创建或加入一个群组`);
          } else {
            const formatted = formatInviteCode(currentGroup.inviteCode);
            console.log(`\n🎟️  "${currentGroup.name}" 的邀请码:`);
            console.log(`   ${formatted}`);
            console.log(`\n📋 完整邀请码（可复制）:`);
            console.log(`   ${currentGroup.inviteCode}`);
          }
          break;

        case '/stats':
          {
            const stats = node.getStats();
            console.log(`\n📊 统计信息:`);
            console.log(`   用户名: ${credentials.username}`);
            console.log(`   连接数: ${stats.totalConnections}`);
            console.log(`   加入的主题: ${stats.topics.join(', ') || '无'}`);

            if (currentGroup) {
              console.log(`\n📁 当前群组:`);
              console.log(`   名称: ${currentGroup.name}`);
              console.log(`   ID: ${currentGroup.id}`);
            }
          }
          break;

        case '/exit':
          console.log('\n👋 正在退出...');
          await node.stop();
          rl.close();
          process.exit(0);
          break;

        case '/help':
          console.log(`\n💡 命令帮助:`);
          console.log(`   /create <群组名>  - 创建新群组并生成邀请码`);
          console.log(`   /invite           - 显示当前群组的邀请码`);
          console.log(`   /stats            - 查看统计信息`);
          console.log(`   /exit             - 退出程序`);
          console.log(`   直接输入消息      - 发送到当前群组`);
          break;

        default:
          console.log(`\n⚠️  未知命令: ${cmd}`);
          console.log(`   输入 /help 查看帮助`);
      }

    } else if (message) {
      // 发送消息
      if (!currentGroup) {
        console.log(`\n⚠️  请先使用 /create 创建一个群组`);
      } else {
        const encrypted = symmetricEncrypt(message, currentGroup.key);
        await node.publish(
          currentGroup.topic,
          JSON.stringify({
            sender: credentials.username,
            content: encrypted,
            timestamp: Date.now()
          })
        );
        console.log(`✓ 已发送（加密）`);
      }
    }

    rl.prompt();
  });

  rl.on('close', async () => {
    console.log('\n👋 Goodbye!');
    await node.stop();
    process.exit(0);
  });
}

main().catch(error => {
  console.error('❌ 错误:', error);
  process.exit(1);
});

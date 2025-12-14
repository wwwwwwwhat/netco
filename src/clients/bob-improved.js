/**
 * Bob 客户端 - 改进版（支持邀请码加入）
 * 通过邀请码一键加入群组
 */

import '../polyfill.js';
import HyperswarmNode from '../network/hyperswarmNode.js';
import { generateKeyPairFromCredentials } from '../crypto/identity.js';
import { symmetricEncrypt, symmetricDecrypt } from '../crypto/encryption.js';
import { parseInviteCode, unformatInviteCode } from '../utils/inviteCode.js';
import { promptLogin, showLoginSuccess } from '../utils/login.js';
import * as readline from 'readline';

// 从命令行参数获取邀请码
const args = process.argv.slice(2);
const inviteArg = args.find(arg => arg.startsWith('--invite='));
const inviteCodeFromCLI = inviteArg ? inviteArg.split('=')[1] : null;

console.log(`
╔═══════════════════════════════════════════════════════════╗
║              安全聊天客户端 (改进版)                         ║
║                                                           ║
║  ✨ 新功能:                                               ║
║  - 用户登录系统                                            ║
║  - 通过邀请码一键加入群组                                  ║
║  - 自动解密群组密钥                                        ║
╚═══════════════════════════════════════════════════════════╝
`);

async function main() {
  // 用户登录
  console.log('🔐 请登录以继续\n');
  const credentials = await promptLogin('bob');

  // 生成身份密钥
  console.log('🔐 正在生成身份密钥...');
  const userKeys = await generateKeyPairFromCredentials(credentials.username, credentials.password);
  showLoginSuccess(credentials.username, userKeys.publicKey);

  // 创建 P2P 节点
  console.log('🌐 正在创建 P2P 节点...');
  const node = new HyperswarmNode();

  let currentGroup = null;

  // 如果通过命令行提供了邀请码，自动加入
  if (inviteCodeFromCLI) {
    await joinGroupWithInvite(inviteCodeFromCLI, node);
  } else {
    console.log(`\n✅ 节点已创建！\n`);
    console.log(`💡 命令帮助:`);
    console.log(`   /join <邀请码>    - 使用邀请码加入群组`);
    console.log(`   /stats            - 查看统计信息`);
    console.log(`   /exit             - 退出程序`);
    console.log(`   直接输入消息      - 发送到当前群组\n`);
  }

  // 创建交互式输入界面
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${credentials.username}> `
  });

  async function joinGroupWithInvite(code, node) {
    try {
      console.log(`\n🔍 正在解析邀请码...`);

      // 移除可能的格式化字符（连字符）
      const cleanCode = unformatInviteCode(code);

      // 解析邀请码
      const invite = parseInviteCode(cleanCode);

      if (invite.isExpired) {
        console.log(`\n⚠️  邀请码已过期（创建于 ${new Date(invite.createdAt).toLocaleString()}）`);
        return;
      }

      console.log(`\n✅ 邀请码有效！`);
      console.log(`   群组名称: "${invite.groupName}"`);
      console.log(`   创建者: ${invite.creator}`);
      console.log(`   创建时间: ${new Date(invite.createdAt).toLocaleString()}`);

      const topic = `group-${invite.groupId}`;

      // 保存群组信息
      currentGroup = {
        id: invite.groupId,
        name: invite.groupName,
        key: invite.sharedKey,
        topic: topic
      };

      console.log(`\n📻 正在加入群组...`);

      // 加入群组
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

      console.log(`\n⏳ 等待发现其他成员（局域网可能需要10-15秒）...`);

      // 等待连接（局域网需要更长时间）
      await new Promise(resolve => setTimeout(resolve, 10000));

      const stats = node.getStats();
      console.log(`\n✅ 就绪！当前连接数: ${stats.totalConnections}`);

      if (stats.totalConnections === 0) {
        console.log(`\n⚠️  提示: 连接数为0可能是因为:`);
        console.log(`   - 其他成员还未在线`);
        console.log(`   - 防火墙阻止了连接（请检查防火墙设置）`);
        console.log(`   - 需要等待更长时间让 DHT 发现节点`);
        console.log(`\n💡 建议:`);
        console.log(`   - 确保 Alice 已经先启动`);
        console.log(`   - 等待15-30秒再发消息`);
        console.log(`   - 输入 /stats 查看连接状态`);
      }

      console.log(`\n💬 现在可以开始聊天了！\n`);

    } catch (error) {
      console.log(`\n❌ 无法加入群组: ${error.message}`);
      console.log(`   请检查邀请码是否正确\n`);
    }
  }

  rl.prompt();

  rl.on('line', async (input) => {
    const message = input.trim();

    // 处理命令
    if (message.startsWith('/')) {
      const [cmd, ...args] = message.split(' ');

      switch (cmd) {
        case '/join':
          {
            const code = args.join(' ');
            if (!code) {
              console.log(`\n⚠️  请提供邀请码`);
              console.log(`   用法: /join <邀请码>`);
            } else {
              await joinGroupWithInvite(code, node);
            }
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
          console.log(`   /join <邀请码>    - 使用邀请码加入群组`);
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
        console.log(`\n⚠️  请先使用 /join 加入一个群组`);
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

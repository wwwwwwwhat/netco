/**
 * 统一客户端入口 - 支持登录、注册和多设备管理
 */

import '../polyfill.js';
import HyperswarmNode from '../network/hyperswarmNode.js';
import { generateKeyPairFromCredentials } from '../crypto/identity.js';
import { symmetricEncrypt, symmetricDecrypt } from '../crypto/encryption.js';
import { createInviteCode, formatInviteCode, parseInviteCode, unformatInviteCode } from '../utils/inviteCode.js';
import { promptLogin, showLoginSuccess } from '../utils/login.js';
import crypto from 'crypto';
import * as readline from 'readline';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const USER_DATA_DIR = path.join(__dirname, '../../data/user');

console.log(`
╔═══════════════════════════════════════════════════════════╗
║          去中心化安全社交网络 - 客户端                      ║
║                                                           ║
║  ✨ 功能:                                                 ║
║  - P2P 用户注册系统                                        ║
║  - 多设备登录检测                                          ║
║  - 群组聊天（邀请码）                                      ║
║  - 端到端加密                                             ║
╚═══════════════════════════════════════════════════════════╝
`);

// 从命令行参数获取邀请码
const args = process.argv.slice(2);
const inviteArg = args.find(arg => arg.startsWith('--invite='));
const inviteCodeFromCLI = inviteArg ? inviteArg.split('=')[1] : null;

/**
 * 加载本地用户数据
 */
function loadLocalUser(username) {
  try {
    if (!fs.existsSync(USER_DATA_DIR)) {
      return null;
    }
    const filePath = path.join(USER_DATA_DIR, `${username}.json`);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const fileContent = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(fileContent);
  } catch (error) {
    return null;
  }
}

/**
 * 保存本地用户数据
 */
function saveLocalUser(userData) {
  try {
    if (!fs.existsSync(USER_DATA_DIR)) {
      fs.mkdirSync(USER_DATA_DIR, { recursive: true });
    }
    const filePath = path.join(USER_DATA_DIR, `${userData.username}.json`);

    // 保留现有数据
    let existingData = {};
    if (fs.existsSync(filePath)) {
      try {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        existingData = JSON.parse(fileContent);
      } catch (e) {}
    }

    const dataToSave = {
      ...existingData,
      ...userData,
      lastLogin: new Date().toISOString()
    };

    fs.writeFileSync(filePath, JSON.stringify(dataToSave, null, 2), 'utf8');
  } catch (error) {
    console.error('保存用户数据失败:', error);
  }
}

async function attemptLogin() {
  // 用户登录
  console.log('🔐 请登录以继续\n');
  const credentials = await promptLogin();

  // 检查本地是否存在用户
  const localUser = loadLocalUser(credentials.username);
  let isNewUser = false;

  if (!localUser) {
    isNewUser = true;
  }

  // 生成身份密钥（不显示登录成功，等确认无冲突后再显示）
  console.log('🔐 正在生成身份密钥...');
  const userKeys = await generateKeyPairFromCredentials(credentials.username, credentials.password);

  // 保存用户数据
  saveLocalUser({
    username: credentials.username,
    passwordHash: crypto.createHash('sha256').update(credentials.password).digest('hex'),
    publicKey: userKeys.publicKey
  });

  // 创建 P2P 节点
  console.log('🌐 正在创建 P2P 节点...');
  const node = new HyperswarmNode();

  // 群组信息
  let currentGroup = null;

  // P2P 用户注册表主题
  const USER_REGISTRY_TOPIC = 'user-registry-global';
  const onlineUsers = new Map(); // username -> { publicKey, peerId, timestamp, sessionId }

  // 会话信息
  const sessionId = crypto.randomBytes(8).toString('hex');
  const loginTimestamp = Date.now(); // 记录登录时间戳
  let hasAlertedConflict = false; // 单次警告标志
  let shouldExit = false; // 是否需要退出标志

  // 创建一个用于处理登录冲突的 Promise
  const { promise: conflictPromise, reject: rejectLogin } = Promise.withResolvers();
  let conflictHandled = false;

  // 定期广播定时器（稍后初始化）
  let broadcastInterval = null;

  // 清理函数（需要在使用前定义）
  const cleanup = async () => {
    if (broadcastInterval) {
      clearInterval(broadcastInterval);
    }
    try {
      await node.publish(USER_REGISTRY_TOPIC, JSON.stringify({
        type: 'user_logout',
        username: credentials.username,
        sessionId,
        timestamp: Date.now()
      }), 'system', true);
    } catch (e) {
      // 忽略发送失败
    }
    await node.stop();
  };

  console.log(`\n🔊 正在加入用户注册表...`);
  await node.joinTopic(USER_REGISTRY_TOPIC, async (msg) => {
    try {
      const data = JSON.parse(msg.data);

      if (data.type === 'user_login') {
        const { username, publicKey, sessionId: remoteSessionId, timestamp: remoteTimestamp } = data;

        // 检测同用户名登录
        if (username === credentials.username && remoteSessionId !== sessionId) {
          console.log(`\n⚠️  检测到用户 "${username}" 在其他设备登录！`);
          console.log(`   时间: ${new Date(remoteTimestamp).toLocaleString()}`);
          console.log(`   会话ID: ${remoteSessionId}`);

          // 验证密钥是否匹配（同一密码会生成相同密钥）
          if (publicKey === userKeys.publicKey) {
            // 密码相同 - 通过时间戳判断谁先登录
            if (!hasAlertedConflict && !conflictHandled) {
              // 比较登录时间：对方先登录（时间戳更小）= 我后登录，我应该退出
              if (remoteTimestamp < loginTimestamp) {
                // 对方先登录，我是新登录的，我应该退出
                console.log(`\n⚠️  该账户已登录`);
                console.log(`   提示: 该账号正在其他设备使用中`);

                // 标记已处理
                hasAlertedConflict = true;
                conflictHandled = true;

                // 发送警告给对方（老用户）
                await node.publish(USER_REGISTRY_TOPIC, JSON.stringify({
                  type: 'login_alert',
                  username,
                  message: '您的账号尝试在另一终端登录，密码可能泄露',
                  timestamp: Date.now()
                }), 'system', true);

                // 标记需要退出并重新登录
                shouldExit = true;
                console.log(`\n⏳ 3秒后返回登录界面...`);
                setTimeout(async () => {
                  await cleanup();
                  const error = new Error('该账户已登录');
                  error.code = 'WRONG_PASSWORD';
                  rejectLogin(error);
                }, 3000);
              } else {
                // 我先登录，对方后登录，我保持在线，不做任何操作
                // 对方会自动退出
              }
            }
          } else {
            // 密钥不同 - 该用户已存在（密码错误）
            if (!hasAlertedConflict && !conflictHandled) {
              console.log(`\n❌ 该用户已存在`);
              console.log(`   提示: 该用户名已被其他人使用`);

              // 标记已处理（不发送警告给老用户）
              hasAlertedConflict = true;
              conflictHandled = true;

              // 标记需要退出并重新登录
              shouldExit = true;
              console.log(`\n⏳ 3秒后返回登录界面...`);
              setTimeout(async () => {
                await cleanup();
                const error = new Error('该用户已存在');
                error.code = 'WRONG_PASSWORD';
                rejectLogin(error);
              }, 3000);
            }
          }
        }

        // 更新在线用户列表（不包括自己）
        if (username !== credentials.username) {
          // 只在首次发现时打印
          const isNewUser = !onlineUsers.has(username);
          onlineUsers.set(username, {
            publicKey,
            sessionId: remoteSessionId,
            timestamp: remoteTimestamp
          });
          if (isNewUser) {
            console.log(`\n👤 发现在线用户: ${username}`);
          }
        }
      }

      if (data.type === 'user_list_request') {
        // 有人请求用户列表，回复自己的信息（静默模式）
        await node.publish(USER_REGISTRY_TOPIC, JSON.stringify({
          type: 'user_login',
          username: credentials.username,
          publicKey: userKeys.publicKey,
          sessionId,
          timestamp: Date.now()
        }), 'system', true);
      }

      if (data.type === 'login_alert' && data.username === credentials.username) {
        console.log(`\n🚨 安全警告: ${data.message}`);
      }

      if (data.type === 'user_logout') {
        const { username, sessionId: remoteSessionId } = data;
        const user = onlineUsers.get(username);
        if (user && user.sessionId === remoteSessionId) {
          onlineUsers.delete(username);
          console.log(`\n👋 用户下线: ${username}`);
        }
      }
    } catch (error) {
      // 忽略解析错误
    }
  });

  // 等待 P2P 连接建立（重要！）
  console.log(`⏳ 等待 P2P 网络连接建立...`);

  // 使用 Promise.race 来同时等待网络建立和冲突检测
  try {
    await Promise.race([
      new Promise(resolve => setTimeout(resolve, 5000)),
      conflictPromise  // 如果检测到冲突，这个 promise 会被 reject
    ]);
  } catch (error) {
    // 如果是密码错误，重新抛出以便外层捕获
    if (error.code === 'WRONG_PASSWORD') {
      throw error;
    }
    throw error;
  }

  // 如果在等待期间检测到需要退出，直接返回
  if (shouldExit) {
    return;
  }

  // 等待期结束，没有冲突，显示登录成功
  showLoginSuccess(credentials.username, userKeys.publicKey);

  // 发送登录广播
  console.log(`📢 广播用户登录...`);
  await node.publish(USER_REGISTRY_TOPIC, JSON.stringify({
    type: 'user_login',
    username: credentials.username,
    publicKey: userKeys.publicKey,
    sessionId,
    timestamp: Date.now()
  }));

  // 请求其他在线用户列表
  await node.publish(USER_REGISTRY_TOPIC, JSON.stringify({
    type: 'user_list_request',
    from: credentials.username,
    timestamp: Date.now()
  }));

  // 定期重新广播（确保新加入的节点能发现）
  broadcastInterval = setInterval(async () => {
    await node.publish(USER_REGISTRY_TOPIC, JSON.stringify({
      type: 'user_login',
      username: credentials.username,
      publicKey: userKeys.publicKey,
      sessionId,
      timestamp: Date.now()
    }), 'system', true); // 静默模式，不输出日志
  }, 30000); // 每30秒广播一次

  console.log(`\n✅ 节点已创建！\n`);
  console.log(`💡 命令帮助:`);
  console.log(`   /create <群组名>  - 创建新群组并生成邀请码`);
  console.log(`   /join <邀请码>    - 使用邀请码加入群组`);
  console.log(`   /invite           - 显示当前群组的邀请码`);
  console.log(`   /users            - 查看在线用户`);
  console.log(`   /stats            - 查看统计信息`);
  console.log(`   /exit             - 退出程序`);
  console.log(`   直接输入消息      - 发送到当前群组\n`);

  // 如果通过命令行提供了邀请码，自动加入
  if (inviteCodeFromCLI) {
    await joinGroupWithInvite(inviteCodeFromCLI, node, credentials, currentGroup, rl);
  }

  // 创建交互式输入界面
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${credentials.username}> `
  });

  async function joinGroupWithInvite(code, node, credentials, currentGroupRef, rl) {
    try {
      console.log(`\n🔍 正在解析邀请码...`);
      const cleanCode = unformatInviteCode(code);
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

      currentGroup = {
        id: invite.groupId,
        name: invite.groupName,
        key: invite.sharedKey,
        topic: topic
      };

      console.log(`\n📻 正在加入群组...`);

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
      await new Promise(resolve => setTimeout(resolve, 10000));

      const stats = node.getStats();
      console.log(`\n✅ 就绪！当前连接数: ${stats.totalConnections}`);

      if (stats.totalConnections === 0) {
        console.log(`\n⚠️  提示: 连接数为0可能是因为:`);
        console.log(`   - 其他成员还未在线`);
        console.log(`   - 防火墙阻止了连接`);
        console.log(`   - 需要等待更长时间让 DHT 发现节点`);
      }

      console.log(`\n💬 现在可以开始聊天了！\n`);
    } catch (error) {
      console.log(`\n❌ 无法加入群组: ${error.message}`);
    }
  }

  rl.prompt();

  rl.on('line', async (input) => {
    const message = input.trim();

    if (message.startsWith('/')) {
      const [cmd, ...args] = message.split(' ');

      switch (cmd) {
        case '/create':
          {
            const groupName = args.join(' ') || '未命名群组';

            const groupId = crypto.randomBytes(8).toString('hex');
            const sharedKey = crypto.randomBytes(32);
            const topic = `group-${groupId}`;

            const inviteCode = createInviteCode(groupId, sharedKey, groupName, credentials.username);
            const formatted = formatInviteCode(inviteCode);

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
            console.log(`   npm run net-co`);
            console.log(`   然后输入: /join ${inviteCode.substring(0, 48)}...`);
            console.log(`\n正在加入群组...`);

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

        case '/join':
          {
            const code = args.join(' ');
            if (!code) {
              console.log(`\n⚠️  请提供邀请码`);
              console.log(`   用法: /join <邀请码>`);
            } else {
              await joinGroupWithInvite(code, node, credentials, currentGroup, rl);
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

        case '/users':
          {
            console.log(`\n👥 在线用户列表 (${onlineUsers.size}):`);
            if (onlineUsers.size === 0) {
              console.log(`   (无其他在线用户)`);
            } else {
              for (const [username, user] of onlineUsers) {
                const timeAgo = Math.floor((Date.now() - user.timestamp) / 1000);
                console.log(`   - ${username} (${timeAgo}秒前上线)`);
              }
            }
          }
          break;

        case '/stats':
          {
            const stats = node.getStats();
            console.log(`\n📊 统计信息:`);
            console.log(`   用户名: ${credentials.username}`);
            console.log(`   会话ID: ${sessionId}`);
            console.log(`   连接数: ${stats.totalConnections}`);
            console.log(`   在线用户: ${onlineUsers.size}`);
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
          await cleanup();
          rl.close();
          process.exit(0);
          break;

        case '/help':
          console.log(`\n💡 命令帮助:`);
          console.log(`   /create <群组名>  - 创建新群组并生成邀请码`);
          console.log(`   /join <邀请码>    - 使用邀请码加入群组`);
          console.log(`   /invite           - 显示当前群组的邀请码`);
          console.log(`   /users            - 查看在线用户`);
          console.log(`   /stats            - 查看统计信息`);
          console.log(`   /exit             - 退出程序`);
          console.log(`   直接输入消息      - 发送到当前群组`);
          break;

        default:
          console.log(`\n⚠️  未知命令: ${cmd}`);
          console.log(`   输入 /help 查看帮助`);
      }

    } else if (message) {
      if (!currentGroup) {
        console.log(`\n⚠️  请先使用 /create 创建或 /join 加入一个群组`);
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
    await cleanup();
    process.exit(0);
  });
}

// 主函数：包装 attemptLogin 并实现重试循环
async function main() {
  while (true) {
    try {
      await attemptLogin();
      // 如果登录成功，跳出循环
      break;
    } catch (error) {
      if (error.code === 'WRONG_PASSWORD') {
        // 密码错误，重新开始登录流程
        console.log('\n');
        continue;
      } else {
        // 其他错误，退出程序
        console.error('❌ 错误:', error);
        process.exit(1);
      }
    }
  }
}

main().catch(error => {
  console.error('❌ 未捕获的错误:', error);
  process.exit(1);
});

import '../polyfill.js';
import HyperswarmNode from '../network/hyperswarmNode.js';
import { generateKeyPairFromCredentials, signMessage, verifySignature } from '../crypto/identity.js';
import { symmetricEncrypt, symmetricDecrypt, encryptMessage, decryptMessage } from '../crypto/encryption.js';
import { createInviteCode, formatInviteCode, parseInviteCode, unformatInviteCode } from '../utils/communication/inviteCode.js';
import { promptLogin, showLoginSuccess } from '../utils/communication/login.js';
import { checkRegistrationLimits, recordRegistration, initRegistry, saveRegistryToDisk } from '../data/host_registry.js';
import { initStorage, cacheMessage, flushCache, loadHistory } from '../data/msg_storage.js';
import { performPoW } from '../utils/security/pow.js';
import { ReplayProtection } from '../utils/security/replay_protection.js';
import crypto from 'crypto';
import * as readline from 'readline';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import naclUtil from 'tweetnacl-util';

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

const args = process.argv.slice(2);
const inviteArg = args.find(arg => arg.startsWith('--invite='));
const inviteCodeFromCLI = inviteArg ? inviteArg.split('=')[1] : null;

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

function saveLocalUser(userData) {
  try {
    if (!fs.existsSync(USER_DATA_DIR)) {
      fs.mkdirSync(USER_DATA_DIR, { recursive: true });
    }
    const filePath = path.join(USER_DATA_DIR, `${userData.username}.json`);

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
  console.log('\n🔐 用户登录/注册');
  const credentials = await promptLogin();
  
  const localUser = loadLocalUser(credentials.username);
  let isNewUser = false;

  if (localUser) {
    if (localUser.passwordHash !== credentials.passwordHash) {
      console.log(`\n❌ 登录失败: 密码错误！`);
      throw { code: 'WRONG_PASSWORD' };
    }
  } else {
    isNewUser = true;
    console.log(`\n📝 检测到新用户 "${credentials.username}"，正在注册...`);

    const limitCheck = checkRegistrationLimits();
    if (!limitCheck.allowed) {
      console.log(`\n❌ 注册被拒绝: ${limitCheck.reason}`);
      throw { code: 'REGISTRATION_LIMIT' };
    }

    // 密码要求：8位以上，大小写+数字+下划线
    const pwdRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*_)[A-Za-z\d_]{8,}$/;
    if (!pwdRegex.test(credentials.password)) {
       console.log('❌ 密码不符合安全要求');
       console.log('   要求：至少8位，包含大写字母、小写字母、数字和下划线');
       throw { code: 'WRONG_PASSWORD' };
    }

    await performPoW();
  }

  // 等冲突检测完再显示登录成功
  console.log('🔐 正在生成身份密钥...');
  const userKeys = await generateKeyPairFromCredentials(credentials.username, credentials.password);

  initStorage(credentials.username, credentials.password);

  saveLocalUser({
    username: credentials.username,
    passwordHash: credentials.passwordHash,
    publicKey: userKeys.publicKey
  });

  if (isNewUser) {
    recordRegistration(credentials.username);
  }

  console.log('🌐 正在创建 P2P 节点...');
  const node = new HyperswarmNode();

  let currentGroup = null;

  const USER_REGISTRY_TOPIC = 'user-registry-global';
  const onlineUsers = new Map();

  const sessionId = crypto.randomBytes(8).toString('hex');
  const loginTimestamp = Date.now();
  let hasAlertedConflict = false;
  let shouldExit = false;

  const { promise: conflictPromise, reject: rejectLogin } = Promise.withResolvers();
  let conflictHandled = false;

  let broadcastInterval = null;
  let flushInterval = null;

  const cleanup = async () => {
    saveRegistryToDisk();
    flushCache(credentials.username);

    if (broadcastInterval) {
      clearInterval(broadcastInterval);
    }
    if (flushInterval) {
      clearInterval(flushInterval);
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

        // 同用户名登录冲突检测
        if (username === credentials.username && remoteSessionId !== sessionId) {
          console.log(`\n⚠️  检测到用户 "${username}" 在其他设备登录！`);
          console.log(`   时间: ${new Date(remoteTimestamp).toLocaleString()}`);
          console.log(`   会话ID: ${remoteSessionId}`);

          // 公钥相同说明密码相同，用时间戳判断先后
          if (publicKey === userKeys.publicKey) {
            if (!hasAlertedConflict && !conflictHandled) {
              // 对方先登录则我退出
              if (remoteTimestamp < loginTimestamp) {
                console.log(`\n⚠️  该账户已登录`);
                console.log(`   提示: 该账号正在其他设备使用中`);

                hasAlertedConflict = true;
                conflictHandled = true;

                await node.publish(USER_REGISTRY_TOPIC, JSON.stringify({
                  type: 'login_alert',
                  username,
                  message: '您的账号尝试在另一终端登录，密码可能泄露',
                  timestamp: Date.now()
                }), 'system', true);

                shouldExit = true;
                console.log(`\n⏳ 3秒后返回登录界面...`);
                setTimeout(async () => {
                  await cleanup();
                  const error = new Error('该账户已登录');
                  error.code = 'WRONG_PASSWORD';
                  rejectLogin(error);
                }, 3000);
              }
            }
          } else {
            // 公钥不同说明密码错误，用户名已被占用
            if (!hasAlertedConflict && !conflictHandled) {
              console.log(`\n❌ 该用户已存在`);
              console.log(`   提示: 该用户名已被其他人使用`);

              hasAlertedConflict = true;
              conflictHandled = true;

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

        if (username !== credentials.username) {
          const isNewUser = !onlineUsers.has(username);
          onlineUsers.set(username, {
            publicKey,
            sessionId: remoteSessionId,
            timestamp: remoteTimestamp
          });
          if (isNewUser) {
            console.log(`\n👤 发现在线用户: ${username}`);
          }

          // 自动加入群组成员列表
          if (currentGroup && currentGroup.type === 'group') {
            currentGroup.members = currentGroup.members || [];
            if (!currentGroup.members.includes(username)) {
              currentGroup.members.push(username);
            }
          }
        }
      }

      if (data.type === 'user_list_request') {
        await node.publish(USER_REGISTRY_TOPIC, JSON.stringify({
          type: 'user_login',
          username: credentials.username,
          publicKey: userKeys.publicKey,
          sessionId,
          timestamp: Date.now()
        }), 'system', true);
      }

      if (data.type === 'dm_signal' && data.target === credentials.username) {
        console.log(`\n📩 收到来自 ${data.sender} 的私聊请求`);
        console.log(`   输入 /dm ${data.sender} 即可开始聊天`);
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

          // 成员离开时触发密钥轮换选举
          if (currentGroup && currentGroup.type === 'group' && currentGroup.members && currentGroup.members.includes(username)) {
            currentGroup.members = currentGroup.members.filter(m => m !== username);

            console.log(`\n🔐 群组成员 ${username} 离开，发布轮换选举...`);

            try {
              const payloadObj = {
                leavingUser: username,
                lastActiveSender: currentGroup.lastActiveSender || null,
                timestamp: Date.now()
              };
              const payload = JSON.stringify(payloadObj);
              const signature = signMessage(payload, userKeys.secretKeyRaw);

              await node.publish(currentGroup.topic, JSON.stringify({
                type: 'rotate_election',
                sender: credentials.username,
                content: payload,
                signature,
                timestamp: Date.now()
              }));
            } catch (e) {
              console.error('发布轮换选举失败:', e);
            }
          }
        }
      }
    } catch (error) {
      // 忽略解析错误
    }
  });

  console.log(`⏳ 等待 P2P 网络连接建立...`);

  // 同时等网络建立和冲突检测
  try {
    await Promise.race([
      new Promise(resolve => setTimeout(resolve, 5000)),
      conflictPromise
    ]);
  } catch (error) {
    if (error.code === 'WRONG_PASSWORD') {
      throw error;
    }
    throw error;
  }

  if (shouldExit) {
    return;
  }

  showLoginSuccess(credentials.username, userKeys.publicKey);

  console.log(`📢 广播用户登录...`);
  await node.publish(USER_REGISTRY_TOPIC, JSON.stringify({
    type: 'user_login',
    username: credentials.username,
    publicKey: userKeys.publicKey,
    sessionId,
    timestamp: Date.now()
  }));

  await node.publish(USER_REGISTRY_TOPIC, JSON.stringify({
    type: 'user_list_request',
    from: credentials.username,
    timestamp: Date.now()
  }));

  // 每30秒广播一次，让新节点能发现
  broadcastInterval = setInterval(async () => {
    await node.publish(USER_REGISTRY_TOPIC, JSON.stringify({
      type: 'user_login',
      username: credentials.username,
      publicKey: userKeys.publicKey,
      sessionId,
      timestamp: Date.now()
    }), 'system', true);
  }, 30000);

  flushInterval = setInterval(() => {
    flushCache(credentials.username);
  }, 5 * 60 * 1000);

  console.log(`\n✅ 节点已创建！\n`);
  console.log(`💡 命令帮助:`);
  console.log(`   /create <群组名>  - 创建新群组并生成邀请码`);
  console.log(`   /join <邀请码>    - 使用邀请码加入群组`);
  console.log(`   /dm <用户名>      - 发起私聊 (端到端加密)`);
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

  // 按成员分发新密钥，每个成员用非对称加密
  async function performGroupKeyRotation(initiatorUsername) {
    if (!currentGroup || currentGroup.type !== 'group') return;

    const newKey = crypto.randomBytes(32);
    const newKeyBase64 = naclUtil.encodeBase64(newKey);

    // 只给在线成员分发
    const members = (currentGroup.members || []).filter(m => m === credentials.username || onlineUsers.has(m));

    const boxes = [];
    for (const member of members) {
      try {
        let recipientPubBase64;
        if (member === credentials.username) {
          recipientPubBase64 = userKeys.publicKey;
        } else {
          const u = onlineUsers.get(member);
          if (!u) continue;
          recipientPubBase64 = u.publicKey;
        }
        const recipientPubRaw = naclUtil.decodeBase64(recipientPubBase64);
        // 用发起者私钥加密，只有对应接收者能解密
        const box = encryptMessage(newKeyBase64, recipientPubRaw, userKeys.secretKeyRaw);
        boxes.push({ recipient: member, box });
      } catch (e) {
        // 忽略单个成员失败
      }
    }

    if (boxes.length === 0) {
      throw new Error('没有可分发的新密钥接收者');
    }

    const payload = JSON.stringify({ mode: 'per-recipient', boxes });
    const signature = signMessage(payload, userKeys.secretKeyRaw);

    await node.publish(currentGroup.topic, JSON.stringify({
      type: 'key_rotation',
      sender: initiatorUsername,
      content: payload,
      signature,
      timestamp: Date.now()
    }));

    currentGroup.key = newKey;
    currentGroup.lastRotationAt = Date.now();
    console.log(`\n🔄 已分发并更新本地群组密钥（发起者: ${initiatorUsername}）`);
  }

  const createMessageHandler = () => {
    return async (msg) => {
      try {
        const data = JSON.parse(msg.data);
        
        if (currentGroup && currentGroup.replayProtection && currentGroup.replayProtection.isReplay(data.sender, data.content, data.timestamp)) {
          return; 
        }

        if (currentGroup && currentGroup.type === 'dm') {
             if (data.sender === credentials.username) return;
             
             const decrypted = decryptMessage(data.content, currentGroup.peerPublicKey, userKeys.secretKeyRaw);
             if (decrypted) {
                 const timestamp = new Date(data.timestamp).toLocaleTimeString();
                 console.log(`\n💬 [${timestamp}] ${data.sender} (私密): ${decrypted}`);
                 
                 cacheMessage(credentials.username, {
                    type: 'direct_message',
                    content: decrypted,
                    timestamp: data.timestamp,
                    senderPublicKey: naclUtil.encodeBase64(currentGroup.peerPublicKey),
                    senderName: data.sender,
                    peerPublicKey: naclUtil.encodeBase64(currentGroup.peerPublicKey),
                    isEncrypted: false
                 });

                 rl.prompt();
             }
             return;
        }

        // 密钥轮换：支持per-recipient和向后兼容的广播方式
        if (data.type === 'key_rotation') {
           const senderUser = onlineUsers.get(data.sender);
           if (!senderUser) {
               return;
           }
           const senderKeyRaw = naclUtil.decodeBase64(senderUser.publicKey);
           if (!verifySignature(data.content, data.signature, senderKeyRaw)) {
               return;
           }

           let parsed = null;
           try {
             parsed = JSON.parse(data.content);
           } catch (e) {
             parsed = null;
           }

           if (parsed && parsed.boxes && Array.isArray(parsed.boxes)) {
             // per-recipient格式，找自己的box
             const myEntry = parsed.boxes.find(b => b.recipient === credentials.username);
             if (!myEntry) {
               return;
             }
             const box = myEntry.box;
             const newKeyBase64 = decryptMessage(box, senderKeyRaw, userKeys.secretKeyRaw);
             if (newKeyBase64) {
               const newKey = naclUtil.decodeBase64(newKeyBase64);
               currentGroup.key = newKey;
             }
             return;
           }

           // 向后兼容：对称解密
           const newKeyBase64 = symmetricDecrypt(data.content, currentGroup.key);
           if (newKeyBase64) {
               const newKey = naclUtil.decodeBase64(newKeyBase64);
               currentGroup.key = newKey;
           }
           return;
        }
        // 轮换选举：优先创建者，否则最近活跃发送者
        if (data.type === 'rotate_election') {
           const senderUser = onlineUsers.get(data.sender);
           if (!senderUser) {
             return;
           }

           const senderKeyRaw = naclUtil.decodeBase64(senderUser.publicKey);
           if (!verifySignature(data.content, data.signature, senderKeyRaw)) {
             return;
           }

           let payload = null;
           try {
             payload = JSON.parse(data.content);
           } catch (e) {
             return;
           }

           const creator = currentGroup && currentGroup.creator ? currentGroup.creator : null;
           const preferred = (creator && onlineUsers.has(creator)) ? creator : (payload.lastActiveSender || (currentGroup && currentGroup.lastActiveSender));

           if (!preferred) {
             return;
           }

           if (preferred === credentials.username) {
             // 5秒内不重复轮换
             const now = Date.now();
             currentGroup.lastRotationAt = currentGroup.lastRotationAt || 0;
             if (now - currentGroup.lastRotationAt < 5000) {
               return;
             }

             try {
               await performGroupKeyRotation(credentials.username);
               currentGroup.lastRotationAt = Date.now();
             } catch (e) {
               console.error('执行轮换失败:', e);
             }
           }
           return;
        }

        let sigStatus = undefined;
        if (data.signature) {
           const senderUser = onlineUsers.get(data.sender);
           if (senderUser) {
             const senderKeyRaw = naclUtil.decodeBase64(senderUser.publicKey);
             const isValid = verifySignature(data.content, data.signature, senderKeyRaw);
             sigStatus = Boolean(isValid);
             if (!isValid) {
               console.log(`\n⚠️  收到消息 [${data.sender}]，但签名无效！`);
             }
           }
        }

        const decrypted = symmetricDecrypt(data.content, currentGroup.key);

        if (decrypted && data.sender !== credentials.username) {
          const timestamp = new Date(data.timestamp).toLocaleTimeString();
          console.log(`\n💬 [${timestamp}] ${data.sender} ${sigStatus}: ${decrypted}`);
          if (currentGroup && currentGroup.type === 'group') {
            currentGroup.lastActiveSender = data.sender;
          }
          rl.prompt();
        }
      } catch (error) {
        // 忽略
      }
    };
  };

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
      
      const replayProtection = new ReplayProtection();

      currentGroup = {
        type: 'group',
        id: invite.groupId,
        name: invite.groupName,
        key: invite.sharedKey,
        topic: topic,
        inviteCode: cleanCode,
        replayProtection: replayProtection
      };

      currentGroup.members = [credentials.username, ...Array.from(onlineUsers.keys())].filter((v, i, a) => a.indexOf(v) === i);
      currentGroup.creator = invite.creator;
      currentGroup.lastRotationAt = 0;
      currentGroup.lastActiveSender = invite.creator || credentials.username;

      console.log(`\n📻 正在加入群组...`);

      await node.joinTopic(topic, createMessageHandler());

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
            
            const replayProtection = new ReplayProtection();

            currentGroup = {
              type: 'group',
              id: groupId,
              name: groupName,
              key: sharedKey,
              topic: topic,
              inviteCode: inviteCode,
              replayProtection: replayProtection
            };

            currentGroup.members = [credentials.username, ...Array.from(onlineUsers.keys())].filter((v, i, a) => a.indexOf(v) === i);
            currentGroup.creator = credentials.username;
            currentGroup.lastRotationAt = 0;
            currentGroup.lastActiveSender = credentials.username;

            console.log(`\n✅ 群组已创建: "${groupName}"`);
            console.log(`📋 群组ID: ${groupId}`);
            console.log(`\n🎟️  邀请码（分享给朋友）:`);
            console.log(`   ${formatted}`);
            console.log(`\n💡 朋友可以这样加入:`);
            console.log(`   npm run net-co`);
            console.log(`   然后输入: /join ${inviteCode.substring(0, 48)}...`);
            console.log(`\n正在加入群组...`);

            await node.joinTopic(topic, createMessageHandler());

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

        case '/dm':
          {
            const targetUser = args[0];
            if (!targetUser) {
               console.log('⚠️  请指定用户名: /dm <username>');
               break;
            }
            if (targetUser === credentials.username) {
               console.log('⚠️  不能和自己聊天');
               break;
            }
            
            const peer = onlineUsers.get(targetUser);
            if (!peer) {
               console.log(`⚠️  用户 ${targetUser} 不在线`);
               break;
            }

            // 用户名排序确保topic唯一
            const sortedUsers = [credentials.username, targetUser].sort();
            const dmTopic = `dm-${sortedUsers.join('-')}`;
            
            await node.publish(USER_REGISTRY_TOPIC, JSON.stringify({
                type: 'dm_signal',
                target: targetUser,
                sender: credentials.username
            }));

            const replayProtection = new ReplayProtection();

            currentGroup = {
                type: 'dm',
                id: dmTopic,
                name: `与 ${targetUser} 的私聊`,
                topic: dmTopic,
                peerUsername: targetUser,
                peerPublicKey: naclUtil.decodeBase64(peer.publicKey),
                replayProtection: replayProtection
            };

            console.log(`\n💬 正在进入与 ${targetUser} 的私聊频道...`);
            
            const history = loadHistory(credentials.username, naclUtil.encodeBase64(currentGroup.peerPublicKey), 'direct');
            if (history.length > 0) {
                console.log(`\n📜 --- 历史记录 ---`);
                for (const msg of history) {
                    const time = new Date(msg.timestamp).toLocaleString();
                    const sender = msg.senderName === credentials.username ? '我' : msg.senderName;
                    console.log(`[${time}] ${sender}: ${msg.content}`);
                }
                console.log(`📜 ------------------\n`);
            }

            await node.joinTopic(dmTopic, createMessageHandler());
            console.log(`✅ 已加入私聊频道`);
          }
          break;

        case '/rotate':
          if (!currentGroup || currentGroup.type !== 'group') {
            console.log(`\n⚠️  请先创建或加入一个群组 (私聊不支持密钥轮换)`);
          } else {
            console.log(`\n🔄 正在轮换群组密钥并向在线成员分发...`);
            try {
              await performGroupKeyRotation(credentials.username);
            } catch (e) {
              console.error('轮换失败:', e);
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
          console.log(`   /dm <用户名>      - 发起私聊 (端到端加密)`);
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
        console.log(`\n⚠️  请先使用 /create 创建或 /join 加入一个群组，或使用 /dm 发起私聊`);
      } else {
        if (currentGroup.type === 'dm') {
            const encrypted = encryptMessage(message, currentGroup.peerPublicKey, userKeys.secretKeyRaw);
            // 统一格式，额外加入签名
            const signature = signMessage(encrypted, userKeys.secretKeyRaw);

            const timestamp = Date.now();
            await node.publish(currentGroup.topic, JSON.stringify({
                type: 'dm_message',
                sender: credentials.username,
                content: encrypted,
                signature: signature,
                timestamp: timestamp
            }));
             console.log(`✓ 已发送（端到端加密）`);

             // 缓存发送的消息
             cacheMessage(credentials.username, {
                type: 'direct_message',
                content: message,
                timestamp: timestamp,
                senderPublicKey: userKeys.publicKey, // 我发的，sender是我
                senderName: credentials.username,
                peerPublicKey: naclUtil.encodeBase64(currentGroup.peerPublicKey), // 对话对象是对方
                isEncrypted: false
             });

        } else {
            const encrypted = symmetricEncrypt(message, currentGroup.key);
            const signature = signMessage(encrypted, userKeys.secretKeyRaw);
            
            await node.publish(
              currentGroup.topic,
              JSON.stringify({
                type: 'message',
                sender: credentials.username,
                content: encrypted,
                signature: signature,
                timestamp: Date.now()
              })
            );
            currentGroup.lastActiveSender = credentials.username;
            console.log(`✓ 已发送（加密+签名）`);
        }
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

async function main() {
  initRegistry();

  process.on('SIGINT', () => {
    console.log('\n[System] 正在保存数据并退出...');
    saveRegistryToDisk();
    process.exit(0);
  });

  while (true) {
    try {
      await attemptLogin();
      break;
    } catch (error) {
      if (error.code === 'WRONG_PASSWORD') {
        console.log('\n');
        continue;
      } else if (error.code === 'REGISTRATION_LIMIT') {
        process.exit(1);
      } else {
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

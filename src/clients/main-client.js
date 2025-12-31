/**
 * 统一客户端入口 - 支持登录、注册和多设备管理
 */

import '../polyfill.js';
import HyperswarmNode from '../network/hyperswarmNode.js';
import { generateKeyPairFromCredentials, signMessage, verifySignature } from '../crypto/identity.js';
import { symmetricEncrypt, symmetricDecrypt, encryptMessage, decryptMessage } from '../crypto/encryption.js';
import { createInviteCode, formatInviteCode, parseInviteCode, unformatInviteCode } from '../utils/communication/inviteCode.js';
import { promptLogin, showLoginSuccess, promptSelection, promptRegister } from '../utils/communication/login.js';
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
  // 1. 选择模式
  const mode = await promptSelection();
  let credentials;

  if (mode === 'register') {
    console.log('\n📝 新用户注册');
    
    // 检查注册限制 (Host Registry)
    const limitCheck = checkRegistrationLimits();
    if (!limitCheck.allowed) {
      console.log(`\n❌ 注册被拒绝: ${limitCheck.reason}`);
      throw { code: 'REGISTRATION_LIMIT' };
    }

    // 执行 PoW
    await performPoW();

    credentials = await promptRegister();
    
    // 检查用户是否已存在
    const localUser = loadLocalUser(credentials.username);
    if (localUser) {
      console.log(`\n❌ 注册失败: 用户名 "${credentials.username}" 已存在！`);
      console.log('   请直接登录或使用其他用户名。');
      throw { code: 'WRONG_PASSWORD' }; // 触发重试
    }
  } else {
    console.log('\n🔐 用户登录');
    credentials = await promptLogin();
    
    // 检查用户是否存在
    const localUser = loadLocalUser(credentials.username);
    if (!localUser) {
      console.log(`\n❌ 登录失败: 用户 "${credentials.username}" 不存在！`);
      console.log('   请先注册。');
      throw { code: 'WRONG_PASSWORD' }; // 触发重试
    }
  }

  // 生成身份密钥（不显示登录成功，等确认无冲突后再显示）
  console.log('🔐 正在生成身份密钥...');
  const userKeys = await generateKeyPairFromCredentials(credentials.username, credentials.password);

  // 初始化本地存储加密
  initStorage(credentials.username, credentials.password);

  // 保存用户数据
  saveLocalUser({
    username: credentials.username,
    passwordHash: crypto.createHash('sha256').update(credentials.password).digest('hex'),
    publicKey: userKeys.publicKey
  });

  // 如果是新注册，记录到注册表
  if (mode === 'register') {
    recordRegistration(credentials.username);
  }

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
  // 定期刷新缓存定时器
  let flushInterval = null;

  // 清理函数（需要在使用前定义）
  const cleanup = async () => {
    // 保存注册表数据
    saveRegistryToDisk();
    // 保存消息缓存
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

          // 如果已在群组中，自动将该用户加入 currentGroup.members
          if (currentGroup && currentGroup.type === 'group') {
            currentGroup.members = currentGroup.members || [];
            if (!currentGroup.members.includes(username)) {
              currentGroup.members.push(username);
            }
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

          // 如果该用户属于当前群组成员，移除并发布轮换选举消息
          if (currentGroup && currentGroup.type === 'group' && currentGroup.members && currentGroup.members.includes(username)) {
            // 从成员列表移除
            currentGroup.members = currentGroup.members.filter(m => m !== username);

            console.log(`\n🔐 群组成员 ${username} 离开，发布轮换选举...`);

            // 发布 rotate_election 到群组主题，签名 payload
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

  // 定期刷新缓存 (每5分钟)
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

  // 消息处理函数
  // 自动/按成员分发的密钥轮换函数
  async function performGroupKeyRotation(initiatorUsername) {
    if (!currentGroup || currentGroup.type !== 'group') return;

    const newKey = crypto.randomBytes(32);
    const newKeyBase64 = naclUtil.encodeBase64(newKey);

    // 只向当前在线且属于群组的成员分发（包括自己）
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
        // 使用发起者的私钥对每个接收方加密 newKeyBase64
        const box = encryptMessage(newKeyBase64, recipientPubRaw, userKeys.secretKeyRaw);
        boxes.push({ recipient: member, box });
      } catch (e) {
        // 忽略单个成员的失败
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

    // 本地更新为新密钥并记录轮换时间
    currentGroup.key = newKey;
    currentGroup.lastRotationAt = Date.now();
    console.log(`\n🔄 已分发并更新本地群组密钥（发起者: ${initiatorUsername}）`);
  }

  const createMessageHandler = () => {
    return async (msg) => {
      try {
        const data = JSON.parse(msg.data);
        
        // 防重放检查 (群组和私聊均有效)
        if (currentGroup && currentGroup.replayProtection && currentGroup.replayProtection.isReplay(data.sender, data.content, data.timestamp)) {
          return; 
        }

        // 处理私聊消息
        if (currentGroup && currentGroup.type === 'dm') {
             if (data.sender === credentials.username) return;
             
             const decrypted = decryptMessage(data.content, currentGroup.peerPublicKey, userKeys.secretKeyRaw);
             if (decrypted) {
                 const timestamp = new Date(data.timestamp).toLocaleTimeString();
                 console.log(`\n💬 [${timestamp}] ${data.sender} (私密): ${decrypted}`);
                 
                 // 缓存接收到的消息
                 cacheMessage(credentials.username, {
                    type: 'direct_message',
                    content: decrypted,
                    timestamp: data.timestamp,
                    senderPublicKey: naclUtil.encodeBase64(currentGroup.peerPublicKey), // 对方发来的，sender是对方
                    senderName: data.sender,
                    peerPublicKey: naclUtil.encodeBase64(currentGroup.peerPublicKey),   // 对话对象是对方
                    isEncrypted: false
                 });

                 rl.prompt();
             }
             return;
        }

        // 处理密钥轮换
        if (data.type === 'key_rotation') {
           const senderUser = onlineUsers.get(data.sender);
           if (!senderUser) {
              //  console.log(`\n⚠️  收到密钥轮换请求，但发送者 "${data.sender}" 未知 (无法验证签名)`);
               return;
           }
           const senderKeyRaw = naclUtil.decodeBase64(senderUser.publicKey);
           if (!verifySignature(data.content, data.signature, senderKeyRaw)) {
              //  console.log(`\n⚠️  收到密钥轮换请求，但签名无效！可能存在篡改。`);
               return;
           }

           // 支持两种轮换格式：
           // 1) 广播对称加密的 newKeyBase64（向后兼容）
           // 2) per-recipient 格式：{ mode: 'per-recipient', boxes: [{recipient, box}, ...] }
           let parsed = null;
           try {
             parsed = JSON.parse(data.content);
           } catch (e) {
             parsed = null;
           }

           if (parsed && parsed.boxes && Array.isArray(parsed.boxes)) {
             // 查找是否有给自己的封装
             const myEntry = parsed.boxes.find(b => b.recipient === credentials.username);
             if (!myEntry) {
               // 如果没有，说明轮换并未发给我（可能为离群者）
              //  console.log(`\n🔕 收到密钥轮换，但未包含本设备的密钥份`);
               return;
             }
             const box = myEntry.box;
             // 使用发起者的公钥和本设备私钥解密
             const newKeyBase64 = decryptMessage(box, senderKeyRaw, userKeys.secretKeyRaw);
             if (newKeyBase64) {
               const newKey = naclUtil.decodeBase64(newKeyBase64);
               currentGroup.key = newKey;
              //  console.log(`\n🔄 群组密钥已由 ${data.sender} 更新（按成员封装）`);
             } else {
              //  console.log(`\n⚠️ 无法解密分发给本设备的新密钥`);
             }
             return;
           }

           // 向后兼容：尝试对称解密（原有广播方式）
           const newKeyBase64 = symmetricDecrypt(data.content, currentGroup.key);
           if (newKeyBase64) {
               const newKey = naclUtil.decodeBase64(newKeyBase64);
               currentGroup.key = newKey;
              //  console.log(`\n🔄 群组密钥已由 ${data.sender} 更新（广播解密）`);
           }
           return;
        }
        // 处理轮换选举（rotate_election）
        // 竞争机制，决定谁有轮换密钥的权力
        if (data.type === 'rotate_election') {
           const senderUser = onlineUsers.get(data.sender);
           if (!senderUser) {
            //  console.log(`\n⚠️  收到轮换选举，但发送者 ${data.sender} 未知，忽略`);
             return;
           }

           const senderKeyRaw = naclUtil.decodeBase64(senderUser.publicKey);
           // 验证签名
           if (!verifySignature(data.content, data.signature, senderKeyRaw)) {
            //  console.log(`\n⚠️  收到轮换选举，但签名无效，忽略`);
             return;
           }

           let payload = null;
           try {
             payload = JSON.parse(data.content);
           } catch (e) {
            //  console.log(`\n⚠️  轮换选举内容解析失败`);
             return;
           }

           // 决定谁来发起轮换：优先创建者（creator），若创建者在线则由创建者发起；否则由最近活跃发送者发起
           const creator = currentGroup && currentGroup.creator ? currentGroup.creator : null;
           const preferred = (creator && onlineUsers.has(creator)) ? creator : (payload.lastActiveSender || (currentGroup && currentGroup.lastActiveSender));

           if (!preferred) {
             // 无合适发起者，忽略
             return;
           }

           if (preferred === credentials.username) {
             // 避免重复轮换：如果上次轮换在短时间内发生，忽略
             const now = Date.now();
             currentGroup.lastRotationAt = currentGroup.lastRotationAt || 0;
             if (now - currentGroup.lastRotationAt < 5000) {
               // 如果 5 秒内已经轮换过，忽略重复
               return;
             }

            //  console.log(`\n🗳️ 本设备被选为轮换发起者（来源: ${data.sender}），开始执行轮换`);
             try {
               await performGroupKeyRotation(credentials.username);
               currentGroup.lastRotationAt = Date.now();
             } catch (e) {
               console.error('执行轮换失败:', e);
             }
           } else {
             // 不是本设备发起，忽略
           }
           return;
        }

        // 验证普通消息签名
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
          // 更新最近活跃发送者
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
      
      // 初始化防重放保护 (每个群组一个实例)
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

      // 初始化成员列表（包括自己和当前已知在线用户）
      currentGroup.members = [credentials.username, ...Array.from(onlineUsers.keys())].filter((v, i, a) => a.indexOf(v) === i);
      // 标记创建者
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
            
            // 初始化防重放保护
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

            // 初始化成员列表（包括自己和当前已知在线用户）
            currentGroup.members = [credentials.username, ...Array.from(onlineUsers.keys())].filter((v, i, a) => a.indexOf(v) === i);
            // 标记创建者
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

            const sortedUsers = [credentials.username, targetUser].sort();
            const dmTopic = `dm-${sortedUsers.join('-')}`;
            
            // 发送信号
            await node.publish(USER_REGISTRY_TOPIC, JSON.stringify({
                type: 'dm_signal',
                target: targetUser,
                sender: credentials.username
            }));

            // 初始化防重放保护
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
            
            // 加载历史记录
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
            // 标记为最近活跃发送者
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

// 主函数：包装 attemptLogin 并实现重试循环
async function main() {
  // 初始化注册表
  initRegistry();

  // 监听退出信号，保存注册表
  process.on('SIGINT', () => {
    console.log('\n[System] 正在保存数据并退出...');
    saveRegistryToDisk();
    process.exit(0);
  });

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
      } else if (error.code === 'REGISTRATION_LIMIT') {
        // 达到注册限制，退出
        process.exit(1);
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

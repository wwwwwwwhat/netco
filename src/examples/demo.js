/**
 * 演示示例 - 群组聊天和点对点消息
 */

import SecureSocialNetwork from '../index.js';

async function runDemo() {
  console.log(`\n========================================`);
  console.log(`  去中心化安全社交网络 - 演示`);
  console.log(`========================================\n`);

  // 创建两个用户
  const alice = new SecureSocialNetwork();
  const bob = new SecureSocialNetwork();

  try {
    // 初始化 Alice (端口 9001)
    await alice.initialize('alice', 'password123', 9001);

    // 初始化 Bob (端口 9002,连接到Alice)
    const aliceAddrs = alice.getNodeInfo().addresses;
    await bob.initialize('bob', 'password456', 9002, [aliceAddrs[0]]);

    // 等待节点连接
    console.log(`\n⏳ 等待节点连接...`);
    await sleep(3000);

    // === 演示1: 群组聊天 ===
    console.log(`\n\n========================================`);
    console.log(`  演示1: 群组聊天`);
    console.log(`========================================\n`);

    // Alice创建群组
    const group = alice.createGroup('项目讨论组');
    console.log(`\n📋 群组信息:`);
    console.log(`   群组ID: ${group.groupId}`);
    console.log(`   共享密钥: ${group.sharedKey}`);

    // Bob加入群组
    await sleep(1000);
    bob.joinGroup(group.groupId, '项目讨论组', group.sharedKey);

    // 等待订阅生效
    await sleep(2000);

    // Alice发送消息
    console.log(`\n💬 Alice 发送群组消息...`);
    await alice.sendGroupMessage(group.groupId, '大家好!这是一个去中心化的群聊!');

    await sleep(1000);

    // Bob发送消息
    console.log(`\n💬 Bob 发送群组消息...`);
    await bob.sendGroupMessage(group.groupId, '你好Alice!消息加密传输真安全!');

    await sleep(2000);

    // === 演示2: 点对点消息 ===
    console.log(`\n\n========================================`);
    console.log(`  演示2: 点对点即时通讯`);
    console.log(`========================================\n`);

    // 交换公钥
    const alicePublicKey = alice.getPublicKey();
    const bobPublicKey = bob.getPublicKey();

    console.log(`\n🔑 公钥交换:`);
    console.log(`   Alice公钥: ${alicePublicKey.substring(0, 32)}...`);
    console.log(`   Bob公钥: ${bobPublicKey.substring(0, 32)}...`);

    // Alice开始与Bob对话
    const aliceConvId = alice.startDirectMessage(bobPublicKey, 'bob');
    await sleep(1000);

    // Bob开始与Alice对话
    const bobConvId = bob.startDirectMessage(alicePublicKey, 'alice');
    await sleep(2000);

    // Alice发送私聊消息
    console.log(`\n💬 Alice 发送私聊消息...`);
    await alice.sendDirectMessage(aliceConvId, '嗨Bob,这是私密对话!');

    await sleep(1000);

    // Bob回复
    console.log(`\n💬 Bob 回复私聊消息...`);
    await bob.sendDirectMessage(bobConvId, '收到!端到端加密很棒!');

    await sleep(2000);

    // === 显示状态 ===
    console.log(`\n\n========================================`);
    console.log(`  当前状态`);
    console.log(`========================================\n`);

    console.log(`Alice的群组:`, alice.listGroups());
    console.log(`Alice的对话:`, alice.listDirectMessages());

    console.log(`\nBob的群组:`, bob.listGroups());
    console.log(`Bob的对话:`, bob.listDirectMessages());

    console.log(`\n✅ 演示完成!`);
    console.log(`\n提示: 按 Ctrl+C 退出`);

    // 保持运行
    await sleep(60000);

  } catch (error) {
    console.error(`❌ 错误:`, error.message);
  } finally {
    // 清理
    await alice.stop();
    await bob.stop();
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 运行演示
runDemo().catch(console.error);

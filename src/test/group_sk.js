import { createGroup, handleGroupMessage } from '../utils/communication/group.js';
import { generateKeyPairFromCredentials, signMessage } from '../crypto/identity.js';
import { symmetricEncrypt, symmetricDecrypt } from '../crypto/encryption.js';
import naclUtil from 'tweetnacl-util';
import crypto from 'crypto';

async function testGroupSecurity() {
    console.log("=== 群组安全性测试 ===\n");

    // 1. 初始化用户
    const alice = await generateKeyPairFromCredentials("Alice", "password123");
    const bob = await generateKeyPairFromCredentials("Bob", "password123");
    const eve = await generateKeyPairFromCredentials("Eve", "password123"); // 恶意用户

    // 模拟在线用户列表
    const onlineUsers = new Map();
    onlineUsers.set("Alice", { publicKey: alice.publicKey });
    onlineUsers.set("Bob", { publicKey: bob.publicKey });
    onlineUsers.set("Eve", { publicKey: eve.publicKey });

    // 2. Alice 创建群组
    const group = createGroup("SecretGroup", { username: "Alice" });
    console.log(`[Setup] 群组已创建，Key: ${naclUtil.encodeBase64(group.key).substring(0, 10)}...`);
    const bobGroup = { ...group, replayProtection: { isReplay: () => false } };
    const eveGroup = { ...group, replayProtection: { isReplay: () => false } };

    // ==========================================
    // 场景 1: 群组内成员冒充别人
    // Eve 试图冒充 Alice 发送消息
    // ==========================================
    console.log("\n--- 场景 1: 成员冒充测试 ---");
    
    const fakeContent = "I am Alice.";
    // Eve 使用群组密钥加密 (她有这个权限)
    const encryptedFake = symmetricEncrypt(fakeContent, eveGroup.key);
    
    // Eve 试图签名:
    // 情况 A: Eve 使用自己的私钥签名，但声称是 Alice 发的
    const signatureA = signMessage(encryptedFake, eve.secretKeyRaw);
    
    const fakeMessageA = {
        type: 'message',
        sender: "Alice", // <--- 伪造发送者
        content: encryptedFake,
        timestamp: Date.now(),
        signature: signatureA
    };

    console.log("1. Eve 发送伪造消息 (Sender=Alice, SignedBy=Eve)...");
    
    // Bob 收到消息
    const resultA = handleGroupMessage(fakeMessageA, bobGroup, onlineUsers);
    
    if (resultA && resultA.sigStatus === false) {
        console.log("冒充失败: 签名验证不通过 (预期结果)");
        console.log(`   系统识别状态: ${resultA.sigStatus}`);
    } else {
        console.log("测试失败: 系统未检测到冒充行为");
        console.log(resultA);
    }

    // ==========================================
    // 场景 2: 群组成员离开后，仍去解密群组消息
    // (测试前向安全性/密钥轮换的必要性)
    // ==========================================
    console.log("\n--- 场景 2: 离群成员解密测试 ---");

    // 1. 保存旧密钥 (Eve 只有这个)
    const oldKey = eveGroup.key;
    console.log(`1. Eve 持有旧密钥: ${naclUtil.encodeBase64(oldKey).substring(0, 10)}...`);

    // 2. 群组发生密钥轮换 (Alice 和 Bob 更新了密钥)
    const newKey = crypto.randomBytes(32);
    bobGroup.key = newKey; // Bob 更新了
    // Alice 也更新了 (这里主要测试 Bob 接收)
    console.log(`2. 群组密钥已轮换: ${naclUtil.encodeBase64(newKey).substring(0, 10)}...`);

    // 3. Alice 使用新密钥发送消息
    const secretMsg = "This is a message for current members only.";
    const encryptedSecret = symmetricEncrypt(secretMsg, newKey);
    
    const validMessage = {
        type: 'message',
        sender: "Alice",
        content: encryptedSecret,
        timestamp: Date.now(),
        signature: signMessage(encryptedSecret, alice.secretKeyRaw)
    };

    console.log("3. Alice 发送新消息 (使用新密钥)...");

    // 4. Eve 试图使用旧密钥解密
    console.log("4. Eve 尝试使用旧密钥解密...");
    
    // 模拟 Eve 的处理逻辑 (直接调用解密函数，因为 handleGroupMessage 会用 Eve 当前的 key)
    // 我们手动模拟 Eve 只有 oldKey 的情况
    try {
        const decryptedByEve = symmetricDecrypt(validMessage.content, oldKey);
        if (decryptedByEve) {
            console.log("测试失败: Eve 成功解密了新消息！");
            console.log(`   内容: ${decryptedByEve}`);
        } else {
            console.log("解密失败: 返回 null (预期结果)");
        }
    } catch (e) {
        console.log("解密抛出异常 (预期结果)");
        console.log(`   错误信息: ${e.message}`);
    }

    // 5. Bob 尝试解密 (验证消息本身是好的)
    console.log("5. Bob (已更新密钥) 尝试解密...");
    const resultBob = handleGroupMessage(validMessage, bobGroup, onlineUsers);
    if (resultBob && resultBob.content === secretMsg) {
        console.log(`Bob 解密成功: "${resultBob.content}"`);
    } else {
        console.log("Bob 解密失败");
    }
}

testGroupSecurity().catch(console.error);
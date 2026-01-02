import { createGroup, handleGroupMessage } from '../utils/communication/group.js';
import { handleDMMessage } from '../utils/communication/dm.js';
import { generateKeyPairFromCredentials } from '../crypto/identity.js';
import { encryptMessage, symmetricEncrypt } from '../crypto/encryption.js';
import { ReplayProtection } from '../utils/security/replay_protection.js';
import naclUtil from 'tweetnacl-util';

async function testReplayAttack() {
    console.log("=== 开始重放攻击测试 ===\n");

    const alice = await generateKeyPairFromCredentials("Alice", "password123");
    const bob = await generateKeyPairFromCredentials("Bob", "password123");
    
    const onlineUsers = new Map();
    onlineUsers.set("Alice", { publicKey: alice.publicKey });
    onlineUsers.set("Bob", { publicKey: bob.publicKey });

    console.log("--- 测试 1: 群组通信防重放 ---");
    
    const group = createGroup("TestGroup", { username: "Alice" });
    
    const plainText = "Hello Group";
    const encryptedGroupContent = symmetricEncrypt(plainText, group.key);

    const groupMsgData = {
        sender: "Alice",
        content: encryptedGroupContent,
        timestamp: Date.now(),
        signature: "MockSignature" // 签名验证在防重放之后，不影响测试
    };

    console.log("1. 第一次接收群消息...");
    try {
        const result1 = handleGroupMessage(groupMsgData, group, onlineUsers);
        if (result1 !== null) {
            console.log("第一次接收成功");
        } else {
            console.log("第一次接收失败");
        }
    } catch (e) {
        console.log("第一次接收出错:", e.message);
    }

    console.log("2. 尝试重放同一条消息...");
    const result2 = handleGroupMessage(groupMsgData, group, onlineUsers);
    if (result2 === null) {
        console.log("重放攻击被拦截");
    } else {
        console.log("重放攻击成功");
    }

    console.log("3. 测试过期消息...");
    const oldTimestamp = Date.now() - (10 * 60 * 1000);
    const oldMsgData = { ...groupMsgData, timestamp: oldTimestamp };
    const result3 = handleGroupMessage(oldMsgData, group, onlineUsers);
    if (result3 === null) {
        console.log("过期消息被拦截");
    } else {
        console.log("过期消息未被拦截");
    }

    console.log("\n--- 测试 2: 私聊通信防重放 ---");

    const dmContent = "Hello Bob, this is a secret.";
    const encryptedContent = encryptMessage(
        dmContent, 
        naclUtil.decodeBase64(bob.publicKey), 
        alice.secretKeyRaw
    );

    const dmMsgData = {
        type: 'dm_message',
        sender: "Alice",
        content: encryptedContent,
        timestamp: Date.now()
    };

    const bobDMSession = {
        type: 'dm',
        target: "Alice",
        peerPublicKey: alice.publicKey,
        participants: ["Alice", "Bob"],
        replayProtection: new ReplayProtection()
    };

    console.log("1. 第一次接收私聊消息...");
    const decrypted1 = handleDMMessage(dmMsgData, bobDMSession, bob, { username: "Bob" });
    
    if (decrypted1) {
        console.log(`第一次解密成功: "${decrypted1.content}"`);
    } else {
        console.log("第一次解密失败");
    }

    console.log("2. 尝试重放同一条私聊消息...");
    const decrypted2 = handleDMMessage(dmMsgData, bobDMSession, bob, { username: "Bob" });

    if (decrypted2) {
        console.log(`重放攻击成功（"${decrypted2.content}"）`);
    } else {
        console.log("重放攻击被拦截");
    }
}

testReplayAttack().catch(console.error);
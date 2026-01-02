/**
 * 主要为了方便测试
 */

import { encryptMessage, decryptMessage } from '../../crypto/encryption.js';
import { cacheMessage } from '../../data/msg_storage.js';
import { ReplayProtection } from '../security/replay_protection.js';
import crypto from 'crypto';
import naclUtil from 'tweetnacl-util';

export async function initiateDMSession(targetUsername, node, credentials, onlineUsers, registryTopic) {
    if (targetUsername === credentials.username) {
        throw new Error("不能和自己私聊");
    }

    const targetUser = onlineUsers.get(targetUsername);
    if (!targetUser) {
        throw new Error(`用户 "${targetUsername}" 不在线`);
    }


    // 用户名排序确保topic唯一
    const participants = [credentials.username, targetUsername].sort();
    const topicStr = `dm-${participants.join('-')}`;
    
    await node.publish(registryTopic, JSON.stringify({
        type: 'dm_signal',
        sender: credentials.username,
        target: targetUsername,
        timestamp: Date.now()
    }));

    const replayProtection = new ReplayProtection();

    return {
        type: 'dm',
        target: targetUsername,
        topic: topicStr,
        peerPublicKey: targetUser.publicKey,
        participants: participants,
        replayProtection: replayProtection
    };
}

export async function sendDMMessage(content, currentGroup, node, credentials, userKeys) {
    const peerPublicKeyRaw = naclUtil.decodeBase64(currentGroup.peerPublicKey);
    const encrypted = encryptMessage(content, peerPublicKeyRaw, userKeys.secretKeyRaw);
    
    const messageData = {
        type: 'dm_message',
        sender: credentials.username,
        content: encrypted,
        timestamp: Date.now()
    };

    await node.publish(currentGroup.topic, JSON.stringify(messageData));

    cacheMessage(credentials.username, {
        ...messageData,
        type: 'direct_message',
        content: content,
        isOwn: true,
        target: currentGroup.target,
        senderPublicKey: userKeys.publicKey,
        peerPublicKey: currentGroup.peerPublicKey
    });
}

export function handleDMMessage(data, currentGroup, userKeys, credentials) {
    if (currentGroup.replayProtection && currentGroup.replayProtection.isReplay(data.sender, data.content, data.timestamp)) {
        return null;
    }

    if (data.sender === credentials.username) {
        return null; 
    }

    const peerPublicKeyRaw = naclUtil.decodeBase64(currentGroup.peerPublicKey);
    const decrypted = decryptMessage(data.content, peerPublicKeyRaw, userKeys.secretKeyRaw);
    
    if (decrypted) {
        const msgObj = {
            ...data,
            type: 'direct_message',
            content: decrypted,
            isOwn: false,
            target: credentials.username,
            senderPublicKey: currentGroup.peerPublicKey,
            peerPublicKey: userKeys.publicKey
        };
        cacheMessage(credentials.username, msgObj);
        return msgObj;
    }
    return null;
}

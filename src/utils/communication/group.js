/**
 * 主要为了方便测试
 */

import { symmetricEncrypt, symmetricDecrypt } from '../../crypto/encryption.js';
import { signMessage, verifySignature } from '../../crypto/identity.js';
import { createInviteCode, formatInviteCode, parseInviteCode, unformatInviteCode } from './inviteCode.js';
import { ReplayProtection } from '../security/replay_protection.js';
import naclUtil from 'tweetnacl-util';
import crypto from 'crypto';

export function createGroup(groupName, credentials) {
    const groupId = crypto.randomBytes(8).toString('hex');
    const sharedKey = crypto.randomBytes(32);
    const topic = `group-${groupId}`;

    const inviteCode = createInviteCode(groupId, sharedKey, groupName, credentials.username);
    const formattedInvite = formatInviteCode(inviteCode);

    const replayProtection = new ReplayProtection();

    return {
        type: 'group',
        id: groupId,
        name: groupName,
        key: sharedKey,
        topic: topic,
        inviteCode: inviteCode,
        formattedInvite: formattedInvite,
        replayProtection: replayProtection
    };
}

export function joinGroup(inviteCodeStr) {
    const cleanCode = unformatInviteCode(inviteCodeStr);
    const invite = parseInviteCode(cleanCode);

    if (invite.isExpired) {
        throw new Error(`邀请码已过期（创建于 ${new Date(invite.createdAt).toLocaleString()}）`);
    }

    const topic = `group-${invite.groupId}`;
    const replayProtection = new ReplayProtection();

    return {
        type: 'group',
        id: invite.groupId,
        name: invite.groupName,
        key: invite.sharedKey,
        topic: topic,
        inviteCode: cleanCode,
        replayProtection: replayProtection,
        creator: invite.creator,
        createdAt: invite.createdAt
    };
}

// 对称加密+签名
export async function sendGroupMessage(content, currentGroup, node, credentials, userKeys) {
    const encryptedContent = symmetricEncrypt(content, currentGroup.key);
    const signature = signMessage(encryptedContent, userKeys.secretKeyRaw);

    const messageData = {
        type: 'message',
        sender: credentials.username,
        content: encryptedContent,
        timestamp: Date.now(),
        signature: signature
    };

    await node.publish(currentGroup.topic, JSON.stringify(messageData));
}

export function handleGroupMessage(data, currentGroup, onlineUsers) {
    if (currentGroup.replayProtection.isReplay(data.sender, data.content, data.timestamp)) {
        return null;
    }

    let sigStatus = null;
    if (data.signature) {
        const senderUser = onlineUsers.get(data.sender);
        if (senderUser) {
            const senderKeyRaw = naclUtil.decodeBase64(senderUser.publicKey);
            const isValid = verifySignature(data.content, data.signature, senderKeyRaw);
            sigStatus = isValid ? true : false;
        }
    }

    try {
        const decryptedContent = symmetricDecrypt(data.content, currentGroup.key);
        return {
            ...data,
            content: decryptedContent,
            sigStatus: sigStatus
        };
    } catch (err) {
        console.error("解密失败:", err);
        return null;
    }
}

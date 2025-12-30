/**
 * encryption.js
 * 安全层：消息加密实现
 */

import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import crypto from 'crypto';
import ed2curve from 'ed2curve';
import { hashData } from './digest.js';

const b64_encode = naclUtil.encodeBase64;
const b64_decode = naclUtil.decodeBase64;

/**
 * 加密消息
 * @param {string} message - 要加密的消息
 * @param {Uint8Array} recipientPublicKey - 接收方的公钥(Ed25519原始格式)
 * @param {Uint8Array} senderSecretKey - 发送方的私钥(Ed25519原始格式)
 * @returns {string} Base64编码的加密消息
 */
export function encryptMessage(message, recipientPublicKey, senderSecretKey) {
  // 将消息转换为字节数组
  const messageBytes = new TextEncoder().encode(message);

  // 生成随机nonce (24字节)
  const nonce = nacl.randomBytes(24);

  // 转换密钥 Ed25519 -> Curve25519
  const senderEncryptSecret = ed2curve.convertSecretKey(senderSecretKey);
  const recipientEncryptPublic = ed2curve.convertPublicKey(recipientPublicKey);

  if (!senderEncryptSecret || !recipientEncryptPublic) {
    throw new Error('密钥转换失败: 无效的 Ed25519 密钥');
  }

  // 使用 Box 加密
  const encryptedMessage = nacl.box(
    messageBytes,
    nonce,
    recipientEncryptPublic,
    senderEncryptSecret
  );

  // 将 nonce 和加密消息组合
  const fullMessage = new Uint8Array(nonce.length + encryptedMessage.length);
  fullMessage.set(nonce);
  fullMessage.set(encryptedMessage, nonce.length);

  return b64_encode(fullMessage);
}

/**
 * 解密消息
 * @param {string} encryptedMessageBase64 - Base64编码的加密消息
 * @param {Uint8Array} senderPublicKey - 发送方的公钥(Ed25519原始格式)
 * @param {Uint8Array} recipientSecretKey - 接收方的私钥(Ed25519原始格式)
 * @returns {string|null} 解密后的消息，失败返回null
 */
export function decryptMessage(encryptedMessageBase64, senderPublicKey, recipientSecretKey) {
  try {
    const fullMessage = b64_decode(encryptedMessageBase64);
    
    if (fullMessage.length < 24) return null;

    const nonce = fullMessage.slice(0, 24);
    const encryptedMessage = fullMessage.slice(24);

    // 转换密钥 Ed25519 -> Curve25519
    const recipientEncryptSecret = ed2curve.convertSecretKey(recipientSecretKey);
    const senderEncryptPublic = ed2curve.convertPublicKey(senderPublicKey);

    if (!recipientEncryptSecret || !senderEncryptPublic) {
      return null;
    }

    const decryptedBytes = nacl.box.open(
      encryptedMessage,
      nonce,
      senderEncryptPublic,
      recipientEncryptSecret
    );

    if (!decryptedBytes) { 
      return null;
    }

    return new TextDecoder().decode(decryptedBytes);
  } catch (error) {
    // console.error('解密失败:', error);
    return null;
  }
}

/**
 * 生成消息标签 (Tag)
 * 使用密钥的部分作为标签,用于过滤
 * @param {Uint8Array} publicKey - 公钥
 * @returns {string} 标签 (前8个字节的hex表示)
 */
export function generateTag(publicKey) {
  const tagBytes = publicKey.slice(0, 8);
  return Array.from(tagBytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 验证消息标签
 * @param {string} tag - 消息携带的标签
 * @param {Uint8Array} publicKey - 用于验证的公钥
 * @returns {boolean} 标签是否匹配
 */
export function verifyTag(tag, publicKey) {
  return tag === generateTag(publicKey);
}

/**
 * 对称加密 (用于群组消息)
 * @param {string} message - 消息内容
 * @param {Uint8Array} sharedKey - 共享密钥 (32字节)
 * @returns {string} Base64编码的加密消息
 */
export function symmetricEncrypt(message, sharedKey) {
  const messageBytes = new TextEncoder().encode(message);
  const nonce = nacl.randomBytes(24);

  const encrypted = nacl.secretbox(messageBytes, nonce, sharedKey);

  // send-message = nonce + cipher
  const fullMessage = new Uint8Array(nonce.length + encrypted.length);
  fullMessage.set(nonce);
  fullMessage.set(encrypted, nonce.length);

  return b64_encode(fullMessage);
}

/**
 * 对称解密 (用于群组消息)
 * @param {string} encryptedMessage - Base64编码的加密消息
 * @param {Uint8Array} sharedKey - 共享密钥 (32字节)
 * @returns {string|null} 解密后的消息
 */
export function symmetricDecrypt(encryptedMessage, sharedKey) {
  try {
    const fullMessage = b64_decode(encryptedMessage);
    const nonce = fullMessage.slice(0, 24);
    const encrypted = fullMessage.slice(24);

    const decrypted = nacl.secretbox.open(encrypted, nonce, sharedKey);

    if (!decrypted) {
      return null;
    }

    return new TextDecoder().decode(decrypted);
  } catch (error) {
    // console.error('对称解密失败:', error.message);
    return null;
  }
}

/**
 * 从用户名和密码派生存储密钥 (AES-256)
 * @param {string} username
 * @param {string} password
 * @returns {Buffer} 32字节密钥
 */
export function deriveStorageKey(username, password) {
  const salt = hashData(username);
  // 使用 pbkdf2 同步版本
  return crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha512');
}

/**
 * 使用 AES-256-GCM 加密数据 (用于本地存储)
 * @param {string} text
 * @param {Buffer} key
 * @returns {string} base64 encoded (iv:authTag:encrypted)
 */
export function encryptStorageData(text, key) {
  const iv = crypto.randomBytes(12); // GCM standard IV size
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:encrypted
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
}

/**
 * 使用 AES-256-GCM 解密数据 (用于本地存储)
 * @param {string} encryptedData
 * @param {Buffer} key
 * @returns {string|null} decrypted text
 */
export function decryptStorageData(encryptedData, key) {
  try {
    const parts = encryptedData.split(':');
    if (parts.length !== 3) return null;
    
    const iv = Buffer.from(parts[0], 'base64');
    const authTag = Buffer.from(parts[1], 'base64');
    const encrypted = parts[2];

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    // console.error('Storage decryption failed:', e.message);
    return null;
  }
}

export default {
  encryptMessage,
  decryptMessage,
  generateTag,
  verifyTag,
  symmetricEncrypt,
  symmetricDecrypt,
  deriveStorageKey,
  encryptStorageData,
  decryptStorageData
};

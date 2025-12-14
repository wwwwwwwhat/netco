/**
 * 安全层 - 消息加密和解密
 * 使用 NaCl Box (Curve25519 + XSalsa20 + Poly1305) 进行端到端加密
 */

import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import crypto from 'crypto';
import ed2curve from 'ed2curve';

const b64_encode = naclUtil.encodeBase64;
const b64_decode = naclUtil.decodeBase64;

/**
 * 将签名密钥转换为加密密钥
 * Ed25519 -> Curve25519
 */
function convertSignKeyToEncryptKey(signKey) {
  return nacl.sign.keyPair.fromSecretKey(signKey);
}

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
        console.error('密钥转换失败');
        return null;
    }

    const decryptedBytes = nacl.box.open(
      encryptedMessage,
      nonce,
      senderEncryptPublic,
      recipientEncryptSecret
    );

    if (!decryptedBytes) return null;

    return new TextDecoder().decode(decryptedBytes);
  } catch (error) {
    console.error('解密失败:', error);
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
  const expectedTag = generateTag(publicKey);
  return tag === expectedTag;
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
    console.error('对称解密失败:', error.message);
    return null;
  }
}

export default {
  encryptMessage,
  decryptMessage,
  generateTag,
  verifyTag,
  symmetricEncrypt,
  symmetricDecrypt
};

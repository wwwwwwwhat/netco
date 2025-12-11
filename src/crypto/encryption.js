/**
 * 安全层 - 消息加密和解密
 * 使用 NaCl Box (Curve25519 + XSalsa20 + Poly1305) 进行端到端加密
 */

import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';

const encode = naclUtil.encodeBase64;
const decode = naclUtil.decodeBase64;

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
 * @param {Uint8Array} recipientPublicKey - 接收方的公钥(原始格式)
 * @param {Uint8Array} senderSecretKey - 发送方的私钥(原始格式)
 * @returns {string} Base64编码的加密消息
 */
export function encryptMessage(message, recipientPublicKey, senderSecretKey) {
  // 将消息转换为字节数组
  const messageBytes = new TextEncoder().encode(message);

  // 生成随机nonce (24字节)
  const nonce = nacl.randomBytes(24);

  // 从签名密钥派生加密密钥
  const senderKeyPair = nacl.sign.keyPair.fromSecretKey(senderSecretKey);
  const senderEncryptSecret = nacl.box.keyPair.fromSecretKey(
    senderKeyPair.secretKey.slice(0, 32)
  ).secretKey;

  const recipientEncryptPublic = nacl.sign.keyPair.fromSecretKey(
    new Uint8Array([...recipientPublicKey, ...new Uint8Array(32)])
  ).publicKey;

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

  return encode(fullMessage);
}

/**
 * 解密消息
 * @param {string} encryptedMessage - Base64编码的加密消息
 * @param {Uint8Array} senderPublicKey - 发送方的公钥(原始格式)
 * @param {Uint8Array} recipientSecretKey - 接收方的私钥(原始格式)
 * @returns {string|null} 解密后的消息,失败返回null
 */
export function decryptMessage(encryptedMessage, senderPublicKey, recipientSecretKey) {
  try {
    // 解码Base64
    const fullMessage = decode(encryptedMessage);

    // 提取nonce和加密内容
    const nonce = fullMessage.slice(0, 24);
    const encrypted = fullMessage.slice(24);

    // 从签名密钥派生加密密钥
    const recipientKeyPair = nacl.sign.keyPair.fromSecretKey(recipientSecretKey);
    const recipientEncryptSecret = nacl.box.keyPair.fromSecretKey(
      recipientKeyPair.secretKey.slice(0, 32)
    ).secretKey;

    const senderEncryptPublic = nacl.sign.keyPair.fromSecretKey(
      new Uint8Array([...senderPublicKey, ...new Uint8Array(32)])
    ).publicKey;

    // 解密
    const decrypted = nacl.box.open(
      encrypted,
      nonce,
      senderEncryptPublic,
      recipientEncryptSecret
    );

    if (!decrypted) {
      return null;
    }

    return new TextDecoder().decode(decrypted);
  } catch (error) {
    console.error('解密失败:', error.message);
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

  return encode(fullMessage);
}

/**
 * 对称解密 (用于群组消息)
 * @param {string} encryptedMessage - Base64编码的加密消息
 * @param {Uint8Array} sharedKey - 共享密钥 (32字节)
 * @returns {string|null} 解密后的消息
 */
export function symmetricDecrypt(encryptedMessage, sharedKey) {
  try {
    const fullMessage = decode(encryptedMessage);
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

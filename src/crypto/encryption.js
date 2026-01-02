import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import crypto from 'crypto';
import ed2curve from 'ed2curve';
import { hashData } from './digest.js';

const b64_encode = naclUtil.encodeBase64;
const b64_decode = naclUtil.decodeBase64;

// Ed25519转Curve25519 才能box加密
export function encryptMessage(message, recipientPublicKey, senderSecretKey) {
  const messageBytes = new TextEncoder().encode(message);
  const nonce = nacl.randomBytes(24);

  const senderEncryptSecret = ed2curve.convertSecretKey(senderSecretKey);
  const recipientEncryptPublic = ed2curve.convertPublicKey(recipientPublicKey);

  if (!senderEncryptSecret || !recipientEncryptPublic) {
    throw new Error('密钥转换失败 Ed25519无效');
  }

  const encryptedMessage = nacl.box(
    messageBytes,
    nonce,
    recipientEncryptPublic,
    senderEncryptSecret
  );

  // nonce放前 解密时提
  const fullMessage = new Uint8Array(nonce.length + encryptedMessage.length);
  fullMessage.set(nonce);
  fullMessage.set(encryptedMessage, nonce.length);

  return b64_encode(fullMessage);
}

export function decryptMessage(encryptedMessageBase64, senderPublicKey, recipientSecretKey) {
  try {
    const fullMessage = b64_decode(encryptedMessageBase64);
    
    if (fullMessage.length < 24) return null;

    const nonce = fullMessage.slice(0, 24);
    const encryptedMessage = fullMessage.slice(24);

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
    return null;
  }
}

// 公钥前8字节做tag 快速过滤
export function generateTag(publicKey) {
  const tagBytes = publicKey.slice(0, 8);
  return Array.from(tagBytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function verifyTag(tag, publicKey) {
  return tag === generateTag(publicKey);
}

// 群聊对称加密 nonce+密文
export function symmetricEncrypt(message, sharedKey) {
  const messageBytes = new TextEncoder().encode(message);
  const nonce = nacl.randomBytes(24);

  const encrypted = nacl.secretbox(messageBytes, nonce, sharedKey);

  const fullMessage = new Uint8Array(nonce.length + encrypted.length);
  fullMessage.set(nonce);
  fullMessage.set(encrypted, nonce.length);

  return b64_encode(fullMessage);
}

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
    return null;
  }
}

// 本地存储密钥派生 pbkdf2 10万次
export function deriveStorageKey(username, password) {
  const salt = hashData(username);
  return crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha512');
}

// GCM模式 12字节IV 格式iv:authTag:密文
export function encryptStorageData(text, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag();

  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
}

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

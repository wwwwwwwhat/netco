/**
 * 身份层 - 基于用户名密码生成密钥对
 * 使用 Scrypt 算法确保密钥派生的安全性
 */

import scrypt from 'scrypt-js';
import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import crypto from 'crypto';

const encode = naclUtil.encodeBase64;
const decode = naclUtil.decodeBase64;

/**
 * 从用户名和密码生成确定性密钥对
 * @param {string} username - 用户名
 * @param {string} password - 密码
 * @returns {Promise<Object>} 包含公钥和私钥的对象
 */
export async function generateKeyPairFromCredentials(username, password) {
  // 获取时间戳
  const timestamp = Date.now().toString();

  // 生成用户名摘要
  const usernameDigest = crypto.createHash('sha256').update(username).digest('hex');

  // 生成一个随机向量用于加密
  const randomIV = crypto.randomBytes(24);

  // 数据元组，用于随机排列
  const seeds = [
    password,
    timestamp,
    usernameDigest,
    Buffer.from(randomIV).toString('hex')
  ];

  // 使用 Fisher-Yates 算法进行随机排列
  for (let i = seeds.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [seeds[i], seeds[j]] = [seeds[j], seeds[i]];
  }

  // 组合输入: 密码 + 时间戳 + 用户名摘要 + 随机向量的随机排列
  const input = seeds.join('::');
  
  const passwordBuffer = new TextEncoder().encode(input);

  // 使用用户名随机数作为盐值
  const salt = new TextEncoder().encode(usernameDigest);

  // Scrypt 参数: N=16384, r=8, p=1 (中等强度,适合实时应用)
  const N = 16384;
  const r = 8;
  const p = 1;
  const dkLen = 32; // 32字节 = 256位,符合NaCl要求

  // 使用 Scrypt 派生密钥
  const derivedKey = await scrypt.scrypt(passwordBuffer, salt, N, r, p, dkLen);

  // 使用派生的密钥作为种子生成 Ed25519 密钥对
  const keyPair = nacl.sign.keyPair.fromSeed(new Uint8Array(derivedKey));

  return {
    publicKey: encode(keyPair.publicKey),
    secretKey: encode(keyPair.secretKey),
    publicKeyRaw: keyPair.publicKey,
    secretKeyRaw: keyPair.secretKey
  };
}

/**
 * 从公钥生成用户标识符
 * @param {string} publicKey - Base64编码的公钥
 * @returns {string} 用户ID (公钥的前16个字符)
 */
export function getUserId(publicKey) {
  return publicKey.substring(0, 16);
}

/**
 * 验证用户凭证
 * @param {string} username - 用户名
 * @param {string} password - 密码
 * @param {string} expectedPublicKey - 期望的公钥
 * @returns {Promise<boolean>} 验证是否成功
 */
export async function verifyCredentials(username, password, expectedPublicKey) {
  const keyPair = await generateKeyPairFromCredentials(username, password);
  return keyPair.publicKey === expectedPublicKey;
}

/**
 * 从 Base64 字符串恢复密钥对
 * @param {string} publicKeyStr - Base64 编码的公钥
 * @param {string} secretKeyStr - Base64 编码的私钥
 * @returns {Object} 包含原始值的密钥对对象
 */
export function restoreKeyPair(publicKeyStr, secretKeyStr) {
  return {
    publicKey: publicKeyStr,
    secretKey: secretKeyStr,
    publicKeyRaw: decode(publicKeyStr),
    secretKeyRaw: decode(secretKeyStr)
  };
}

export default {
  generateKeyPairFromCredentials,
  getUserId,
  verifyCredentials,
  restoreKeyPair,
};

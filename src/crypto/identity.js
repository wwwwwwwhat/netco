/**
 * 身份层 - 基于用户名密码生成密钥对
 * 使用 Scrypt 算法确保密钥派生的安全性
 */

import scrypt from 'scrypt-js';
import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';

const encode = naclUtil.encodeBase64;
const decode = naclUtil.decodeBase64;

/**
 * 从用户名和密码生成确定性密钥对
 * @param {string} username - 用户名
 * @param {string} password - 密码
 * @returns {Promise<Object>} 包含公钥和私钥的对象
 */
export async function generateKeyPairFromCredentials(username, password) {
  // 将用户名和密码组合作为输入
  const input = `${username}:${password}`;
  const passwordBuffer = new TextEncoder().encode(input);

  // 使用用户名作为盐值,确保相同用户名+密码总是生成相同密钥
  const salt = new TextEncoder().encode(username);

  // Scrypt 参数: N=16384, r=8, p=1 (中等强度,适合实时应用)
  const N = 16384;
  const r = 8;
  const p = 1;
  const dkLen = 32; // 32字节 = 256位,符合NaCl要求

  // 使用 Scrypt 派生密钥
  const derivedKey = await scrypt.scrypt(
    passwordBuffer,
    salt,
    N,
    r,
    p,
    dkLen
  );

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

export default {
  generateKeyPairFromCredentials,
  getUserId,
  verifyCredentials
};

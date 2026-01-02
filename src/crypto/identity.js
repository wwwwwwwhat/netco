import scrypt from 'scrypt-js';
import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import { hashData } from './digest.js';

const encode = naclUtil.encodeBase64;
const decode = naclUtil.decodeBase64;

// scrypt派生 确保同用户名密码生成同密钥对
export async function generateKeyPairFromCredentials(username, password) {
  const input = `${password}::${username}`;
  const buffer = new TextEncoder().encode(input);

  const usernameDigest = hashData(username);
  const salt = new TextEncoder().encode(usernameDigest);

  // scrypt参数 N=16384 r=8 p=1 输出32字节
  const N = 16384;
  const r = 8;
  const p = 1;
  const dkLen = 32;

  const derivedKey = await scrypt.scrypt(buffer, salt, N, r, p, dkLen);

  // 派生密钥当种子 生成Ed25519
  const keyPair = nacl.sign.keyPair.fromSeed(new Uint8Array(derivedKey));

  return {
    publicKey: encode(keyPair.publicKey),
    secretKey: encode(keyPair.secretKey),
    publicKeyRaw: keyPair.publicKey,
    secretKeyRaw: keyPair.secretKey
  };
}

export function getUserId(publicKey) {
  return publicKey.substring(0, 16);
}

export async function verifyCredentials(username, password, expectedPublicKey) {
  const keyPair = await generateKeyPairFromCredentials(username, password);
  return keyPair.publicKey === expectedPublicKey;
}

export function restoreKeyPair(publicKeyStr, secretKeyStr) {
  return {
    publicKey: publicKeyStr,
    secretKey: secretKeyStr,
    publicKeyRaw: decode(publicKeyStr),
    secretKeyRaw: decode(secretKeyStr)
  };
}

// detached签名 不包含消息
export function signMessage(message, secretKey) {
  const messageBytes = new TextEncoder().encode(message);
  const signature = nacl.sign.detached(messageBytes, secretKey);
  return encode(signature);
}

export function verifySignature(message, signatureBase64, publicKey) {
  try {
    const messageBytes = new TextEncoder().encode(message);
    const signature = decode(signatureBase64);
    return nacl.sign.detached.verify(messageBytes, signature, publicKey);
  } catch (e) {
    return false;
  }
}

export default {
  generateKeyPairFromCredentials,
  getUserId,
  verifyCredentials,
  restoreKeyPair,
  signMessage,
  verifySignature
};

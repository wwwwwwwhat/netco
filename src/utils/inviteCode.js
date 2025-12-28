/**
 * 邀请码工具 - 用户友好的群组分享
 * 借鉴 Mastodon 的邀请机制
 */

import crypto from 'crypto';

/**
 * 生成邀请码
 * @param {string} groupId - 群组ID
 * @param {Buffer} sharedKey - 共享密钥
 * @param {string} groupName - 群组名称
 * @param {string} creatorName - 创建者名称
 * @returns {string} Base64URL 编码的邀请码
 */
export function createInviteCode(groupId, sharedKey, groupName = '', creatorName = '') {
  const invite = {
    v: 1,  // 版本号
    gid: groupId,
    key: sharedKey.toString('base64'),
    name: groupName,
    creator: creatorName,
    ts: Date.now()
  };

  // 使用 JSON 序列化后 Base64URL 编码
  const json = JSON.stringify(invite);
  const code = Buffer.from(json).toString('base64url');

  return code;
}

/**
 * 解析邀请码
 * @param {string} code - 邀请码
 * @returns {Object} 解析后的邀请信息
 */
export function parseInviteCode(code) {
  try {
    const json = Buffer.from(code, 'base64url').toString('utf8');
    const invite = JSON.parse(json);

    // 验证必需字段
    if (!invite.gid || !invite.key) {
      throw new Error('邀请码格式错误：缺少必需字段');
    }

    // 检查版本
    if (invite.v !== 1) {
      throw new Error(`不支持的邀请码版本: ${invite.v}`);
    }

    return {
      groupId: invite.gid,
      sharedKey: Buffer.from(invite.key, 'base64'),
      groupName: invite.name || '未命名群组',
      creator: invite.creator || '匿名',
      createdAt: invite.ts,
      isExpired: Date.now() - invite.ts > 7 * 24 * 60 * 60 * 1000  // 7天过期
    };
  } catch (error) {
    throw new Error(`无法解析邀请码: ${error.message}`);
  }
}

/**
 * 格式化邀请码为可读格式（分段显示）
 * @param {string} code - 邀请码
 * @returns {string} 格式化后的邀请码
 */
export function formatInviteCode(code) {
  // 每8个字符一组，方便手动输入
  const chunks = code.match(/.{1,8}/g) || [];
  return chunks.join('-');
}

/**
 * 从格式化邀请码还原
 * @param {string} formatted - 格式化的邀请码
 * @returns {string} 原始邀请码
 */
export function unformatInviteCode(formatted) {
  return formatted.replace(/-/g, '');
}

/**
 * 验证邀请码是否有效
 * @param {string} code - 邀请码
 * @returns {boolean} 是否有效
 */
export function validateInviteCode(code) {
  try {
    const invite = parseInviteCode(code);
    return !invite.isExpired;
  } catch (error) {
    return false;
  }
}

/**
 * 生成二维码数据（可选，用于移动端）
 * @param {string} code - 邀请码
 * @returns {string} 二维码 URL
 */
export function generateQRCodeData(code) {
  return `secure-chat://join?invite=${code}`;
}

export default {
  createInviteCode,
  parseInviteCode,
  formatInviteCode,
  unformatInviteCode,
  validateInviteCode,
  generateQRCodeData
};

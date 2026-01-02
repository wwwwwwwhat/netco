import crypto from 'crypto';

// JSON序列化后base64url编码，7天过期
export function createInviteCode(groupId, sharedKey, groupName = '', creatorName = '') {
  const invite = {
    v: 1,
    gid: groupId,
    key: sharedKey.toString('base64'),
    name: groupName,
    creator: creatorName,
    ts: Date.now()
  };

  const json = JSON.stringify(invite);
  const code = Buffer.from(json).toString('base64url');

  return code;
}

export function parseInviteCode(code) {
  try {
    const json = Buffer.from(code, 'base64url').toString('utf8');
    const invite = JSON.parse(json);

    if (!invite.gid || !invite.key) {
      throw new Error('邀请码格式错误：缺少必需字段');
    }

    if (invite.v !== 1) {
      throw new Error(`不支持的邀请码版本: ${invite.v}`);
    }

    return {
      groupId: invite.gid,
      sharedKey: Buffer.from(invite.key, 'base64'),
      groupName: invite.name || '未命名群组',
      creator: invite.creator || '匿名',
      createdAt: invite.ts,
      isExpired: Date.now() - invite.ts > 7 * 24 * 60 * 60 * 1000
    };
  } catch (error) {
    throw new Error(`无法解析邀请码: ${error.message}`);
  }
}

// 每8字符分段，方便手动输入
export function formatInviteCode(code) {
  const chunks = code.match(/.{1,8}/g) || [];
  return chunks.join('-');
}

export function unformatInviteCode(formatted) {
  return formatted.replace(/-/g, '');
}

export function validateInviteCode(code) {
  try {
    const invite = parseInviteCode(code);
    return !invite.isExpired;
  } catch (error) {
    return false;
  }
}

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

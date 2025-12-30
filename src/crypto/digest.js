/**
 * digest.js
 * 安全层：得到数据摘要
 */

import crypto from 'crypto';

/**
 * 使用 sha256 算法计算 data 的哈希值
 * @param {string} data - 需要得到哈希值的数据
 * @returns {string} 返回 data 摘要
 */
export function hashData(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

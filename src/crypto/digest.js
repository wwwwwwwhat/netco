import crypto from 'crypto';

// sha256 哈希
export function hashData(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

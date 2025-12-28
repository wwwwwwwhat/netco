import crypto from 'crypto';

/**
 * Calculate the SHA-256 hash of a string
 * @param {string} data - The data to hash
 * @returns {string} The hexadecimal representation of the hash
 */
export function hashData(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

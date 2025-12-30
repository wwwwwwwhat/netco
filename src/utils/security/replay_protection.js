/**
 * 防重放攻击保护
 * 机制：
 * 1. 时间窗口检查：拒绝过旧或未来的消息
 * 2. 消息去重：缓存窗口期内的消息指纹
 */
export class ReplayProtection {
  /**
   * @param {number} windowSizeMs - 有效时间窗口 (默认 5 分钟)
   */
  constructor(windowSizeMs = 5 * 60 * 1000) {
    this.windowSizeMs = windowSizeMs;
    // Map<messageId, expireTime>
    this.seenMessages = new Map();
    this.lastCleanup = Date.now();
  }

  /**
   * 检查消息是否为重放
   * @param {string} sender - 发送者
   * @param {string} content - 加密内容
   * @param {number} timestamp - 消息时间戳
   * @returns {boolean} true 表示是重放攻击（应丢弃），false 表示是新消息
   */
  isReplay(sender, content, timestamp) {
    const now = Date.now();

    // 1. 时间窗口检查
    // 消息太旧 (> 窗口) 或 消息太超前 (> 窗口，防止时钟不同步导致的未来消息)
    if (now - timestamp > this.windowSizeMs || timestamp - now > this.windowSizeMs) {
      // console.log(`[ReplayProtection] 丢弃过期消息: ${timestamp} (当前: ${now})`);
      return true;
    }

    // 2. 生成唯一消息ID (指纹)
    // 简单的字符串拼接在大多数情况下足够，因为 content 是加密的高熵字符串
    const messageId = `${sender}:${content}:${timestamp}`;

    // 3. 检查是否已存在
    if (this.seenMessages.has(messageId)) {
      // console.log(`[ReplayProtection] 丢弃重复消息: ${messageId}`);
      return true;
    }

    // 4. 记录新消息
    this.seenMessages.set(messageId, now + this.windowSizeMs);

    // 5. 定期清理 (每1分钟或积累过多时)
    if (now - this.lastCleanup > 60000 || this.seenMessages.size > 5000) {
      this.cleanup(now);
    }

    return false;
  }

  /**
   * 清理过期记录
   */
  cleanup(now) {
    for (const [id, expireTime] of this.seenMessages) {
      if (expireTime < now) {
        this.seenMessages.delete(id);
      }
    }
    this.lastCleanup = now;
  }
}

// 时间窗口+消息指纹去重 5分钟窗口
export class ReplayProtection {
  constructor(windowSizeMs = 5 * 60 * 1000) {
    this.windowSizeMs = windowSizeMs;
    this.seenMessages = new Map();
    this.lastCleanup = Date.now();
  }

  // 检查窗口和指纹 true表示重放
  isReplay(sender, content, timestamp) {
    const now = Date.now();

    // 拒绝过期或未来消息 防时钟不同步
    if (now - timestamp > this.windowSizeMs || timestamp - now > this.windowSizeMs) {
      return true;
    }

    // sender+content+timestamp做指纹
    const messageId = `${sender}:${content}:${timestamp}`;

    if (this.seenMessages.has(messageId)) {
      return true;
    }

    this.seenMessages.set(messageId, now + this.windowSizeMs);

    // 每1分钟或超5000条清理
    if (now - this.lastCleanup > 60000 || this.seenMessages.size > 5000) {
      this.cleanup(now);
    }

    return false;
  }

  cleanup(now) {
    for (const [id, expireTime] of this.seenMessages) {
      if (expireTime < now) {
        this.seenMessages.delete(id);
      }
    }
    this.lastCleanup = now;
  }
}

import crypto from 'crypto';

/**
 * 执行工作量证明，防止垃圾注册
 * @param {number} difficulty - 前导零的个数 (默认4，大约需要几秒钟)
 */
export async function performPoW(difficulty = 4) {
  const prefix = '0'.repeat(difficulty);
  const timestamp = Date.now().toString();
  let nonce = 0;
  
  return new Promise((resolve) => {
    const start = Date.now();
    const BATCH_SIZE = 5000; 
    const loop = () => {
      for (let i = 0; i < BATCH_SIZE; i++) {
        // 简单的 PoW: SHA256(timestamp + nonce)
        const hash = crypto.createHash('sha256')
          .update(timestamp + nonce.toString())
          .digest('hex');
          
        if (hash.startsWith(prefix)) {
          const duration = (Date.now() - start) / 1000;
          resolve(nonce);
          return; // 结束循环
        }
        nonce++;
      }
      
      // 继续下一批
      setImmediate(loop);
    };
    
    loop();
  });
}

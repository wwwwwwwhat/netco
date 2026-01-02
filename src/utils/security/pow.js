import crypto from 'crypto';

// 简单PoW，防止垃圾注册，默认4个前导零
export async function performPoW(difficulty = 4) {
  const prefix = '0'.repeat(difficulty);
  const timestamp = Date.now().toString();
  let nonce = 0;
  
  return new Promise((resolve) => {
    const start = Date.now();
    const BATCH_SIZE = 5000; 
    const loop = () => {
      for (let i = 0; i < BATCH_SIZE; i++) {
        const hash = crypto.createHash('sha256')
          .update(timestamp + nonce.toString())
          .digest('hex');
          
        if (hash.startsWith(prefix)) {
          const duration = (Date.now() - start) / 1000;
          resolve(nonce);
          return;
        }
        nonce++;
      }
      
      setImmediate(loop);
    };
    
    loop();
  });
}

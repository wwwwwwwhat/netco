import { generateKeyPairFromCredentials } from "../crypto/identity.js";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import { performPoW } from "../utils/security/pow.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runTest() {
  // 设置目标用户 (模拟受害者)
  // 假设受害者使用了符合规则的弱密码: "Password" + "1"
  // rule：开头大写字母的单词加上字典序数字，数字大小小于10
  const targetUsername = "test_user";
  const targetPassword = "Password1"; 
  
  console.log(`用户名: ${targetUsername}`);
  console.log(`密码: ${targetPassword} (规则: 首字母大写单词 + 1位数字)`);

  const startGen = Date.now();
  const targetKeyPair = await generateKeyPairFromCredentials(targetUsername, targetPassword);
  const singleGenTime = Date.now() - startGen;
  
  console.log(`目标公钥: ${targetKeyPair.publicKey.substring(0, 20)}...`);
  console.log(`单次密钥生成耗时: ${singleGenTime} ms`);

  // 2. 定义攻击字典 (模拟攻击者掌握的规则)
  // 规则: 开头大写字母的单词 + 数字(0-4)
  const numbers = [0, 1, 2, 3, 4];
  
  // 从 test.txt 读取单词
  const dictionaryPath = path.join(__dirname, 'test.txt');
  
  // 目标设定
  const targetLine = 93268;
  const totalAttemptsNeeded = targetLine * numbers.length;

  console.log(`预计总尝试次数: ${totalAttemptsNeeded}`);

  let attempts = 0;
  const attackStart = Date.now();

  const fileStream = fs.createReadStream(dictionaryPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
      const word = line.trim();
      if (!word) continue;

      // 首字母大写
      const capitalizedWord = word.charAt(0).toUpperCase() + word.slice(1);

      for (const num of numbers) {
        attempts++;
        const guessPassword = `${capitalizedWord}${num}`;
        
        // 模拟攻击者尝试生成密钥
        performPoW(4);
        await generateKeyPairFromCredentials(targetUsername, guessPassword);
        
        if (attempts % 100 === 0) {
            process.stdout.write(`\r已尝试: ${attempts} 次...`);
        }

        if (attempts >= 1500) {
            const timeTaken = Date.now() - attackStart;
            const avgTimePerAttempt = timeTaken / attempts;

            console.log(`\n\n--- 估算结果 ---`);
            console.log(`基准测试耗时: ${timeTaken} ms`);
            console.log(`平均单次耗时: ${avgTimePerAttempt.toFixed(4)} ms`);

            // 1. 无限制
            const estimatedTimeNoLimit = totalAttemptsNeeded * avgTimePerAttempt;
            console.log(`\n1. 无频率限制 (全速运行):`);
            console.log(`   预计耗时: ${formatDuration(estimatedTimeNoLimit)}`);

            // 2. 500ms 限制
            const delay500ms = 500;
            const estimatedTime500ms = totalAttemptsNeeded * (avgTimePerAttempt + delay500ms);
            console.log(`\n2. 限制频率 (每 500ms 一次):`);
            console.log(`   预计耗时: ${formatDuration(estimatedTime500ms)}`);

            // 3. 1h 限制
            const delay1h = 3600 * 1000;
            const estimatedTime1h = totalAttemptsNeeded * (avgTimePerAttempt + delay1h);
            console.log(`\n3. 限制频率 (每 1小时 一次):`);
            console.log(`   预计耗时: ${formatDuration(estimatedTime1h)}`);

            process.exit(0);
        }
      }
  }
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const years = Math.floor(days / 365);

  if (years > 0) return `${years} 年 ${days % 365} 天`;
  if (days > 0) return `${days} 天 ${hours % 24} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes % 60} 分钟`;
  if (minutes > 0) return `${minutes} 分钟 ${seconds % 60} 秒`;
  return `${seconds} 秒`;
}

runTest().catch(console.error);

import * as readline from 'readline';
import { hashData } from '../../crypto/digest.js';

export async function promptLogin(defaultUsername = null) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(`请输入用户名${defaultUsername ? ` [${defaultUsername}]` : ''}: `, (username) => {
      const finalUsername = username.trim() || defaultUsername;

      if (!finalUsername) {
        console.log('❌ 用户名不能为空！');
        rl.close();
        process.exit(1);
      }

      console.log('请输入密码: ');

      rl.question('', (password) => {
        rl.close();

        if (!password) {
          console.log('❌ 密码不能为空！');
          process.exit(1);
        }

        const passwordHash = hashData(password);

        console.log();
        resolve({
          username: finalUsername,
          password: password,
          passwordHash: passwordHash
        });
      });
    });
  });
}

export function showLoginSuccess(username, publicKey) {
  console.log(`✅ 登录成功！`);
  console.log(`   用户名: ${username}`);
  console.log(`   公钥: ${publicKey.substring(0, 32)}...`);
  console.log();
}

/**
 * 登录工具 - 处理用户身份验证
 * 提供交互式登录界面
 */

import * as readline from 'readline';

/**
 * 询问用户选择操作模式
 * @returns {Promise<'login'|'register'>}
 */
export async function promptSelection() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    console.log('请选择操作:');
    console.log('1. 登录 (Login)');
    console.log('2. 注册 (Register)');
    
    rl.question('请输入选项 [1/2]: ', (answer) => {
      rl.close();
      if (answer.trim() === '2') {
        resolve('register');
      } else {
        resolve('login');
      }
    });
  });
}

/**
 * 注册流程
 * @returns {Promise<{username: string, password: string}>}
 */
export async function promptRegister() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(async (resolve) => {
    const ask = (query) => new Promise(r => rl.question(query, r));

    try {
      // 1. 输入用户名
      let username = '';
      while (!username) {
        username = (await ask('请输入用户名: ')).trim();
        if (!username) console.log('❌ 用户名不能为空');
      }

      // 2. 输入密码
      console.log('请输入密码: ');
      const password = await ask('');
      if (!password) {
        console.log('❌ 密码不能为空');
        rl.close();
        process.exit(1);
      }

      rl.close();
      console.log();
      resolve({ username, password });

    } catch (error) {
      rl.close();
      console.error(error);
      process.exit(1);
    }
  });
}

/**
 * 从标准输入读取用户名和密码
 * @param {string} defaultUsername - 默认用户名（可选）
 * @returns {Promise<{username: string, password: string}>}
 */
export async function promptLogin(defaultUsername = null) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    // 询问用户名
    rl.question(`请输入用户名${defaultUsername ? ` [${defaultUsername}]` : ''}: `, (username) => {
      const finalUsername = username.trim() || defaultUsername;

      if (!finalUsername) {
        console.log('❌ 用户名不能为空！');
        rl.close();
        process.exit(1);
      }

      // 询问密码（不显示输入内容）
      console.log('请输入密码: ');

      // 简单的密码输入（注意：在终端中密码会显示，生产环境需要使用专门的库）
      rl.question('', (password) => {
        rl.close();

        if (!password) {
          console.log('❌ 密码不能为空！');
          process.exit(1);
        }

        console.log(); // 换行
        resolve({
          username: finalUsername,
          password: password
        });
      });
    });
  });
}

/**
 * 显示登录成功信息
 * @param {string} username - 用户名
 * @param {string} publicKey - 公钥（前缀）
 */
export function showLoginSuccess(username, publicKey) {
  console.log(`✅ 登录成功！`);
  console.log(`   用户名: ${username}`);
  console.log(`   公钥: ${publicKey.substring(0, 32)}...`);
  console.log();
}

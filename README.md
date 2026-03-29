# P2P加密聊天系统

基于Hyperswarm的去中心化端到端加密即时通讯

## 功能

- 完全去中心化 P2P通信
- DHT自动节点发现
- NaCl端到端加密
- 多设备登录检测
- 邀请码群组系统

## 快速开始

### 安装依赖

```bash
npm install
```

### 启动客户端

```bash
npm start
```

或者

```bash
npm run net-co
```

### 启动Eve窃听演示

```bash
npm run eve
```

## 使用流程

1. 打开两个终端窗口
2. 分别运行`npm start`
3. 输入用户名和密码注册/登录
4. 终端1执行`/create 群名`创建群组
5. 复制显示的邀请码
6. 终端2执行`/join 邀请码`加入群组
7. 等待10秒连接建立
8. 开始发送消息

## 命令列表

- `/create <群名>` - 创建群组并生成邀请码
- `/join <邀请码>` - 加入群组
- `/dm <用户名>` - 发起私聊
- `/invite` - 显示当前群邀请码
- `/users` - 查看在线用户
- `/stats` - 查看连接统计
- `/rotate` - 手动轮换群密钥
- `/help` - 显示帮助
- `/exit` - 退出程序

## 项目结构

```
src/
├── clients/         客户端
│   ├── main-client.js      主客户端
│   └── eve-listener.js     窃听演示
├── crypto/          加密模块
│   ├── identity.js         密钥派生
│   ├── encryption.js       加密解密
│   └── digest.js           哈希函数
├── network/         网络层
│   └── hyperswarmNode.js   P2P节点
├── utils/           工具
│   ├── communication/      通信工具
│   └── security/           安全工具
└── data/            数据存储
    ├── host_registry.js    注册管理
    ├── msg_storage.js      消息缓存
    └── user_storage.js     用户数据
```

## 技术栈

- Hyperswarm - P2P网络框架
- Scrypt - 密钥派生
- Ed25519 - 签名算法
- Curve25519 - 密钥交换
- XSalsa20-Poly1305 - 对称加密
- TweetNaCl - 加密库

## 密码要求

至少8位，包含大小写字母+数字+下划线

示例: `MyPass_123`

## 安全特性

- 端到端加密 只有参与者能解密
- 多设备检测 防止账号盗用
- 密钥轮换 支持前向安全
- 重放保护 防止消息重放攻击
- PoW注册 防止垃圾注册

## 运行环境

Node.js 18+

## License

MIT

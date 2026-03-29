// 测试添加 floodsub
import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { noise } from '@chainsafe/libp2p-noise';
import { mplex } from '@libp2p/mplex';
import { identify } from '@libp2p/identify';
import { floodsub } from '@libp2p/floodsub';

async function test() {
  try {
    console.log('正在创建节点...');
    const node = await createLibp2p({
      addresses: {
        listen: ['/ip4/0.0.0.0/tcp/0']
      },
      transports: [tcp()],
      streamMuxers: [mplex()],
      connectionEncryption: [noise()],
      services: {
        identify: identify(),
        pubsub: floodsub()
      }
    });

    await node.start();
    console.log('✅ 带pubsub的节点启动成功!');
    console.log('PeerID:', node.peerId.toString());
    console.log('是否有pubsub:', !!node.services.pubsub);

    await node.stop();
  } catch (error) {
    console.error('❌ 错误:', error.message);
    console.error(error.stack);
  }
}

test();

// 简单测试 libp2p 配置
import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { noise } from '@chainsafe/libp2p-noise';
import { mplex } from '@libp2p/mplex';
import { floodsub } from '@libp2p/floodsub';
import { identifyService } from 'libp2p/identify';

async function test() {
  try {
    const node = await createLibp2p({
      addresses: {
        listen: ['/ip4/0.0.0.0/tcp/0']
      },
      transports: [tcp()],
      streamMuxers: [mplex()],
      connectionEncryption: [noise()],
      services: {
        identify: identifyService(),
        pubsub: floodsub(),
      },
    });

    await node.start();
    console.log('✅ 节点启动成功!');
    console.log('PeerID:', node.peerId.toString());

    await node.stop();
    console.log('✅ 测试完成');
  } catch (error) {
    console.error('❌ 错误:', error.message);
  }
}

test();

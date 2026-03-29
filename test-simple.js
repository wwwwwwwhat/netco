// 最小测试
import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { noise } from '@chainsafe/libp2p-noise';
import { mplex } from '@libp2p/mplex';

async function test() {
  try {
    const node = await createLibp2p({
      addresses: {
        listen: ['/ip4/0.0.0.0/tcp/0']
      },
      transports: [tcp()],
      streamMuxers: [mplex()],
      connectionEncryption: [noise()],
    });

    await node.start();
    console.log('✅ 最基本节点启动成功!');
    console.log('PeerID:', node.peerId.toString());
    console.log('Addresses:', node.getMultiaddrs().map(a => a.toString()));

    await node.stop();
  } catch (error) {
    console.error('❌ 错误:', error.message);
    console.error(error.stack);
  }
}

test();

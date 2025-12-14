import net from 'net';

/**
 * 获取一个可用端口（异步）
 * 返回 Promise<number>
 */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', (err) => {
      try { srv.close(); } catch (e) {}
      reject(err);
    });
    srv.listen(0, () => {
      const addr = srv.address();
      const port = addr && addr.port;
      srv.close(() => resolve(port));
    });
  });
}

export {
  getFreePort
}

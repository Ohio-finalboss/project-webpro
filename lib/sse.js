function createSseHub() {
  const clients = new Set();

  function publishUpdate() {
    const message = 'event: shop-update\ndata: {}\n\n';

    for (const response of clients) {
      try {
        response.write(message);
      } catch {
        clients.delete(response);
      }
    }
  }

  function subscribe(req, res) {
    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write('retry: 5000\n\n');

    clients.add(res);
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': keep-alive\n\n');
    }, 25000);

    res.on('close', () => {
      clearInterval(heartbeat);
      clients.delete(res);
    });
  }

  return { publishUpdate, subscribe };
}

module.exports = createSseHub;

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

export function testManualReporter(createReporter) {
  class Transport {
    static OPEN = 1;
    static instances = [];
    readyState = 0;
    sent = [];
    listeners = new Map();
    constructor() { Transport.instances.push(this); }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    emit(type) { this[`on${type}`]?.({}); this.listeners.get(type)?.({}); }
    open() { this.readyState = 1; this.emit('open'); }
    send(value) { this.sent.push(JSON.parse(value)); }
    close() { this.readyState = 3; this.emit('close'); }
  }

  test('manual reporting works without global instrumentation and respects lifecycle', () => {
    const originalSocket = globalThis.WebSocket;
    globalThis.WebSocket = Transport;
    Transport.instances = [];
    const originals = [console.log, globalThis.fetch, globalThis.XMLHttpRequest?.prototype.send, http.request];
    const reporter = createReporter({
      endpoint: 'ws://desktop/reporter', app: {appId: 'manual', appName: 'Manual'},
      capture: false, maxBodyBytes: 5,
    });
    try {
      const {reportConsole, report} = reporter;
      reportConsole({level: 'log', arguments: ['before start']});
      reporter.start();
      reporter.start();
      assert.equal(Transport.instances.length, 1);
      assert.equal(globalThis.WebSocket, Transport);
      assert.deepEqual([console.log, globalThis.fetch, globalThis.XMLHttpRequest?.prototype.send, http.request], originals);
      const transport = Transport.instances[0];
      const circular = {value: 1n};
      circular.self = circular;
      reportConsole({level: 'error', arguments: [new Error('log failure'), circular], stack: 'custom stack'});
      reporter.reportHttpRequestStarted({requestId: 'r1', method: 'POST', url: 'https://api.test', body: '1234567'});
      transport.open();
      reporter.reportHttpResponseReceived({requestId: 'r1', url: 'https://api.test', status: 200});
      reporter.reportHttpResponseBody({requestId: 'r1', body: 'abcdef'});
      reporter.reportHttpRequestCompleted({requestId: 'r1', duration: 42, size: 6});
      reporter.reportHttpRequestFailed({requestId: 'r2', error: new Error('network failure'), canceled: true});
      reporter.reportWebSocketCreated({socketId: 's1', url: 'wss://api.test'});
      reporter.reportWebSocketOpened({socketId: 's1', url: 'wss://api.test', responseHeaders: {Upgrade: 'websocket'}});
      reporter.reportWebSocketFrameSent({socketId: 's1', data: circular});
      reporter.reportWebSocketFrameReceived({socketId: 's1', data: 'incoming'});
      reporter.reportWebSocketError({socketId: 's1', error: new Error('socket failure')});
      reporter.reportWebSocketClosed({socketId: 's1', code: 1000, reason: 'done'});
      report('console.entry', {level: 'info', arguments: ['raw']});
      assert.deepEqual(transport.sent.map(event => event.type), [
        'runtime.hello', 'console.entry', 'http.request.started', 'http.response.received',
        'http.response.body', 'http.request.completed', 'http.request.failed',
        'websocket.created', 'websocket.opened', 'websocket.frameSent',
        'websocket.frameReceived', 'websocket.error', 'websocket.closed', 'console.entry',
      ]);
      const [hello, log, request, , body, , failed] = transport.sent;
      assert.deepEqual(hello.payload.capabilities, ['console', 'http', 'websocket']);
      assert.equal(log.payload.arguments[0].message, 'log failure');
      assert.equal(log.payload.arguments[1].value, '1n');
      assert.equal(log.payload.stack, 'custom stack');
      assert.equal(request.payload.body, '12345');
      assert.equal(request.payload.bodyTruncated, true);
      assert.equal(body.payload.body, 'abcde');
      assert.equal(body.payload.truncated, true);
      assert.equal(failed.payload.error.message, 'network failure');
      assert.equal(transport.sent[11].payload.error.message, 'socket failure');
      assert.equal(new Set(transport.sent.map(event => event.id)).size, transport.sent.length);
      for (const event of transport.sent) {
        assert.equal(event.runtimeId, hello.runtimeId);
        assert.equal(event.protocolVersion, 1);
        assert.equal(typeof event.timestamp, 'number');
      }
      const business = transport.sent.filter(event => event.type !== 'runtime.hello');
      assert.deepEqual(business.map(event => event.sequence), [...business.map(event => event.sequence)].sort((a, b) => a - b));

      // Invalid serialization and failed transport must not escape into a custom collector.
      const hostile = new Proxy({}, {ownKeys() { throw new Error('hostile'); }});
      assert.doesNotThrow(() => report('console.entry', hostile));
      transport.send = () => { throw new Error('offline'); };
      assert.doesNotThrow(() => reportConsole({level: 'log', arguments: ['transport failure']}));
      reporter.stop();
      reportConsole({level: 'log', arguments: ['after stop']});
      reporter.start();
      const restarted = Transport.instances[1];
      restarted.open();
      assert.deepEqual(restarted.sent.map(event => event.type), ['runtime.hello']);
    } finally {
      reporter.stop();
      globalThis.WebSocket = originalSocket;
    }
  });

  test('manual reporting retains only the latest 2000 disconnected events', () => {
    const originalSocket = globalThis.WebSocket;
    globalThis.WebSocket = Transport;
    Transport.instances = [];
    const reporter = createReporter({endpoint: 'ws://desktop/reporter', app: {appId: 'manual', appName: 'Manual'}, capture: false});
    try {
      reporter.start();
      for (let i = 0; i < 2005; i++) reporter.reportConsole({level: 'log', arguments: [i]});
      const transport = Transport.instances[0];
      transport.open();
      assert.equal(transport.sent.length, 2001);
      assert.equal(transport.sent[0].type, 'runtime.hello');
      assert.deepEqual(transport.sent[1].payload.arguments, [5]);
      assert.deepEqual(transport.sent.at(-1).payload.arguments, [2004]);
    } finally {
      reporter.stop();
      globalThis.WebSocket = originalSocket;
    }
  });
}

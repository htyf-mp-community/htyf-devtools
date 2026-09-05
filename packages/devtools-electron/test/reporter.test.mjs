import assert from 'node:assert/strict';
import test from 'node:test';
import {EventEmitter} from 'node:events';
import http from 'node:http';
import {createElectronDevTools} from '../src/index.ts';

class FakeWebSocket extends EventTarget {
  static OPEN = 1;
  static instances = [];
  readyState = 0;
  sent = [];
  constructor(url) { super(); this.url = String(url); FakeWebSocket.instances.push(this); }
  open() { this.readyState = 1; this.dispatchEvent(new Event('open')); }
  send(data) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
  receive(message) { this.dispatchEvent(new MessageEvent('message', {data: JSON.stringify(message)})); }
}

test('captures Node HTTP used by Axios-style adapters and restores the module', async () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalRequest = http.request;
  const originalGet = http.get;
  globalThis.WebSocket = FakeWebSocket;
  FakeWebSocket.instances = [];
  http.request = (...args) => {
    const request = new EventEmitter();
    request.method = 'GET';
    request.getHeaders = () => ({});
    request.write = () => true;
    request.end = () => queueMicrotask(() => {
      const response = new EventEmitter();
      response.statusCode = 202;
      response.statusMessage = 'Accepted';
      response.headers = {'content-type': 'application/json'};
      const callback = args.findLast(value => typeof value === 'function');
      callback?.(response);
      request.emit('response', response);
      queueMicrotask(() => {
        response.emit('data', Buffer.from('{"ok":true}'));
        response.emit('end');
      });
    });
    return request;
  };
  http.get = (...args) => {
    const request = http.request(...args);
    request.end();
    return request;
  };
  const mockedRequest = http.request;
  const reporter = createElectronDevTools({
    endpoint: 'ws://desktop/reporter',
    app: {appId: 'desktop.app', appName: 'Desktop'},
    capture: {console: false, fetch: false, nodeHttp: true, websocket: false},
  });
  reporter.start();
  const transport = FakeWebSocket.instances[0];
  transport.open();
  await new Promise(resolve => {
    const request = http.request('http://api.example/axios-style', {method: 'POST'}, response => response.once('end', resolve));
    request.write('{"name":');
    request.end('"demo"}');
  });
  assert.ok(transport.sent.some(event => event.type === 'http.request.started'
    && event.payload.url.endsWith('/axios-style')
    && event.payload.method === 'POST'
    && event.payload.body === '{"name":"demo"}'));
  assert.ok(transport.sent.some(event => event.type === 'http.response.received' && event.payload.status === 202));
  assert.ok(transport.sent.some(event => event.type === 'http.response.body' && event.payload.body === '{"ok":true}'));
  assert.ok(transport.sent.some(event => event.type === 'http.request.completed'));
  reporter.stop();
  assert.equal(http.request, mockedRequest);
  http.request = originalRequest;
  http.get = originalGet;
  globalThis.WebSocket = originalWebSocket;
});

test('identifies an Electron main-process runtime and restores globals', async () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalFetch = globalThis.fetch;
  const fakeFetch = async () => new Response('hello', {status: 200, headers: {'content-type': 'text/plain'}});
  globalThis.WebSocket = FakeWebSocket;
  FakeWebSocket.instances = [];
  globalThis.fetch = fakeFetch;

  const reporter = createElectronDevTools({
    endpoint: 'ws://desktop/reporter',
    app: {appId: 'desktop.app', appName: 'Desktop'},
  });
  reporter.start();
  const transport = FakeWebSocket.instances[0];
  transport.open();
  await globalThis.fetch('https://example.test/data');
  await new Promise(resolve => setTimeout(resolve, 0));

  const hello = transport.sent.find(message => message.type === 'runtime.hello');
  assert.equal(hello.payload.platform, 'electron-main');
  assert.equal(hello.payload.reporter.packageName, '@htyf-mp/devtools-electron');
  assert.equal(hello.payload.reporter.version, '0.1.1');
  assert.ok(hello.payload.capabilities.includes('http'));
  assert.ok(transport.sent.some(message => message.type === 'http.response.body' && message.payload.body === 'hello'));

  reporter.stop();
  assert.equal(globalThis.WebSocket, FakeWebSocket);
  assert.equal(globalThis.fetch, fakeFetch);
  globalThis.WebSocket = originalWebSocket;
  globalThis.fetch = originalFetch;
});

test('honors the desktop heartbeat interval', async () => {
  const originalWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = FakeWebSocket;
  FakeWebSocket.instances = [];
  const reporter = createElectronDevTools({endpoint: 'ws://desktop/reporter', app: {appId: 'desktop.app', appName: 'Desktop'}, capture: {console: false, fetch: false, nodeHttp: false, websocket: false}});
  reporter.start();
  const transport = FakeWebSocket.instances[0];
  transport.open();
  transport.receive({type: 'runtime.welcome', payload: {heartbeatInterval: 1}});
  await new Promise(resolve => setTimeout(resolve, 1050));
  assert.ok(transport.sent.some(message => message.type === 'runtime.heartbeat'));
  reporter.stop();
  globalThis.WebSocket = originalWebSocket;
});

class ThirdPartyWebSocket extends EventEmitter {
  constructor(url) { super(); this.url = url; this.sent = []; }
  send(data) { this.sent.push(data); }
}

test('captures an explicitly registered ws-style constructor and restores it', () => {
  const originalWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = FakeWebSocket;
  FakeWebSocket.instances = [];
  const originalSend = ThirdPartyWebSocket.prototype.send;
  const reporter = createElectronDevTools({
    endpoint: 'ws://desktop/reporter',
    app: {appId: 'desktop.app', appName: 'Desktop'},
    capture: {console: false, fetch: false, nodeHttp: false, websocket: true},
    webSocketConstructors: [ThirdPartyWebSocket],
  });
  reporter.start();
  const transport = FakeWebSocket.instances[0];
  transport.open();
  const socket = new ThirdPartyWebSocket('ws://business/socket');
  socket.emit('open');
  socket.send('{"action":"ping"}');
  socket.emit('message', Buffer.from('{"ok":true}'));
  socket.emit('close', 1000, Buffer.from('done'));

  assert.ok(transport.sent.some(message => message.type === 'websocket.created' && message.payload.url === 'ws://business/socket'));
  assert.ok(transport.sent.some(message => message.type === 'websocket.frameSent'));
  assert.ok(transport.sent.some(message => message.type === 'websocket.frameReceived' && message.payload.data === '{"ok":true}'));
  assert.ok(transport.sent.some(message => message.type === 'websocket.closed' && message.payload.code === 1000));
  reporter.stop();
  assert.equal(ThirdPartyWebSocket.prototype.send, originalSend);
  globalThis.WebSocket = originalWebSocket;
});

test('observes a WebSocketServer connection and restores its send method', () => {
  const originalWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = FakeWebSocket;
  FakeWebSocket.instances = [];
  const reporter = createElectronDevTools({
    endpoint: 'ws://desktop/reporter',
    app: {appId: 'desktop.app', appName: 'Desktop'},
    capture: {console: false, fetch: false, nodeHttp: false, websocket: true},
  });
  reporter.start();
  const transport = FakeWebSocket.instances[0];
  transport.open();
  const socket = new ThirdPartyWebSocket(undefined);
  const originalSend = socket.send;
  const unobserve = reporter.observeWebSocket(socket, {url: 'ws://server/incoming', direction: 'server'});
  socket.emit('message', 'hello');
  socket.send('world');

  assert.ok(transport.sent.some(message => message.type === 'websocket.opened' && message.payload.direction === 'server'));
  assert.ok(transport.sent.some(message => message.type === 'websocket.frameReceived' && message.payload.data === 'hello'));
  unobserve();
  assert.equal(socket.send, originalSend);
  reporter.stop();
  globalThis.WebSocket = originalWebSocket;
});

test('reporter failures never escape into Electron business calls', async () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalFetch = globalThis.fetch;
  class FailingTransportWebSocket extends FakeWebSocket {
    send(data) {
      if (this.url === 'ws://desktop/reporter') throw new Error('transport unavailable');
      this.sent.push(data);
    }
  }
  globalThis.WebSocket = FailingTransportWebSocket;
  FakeWebSocket.instances = [];
  const response = {status: 200, statusText: 'OK', headers: {forEach() { throw new Error('broken inspector'); }}};
  globalThis.fetch = async () => response;
  const reporter = createElectronDevTools({endpoint: 'ws://desktop/reporter', app: {appId: 'desktop.app', appName: 'Desktop'}, capture: {console: false, fetch: true, nodeHttp: false, websocket: true}});
  assert.doesNotThrow(() => reporter.start());
  assert.doesNotThrow(() => FakeWebSocket.instances[0].open());
  const businessSocket = new globalThis.WebSocket('ws://business/socket');
  assert.doesNotThrow(() => businessSocket.send('business payload'));
  assert.deepEqual(businessSocket.sent, ['business payload']);
  assert.equal(await globalThis.fetch('https://business.example'), response);
  assert.doesNotThrow(() => reporter.stop());
  globalThis.WebSocket = originalWebSocket;
  globalThis.fetch = originalFetch;
});

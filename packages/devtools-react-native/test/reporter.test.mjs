import test from 'node:test';
import assert from 'node:assert/strict';
import {createDevTools} from '../src/index.ts';

class MockWebSocket {
  static OPEN = 1;
  static instances = [];
  readyState = 0;
  sent = [];
  listeners = new Map();

  constructor(url) {
    this.url = String(url);
    MockWebSocket.instances.push(this);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type, event = {}) {
    if (type === 'open') this.readyState = MockWebSocket.OPEN;
    this[`on${type}`]?.(event);
    for (const listener of this.listeners.get(type) || []) listener(event);
  }

  send(data) { this.sent.push(data); }
  close() { this.readyState = 3; this.emit('close', {code: 1000, reason: ''}); }
}

class MockXMLHttpRequest {
  listeners = new Map();
  status = 0;
  statusText = '';
  responseText = '';
  responseHeaders = '';
  open(method, url) { this.method = method; this.url = String(url); }
  setRequestHeader(name, value) { (this.headers ||= {})[name] = value; }
  send(body) { this.body = body; }
  addEventListener(type, listener) { const list = this.listeners.get(type) || []; list.push(listener); this.listeners.set(type, list); }
  getAllResponseHeaders() { return this.responseHeaders; }
  getResponseHeader(name) { return name.toLowerCase() === 'content-type' ? 'application/json' : null; }
  respond() { for (const listener of this.listeners.get('load') || []) listener({}); }
}

function messages(socket) {
  return socket.sent.map(message => JSON.parse(message));
}

test('captures application WebSocket traffic and restores the global constructor', () => {
  const original = globalThis.WebSocket;
  globalThis.WebSocket = MockWebSocket;
  MockWebSocket.instances = [];
  const reporter = createDevTools({
    endpoint: 'ws://desktop/reporter',
    app: {appId: 'example', appName: 'Example'},
    capture: {console: false, fetch: false, xhr: false, websocket: true},
    // 即使普通 JavaScript 调用方额外传入同名字段，公开 API 也不能覆盖插件身份。
    runtimePlatform: 'web',
    reporterInfo: {packageName: '@htyf-mp/devtools-web', version: '999.0.0'},
  });
  reporter.start();
  const transport = MockWebSocket.instances[0];
  transport.emit('open');
  const applicationSocket = new globalThis.WebSocket('ws://api.example/socket');
  applicationSocket.emit('open');
  applicationSocket.send('outgoing');
  applicationSocket.emit('message', {data: 'incoming'});
  applicationSocket.emit('close', {code: 1000, reason: 'done'});

  assert.deepEqual(messages(transport).map(message => message.type), [
    'runtime.hello', 'websocket.created', 'websocket.opened',
    'websocket.frameSent', 'websocket.frameReceived', 'websocket.closed',
  ]);
  const hello = messages(transport)[0];
  assert.equal(hello.payload.reporter.packageName, '@htyf-mp/devtools-react-native');
  assert.equal(hello.payload.reporter.version, '0.1.0');
  assert.deepEqual(hello.payload.reporter, {packageName: '@htyf-mp/devtools-react-native', version: '0.1.0'});
  assert.equal(hello.payload.platform, 'react-native');
  assert.deepEqual(applicationSocket.sent, ['outgoing']);
  reporter.stop();
  assert.equal(globalThis.WebSocket, MockWebSocket);
  globalThis.WebSocket = original;
});

test('captures fetch metadata and a truncated response body', async () => {
  const originalSocket = globalThis.WebSocket;
  const originalFetch = globalThis.fetch;
  globalThis.WebSocket = MockWebSocket;
  MockWebSocket.instances = [];
  globalThis.fetch = async () => new Response('123456789', {status: 201, headers: {'content-type': 'text/plain'}});
  const reporter = createDevTools({
    endpoint: 'ws://desktop/reporter',
    app: {appId: 'example', appName: 'Example'},
    capture: {console: false, fetch: true, xhr: false, websocket: false},
    maxBodyBytes: 5,
  });
  reporter.start();
  const transport = MockWebSocket.instances[0];
  transport.emit('open');
  const response = await globalThis.fetch('https://api.example/items', {method: 'POST', body: 'request'});
  assert.equal(response.status, 201);
  await new Promise(resolve => setImmediate(resolve));
  const events = messages(transport);
  assert.ok(events.some(event => event.type === 'http.request.started' && event.payload.method === 'POST'));
  assert.ok(events.some(event => event.type === 'http.response.received' && event.payload.status === 201));
  assert.ok(events.some(event => event.type === 'http.response.body' && event.payload.body === '12345' && event.payload.truncated));
  reporter.stop();
  globalThis.WebSocket = originalSocket;
  globalThis.fetch = originalFetch;
});

test('captures an XMLHttpRequest lifecycle and restores its prototype', () => {
  const originalSocket = globalThis.WebSocket;
  const originalXhr = globalThis.XMLHttpRequest;
  globalThis.WebSocket = MockWebSocket;
  globalThis.XMLHttpRequest = MockXMLHttpRequest;
  MockWebSocket.instances = [];
  const originalOpen = MockXMLHttpRequest.prototype.open;
  const reporter = createDevTools({
    endpoint: 'ws://desktop/reporter',
    app: {appId: 'example', appName: 'Example'},
    capture: {console: false, fetch: false, xhr: true, websocket: false},
  });
  reporter.start();
  const transport = MockWebSocket.instances[0];
  transport.emit('open');
  const xhr = new globalThis.XMLHttpRequest();
  xhr.open('PUT', 'https://api.example/items/1');
  xhr.setRequestHeader('X-Test', 'yes');
  xhr.send('{"name":"updated"}');
  xhr.status = 204;
  xhr.statusText = 'No Content';
  xhr.responseHeaders = 'content-type: application/json\r\nx-request-id: abc';
  xhr.responseText = '{}';
  xhr.respond();

  const events = messages(transport);
  assert.ok(events.some(event => event.type === 'http.request.started' && event.payload.method === 'PUT'));
  assert.ok(events.some(event => event.type === 'http.response.received' && event.payload.status === 204));
  assert.ok(events.some(event => event.type === 'http.response.body' && event.payload.body === '{}'));
  assert.ok(events.some(event => event.type === 'http.request.completed'));
  reporter.stop();
  assert.equal(MockXMLHttpRequest.prototype.open, originalOpen);
  globalThis.WebSocket = originalSocket;
  globalThis.XMLHttpRequest = originalXhr;
});

test('capture can enable the Axios XHR path without wrapping fetch', () => {
  const originalSocket = globalThis.WebSocket;
  const originalFetch = globalThis.fetch;
  const originalXhr = globalThis.XMLHttpRequest;
  globalThis.WebSocket = MockWebSocket;
  globalThis.XMLHttpRequest = MockXMLHttpRequest;
  MockWebSocket.instances = [];
  const originalOpen = MockXMLHttpRequest.prototype.open;
  const reporter = createDevTools({
    endpoint: 'ws://desktop/reporter',
    app: {appId: 'example', appName: 'Example'},
    capture: {console: false, fetch: false, xhr: true, websocket: false},
  });
  reporter.start();
  assert.equal(globalThis.fetch, originalFetch);
  assert.notEqual(MockXMLHttpRequest.prototype.open, originalOpen);
  reporter.stop();
  assert.equal(MockXMLHttpRequest.prototype.open, originalOpen);
  globalThis.WebSocket = originalSocket;
  globalThis.XMLHttpRequest = originalXhr;
});

test('sends heartbeats requested by the desktop and stops the timer', async () => {
  const original = globalThis.WebSocket;
  globalThis.WebSocket = MockWebSocket;
  MockWebSocket.instances = [];
  const reporter = createDevTools({endpoint: 'ws://desktop/reporter', app: {appId: 'example', appName: 'Example'}, capture: {console: false, fetch: false, xhr: false, websocket: false}});
  reporter.start();
  const transport = MockWebSocket.instances[0];
  transport.emit('open');
  transport.emit('message', {data: JSON.stringify({type: 'runtime.welcome', payload: {heartbeatInterval: 1}})});
  await new Promise(resolve => setTimeout(resolve, 1050));
  assert.ok(messages(transport).some(message => message.type === 'runtime.heartbeat'));
  reporter.stop();
  globalThis.WebSocket = original;
});

test('reporter transport failures never break application WebSocket traffic', () => {
  const original = globalThis.WebSocket;
  class FailingTransportWebSocket extends MockWebSocket {
    send(data) {
      if (this.url === 'ws://desktop/reporter') throw new Error('transport unavailable');
      super.send(data);
    }
  }
  globalThis.WebSocket = FailingTransportWebSocket;
  MockWebSocket.instances = [];
  const reporter = createDevTools({
    endpoint: 'ws://desktop/reporter',
    app: {appId: 'example', appName: 'Example'},
    capture: {console: false, fetch: false, xhr: false, websocket: true},
  });
  assert.doesNotThrow(() => reporter.start());
  const transport = MockWebSocket.instances[0];
  assert.doesNotThrow(() => transport.emit('open'));
  const applicationSocket = new globalThis.WebSocket('ws://business/socket');
  assert.doesNotThrow(() => applicationSocket.send('business payload'));
  assert.deepEqual(applicationSocket.sent, ['business payload']);
  assert.doesNotThrow(() => reporter.stop());
  globalThis.WebSocket = original;
});

test('reporter response inspection failures do not change a successful fetch result', async () => {
  const originalSocket = globalThis.WebSocket;
  const originalFetch = globalThis.fetch;
  globalThis.WebSocket = MockWebSocket;
  MockWebSocket.instances = [];
  const businessResponse = {
    status: 200,
    statusText: 'OK',
    headers: {forEach() { throw new Error('broken inspector'); }},
  };
  globalThis.fetch = async () => businessResponse;
  const reporter = createDevTools({endpoint: 'ws://desktop/reporter', app: {appId: 'example', appName: 'Example'}, capture: {console: false, fetch: true, xhr: false, websocket: false}});
  reporter.start();
  MockWebSocket.instances[0].emit('open');
  assert.equal(await globalThis.fetch('https://business.example'), businessResponse);
  reporter.stop();
  globalThis.WebSocket = originalSocket;
  globalThis.fetch = originalFetch;
});

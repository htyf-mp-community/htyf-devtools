import test from 'node:test';
import assert from 'node:assert/strict';
import {createWebDevTools} from '../src/index.ts';

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
  status = 200;
  statusText = 'OK';
  responseText = '{"source":"axios"}';
  open(method, url) { this.method = method; this.url = String(url); }
  setRequestHeader() {}
  send() {}
  addEventListener(type, listener) { const list = this.listeners.get(type) || []; list.push(listener); this.listeners.set(type, list); }
  getAllResponseHeaders() { return 'content-type: application/json'; }
  getResponseHeader() { return 'application/json'; }
  respond() { for (const listener of this.listeners.get('load') || []) listener({}); }
}

test('registers a browser runtime and restores the WebSocket constructor', () => {
  const original = globalThis.WebSocket;
  globalThis.WebSocket = MockWebSocket;
  MockWebSocket.instances = [];
  const reporter = createWebDevTools({
    endpoint: 'ws://desktop/reporter',
    token: '123456',
    app: {appId: 'web-demo', appName: 'Web Demo'},
    capture: {console: false, fetch: false, xhr: false, websocket: true},
  });

  reporter.start();
  const transport = MockWebSocket.instances[0];
  transport.emit('open');
  const hello = JSON.parse(transport.sent[0]);
  assert.equal(hello.type, 'runtime.hello');
  assert.equal(hello.payload.platform, 'web');
  assert.equal(hello.payload.reporter.packageName, '@htyf-mp/devtools-web');
  assert.equal(hello.payload.reporter.version, '0.1.2');
  assert.equal(hello.payload.token, '123456');

  const businessSocket = new globalThis.WebSocket('ws://business/socket');
  assert.doesNotThrow(() => businessSocket.send('business'));
  assert.deepEqual(businessSocket.sent, ['business']);
  reporter.stop();
  assert.equal(globalThis.WebSocket, MockWebSocket);
  globalThis.WebSocket = original;
});

test('captures the browser XHR path used by Axios', () => {
  const originalSocket = globalThis.WebSocket;
  const originalXhr = globalThis.XMLHttpRequest;
  globalThis.WebSocket = MockWebSocket;
  globalThis.XMLHttpRequest = MockXMLHttpRequest;
  MockWebSocket.instances = [];
  const reporter = createWebDevTools({
    endpoint: 'ws://desktop/reporter',
    app: {appId: 'web-demo', appName: 'Web Demo'},
    capture: {console: false, fetch: false, xhr: true, websocket: false},
  });
  reporter.start();
  const transport = MockWebSocket.instances[0];
  transport.emit('open');
  const xhr = new globalThis.XMLHttpRequest();
  xhr.open('POST', 'https://api.example/axios');
  xhr.send('{}');
  xhr.respond();
  const events = transport.sent.map(message => JSON.parse(message));
  assert.ok(events.some(event => event.type === 'http.request.started' && event.payload.url.endsWith('/axios')));
  assert.ok(events.some(event => event.type === 'http.response.body' && event.payload.body === '{"source":"axios"}'));
  reporter.stop();
  globalThis.WebSocket = originalSocket;
  globalThis.XMLHttpRequest = originalXhr;
});

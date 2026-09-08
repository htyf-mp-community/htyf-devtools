const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const WebSocket = require('ws');
const {DevToolsServer, selectNetworkAddress, evaluateCompatibility} = require('../src/server.cjs');
const {DemoRuntime} = require('../src/demo-runtime.cjs');
const {once} = require('node:events');

for (const route of ['reporter', 'cdp/large']) {
  test(`${route} accepts messages above the former payload limit`, {timeout: 5000}, async t => {
    const server = new DevToolsServer({port: 0});
    await server.start();
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/${route}`);
    t.after(async () => { socket.terminate(); await server.stop(); });
    await once(socket, 'open');
    // 中文 UTF-8 和 JSON 转义后的消息约 3 MB，超过原来的两种接收上限。
    const largeText = '中"'.repeat(600_000);
    const message = route === 'reporter'
      ? {protocolVersion: 1, type: 'runtime.hello', runtimeId: 'large', payload: {runtimeId: 'large', appName: largeText}}
      : {id: 1, method: 'Runtime.evaluate', params: {expression: largeText}};
    const response = once(socket, 'message');
    const closed = new Promise((_, reject) => socket.once('close', code => reject(new Error(`Unexpected close: ${code}`))));
    socket.send(JSON.stringify(message));
    const [raw] = await Promise.race([response, closed]);
    const result = JSON.parse(raw.toString());
    if (route === 'reporter') {
      assert.equal(result.type, 'runtime.welcome');
      assert.equal(server.runtimes.get('large').appName, largeText);
    } else assert.deepEqual(result, {id: 1, result: {result: {type: 'undefined'}}});
  });

  test(`${route} handles protocol errors without an uncaught exception`, {timeout: 5000}, async t => {
    const server = new DevToolsServer({port: 0});
    await server.start();
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/${route}`);
    t.after(async () => { socket.terminate(); await server.stop(); });
    await once(socket, 'open');
    const closed = once(socket, 'close');
    const cdpSocket = server.cdpClients.get('large')?.values().next().value;
    const serverClosed = cdpSocket && new Promise(resolve => cdpSocket.once('close', resolve));
    // Invalid UTF-8 in a text frame triggers the same Receiver -> socket error path.
    socket.send(Buffer.from([0xff]), {binary: false});
    const [code] = await closed;
    await serverClosed;
    assert.equal(code, 1007);
    assert.equal(server.cdpClients.get('large')?.size ?? 0, 0);
    assert.equal((await get(`http://127.0.0.1:${server.port}/json/list`)).status, 200);
  });
}

function get(url) {
  return new Promise((resolve, reject) => http.get(url, response => {
    let body = '';
    response.on('data', chunk => body += chunk);
    response.on('end', () => resolve({status: response.statusCode, type: response.headers['content-type'], body}));
  }).on('error', reject));
}

function waitForMessage(socket, predicate) {
  return new Promise(resolve => {
    const handler = raw => {
      const message = JSON.parse(raw.toString());
      if (predicate(message)) { socket.off('message', handler); resolve(message); }
    };
    socket.on('message', handler);
  });
}

test('selects the default physical IPv4 address and excludes loopback and virtual adapters', () => {
  assert.equal(selectNetworkAddress([
    {iface: 'lo0', ip4: '127.0.0.1', internal: true, virtual: false, operstate: 'up'},
    {iface: 'utun0', ip4: '10.0.0.2', internal: false, virtual: true, operstate: 'up'},
    {iface: 'en7', ip4: '192.168.1.20', internal: false, virtual: false, operstate: 'up', default: false},
    {iface: 'en0', ip4: '192.168.1.10', internal: false, virtual: false, operstate: 'up', default: true},
  ]), '192.168.1.10');
});

test('uses a non-loopback Windows adapter when systeminformation marks every adapter virtual', () => {
  assert.equal(selectNetworkAddress([
    {iface: 'vEthernet', ip4: '172.20.0.1', internal: false, virtual: true, operstate: 'up', default: false},
    {iface: 'Wi-Fi', ip4: '192.168.31.25', internal: false, virtual: true, operstate: 'up', default: true},
  ]), '192.168.31.25');
});

test('starts in localhost-only mode instead of exiting when no LAN IPv4 is available', async () => {
  const server = new DevToolsServer({host: '0.0.0.0', port: 0, networkInterfacesProvider: async () => []});
  const listening = new Promise(resolve => server.once('listening', resolve));
  await server.start();
  const endpointState = await listening;
  assert.equal(server.advertisedHost, 'localhost');
  assert.equal(server.getState().lanAvailable, false);
  assert.equal(endpointState.url, `http://localhost:${server.port}`);
  await server.stop();
});

test('evaluates reporter and desktop version compatibility without rejecting the runtime', () => {
  const reporter = {packageName: '@htyf-mp/devtools-electron', version: '0.1.5'};
  assert.equal(evaluateCompatibility('0.1.0', reporter).status, 'compatible');
  const incompatible = evaluateCompatibility('0.1.0', {...reporter, version: '0.2.0'});
  assert.equal(incompatible.status, 'incompatible');
  assert.equal(incompatible.supportedReporter, '>=0.1.0 <0.2.0');
  assert.match(incompatible.message, /当前插件为 v0\.2\.0/);
  assert.equal(evaluateCompatibility('0.1.0', undefined).status, 'unknown');
  assert.equal(evaluateCompatibility('0.1.0', {packageName: 'third-party-reporter', version: '0.1.0'}).status, 'unknown');
});

test('advertises the systeminformation address instead of loopback', async () => {
  const server = new DevToolsServer({host: '0.0.0.0', port: 0, networkInterfacesProvider: async () => [{ip4: '192.168.10.8', internal: false, virtual: false, operstate: 'up', default: true}]});
  await server.start();
  assert.equal(server.getState().reporterUrl, `ws://192.168.10.8:${server.port}/reporter`);
  await server.stop();
});

test('publishes a new endpoint when the active LAN address changes', async () => {
  let inspection = 0;
  const networkInterfacesProvider = async () => [{
    ip4: inspection++ === 0 ? '192.168.3.17' : '192.168.3.18',
    internal: false,
    virtual: false,
    operstate: 'up',
    default: true,
  }];
  const server = new DevToolsServer({host: '0.0.0.0', port: 0, networkInterfacesProvider});
  try {
    await server.start();
    assert.equal(server.advertisedHost, '192.168.3.17');
    const endpointChanged = new Promise(resolve => server.once('listening', resolve));
    assert.equal(await server.refreshAdvertisedHost(), true);
    const changed = await endpointChanged;
    assert.equal(changed.url, `http://192.168.3.18:${server.port}`);
    assert.equal(server.advertisedHost, '192.168.3.18');
  } finally {
    await server.stop();
  }
});

test('selects another port when the requested desktop port is occupied', async () => {
  const occupied = http.createServer();
  await new Promise((resolve, reject) => {
    occupied.once('error', reject);
    occupied.listen(0, '127.0.0.1', resolve);
  });
  const requestedPort = occupied.address().port;
  const server = new DevToolsServer({host: '127.0.0.1', port: requestedPort});
  try {
    await server.start();
    assert.notEqual(server.port, requestedPort);
    assert.ok(server.port > requestedPort);
  } finally {
    await server.stop();
    await new Promise(resolve => occupied.close(resolve));
  }
});

test('discovers a connected reporter and forwards console events over CDP', async () => {
  const server = new DevToolsServer({port: 0});
  await server.start();
  const reporter = new WebSocket(`ws://127.0.0.1:${server.port}/reporter`);
  await new Promise(resolve => reporter.once('open', resolve));
  reporter.send(JSON.stringify({protocolVersion: 1, type: 'runtime.hello', runtimeId: 'r1', payload: {runtimeId: 'r1', appName: 'Example', platform: 'react-native', capabilities: ['console']}}));
  await new Promise(resolve => server.once('state', resolve));
  const targets = await new Promise((resolve, reject) => http.get(`http://127.0.0.1:${server.port}/json/list`, response => { let body = ''; response.on('data', chunk => body += chunk); response.on('end', () => resolve(JSON.parse(body))); }).on('error', reject));
  assert.equal(targets[0].title, 'Example');
  const cdp = new WebSocket(`ws://127.0.0.1:${server.port}/cdp/r1`);
  await new Promise(resolve => cdp.once('open', resolve));
  const enabled = waitForMessage(cdp, message => message.id === 1);
  cdp.send(JSON.stringify({id: 1, method: 'Runtime.enable'}));
  await enabled;
  const event = waitForMessage(cdp, message => message.method === 'Runtime.consoleAPICalled');
  reporter.send(JSON.stringify({type: 'console.entry', timestamp: Date.now(), payload: {level: 'log', arguments: ['hello']}}));
  assert.equal((await event).method, 'Runtime.consoleAPICalled');
  reporter.close(); cdp.close(); await server.stop();
});

test('replays events produced before DevTools enables a CDP domain', async () => {
  const server = new DevToolsServer({port: 0});
  await server.start();
  const reporter = new WebSocket(`ws://127.0.0.1:${server.port}/reporter`);
  await new Promise(resolve => reporter.once('open', resolve));
  reporter.send(JSON.stringify({protocolVersion: 1, type: 'runtime.hello', runtimeId: 'replay', payload: {runtimeId: 'replay', appName: 'Replay', platform: 'react-native', capabilities: ['console']}}));
  await new Promise(resolve => server.once('state', resolve));
  reporter.send(JSON.stringify({type: 'console.entry', timestamp: Date.now(), payload: {level: 'warn', arguments: ['before attach']}}));
  await new Promise(resolve => setImmediate(resolve));
  const cdp = new WebSocket(`ws://127.0.0.1:${server.port}/cdp/replay`);
  await new Promise(resolve => cdp.once('open', resolve));
  const replayed = waitForMessage(cdp, message => message.method === 'Runtime.consoleAPICalled');
  cdp.send(JSON.stringify({id: 1, method: 'Runtime.enable'}));
  assert.equal((await replayed).params.args[0].value, 'before attach');
  reporter.close(); cdp.close(); await server.stop();
});

test('serves the customized frontend and pairing QR code', async () => {
  const frontendDir = require('node:path').resolve(__dirname, '../frontend-dist');
  const server = new DevToolsServer({port: 0, frontendDir});
  await server.start();
  const frontend = await get(`http://127.0.0.1:${server.port}/devtools/rn_fusebox.html`);
  assert.equal(frontend.status, 200);
  assert.match(frontend.body, /<title>红糖开发助手<\/title>/);
  assert.doesNotMatch(frontend.body, /htyf-welcome\.js/);
  const welcome = await get(`http://127.0.0.1:${server.port}/devtools/panels/rn_welcome/rn_welcome.js`);
  assert.equal(welcome.status, 200);
  assert.match(welcome.body, /红糖开发助手/);
  assert.doesNotMatch(welcome.body, /React Native DevTools|Debugging docs/);
  const entry = await get(`http://127.0.0.1:${server.port}/devtools/entrypoints/rn_fusebox/rn_fusebox.js`);
  assert.equal(entry.status, 200);
  assert.doesNotMatch(entry.body, /title:"Components ⚛"|title:"Profiler ⚛"/);
  const network = await get(`http://127.0.0.1:${server.port}/devtools/panels/network/network.js`);
  assert.equal(network.status, 200);
  assert.doesNotMatch(network.body, /this\.isReactNative\?t\.ResourceType\.resourceCategoriesReactNative/);
  const qr = await get(`http://127.0.0.1:${server.port}/pairing.svg`);
  assert.equal(qr.status, 200);
  assert.match(qr.type, /image\/svg\+xml/);
  assert.match(qr.body, /<svg/);
  await server.stop();
});

test('pairing payload always includes an empty token when pairing is disabled', async () => {
  const server = new DevToolsServer({port: 0, requirePairing: false});
  await server.start();
  assert.deepEqual(server.getPairingPayload(), {
    type: 'htyf.devtools.pairing',
    version: 1,
    endpoint: `ws://127.0.0.1:${server.port}/reporter`,
    token: '',
  });
  await server.stop();
});

test('uses 123456 by default and allows the user to update the pairing token', async () => {
  const server = new DevToolsServer({host: '127.0.0.1', requirePairing: true});
  assert.equal(server.pairingToken, '123456');
  server.setPairingToken('user-token');
  assert.equal(server.getPairingPayload().token, 'user-token');
});

test('disconnects connected reporters when the user updates the pairing token', async () => {
  const server = new DevToolsServer({port: 0, requirePairing: true});
  await server.start();
  const reporter = new WebSocket(`ws://127.0.0.1:${server.port}/reporter`);
  await new Promise(resolve => reporter.once('open', resolve));
  reporter.send(JSON.stringify({protocolVersion: 1, type: 'runtime.hello', runtimeId: 'reauth', payload: {runtimeId: 'reauth', appName: 'Reauth', platform: 'app', token: '123456'}}));
  await new Promise(resolve => server.once('state', resolve));
  const closed = new Promise(resolve => reporter.once('close', (code, reason) => resolve({code, reason: reason.toString()})));
  server.setPairingToken('new-token');
  assert.deepEqual(await closed, {code: 4001, reason: 'Pairing token changed'});
  assert.equal(server.getState().runtimes[0].connected, false);
  assert.equal(server.isAuthorized('123456'), false);
  assert.equal(server.isAuthorized('new-token'), true);
  await server.stop();
});

test('stores response bodies behind the CDP Network interface', async () => {
  const server = new DevToolsServer({port: 0});
  await server.start();
  const reporter = new WebSocket(`ws://127.0.0.1:${server.port}/reporter`);
  await new Promise(resolve => reporter.once('open', resolve));
  reporter.send(JSON.stringify({protocolVersion: 1, type: 'runtime.hello', runtimeId: 'r2', payload: {runtimeId: 'r2', appName: 'Example', platform: 'react-native', capabilities: ['http']}}));
  await new Promise(resolve => server.once('state', resolve));
  reporter.send(JSON.stringify({type: 'http.response.body', timestamp: Date.now(), payload: {requestId: 'request-1', body: '{"ok":true}'}}));
  const cdp = new WebSocket(`ws://127.0.0.1:${server.port}/cdp/r2`);
  await new Promise(resolve => cdp.once('open', resolve));
  const response = new Promise(resolve => cdp.once('message', raw => resolve(JSON.parse(raw.toString()))));
  cdp.send(JSON.stringify({id: 7, method: 'Network.getResponseBody', params: {requestId: 'request-1'}}));
  assert.deepEqual(await response, {id: 7, result: {body: '{"ok":true}', base64Encoded: false}});
  reporter.close(); cdp.close(); await server.stop();
});

test('maps request bodies to Chrome Network payload data', () => {
  const server = new DevToolsServer();
  const event = server.toCdp({
    type: 'http.request.started',
    timestamp: 1000,
    payload: {requestId: 'post-1', url: 'https://api.example/items', method: 'POST', body: '{"name":"demo"}'},
  });
  assert.equal(event.params.request.hasPostData, true);
  assert.equal(event.params.request.postData, '{"name":"demo"}');
});

test('returns a complete empty resource tree required by the DevTools frontend', async () => {
  const server = new DevToolsServer({port: 0});
  await server.start();
  const cdp = new WebSocket(`ws://127.0.0.1:${server.port}/cdp/welcome`);
  await new Promise(resolve => cdp.once('open', resolve));
  const response = new Promise(resolve => cdp.once('message', raw => resolve(JSON.parse(raw.toString()))));
  cdp.send(JSON.stringify({id: 9, method: 'Page.getResourceTree'}));
  const message = await response;
  assert.deepEqual(message.result.frameTree.childFrames, []);
  assert.deepEqual(message.result.frameTree.resources, []);
  cdp.close();
  await server.stop();
});

test('exposes console objects as expandable CDP remote objects', async () => {
  const server = new DevToolsServer({port: 0});
  await server.start();
  const reporter = new WebSocket(`ws://127.0.0.1:${server.port}/reporter`);
  await new Promise(resolve => reporter.once('open', resolve));
  reporter.send(JSON.stringify({protocolVersion: 1, type: 'runtime.hello', runtimeId: 'objects', payload: {runtimeId: 'objects', appName: 'Objects', platform: 'react-native', capabilities: ['console']}}));
  await new Promise(resolve => server.once('state', resolve));
  const cdp = new WebSocket(`ws://127.0.0.1:${server.port}/cdp/objects`);
  await new Promise(resolve => cdp.once('open', resolve));
  const enabled = waitForMessage(cdp, message => message.id === 1);
  cdp.send(JSON.stringify({id: 1, method: 'Runtime.enable'}));
  await enabled;
  const event = waitForMessage(cdp, message => message.method === 'Runtime.consoleAPICalled');
  reporter.send(JSON.stringify({type: 'console.entry', timestamp: Date.now(), payload: {level: 'log', arguments: [{user: {id: 7}, tags: ['demo']}]}}));
  const remoteObject = (await event).params.args[0];
  assert.equal(remoteObject.type, 'object');
  assert.ok(remoteObject.objectId);
  assert.equal(remoteObject.preview.properties.find(property => property.name === 'tags').type, 'object');
  const properties = waitForMessage(cdp, message => message.id === 2);
  cdp.send(JSON.stringify({id: 2, method: 'Runtime.getProperties', params: {objectId: remoteObject.objectId, ownProperties: true}}));
  const result = (await properties).result.result;
  assert.equal(result.find(property => property.name === 'user').value.type, 'object');
  assert.equal(result.find(property => property.name === 'tags').value.subtype, 'array');
  reporter.close(); cdp.close(); await server.stop();
});

test('rejects an invalid reporter token when pairing is required', async () => {
  const server = new DevToolsServer({port: 0, requirePairing: true, pairingToken: 'known-token'});
  await server.start();
  const reporter = new WebSocket(`ws://127.0.0.1:${server.port}/reporter`);
  await new Promise(resolve => reporter.once('open', resolve));
  const closed = new Promise(resolve => reporter.once('close', (code, reason) => resolve({code, reason: reason.toString()})));
  reporter.send(JSON.stringify({protocolVersion: 1, type: 'runtime.hello', runtimeId: 'denied', payload: {runtimeId: 'denied', appName: 'Denied', platform: 'react-native', token: 'wrong'}}));
  assert.deepEqual(await closed, {code: 1008, reason: 'Invalid pairing token'});
  assert.equal(server.getState().runtimes.length, 0);
  await server.stop();
});

test('does not retain the pairing token in runtime state', async () => {
  const server = new DevToolsServer({port: 0, requirePairing: true, pairingToken: 'secret-token'});
  await server.start();
  const reporter = new WebSocket(`ws://127.0.0.1:${server.port}/reporter`);
  await new Promise(resolve => reporter.once('open', resolve));
  reporter.send(JSON.stringify({protocolVersion: 1, type: 'runtime.hello', runtimeId: 'safe', payload: {runtimeId: 'safe', appName: 'Safe', platform: 'react-native', token: 'secret-token'}}));
  await new Promise(resolve => server.once('state', resolve));
  assert.equal(server.getState(true).runtimes[0].token, undefined);
  reporter.close();
  await server.stop();
});

test('rejects an unsupported reporter protocol version', async () => {
  const server = new DevToolsServer({port: 0});
  await server.start();
  const reporter = new WebSocket(`ws://127.0.0.1:${server.port}/reporter`);
  await new Promise(resolve => reporter.once('open', resolve));
  const closed = new Promise(resolve => reporter.once('close', (code, reason) => resolve({code, reason: reason.toString()})));
  reporter.send(JSON.stringify({protocolVersion: 99, type: 'runtime.hello', runtimeId: 'future', payload: {runtimeId: 'future', appName: 'Future', platform: 'react-native'}}));
  assert.deepEqual(await closed, {code: 1002, reason: 'Unsupported protocol version'});
  await server.stop();
});

test('expires a reporter that stops sending heartbeats', async () => {
  const server = new DevToolsServer({port: 0, heartbeatTimeoutMs: 30, heartbeatSweepMs: 10});
  await server.start();
  const reporter = new WebSocket(`ws://127.0.0.1:${server.port}/reporter`);
  await new Promise(resolve => reporter.once('open', resolve));
  reporter.send(JSON.stringify({protocolVersion: 1, type: 'runtime.hello', runtimeId: 'stale', payload: {runtimeId: 'stale', appName: 'Stale', platform: 'react-native', capabilities: []}}));
  await new Promise(resolve => server.once('state', resolve));
  const disconnected = new Promise(resolve => {
    const onState = state => {
      if (state.runtimes.find(runtime => runtime.runtimeId === 'stale')?.connected === false) {
        server.off('state', onState);
        resolve();
      }
    };
    server.on('state', onState);
  });
  await disconnected;
  assert.equal(server.getState().runtimes[0].connected, false);
  await server.stop();
});

test('maps WebSocket lifecycle to Chrome CDP handshake and frame events', () => {
  const server = new DevToolsServer();
  const created = server.toCdp({type: 'websocket.created', timestamp: 1000, payload: {socketId: 'ws-1', url: 'wss://example.test/events'}});
  assert.deepEqual(created.map(event => event.method), [
    'Network.webSocketCreated',
    'Network.webSocketWillSendHandshakeRequest',
  ]);
  assert.equal(created[1].params.request.method, 'GET');
  const opened = server.toCdp({type: 'websocket.opened', timestamp: 1100, payload: {socketId: 'ws-1', url: 'wss://example.test/events'}});
  assert.equal(opened.method, 'Network.webSocketHandshakeResponseReceived');
  assert.equal(opened.params.response.status, 101);
  assert.equal(opened.params.response.statusText, 'Switching Protocols');
});

test('built-in demo uses the reporter protocol and produces all supported event groups', async () => {
  const server = new DevToolsServer({port: 0});
  await server.start();
  const demo = new DemoRuntime({endpoint: `ws://127.0.0.1:${server.port}/reporter`, intervalMs: 60_000});
  const connected = new Promise(resolve => server.once('state', resolve));
  demo.start();
  const state = await connected;
  assert.equal(state.runtimes[0].appName, '红糖云服调试 Demo');
  assert.equal(state.runtimes[0].platform, 'electron-main');
  assert.equal(state.runtimes[0].compatibility.status, 'compatible');
  assert.equal(state.runtimes[0].compatibility.reporterPackage, '@htyf-mp/devtools-desktop-demo');
  assert.equal(state.runtimes[0].compatibility.reporterVersion, '0.1.0');
  await new Promise(resolve => setImmediate(resolve));
  const eventTypes = server.runtimes.get(demo.runtimeId).events.map(event => event.type);
  assert.ok(eventTypes.includes('console.entry'));
  assert.ok(eventTypes.includes('http.response.body'));
  assert.ok(eventTypes.includes('websocket.frameReceived'));
  demo.generateSample();
  const allEventTypes = server.runtimes.get(demo.runtimeId).events.map(event => event.type);
  assert.equal(allEventTypes.filter(type => type === 'websocket.created').length, 1);
  assert.equal(allEventTypes.filter(type => type === 'websocket.opened').length, 1);
  demo.stop();
  await server.stop();
});

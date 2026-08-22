import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { after, before, test } from 'node:test';

const token = 'IDOC_GUARD_CONTRACT_FIXTURE_TOKEN_01';
let child;
let origin;

const validXml = `<ORDERS05><IDOC BEGIN="1"><EDI_DC40 SEGMENT="1"><MESTYP>ORDERS</MESTYP><IDOCTYP>ORDERS05</IDOCTYP><SNDPRT>LS</SNDPRT><SNDPRN>N8N</SNDPRN><RCVPRT>LS</RCVPRT><RCVPRN>S4DCLNT100</RCVPRN><RCVPOR>S4DCLNT100</RCVPOR></EDI_DC40><E1EDK01 SEGMENT="1"><BELNR>4500001234</BELNR><CURCY>EUR</CURCY></E1EDK01><E1EDP01 SEGMENT="1"><POSEX>000010</POSEX><MENGE>2</MENGE><MENEE>EA</MENEE><E1EDP19 SEGMENT="1"><QUALF>002</QUALF><IDTNR>MAT-1000</IDTNR></E1EDP19></E1EDP01></IDOC></ORDERS05>`;

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function waitForReady(process) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Fixture did not start')), 5_000);
    process.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Fixture exited with code ${code}`));
    });
    process.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('listening')) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
}

async function request(path, options = {}) {
  return fetch(`${origin}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-idoc-guard-mode': 'governed',
      'x-correlation-id': 'contract-test-001',
      ...(options.headers ?? {}),
    },
  });
}

function submitBody(idempotencyKey, xml = validXml) {
  const operation = 'submitPurchaseOrderIdoc';
  return JSON.stringify({
    operation,
    idocXml: xml,
    idempotencyKey,
    context: {
      direction: 'outbound',
      write: true,
      confirmation: `SEND ${operation} ${idempotencyKey}`,
    },
  });
}

before(async () => {
  const port = await availablePort();
  origin = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['contract-sidecar/server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(port), CONTRACT_TOKEN: token },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForReady(child);
});

after(() => child?.kill('SIGTERM'));

test('health advertises the governed IDoc contract', async () => {
  const response = await request('/v1/health');
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.capabilities.idoc, true);
  assert.equal(body.capabilities.governed, true);
  assert.deepEqual(body.capabilities.operations, [
    'submitPurchaseOrderIdoc',
    'getIdocStatus',
    'listInboundIdocs',
    'getInboundIdoc',
    'acknowledgeInboundIdoc',
  ]);
});

test('rejects unauthenticated and non-governed requests', async () => {
  const unauthorized = await fetch(`${origin}/v1/health`);
  assert.equal(unauthorized.status, 401);

  const wrongMode = await fetch(`${origin}/v1/health`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(wrongMode.status, 403);
});

test('submits an allowlisted IDoc and returns the same receipt on an identical retry', async () => {
  const first = await request('/v1/outbound/submitPurchaseOrderIdoc/submit', {
    method: 'POST',
    body: submitBody('PO-4500001234-v1'),
  });
  const firstBody = await first.json();
  assert.equal(first.status, 200);
  assert.equal(firstBody.data.duplicate, false);
  assert.equal(firstBody.data.messageType, 'ORDERS');
  assert.equal(firstBody.meta.syntheticData, true);

  const retry = await request('/v1/outbound/submitPurchaseOrderIdoc/submit', {
    method: 'POST',
    body: submitBody('PO-4500001234-v1'),
  });
  const retryBody = await retry.json();
  assert.equal(retry.status, 200);
  assert.equal(retryBody.data.duplicate, true);
  assert.equal(retryBody.data.requestId, firstBody.data.requestId);
  assert.equal(retryBody.data.docnum, firstBody.data.docnum);
});

test('rejects an idempotency conflict, technical mismatch, unknown segment and XXE', async () => {
  const changed = validXml.replace('<MENGE>2</MENGE>', '<MENGE>3</MENGE>');
  const conflict = await request('/v1/outbound/submitPurchaseOrderIdoc/submit', {
    method: 'POST',
    body: submitBody('PO-4500001234-v1', changed),
  });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error, 'IDEMPOTENCY_CONFLICT');

  const mismatch = await request('/v1/outbound/submitPurchaseOrderIdoc/submit', {
    method: 'POST',
    body: submitBody('PO-4500001235-v1', validXml.replace(
      '<IDOCTYP>ORDERS05</IDOCTYP>', '<IDOCTYP>INVOIC02</IDOCTYP>')),
  });
  assert.equal((await mismatch.json()).error, 'IDOC_CONTRACT_MISMATCH');

  const wrongRoot = await request('/v1/outbound/submitPurchaseOrderIdoc/submit', {
    method: 'POST',
    body: submitBody('PO-4500001235-root-v1', validXml
      .replace('<ORDERS05>', '<IDOCS>').replace('</ORDERS05>', '</IDOCS>')),
  });
  assert.equal((await wrongRoot.json()).error, 'IDOC_ROOT_TYPE_MISMATCH');

  const unknown = await request('/v1/outbound/submitPurchaseOrderIdoc/submit', {
    method: 'POST',
    body: submitBody('PO-4500001236-v1', validXml.replace('</E1EDK01>', '<ZSECRET SEGMENT="1">1</ZSECRET></E1EDK01>')),
  });
  assert.equal((await unknown.json()).error, 'IDOC_SEGMENT_NOT_ALLOWED');

  const wrongPartner = await request('/v1/outbound/submitPurchaseOrderIdoc/submit', {
    method: 'POST',
    body: submitBody('PO-4500001238-v1', validXml.replace('<RCVPRN>S4DCLNT100</RCVPRN>', '<RCVPRN>OTHER</RCVPRN>')),
  });
  assert.equal((await wrongPartner.json()).error, 'IDOC_PARTNER_CONTRACT_MISMATCH');

  const xxe = await request('/v1/outbound/submitPurchaseOrderIdoc/submit', {
    method: 'POST',
    body: submitBody('PO-4500001237-v1', `<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]>${validXml}`),
  });
  assert.equal((await xxe.json()).error, 'XML_EXTERNAL_ENTITY_REJECTED');
});

test('returns status by idempotency key', async () => {
  const response = await request('/v1/status/PO-4500001234-v1');
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.operation, 'getIdocStatus');
  assert.equal(body.data.status, 'submitted');
  assert.equal(body.meta.readOnly, true);
});

test('lists inbound receipts, retrieves an opted-in payload and acknowledges idempotently', async () => {
  const list = await request('/v1/inbound?limit=1');
  const listBody = await list.json();
  assert.equal(list.status, 200);
  assert.equal(listBody.data.length, 1);
  assert.equal(listBody.data[0].receiptId, 'inbound-001');
  assert.equal(listBody.nextCursor, '1');
  assert.equal('idocXml' in listBody.data[0], false);

  const document = await request('/v1/inbound/inbound-001/document');
  const documentBody = await document.json();
  assert.equal(document.status, 200);
  assert.equal(documentBody.operation, 'getInboundIdoc');
  assert.match(documentBody.data.idocXml, /<MESTYP>DESADV<\/MESTYP>/);
  assert.equal(documentBody.meta.direction, 'inbound-payload');

  const ackBody = JSON.stringify({
    operation: 'acknowledgeInboundIdoc',
    receiptId: 'inbound-001',
    outcome: 'accepted',
    reason: '',
    context: {
      direction: 'inbound-ack',
      write: true,
      confirmation: 'ACK inbound-001 accepted',
    },
  });
  const first = await request('/v1/inbound/inbound-001/ack', { method: 'POST', body: ackBody });
  assert.equal((await first.json()).data.duplicate, false);
  const duplicate = await request('/v1/inbound/inbound-001/ack', { method: 'POST', body: ackBody });
  assert.equal((await duplicate.json()).data.duplicate, true);

  const conflictBody = ackBody.replaceAll('accepted', 'rejected');
  const conflict = await request('/v1/inbound/inbound-001/ack', {
    method: 'POST',
    body: conflictBody.replace('"reason":""', '"reason":"business rule"'),
  });
  assert.equal(conflict.status, 409);
});

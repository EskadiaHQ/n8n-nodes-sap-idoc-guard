import { createHash, randomUUID } from 'node:crypto';
import http from 'node:http';

const port = Number(process.env.PORT ?? 8080);
const expectedToken = process.env.CONTRACT_TOKEN ?? 'IDOC_GUARD_CONTRACT_FIXTURE_TOKEN_01';
const maxBodyBytes = 256 * 1024;
const operations = Object.freeze([
  'submitPurchaseOrderIdoc',
  'getIdocStatus',
  'listInboundIdocs',
  'getInboundIdoc',
  'acknowledgeInboundIdoc',
]);
const outboundOperation = 'submitPurchaseOrderIdoc';
const allowedSegments = new Set([
  'EDI_DC40',
  'E1EDK01',
  'E1EDKA1',
  'E1EDP01',
  'E1EDP19',
]);
const submissions = new Map();
let sequence = 1;
const inbound = [
  {
    receiptId: 'inbound-001',
    docnum: '0000000000090001',
    messageType: 'DESADV',
    basicType: 'DELVRY07',
    senderPartner: 'SUPPLIER_1000',
    correlationId: 'PO-4500001001',
    payloadDigest: '2e7f4c5f-contract-fixture',
    status: 'pending',
    receivedAt: '2026-08-22T08:00:00Z',
    idocXml: '<DELVRY07><IDOC BEGIN="1"><EDI_DC40 SEGMENT="1"><DOCNUM>0000000000090001</DOCNUM><MESTYP>DESADV</MESTYP><IDOCTYP>DELVRY07</IDOCTYP><SNDPRN>SUPPLIER_1000</SNDPRN></EDI_DC40></IDOC></DELVRY07>',
  },
  {
    receiptId: 'inbound-002',
    docnum: '0000000000090002',
    messageType: 'INVOIC',
    basicType: 'INVOIC02',
    senderPartner: 'SUPPLIER_2000',
    correlationId: 'PO-4500001002',
    payloadDigest: '8b762e11-contract-fixture',
    status: 'pending',
    receivedAt: '2026-08-22T08:05:00Z',
    idocXml: '<INVOIC02><IDOC BEGIN="1"><EDI_DC40 SEGMENT="1"><DOCNUM>0000000000090002</DOCNUM><MESTYP>INVOIC</MESTYP><IDOCTYP>INVOIC02</IDOCTYP><SNDPRN>SUPPLIER_2000</SNDPRN></EDI_DC40></IDOC></INVOIC02>',
  },
];

function json(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function isAuthorized(req) {
  return req.headers.authorization === `Bearer ${expectedToken}`;
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new Error('REQUEST_TOO_LARGE');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function tagValue(xml, tag) {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, 'i').exec(xml);
  return match?.[1]?.trim().toUpperCase() ?? '';
}

function validateOutboundXml(xml) {
  if (typeof xml !== 'string' || !xml.startsWith('<') || !xml.endsWith('>')) {
    throw new Error('IDOC_XML_INVALID');
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('XML_EXTERNAL_ENTITY_REJECTED');
  if (Buffer.byteLength(xml, 'utf8') > 192 * 1024) throw new Error('IDOC_XML_TOO_LARGE');
  if (!/^(?:<\?xml\s[^>]*>\s*)?<ORDERS05(?:\s[^>]*)?>/i.test(xml)) {
    throw new Error('IDOC_ROOT_TYPE_MISMATCH');
  }
  if (tagValue(xml, 'MESTYP') !== 'ORDERS' || tagValue(xml, 'IDOCTYP') !== 'ORDERS05') {
    throw new Error('IDOC_CONTRACT_MISMATCH');
  }
  if ((xml.match(/<IDOC(?:\s|>)/g) ?? []).length !== 1
      || (xml.match(/<EDI_DC40(?:\s|>)/g) ?? []).length !== 1) {
    throw new Error('IDOC_DOCUMENT_COUNT_INVALID');
  }
  if (tagValue(xml, 'CIMTYP') !== '') throw new Error('IDOC_EXTENSION_NOT_ALLOWED');
  if (tagValue(xml, 'SNDPRT') !== 'LS' || tagValue(xml, 'SNDPRN') !== 'N8N'
      || tagValue(xml, 'RCVPRT') !== 'LS' || tagValue(xml, 'RCVPRN') !== 'S4DCLNT100'
      || tagValue(xml, 'RCVPOR') !== 'S4DCLNT100') {
    throw new Error('IDOC_PARTNER_CONTRACT_MISMATCH');
  }
  const tags = [...xml.matchAll(/<([A-Z][A-Z0-9_]{0,29})(\s[^>]*)?>/g)]
    .filter((match) => match[1] === 'EDI_DC40' || /\bSEGMENT\s*=/.test(match[2] ?? ''))
    .map((match) => match[1]);
  if (tags.length > 200) throw new Error('IDOC_SEGMENT_LIMIT_EXCEEDED');
  const unknown = tags.find((tag) => !allowedSegments.has(tag));
  if (unknown) throw new Error('IDOC_SEGMENT_NOT_ALLOWED');
  if (!xml.includes('<E1EDK01') || !xml.includes('<E1EDP01')) {
    throw new Error('IDOC_REQUIRED_SEGMENT_MISSING');
  }
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function fixtureMeta(direction, write) {
  return {
    source: 'contract-fixture',
    syntheticData: true,
    direction,
    readOnly: !write,
    write,
  };
}

function findSubmission(reference) {
  for (const submission of submissions.values()) {
    if (
      submission.requestId === reference
      || submission.docnum === reference
      || submission.idempotencyKey === reference
    ) return submission;
  }
  return undefined;
}

function routePath(url) {
  return new URL(url, 'http://contract-fixture');
}

const server = http.createServer(async (req, res) => {
  const correlationId = String(req.headers['x-correlation-id'] ?? randomUUID());
  if (!isAuthorized(req)) {
    json(res, 401, { error: 'UNAUTHORIZED', correlationId });
    return;
  }
  if (req.headers['x-idoc-guard-mode'] !== 'governed') {
    json(res, 403, { error: 'GOVERNED_MODE_REQUIRED', correlationId });
    return;
  }

  const parsedUrl = routePath(req.url ?? '/');
  if (req.method === 'GET' && parsedUrl.pathname === '/v1/health') {
    json(res, 200, {
      status: 'ok',
      service: 'sap-idoc-guard-contract-fixture',
      version: '0.1.0',
      capabilities: {
        idoc: true,
        governed: true,
        outbound: true,
        statusRead: true,
        inboundPull: true,
        inboundPayloadRead: true,
        inboundAck: true,
        operations,
      },
      correlationId,
    });
    return;
  }

  const outboundMatch = parsedUrl.pathname.match(/^\/v1\/outbound\/([A-Za-z][A-Za-z0-9]*)\/submit$/);
  if (req.method === 'POST' && outboundMatch) {
    const routeOperation = outboundMatch[1];
    if (routeOperation !== outboundOperation) {
      json(res, 403, { error: 'OPERATION_NOT_ALLOWED', correlationId });
      return;
    }
    try {
      const body = await readJson(req);
      const idempotencyKey = String(body.idempotencyKey ?? '');
      const expectedConfirmation = `SEND ${routeOperation} ${idempotencyKey}`;
      if (
        body.operation !== routeOperation
        || body.context?.direction !== 'outbound'
        || body.context?.write !== true
        || body.context?.confirmation !== expectedConfirmation
      ) throw new Error('OUTBOUND_CONTRACT_REQUIRED');
      if (!/^[A-Za-z0-9._:/-]{1,128}$/.test(idempotencyKey)) {
        throw new Error('IDEMPOTENCY_KEY_INVALID');
      }
      validateOutboundXml(body.idocXml);
      const payloadDigest = digest(body.idocXml);
      const previous = submissions.get(idempotencyKey);
      if (previous && previous.payloadDigest !== payloadDigest) {
        json(res, 409, { error: 'IDEMPOTENCY_CONFLICT', correlationId });
        return;
      }
      const duplicate = Boolean(previous);
      const submission = previous ?? {
        requestId: randomUUID(),
        idempotencyKey,
        tid: `TID-FIXTURE-${String(sequence).padStart(6, '0')}`,
        docnum: String(900000 + sequence).padStart(16, '0'),
        status: 'submitted',
        duplicate: false,
        payloadDigest,
        messageType: 'ORDERS',
        basicType: 'ORDERS05',
        statusHistory: [
          { code: 'fixture-accepted', at: '2026-08-22T09:00:00Z' },
          { code: 'fixture-submitted', at: '2026-08-22T09:00:01Z' },
        ],
      };
      if (!previous) {
        sequence += 1;
        submissions.set(idempotencyKey, submission);
      }
      json(res, 200, {
        operation: routeOperation,
        correlationId,
        data: { ...submission, duplicate },
        meta: fixtureMeta('outbound', true),
      });
    } catch (error) {
      const code = error instanceof Error && /^[A-Z][A-Z0-9_]{2,64}$/.test(error.message)
        ? error.message
        : 'INVALID_JSON';
      json(res, code === 'REQUEST_TOO_LARGE' ? 413 : 400, { error: code, correlationId });
    }
    return;
  }

  const statusMatch = parsedUrl.pathname.match(/^\/v1\/status\/([^/]+)$/);
  if (req.method === 'GET' && statusMatch) {
    const reference = decodeURIComponent(statusMatch[1]);
    const submission = findSubmission(reference);
    if (!submission) {
      json(res, 404, { error: 'IDOC_NOT_FOUND', correlationId });
      return;
    }
    json(res, 200, {
      operation: 'getIdocStatus',
      correlationId,
      data: {
        requestId: submission.requestId,
        idempotencyKey: submission.idempotencyKey,
        docnum: submission.docnum,
        messageType: submission.messageType,
        basicType: submission.basicType,
        status: submission.status,
        statusHistory: submission.statusHistory,
      },
      meta: fixtureMeta('status', false),
    });
    return;
  }

  if (req.method === 'GET' && parsedUrl.pathname === '/v1/inbound') {
    const limit = Number(parsedUrl.searchParams.get('limit') ?? 10);
    const cursor = Number(parsedUrl.searchParams.get('cursor') ?? 0);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(cursor) || cursor < 0) {
      json(res, 400, { error: 'PAGINATION_INVALID', correlationId });
      return;
    }
    const pending = inbound.filter((item) => item.status === 'pending');
    const data = pending.slice(cursor, cursor + limit).map(({ idocXml, ...summary }) => summary);
    const nextCursor = cursor + limit < pending.length ? String(cursor + limit) : undefined;
    json(res, 200, {
      operation: 'listInboundIdocs',
      correlationId,
      data,
      ...(nextCursor ? { nextCursor } : {}),
      meta: fixtureMeta('inbound-read', false),
    });
    return;
  }

  const documentMatch = parsedUrl.pathname.match(/^\/v1\/inbound\/([^/]+)\/document$/);
  if (req.method === 'GET' && documentMatch) {
    const receiptId = decodeURIComponent(documentMatch[1]);
    const record = inbound.find((item) => item.receiptId === receiptId);
    if (!record) {
      json(res, 404, { error: 'RECEIPT_NOT_FOUND', correlationId });
      return;
    }
    json(res, 200, {
      operation: 'getInboundIdoc',
      correlationId,
      data: { ...record },
      meta: fixtureMeta('inbound-payload', false),
    });
    return;
  }

  const ackMatch = parsedUrl.pathname.match(/^\/v1\/inbound\/([^/]+)\/ack$/);
  if (req.method === 'POST' && ackMatch) {
    const receiptId = decodeURIComponent(ackMatch[1]);
    const record = inbound.find((item) => item.receiptId === receiptId);
    if (!record) {
      json(res, 404, { error: 'RECEIPT_NOT_FOUND', correlationId });
      return;
    }
    try {
      const body = await readJson(req);
      const outcome = String(body.outcome ?? '');
      const expectedConfirmation = `ACK ${receiptId} ${outcome}`;
      if (
        body.operation !== 'acknowledgeInboundIdoc'
        || body.receiptId !== receiptId
        || body.context?.direction !== 'inbound-ack'
        || body.context?.write !== true
        || body.context?.confirmation !== expectedConfirmation
        || !['accepted', 'rejected', 'retry'].includes(outcome)
      ) throw new Error('ACK_CONTRACT_REQUIRED');
      if (outcome !== 'accepted' && String(body.reason ?? '').trim() === '') {
        throw new Error('ACK_REASON_REQUIRED');
      }
      if (record.ackOutcome && record.ackOutcome !== outcome) {
        json(res, 409, { error: 'ACK_CONFLICT', correlationId });
        return;
      }
      const duplicate = Boolean(record.ackOutcome);
      record.ackOutcome = outcome;
      record.ackReason = String(body.reason ?? '');
      record.status = outcome === 'retry' ? 'pending_retry' : outcome;
      json(res, 200, {
        operation: 'acknowledgeInboundIdoc',
        correlationId,
        data: { receiptId, outcome, status: record.status, duplicate },
        meta: fixtureMeta('inbound-ack', true),
      });
    } catch (error) {
      const code = error instanceof Error && /^[A-Z][A-Z0-9_]{2,64}$/.test(error.message)
        ? error.message
        : 'INVALID_JSON';
      json(res, code === 'REQUEST_TOO_LARGE' ? 413 : 400, { error: code, correlationId });
    }
    return;
  }

  json(res, 403, { error: 'ROUTE_NOT_ALLOWED', correlationId });
});

server.listen(port, '0.0.0.0', () => {
  process.stdout.write(`SAP IDoc Guard contract fixture listening on ${port}\n`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	sanitizeAcknowledgementResponse,
	sanitizeHealthResponse,
	sanitizeInboundDocumentResponse,
	sanitizeInboundListResponse,
	sanitizeStatusResponse,
	sanitizeSubmissionResponse,
} from '../nodes/SapIdocGuard/response';

describe('sidecar response governance', () => {
	it('requires governed IDoc capabilities and strips backend host data', () => {
		assert.deepEqual(
			sanitizeHealthResponse({
				status: 'ok',
				service: 'sap-idoc-sidecar',
				version: '0.1.0',
				backend: { systemId: 'A4H', client: '250', release: '754', host: 'private' },
				capabilities: {
					idoc: true,
					governed: true,
					outbound: true,
					statusRead: true,
					inboundPull: true,
					inboundPayloadRead: true,
					inboundAck: true,
					operations: ['submitPurchaseOrderIdoc', 'IDOC_INBOUND_ASYNCHRONOUS'],
				},
			}),
			{
				connected: true,
				status: 'ok',
				service: 'sap-idoc-sidecar',
				version: '0.1.0',
				idoc: true,
				governed: true,
				outbound: true,
				statusRead: true,
				inboundPull: true,
				inboundPayloadRead: true,
				inboundAck: true,
				operations: ['submitPurchaseOrderIdoc'],
				backend: { systemId: 'A4H', client: '250', release: '754' },
			},
		);
		assert.throws(
			() => sanitizeHealthResponse({ status: 'ok', capabilities: { idoc: false } }),
			/does not advertise governed IDoc/,
		);
	});

	it('projects raw inbound XML only through the dedicated payload response', () => {
		const result = sanitizeInboundDocumentResponse(
			{
				correlationId: 'trace-payload',
				data: { receiptId: 'r1', idocXml: '<IDOCS/>', internal: 'blocked' },
				meta: {
					direction: 'inbound-payload',
					readOnly: true,
					write: false,
					source: 'sap-jidoclib',
					syntheticData: false,
				},
			},
			'trace-payload',
			'r1',
			['receiptId', 'idocXml'],
		);
		assert.equal(result.idocXml, '<IDOCS/>');
		assert.equal('internal' in result, false);
	});

	it('projects a submission and requires write attestation', () => {
		const result = sanitizeSubmissionResponse(
			{
				operation: 'submitPurchaseOrderIdoc',
				correlationId: 'trace-1',
				data: {
					requestId: 'req-1',
					idempotencyKey: 'PO-1-v1',
					docnum: '0000000000000001',
					status: 'submitted',
					internalPayload: 'blocked',
				},
				meta: {
					direction: 'outbound',
					write: true,
					readOnly: false,
					source: 'sap-jidoclib',
					syntheticData: false,
				},
			},
			'submitPurchaseOrderIdoc',
			'trace-1',
			'PO-1-v1',
			['requestId', 'idempotencyKey', 'docnum', 'status'],
		);
		assert.equal(result.docnum, '0000000000000001');
		assert.equal('internalPayload' in result, false);
		assert.deepEqual(result._idoc, {
			operation: 'submitPurchaseOrderIdoc',
			correlationId: 'trace-1',
			direction: 'outbound',
			readOnly: false,
			write: true,
			source: 'sap-jidoclib',
			syntheticData: false,
		});
		assert.throws(
			() =>
				sanitizeSubmissionResponse(
					{
						operation: 'submitPurchaseOrderIdoc',
						data: {},
						meta: { direction: 'outbound', readOnly: true },
					},
					'submitPurchaseOrderIdoc',
					'trace-1',
					'PO-1-v1',
					['status'],
				),
			/write=true/,
		);
	});

	it('sanitizes status and inbound list responses', () => {
		const status = sanitizeStatusResponse(
			{
				operation: 'getIdocStatus',
				correlationId: 'trace-2',
				data: { docnum: '1', status: '53', rawControlRecord: 'blocked' },
				meta: { direction: 'status', readOnly: true, write: false },
			},
			'trace-2',
			['docnum', 'status'],
		);
		assert.deepEqual({ docnum: status.docnum, status: status.status }, { docnum: '1', status: '53' });
		assert.equal('rawControlRecord' in status, false);

		const inbound = sanitizeInboundListResponse(
			{
				correlationId: 'trace-3',
				data: [
					{ receiptId: 'r1', docnum: '1', payload: 'blocked' },
					{ receiptId: 'r2', docnum: '2', payload: 'blocked' },
				],
				nextCursor: '2',
				meta: { direction: 'inbound-read', readOnly: true, write: false },
			},
			'trace-3',
			['receiptId', 'docnum'],
			1,
		);
		assert.equal(inbound.length, 1);
		assert.equal(inbound[0].receiptId, 'r1');
		assert.equal('payload' in inbound[0], false);
		assert.deepEqual((inbound[0]._idoc as Record<string, unknown>).nextCursor, '2');
	});

	it('sanitizes an acknowledgement and rejects mismatched receipt IDs', () => {
		const result = sanitizeAcknowledgementResponse(
			{
				correlationId: 'trace-4',
				data: { receiptId: 'r1', outcome: 'accepted', status: 'accepted', secret: 'blocked' },
				meta: { direction: 'inbound-ack', readOnly: false, write: true },
			},
			'trace-4',
			'r1',
			['receiptId', 'outcome', 'status'],
		);
		assert.equal(result.outcome, 'accepted');
		assert.equal('secret' in result, false);
		assert.throws(
			() =>
				sanitizeAcknowledgementResponse(
					{
						data: { receiptId: 'other' },
						meta: { direction: 'inbound-ack', readOnly: false, write: true },
					},
					'trace-4',
					'r1',
					['receiptId'],
				),
			/receipt ID does not match/,
		);
	});
});

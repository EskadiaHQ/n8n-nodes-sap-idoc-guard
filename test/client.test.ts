import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	acknowledgeInboundIdoc,
	getIdocStatus,
	getInboundIdoc,
	listInboundIdocs,
	submitApprovedIdoc,
	testSidecarConnection,
} from '../nodes/SapIdocGuard/client';
import type {
	IdocGuardRequestOptions,
	SapIdocGuardCredentials,
} from '../nodes/SapIdocGuard/types';

const credentials: SapIdocGuardCredentials = {
	baseUrl: 'https://idoc.example.com/',
	apiToken: 'test-'.repeat(8),
	allowedOperations: 'getIdocStatus',
	operationPoliciesJson:
		'{"getIdocStatus":{"direction":"status","outputFields":["docnum","status"]}}',
	rejectUnauthorized: true,
	maxDocuments: 10,
	maxSegments: 500,
	maxRequestBytes: 262144,
	maxResponseBytes: 524288,
	connectionTimeout: 15000,
	requestTimeout: 60000,
};

describe('sidecar HTTP contract', () => {
	it('calls the fixed health endpoint in governed mode', async () => {
		let captured: IdocGuardRequestOptions | undefined;
		await testSidecarConnection(
			credentials,
			async (options) => {
				captured = options;
				return { status: 'ok' };
			},
			'trace-health',
		);
		assert.equal(captured?.url, 'https://idoc.example.com/v1/health');
		assert.equal(captured?.headers['X-IDoc-Guard-Mode'], 'governed');
		assert.equal(captured?.headers.Authorization, `Bearer ${credentials.apiToken}`);
	});

	it('uses the non-XSUAA token header for a compatible SAP BTP gateway', async () => {
		let captured: IdocGuardRequestOptions | undefined;
		await testSidecarConnection(
			{ ...credentials, headerMode: 'xIdocGuardToken' },
			async (options) => {
				captured = options;
				return { status: 'ok' };
			},
			'trace-btp',
		);
		assert.equal(captured?.headers['X-IDoc-Guard-Token'], credentials.apiToken);
		assert.equal(captured?.headers.Authorization, undefined);
	});

	it('submits only to the governed outbound alias and carries no SAP password', async () => {
		let captured: IdocGuardRequestOptions | undefined;
		await submitApprovedIdoc(
			credentials,
			async (options) => {
				captured = options;
				return { data: {} };
			},
			'submitPurchaseOrderIdoc',
			'<IDOCS/>',
			'PO-1-v1',
			'trace-1',
			'SEND submitPurchaseOrderIdoc PO-1-v1',
		);
		assert.equal(
			captured?.url,
			'https://idoc.example.com/v1/outbound/submitPurchaseOrderIdoc/submit',
		);
		assert.deepEqual(captured?.body?.context, {
			client: 'n8n-sap-idoc-guard',
			direction: 'outbound',
			write: true,
			confirmation: 'SEND submitPurchaseOrderIdoc PO-1-v1',
		});
		assert.equal(JSON.stringify(captured).toLowerCase().includes('sap_password'), false);
	});

	it('uses fixed status, inbox, and acknowledgement routes', async () => {
		const captured: IdocGuardRequestOptions[] = [];
		const request = async (options: IdocGuardRequestOptions) => {
			captured.push(options);
			return { data: {} };
		};
		await getIdocStatus(credentials, request, '0000000000001234', 'trace-2');
		await listInboundIdocs(credentials, request, 5, '10', 'trace-3');
		await getInboundIdoc(credentials, request, 'inbound-001', 'trace-payload');
		await acknowledgeInboundIdoc(
			credentials,
			request,
			'inbound-001',
			'accepted',
			'',
			'trace-4',
			'ACK inbound-001 accepted',
		);
		assert.equal(captured[0].url.endsWith('/v1/status/0000000000001234'), true);
		assert.equal(captured[1].url.endsWith('/v1/inbound?limit=5&cursor=10'), true);
		assert.equal(captured[2].url.endsWith('/v1/inbound/inbound-001/document'), true);
		assert.equal(captured[3].url.endsWith('/v1/inbound/inbound-001/ack'), true);
	});

	it('redacts the API token from transport errors', async () => {
		await assert.rejects(
			() =>
				testSidecarConnection(
					credentials,
					async () => {
						throw new Error(`Rejected token ${credentials.apiToken}`);
					},
					'trace-1',
				),
			(error: Error) =>
				error.message.includes('[REDACTED]') && !error.message.includes(credentials.apiToken),
		);
	});
});

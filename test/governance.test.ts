import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	assertAcknowledgementConfirmation,
	assertIdempotencyKey,
	assertOperationAllowed,
	assertOperationId,
	assertOutboundConfirmation,
	assertXmlMatchesPolicy,
	assertXmlPayload,
	normalizeBaseUrl,
	parseAllowedOperations,
	parseOperationPolicies,
	policyForOperation,
	validateGovernanceConfiguration,
} from '../nodes/SapIdocGuard/governance';
import type { SapIdocGuardCredentials } from '../nodes/SapIdocGuard/types';

const policyJson = JSON.stringify({
	submitPurchaseOrderIdoc: {
		direction: 'outbound',
		messageType: 'ORDERS',
		basicType: 'ORDERS05',
		allowedSegments: ['EDI_DC40', 'E1EDK01', 'E1EDP01'],
		maxSegments: 50,
		outputFields: ['requestId', 'docnum', 'status'],
	},
	getIdocStatus: {
		direction: 'status',
		outputFields: ['docnum', 'status', 'statusHistory'],
	},
	listInboundIdocs: {
		direction: 'inbound-read',
		outputFields: ['receiptId', 'docnum', 'status'],
	},
	getInboundIdoc: {
		direction: 'inbound-payload',
		outputFields: ['receiptId', 'idocXml'],
	},
	acknowledgeInboundIdoc: {
		direction: 'inbound-ack',
		outputFields: ['receiptId', 'outcome', 'status'],
	},
});

const credentials: SapIdocGuardCredentials = {
	baseUrl: 'https://idoc.example.com',
	apiToken: 'test-'.repeat(8),
	allowedOperations:
		'submitPurchaseOrderIdoc, getIdocStatus, listInboundIdocs, getInboundIdoc, acknowledgeInboundIdoc',
	operationPoliciesJson: policyJson,
	allowOutboundSubmission: true,
	allowInboundAcknowledgement: true,
	allowInboundPayloadRead: true,
	rejectUnauthorized: true,
	maxDocuments: 10,
	maxSegments: 500,
	maxRequestBytes: 262144,
	maxResponseBytes: 524288,
	connectionTimeout: 15000,
	requestTimeout: 60000,
};

const validXml =
	'<ORDERS05><IDOC BEGIN="1"><EDI_DC40 SEGMENT="1"><MESTYP>ORDERS</MESTYP><IDOCTYP>ORDERS05</IDOCTYP></EDI_DC40><E1EDK01 SEGMENT="1"><BELNR>4500001</BELNR></E1EDK01><E1EDP01 SEGMENT="1"><POSEX>000010</POSEX></E1EDP01></IDOC></ORDERS05>';

describe('operation and credential governance', () => {
	it('accepts business aliases and rejects technical names', () => {
		assert.equal(assertOperationId('submitPurchaseOrderIdoc'), 'submitPurchaseOrderIdoc');
		assert.throws(() => assertOperationId('IDOC_INBOUND_ASYNCHRONOUS'), /business alias/);
		assert.throws(() => assertOperationId('Z_SEND_IDOC'), /business alias/);
	});

	it('denies an operation outside the credential allowlist', () => {
		const allowed = parseAllowedOperations(credentials.allowedOperations);
		assert.doesNotThrow(() => assertOperationAllowed('getIdocStatus', allowed));
		assert.throws(() => assertOperationAllowed('submitInvoiceIdoc', allowed), /not allowed/);
	});

	it('requires explicit write opt-ins and complete matching policies', () => {
		assert.doesNotThrow(() => validateGovernanceConfiguration(credentials));
		assert.throws(
			() =>
				validateGovernanceConfiguration({
					...credentials,
					allowInboundPayloadRead: false,
				}),
			/Inbound payload policy.*explicit credential opt-in/,
		);
		assert.throws(
			() => validateGovernanceConfiguration({ ...credentials, allowOutboundSubmission: false }),
			/explicit credential opt-in/,
		);
		assert.throws(
			() =>
				validateGovernanceConfiguration({
					...credentials,
					allowedOperations: 'getIdocStatus',
				}),
			/not present in Allowed Operations/,
		);
	});

	it('loads exact message contracts and output projections', () => {
		const policies = parseOperationPolicies(policyJson);
		const policy = policyForOperation('submitPurchaseOrderIdoc', policies);
		assert.equal(policy.messageType, 'ORDERS');
		assert.equal(policy.basicType, 'ORDERS05');
		assert.deepEqual(policy.outputFields, ['requestId', 'docnum', 'status']);
	});
});

describe('outbound IDoc validation', () => {
	it('validates XML against message type, basic type, extension, and segments', () => {
		const policy = policyForOperation(
			'submitPurchaseOrderIdoc',
			parseOperationPolicies(policyJson),
		);
		assert.doesNotThrow(() => assertXmlMatchesPolicy(assertXmlPayload(validXml), policy, 500));
		assert.throws(
			() =>
				assertXmlMatchesPolicy(
					validXml.replace('<IDOCTYP>ORDERS05</IDOCTYP>', '<IDOCTYP>INVOIC02</IDOCTYP>'),
					policy,
					500,
				),
			/must declare/,
		);
		assert.throws(
			() =>
				assertXmlMatchesPolicy(
					validXml.replace('<ORDERS05>', '<IDOCS>').replace('</ORDERS05>', '</IDOCS>'),
					policy,
					500,
				),
			/root element must be ORDERS05/,
		);
		assert.throws(
			() => assertXmlMatchesPolicy(validXml.replace('</E1EDK01>', '<ZSECRET SEGMENT="1">1</ZSECRET></E1EDK01>'), policy, 500),
			/not allowed/,
		);
	});

	it('blocks XML external entities', () => {
		assert.throws(
			() => assertXmlPayload(`<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]>${validXml}`),
			/DOCTYPE or ENTITY/,
		);
	});

	it('requires target-bound confirmations and safe idempotency keys', () => {
		assert.equal(assertIdempotencyKey('PO-4500001-v1'), 'PO-4500001-v1');
		assert.doesNotThrow(() =>
			assertOutboundConfirmation(
				'submitPurchaseOrderIdoc',
				'PO-4500001-v1',
				'SEND submitPurchaseOrderIdoc PO-4500001-v1',
			),
		);
		assert.throws(
			() =>
				assertOutboundConfirmation(
					'submitPurchaseOrderIdoc',
					'PO-4500001-v1',
					'SEND submitInvoiceIdoc PO-4500001-v1',
				),
			/must be exactly/,
		);
		assert.doesNotThrow(() =>
			assertAcknowledgementConfirmation(
				'inbound-001',
				'accepted',
				'ACK inbound-001 accepted',
			),
		);
	});
});

describe('connection validation', () => {
	it('requires HTTPS except for an explicitly isolated fixture', () => {
		assert.equal(normalizeBaseUrl('https://idoc.example.com/'), 'https://idoc.example.com');
		assert.throws(() => normalizeBaseUrl('http://idoc.example.com'), /must use HTTPS/);
		assert.equal(
			normalizeBaseUrl('http://127.0.0.1:8080', true),
			'http://127.0.0.1:8080',
		);
	});
});

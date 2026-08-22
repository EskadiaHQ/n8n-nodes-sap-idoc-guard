import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { assertAiToolAllowed } from '../nodes/SapIdocGuard/toolPolicy';
import type { SapIdocGuardCredentials } from '../nodes/SapIdocGuard/types';

const credentials = {
	baseUrl: 'https://idoc.example.com',
	apiToken: 'test-'.repeat(8),
	allowedOperations: 'getIdocStatus',
	operationPoliciesJson:
		'{"getIdocStatus":{"direction":"status","outputFields":["docnum","status"]}}',
	connectionTimeout: 15000,
	requestTimeout: 60000,
	maxDocuments: 10,
	maxSegments: 500,
	maxRequestBytes: 262144,
	maxResponseBytes: 524288,
} satisfies SapIdocGuardCredentials;

describe('AI tool policy', () => {
	it('allows every direction on the normal workflow node', () => {
		assert.doesNotThrow(() =>
			assertAiToolAllowed(
				'n8n-nodes-sap-idoc-guard.sapIdocGuard',
				'outbound',
				credentials,
			),
		);
	});

	it('requires opt-in and permits only read directions for the Tool variant', () => {
		assert.throws(
			() =>
				assertAiToolAllowed(
					'n8n-nodes-sap-idoc-guard.sapIdocGuardTool',
					'status',
					credentials,
				),
			/does not allow/,
		);
		const optedIn = { ...credentials, allowAiTool: true };
		assert.doesNotThrow(() =>
			assertAiToolAllowed(
				'n8n-nodes-sap-idoc-guard.sapIdocGuardTool',
				'inbound-read',
				optedIn,
			),
		);
		assert.throws(
			() =>
				assertAiToolAllowed(
					'n8n-nodes-sap-idoc-guard.sapIdocGuardTool',
					'outbound',
					optedIn,
				),
			/read-only/,
		);
		assert.throws(
			() =>
				assertAiToolAllowed(
					'n8n-nodes-sap-idoc-guard.sapIdocGuardTool',
					'inbound-payload',
					optedIn,
				),
			/minimized reads/,
		);
		assert.throws(
			() =>
				assertAiToolAllowed(
					'n8n-nodes-sap-idoc-guard.sapIdocGuardTool',
					'inbound-ack',
					optedIn,
				),
			/read-only/,
		);
	});
});

import { OperationalError } from 'n8n-workflow';

import type { IdocDirection, SapIdocGuardCredentials } from './types';

const TOOL_NODE_TYPE = 'n8n-nodes-sap-idoc-guard.sapIdocGuardTool';

export function assertAiToolAllowed(
	nodeType: string,
	direction: IdocDirection,
	credentials: SapIdocGuardCredentials,
): void {
	if (nodeType !== TOOL_NODE_TYPE) return;
	if (credentials.allowAiTool !== true) {
		throw new OperationalError(
			'This credential does not allow SAP IDoc Guard to be used as an AI tool.',
		);
	}
	if (
		direction === 'outbound' ||
		direction === 'inbound-ack' ||
		direction === 'inbound-payload'
	) {
		throw new OperationalError(
			'SAP IDoc Guard AI tools are read-only and expose only minimized reads; submission, payload retrieval, and acknowledgement are blocked.',
		);
	}
}

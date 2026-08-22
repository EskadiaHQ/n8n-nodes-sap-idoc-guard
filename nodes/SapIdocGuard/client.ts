import { OperationalError } from 'n8n-workflow';

import { normalizeBaseUrl } from './governance';
import type {
	IdocGuardHttpRequest,
	IdocGuardRequestOptions,
	SapIdocGuardCredentials,
} from './types';

function redactError(error: unknown, credentials: SapIdocGuardCredentials): Error {
	const original = error instanceof Error ? error.message : String(error);
	const redacted = [credentials.apiToken]
		.filter(Boolean)
		.reduce((message, secret) => message.split(secret).join('[REDACTED]'), original);
	return new Error(`SAP IDoc sidecar request failed: ${redacted}`);
}

function requestOptions(
	credentials: SapIdocGuardCredentials,
	method: 'GET' | 'POST',
	path: string,
	correlationId: string,
	body?: Record<string, unknown>,
): IdocGuardRequestOptions {
	const baseUrl = normalizeBaseUrl(credentials.baseUrl, credentials.allowInsecureHttp === true);
	return {
		method,
		url: `${baseUrl}${path}`,
		headers: {
			Accept: 'application/json',
			Authorization: `Bearer ${credentials.apiToken}`,
			'Content-Type': 'application/json',
			'X-Correlation-ID': correlationId,
			'X-IDoc-Guard-Mode': 'governed',
		},
		...(body ? { body } : {}),
		json: true,
		timeout:
			method === 'GET'
				? Number(credentials.connectionTimeout)
				: Number(credentials.requestTimeout),
		skipSslCertificateValidation: credentials.rejectUnauthorized === false,
	};
}

async function performRequest(
	httpRequest: IdocGuardHttpRequest,
	options: IdocGuardRequestOptions,
	credentials: SapIdocGuardCredentials,
): Promise<unknown> {
	try {
		return await httpRequest(options);
	} catch (error) {
		// Converted to NodeOperationError at the execute boundary, which has node context.
		// eslint-disable-next-line @n8n/community-nodes/require-node-api-error
		throw new OperationalError(redactError(error, credentials).message);
	}
}

export async function testSidecarConnection(
	credentials: SapIdocGuardCredentials,
	httpRequest: IdocGuardHttpRequest,
	correlationId: string,
): Promise<unknown> {
	return await performRequest(
		httpRequest,
		requestOptions(credentials, 'GET', '/v1/health', correlationId),
		credentials,
	);
}

export async function submitApprovedIdoc(
	credentials: SapIdocGuardCredentials,
	httpRequest: IdocGuardHttpRequest,
	operation: string,
	idocXml: string,
	idempotencyKey: string,
	correlationId: string,
	confirmation: string,
): Promise<unknown> {
	return await performRequest(
		httpRequest,
		requestOptions(
			credentials,
			'POST',
			`/v1/outbound/${encodeURIComponent(operation)}/submit`,
			correlationId,
			{
				operation,
				idocXml,
				idempotencyKey,
				context: {
					client: 'n8n-sap-idoc-guard',
					direction: 'outbound',
					write: true,
					confirmation,
				},
			},
		),
		credentials,
	);
}

export async function getIdocStatus(
	credentials: SapIdocGuardCredentials,
	httpRequest: IdocGuardHttpRequest,
	reference: string,
	correlationId: string,
): Promise<unknown> {
	return await performRequest(
		httpRequest,
		requestOptions(
			credentials,
			'GET',
			`/v1/status/${encodeURIComponent(reference)}`,
			correlationId,
		),
		credentials,
	);
}

export async function listInboundIdocs(
	credentials: SapIdocGuardCredentials,
	httpRequest: IdocGuardHttpRequest,
	limit: number,
	cursor: string,
	correlationId: string,
): Promise<unknown> {
	const query = new URLSearchParams({ limit: String(limit) });
	if (cursor !== '') query.set('cursor', cursor);
	return await performRequest(
		httpRequest,
		requestOptions(credentials, 'GET', `/v1/inbound?${query.toString()}`, correlationId),
		credentials,
	);
}

export async function getInboundIdoc(
	credentials: SapIdocGuardCredentials,
	httpRequest: IdocGuardHttpRequest,
	receiptId: string,
	correlationId: string,
): Promise<unknown> {
	return await performRequest(
		httpRequest,
		requestOptions(
			credentials,
			'GET',
			`/v1/inbound/${encodeURIComponent(receiptId)}/document`,
			correlationId,
		),
		credentials,
	);
}

export async function acknowledgeInboundIdoc(
	credentials: SapIdocGuardCredentials,
	httpRequest: IdocGuardHttpRequest,
	receiptId: string,
	outcome: string,
	reason: string,
	correlationId: string,
	confirmation: string,
): Promise<unknown> {
	return await performRequest(
		httpRequest,
		requestOptions(
			credentials,
			'POST',
			`/v1/inbound/${encodeURIComponent(receiptId)}/ack`,
			correlationId,
			{
				operation: 'acknowledgeInboundIdoc',
				receiptId,
				outcome,
				reason,
				context: {
					client: 'n8n-sap-idoc-guard',
					direction: 'inbound-ack',
					write: true,
					confirmation,
				},
			},
		),
		credentials,
	);
}

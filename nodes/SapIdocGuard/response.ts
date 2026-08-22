import { OperationalError } from 'n8n-workflow';

import type { IdocDirection } from './types';

function asRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new OperationalError(`${label} must be a JSON object.`);
	}
	return value as Record<string, unknown>;
}

function projectRecord(
	record: Record<string, unknown>,
	allowedFields: string[],
): Record<string, unknown> {
	const projected: Record<string, unknown> = {};
	for (const field of allowedFields) {
		if (Object.prototype.hasOwnProperty.call(record, field)) projected[field] = record[field];
	}
	return projected;
}

function safeBackend(value: unknown): Record<string, string> | undefined {
	if (value === undefined) return undefined;
	const backend = asRecord(value, 'Sidecar backend');
	const systemId = String(backend.systemId ?? '');
	const client = String(backend.client ?? '');
	const release = String(backend.release ?? '');
	if (!/^[A-Za-z0-9_-]{1,16}$/.test(systemId)) {
		throw new OperationalError('Sidecar backend system ID is invalid.');
	}
	if (!/^[0-9]{3}$/.test(client)) {
		throw new OperationalError('Sidecar backend client is invalid.');
	}
	if (!/^[A-Za-z0-9._-]{1,32}$/.test(release)) {
		throw new OperationalError('Sidecar backend release is invalid.');
	}
	return { systemId, client, release };
}

function assertEvidence(
	response: Record<string, unknown>,
	direction: IdocDirection,
	write: boolean,
	correlationId: string,
): Record<string, unknown> {
	const meta = asRecord(response.meta, 'Sidecar response meta');
	if (meta.direction !== direction) {
		throw new OperationalError('Sidecar response direction does not match the requested operation.');
	}
	if (write) {
		if (meta.write !== true || meta.readOnly !== false) {
			throw new OperationalError('Sidecar response did not attest write=true and readOnly=false.');
		}
	} else if (meta.readOnly !== true || meta.write === true) {
		throw new OperationalError('Sidecar response did not attest readOnly=true.');
	}
	if (
		response.correlationId !== undefined &&
		String(response.correlationId) !== correlationId
	) {
		throw new OperationalError('Sidecar response correlation ID does not match the request.');
	}
	return meta;
}

function evidenceMetadata(
	meta: Record<string, unknown>,
	operation: string,
	correlationId: string,
	direction: IdocDirection,
): Record<string, unknown> {
	const backend = safeBackend(meta.backend);
	return {
		operation,
		correlationId,
		direction,
		readOnly: meta.readOnly === true,
		write: meta.write === true,
		...(typeof meta.source === 'string' ? { source: meta.source } : {}),
		...(typeof meta.syntheticData === 'boolean'
			? { syntheticData: meta.syntheticData }
			: {}),
		...(typeof meta.durationMs === 'number' ? { durationMs: meta.durationMs } : {}),
		...(backend ? { backend } : {}),
	};
}

export function sanitizeHealthResponse(value: unknown): Record<string, unknown> {
	const response = asRecord(value, 'Sidecar health response');
	const capabilities = asRecord(response.capabilities, 'Sidecar capabilities');
	if (capabilities.idoc !== true || capabilities.governed !== true) {
		throw new OperationalError('The configured sidecar does not advertise governed IDoc capability.');
	}
	const operations = Array.isArray(capabilities.operations)
		? capabilities.operations
				.map(String)
				.filter((operation) => /^[a-z][a-zA-Z0-9.-]{0,63}$/.test(operation))
		: [];
	const backend = safeBackend(response.backend);
	return {
		connected: response.status === 'ok' || response.status === 'healthy',
		status: String(response.status ?? 'unknown'),
		service: String(response.service ?? 'sap-idoc-guard-sidecar'),
		version: String(response.version ?? 'unknown'),
		idoc: true,
		governed: true,
		outbound: capabilities.outbound === true,
		statusRead: capabilities.statusRead === true,
		inboundPull: capabilities.inboundPull === true,
		inboundPayloadRead: capabilities.inboundPayloadRead === true,
		inboundAck: capabilities.inboundAck === true,
		operations,
		...(backend ? { backend } : {}),
	};
}

export function sanitizeSubmissionResponse(
	value: unknown,
	operation: string,
	correlationId: string,
	idempotencyKey: string,
	allowedFields: string[],
): Record<string, unknown> {
	const response = asRecord(value, 'Sidecar submission response');
	const meta = assertEvidence(response, 'outbound', true, correlationId);
	if (response.operation !== operation) {
		throw new OperationalError('Sidecar response operation does not match the request.');
	}
	const data = asRecord(response.data, 'Sidecar submission data');
	if (
		data.idempotencyKey !== undefined &&
		String(data.idempotencyKey) !== idempotencyKey
	) {
		throw new OperationalError('Sidecar response idempotency key does not match the request.');
	}
	return {
		...projectRecord(data, allowedFields),
		_idoc: evidenceMetadata(meta, operation, correlationId, 'outbound'),
	};
}

export function sanitizeStatusResponse(
	value: unknown,
	correlationId: string,
	allowedFields: string[],
): Record<string, unknown> {
	const response = asRecord(value, 'Sidecar status response');
	const meta = assertEvidence(response, 'status', false, correlationId);
	const operation = String(response.operation ?? 'getIdocStatus');
	return {
		...projectRecord(asRecord(response.data, 'Sidecar status data'), allowedFields),
		_idoc: evidenceMetadata(meta, operation, correlationId, 'status'),
	};
}

export function sanitizeInboundListResponse(
	value: unknown,
	correlationId: string,
	allowedFields: string[],
	limit: number,
): Record<string, unknown>[] {
	const response = asRecord(value, 'Sidecar inbound response');
	const meta = assertEvidence(response, 'inbound-read', false, correlationId);
	if (!Array.isArray(response.data)) {
		throw new OperationalError('Sidecar inbound data must be an array.');
	}
	const rawRows = response.data.map((row, index) =>
		asRecord(row, `Sidecar inbound row ${index}`),
	);
	const rows = rawRows.slice(0, limit).map((row) => projectRecord(row, allowedFields));
	const metadata = {
		...evidenceMetadata(meta, 'listInboundIdocs', correlationId, 'inbound-read'),
		rowCount: rows.length,
		truncated: rawRows.length > limit,
		...(typeof response.nextCursor === 'string' ? { nextCursor: response.nextCursor } : {}),
	};
	if (rows.length === 0) return [{ _idoc: metadata }];
	return rows.map((row, index) => (index === 0 ? { ...row, _idoc: metadata } : row));
}

export function sanitizeInboundDocumentResponse(
	value: unknown,
	correlationId: string,
	receiptId: string,
	allowedFields: string[],
): Record<string, unknown> {
	const response = asRecord(value, 'Sidecar inbound document response');
	const meta = assertEvidence(response, 'inbound-payload', false, correlationId);
	const data = asRecord(response.data, 'Sidecar inbound document data');
	if (data.receiptId !== undefined && String(data.receiptId) !== receiptId) {
		throw new OperationalError('Sidecar inbound document receipt ID does not match the request.');
	}
	return {
		...projectRecord(data, allowedFields),
		_idoc: evidenceMetadata(meta, 'getInboundIdoc', correlationId, 'inbound-payload'),
	};
}

export function sanitizeAcknowledgementResponse(
	value: unknown,
	correlationId: string,
	receiptId: string,
	allowedFields: string[],
): Record<string, unknown> {
	const response = asRecord(value, 'Sidecar acknowledgement response');
	const meta = assertEvidence(response, 'inbound-ack', true, correlationId);
	const data = asRecord(response.data, 'Sidecar acknowledgement data');
	if (data.receiptId !== undefined && String(data.receiptId) !== receiptId) {
		throw new OperationalError('Sidecar response receipt ID does not match the request.');
	}
	return {
		...projectRecord(data, allowedFields),
		_idoc: evidenceMetadata(
			meta,
			'acknowledgeInboundIdoc',
			correlationId,
			'inbound-ack',
		),
	};
}

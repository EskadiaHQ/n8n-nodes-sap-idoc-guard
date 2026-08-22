import { createHash } from 'node:crypto';

import { OperationalError } from 'n8n-workflow';

import type {
	IdocDirection,
	IdocOperationPolicy,
	SapIdocGuardCredentials,
} from './types';

const OPERATION_ID = /^[a-z][a-zA-Z0-9.-]{0,63}$/;
const OUTPUT_FIELD = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const IDOC_NAME = /^[A-Z][A-Z0-9_]{0,29}$/;
const SEGMENT_NAME = /^[A-Z][A-Z0-9_]{0,29}$/;
const REFERENCE = /^[A-Za-z0-9._:/-]{1,128}$/;
const DIRECTIONS = new Set<IdocDirection>([
	'outbound',
	'status',
	'inbound-read',
	'inbound-payload',
	'inbound-ack',
]);

export const STATUS_OPERATION = 'getIdocStatus';
export const INBOUND_LIST_OPERATION = 'listInboundIdocs';
export const INBOUND_DOCUMENT_OPERATION = 'getInboundIdoc';
export const INBOUND_ACK_OPERATION = 'acknowledgeInboundIdoc';

export function assertOperationId(value: string): string {
	const operation = String(value ?? '').trim();
	if (/^(RFC|BAPI|IDOC_|Z_|Y_)/i.test(operation) || !OPERATION_ID.test(operation)) {
		throw new OperationalError(
			'Operation ID must be a governed lower-camel-case business alias, not a technical RFC, IDoc, Z, or Y name.',
		);
	}
	return operation;
}

export function parseAllowedOperations(value: string): Set<string> {
	const entries = String(value ?? '')
		.split(/[\s,]+/)
		.map((entry) => entry.trim())
		.filter(Boolean);
	if (entries.length === 0) {
		throw new OperationalError('Allowed Operations must contain at least one business alias.');
	}
	const operations = new Set<string>();
	for (const entry of entries) {
		const operation = assertOperationId(entry);
		if (operations.has(operation)) {
			throw new OperationalError(`Allowed Operations contains the duplicate ${operation}.`);
		}
		operations.add(operation);
	}
	return operations;
}

function parseStringArray(value: unknown, label: string, pattern: RegExp): string[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new OperationalError(`${label} must be a non-empty array.`);
	}
	const normalized: string[] = [];
	for (const entry of value) {
		if (typeof entry !== 'string' || !pattern.test(entry)) {
			throw new OperationalError(`${label} contains an invalid value.`);
		}
		if (!normalized.includes(entry)) normalized.push(entry);
	}
	return normalized;
}

function optionalIdocName(value: unknown, label: string): string | undefined {
	if (value === undefined || value === '') return undefined;
	if (typeof value !== 'string' || !IDOC_NAME.test(value)) {
		throw new OperationalError(`${label} must be an uppercase SAP technical name.`);
	}
	return value;
}

function integerRange(
	value: unknown,
	label: string,
	minimum: number,
	maximum: number,
): number {
	const numeric = Number(value);
	if (!Number.isInteger(numeric) || numeric < minimum || numeric > maximum) {
		throw new OperationalError(`${label} must be an integer between ${minimum} and ${maximum}.`);
	}
	return numeric;
}

export function parseOperationPolicies(value: string): Map<string, IdocOperationPolicy> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(String(value ?? '').trim() || '{}');
	} catch {
		// Converted to NodeOperationError at the execute boundary, which has node context.
		// eslint-disable-next-line @n8n/community-nodes/require-node-api-error
		throw new OperationalError('Operation Policies JSON must be valid JSON.');
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new OperationalError('Operation Policies JSON must be an operation-to-policy object.');
	}
	const policies = new Map<string, IdocOperationPolicy>();
	for (const [rawOperation, rawPolicy] of Object.entries(parsed)) {
		const operation = assertOperationId(rawOperation);
		if (!rawPolicy || typeof rawPolicy !== 'object' || Array.isArray(rawPolicy)) {
			throw new OperationalError(`Policy ${operation} must be an object.`);
		}
		const policy = rawPolicy as Record<string, unknown>;
		const direction = policy.direction as IdocDirection;
		if (!DIRECTIONS.has(direction)) {
			throw new OperationalError(`Policy ${operation} has an invalid direction.`);
		}
		const outputFields = parseStringArray(
			policy.outputFields,
			`Policy ${operation} outputFields`,
			OUTPUT_FIELD,
		);
		const normalized: IdocOperationPolicy = { direction, outputFields };
		if (direction === 'outbound') {
			normalized.messageType = optionalIdocName(
				policy.messageType,
				`Policy ${operation} messageType`,
			);
			normalized.basicType = optionalIdocName(
				policy.basicType,
				`Policy ${operation} basicType`,
			);
			if (!normalized.messageType || !normalized.basicType) {
				throw new OperationalError(
					`Outbound policy ${operation} requires messageType and basicType.`,
				);
			}
			normalized.extension = optionalIdocName(
				policy.extension,
				`Policy ${operation} extension`,
			);
			normalized.allowedSegments = parseStringArray(
				policy.allowedSegments,
				`Policy ${operation} allowedSegments`,
				SEGMENT_NAME,
			);
			normalized.maxSegments = integerRange(
				policy.maxSegments,
				`Policy ${operation} maxSegments`,
				1,
				10000,
			);
		}
		policies.set(operation, normalized);
	}
	return policies;
}

export function policyForOperation(
	operation: string,
	policies: Map<string, IdocOperationPolicy>,
): IdocOperationPolicy {
	const policy = policies.get(operation);
	if (!policy) throw new OperationalError(`No operation policy is configured for ${operation}.`);
	return policy;
}

export function assertOperationAllowed(operation: string, allowed: Set<string>): void {
	if (!allowed.has(operation)) {
		throw new OperationalError(`Operation ${operation} is not allowed by these credentials.`);
	}
}

export function normalizeBaseUrl(value: string, allowInsecureHttp = false): string {
	let url: URL;
	try {
		url = new URL(String(value ?? '').trim());
	} catch {
		// Converted to NodeOperationError at the execute boundary, which has node context.
		// eslint-disable-next-line @n8n/community-nodes/require-node-api-error
		throw new OperationalError('Sidecar Base URL must be a valid absolute URL.');
	}
	if (url.username || url.password || url.search || url.hash) {
		throw new OperationalError(
			'Sidecar Base URL cannot contain credentials, query parameters, or a fragment.',
		);
	}
	if (url.protocol !== 'https:' && !(allowInsecureHttp && url.protocol === 'http:')) {
		throw new OperationalError('Sidecar Base URL must use HTTPS.');
	}
	url.pathname = url.pathname.replace(/\/+$/, '');
	return url.toString().replace(/\/$/, '');
}

export function validateGovernanceConfiguration(credentials: SapIdocGuardCredentials): void {
	normalizeBaseUrl(credentials.baseUrl, credentials.allowInsecureHttp === true);
	if (Buffer.byteLength(String(credentials.apiToken ?? ''), 'utf8') < 32) {
		throw new OperationalError('API Token must contain at least 32 bytes.');
	}
	const allowed = parseAllowedOperations(credentials.allowedOperations);
	const policies = parseOperationPolicies(credentials.operationPoliciesJson);
	for (const operation of allowed) policyForOperation(operation, policies);
	for (const operation of policies.keys()) {
		if (!allowed.has(operation)) {
			throw new OperationalError(`Policy ${operation} is not present in Allowed Operations.`);
		}
	}
	for (const [operation, policy] of policies) {
		if (policy.direction === 'outbound' && credentials.allowOutboundSubmission !== true) {
			throw new OperationalError(
				`Outbound policy ${operation} requires explicit credential opt-in.`,
			);
		}
		if (policy.direction === 'inbound-ack' && credentials.allowInboundAcknowledgement !== true) {
			throw new OperationalError(
				`Inbound acknowledgement policy ${operation} requires explicit credential opt-in.`,
			);
		}
		if (policy.direction === 'inbound-payload' && credentials.allowInboundPayloadRead !== true) {
			throw new OperationalError(
				`Inbound payload policy ${operation} requires explicit credential opt-in.`,
			);
		}
		if (
			policy.direction === 'outbound' &&
			Number(policy.maxSegments) > Number(credentials.maxSegments)
		) {
			throw new OperationalError(
				`Policy ${operation} maxSegments exceeds the credential-level maximum.`,
			);
		}
	}
	integerRange(credentials.maxDocuments, 'Maximum Documents', 1, 100);
	integerRange(credentials.maxSegments, 'Maximum Segments', 1, 10000);
	integerRange(credentials.maxRequestBytes, 'Maximum Request Size', 1024, 5242880);
	integerRange(credentials.maxResponseBytes, 'Maximum Response Size', 1024, 10485760);
	integerRange(credentials.connectionTimeout, 'Connection Timeout', 1000, 120000);
	integerRange(credentials.requestTimeout, 'Operation Timeout', 1000, 300000);
}

export function assertReference(value: string, label: string): string {
	const normalized = String(value ?? '').trim();
	if (!REFERENCE.test(normalized)) {
		throw new OperationalError(
			`${label} may contain only letters, numbers, dots, underscores, colons, slashes, or hyphens.`,
		);
	}
	return normalized;
}

export function assertCorrelationId(value: string): string {
	return assertReference(value, 'Correlation ID');
}

export function assertIdempotencyKey(value: string): string {
	return assertReference(value, 'Idempotency Key');
}

export function assertOutboundConfirmation(
	operation: string,
	idempotencyKey: string,
	confirmation: string,
): void {
	const expected = `SEND ${operation} ${idempotencyKey}`;
	if (confirmation.trim() !== expected) {
		throw new OperationalError(`Confirmation must be exactly ${expected}.`);
	}
}

export function assertAcknowledgementConfirmation(
	receiptId: string,
	outcome: string,
	confirmation: string,
): void {
	const expected = `ACK ${receiptId} ${outcome}`;
	if (confirmation.trim() !== expected) {
		throw new OperationalError(`Confirmation must be exactly ${expected}.`);
	}
}

export function assertXmlPayload(value: string): string {
	const xml = String(value ?? '').trim();
	if (!xml.startsWith('<') || !xml.endsWith('>')) {
		throw new OperationalError('IDoc XML must be a non-empty XML document.');
	}
	if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
		throw new OperationalError('IDoc XML cannot contain a DOCTYPE or ENTITY declaration.');
	}
	return xml;
}

function firstXmlValue(xml: string, tag: string): string | undefined {
	const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, 'i').exec(xml);
	return match?.[1]?.trim().toUpperCase();
}

export function assertXmlMatchesPolicy(
	xml: string,
	policy: IdocOperationPolicy,
	credentialMaxSegments: number,
): void {
	if (policy.direction !== 'outbound') {
		throw new OperationalError('Only an outbound operation policy can validate IDoc XML.');
	}
	const messageType = firstXmlValue(xml, 'MESTYP');
	const basicType = firstXmlValue(xml, 'IDOCTYP');
	const extension = firstXmlValue(xml, 'CIMTYP') ?? '';
	if (messageType !== policy.messageType || basicType !== policy.basicType) {
		throw new OperationalError(
			`IDoc XML must declare MESTYP=${policy.messageType} and IDOCTYP=${policy.basicType}.`,
		);
	}
	const root = /^(?:<\?xml\s[^>]*>\s*)?<([A-Z][A-Z0-9_]{0,29})(?:\s[^>]*)?>/i
		.exec(xml)?.[1]?.toUpperCase();
	if (root !== policy.basicType) {
		throw new OperationalError(`IDoc XML root element must be ${policy.basicType}.`);
	}
	if ((policy.extension ?? '') !== extension) {
		throw new OperationalError(
			`IDoc XML extension does not match the configured ${policy.extension || 'empty'} policy.`,
		);
	}
	const allowed = new Set(policy.allowedSegments ?? []);
	const segments = [
		...xml.matchAll(/<([A-Z][A-Z0-9_]{0,29})(\s[^>]*)?>/g),
	]
		.filter((match) => match[1] === 'EDI_DC40' || /\bSEGMENT\s*=/i.test(match[2] ?? ''))
		.map((match) => match[1]);
	const maximum = Math.min(Number(policy.maxSegments), credentialMaxSegments);
	if (segments.length > maximum) {
		throw new OperationalError(
			`IDoc XML contains ${segments.length} segments and exceeds the ${maximum}-segment limit.`,
		);
	}
	for (const segment of segments) {
		if (!allowed.has(segment)) {
			throw new OperationalError(`IDoc XML contains segment ${segment}, which is not allowed.`);
		}
	}
}

export function enforceSerializedByteLimit(value: unknown, maximum: number, label: string): void {
	let serialized: string;
	try {
		serialized = JSON.stringify(value);
	} catch {
		// Converted to NodeOperationError at the execute boundary, which has node context.
		// eslint-disable-next-line @n8n/community-nodes/require-node-api-error
		throw new OperationalError(`${label} must be JSON serializable.`);
	}
	const bytes = Buffer.byteLength(serialized, 'utf8');
	if (bytes > maximum) {
		throw new OperationalError(`${label} is ${bytes} bytes and exceeds the ${maximum}-byte limit.`);
	}
}

export function fingerprint(value: unknown): string {
	return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

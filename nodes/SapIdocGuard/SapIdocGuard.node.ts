import { randomUUID } from 'node:crypto';

import {
	NodeConnectionTypes,
	NodeOperationError,
	OperationalError,
	type ICredentialDataDecryptedObject,
	type ICredentialTestFunctions,
	type ICredentialsDecrypted,
	type IDataObject,
	type IExecuteFunctions,
	type IHttpRequestOptions,
	type INodeCredentialTestResult,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
} from 'n8n-workflow';

import {
	acknowledgeInboundIdoc,
	getIdocStatus,
	getInboundIdoc,
	listInboundIdocs,
	submitApprovedIdoc,
	testSidecarConnection,
} from './client';
import {
	assertAcknowledgementConfirmation,
	assertCorrelationId,
	assertIdempotencyKey,
	assertOperationAllowed,
	assertOperationId,
	assertOutboundConfirmation,
	assertReference,
	assertXmlMatchesPolicy,
	assertXmlPayload,
	enforceSerializedByteLimit,
	INBOUND_ACK_OPERATION,
	INBOUND_DOCUMENT_OPERATION,
	INBOUND_LIST_OPERATION,
	parseAllowedOperations,
	parseOperationPolicies,
	policyForOperation,
	STATUS_OPERATION,
	validateGovernanceConfiguration,
} from './governance';
import {
	sanitizeAcknowledgementResponse,
	sanitizeHealthResponse,
	sanitizeInboundDocumentResponse,
	sanitizeInboundListResponse,
	sanitizeStatusResponse,
	sanitizeSubmissionResponse,
} from './response';
import { assertAiToolAllowed } from './toolPolicy';
import type {
	IdocGuardHttpRequest,
	IdocOperationPolicy,
	SapIdocGuardCredentials,
} from './types';

function httpRequestAdapter(
	request: (options: IHttpRequestOptions) => Promise<unknown>,
): IdocGuardHttpRequest {
	return async (options) => await request(options as IHttpRequestOptions);
}

function traceId(value: string): string {
	const normalized = value.trim();
	return normalized === '' ? randomUUID() : assertCorrelationId(normalized);
}

function assertPolicyDirection(policy: IdocOperationPolicy, expected: string): void {
	if (policy.direction !== expected) {
		throw new OperationalError(
			`Operation policy direction must be ${expected}, not ${policy.direction}.`,
		);
	}
}

export class SapIdocGuard implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Logali SAP IDoc Guard',
		name: 'sapIdocGuard',
		icon: {
			light: 'file:sapIdocGuard.svg',
			dark: 'file:sapIdocGuard.dark.svg',
		},
		group: ['input'],
		version: 1,
		subtitle: '={{$parameter["resource"] + ": " + $parameter["operation"]}}',
		description:
			'Submit and monitor governed SAP IDocs through an operated HTTPS sidecar with explicit policies and idempotency',
		usableAsTool: {
			replacements: {
				description:
					'Read the status or governed inbound inbox of SAP IDocs. Submission and acknowledgement remain blocked for AI tools.',
			},
		},
		defaults: { name: 'Logali SAP IDoc Guard' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'sapIdocGuardApi',
				required: true,
				testedBy: 'sapIdocGuardConnectionTest',
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Connection', value: 'connection' },
					{ name: 'Inbound IDoc', value: 'inbound' },
					{ name: 'Outbound IDoc', value: 'outbound' },
					{ name: 'Status', value: 'status' },
				],
				default: 'connection',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['connection'] } },
				options: [
					{
						name: 'Test Connection',
						value: 'testConnection',
						action: 'Test the governed i doc sidecar connection',
					},
				],
				default: 'testConnection',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['outbound'] } },
				options: [
					{
						name: 'Submit Approved IDoc',
						value: 'submit',
						action: 'Submit one approved outbound i doc',
						description:
							'Validates the exact message/basic type, segments, confirmation, and idempotency key before the sidecar sends it',
					},
				],
				default: 'submit',
			},
			{
				displayName: 'Business Operation ID',
				name: 'businessOperationId',
				type: 'string',
				default: 'submitPurchaseOrderIdoc',
				placeholder: 'submitPurchaseOrderIdoc',
				description:
					'Credential-allowlisted business alias. It is not a message type, basic type, RFC function, port, or partner.',
				required: true,
				displayOptions: { show: { resource: ['outbound'], operation: ['submit'] } },
			},
			{
				displayName: 'IDoc XML',
				name: 'idocXml',
				type: 'string',
				typeOptions: { rows: 18 },
				default: '',
				description:
					'One IDoc XML document matching the exact server policy. DOCTYPE and ENTITY declarations are rejected.',
				required: true,
				displayOptions: { show: { resource: ['outbound'], operation: ['submit'] } },
			},
			{
				displayName: 'Idempotency Key',
				name: 'idempotencyKey',
				type: 'string',
				default: '',
				placeholder: 'PO-4500001234-v1',
				description:
					'Stable business key. Reusing it with the same payload returns the original receipt; changing the payload is rejected.',
				required: true,
				displayOptions: { show: { resource: ['outbound'], operation: ['submit'] } },
			},
			{
				displayName: 'Write Confirmation',
				name: 'writeConfirmation',
				type: 'string',
				default: '',
				placeholder: 'SEND submitPurchaseOrderIdoc PO-4500001234-v1',
				description:
					'Enter SEND followed by the exact operation alias and idempotency key',
				required: true,
				displayOptions: { show: { resource: ['outbound'], operation: ['submit'] } },
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['status'] } },
				options: [
					{
						name: 'Get Status',
						value: 'get',
						action: 'Get the governed status of an i doc',
					},
				],
				default: 'get',
			},
			{
				displayName: 'Reference',
				name: 'statusReference',
				type: 'string',
				default: '',
				placeholder: '0000000000001234 or request-ID',
				description: 'IDoc DOCNUM, request ID, or idempotency key recognized by the sidecar',
				required: true,
				displayOptions: { show: { resource: ['status'], operation: ['get'] } },
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['inbound'] } },
				options: [
					{
						name: 'Acknowledge',
						value: 'acknowledge',
						action: 'Acknowledge one governed inbound i doc',
					},
					{
						name: 'Get Document',
						value: 'getDocument',
						action: 'Get one governed inbound i doc document',
					},
					{
						name: 'Get Many Pending',
						value: 'getMany',
						action: 'List pending governed inbound i docs',
					},
				],
				default: 'getMany',
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				description: 'Max number of results to return',
				typeOptions: { minValue: 1, maxValue: 100 },
				default: 50,
				displayOptions: { show: { resource: ['inbound'], operation: ['getMany'] } },
			},
			{
				displayName: 'Cursor',
				name: 'cursor',
				type: 'string',
				default: '',
				description: 'Opaque cursor returned by the previous list operation',
				displayOptions: { show: { resource: ['inbound'], operation: ['getMany'] } },
			},
			{
				displayName: 'Receipt ID',
				name: 'receiptId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: { resource: ['inbound'], operation: ['acknowledge', 'getDocument'] },
				},
			},
			{
				displayName: 'Outcome',
				name: 'ackOutcome',
				type: 'options',
				options: [
					{ name: 'Accepted', value: 'accepted' },
					{ name: 'Rejected', value: 'rejected' },
					{ name: 'Retry', value: 'retry' },
				],
				default: 'accepted',
				displayOptions: { show: { resource: ['inbound'], operation: ['acknowledge'] } },
			},
			{
				displayName: 'Reason',
				name: 'ackReason',
				type: 'string',
				default: '',
				description: 'Required for rejected or retry outcomes; do not include secrets or payload data',
				displayOptions: { show: { resource: ['inbound'], operation: ['acknowledge'] } },
			},
			{
				displayName: 'Acknowledgement Confirmation',
				name: 'ackConfirmation',
				type: 'string',
				default: '',
				placeholder: 'ACK receipt-ID accepted',
				description: 'Enter ACK followed by the exact receipt ID and outcome',
				required: true,
				displayOptions: { show: { resource: ['inbound'], operation: ['acknowledge'] } },
			},
			{
				displayName: 'Correlation ID',
				name: 'correlationId',
				type: 'string',
				default: '',
				description: 'Trace identifier shared by n8n, the sidecar, and SAP logs',
			},
		],
	};

	methods = {
		credentialTest: {
			async sapIdocGuardConnectionTest(
				this: ICredentialTestFunctions,
				credential: ICredentialsDecrypted<ICredentialDataDecryptedObject>,
			): Promise<INodeCredentialTestResult> {
				try {
					const credentials = credential.data as unknown as SapIdocGuardCredentials;
					validateGovernanceConfiguration(credentials);
					const credentialHttpRequest: IdocGuardHttpRequest = async (options) =>
						// ICredentialTestFunctions in this n8n SDK exposes only the legacy request helper.
						// eslint-disable-next-line @n8n/community-nodes/no-deprecated-workflow-functions
						await this.helpers.request({
							method: options.method,
							uri: options.url,
							headers: options.headers,
							...(options.body ? { body: options.body } : {}),
							json: true,
							timeout: options.timeout,
							rejectUnauthorized: !options.skipSslCertificateValidation,
						});
					const result = await testSidecarConnection(
						credentials,
						credentialHttpRequest,
						randomUUID(),
					);
					sanitizeHealthResponse(result);
					return { status: 'OK', message: 'Governed SAP IDoc sidecar connection successful' };
				} catch (error) {
					return {
						status: 'Error',
						message: error instanceof Error ? error.message : String(error),
					};
				}
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const inputItems = this.getInputData();
		const outputItems: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < inputItems.length; itemIndex += 1) {
			try {
				const resource = this.getNodeParameter('resource', itemIndex) as string;
				const selectedOperation = this.getNodeParameter('operation', itemIndex) as string;
				const credentials = (await this.getCredentials(
					'sapIdocGuardApi',
					itemIndex,
				)) as unknown as SapIdocGuardCredentials;
				validateGovernanceConfiguration(credentials);
				const allowed = parseAllowedOperations(credentials.allowedOperations);
				const policies = parseOperationPolicies(credentials.operationPoliciesJson);
				const httpRequest = httpRequestAdapter(this.helpers.httpRequest);
				const correlationId = traceId(
					this.getNodeParameter('correlationId', itemIndex, '') as string,
				);

				if (resource === 'connection') {
					const response = await testSidecarConnection(credentials, httpRequest, correlationId);
					enforceSerializedByteLimit(
						response,
						Number(credentials.maxResponseBytes),
						'Sidecar response',
					);
					outputItems.push({
						json: sanitizeHealthResponse(response) as IDataObject,
						pairedItem: { item: itemIndex },
					});
					continue;
				}

				if (resource === 'outbound' && selectedOperation === 'submit') {
					if (credentials.allowOutboundSubmission !== true) {
						throw new OperationalError('The selected credential does not allow outbound submission.');
					}
					const operation = assertOperationId(
						this.getNodeParameter('businessOperationId', itemIndex) as string,
					);
					assertOperationAllowed(operation, allowed);
					const policy = policyForOperation(operation, policies);
					assertPolicyDirection(policy, 'outbound');
					assertAiToolAllowed(this.getNode().type, policy.direction, credentials);
					const idempotencyKey = assertIdempotencyKey(
						this.getNodeParameter('idempotencyKey', itemIndex) as string,
					);
					const confirmation = this.getNodeParameter(
						'writeConfirmation',
						itemIndex,
					) as string;
					assertOutboundConfirmation(operation, idempotencyKey, confirmation);
					const idocXml = assertXmlPayload(
						this.getNodeParameter('idocXml', itemIndex) as string,
					);
					assertXmlMatchesPolicy(idocXml, policy, Number(credentials.maxSegments));
					const request = { operation, idocXml, idempotencyKey, confirmation };
					enforceSerializedByteLimit(
						request,
						Number(credentials.maxRequestBytes),
						'IDoc submission request',
					);
					const response = await submitApprovedIdoc(
						credentials,
						httpRequest,
						operation,
						idocXml,
						idempotencyKey,
						correlationId,
						confirmation,
					);
					enforceSerializedByteLimit(
						response,
						Number(credentials.maxResponseBytes),
						'Sidecar response',
					);
					outputItems.push({
						json: sanitizeSubmissionResponse(
							response,
							operation,
							correlationId,
							idempotencyKey,
							policy.outputFields,
						) as IDataObject,
						pairedItem: { item: itemIndex },
					});
					continue;
				}

				if (resource === 'status') {
					assertOperationAllowed(STATUS_OPERATION, allowed);
					const policy = policyForOperation(STATUS_OPERATION, policies);
					assertPolicyDirection(policy, 'status');
					assertAiToolAllowed(this.getNode().type, policy.direction, credentials);
					const reference = assertReference(
						this.getNodeParameter('statusReference', itemIndex) as string,
						'Status Reference',
					);
					const response = await getIdocStatus(
						credentials,
						httpRequest,
						reference,
						correlationId,
					);
					enforceSerializedByteLimit(
						response,
						Number(credentials.maxResponseBytes),
						'Sidecar response',
					);
					outputItems.push({
						json: sanitizeStatusResponse(
							response,
							correlationId,
							policy.outputFields,
						) as IDataObject,
						pairedItem: { item: itemIndex },
					});
					continue;
				}

				if (resource === 'inbound' && selectedOperation === 'getMany') {
					assertOperationAllowed(INBOUND_LIST_OPERATION, allowed);
					const policy = policyForOperation(INBOUND_LIST_OPERATION, policies);
					assertPolicyDirection(policy, 'inbound-read');
					assertAiToolAllowed(this.getNode().type, policy.direction, credentials);
					const requestedLimit = this.getNodeParameter('limit', itemIndex, 10) as number;
					const limit = Math.min(requestedLimit, Number(credentials.maxDocuments));
					const rawCursor = String(this.getNodeParameter('cursor', itemIndex, '')).trim();
					const cursor =
						rawCursor === '' ? '' : assertReference(rawCursor, 'Inbound Cursor');
					const response = await listInboundIdocs(
						credentials,
						httpRequest,
						limit,
						cursor,
						correlationId,
					);
					enforceSerializedByteLimit(
						response,
						Number(credentials.maxResponseBytes),
						'Sidecar response',
					);
					const rows = sanitizeInboundListResponse(
						response,
						correlationId,
						policy.outputFields,
						limit,
					);
					outputItems.push(
						...rows.map((json) => ({
							json: json as IDataObject,
							pairedItem: { item: itemIndex },
						})),
					);
					continue;
				}

				if (resource === 'inbound' && selectedOperation === 'getDocument') {
					if (credentials.allowInboundPayloadRead !== true) {
						throw new OperationalError(
							'The selected credential does not allow inbound payload retrieval.',
						);
					}
					assertOperationAllowed(INBOUND_DOCUMENT_OPERATION, allowed);
					const policy = policyForOperation(INBOUND_DOCUMENT_OPERATION, policies);
					assertPolicyDirection(policy, 'inbound-payload');
					assertAiToolAllowed(this.getNode().type, policy.direction, credentials);
					const receiptId = assertReference(
						this.getNodeParameter('receiptId', itemIndex) as string,
						'Receipt ID',
					);
					const response = await getInboundIdoc(
						credentials,
						httpRequest,
						receiptId,
						correlationId,
					);
					enforceSerializedByteLimit(
						response,
						Number(credentials.maxResponseBytes),
						'Sidecar response',
					);
					outputItems.push({
						json: sanitizeInboundDocumentResponse(
							response,
							correlationId,
							receiptId,
							policy.outputFields,
						) as IDataObject,
						pairedItem: { item: itemIndex },
					});
					continue;
				}

				if (resource === 'inbound' && selectedOperation === 'acknowledge') {
					if (credentials.allowInboundAcknowledgement !== true) {
						throw new OperationalError(
							'The selected credential does not allow inbound acknowledgement.',
						);
					}
					assertOperationAllowed(INBOUND_ACK_OPERATION, allowed);
					const policy = policyForOperation(INBOUND_ACK_OPERATION, policies);
					assertPolicyDirection(policy, 'inbound-ack');
					assertAiToolAllowed(this.getNode().type, policy.direction, credentials);
					const receiptId = assertReference(
						this.getNodeParameter('receiptId', itemIndex) as string,
						'Receipt ID',
					);
					const outcome = this.getNodeParameter('ackOutcome', itemIndex) as string;
					const reason = String(this.getNodeParameter('ackReason', itemIndex, '')).trim();
					if (outcome !== 'accepted' && reason === '') {
						throw new OperationalError('Reason is required for rejected or retry outcomes.');
					}
					const confirmation = this.getNodeParameter(
						'ackConfirmation',
						itemIndex,
					) as string;
					assertAcknowledgementConfirmation(receiptId, outcome, confirmation);
					const response = await acknowledgeInboundIdoc(
						credentials,
						httpRequest,
						receiptId,
						outcome,
						reason,
						correlationId,
						confirmation,
					);
					enforceSerializedByteLimit(
						response,
						Number(credentials.maxResponseBytes),
						'Sidecar response',
					);
					outputItems.push({
						json: sanitizeAcknowledgementResponse(
							response,
							correlationId,
							receiptId,
							policy.outputFields,
						) as IDataObject,
						pairedItem: { item: itemIndex },
					});
					continue;
				}

				throw new OperationalError('Unsupported SAP IDoc Guard operation.');
			} catch (error) {
				if (this.continueOnFail()) {
					outputItems.push({
						json: { error: error instanceof Error ? error.message : String(error) },
						pairedItem: { item: itemIndex },
					});
					continue;
				}
				throw new NodeOperationError(
					this.getNode(),
					error instanceof Error ? error : new Error(String(error)),
					{ itemIndex },
				);
			}
		}

		return [outputItems];
	}
}

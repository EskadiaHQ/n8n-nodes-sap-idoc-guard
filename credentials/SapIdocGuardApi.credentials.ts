import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class SapIdocGuardApi implements ICredentialType {
	name = 'sapIdocGuardApi';

	displayName = 'Logali SAP IDoc Guard API';

	icon = 'file:sapIdocGuardCredential-v018.svg' as const;

	documentationUrl =
		'https://github.com/EskadiaHQ/n8n-nodes-sap-idoc-guard#credential-configuration';

	properties: INodeProperties[] = [
		{
			displayName: 'Sidecar Base URL',
			name: 'baseUrl',
			type: 'string',
			default: '',
			placeholder: 'https://sap-idoc.example.com',
			description: 'HTTPS base URL of the operated IDoc sidecar; do not include an endpoint path',
			required: true,
		},
		{
			displayName: 'API Token',
			name: 'apiToken',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
		},
		{
			displayName: 'Token Header',
			name: 'headerMode',
			type: 'options',
			options: [
				{ name: 'Authorization: Bearer (Private Sidecar)', value: 'bearer' },
				{ name: 'X-IDoc-Guard-Token (BTP Gateway)', value: 'xIdocGuardToken' },
			],
			default: 'bearer',
			description:
				'Use only with a compatible BTP gateway, where XSUAA reserves the Authorization bearer header; direct JIDocLib deployment is unsupported',
		},
		{
			displayName: 'Allowed Operations',
			name: 'allowedOperations',
			type: 'string',
			typeOptions: { rows: 5 },
			default: '',
			placeholder:
				'submitPurchaseOrderIdoc, getIdocStatus, listInboundIdocs, acknowledgeInboundIdoc',
			description:
				'Comma- or line-separated business aliases. Raw message, basic-type, RFC, port, and partner names are not operation IDs.',
			required: true,
		},
		{
			displayName: 'Operation Policies JSON',
			name: 'operationPoliciesJson',
			type: 'string',
			typeOptions: { rows: 14 },
			default: '',
			placeholder:
				'{"submitPurchaseOrderIdoc":{"direction":"outbound","messageType":"ORDERS","basicType":"ORDERS05","allowedSegments":["EDI_DC40","E1EDK01","E1EDP01"],"maxSegments":200,"outputFields":["requestId","idempotencyKey","tid","docnum","status","duplicate"]}}',
			description:
				'Required per-operation direction, exact IDoc contract, limits, and response projection. It must match the server policy.',
			required: true,
		},
		{
			displayName: 'Allow Outbound Submission',
			name: 'allowOutboundSubmission',
			type: 'boolean',
			default: false,
			description: 'Explicitly allow credentials to submit an approved outbound IDoc',
		},
		{
			displayName: 'Allow Inbound Payload Read',
			name: 'allowInboundPayloadRead',
			type: 'boolean',
			default: false,
			description:
				'Explicitly allow a normal workflow to retrieve stored raw inbound XML. AI tools remain blocked.',
		},
		{
			displayName: 'Allow Inbound Acknowledgement',
			name: 'allowInboundAcknowledgement',
			type: 'boolean',
			default: false,
			description: 'Explicitly allow credentials to acknowledge or reject a received IDoc',
		},
		{
			displayName: 'Allow AI Tool Use',
			name: 'allowAiTool',
			type: 'boolean',
			default: false,
			description:
				'Allow only read operations when the generated Tool variant is attached to an AI Agent. Submission and acknowledgement remain blocked.',
		},
		{
			displayName: 'Validate TLS Certificate',
			name: 'rejectUnauthorized',
			type: 'boolean',
			default: true,
			description: 'Whether to reject a sidecar certificate that cannot be validated',
		},
		{
			displayName: 'Allow Insecure HTTP',
			name: 'allowInsecureHttp',
			type: 'boolean',
			default: false,
			description:
				'Allow plain HTTP only for an isolated local contract fixture. Keep disabled for every SAP-connected sidecar.',
		},
		{
			displayName: 'Maximum Documents',
			name: 'maxDocuments',
			type: 'number',
			typeOptions: { minValue: 1, maxValue: 100 },
			default: 10,
			description: 'Credential-level maximum number of inbound or outbound IDocs per operation',
		},
		{
			displayName: 'Maximum Segments per IDoc',
			name: 'maxSegments',
			type: 'number',
			typeOptions: { minValue: 1, maxValue: 10000 },
			default: 500,
			description: 'Credential-level ceiling applied before the server policy limit',
		},
		{
			displayName: 'Maximum Request Size (Bytes)',
			name: 'maxRequestBytes',
			type: 'number',
			typeOptions: { minValue: 1024, maxValue: 5242880 },
			default: 262144,
			description: 'Maximum serialized request size accepted by the node',
		},
		{
			displayName: 'Maximum Response Size (Bytes)',
			name: 'maxResponseBytes',
			type: 'number',
			typeOptions: { minValue: 1024, maxValue: 10485760 },
			default: 524288,
			description: 'Maximum serialized sidecar response size accepted by the node',
		},
		{
			displayName: 'Connection Timeout (ms)',
			name: 'connectionTimeout',
			type: 'number',
			typeOptions: { minValue: 1000, maxValue: 120000 },
			default: 15000,
		},
		{
			displayName: 'Operation Timeout (ms)',
			name: 'requestTimeout',
			type: 'number',
			typeOptions: { minValue: 1000, maxValue: 300000 },
			default: 60000,
		},
	];
}

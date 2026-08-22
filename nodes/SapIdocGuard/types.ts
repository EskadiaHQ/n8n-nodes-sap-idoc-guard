export type IdocDirection =
	| 'outbound'
	| 'status'
	| 'inbound-read'
	| 'inbound-payload'
	| 'inbound-ack';

export interface IdocOperationPolicy {
	direction: IdocDirection;
	messageType?: string;
	basicType?: string;
	extension?: string;
	allowedSegments?: string[];
	maxSegments?: number;
	outputFields: string[];
}

export interface SapIdocGuardCredentials {
	baseUrl: string;
	apiToken: string;
	allowedOperations: string;
	operationPoliciesJson: string;
	allowOutboundSubmission?: boolean;
	allowInboundAcknowledgement?: boolean;
	allowInboundPayloadRead?: boolean;
	allowAiTool?: boolean;
	allowInsecureHttp?: boolean;
	rejectUnauthorized?: boolean;
	maxDocuments: number;
	maxSegments: number;
	maxRequestBytes: number;
	maxResponseBytes: number;
	connectionTimeout: number;
	requestTimeout: number;
}

export interface IdocGuardRequestOptions {
	method: 'GET' | 'POST';
	url: string;
	headers: Record<string, string>;
	body?: Record<string, unknown>;
	json: true;
	timeout: number;
	skipSslCertificateValidation: boolean;
}

export type IdocGuardHttpRequest = (options: IdocGuardRequestOptions) => Promise<unknown>;

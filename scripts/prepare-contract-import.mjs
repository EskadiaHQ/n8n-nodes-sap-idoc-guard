import fs from 'node:fs';
import path from 'node:path';

const [sourceDirectory, outputDirectory] = process.argv.slice(2);
const token = process.env.CONTRACT_TOKEN;

if (!sourceDirectory || !outputDirectory || !token) {
  throw new Error('Usage: CONTRACT_TOKEN=... node prepare-contract-import.mjs <examples> <output>');
}

const credentialId = 'SapIdocContractFixture01';
const credentialName = '415 · SAP IDoc Guard · Contract Fixture';
const operationPolicies = {
  submitPurchaseOrderIdoc: {
    direction: 'outbound',
    messageType: 'ORDERS',
    basicType: 'ORDERS05',
    allowedSegments: ['EDI_DC40', 'E1EDK01', 'E1EDKA1', 'E1EDP01', 'E1EDP19'],
    maxSegments: 200,
    outputFields: ['requestId', 'idempotencyKey', 'tid', 'docnum', 'status', 'duplicate'],
  },
  getIdocStatus: {
    direction: 'status',
    outputFields: [
      'requestId',
      'idempotencyKey',
      'docnum',
      'messageType',
      'basicType',
      'status',
      'statusHistory',
    ],
  },
  listInboundIdocs: {
    direction: 'inbound-read',
    outputFields: [
      'receiptId',
      'docnum',
      'messageType',
      'basicType',
      'senderPartner',
      'correlationId',
      'payloadDigest',
      'status',
      'receivedAt',
    ],
  },
  getInboundIdoc: {
    direction: 'inbound-payload',
    outputFields: [
      'receiptId',
      'docnum',
      'messageType',
      'basicType',
      'senderPartner',
      'payloadDigest',
      'idocXml',
    ],
  },
  acknowledgeInboundIdoc: {
    direction: 'inbound-ack',
    outputFields: ['receiptId', 'outcome', 'status', 'duplicate'],
  },
};

fs.rmSync(outputDirectory, { recursive: true, force: true });
fs.mkdirSync(path.join(outputDirectory, 'workflows'), { recursive: true });

const credential = [
  {
    id: credentialId,
    name: credentialName,
    type: 'sapIdocGuardApi',
    data: {
      baseUrl: 'http://sap-idoc-guard-contract:8080',
      apiToken: token,
      allowedOperations: Object.keys(operationPolicies).join(', '),
      operationPoliciesJson: JSON.stringify(operationPolicies),
      allowOutboundSubmission: true,
      allowInboundPayloadRead: true,
      allowInboundAcknowledgement: true,
      allowAiTool: false,
      rejectUnauthorized: true,
      allowInsecureHttp: true,
      maxDocuments: 25,
      maxSegments: 200,
      maxRequestBytes: 262144,
      maxResponseBytes: 524288,
      connectionTimeout: 5000,
      requestTimeout: 15000,
    },
  },
];

fs.writeFileSync(
  path.join(outputDirectory, 'credential.json'),
  `${JSON.stringify(credential, null, 2)}\n`,
  { mode: 0o600 },
);

const imported = [];
for (const fileName of fs.readdirSync(sourceDirectory).filter((name) => name.endsWith('.json'))) {
  const workflow = JSON.parse(fs.readFileSync(path.join(sourceDirectory, fileName), 'utf8'));
  workflow.active = false;
  workflow.settings = { ...(workflow.settings ?? {}), availableInMCP: false };

  if (workflow.id !== 'SapIdocGuardRealOutbound1') {
    for (const node of workflow.nodes ?? []) {
      if (node.type === 'n8n-nodes-sap-idoc-guard.sapIdocGuard') {
        node.credentials = {
          sapIdocGuardApi: { id: credentialId, name: credentialName },
        };
      }
    }
  }

  fs.writeFileSync(
    path.join(outputDirectory, 'workflows', fileName),
    `${JSON.stringify(workflow, null, 2)}\n`,
    { mode: 0o600 },
  );
  imported.push({ id: workflow.id, name: workflow.name, credentialAttached: workflow.id !== 'SapIdocGuardRealOutbound1' });
}

process.stdout.write(`${JSON.stringify({ credentialId, workflows: imported })}\n`);

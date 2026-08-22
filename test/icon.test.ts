import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const nodeSource = readFileSync(
	new URL('../nodes/SapIdocGuard/SapIdocGuard.node.ts', import.meta.url),
	'utf8',
);
const credentialSource = readFileSync(
	new URL('../credentials/SapIdocGuardApi.credentials.ts', import.meta.url),
	'utf8',
);
const lightIcon = readFileSync(
	new URL('../nodes/SapIdocGuard/sapIdocGuard-v018.svg', import.meta.url),
	'utf8',
);
const darkIcon = readFileSync(
	new URL('../nodes/SapIdocGuard/sapIdocGuard-v018.dark.svg', import.meta.url),
	'utf8',
);
const credentialIcon = readFileSync(
	new URL('../credentials/sapIdocGuardCredential-v018.svg', import.meta.url),
	'utf8',
);

describe('SAP IDoc Guard icon family', () => {
	it('references versioned node and credential assets', () => {
		assert.match(nodeSource, /file:sapIdocGuard-v018\.svg/);
		assert.match(nodeSource, /file:sapIdocGuard-v018\.dark\.svg/);
		assert.match(credentialSource, /file:sapIdocGuardCredential-v018\.svg/);
	});

	it('uses the exact approved high-resolution artwork on every surface', () => {
		assert.equal(lightIcon, darkIcon);
		assert.equal(lightIcon, credentialIcon);
		const png = Buffer.from(lightIcon.match(/base64,([^"']+)/)?.[1] ?? '', 'base64');
		assert.equal(png.readUInt32BE(16), 1024);
		assert.equal(png.readUInt32BE(20), 1024);
		assert.equal(
			createHash('sha256').update(png).digest('hex'),
			'a0c9b28e943dd9aefac0cea41c4f39eac6cc5fda4309bf39aef212aab4ef5085',
		);
	});
});

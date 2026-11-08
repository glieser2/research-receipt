import { createHash } from 'node:crypto';
const value = process.argv[2];
if (!value || !/^https:\/\/raw\.githubusercontent\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/[a-fA-F0-9]{40}\/[A-Za-z0-9_./-]+$/.test(value) || value.split('/').some(v => v === '.' || v === '..')) throw new Error('Pass one commit-pinned raw.githubusercontent.com URL.');
const response = await fetch(value, { redirect: 'error', signal: AbortSignal.timeout(20000) });
if (!response.ok) throw new Error(`HTTP ${response.status}`);
const reader = response.body.getReader(); const chunks = []; let size = 0;
while (true) { const { done, value: chunk } = await reader.read(); if (done) break; size += chunk.length; if (size > 16384) { await reader.cancel(); throw new Error('Evidence exceeds 16384 bytes'); } chunks.push(Buffer.from(chunk)); }
const bytes = Buffer.concat(chunks); new TextDecoder('utf-8', { fatal: true }).decode(bytes);
console.log(JSON.stringify({ url: value, sha256: createHash('sha256').update(bytes).digest('hex'), byte_length: bytes.length }, null, 2));

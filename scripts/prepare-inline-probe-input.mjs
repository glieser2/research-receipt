import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const sha = value => createHash('sha256').update(value).digest('hex');
const fixtureBytes = await readFile('artifacts/bradbury/v4-e2e-input.json');
if (sha(fixtureBytes) !== 'a423530364c4c65fd5c3ef23db2e23f1cefa8a27a587f9dbe692ec0453930dfc') throw new Error('Original oracle fixture changed.');
const fixture = JSON.parse(fixtureBytes);
const files = ['artifacts/bradbury/Ownable.sol', 'artifacts/bradbury/Context.sol'];
const materials = [];
for (let index = 0; index < files.length; index++) {
  const body = await readFile(files[index]); const expected = fixture.negative.sources[index];
  if (body.length !== expected.byte_length || sha(body) !== expected.sha256) throw new Error('Pinned source bytes differ.');
  materials.push(new TextDecoder('utf-8', {fatal:true}).decode(body));
}
const input = {
  negative: { spec:fixture.spec, submission:fixture.negative, materials },
  positive: { spec:fixture.spec, submission:fixture.positive, materials },
  strictUnknown: { spec:fixture.specStrict, submission:fixture.positive, materials },
};
const serialized = JSON.stringify(input,null,2)+'\n';
await writeFile('artifacts/bradbury/inline-probe-input.json',serialized,{flag:'wx'});
await writeFile('tests/fixtures/bradbury-inline-probe-input.json',serialized,{flag:'wx'});
console.log(JSON.stringify({prepared:true,fixtureSha256:sha(serialized),onlyRealDeploymentCase:'negative',materialSha256:fixture.negative.sources.map(s=>s.sha256),materialByteLengths:fixture.negative.sources.map(s=>s.byte_length)}));

import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve, dirname, basename} from 'node:path';
import {createHash} from 'node:crypto';
import {rehearse} from '../d1-migration-rehearsal.mjs';

const migrations = new URL('../../apps/hub/drizzle/', import.meta.url);
function fixture(t, {through = '0021', deletedOnly = false} = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'mishwar-d1-rehearsal-'));
  t.after(() => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('mishwar-d1-rehearsal-'));
    rmSync(directory, {recursive: true, force: true});
  });
  const db = new DatabaseSync(':memory:');
  try {
    for (const name of readdirSync(migrations).filter(name => name.endsWith('.sql') && name.slice(0, 4) <= through).sort()) db.exec(readFileSync(new URL(name, migrations), 'utf8'));
    const at = '2026-01-01T00:00:00Z';
    db.prepare('INSERT INTO riders VALUES(?,?,?,?,?,?,?)').run('fixture-rider', 'Private fixture only', '+966500000000', '', 'active', at, at);
    db.prepare('INSERT INTO trips VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('fixture-trip', 'fixture-rider', null, 'completed', '{}', '{}', 100, 0, 'cash_due', 0, at, at);
    db.prepare('INSERT INTO service_cases VALUES(?,?,?,?,?,?,?,?,?,?)').run('fixture-case', 'fixture-trip', 'rider', 'fixture-rider', 'technical', 'Private fixture support', 'open', '', at, at);
    const requestColumns = through >= '0023' ? ',client_request_id' : '';
    db.prepare(`INSERT INTO case_messages(id,case_id,role,sender_id,body,created_at${requestColumns}) VALUES(10,?,?,?,?,?${requestColumns ? ',NULL' : ''})`).run('fixture-case', 'rider', 'fixture-rider', 'Private fixture message', at);
    db.prepare(`INSERT INTO case_messages(id,case_id,role,sender_id,body,created_at${requestColumns}) VALUES(400,?,?,?,?,?${requestColumns ? ',NULL' : ''})`).run('fixture-case', 'admin', 'fixture-staff', 'Deleted high-water fixture', at);
    db.exec('DELETE FROM case_messages WHERE id=400');
    if (deletedOnly) db.exec('DELETE FROM case_messages');
    db.prepare('INSERT INTO email_auth_tokens(id,role,actor,purpose,token_hash,expires_at,created_at) VALUES(?,?,?,?,?,?,?)').run('fixture-token', 'rider', 'fixture-rider', 'verify', 'fixture-hash', '2030-01-01', at);
    // Build a SQL export without ever logging records.
    const schema = db.prepare("SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type='index'").all();
    const statements = schema.map(row => row.sql + ';');
    for (const {name} of db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
      const cols = db.prepare(`PRAGMA table_info("${name}")`).all().map(row => row.name);
      const selects = cols.map(name => `quote("${name}") AS "${name}"`).join(',');
      for (const row of db.prepare(`SELECT ${selects} FROM "${name}"`).all()) statements.push(`INSERT INTO "${name}"(${cols.map(name => '"' + name + '"').join(',')}) VALUES(${cols.map(name => row[name]).join(',')});`);
    }
    statements.push('DELETE FROM sqlite_sequence;');
    for (const {name, seq} of db.prepare('SELECT * FROM sqlite_sequence').all()) statements.push(`INSERT INTO sqlite_sequence VALUES('${name}',${seq});`);
    const sqlPath = join(directory, 'fixture.sql');
    writeFileSync(sqlPath, statements.join('\n'));
    return {directory, sqlPath, outputDirectory: join(directory, 'result')};
  } finally { db.close(); }
}

test('rehearsal preserves every original table and deleted high-water sequence after both migrations', t => {
  const input = fixture(t);
  const result = rehearse({...input, provenance: 'synthetic-fixture'});
  assert.deepEqual(result.applied, ['0022_email_token_identity.sql', '0023_account_support_requests.sql']);
  const report = JSON.parse(readFileSync(result.reportPath));
  assert.equal(report.provenance, 'synthetic-fixture');
  assert.equal(report.originalTables.case_messages.count, 1);
  assert.equal(report.sequencesBefore.case_messages, '400');
  assert.equal(report.sequencesAfter.case_messages, '400');
  assert.ok(Object.values(report.checks).every(value => value === true));
  assert.equal(readFileSync(result.reportPath, 'utf8').includes('Private fixture'), false);
});

test('empty case history still preserves a previously deleted high-water ID', t => {
  const input = fixture(t, {deletedOnly: true});
  const result = rehearse(input);
  const report = JSON.parse(readFileSync(result.reportPath));
  assert.equal(report.originalTables.case_messages.count, 0);
  assert.equal(report.sequencesAfter.case_messages, '400');
});

test('already migrated exports are verified without applying ALTER TABLE twice', t => {
  const input = fixture(t, {through: '0023'});
  const result = rehearse(input);
  assert.equal(result.applied.length, 0);
  assert.equal(result.alreadyPresent.length, 2);
});

test('a test placeholder and an existing output folder cannot be mistaken for a successful rehearsal', t => {
  const input = fixture(t);
  writeFileSync(input.sqlPath, '-- TEST FILE ONLY\n' + 'X'.repeat(128519));
  assert.throws(() => rehearse(input), error => error.code === 'TEST_FILE_REJECTED');
  const good = fixture(t);
  rehearse(good);
  assert.throws(() => rehearse(good), error => error.code === 'EEXIST');
});

test('preexisting foreign-key corruption fails before migrations and source bytes remain untouched', t => {
  const input = fixture(t);
  writeFileSync(input.sqlPath, readFileSync(input.sqlPath, 'utf8') + "\nINSERT INTO case_messages(case_id,role,sender_id,body,created_at) VALUES('absent','rider','fixture','private','2026');");
  const before = readFileSync(input.sqlPath);
  assert.throws(() => rehearse(input), error => error.code === 'FOREIGN_KEY_VIOLATIONS');
  assert.deepEqual(readFileSync(input.sqlPath), before);
});

test('SQL exports cannot attach a second database file', t => {
  const input = fixture(t);
  writeFileSync(input.sqlPath, readFileSync(input.sqlPath, 'utf8') + "\nATTACH DATABASE 'forbidden.sqlite' AS outside;");
  assert.throws(() => rehearse(input), error => error.code === 'LOCAL_REHEARSAL_FAILED');
});

test('a failed second migration rolls back its schema rebuild while the first stays applied', t => {
  const input = fixture(t);
  const migrationDirectory = join(input.directory, 'migrations');
  mkdirSync(migrationDirectory);
  writeFileSync(join(migrationDirectory, '0022_email_token_identity.sql'), readFileSync(new URL('0022_email_token_identity.sql', migrations)));
  writeFileSync(join(migrationDirectory, '0023_account_support_requests.sql'), readFileSync(new URL('0023_account_support_requests.sql', migrations), 'utf8') + '\nSELECT * FROM intentionally_missing_table;');
  assert.throws(() => rehearse({...input, migrationsDirectory: migrationDirectory}), error => error.code === 'LOCAL_REHEARSAL_FAILED');
  const db = new DatabaseSync(join(input.outputDirectory, 'rehearsal.sqlite'), {readOnly: true});
  try {
    assert.ok(db.prepare('PRAGMA table_info(email_auth_tokens)').all().some(row => row.name === 'target_email'));
    assert.equal(db.prepare('PRAGMA table_info(case_messages)').all().some(row => row.name === 'client_request_id'), false);
    assert.equal(db.prepare('SELECT seq FROM sqlite_sequence WHERE name=?').get('case_messages').seq, 400);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM case_messages').get().n, 1);
  } finally { db.close(); }
});

test('a pre-migrated source with a broken trip-message uniqueness index is rejected', t => {
  const input = fixture(t, {through: '0023'});
  writeFileSync(input.sqlPath, readFileSync(input.sqlPath, 'utf8') + '\nDROP INDEX trip_messages_client_request; CREATE INDEX trip_messages_client_request ON trip_messages(trip_id);');
  assert.throws(() => rehearse(input), error => error.code === 'TRIP_MESSAGE_DUPLICATE_ACCEPTED');
});

test('receipt linkage verifies source identity and refuses a persistence probe as production evidence', t => {
  const input = fixture(t);
  const second = join(input.directory, 'second.sql');
  const bytes = readFileSync(input.sqlPath);
  writeFileSync(second, bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const receiptPath = join(input.directory, 'receipt.json');
  const receipt = {schemaVersion: 1, kind: 'persistence-probe', sha256, files: [{path: input.sqlPath}, {path: second}], source: {databaseId: '510eb1ef-8814-4313-95e8-b1386ef40f8e', exportedAt: '2026-01-01T00:00:00Z'}};
  writeFileSync(receiptPath, JSON.stringify(receipt));
  assert.throws(() => rehearse({...input, receiptPath}), error => error.code === 'PRODUCTION_EXPORT_RECEIPT_REQUIRED');
  receipt.kind = 'production-export';
  receipt.source.databaseId = 'different-database';
  writeFileSync(receiptPath, JSON.stringify(receipt));
  assert.throws(() => rehearse({...input, receiptPath}), error => error.code === 'BACKUP_RECEIPT_DATABASE_MISMATCH');
  receipt.source.databaseId = '510eb1ef-8814-4313-95e8-b1386ef40f8e';
  writeFileSync(receiptPath, JSON.stringify(receipt));
  const result = rehearse({...input, receiptPath});
  const report = JSON.parse(readFileSync(result.reportPath));
  assert.equal(report.provenance, 'verified-production-export-receipt');
  assert.equal(report.verifiedReceipt.sourceSha256, sha256);
  assert.equal(report.verifiedReceipt.kind, 'production-export');
});

test('a receipt for other source bytes cannot be linked to the rehearsal', t => {
  const input = fixture(t);
  const second = fixture(t);
  writeFileSync(second.sqlPath, readFileSync(second.sqlPath, 'utf8') + '\n-- Different verified source bytes\n');
  const bytes = readFileSync(second.sqlPath);
  const otherCopy = join(input.directory, 'other-copy.sql');
  writeFileSync(otherCopy, bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const receiptPath = join(input.directory, 'different-receipt.json');
  writeFileSync(receiptPath, JSON.stringify({schemaVersion: 1, kind: 'production-export', sha256, files: [{path: second.sqlPath}, {path: otherCopy}], source: {databaseId: '510eb1ef-8814-4313-95e8-b1386ef40f8e', exportedAt: '2026-01-01T00:00:00Z'}}));
  assert.throws(() => rehearse({...input, receiptPath}), error => error.code === 'BACKUP_RECEIPT_HASH_MISMATCH');
});

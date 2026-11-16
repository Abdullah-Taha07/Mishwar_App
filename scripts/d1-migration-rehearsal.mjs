import {DatabaseSync, constants} from 'node:sqlite';
import {createHash, randomUUID} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync, realpathSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyReceipt} from './d1-backup.mjs';

const defaultMigrations = fileURLToPath(new URL('../apps/hub/drizzle/', import.meta.url));
const migrationNames = ['0022_email_token_identity.sql', '0023_account_support_requests.sql'];
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw Object.assign(new Error(code), {code}); };
const check = (condition, code) => { if (!condition) fail(code); };
const rows = (db, sql) => { const stmt = db.prepare(sql); stmt.setReadBigInts(true); return stmt.all(); };
const columns = (db, table) => rows(db, `PRAGMA table_info(${quote(table)})`).map(row => row.name);
const cell = value => typeof value === 'bigint' ? ['integer', value.toString()] : value instanceof Uint8Array ? ['blob', Buffer.from(value).toString('hex')] : [typeof value, value];

function fingerprint(db, table, names = columns(db, table)) {
  const values = rows(db, `SELECT ${names.map(quote).join(',')} FROM ${quote(table)}`);
  const rowHashes = values.map(row => hash(JSON.stringify(names.map(name => cell(row[name]))))).sort();
  return {columns: names, count: values.length, sha256: hash(rowHashes.join('\n'))};
}

function snapshot(db) {
  const tables = rows(db, "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  const tableData = Object.fromEntries(tables.map(({name}) => [name, fingerprint(db, name)]));
  const hasSequences = rows(db, "SELECT name FROM sqlite_schema WHERE name='sqlite_sequence'").length;
  const sequence = hasSequences ? Object.fromEntries(rows(db, 'SELECT name,seq FROM sqlite_sequence').map(row => [row.name, row.seq.toString()])) : {};
  return {tables: tableData, sequence};
}

function assertPreserved(db, before) {
  for (const [table, expected] of Object.entries(before.tables)) {
    const current = columns(db, table);
    check(expected.columns.every(name => current.includes(name)), 'ORIGINAL_COLUMN_MISSING');
    const actual = fingerprint(db, table, expected.columns);
    check(actual.count === expected.count && actual.sha256 === expected.sha256, 'ORIGINAL_DATA_CHANGED');
  }
  const after = snapshot(db);
  for (const [name, seq] of Object.entries(before.sequence)) {
    check(after.sequence[name] !== undefined && BigInt(after.sequence[name]) === BigInt(seq), 'AUTOINCREMENT_CHANGED');
  }
  return after;
}

function integrity(db) {
  check(rows(db, 'PRAGMA foreign_keys')[0].foreign_keys === 1n, 'FOREIGN_KEYS_DISABLED');
  check(rows(db, 'PRAGMA foreign_key_check').length === 0, 'FOREIGN_KEY_VIOLATIONS');
  const results = rows(db, 'PRAGMA integrity_check');
  check(results.length === 1 && results[0].integrity_check === 'ok', 'INTEGRITY_CHECK_FAILED');
}

function restorePolicy(db) {
  check(typeof db.setAuthorizer === 'function', 'NODE_SQLITE_AUTHORIZER_REQUIRED');
  // An export can write only to the isolated main database. It cannot ATTACH a
  // second file, use an extension, or turn on SQLite writable_schema.
  db.setAuthorizer((action, first, second, database) => {
    if ([constants.SQLITE_ATTACH, constants.SQLITE_DETACH].includes(action)) return constants.SQLITE_DENY;
    if (database && database !== 'main' && database !== 'temp') return constants.SQLITE_DENY;
    if (action === constants.SQLITE_FUNCTION && /^(load_extension|readfile|writefile)$/i.test(second || first || '')) return constants.SQLITE_DENY;
    if (action === constants.SQLITE_PRAGMA && !['foreign_keys', 'defer_foreign_keys'].includes((first || '').toLowerCase())) return constants.SQLITE_DENY;
    return constants.SQLITE_OK;
  });
}

function apply(db, name, directory) {
  db.exec('PRAGMA foreign_keys=ON; BEGIN');
  try {
    db.exec(readFileSync(join(directory, name), 'utf8'));
    check(rows(db, 'PRAGMA foreign_key_check').length === 0, 'MIGRATION_FOREIGN_KEY_VIOLATIONS');
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

function verifyNewContract(db, before, migrated22) {
  check(columns(db, 'email_auth_tokens').includes('target_email'), 'TARGET_EMAIL_MISSING');
  if (migrated22) check(rows(db, 'SELECT COUNT(*) AS n FROM email_auth_tokens WHERE target_email IS NOT NULL')[0].n === 0n, 'LEGACY_EMAIL_TOKEN_NOT_INVALIDATED');
  check(columns(db, 'case_messages').includes('client_request_id') && columns(db, 'trip_messages').includes('client_request_id'), 'MESSAGE_REQUEST_COLUMN_MISSING');
  const indexes = rows(db, "SELECT name FROM sqlite_schema WHERE type='index'").map(row => row.name);
  for (const name of ['service_cases_owner_created', 'case_messages_cursor', 'case_messages_client_request', 'trip_messages_client_request']) check(indexes.includes(name), 'MESSAGE_INDEX_MISSING');
  check(!rows(db, "SELECT name FROM sqlite_schema WHERE name IN ('service_cases_next','case_messages_next')").length, 'MIGRATION_TEMP_TABLE_REMAINS');
  const id = 'local-rehearsal-' + randomUUID(), at = '2000-01-01T00:00:00Z';
  db.exec('SAVEPOINT local_contract_probe');
  try {
    db.prepare('INSERT INTO service_cases(id,trip_id,role,owner_id,kind,description,created_at,updated_at) VALUES(?,NULL,?,?,?,?,?,?)').run(id, 'rider', id, 'technical', 'Local-only contract probe', at, at);
    const insert = db.prepare('INSERT INTO case_messages(case_id,role,sender_id,body,created_at,client_request_id) VALUES(?,?,?,?,?,?)');
    const result = insert.run(id, 'rider', id, 'Local-only contract probe', at, id);
    check(BigInt(result.lastInsertRowid) > BigInt(before.sequence.case_messages || '0'), 'AUTOINCREMENT_REUSED');
    let duplicateRejected = false;
    try { insert.run(id, 'rider', id, 'Local-only contract probe', at, id); } catch (error) { duplicateRejected = /UNIQUE constraint/.test(error.message); }
    check(duplicateRejected, 'MESSAGE_DUPLICATE_ACCEPTED');
    let orphanRejected = false;
    try { insert.run(id + '-absent', 'rider', id, 'Local-only contract probe', at, null); } catch (error) { orphanRejected = /FOREIGN KEY constraint/.test(error.message); }
    check(orphanRejected, 'ORPHAN_MESSAGE_ACCEPTED');
    let absentTripRejected = false;
    try { db.prepare('UPDATE service_cases SET trip_id=? WHERE id=?').run(id + '-absent', id); } catch (error) { absentTripRejected = /FOREIGN KEY constraint/.test(error.message); }
    check(absentTripRejected, 'ORPHAN_CASE_ACCEPTED');
    db.prepare('INSERT INTO riders(id,created_at,last_seen) VALUES(?,?,?)').run(id, at, at);
    db.prepare('INSERT INTO trips(id,rider_id,status,pickup_json,destination_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id, id, 'completed', '{}', '{}', at, at);
    const tripInsert = db.prepare('INSERT INTO trip_messages(trip_id,role,sender_id,body,created_at,client_request_id) VALUES(?,?,?,?,?,?)');
    const tripResult = tripInsert.run(id, 'rider', id, 'Local-only contract probe', at, id);
    check(BigInt(tripResult.lastInsertRowid) > BigInt(before.sequence.trip_messages || '0'), 'TRIP_AUTOINCREMENT_REUSED');
    let tripDuplicateRejected = false;
    try { tripInsert.run(id, 'rider', id, 'Local-only contract probe', at, id); } catch (error) { tripDuplicateRejected = /UNIQUE constraint/.test(error.message); }
    check(tripDuplicateRejected, 'TRIP_MESSAGE_DUPLICATE_ACCEPTED');
  } finally {
    db.exec('ROLLBACK TO local_contract_probe; RELEASE local_contract_probe');
  }
}

/** Never exports, connects to Cloudflare, or changes the supplied SQL file. */
export function rehearse({sqlPath, outputDirectory, migrationsDirectory = defaultMigrations, provenance = 'unverified-local-input', receiptPath}) {
  const sourcePath = realpathSync(sqlPath), bytes = readFileSync(sourcePath), sourceSha256 = hash(bytes);
  const sql = bytes.toString('utf8');
  check(!/TEST\s+FILE\s+ONLY/i.test(sql), 'TEST_FILE_REJECTED');
  check(bytes.length > 0 && /CREATE\s+TABLE/i.test(sql), 'SQL_EXPORT_REQUIRED');
  let verifiedReceipt = null;
  if (receiptPath) {
    let proof, receipt, receiptBytes;
    try {
      proof = verifyReceipt(receiptPath);
      receiptBytes = readFileSync(receiptPath);
      receipt = JSON.parse(receiptBytes.toString('utf8'));
    } catch { fail('BACKUP_RECEIPT_INVALID'); }
    check(proof.kind === 'production-export', 'PRODUCTION_EXPORT_RECEIPT_REQUIRED');
    check(proof.sha256 === sourceSha256, 'BACKUP_RECEIPT_HASH_MISMATCH');
    check(proof.files.some(file => file.path.toLowerCase() === sourcePath.toLowerCase()), 'SOURCE_NOT_IN_BACKUP_RECEIPT');
    check(receipt.source?.databaseId === '510eb1ef-8814-4313-95e8-b1386ef40f8e', 'BACKUP_RECEIPT_DATABASE_MISMATCH');
    check(Number.isFinite(Date.parse(receipt.source.exportedAt || '')), 'BACKUP_RECEIPT_EXPORT_TIME_REQUIRED');
    verifiedReceipt = {receiptPath: realpathSync(receiptPath), receiptSha256: hash(receiptBytes), kind: proof.kind, sourceSha256, databaseId: receipt.source.databaseId, exportedAt: receipt.source.exportedAt, checkedAt: proof.checkedAt, verifierPid: proof.verifierPid};
    provenance = 'verified-production-export-receipt';
  }
  const directory = resolve(outputDirectory);
  // Exclusive mkdir prevents overwriting a previous run or an existing backup.
  mkdirSync(directory, {recursive: false});
  const databasePath = join(directory, 'rehearsal.sqlite');
  const reportPath = join(directory, 'rehearsal-report.json');
  let db, before, after;
  const applied = [], alreadyPresent = [];
  try {
    db = new DatabaseSync(databasePath);
    db.exec('PRAGMA foreign_keys=OFF');
    restorePolicy(db);
    db.exec(sql);
    if (db.isTransaction) db.exec('COMMIT');
    db.setAuthorizer(null);
    db.exec('PRAGMA foreign_keys=ON; PRAGMA defer_foreign_keys=OFF');
    integrity(db);
    for (const table of ['email_auth_tokens', 'service_cases', 'case_messages', 'trip_messages', 'trips']) check(columns(db, table).length > 0, 'MISHWAR_SCHEMA_REQUIRED');
    before = snapshot(db);
    if (columns(db, 'email_auth_tokens').includes('target_email')) alreadyPresent.push(migrationNames[0]);
    else { apply(db, migrationNames[0], migrationsDirectory); applied.push(migrationNames[0]); }
    const caseRequest = columns(db, 'case_messages').includes('client_request_id');
    const tripRequest = columns(db, 'trip_messages').includes('client_request_id');
    const nullableTrip = rows(db, 'PRAGMA table_info(service_cases)').find(row => row.name === 'trip_id')?.notnull === 0n;
    check((caseRequest && tripRequest && nullableTrip) || (!caseRequest && !tripRequest && !nullableTrip), 'PARTIAL_0023_SCHEMA');
    if (caseRequest) alreadyPresent.push(migrationNames[1]);
    else { apply(db, migrationNames[1], migrationsDirectory); applied.push(migrationNames[1]); }
    verifyNewContract(db, before, applied.includes(migrationNames[0]));
    integrity(db);
    after = assertPreserved(db, before);
    db.close(); db = undefined;
    // Reopen the persisted local database, so in-memory success is insufficient.
    db = new DatabaseSync(databasePath, {readOnly: true});
    integrity(db);
    assertPreserved(db, before);
    check(hash(readFileSync(sourcePath)) === sourceSha256, 'SOURCE_CHANGED_DURING_REHEARSAL');
    const report = {
      format: 'mishwar-d1-rehearsal-v1', passed: true, checkedAt: new Date().toISOString(),
      scope: 'local-only', provenance, verifiedReceipt, sourceSha256, sourceBytes: bytes.length,
      applied, alreadyPresent, originalTables: before.tables, sequencesBefore: before.sequence, sequencesAfter: after.sequence,
      checks: {originalDataPreserved: true, sequencePreserved: true, foreignKeys: true, integrity: true, accountSupport: true, duplicateMessageRejected: true, duplicateTripMessageRejected: true, orphanMessageRejected: true, orphanCaseRejected: true, persistedDatabaseReopened: true, sourceUnchanged: true},
      databasePath
    };
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', {flag: 'wx', mode: 0o600});
    return {passed: true, reportPath, databasePath, sourceSha256, verifiedReceipt, applied, alreadyPresent, tableCount: Object.keys(before.tables).length, originalRowCount: Object.values(before.tables).reduce((total, table) => total + table.count, 0)};
  } catch (error) {
    // SQL may contain private records. Never echo SQL or the raw SQLite error.
    if (!error.code?.startsWith('ERR_') && /^[A-Z0-9_]+$/.test(error.code || '')) throw error;
    throw Object.assign(new Error('LOCAL_REHEARSAL_FAILED'), {code: 'LOCAL_REHEARSAL_FAILED'});
  } finally { db?.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [sqlPath, outputDirectory, flag, receiptPath, ...extra] = process.argv.slice(2);
    check(sqlPath && outputDirectory && (!flag || (flag === '--receipt' && receiptPath)) && extra.length === 0, 'USAGE_NODE_D1_REHEARSAL_SQL_PATH_NEW_OUTPUT_DIRECTORY_OPTIONAL_RECEIPT');
    console.log(JSON.stringify(rehearse({sqlPath, outputDirectory, receiptPath}), null, 2));
  } catch (error) {
    console.error(JSON.stringify({passed: false, code: /^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'LOCAL_REHEARSAL_FAILED'}));
    process.exitCode = 1;
  }
}

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { config } from 'dotenv';
import postgres from 'postgres';
import { newInvitationCode, newQrToken } from '../lib/invitations/codes.ts';

config({ path: '.env.local', quiet: true });
const args = process.argv.slice(2);
const mode = args[0];
if (!['--dry-run', '--apply', '--verify', '--migrate'].includes(mode))
  throw new Error('Use --dry-run, --apply, --verify, or --migrate. Data modes require manifest and exact demo plan paths.');
const directory = path.resolve('artifacts/students');
fs.mkdirSync(directory, { recursive: true });
const db = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, connect_timeout: 10 });

async function snapshot(tx) {
  const result = {};
  for (const table of ['students', 'invitations', 'guests', 'check_ins', 'support_tickets'])
    result[table] = await tx`select * from ${tx(table)} order by id`;
  return result;
}
function review(manifest, plan, before) {
  const byAdmission = new Map(before.students.map(s => [s.student_id, s]));
  const rosterIds = new Set(manifest.students.map(s => s.admissionNumber));
  const demoIds = new Set();
  for (const demo of plan) {
    assert.equal(rosterIds.has(demo.admissionNumber), false, 'Demo cleanup overlaps real roster');
    const row = byAdmission.get(demo.admissionNumber);
    if (!row) continue; // Re-running an already completed import is safe.
    assert.equal(row.name, demo.name, 'Demo name changed: review required');
    assert.equal(row.class, demo.className, 'Demo class changed: review required');
    demoIds.add(row.id);
  }
  for (const row of manifest.students) {
    const existing = byAdmission.get(row.admissionNumber);
    if (existing) {
      assert.equal(existing.name, row.name, `Existing name conflicts at ${row.sourceSheet}!B${row.sourceRow}`);
      assert.equal(existing.class, row.className, `Existing class conflicts at ${row.sourceSheet}!C${row.sourceRow}`);
    }
  }
  const demoInvitations = new Set(before.invitations.filter(i => demoIds.has(i.student_id)).map(i => i.id));
  const demoGuests = new Set(before.guests.filter(g => demoInvitations.has(g.invitation_id)).map(g => g.id));
  return {
    demoIds, demoInvitations,
    retained: {
      students: before.students.filter(s => !demoIds.has(s.id)),
      invitations: before.invitations.filter(i => !demoInvitations.has(i.id)),
      guests: before.guests.filter(g => !demoInvitations.has(g.invitation_id)),
      check_ins: before.check_ins.filter(c => !demoInvitations.has(c.invitation_id) && !demoGuests.has(c.guest_id)),
      support_tickets: before.support_tickets.filter(t => !demoIds.has(t.student_id)),
    },
  };
}
function verify(manifest, plan, after, retained) {
  const byAdmission = new Map(after.students.map(s => [s.student_id, s]));
  assert.equal(byAdmission.size, after.students.length, 'Duplicate admissions');
  const checked = [];
  for (const source of manifest.students) {
    const s = byAdmission.get(source.admissionNumber);
    assert.ok(s, `Missing source student: ${source.sourceSheet}!C${source.sourceRow}`);
    assert.equal(s.name, source.name, 'Name mismatch');
    assert.equal(s.class, source.className, 'Class mismatch');
    const invs = after.invitations.filter(i => i.student_id === s.id);
    assert.equal(invs.length, 1, 'Each student must have exactly one invitation');
    assert.match(invs[0].invitation_code, /^ANL-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{16}$/);
    assert.match(invs[0].qr_token, /^[a-f0-9]{32}$/);
    checked.push({ admissionNumber: source.admissionNumber, className: source.className,
      sourceRow: source.sourceRow, studentId: s.id, invitationId: invs[0].id, verified: true });
  }
  for (const demo of plan) assert.equal(byAdmission.has(demo.admissionNumber), false, 'Demo student remains');
  assert.equal(new Set(after.invitations.map(i => i.invitation_code)).size, after.invitations.length, 'Duplicate invitation codes');
  assert.equal(new Set(after.invitations.map(i => i.qr_token)).size, after.invitations.length, 'Duplicate QR tokens');
  if (retained) {
    for (const [table, rows] of Object.entries(retained)) {
      const current = new Map(after[table].map(row => [row.id, row]));
      for (const row of rows) assert.deepEqual(current.get(row.id), row, `Unrelated ${table} record changed`);
      if (['guests', 'check_ins', 'support_tickets'].includes(table)) assert.equal(after[table].length, rows.length);
    }
    const expected = new Set([...manifest.students.map(s => s.admissionNumber), ...retained.students.map(s => s.student_id)]);
    assert.deepEqual(new Set(byAdmission.keys()), expected, 'Unexpected or missing students');
  }
  const counts = {};
  for (const s of checked) counts[s.className] = (counts[s.className] || 0) + 1;
  assert.deepEqual(counts, manifest.classes, 'Per-class reconciliation failed');
  return { sourceStudentCount: manifest.sourceStudentCount, included: checked.length,
    excluded: manifest.excludedSheets, classes: counts, rows: checked,
    totals: Object.fromEntries(Object.entries(after).map(([k, v]) => [k, v.length])) };
}

try {
  if (mode === '--migrate') {
    await db.begin(async tx => {
      await tx.unsafe(fs.readFileSync('drizzle/migrations/0003_invitation_lookup_limits.sql', 'utf8'));
    });
    console.log('Invitation recovery attempt-limit table is ready.');
  } else {
    const manifest = JSON.parse(fs.readFileSync(args[1], 'utf8'));
    const plan = JSON.parse(fs.readFileSync(args[2], 'utf8'));
    assert.ok(Array.isArray(plan), 'Exact demo plan is required');
    assert.equal(createHash('sha256').update(fs.readFileSync(manifest.sourceFile)).digest('hex'), manifest.sourceSha256, 'Source workbook changed');
    // Re-read the original at execution time; reject edited/truncated manifests.
    const validated = path.join(directory, 'validated-source.json');
    const read = spawnSync('python', ['scripts/read-student-roster.py', manifest.sourceFile,
      ...Object.keys(manifest.excludedSheets).flatMap(s => ['--exclude-sheet', s]), '--output', validated], { encoding: 'utf8', windowsHide: true });
    assert.equal(read.status, 0, 'Source validation failed: ' + read.stderr);
    assert.deepEqual(manifest, JSON.parse(fs.readFileSync(validated, 'utf8')), 'Manifest differs from original workbook');
    let retained;
    if (mode === '--verify') {
      const report = verify(manifest, plan, await snapshot(db));
      fs.writeFileSync(path.join(directory, 'verification.json'), JSON.stringify(report, null, 2));
      console.log(JSON.stringify({ ...report, rows: undefined }));
    } else {
      const result = await db.begin(async tx => {
        if (mode === '--apply') {
          // Freeze writes to the affected records until backup, import, and reconciliation finish.
          await tx`set local lock_timeout = '15s'`;
          await tx`lock table students, invitations, guests, check_ins, support_tickets in share row exclusive mode`;
        }
        const before = await snapshot(tx);
        const reviewed = review(manifest, plan, before);
        retained = reviewed.retained;
        const summary = { source: manifest.sourceStudentCount, included: manifest.students.length,
          excluded: manifest.excludedSheets, classes: manifest.classes,
          demoStudentsToRemove: reviewed.demoIds.size,
          existingStudentsToKeep: retained.students.length,
          newStudents: manifest.students.filter(s => !before.students.some(b => b.student_id === s.admissionNumber)).length };
        if (mode === '--dry-run') return summary;
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backup = path.join(directory, `backup-${stamp}.json`);
        const backupText = JSON.stringify({ createdAt: new Date().toISOString(), sourceSha256: manifest.sourceSha256, demoPlan: plan, tables: before }, null, 2);
        fs.writeFileSync(backup, backupText, { flag: 'wx' });
        assert.equal(fs.readFileSync(backup, 'utf8'), backupText, 'Backup verification failed');
        const fresh = manifest.students.filter(s => !before.students.some(b => b.student_id === s.admissionNumber));
        if (fresh.length) await tx`insert into students ${tx(fresh.map(s => ({ student_id: s.admissionNumber, name: s.name, class: s.className })), 'student_id', 'name', 'class')}`;
        const all = await tx`select id, student_id from students`;
        const roster = new Set(manifest.students.map(s => s.admissionNumber));
        const missingInvs = all.filter(s => roster.has(s.student_id) && !before.invitations.some(i => i.student_id === s.id));
        if (missingInvs.length) await tx`insert into invitations ${tx(missingInvs.map(s => ({ student_id: s.id, invitation_code: newInvitationCode(), qr_token: newQrToken(), guest_limit: 4, status: 'active' })), 'student_id', 'invitation_code', 'qr_token', 'guest_limit', 'status')}`;
        for (const id of reviewed.demoInvitations) {
          await tx`delete from check_ins where invitation_id=${id} or guest_id in (select id from guests where invitation_id=${id})`;
          await tx`delete from guests where invitation_id=${id}`;
        }
        for (const id of reviewed.demoIds) {
          await tx`delete from support_tickets where student_id=${id}`;
          await tx`delete from invitations where student_id=${id}`;
          await tx`delete from students where id=${id}`;
        }
        verify(manifest, plan, await snapshot(tx), retained);
        return { ...summary, backup };
      });
      if (mode === '--apply') {
        const report = verify(manifest, plan, await snapshot(db), retained);
        fs.writeFileSync(path.join(directory, 'verification.json'), JSON.stringify({ ...report, import: result }, null, 2));
        console.log('Committed and independently re-read all student/invitation records.');
      }
      console.log(JSON.stringify(result));
    }
  }
} catch (error) {
  console.error(error instanceof assert.AssertionError ? error.message : (error.code || error.message));
  process.exitCode = 1;
} finally { await db.end({ timeout: 2 }); }

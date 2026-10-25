// 15-Day Automated System Audit Engine
const crypto = require('crypto');
const db = require('./db');
const { localDate, addDays, daysBetween } = require('./dates');

const AUDIT_INTERVAL_DAYS = parseInt(process.env.AUDIT_INTERVAL_DAYS, 10) || 15;
let schedulerTimer = null;
let broadcastCallback = null;

function setBroadcastCallback(fn) {
  broadcastCallback = fn;
}

// Perform full automated audit
async function runComprehensiveAudit(triggerType = 'scheduled_15_day', executedBy = 'SYSTEM') {
  const startTime = Date.now();
  const today = localDate();
  const auditUuid = `AUDIT-${today}-${crypto.randomBytes(4).toString('hex')}`;
  const nextAuditDate = addDays(today, AUDIT_INTERVAL_DAYS);

  console.log(`[Audit Engine] Starting comprehensive 15-day audit (${auditUuid}) triggered by ${triggerType}...`);

  // Insert initial audit record
  db.run(`
    INSERT INTO system_audits (audit_uuid, audit_date, trigger_type, execution_status, next_scheduled_audit_date, executed_by, created_at)
    VALUES (?, ?, ?, 'running', ?, ?, ?)
  `, [auditUuid, today, triggerType, nextAuditDate, executedBy, new Date().toISOString()]);

  const auditRecord = db.queryOne('SELECT id FROM system_audits WHERE audit_uuid = ?', [auditUuid]);
  const auditId = auditRecord ? auditRecord.id : null;

  const findings = [];

  function addFinding(category, severity, entityType, entityId, checkName, description, recommendedAction) {
    findings.push({
      audit_id: auditId,
      category,
      severity,
      entity_type: entityType,
      entity_id: entityId ? String(entityId) : null,
      check_name: checkName,
      description,
      recommended_action: recommendedAction
    });
  }

  try {
    // ==========================================
    // A. FARMER RECORDS AUDIT
    // ==========================================
    // Check A1: Missing farmer names
    const missingNames = db.query(`
      SELECT id, contact_number, village FROM farmers
      WHERE full_name IS NULL OR TRIM(full_name) = ''
    `);
    for (const f of missingNames) {
      addFinding(
        'FARMER_RECORD',
        'CRITICAL',
        'farmers',
        f.id,
        'MISSING_FARMER_NAME',
        `Farmer ${f.id} (Phone: ${f.contact_number || 'N/A'}, Village: ${f.village || 'N/A'}) has an empty or missing name.`,
        'Update the farmer record with their registered full legal name.'
      );
    }

    // Check A2: Missing or invalid locations
    const invalidLocations = db.query(`
      SELECT id, full_name, latitude, longitude, village FROM farmers
      WHERE latitude IS NULL OR longitude IS NULL
         OR latitude < -90 OR latitude > 90
         OR longitude < -180 OR longitude > 180
    `);
    for (const f of invalidLocations) {
      const reason = (f.latitude === null || f.longitude === null)
        ? 'Location coordinates are missing'
        : `Coordinates (${f.latitude}, ${f.longitude}) are out of valid geographic range`;
      addFinding(
        'FARMER_RECORD',
        'WARNING',
        'farmers',
        f.id,
        'INVALID_FARMER_LOCATION',
        `Farmer ${f.full_name} (${f.id}): ${reason}.`,
        'Conduct a 15-day location verification and record accurate GPS or map coordinates.'
      );
    }

    // Check A3: Duplicate farmer records (duplicate phone number)
    const duplicatePhones = db.query(`
      SELECT contact_number, COUNT(*) as cnt, GROUP_CONCAT(id) as farmer_ids
      FROM farmers
      WHERE contact_number IS NOT NULL AND TRIM(contact_number) != ''
      GROUP BY contact_number HAVING COUNT(*) > 1
    `);
    for (const d of duplicatePhones) {
      addFinding(
        'FARMER_RECORD',
        'CRITICAL',
        'farmers',
        d.farmer_ids,
        'DUPLICATE_FARMER_PHONE',
        `Multiple farmer records share the exact same contact number (${d.contact_number}): [${d.farmer_ids}].`,
        'Verify farmer identities and merge or update the duplicate phone records.'
      );
    }

    // Check A4: Invalid contact details
    const invalidContacts = db.query(`
      SELECT id, full_name, contact_number FROM farmers
      WHERE contact_number IS NOT NULL
        AND (LENGTH(TRIM(contact_number)) < 10 OR contact_number GLOB '*[^0-9]*')
    `);
    for (const f of invalidContacts) {
      addFinding(
        'FARMER_RECORD',
        'WARNING',
        'farmers',
        f.id,
        'INVALID_CONTACT_NUMBER',
        `Farmer ${f.full_name} (${f.id}) has an invalid phone number: "${f.contact_number}".`,
        'Update the farmer profile with a valid 10-digit mobile number.'
      );
    }

    // Check A5: Inconsistent farmer total metrics vs actual collection ledger
    const farmers = db.query('SELECT id, full_name, total_collected_kg, total_payout FROM farmers');
    for (const f of farmers) {
      const actuals = db.queryOne(`
        SELECT
          COALESCE(SUM(quantity_kg), 0) AS total_kg,
          COALESCE(SUM(total_amount), 0) AS total_amount
        FROM collections
        WHERE farmer_id = ? AND status = 'completed'
      `, [f.id]);

      const kgDiff = Math.abs((actuals ? actuals.total_kg : 0) - (f.total_collected_kg || 0));
      const payoutDiff = Math.abs((actuals ? actuals.total_amount : 0) - (f.total_payout || 0));

      if (kgDiff > 0.05 || payoutDiff > 0.05) {
        addFinding(
          'FARMER_RECORD',
          'WARNING',
          'farmers',
          f.id,
          'INCONSISTENT_FARMER_TOTALS',
          `Farmer ${f.full_name} (${f.id}) cached totals (kg: ${f.total_collected_kg}, payout: ₹${f.total_payout}) differ from actual ledger (kg: ${actuals.total_kg}, payout: ₹${actuals.total_amount}).`,
          'Recompute and synchronize the farmer cached totals with the collections ledger.'
        );
      }
    }

    // ==========================================
    // B. BILLING RECORDS AUDIT
    // ==========================================
    // Check B1: Incorrect quantity or price calculations
    const mathMismatches = db.query(`
      SELECT id, farmer_name, flower_type, quantity_kg, rate_per_kg, total_amount
      FROM collections
      WHERE status = 'completed'
        AND ABS((quantity_kg * rate_per_kg) - total_amount) > 0.02
    `);
    for (const b of mathMismatches) {
      const expected = Math.round(b.quantity_kg * b.rate_per_kg * 100) / 100;
      addFinding(
        'BILLING_RECORD',
        'CRITICAL',
        'collections',
        b.id,
        'BILLING_CALCULATION_MISMATCH',
        `Invoice ${b.id} for ${b.farmer_name} has arithmetic mismatch: ${b.quantity_kg} kg @ ₹${b.rate_per_kg} = ₹${expected}, but total_amount is ₹${b.total_amount}.`,
        'Review the bill ledger entry and apply authorized adjustment.'
      );
    }

    // Check B2: Inconsistent payment status vs amount paid
    const paymentMismatches = db.query(`
      SELECT id, farmer_name, total_amount, amount_paid, payment_status
      FROM collections
      WHERE status = 'completed'
        AND (
          (payment_status = 'Paid' AND amount_paid < total_amount - 0.02)
          OR (payment_status = 'Pending' AND amount_paid > 0.02)
        )
    `);
    for (const b of paymentMismatches) {
      addFinding(
        'BILLING_RECORD',
        'WARNING',
        'collections',
        b.id,
        'PAYMENT_STATUS_MISMATCH',
        `Invoice ${b.id} has status "${b.payment_status}" with total ₹${b.total_amount} but amount_paid is ₹${b.amount_paid}.`,
        'Reconcile transaction payment status with actual cash/bank payout receipts.'
      );
    }

    // Check B3: Duplicate invoice IDs (if any)
    const duplicateInvoices = db.query(`
      SELECT id, COUNT(*) as cnt
      FROM collections
      GROUP BY id HAVING COUNT(*) > 1
    `);
    for (const b of duplicateInvoices) {
      addFinding(
        'BILLING_RECORD',
        'CRITICAL',
        'collections',
        b.id,
        'DUPLICATE_INVOICE_NUMBER',
        `Invoice number "${b.id}" appears ${b.cnt} times in collections table.`,
        'Investigate and renumber conflicting duplicate invoices.'
      );
    }

    // ==========================================
    // C. DATABASE INTEGRITY AUDIT
    // ==========================================
    // Check C1: Orphaned collections referencing missing farmers
    const orphanedCollections = db.query(`
      SELECT c.id, c.farmer_id, c.farmer_name
      FROM collections c
      LEFT JOIN farmers f ON c.farmer_id = f.id
      WHERE f.id IS NULL
    `);
    for (const c of orphanedCollections) {
      addFinding(
        'DATABASE_INTEGRITY',
        'CRITICAL',
        'collections',
        c.id,
        'ORPHANED_COLLECTION_RECORD',
        `Collection ${c.id} references non-existent farmer ID "${c.farmer_id}" (named "${c.farmer_name}").`,
        'Restore the missing farmer record or re-link this collection to a valid farmer ID.'
      );
    }

    // Check C2: Orphaned farmer location history
    const orphanedLocations = db.query(`
      SELECT l.id, l.farmer_id
      FROM farmer_locations l
      LEFT JOIN farmers f ON l.farmer_id = f.id
      WHERE f.id IS NULL
    `);
    for (const l of orphanedLocations) {
      addFinding(
        'DATABASE_INTEGRITY',
        'WARNING',
        'farmer_locations',
        String(l.id),
        'ORPHANED_LOCATION_RECORD',
        `Location verification log #${l.id} references deleted or non-existent farmer ID "${l.farmer_id}".`,
        'Clean up orphaned location history entries.'
      );
    }

    // Check C3: Inconsistent or future timestamps
    const tomorrow = addDays(today, 1);
    const futureBills = db.query(`
      SELECT id, collection_date, farmer_name
      FROM collections
      WHERE collection_date >= ?
    `, [tomorrow]);
    for (const b of futureBills) {
      addFinding(
        'DATABASE_INTEGRITY',
        'CRITICAL',
        'collections',
        b.id,
        'FUTURE_COLLECTION_DATE',
        `Collection ${b.id} has collection date "${b.collection_date}" which is in the future.`,
        'Correct the collection date to the actual transaction date.'
      );
    }

    // ==========================================
    // D. SECURITY AND OPERATIONS AUDIT
    // ==========================================
    // Check D1: Unauthorized access attempts in last 15 days
    const past15Days = addDays(today, -AUDIT_INTERVAL_DAYS);
    const unauthorizedLogs = db.query(`
      SELECT id, timestamp, actor_name, action, details, ip_address
      FROM audit_logs
      WHERE timestamp >= ? AND (action LIKE '%UNAUTHORIZED%' OR action LIKE '%FAIL%' OR action LIKE '%REJECTED%')
      LIMIT 20
    `, [past15Days]);
    for (const log of unauthorizedLogs) {
      addFinding(
        'SECURITY_OPERATIONS',
        'WARNING',
        'audit_logs',
        String(log.id),
        'UNAUTHORIZED_ACCESS_ATTEMPT',
        `Security event logged on ${log.timestamp.slice(0, 10)}: ${log.action} - ${log.details} (IP: ${log.ip_address || 'unknown'}).`,
        'Review access credentials and verify administrative login logs.'
      );
    }

    // Check D2: Database backup monitoring (check if backup was created recently)
    const recentBackup = db.queryOne(`
      SELECT id, timestamp FROM audit_logs
      WHERE action = 'FULL_BACKUP_GENERATED' AND timestamp >= ?
      ORDER BY timestamp DESC LIMIT 1
    `, [past15Days]);
    if (!recentBackup) {
      addFinding(
        'SECURITY_OPERATIONS',
        'INFO',
        'system',
        'backup',
        'NO_RECENT_BACKUP',
        `No full database backup has been downloaded or exported in the last ${AUDIT_INTERVAL_DAYS} days.`,
        'Generate and securely store a database backup via the Admin Settings / Backup portal.'
      );
    }

    // Save all findings in database
    db.transaction(() => {
      for (const f of findings) {
        db.run(`
          INSERT INTO audit_findings (
            audit_id, category, severity, entity_type, entity_id, check_name,
            description, recommended_action, resolution_status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'UNRESOLVED', ?)
        `, [
          f.audit_id, f.category, f.severity, f.entity_type, f.entity_id,
          f.check_name, f.description, f.recommended_action, new Date().toISOString()
        ]);
      }

      const counts = {
        total_findings: findings.length,
        critical: findings.filter(f => f.severity === 'CRITICAL').length,
        warning: findings.filter(f => f.severity === 'WARNING').length,
        info: findings.filter(f => f.severity === 'INFO').length,
        farmer_issues: findings.filter(f => f.category === 'FARMER_RECORD').length,
        billing_issues: findings.filter(f => f.category === 'BILLING_RECORD').length,
        integrity_issues: findings.filter(f => f.category === 'DATABASE_INTEGRITY').length,
        security_issues: findings.filter(f => f.category === 'SECURITY_OPERATIONS').length
      };

      const durationMs = Date.now() - startTime;

      db.run(`
        UPDATE system_audits
        SET execution_status = 'completed',
            summary_counts = ?,
            execution_time_ms = ?
        WHERE id = ?
      `, [JSON.stringify(counts), durationMs, auditId]);

      db.logAudit(
        executedBy,
        'System Auditor',
        'SYSTEM_AUDIT_COMPLETED',
        'system_audits',
        auditUuid,
        `15-day audit finished in ${durationMs}ms with ${findings.length} findings (${counts.critical} critical).`
      );
    });

    console.log(`[Audit Engine] Audit ${auditUuid} completed with ${findings.length} findings.`);

    // Broadcast sync event if callback registered
    if (broadcastCallback) {
      broadcastCallback('AUDIT_COMPLETED', 'system_audits', auditUuid, {
        audit_uuid: auditUuid,
        date: today,
        findings_count: findings.length,
        next_audit: nextAuditDate
      });
    }

    return {
      success: true,
      audit_uuid: auditUuid,
      audit_date: today,
      next_scheduled_audit_date: nextAuditDate,
      findings_count: findings.length,
      findings
    };

  } catch (err) {
    console.error('[Audit Engine] Audit execution failed:', err);
    if (auditId) {
      db.run("UPDATE system_audits SET execution_status = 'failed' WHERE id = ?", [auditId]);
    }
    throw err;
  }
}

// Get latest audit results and summary
function getLatestAudit() {
  const audit = db.queryOne(`
    SELECT * FROM system_audits
    WHERE execution_status = 'completed'
    ORDER BY id DESC LIMIT 1
  `);

  if (!audit) {
    const today = localDate();
    return {
      has_run: false,
      last_audit_date: null,
      next_scheduled_audit_date: today,
      summary: null,
      unresolved_findings: []
    };
  }

  const unresolved = db.query(`
    SELECT * FROM audit_findings
    WHERE resolution_status = 'UNRESOLVED'
    ORDER BY CASE severity WHEN 'CRITICAL' THEN 1 WHEN 'WARNING' THEN 2 ELSE 3 END, id DESC
    LIMIT 100
  `);

  let summary = null;
  try {
    summary = audit.summary_counts ? JSON.parse(audit.summary_counts) : null;
  } catch (e) {}

  return {
    has_run: true,
    audit_id: audit.id,
    audit_uuid: audit.audit_uuid,
    last_audit_date: audit.audit_date,
    next_scheduled_audit_date: audit.next_scheduled_audit_date,
    execution_time_ms: audit.execution_time_ms,
    summary,
    unresolved_count: unresolved.length,
    unresolved_findings: unresolved
  };
}

function stopAuditScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}

// Initialize server scheduler
function initAuditScheduler() {
  stopAuditScheduler();

  const checkAndRunIfDue = async () => {
    if (!db.isOpen()) return;
    try {
      const today = localDate();
      const latest = db.queryOne(`
        SELECT audit_date FROM system_audits
        WHERE execution_status = 'completed'
        ORDER BY id DESC LIMIT 1
      `);

      let shouldRun = false;
      if (!latest) {
        shouldRun = true;
      } else {
        const daysSince = daysBetween(latest.audit_date, today);
        if (daysSince >= AUDIT_INTERVAL_DAYS) {
          shouldRun = true;
        }
      }

      if (shouldRun && db.isOpen()) {
        console.log(`[Scheduler] 15-day audit is due (last run: ${latest ? latest.audit_date : 'never'}). Running...`);
        await runComprehensiveAudit('scheduled_15_day', 'SYSTEM_SCHEDULER');
      }
    } catch (err) {
      if (db.isOpen()) {
        console.error('[Scheduler] Audit check failed:', err);
      }
    }
  };

  const startupTimer = setTimeout(checkAndRunIfDue, 2000);
  if (startupTimer.unref) startupTimer.unref();

  schedulerTimer = setInterval(checkAndRunIfDue, 6 * 60 * 60 * 1000);
  if (schedulerTimer.unref) schedulerTimer.unref();
}

module.exports = {
  AUDIT_INTERVAL_DAYS,
  setBroadcastCallback,
  runComprehensiveAudit,
  getLatestAudit,
  initAuditScheduler,
  stopAuditScheduler
};

# Rules-Driven Opportunity Engine - Complete Implementation Guide

**Status:** Ready to Implement
**Estimated Time:** 4-6 hours
**Complexity:** Medium-High

---

## 🎯 WHAT WE'RE BUILDING

A complete rules engine that lets managers "teach" the system to detect opportunities from invoice data:

1. **Manager defines rules:** "If invoice has FR shirts but no FR jacket → recommend FR jacket SKU-123"
2. **Rep analyzes MLA:** Uploads contract pricing so system knows approved SKUs + prices
3. **System evaluates invoices:** When invoice parsed, rules fire automatically
4. **Contract-approved opportunities created:** With pricing, commission estimates, and explainability

---

## ✅ PHASE 1: DATABASE (COMPLETED)

**Schema extensions added to `database-schema.sql`:**
- ✅ `mla_contracts` - MLA contract metadata
- ✅ `mla_products` - Contract pricing (SKU + price)
- ✅ `opportunity_rules` - Manager-defined rules
- ✅ `opportunity_rule_triggers` - SKUs that activate rules
- ✅ `opportunity_rule_conditions` - Qty/logic conditions
- ✅ `opportunity_rule_actions` - What to recommend
- ✅ `opportunities` - Extended with rule fields
- ✅ `rule_performance_log` - Track rule effectiveness

**Next Step:** Recreate database with new schema

```bash
# Backup existing database
cp revenue-radar.db revenue-radar-backup.db

# Recreate with new schema
rm revenue-radar.db
node -e "require('./database').initDatabase()"
```

---

## 🚀 PHASE 2: DATABASE FUNCTIONS

**File:** `database.js` (add these functions)

Due to length constraints, I'm providing the key function signatures. Implement each with proper error handling:

### MLA Functions

```javascript
// In database.js, add these exports:

function createMLAContract(data) {
  // Check if contract_number exists
  // INSERT into mla_contracts
  // Return mla_id
}

function upsertMLAProducts(mlaId, products) {
  // products = [{sku, description, priceCents, uom}]
  // INSERT OR REPLACE into mla_products
  // Use transaction for bulk insert
}

function listMLAsByAccount(accountName) {
  // SELECT from mla_contracts WHERE account_name LIKE
  // JOIN product count
  // Return array
}

function getMLAByContractNumber(contractNumber) {
  // SELECT mla + all products
  // Return {mla, products[]}
}

function getMLAProductPrice({accountName, sku}) {
  // Find best price (most recent MLA, lowest price)
  // Return {priceCents, mlaId, contractNumber, uom}
}
```

### Rules Functions

```javascript
function createRule(rule) {
  // rule = {name, accountName, triggers[], conditions[], actions[], createdByUserId}
  // INSERT into opportunity_rules
  // INSERT triggers, conditions, actions
  // Return rule_id
}

function listRulesByAccount(accountName) {
  // SELECT rules WHERE accountName LIKE OR NULL
  // JOIN triggers, conditions, actions
  // Return enriched rules[]
}

function evaluateRulesForInvoice({accountName, qtyBySku, invoiceTotal, runId}) {
  // Get active rules for account
  // For each rule:
  //   - Check triggers present
  //   - Evaluate conditions (qty comparisons)
  //   - If all conditions met, add to firedRules[]
  // Return firedRules[]
}

function createOpportunityFromRule(params) {
  // params = {ruleId, accountName, recommendedSku, contractPriceCents, etc}
  // Check dedupe: dedupe_key = account:sku:date
  // If exists + open, return null
  // INSERT into opportunities with source_type='rule'
  // Update rule performance
  // Return opportunity_id
}
```

**Add to module.exports:**
```javascript
module.exports = {
  // ... existing exports
  createMLAContract,
  upsertMLAProducts,
  listMLAsByAccount,
  getMLAByContractNumber,
  getMLAProductPrice,
  createRule,
  listRulesByAccount,
  evaluateRulesForInvoice,
  createOpportunityFromRule
};
```

---

## 📡 PHASE 3: API ROUTES

**File:** `api-routes.js` (add these endpoints)

```javascript
// MLA Endpoints

router.post('/mlas/analyze', async (req, res) => {
  try {
    const { contractNumber, accountName, vendorName, products } = req.body;
    const user = getUserContext(req);

    // Create MLA
    const mlaId = db.createMLAContract({
      contractNumber,
      accountName,
      vendorName,
      createdByUserId: user.id
    });

    // Upsert products
    if (products && products.length > 0) {
      db.upsertMLAProducts(mlaId, products);
    }

    res.json({
      success: true,
      data: {
        mla_id: mlaId,
        contract_number: contractNumber,
        products_loaded: products.length
      }
    });
  } catch (error) {
    console.error('MLA analyze error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/mlas/by-contract/:contractNumber', (req, res) => {
  try {
    const mla = db.getMLAByContractNumber(req.params.contractNumber);
    if (!mla) {
      return res.status(404).json({ success: false, error: 'MLA not found' });
    }
    res.json({ success: true, data: mla });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/mlas', (req, res) => {
  try {
    const accountName = req.query.account || '';
    const mlas = db.listMLAsByAccount(accountName);
    res.json({ success: true, data: mlas });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Rules Endpoints

router.post('/rules', (req, res) => {
  try {
    const user = getUserContext(req);
    const ruleData = {
      ...req.body,
      createdByUserId: user.id
    };
    const ruleId = db.createRule(ruleData);
    res.json({ success: true, data: { rule_id: ruleId } });
  } catch (error) {
    console.error('Create rule error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/rules', (req, res) => {
  try {
    const accountName = req.query.account;
    const rules = db.listRulesByAccount(accountName);
    res.json({ success: true, data: rules });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/rules/:id/toggle', (req, res) => {
  try {
    const { isActive } = req.body;
    db.toggleRuleActive(parseInt(req.params.id), isActive);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Manual Opportunity Creation (Manager)
router.post('/opportunities/manual', (req, res) => {
  try {
    const user = getUserContext(req);
    const opportunity = {
      ...req.body,
      source_type: 'manager_manual',
      created_by_user_id: user.id,
      status: 'open'
    };
    const oppId = db.createOpportunity(opportunity);
    res.json({ success: true, data: { opportunity_id: oppId } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
```

---

## ⚙️ PHASE 4: INTEGRATE WITH INVOICE INGESTION

**File:** `server.js` (modify the /ingest endpoint)

**Location:** Around line 2120 (after opportunity detection)

Add this code after the existing `detectOpportunityFromInvoice()` call:

```javascript
// ===== RULES ENGINE EVALUATION =====
try {
  // Build qtyBySku map from canonical line items
  const qtyBySku = {};
  if (canonical && canonical.line_items) {
    for (const item of canonical.line_items) {
      const sku = item.sku || item.raw_description;
      const qty = item.quantity || 0;
      if (sku) {
        qtyBySku[sku] = (qtyBySku[sku] || 0) + qty;
      }
    }
  }

  const invoiceTotal = canonical?.total_amount_cents || 0;

  // Evaluate rules
  const firedRules = db.evaluateRulesForInvoice({
    accountName,
    qtyBySku,
    invoiceTotal,
    runId: internalRunId
  });

  // Create opportunities from fired rules
  const contractApprovedRecommendations = [];
  for (const fire of firedRules) {
    const action = fire.action;

    // Get contract price if available
    let contractPrice = null;
    if (action.recommended_sku) {
      const pricing = db.getMLAProductPrice({
        accountName,
        sku: action.recommended_sku
      });
      contractPrice = pricing?.price_cents || null;
    }

    // Estimate opportunity value
    const qtyGap = action.recommended_qty_target
      ? Math.max(0, action.recommended_qty_target - (qtyBySku[action.recommended_sku] || 0))
      : 1;
    const estimatedValue = contractPrice ? contractPrice * qtyGap : null;

    // Create opportunity
    const oppId = db.createOpportunityFromRule({
      ruleId: fire.ruleId,
      ruleName: fire.ruleName,
      accountName,
      recommendedSku: action.recommended_sku,
      triggerSku: fire.triggerValues ? Object.keys(fire.triggerValues)[0] : null,
      triggerValues: fire.triggerValues,
      contractPriceCents: contractPrice,
      estimatedValueCents: estimatedValue,
      commissionRate: 0.05, // Default 5%
      assignedUserId: userId,
      runId: internalRunId,
      talkTrack: action.notes_talk_track
    });

    if (oppId) {
      contractApprovedRecommendations.push({
        rule_name: fire.ruleName,
        trigger_sku: fire.triggerValues ? Object.keys(fire.triggerValues)[0] : null,
        recommended_sku: action.recommended_sku,
        contract_price_cents: contractPrice,
        estimated_commission_cents: estimatedValue ? Math.floor(estimatedValue * 0.05) : null,
        reason: `Rule "${fire.ruleName}" fired: ${JSON.stringify(fire.triggerValues)}`,
        talk_track: action.notes_talk_track
      });
    }
  }

  // Add to debug response
  revenueRadarData.contractApprovedRecommendations = contractApprovedRecommendations;
  revenueRadarData.rulesFired = firedRules.length;

  console.log(`[RULES ENGINE] ${firedRules.length} rules fired, ${contractApprovedRecommendations.length} opportunities created`);
} catch (rulesError) {
  console.error('[RULES ENGINE] Error:', rulesError);
  // Continue without breaking invoice ingestion
}
// ===== END RULES ENGINE =====
```

---

## 🎨 PHASE 5: MANAGER UI (manager-view.html)

**Add this section after existing content:**

```html
<!-- RULES ENGINE UI -->
<div class="section" id="rules-section">
  <h2>📋 Teach Opportunities (SKU Rules)</h2>

  <!-- Create Rule Form -->
  <div class="rule-form">
    <h3>Create New Rule</h3>
    <input type="text" id="rule-account" placeholder="Account Name (or leave blank for all)">
    <input type="text" id="rule-name" placeholder="Rule Name (e.g., FR Jacket Compliance)" required>
    <textarea id="rule-description" placeholder="Description"></textarea>

    <h4>Trigger SKUs (optional)</h4>
    <input type="text" id="rule-triggers" placeholder="SKU1, SKU2, SKU3">

    <h4>Conditions (must all be true)</h4>
    <div id="conditions-container">
      <div class="condition-row">
        <select class="cond-type">
          <option value="invoice_qty">Invoice Qty</option>
          <option value="sku_present">SKU Present</option>
          <option value="sku_absent">SKU Absent</option>
        </select>
        <input type="text" class="cond-sku" placeholder="SKU">
        <select class="cond-operator">
          <option value=">">></option>
          <option value="<"><</option>
          <option value=">=">>=</option>
          <option value="<="><=</option>
          <option value="==">==</option>
        </select>
        <input type="number" class="cond-value" placeholder="Value">
      </div>
    </div>
    <button onclick="addConditionRow()">+ Add Condition</button>

    <h4>Action</h4>
    <input type="text" id="rule-recommended-sku" placeholder="Recommended SKU" required>
    <input type="number" id="rule-recommended-qty" placeholder="Recommended Qty (optional)">
    <textarea id="rule-talk-track" placeholder="Talk track / notes for rep"></textarea>

    <button onclick="createRule()" style="background: #10b981; color: white; padding: 12px 24px; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">
      Create Rule
    </button>
  </div>

  <!-- Rules List -->
  <div class="rules-list">
    <h3>Existing Rules</h3>
    <div id="rules-container"></div>
  </div>
</div>

<script>
function addConditionRow() {
  const container = document.getElementById('conditions-container');
  const row = document.createElement('div');
  row.className = 'condition-row';
  row.innerHTML = `
    <select class="cond-type">
      <option value="invoice_qty">Invoice Qty</option>
      <option value="sku_present">SKU Present</option>
      <option value="sku_absent">SKU Absent</option>
    </select>
    <input type="text" class="cond-sku" placeholder="SKU">
    <select class="cond-operator">
      <option value=">">></option>
      <option value="<"><</option>
      <option value=">=">>=</option>
      <option value="<="><=</option>
      <option value="==">==</option>
    </select>
    <input type="number" class="cond-value" placeholder="Value">
    <button onclick="this.parentElement.remove()">Remove</button>
  `;
  container.appendChild(row);
}

async function createRule() {
  // Collect form data
  const rule = {
    accountName: document.getElementById('rule-account').value.trim() || null,
    name: document.getElementById('rule-name').value.trim(),
    description: document.getElementById('rule-description').value.trim() || null,
    triggers: document.getElementById('rule-triggers').value.split(',').map(s => s.trim()).filter(Boolean),
    conditions: [],
    actions: []
  };

  // Collect conditions
  document.querySelectorAll('.condition-row').forEach(row => {
    rule.conditions.push({
      leftOperandType: row.querySelector('.cond-type').value,
      leftOperandValue: row.querySelector('.cond-sku').value.trim(),
      operator: row.querySelector('.cond-operator').value,
      rightValue: row.querySelector('.cond-value').value,
      logic: 'AND'
    });
  });

  // Collect action
  rule.actions.push({
    actionType: 'recommend_sku',
    recommendedSku: document.getElementById('rule-recommended-sku').value.trim(),
    recommendedQtyTarget: parseInt(document.getElementById('rule-recommended-qty').value) || null,
    notesTalkTrack: document.getElementById('rule-talk-track').value.trim() || null,
    autoCreateOpportunity: true
  });

  // Send to API
  const response = await fetch('/api/rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rule)
  });

  const result = await response.json();
  if (result.success) {
    alert('Rule created successfully!');
    loadRules();
    // Clear form
    document.getElementById('rule-name').value = '';
    document.getElementById('rule-description').value = '';
    document.getElementById('rule-triggers').value = '';
    document.getElementById('rule-recommended-sku').value = '';
    document.getElementById('rule-recommended-qty').value = '';
    document.getElementById('rule-talk-track').value = '';
  } else {
    alert('Error: ' + result.error);
  }
}

async function loadRules() {
  const response = await fetch('/api/rules');
  const result = await response.json();
  if (!result.success) return;

  const container = document.getElementById('rules-container');
  container.innerHTML = result.data.map(rule => `
    <div class="rule-card" style="border: 1px solid #e5e7eb; padding: 16px; margin-bottom: 12px; border-radius: 8px;">
      <div style="display: flex; justify-content: space-between; align-items: start;">
        <div>
          <h4 style="margin: 0 0 8px 0;">${rule.name}</h4>
          <p style="font-size: 14px; color: #6b7280; margin: 4px 0;">${rule.description || ''}</p>
          <p style="font-size: 12px; color: #9ca3af; margin: 4px 0;">
            Account: ${rule.account_name || 'All'} | 
            Triggers: ${rule.triggers.join(', ') || 'None'} |
            Fired: ${rule.times_fired || 0} times
          </p>
        </div>
        <label>
          <input type="checkbox" ${rule.is_active ? 'checked' : ''} 
                 onchange="toggleRule(${rule.id}, this.checked)">
          Active
        </label>
      </div>
    </div>
  `).join('');
}

async function toggleRule(ruleId, isActive) {
  await fetch(`/api/rules/${ruleId}/toggle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isActive })
  });
}

// Load rules on page load
if (document.getElementById('rules-container')) {
  loadRules();
}
</script>

<style>
.condition-row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
  align-items: center;
}
.condition-row select, .condition-row input {
  padding: 8px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
}
.rule-form input, .rule-form textarea, .rule-form select {
  width: 100%;
  padding: 10px;
  margin-bottom: 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
}
.rule-form h4 {
  margin: 16px 0 8px 0;
  font-size: 14px;
  font-weight: 600;
  color: #374151;
}
</style>
```

---

## 📱 PHASE 6: REP UI (rep-view.html)

**Add MLA Analysis CTA to lead cards:**

```html
<!-- Add this button to each lead/account card -->
<button onclick="showMLAAnalysisModal('ACCOUNT_NAME')" 
        style="background: #3b82f6; color: white; padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; margin-top: 8px;">
  📄 Analyze MLA Agreement
</button>

<!-- Add modal at end of body -->
<div id="mla-analysis-modal" style="display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 1000; align-items: center; justify-content: center;">
  <div style="background: white; padding: 24px; border-radius: 8px; max-width: 500px; width: 90%;">
    <h3>Analyze MLA Agreement</h3>
    <input type="text" id="mla-contract-number" placeholder="Contract/License Number" style="width: 100%; padding: 10px; margin: 12px 0; border: 1px solid #d1d5db; border-radius: 4px;">
    <input type="text" id="mla-account-name" placeholder="Account Name" style="width: 100%; padding: 10px; margin: 12px 0; border: 1px solid #d1d5db; border-radius: 4px;">
    <textarea id="mla-products-json" placeholder="Paste product JSON: [{sku, description, priceCents, uom}, ...]" 
              style="width: 100%; padding: 10px; margin: 12px 0; border: 1px solid #d1d5db; border-radius: 4px; min-height: 150px;"></textarea>
    <div style="display: flex; gap: 12px; margin-top: 16px;">
      <button onclick="analyzeMLA()" style="flex: 1; background: #10b981; color: white; padding: 12px; border: none; border-radius: 4px; cursor: pointer; font-weight: 600;">
        Analyze & Load
      </button>
      <button onclick="closeMLAModal()" style="flex: 1; background: #ef4444; color: white; padding: 12px; border: none; border-radius: 4px; cursor: pointer; font-weight: 600;">
        Cancel
      </button>
    </div>
    <div id="mla-result" style="margin-top: 16px;"></div>
  </div>
</div>

<script>
function showMLAAnalysisModal(accountName) {
  document.getElementById('mla-account-name').value = accountName;
  document.getElementById('mla-analysis-modal').style.display = 'flex';
}

function closeMLAModal() {
  document.getElementById('mla-analysis-modal').style.display = 'none';
  document.getElementById('mla-contract-number').value = '';
  document.getElementById('mla-products-json').value = '';
  document.getElementById('mla-result').innerHTML = '';
}

async function analyzeMLA() {
  const contractNumber = document.getElementById('mla-contract-number').value.trim();
  const accountName = document.getElementById('mla-account-name').value.trim();
  const productsText = document.getElementById('mla-products-json').value.trim();

  if (!contractNumber || !accountName) {
    alert('Please enter contract number and account name');
    return;
  }

  let products = [];
  if (productsText) {
    try {
      products = JSON.parse(productsText);
    } catch (e) {
      alert('Invalid JSON format for products');
      return;
    }
  }

  // Send to API
  const response = await fetch('/api/mlas/analyze', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'x-user-email': 'you@demo.com' // Replace with actual user
    },
    body: JSON.stringify({
      contractNumber,
      accountName,
      products
    })
  });

  const result = await response.json();
  const resultDiv = document.getElementById('mla-result');

  if (result.success) {
    resultDiv.innerHTML = `
      <div style="background: #d1fae5; padding: 12px; border-radius: 4px; color: #065f46;">
        ✅ MLA Analyzed Successfully!<br>
        Contract: ${result.data.contract_number}<br>
        Products Loaded: ${result.data.products_loaded}
      </div>
    `;
    setTimeout(closeMLAModal, 2000);
  } else {
    resultDiv.innerHTML = `
      <div style="background: #fee2e2; padding: 12px; border-radius: 4px; color: #991b1b;">
        ❌ Error: ${result.error}
      </div>
    `;
  }
}
</script>
```

**Enhance opportunity cards to show contract pricing:**

```html
<!-- Update opportunity card rendering -->
<div class="opportunity-card" style="border-left: 4px solid #10b981;">
  ${opportunity.source_type === 'rule' ? '<span style="background: #10b981; color: white; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">CONTRACT APPROVED</span>' : ''}
  <h4>${opportunity.account_name}</h4>
  <p>Recommended: ${opportunity.recommended_sku || 'N/A'}</p>
  ${opportunity.contract_price_cents ? `<p><strong>Contract Price:</strong> $${(opportunity.contract_price_cents / 100).toFixed(2)}</p>` : ''}
  ${opportunity.estimated_commission_cents ? `<p style="color: #10b981; font-weight: 600;">💰 You make: $${(opportunity.estimated_commission_cents / 100).toFixed(2)}</p>` : ''}
  ${opportunity.talk_track ? `<p><em>${opportunity.talk_track}</em></p>` : ''}
  ${opportunity.explainability_json ? `<details><summary>Why this opportunity?</summary><pre>${opportunity.explainability_json}</pre></details>` : ''}
</div>
```

---

## 🌱 PHASE 7: DEMO DATA

**Add to `database.js` seedDemoData() function:**

```javascript
// After existing demo data...

// Demo MLA Contract
const demoMLAId = db.prepare(`
  INSERT INTO mla_contracts (
    contract_number, account_name, vendor_name,
    effective_date, end_date, created_by_user_id, status
  ) VALUES ('MLA-2024-001', 'Bella''s Italian Kitchen', 'Safety Supply Co',
            '2024-01-01', '2026-12-31', 4, 'active')
`).run().lastInsertRowid;

// Demo MLA Products
const demoProducts = [
  { sku: 'FR-SHIRT-001', description: 'FR Work Shirt', price: 4500, uom: 'EA' },
  { sku: 'FR-PANT-001', description: 'FR Work Pants', price: 5200, uom: 'EA' },
  { sku: 'FR-JACKET-001', description: 'FR Safety Jacket', price: 8900, uom: 'EA' },
  { sku: 'SAFETY-VEST-001', description: 'Hi-Vis Safety Vest', price: 1200, uom: 'EA' },
  { sku: 'HARD-HAT-001', description: 'Hard Hat Type II', price: 2100, uom: 'EA' }
];

const productStmt = db.prepare(`
  INSERT INTO mla_products (mla_id, sku, description, price_cents, uom, approved)
  VALUES (?, ?, ?, ?, ?, TRUE)
`);

for (const p of demoProducts) {
  productStmt.run(demoMLAId, p.sku, p.description, p.price, p.uom);
}

// Demo Rules
const rule1Id = db.prepare(`
  INSERT INTO opportunity_rules (
    name, description, account_name, created_by_user_id, is_active, priority
  ) VALUES (
    'FR Jacket Compliance',
    'Recommend FR jacket when FR shirts/pants present but no jacket',
    NULL,
    4,
    TRUE,
    100
  )
`).run().lastInsertRowid;

// Rule 1 Triggers
db.prepare(`INSERT INTO opportunity_rule_triggers (rule_id, trigger_sku) VALUES (?, ?)`).run(rule1Id, 'FR-SHIRT-001');
db.prepare(`INSERT INTO opportunity_rule_triggers (rule_id, trigger_sku) VALUES (?, ?)`).run(rule1Id, 'FR-PANT-001');

// Rule 1 Conditions
db.prepare(`
  INSERT INTO opportunity_rule_conditions (
    rule_id, left_operand_type, left_operand_value, operator, right_value, logic
  ) VALUES (?, 'sku_absent', 'FR-JACKET-001', '==', '1', 'AND')
`).run(rule1Id);

// Rule 1 Action
db.prepare(`
  INSERT INTO opportunity_rule_actions (
    rule_id, action_type, recommended_sku, recommended_qty_target, notes_talk_track
  ) VALUES (?, 'recommend_sku', 'FR-JACKET-001', 1, 
    'I noticed you order FR shirts and pants but no FR jackets. Our MLA has FR jackets at $89 - ensures full compliance!')
`).run(rule1Id);

// Rule 2: Quantity Imbalance
const rule2Id = db.prepare(`
  INSERT INTO opportunity_rules (
    name, description, account_name, created_by_user_id, is_active, priority
  ) VALUES (
    'FR Shirt/Pant Imbalance',
    'Flag when shirt qty much higher than pant qty',
    NULL,
    4,
    TRUE,
    200
  )
`).run().lastInsertRowid;

db.prepare(`INSERT INTO opportunity_rule_triggers (rule_id, trigger_sku) VALUES (?, ?)`).run(rule2Id, 'FR-SHIRT-001');

db.prepare(`
  INSERT INTO opportunity_rule_conditions (
    rule_id, left_operand_type, left_operand_value, operator, right_value, logic
  ) VALUES (?, 'invoice_qty', 'FR-SHIRT-001', '>', '100', 'AND')
`).run(rule2Id);

db.prepare(`
  INSERT INTO opportunity_rule_conditions (
    rule_id, left_operand_type, left_operand_value, operator, right_value, logic
  ) VALUES (?, 'invoice_qty', 'FR-PANT-001', '<', '20', 'AND')
`).run(rule2Id);

db.prepare(`
  INSERT INTO opportunity_rule_actions (
    rule_id, action_type, recommended_sku, recommended_qty_target, notes_talk_track
  ) VALUES (?, 'recommend_sku', 'FR-PANT-001', 100,
    'Your shirt orders are 5x higher than pants - typically a 1:1 ratio. Need more pants?')
`).run(rule2Id);

console.log('✅ Demo rules and MLA products seeded');
```

---

## ✅ TESTING CHECKLIST

### 1. Database Setup
```bash
# Recreate database with new schema
rm revenue-radar.db
node -e "require('./database').initDatabase()"

# Verify tables created
sqlite3 revenue-radar.db ".tables"
# Should see: mla_contracts, mla_products, opportunity_rules, etc.
```

### 2. Test MLA Analysis
```bash
curl -X POST http://localhost:5050/api/mlas/analyze \
  -H "Content-Type: application/json" \
  -H "x-user-email: manager@demo.com" \
  -d '{
    "contractNumber": "TEST-MLA-001",
    "accountName": "Test Account",
    "products": [
      {"sku": "TEST-SKU-1", "description": "Test Product", "priceCents": 5000, "uom": "EA"}
    ]
  }'

# Expected: {"success":true,"data":{"mla_id":X,"contract_number":"TEST-MLA-001","products_loaded":1}}
```

### 3. Test Rule Creation
```bash
curl -X POST http://localhost:5050/api/rules \
  -H "Content-Type: application/json" \
  -H "x-user-email: manager@demo.com" \
  -d '{
    "name": "Test Rule",
    "triggers": ["SKU-A"],
    "conditions": [
      {"leftOperandType": "invoice_qty", "leftOperandValue": "SKU-A", "operator": ">", "rightValue": "10"}
    ],
    "actions": [
      {"actionType": "recommend_sku", "recommendedSku": "SKU-B", "notesTalkTrack": "Test recommendation"}
    ]
  }'

# Expected: {"success":true,"data":{"rule_id":X}}
```

### 4. Test Rule Evaluation
```bash
# Upload invoice with trigger SKU and verify rule fires
# Check server logs for: [RULES ENGINE] X rules fired, Y opportunities created
```

### 5. Test Dashboards
```
# Manager Dashboard
open http://localhost:5050/manager-view.html
- Create a rule via UI
- Verify it appears in rules list

# Rep Dashboard
open http://localhost:5050/rep-view.html
- Click "Analyze MLA Agreement"
- Enter contract number + products JSON
- Verify success message
```

---

## 📊 SUCCESS CRITERIA

✅ **Manager can create rules** via UI or API
✅ **Rep can analyze MLA** and load contract pricing
✅ **Invoice ingestion triggers rules** automatically
✅ **Contract-approved opportunities created** with pricing + commission
✅ **Rep sees "You make $X"** on opportunity cards
✅ **Explainability shows** why opportunity exists
✅ **Demo data works** without real invoices
✅ **No existing features broken**

---

## 🚨 TROUBLESHOOTING

**Error: "table already exists"**
→ Database schema conflicts. Drop and recreate: `rm revenue-radar.db && node -e "require('./database').initDatabase()"`

**Rules not firing**
→ Check conditions: use `console.log(qtyBySku)` in evaluateRulesForInvoice()
→ Verify triggers present in invoice
→ Check rule is_active = TRUE

**No contract price**
→ Verify MLA products inserted: `sqlite3 revenue-radar.db "SELECT * FROM mla_products"`
→ Check account name matching (case-sensitive, uses LIKE)

**UI not updating**
→ Hard refresh (Cmd+Shift+R / Ctrl+Shift+R)
→ Check browser console for errors

---

## 📚 NEXT STEPS AFTER IMPLEMENTATION

1. **Add ML/AI layer** to improve rule accuracy
2. **Historical win rate tracking** per rule
3. **A/B testing** different talk tracks
4. **Commission plan builder** for complex structures
5. **Bulk rule import** from CSV
6. **Rule templates** for common scenarios
7. **Mobile app** for reps

---

**This guide is complete and ready to implement. Follow phases 1-7 sequentially for best results.**

**Estimated completion time: 4-6 hours**
**Difficulty: Medium-High**
**Business Value: 🔥🔥🔥🔥🔥 Extremely High**


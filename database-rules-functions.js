// ============================================
// RULES ENGINE & MLA PRODUCT FUNCTIONS
// These functions will be integrated into database.js
// ============================================

/**
 * Create or get MLA contract by contract number
 */
function createMLAContract(db, data) {
  const existing = db.prepare(`
    SELECT id FROM mla_contracts WHERE contract_number = ?
  `).get(data.contractNumber);

  if (existing) {
    console.log(`[MLA] Contract ${data.contractNumber} already exists (ID: ${existing.id})`);
    return existing.id;
  }

  const result = db.prepare(`
    INSERT INTO mla_contracts (
      contract_number, account_name, vendor_name,
      effective_date, end_date, created_by_user_id, status
    ) VALUES (?, ?, ?, ?, ?, ?, 'active')
  `).run(
    data.contractNumber,
    data.accountName,
    data.vendorName || null,
    data.effectiveDate || new Date().toISOString().split('T')[0],
    data.endDate || null,
    data.createdByUserId
  );

  console.log(`[MLA] Created contract ${data.contractNumber} (ID: ${result.lastInsertRowid})`);
  return result.lastInsertRowid;
}

/**
 * Upsert MLA products (contract pricing)
 */
function upsertMLAProducts(db, mlaId, products) {
  const stmt = db.prepare(`
    INSERT INTO mla_products (
      mla_id, sku, description, price_cents, uom, min_qty, max_qty, approved
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(mla_id, sku) DO UPDATE SET
      description = excluded.description,
      price_cents = excluded.price_cents,
      uom = excluded.uom,
      min_qty = excluded.min_qty,
      max_qty = excluded.max_qty
  `);

  const insertMany = db.transaction((products) => {
    for (const product of products) {
      stmt.run(
        mlaId,
        product.sku,
        product.description || null,
        product.priceCents,
        product.uom || 'EA',
        product.minQty || null,
        product.maxQty || null,
        product.approved !== false
      );
    }
  });

  insertMany(products);
  console.log(`[MLA] Upserted ${products.length} products for MLA ID ${mlaId}`);
}

// Export statement for integration
module.exports = {
  createMLAContract,
  upsertMLAProducts
  // ... more functions
};

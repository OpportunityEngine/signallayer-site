/**
 * Revenue Radar - Inventory Intelligence Module
 *
 * Comprehensive inventory management with:
 * - Automatic usage tracking from invoice processing
 * - Price history tracking for discount detection
 * - Inventory health scoring
 * - Supplier performance analytics
 * - Purchase order generation
 * - Predictive stockout alerts
 * - Vendor trend analysis
 */

const db = require('./database');
const ReorderEngine = require('./reorder-engine');

class InventoryIntelligence {
  constructor() {
    this.reorderEngine = new ReorderEngine();

    // Category mappings for auto-classification
    this.categoryKeywords = {
      'spirits': ['vodka', 'whiskey', 'whisky', 'bourbon', 'rum', 'tequila', 'gin', 'brandy', 'cognac', 'scotch', 'mezcal', 'liqueur', 'hennessy', 'grey goose', 'patron', 'bacardi', 'jack daniel', 'jameson', 'crown royal', 'johnnie walker', 'fireball', 'absolut', 'smirnoff', 'captain morgan', 'jose cuervo'],
      'wine': ['wine', 'cabernet', 'chardonnay', 'merlot', 'pinot', 'sauvignon', 'riesling', 'champagne', 'prosecco', 'rosé', 'rose', 'moscato', 'zinfandel', 'malbec', 'shiraz', 'syrah', 'burgundy', 'bordeaux'],
      'beer': ['beer', 'ale', 'lager', 'ipa', 'stout', 'pilsner', 'hefeweizen', 'porter', 'seltzer', 'cider', 'bud light', 'budweiser', 'miller', 'coors', 'corona', 'heineken', 'modelo', 'michelob', 'stella artois', 'guinness', 'blue moon', 'sam adams', 'lagunitas', 'sierra nevada', 'white claw', 'truly', 'dos equis', 'pacifico', 'pbr', 'pabst'],
      'mixers': ['mixer', 'tonic', 'soda', 'juice', 'syrup', 'bitters', 'vermouth', 'grenadine', 'lime juice', 'lemon juice', 'orange juice', 'cranberry', 'ginger beer', 'club soda', 'simple syrup', 'margarita mix', 'bloody mary'],
      'garnishes': ['garnish', 'olive', 'cherry', 'citrus', 'mint', 'lime wedge', 'lemon twist', 'maraschino', 'orange peel'],
      'food': ['chicken', 'beef', 'pork', 'fish', 'shrimp', 'vegetables', 'cheese', 'bread', 'flour', 'oil', 'sauce', 'fries', 'wings', 'burger', 'steak', 'salmon', 'bacon', 'lettuce', 'tomato', 'onion'],
      'disposables': ['napkin', 'straw', 'cup', 'plate', 'utensil', 'container', 'bag', 'wrap', 'foil', 'glove', 'to-go', 'takeout', 'carry out']
    };

    // Unit standardization
    this.unitMappings = {
      'case': { standard: 'case', multiplier: 1 },
      'cs': { standard: 'case', multiplier: 1 },
      'bottle': { standard: 'bottle', multiplier: 1 },
      'btl': { standard: 'bottle', multiplier: 1 },
      'each': { standard: 'each', multiplier: 1 },
      'ea': { standard: 'each', multiplier: 1 },
      'lb': { standard: 'pound', multiplier: 1 },
      'lbs': { standard: 'pound', multiplier: 1 },
      'pound': { standard: 'pound', multiplier: 1 },
      'oz': { standard: 'ounce', multiplier: 1 },
      'ounce': { standard: 'ounce', multiplier: 1 },
      'gal': { standard: 'gallon', multiplier: 1 },
      'gallon': { standard: 'gallon', multiplier: 1 },
      'pack': { standard: 'pack', multiplier: 1 },
      'pk': { standard: 'pack', multiplier: 1 },
      'box': { standard: 'box', multiplier: 1 },
      'bx': { standard: 'box', multiplier: 1 }
    };
  }

  /**
   * Process invoice items and update inventory intelligence
   * Called after invoice ingestion
   */
  processInvoiceForInventory(userId, vendorName, lineItems, invoiceDate = null) {
    const database = db.getDatabase();
    const processedItems = [];
    const pricesRecorded = [];
    const date = invoiceDate || new Date().toISOString().split('T')[0];

    console.log(`[InventoryIntel] Processing ${lineItems.length} items from ${vendorName} for user ${userId}`);

    for (const item of lineItems) {
      try {
        const result = this.processLineItem(userId, vendorName, item, date, database);
        if (result) {
          processedItems.push(result);
          if (result.priceRecorded) {
            pricesRecorded.push(result);
          }
        }
      } catch (error) {
        console.error(`[InventoryIntel] Error processing item:`, error.message);
      }
    }

    // Update supplier stats
    this.updateSupplierStats(userId, vendorName, lineItems, database);

    // Check for price changes and opportunities
    const priceAlerts = this.detectPriceChanges(userId, vendorName, pricesRecorded, database);

    console.log(`[InventoryIntel] Processed ${processedItems.length} items, ${pricesRecorded.length} prices recorded, ${priceAlerts.length} price alerts`);

    return {
      processed: processedItems.length,
      pricesRecorded: pricesRecorded.length,
      priceAlerts
    };
  }

  /**
   * Process a single line item from an invoice
   */
  processLineItem(userId, vendorName, item, date, database) {
    // Extract SKU and description
    const sku = this.normalizeSku(item.sku || item.raw_description || '');
    const description = item.raw_description || item.description || '';
    const quantity = parseFloat(item.quantity) || 0;
    const unitPriceCents = Math.round((item.unit_price?.amount || item.unitPrice || 0) * 100);
    const totalCents = Math.round((item.total_price?.amount || item.total || 0) * 100);

    if (!sku || quantity <= 0) {
      return null;
    }

    // Auto-classify category
    const category = this.classifyCategory(description);

    // Find or create inventory item
    let inventoryItem = database.prepare(`
      SELECT id, avg_unit_cost_cents, last_unit_cost_cents, vendor_name
      FROM inventory_items
      WHERE user_id = ? AND sku = ?
    `).get(userId, sku);

    if (!inventoryItem) {
      // Create new inventory item
      const result = database.prepare(`
        INSERT INTO inventory_items (
          user_id, sku, product_name, category, current_quantity,
          unit_of_measure, min_quantity, last_unit_cost_cents, avg_unit_cost_cents,
          vendor_name, is_active
        ) VALUES (?, ?, ?, ?, ?, 'each', 5, ?, ?, ?, 1)
      `).run(
        userId, sku, description, category, quantity,
        unitPriceCents, unitPriceCents, vendorName
      );
      inventoryItem = { id: result.lastInsertRowid, avg_unit_cost_cents: unitPriceCents };
      console.log(`[InventoryIntel] Created inventory item: ${sku}`);
    } else {
      // Update existing item - add to quantity
      const newAvgCost = inventoryItem.avg_unit_cost_cents
        ? Math.round((inventoryItem.avg_unit_cost_cents + unitPriceCents) / 2)
        : unitPriceCents;

      database.prepare(`
        UPDATE inventory_items SET
          current_quantity = current_quantity + ?,
          last_unit_cost_cents = ?,
          avg_unit_cost_cents = ?,
          vendor_name = COALESCE(vendor_name, ?),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(quantity, unitPriceCents, newAvgCost, vendorName, inventoryItem.id);
    }

    // Record price observation for trend analysis
    let priceRecorded = false;
    if (unitPriceCents > 0) {
      try {
        database.prepare(`
          INSERT INTO vendor_price_history (
            user_id, vendor_name, sku, unit_price_cents, quantity, invoice_date, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).run(userId, vendorName, sku, unitPriceCents, quantity, date);
        priceRecorded = true;
      } catch (e) {
        // May already exist, that's OK
      }
    }

    // Record as "received" in usage tracking (negative usage = restocking)
    try {
      database.prepare(`
        INSERT INTO inventory_usage (inventory_item_id, date, daily_usage, quantity_received)
        VALUES (?, ?, 0, ?)
        ON CONFLICT(inventory_item_id, date) DO UPDATE SET
          quantity_received = quantity_received + excluded.quantity_received
      `).run(inventoryItem.id, date, quantity);
    } catch (e) {
      console.warn(`[InventoryIntel] Usage tracking error:`, e.message);
    }

    return {
      sku,
      description,
      quantity,
      unitPriceCents,
      category,
      inventoryItemId: inventoryItem.id,
      priceRecorded,
      previousPrice: inventoryItem.last_unit_cost_cents
    };
  }

  /**
   * Record usage (depletion) of inventory
   * Call this when items are sold/used
   */
  recordUsage(userId, sku, quantity, date = null) {
    const database = db.getDatabase();
    const usageDate = date || new Date().toISOString().split('T')[0];

    const item = database.prepare(`
      SELECT id FROM inventory_items WHERE user_id = ? AND sku = ?
    `).get(userId, sku);

    if (!item) {
      console.warn(`[InventoryIntel] Item not found for usage: ${sku}`);
      return false;
    }

    // Record usage
    database.prepare(`
      INSERT INTO inventory_usage (inventory_item_id, date, daily_usage)
      VALUES (?, ?, ?)
      ON CONFLICT(inventory_item_id, date) DO UPDATE SET
        daily_usage = daily_usage + excluded.daily_usage
    `).run(item.id, usageDate, quantity);

    // Update current quantity
    database.prepare(`
      UPDATE inventory_items SET
        current_quantity = MAX(0, current_quantity - ?),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(quantity, item.id);

    return true;
  }

  /**
   * Bulk record usage from inventory count/snapshot comparison
   */
  recordUsageFromSnapshot(userId, currentCounts, previousSnapshotId = null) {
    const database = db.getDatabase();
    const date = new Date().toISOString().split('T')[0];
    const usageRecords = [];

    // Get previous quantities
    let previousCounts = {};
    if (previousSnapshotId) {
      const prevItems = database.prepare(`
        SELECT i.sku, si.quantity
        FROM inventory_snapshot_items si
        JOIN inventory_items i ON si.inventory_item_id = i.id
        WHERE si.snapshot_id = ?
      `).all(previousSnapshotId);

      prevItems.forEach(item => {
        previousCounts[item.sku] = item.quantity;
      });
    } else {
      // Use current inventory levels as "previous"
      const items = database.prepare(`
        SELECT sku, current_quantity FROM inventory_items WHERE user_id = ?
      `).all(userId);

      items.forEach(item => {
        previousCounts[item.sku] = item.current_quantity;
      });
    }

    // Calculate usage for each item
    for (const [sku, currentQty] of Object.entries(currentCounts)) {
      const prevQty = previousCounts[sku] || 0;
      const usage = prevQty - currentQty;

      if (usage > 0) {
        // Item was used
        this.recordUsage(userId, sku, usage, date);
        usageRecords.push({ sku, usage, type: 'consumed' });
      } else if (usage < 0) {
        // Item was received (negative usage = restock)
        const item = database.prepare(`
          SELECT id FROM inventory_items WHERE user_id = ? AND sku = ?
        `).get(userId, sku);

        if (item) {
          database.prepare(`
            INSERT INTO inventory_usage (inventory_item_id, date, quantity_received)
            VALUES (?, ?, ?)
            ON CONFLICT(inventory_item_id, date) DO UPDATE SET
              quantity_received = quantity_received + excluded.quantity_received
          `).run(item.id, date, Math.abs(usage));
        }
        usageRecords.push({ sku, usage: Math.abs(usage), type: 'received' });
      }
    }

    console.log(`[InventoryIntel] Recorded ${usageRecords.length} usage changes from snapshot`);
    return usageRecords;
  }

  /**
   * Detect significant price changes
   */
  detectPriceChanges(userId, vendorName, processedItems, database) {
    const alerts = [];

    for (const item of processedItems) {
      if (!item.previousPrice || item.previousPrice === 0) continue;

      const priceDiff = item.unitPriceCents - item.previousPrice;
      const pctChange = (priceDiff / item.previousPrice) * 100;

      if (Math.abs(pctChange) >= 5) { // 5% or more change
        const alertType = priceDiff > 0 ? 'price_increase' : 'price_decrease';

        alerts.push({
          sku: item.sku,
          description: item.description,
          previousPriceCents: item.previousPrice,
          newPriceCents: item.unitPriceCents,
          changePercent: Math.round(pctChange * 10) / 10,
          alertType,
          vendor: vendorName
        });

        // If significant decrease, might be a bulk opportunity
        if (pctChange <= -15) {
          // Store as potential discount opportunity for reorder engine
          console.log(`[InventoryIntel] Detected ${Math.abs(pctChange).toFixed(1)}% discount on ${item.sku}`);
        }
      }
    }

    return alerts;
  }

  /**
   * Update supplier/vendor performance stats
   */
  updateSupplierStats(userId, vendorName, lineItems, database) {
    const totalItems = lineItems.length;
    const totalValueCents = lineItems.reduce((sum, item) => {
      return sum + Math.round((item.total_price?.amount || item.total || 0) * 100);
    }, 0);

    // Upsert supplier record
    const today = new Date().toISOString().split('T')[0];
    database.prepare(`
      INSERT INTO vendor_price_history (user_id, vendor_name, sku, unit_price_cents, quantity, invoice_date, created_at)
      VALUES (?, ?, '__VENDOR_STATS__', ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT DO NOTHING
    `).run(userId, vendorName, totalValueCents, totalItems, today);

    // Could expand this to track:
    // - Average delivery time
    // - Order accuracy
    // - Price consistency
    // - Response time
  }

  /**
   * Get inventory health score for a user
   * Returns 0-100 score with breakdown
   */
  getInventoryHealthScore(userId) {
    const database = db.getDatabase();

    const items = database.prepare(`
      SELECT
        i.*,
        (SELECT AVG(daily_usage) FROM inventory_usage
         WHERE inventory_item_id = i.id AND date >= date('now', '-30 days')) as avg_usage
      FROM inventory_items i
      WHERE i.user_id = ? AND i.is_active = 1
    `).all(userId);

    if (items.length === 0) {
      return { score: 100, grade: 'A', breakdown: { message: 'No inventory items', itemCount: 0 } };
    }

    let stockScore = 100;
    let priceScore = 100;
    let turnoverScore = 100;
    let accuracyScore = 100;

    const issues = [];

    // Stock level analysis
    let criticalCount = 0;
    let lowCount = 0;
    let overstockCount = 0;

    for (const item of items) {
      const daysSupply = item.avg_usage > 0
        ? item.current_quantity / item.avg_usage
        : 999;

      if (daysSupply <= 7) {
        criticalCount++;
        stockScore -= 5;
        issues.push(`${item.sku}: Only ${Math.round(daysSupply)} days supply`);
      } else if (daysSupply <= 14) {
        lowCount++;
        stockScore -= 2;
      } else if (daysSupply > 180) {
        overstockCount++;
        stockScore -= 1;
      }
    }

    // Ensure scores don't go negative
    stockScore = Math.max(0, stockScore);
    priceScore = Math.max(0, priceScore);
    turnoverScore = Math.max(0, turnoverScore);
    accuracyScore = Math.max(0, accuracyScore);

    const overallScore = Math.round(
      (stockScore * 0.4) + (priceScore * 0.2) + (turnoverScore * 0.2) + (accuracyScore * 0.2)
    );

    return {
      score: Math.min(100, Math.max(0, overallScore)),
      breakdown: {
        stockScore,
        priceScore,
        turnoverScore,
        accuracyScore,
        itemCount: items.length,
        criticalItems: criticalCount,
        lowItems: lowCount,
        overstockItems: overstockCount
      },
      issues: issues.slice(0, 10), // Top 10 issues
      grade: overallScore >= 90 ? 'A' : overallScore >= 80 ? 'B' : overallScore >= 70 ? 'C' : overallScore >= 60 ? 'D' : 'F'
    };
  }

  /**
   * Generate purchase order recommendations
   */
  generatePurchaseOrder(userId, vendorName = null) {
    const database = db.getDatabase();

    // Get items that need reordering
    let query = `
      SELECT
        i.*,
        (SELECT AVG(daily_usage) FROM inventory_usage
         WHERE inventory_item_id = i.id AND date >= date('now', '-30 days')) as avg_usage,
        (SELECT unit_price_cents FROM vendor_price_history
         WHERE user_id = i.user_id AND sku = i.sku
         ORDER BY created_at DESC LIMIT 1) as last_price_cents
      FROM inventory_items i
      WHERE i.user_id = ? AND i.is_active = 1
    `;

    const params = [userId];

    if (vendorName) {
      query += ` AND i.vendor_name = ?`;
      params.push(vendorName);
    }

    const items = database.prepare(query).all(...params);
    const orderLines = [];
    let totalEstimatedCents = 0;

    for (const item of items) {
      const daysSupply = item.avg_usage > 0
        ? item.current_quantity / item.avg_usage
        : 999;

      // Reorder if less than 14 days supply
      if (daysSupply < 14) {
        // Order enough for 30 days
        const targetDays = 30;
        const targetQty = Math.ceil(item.avg_usage * targetDays);
        const orderQty = Math.max(0, targetQty - item.current_quantity);

        if (orderQty > 0) {
          const unitPrice = item.last_price_cents || item.last_unit_cost_cents || 0;
          const lineTotal = orderQty * unitPrice;

          orderLines.push({
            sku: item.sku,
            productName: item.product_name,
            category: item.category,
            currentQty: item.current_quantity,
            orderQty,
            unitPriceCents: unitPrice,
            lineTotalCents: lineTotal,
            daysSupplyAfter: Math.round((item.current_quantity + orderQty) / item.avg_usage),
            priority: daysSupply <= 7 ? 'critical' : 'normal',
            vendor: item.vendor_name
          });

          totalEstimatedCents += lineTotal;
        }
      }
    }

    // Sort by priority then by value
    orderLines.sort((a, b) => {
      if (a.priority === 'critical' && b.priority !== 'critical') return -1;
      if (a.priority !== 'critical' && b.priority === 'critical') return 1;
      return b.lineTotalCents - a.lineTotalCents;
    });

    return {
      vendor: vendorName || 'All Vendors',
      generatedAt: new Date().toISOString(),
      lineItems: orderLines,
      summary: {
        totalLines: orderLines.length,
        criticalItems: orderLines.filter(l => l.priority === 'critical').length,
        estimatedTotalCents: totalEstimatedCents,
        estimatedTotalDollars: (totalEstimatedCents / 100).toFixed(2)
      }
    };
  }

  /**
   * Get supplier performance report
   */
  getSupplierReport(userId, vendorName = null) {
    const database = db.getDatabase();

    let query = `
      SELECT
        vendor_name,
        COUNT(DISTINCT sku) as sku_count,
        SUM(unit_price_cents * quantity) as total_spend_cents,
        AVG(unit_price_cents) as avg_price_cents,
        MIN(created_at) as first_order,
        MAX(created_at) as last_order,
        COUNT(*) as order_count
      FROM vendor_price_history
      WHERE user_id = ? AND sku != '__VENDOR_STATS__'
    `;

    const params = [userId];

    if (vendorName) {
      query += ` AND vendor_name = ?`;
      params.push(vendorName);
    }

    query += ` GROUP BY vendor_name ORDER BY total_spend_cents DESC`;

    const suppliers = database.prepare(query).all(...params);

    // Calculate price trends for each supplier
    const supplierReports = suppliers.map(supplier => {
      // Get price trend data
      const priceHistory = database.prepare(`
        SELECT sku, unit_price_cents, created_at
        FROM vendor_price_history
        WHERE user_id = ? AND vendor_name = ? AND sku != '__VENDOR_STATS__'
        ORDER BY created_at DESC
        LIMIT 100
      `).all(userId, supplier.vendor_name);

      // Calculate average price change
      let avgPriceChange = 0;
      const skuPrices = {};

      priceHistory.forEach(ph => {
        if (!skuPrices[ph.sku]) skuPrices[ph.sku] = [];
        skuPrices[ph.sku].push(ph.unit_price_cents);
      });

      let priceChanges = 0;
      let changeCount = 0;

      Object.values(skuPrices).forEach(prices => {
        if (prices.length >= 2) {
          const change = ((prices[0] - prices[prices.length - 1]) / prices[prices.length - 1]) * 100;
          priceChanges += change;
          changeCount++;
        }
      });

      avgPriceChange = changeCount > 0 ? priceChanges / changeCount : 0;

      return {
        vendorName: supplier.vendor_name,
        skuCount: supplier.sku_count,
        totalSpendCents: supplier.total_spend_cents,
        totalSpendDollars: (supplier.total_spend_cents / 100).toFixed(2),
        avgPriceCents: Math.round(supplier.avg_price_cents),
        firstOrder: supplier.first_order,
        lastOrder: supplier.last_order,
        orderCount: supplier.order_count,
        priceChangePct: Math.round(avgPriceChange * 10) / 10,
        priceTrend: avgPriceChange > 2 ? 'increasing' : avgPriceChange < -2 ? 'decreasing' : 'stable'
      };
    });

    return supplierReports;
  }

  /**
   * Get items that will stockout soon
   */
  getStockoutAlerts(userId, daysThreshold = 14) {
    const database = db.getDatabase();

    const items = database.prepare(`
      SELECT
        i.*,
        (SELECT AVG(daily_usage) FROM inventory_usage
         WHERE inventory_item_id = i.id AND date >= date('now', '-30 days')) as avg_usage
      FROM inventory_items i
      WHERE i.user_id = ? AND i.is_active = 1
    `).all(userId);

    const alerts = [];

    for (const item of items) {
      if (!item.avg_usage || item.avg_usage <= 0) continue;

      const daysSupply = item.current_quantity / item.avg_usage;

      if (daysSupply <= daysThreshold) {
        const stockoutDate = new Date();
        stockoutDate.setDate(stockoutDate.getDate() + Math.floor(daysSupply));

        alerts.push({
          sku: item.sku,
          productName: item.product_name,
          category: item.category,
          currentQuantity: item.current_quantity,
          avgDailyUsage: Math.round(item.avg_usage * 100) / 100,
          daysUntilStockout: Math.floor(daysSupply),
          projectedStockoutDate: stockoutDate.toISOString().split('T')[0],
          severity: daysSupply <= 3 ? 'critical' : daysSupply <= 7 ? 'high' : 'medium',
          vendor: item.vendor_name,
          suggestedOrderQty: Math.ceil(item.avg_usage * 30) // 30 days supply
        });
      }
    }

    // Sort by days until stockout (most urgent first)
    alerts.sort((a, b) => a.daysUntilStockout - b.daysUntilStockout);

    return alerts;
  }

  /**
   * Normalize SKU for consistent matching
   */
  normalizeSku(sku) {
    if (!sku) return '';
    return String(sku)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .substring(0, 50);
  }

  /**
   * Auto-classify item category based on description
   */
  classifyCategory(description) {
    if (!description) return 'other';

    const lowerDesc = description.toLowerCase();

    for (const [category, keywords] of Object.entries(this.categoryKeywords)) {
      if (keywords.some(kw => lowerDesc.includes(kw))) {
        return category;
      }
    }

    return 'other';
  }

  /**
   * Get comprehensive inventory dashboard data
   */
  getDashboardData(userId) {
    const database = db.getDatabase();

    // Basic stats
    const stats = database.prepare(`
      SELECT
        COUNT(*) as total_items,
        SUM(current_quantity * COALESCE(avg_unit_cost_cents, 0)) / 100 as total_value_dollars,
        COUNT(CASE WHEN current_quantity <= min_quantity * 0.5 THEN 1 END) as critical_count,
        COUNT(CASE WHEN current_quantity <= min_quantity AND current_quantity > min_quantity * 0.5 THEN 1 END) as low_count,
        COUNT(DISTINCT category) as category_count,
        COUNT(DISTINCT vendor_name) as vendor_count
      FROM inventory_items
      WHERE user_id = ? AND is_active = 1
    `).get(userId);

    // Health score
    const healthScore = this.getInventoryHealthScore(userId);

    // Stockout alerts
    const stockoutAlerts = this.getStockoutAlerts(userId, 14);

    // Recent recommendations
    const recommendations = database.prepare(`
      SELECT r.*, i.product_name, i.sku
      FROM reorder_recommendations r
      JOIN inventory_items i ON r.inventory_item_id = i.id
      WHERE r.user_id = ? AND r.is_dismissed = 0 AND r.is_actioned = 0
      ORDER BY
        CASE r.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
        r.created_at DESC
      LIMIT 10
    `).all(userId);

    // Parse recommendation reasoning
    const parsedRecs = recommendations.map(rec => ({
      ...rec,
      reasoning: rec.reasoning ? JSON.parse(rec.reasoning) : null
    }));

    // Top spending by category (last 30 days)
    const categorySpend = database.prepare(`
      SELECT
        i.category,
        SUM(vph.unit_price_cents * vph.quantity) / 100 as spend_dollars,
        COUNT(DISTINCT i.sku) as item_count
      FROM vendor_price_history vph
      JOIN inventory_items i ON vph.sku = i.sku AND vph.user_id = i.user_id
      WHERE vph.user_id = ? AND vph.created_at >= date('now', '-30 days')
      GROUP BY i.category
      ORDER BY spend_dollars DESC
    `).all(userId);

    return {
      stats: {
        ...stats,
        total_value_dollars: Math.round((stats.total_value_dollars || 0) * 100) / 100
      },
      healthScore,
      stockoutAlerts: stockoutAlerts.slice(0, 5), // Top 5 urgent
      recommendations: parsedRecs,
      categorySpend,
      lastUpdated: new Date().toISOString()
    };
  }
}

module.exports = InventoryIntelligence;

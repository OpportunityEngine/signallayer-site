/**
 * Revenue Radar - Opportunity Detection Engine
 *
 * Analyzes invoices, inventory, MLAs, and vendor data to automatically
 * detect cost savings opportunities, pricing anomalies, and actionable insights.
 *
 * As a sales leader, I know that the best opportunities are often hidden in
 * operational data - this engine surfaces them automatically.
 */

const db = require('./database');

class OpportunityEngine {
  constructor() {
    this.database = db.getDatabase();
    this.thresholds = {
      priceIncreasePct: 5,        // Flag price increases > 5%
      bulkDiscountPct: 10,        // Bulk discount threshold
      inventoryDaysLow: 14,       // Low inventory warning (days supply)
      inventoryDaysCritical: 7,   // Critical inventory warning
      contractExpiryDays: 90,     // MLA expiry warning
      confidenceMinimum: 60,      // Minimum confidence to surface opportunity
    };
  }

  /**
   * Run all detection algorithms for a user
   */
  async analyzeForUser(userId) {
    const results = {
      opportunities: [],
      summary: {
        total: 0,
        byType: {},
        totalPotentialValue: 0
      }
    };

    try {
      // Run all detection modules
      const detectors = [
        this.detectPriceIncreases(userId),
        this.detectBulkDiscounts(userId),
        this.detectVendorConsolidation(userId),
        this.detectContractRenewals(userId),
        this.detectInventoryOpportunities(userId),
        this.detectSeasonalBuying(userId),
        this.detectWasteReduction(userId),
      ];

      const detectorResults = await Promise.all(detectors);

      detectorResults.forEach(opportunities => {
        results.opportunities.push(...opportunities);
      });

      // Calculate summary
      results.summary.total = results.opportunities.length;
      results.opportunities.forEach(opp => {
        results.summary.byType[opp.opportunity_type] = (results.summary.byType[opp.opportunity_type] || 0) + 1;
        results.summary.totalPotentialValue += opp.estimated_value_cents || 0;
      });

      // Store new opportunities in database
      await this.storeOpportunities(userId, results.opportunities);

      return results;
    } catch (error) {
      console.error('[OpportunityEngine] Analysis error:', error);
      throw error;
    }
  }

  /**
   * Detect price increases from vendors
   */
  async detectPriceIncreases(userId) {
    const opportunities = [];

    try {
      // Get price history with changes
      const priceChanges = this.database.prepare(`
        SELECT
          vendor_name,
          sku,
          product_name,
          unit_price_cents as current_price,
          price_change_cents,
          price_change_pct,
          invoice_date,
          (
            SELECT AVG(unit_price_cents)
            FROM vendor_price_history ph2
            WHERE ph2.vendor_name = ph.vendor_name
              AND ph2.sku = ph.sku
              AND ph2.invoice_date < ph.invoice_date
              AND ph2.invoice_date >= date(ph.invoice_date, '-90 days')
          ) as avg_previous_price
        FROM vendor_price_history ph
        WHERE user_id = ?
          AND invoice_date >= date('now', '-30 days')
          AND price_change_pct > ?
        ORDER BY price_change_pct DESC
        LIMIT 20
      `).all(userId, this.thresholds.priceIncreasePct);

      priceChanges.forEach(item => {
        if (item.price_change_pct > this.thresholds.priceIncreasePct) {
          const annualImpact = Math.round(item.price_change_cents * 52); // Estimate weekly spend

          opportunities.push({
            opportunity_type: 'price_increase',
            source_type: 'invoice',
            title: `Price Increase Alert: ${item.product_name || item.sku}`,
            description: `${item.vendor_name} increased price by ${item.price_change_pct.toFixed(1)}% on ${item.product_name || item.sku}. Consider negotiating or finding alternative vendor.`,
            impact_type: 'cost_savings',
            estimated_value_cents: annualImpact,
            confidence_score: 85,
            urgency: item.price_change_pct > 15 ? 'immediate' : 'this_week',
            vendor_name: item.vendor_name,
            sku: item.sku,
            current_price_cents: item.current_price,
            target_price_cents: item.avg_previous_price ? Math.round(item.avg_previous_price) : null,
            supporting_data: JSON.stringify({
              price_change_pct: item.price_change_pct,
              previous_avg_price: item.avg_previous_price,
              invoice_date: item.invoice_date
            }),
            action_items: JSON.stringify([
              'Contact vendor to negotiate price rollback',
              'Request volume discount to offset increase',
              'Compare pricing with alternative vendors',
              'Review contract terms for price protection clauses'
            ])
          });
        }
      });
    } catch (error) {
      console.error('[OpportunityEngine] Price increase detection error:', error);
    }

    return opportunities;
  }

  /**
   * Detect bulk discount opportunities based on purchasing patterns
   */
  async detectBulkDiscounts(userId) {
    const opportunities = [];

    try {
      // Find frequently purchased items that could benefit from bulk ordering
      const frequentItems = this.database.prepare(`
        SELECT
          vendor_name,
          sku,
          product_name,
          COUNT(*) as order_count,
          SUM(quantity) as total_quantity,
          AVG(unit_price_cents) as avg_price,
          MAX(unit_price_cents) as max_price,
          MIN(unit_price_cents) as min_price
        FROM vendor_price_history
        WHERE user_id = ?
          AND invoice_date >= date('now', '-90 days')
        GROUP BY vendor_name, sku
        HAVING order_count >= 3
        ORDER BY total_quantity DESC
        LIMIT 15
      `).all(userId);

      frequentItems.forEach(item => {
        // Calculate potential savings from bulk ordering
        const priceVariance = item.max_price - item.min_price;
        const potentialDiscount = Math.round(item.avg_price * 0.10); // Assume 10% bulk discount
        const annualQuantity = item.total_quantity * 4; // Extrapolate to annual
        const potentialSavings = Math.round(potentialDiscount * annualQuantity);

        if (potentialSavings > 10000) { // Only surface if > $100 annual savings
          opportunities.push({
            opportunity_type: 'bulk_discount',
            source_type: 'invoice',
            title: `Bulk Discount Opportunity: ${item.product_name || item.sku}`,
            description: `You order ${item.product_name || item.sku} frequently from ${item.vendor_name}. Consolidating into bulk orders could save an estimated $${(potentialSavings / 100).toFixed(0)}/year.`,
            impact_type: 'cost_savings',
            estimated_value_cents: potentialSavings,
            confidence_score: 70,
            urgency: 'this_month',
            vendor_name: item.vendor_name,
            sku: item.sku,
            current_price_cents: Math.round(item.avg_price),
            target_price_cents: Math.round(item.avg_price * 0.90),
            quantity_affected: annualQuantity,
            supporting_data: JSON.stringify({
              order_count_90_days: item.order_count,
              total_quantity_90_days: item.total_quantity,
              price_variance: priceVariance
            }),
            action_items: JSON.stringify([
              'Contact vendor to request bulk pricing tiers',
              'Calculate optimal order quantity based on storage and usage',
              'Negotiate quarterly or monthly standing orders',
              'Compare bulk pricing with other vendors'
            ])
          });
        }
      });
    } catch (error) {
      console.error('[OpportunityEngine] Bulk discount detection error:', error);
    }

    return opportunities;
  }

  /**
   * Detect vendor consolidation opportunities
   */
  async detectVendorConsolidation(userId) {
    const opportunities = [];

    try {
      // Find categories with multiple vendors
      const categoryVendors = this.database.prepare(`
        SELECT
          ii.category,
          COUNT(DISTINCT ph.vendor_name) as vendor_count,
          GROUP_CONCAT(DISTINCT ph.vendor_name) as vendors,
          SUM(ph.unit_price_cents * ph.quantity) as total_spend_cents
        FROM vendor_price_history ph
        JOIN invoice_items ii ON ph.sku = ii.description
        WHERE ph.user_id = ?
          AND ph.invoice_date >= date('now', '-90 days')
          AND ii.category IS NOT NULL
        GROUP BY ii.category
        HAVING vendor_count > 1
        ORDER BY total_spend_cents DESC
        LIMIT 10
      `).all(userId);

      categoryVendors.forEach(category => {
        if (category.vendor_count > 2 && category.total_spend_cents > 50000) {
          const potentialSavings = Math.round(category.total_spend_cents * 0.08); // 8% consolidation savings

          opportunities.push({
            opportunity_type: 'vendor_consolidation',
            source_type: 'invoice',
            title: `Consolidate ${category.category} Vendors`,
            description: `You're using ${category.vendor_count} different vendors for ${category.category}. Consolidating could improve pricing power and simplify operations.`,
            impact_type: 'cost_savings',
            estimated_value_cents: potentialSavings * 4, // Annualize
            confidence_score: 65,
            urgency: 'this_quarter',
            supporting_data: JSON.stringify({
              category: category.category,
              vendor_count: category.vendor_count,
              vendors: category.vendors.split(','),
              quarterly_spend: category.total_spend_cents
            }),
            action_items: JSON.stringify([
              'Compare pricing across all vendors in this category',
              'Identify preferred vendor based on price, quality, and service',
              'Request competitive bids for consolidated volume',
              'Negotiate improved payment terms with chosen vendor'
            ])
          });
        }
      });
    } catch (error) {
      console.error('[OpportunityEngine] Vendor consolidation detection error:', error);
    }

    return opportunities;
  }

  /**
   * Detect contract renewals approaching expiration
   */
  async detectContractRenewals(userId) {
    const opportunities = [];

    try {
      const expiringContracts = this.database.prepare(`
        SELECT
          id,
          account_name,
          vendor_name,
          contract_value_cents,
          end_date,
          renewal_likelihood_pct,
          julianday(end_date) - julianday('now') as days_until_expiry
        FROM mlas
        WHERE end_date >= date('now')
          AND end_date <= date('now', '+' || ? || ' days')
        ORDER BY end_date ASC
      `).all(this.thresholds.contractExpiryDays);

      expiringContracts.forEach(contract => {
        const urgency = contract.days_until_expiry <= 30 ? 'immediate' :
                       contract.days_until_expiry <= 60 ? 'this_week' : 'this_month';

        opportunities.push({
          opportunity_type: 'contract_renewal',
          source_type: 'mla',
          source_id: contract.id,
          title: `Contract Renewal: ${contract.account_name}`,
          description: `MLA with ${contract.vendor_name || contract.account_name} expires in ${Math.round(contract.days_until_expiry)} days. Start renewal discussions to secure favorable terms.`,
          impact_type: 'risk_mitigation',
          estimated_value_cents: Math.round(contract.contract_value_cents * 0.05), // 5% potential savings on renewal
          confidence_score: 90,
          urgency: urgency,
          vendor_name: contract.vendor_name,
          supporting_data: JSON.stringify({
            contract_value: contract.contract_value_cents,
            days_until_expiry: Math.round(contract.days_until_expiry),
            renewal_likelihood: contract.renewal_likelihood_pct
          }),
          action_items: JSON.stringify([
            'Review current contract terms and identify improvement areas',
            'Gather competitive quotes before negotiation',
            'Schedule renewal meeting with vendor',
            'Prepare list of service issues or requested improvements',
            'Document any price increases during contract term'
          ])
        });
      });
    } catch (error) {
      console.error('[OpportunityEngine] Contract renewal detection error:', error);
    }

    return opportunities;
  }

  /**
   * Detect inventory-related opportunities
   */
  async detectInventoryOpportunities(userId) {
    const opportunities = [];

    try {
      // Find items with smart reorder opportunities
      const inventoryAnalysis = this.database.prepare(`
        SELECT
          i.id,
          i.sku,
          i.product_name,
          i.current_quantity,
          i.min_quantity,
          i.par_level,
          i.avg_unit_cost_cents,
          i.vendor_name,
          i.lead_time_days,
          u.avg_daily_usage,
          u.projected_depletion_date,
          (
            SELECT MIN(ph.unit_price_cents)
            FROM vendor_price_history ph
            WHERE ph.sku = i.sku
              AND ph.invoice_date >= date('now', '-180 days')
          ) as lowest_recent_price,
          (
            SELECT MAX(ph.unit_price_cents)
            FROM vendor_price_history ph
            WHERE ph.sku = i.sku
              AND ph.invoice_date >= date('now', '-30 days')
          ) as current_price
        FROM inventory_items i
        LEFT JOIN inventory_usage u ON i.id = u.inventory_item_id
          AND u.period_type = 'weekly'
          AND u.period_end = (SELECT MAX(period_end) FROM inventory_usage WHERE inventory_item_id = i.id)
        WHERE i.user_id = ?
          AND i.is_active = 1
      `).all(userId);

      inventoryAnalysis.forEach(item => {
        // Check for price drop opportunity
        if (item.lowest_recent_price && item.current_price &&
            item.lowest_recent_price < item.current_price * 0.85) {
          const discountPct = Math.round((1 - item.lowest_recent_price / item.current_price) * 100);

          opportunities.push({
            opportunity_type: 'bulk_discount',
            source_type: 'inventory',
            source_id: item.id,
            title: `Historical Low Price: ${item.product_name || item.sku}`,
            description: `${item.product_name || item.sku} was ${discountPct}% cheaper 6 months ago. Consider negotiating or timing purchases for promotional periods.`,
            impact_type: 'cost_savings',
            estimated_value_cents: Math.round((item.current_price - item.lowest_recent_price) * item.par_level),
            confidence_score: 75,
            urgency: 'this_month',
            vendor_name: item.vendor_name,
            sku: item.sku,
            current_price_cents: item.current_price,
            target_price_cents: item.lowest_recent_price,
            supporting_data: JSON.stringify({
              historical_low: item.lowest_recent_price,
              current_price: item.current_price,
              discount_potential_pct: discountPct
            }),
            action_items: JSON.stringify([
              'Contact vendor to request price match to historical low',
              'Ask about upcoming promotions or seasonal discounts',
              'Consider buying ahead if discount available'
            ])
          });
        }

        // Check for overstock situation
        if (item.avg_daily_usage && item.current_quantity > item.par_level * 2) {
          const daysSupply = Math.round(item.current_quantity / item.avg_daily_usage);
          const overstockValue = Math.round((item.current_quantity - item.par_level) * item.avg_unit_cost_cents);

          opportunities.push({
            opportunity_type: 'usage_optimization',
            source_type: 'inventory',
            source_id: item.id,
            title: `Overstocked: ${item.product_name || item.sku}`,
            description: `You have ${daysSupply} days supply of ${item.product_name || item.sku} (${Math.round(item.current_quantity)} units). Consider reducing orders to free up $${(overstockValue / 100).toFixed(0)} in working capital.`,
            impact_type: 'efficiency',
            estimated_value_cents: overstockValue,
            confidence_score: 80,
            urgency: 'this_month',
            vendor_name: item.vendor_name,
            sku: item.sku,
            quantity_affected: item.current_quantity - item.par_level,
            supporting_data: JSON.stringify({
              current_quantity: item.current_quantity,
              par_level: item.par_level,
              days_supply: daysSupply,
              avg_daily_usage: item.avg_daily_usage
            }),
            action_items: JSON.stringify([
              'Pause or reduce upcoming orders for this item',
              'Review par level accuracy',
              'Check for usage pattern changes'
            ])
          });
        }
      });
    } catch (error) {
      console.error('[OpportunityEngine] Inventory opportunity detection error:', error);
    }

    return opportunities;
  }

  /**
   * Detect seasonal buying opportunities
   */
  async detectSeasonalBuying(userId) {
    const opportunities = [];

    // Seasonal patterns for common categories
    const seasonalPatterns = {
      'beverages': { lowMonths: [1, 2], highMonths: [6, 7, 8], category: 'Beverages' },
      'produce': { lowMonths: [7, 8, 9], highMonths: [1, 2, 3], category: 'Produce' },
      'seafood': { lowMonths: [1, 2], highMonths: [12], category: 'Seafood' },
      'beef': { lowMonths: [1, 9], highMonths: [5, 6, 7], category: 'Beef/Meat' },
    };

    const currentMonth = new Date().getMonth() + 1;

    // Check if we're approaching a high-price season
    Object.entries(seasonalPatterns).forEach(([key, pattern]) => {
      const nextHighMonth = pattern.highMonths.find(m => m > currentMonth) || pattern.highMonths[0];
      const monthsUntilHigh = nextHighMonth > currentMonth ?
        nextHighMonth - currentMonth : 12 - currentMonth + nextHighMonth;

      if (monthsUntilHigh <= 2 && monthsUntilHigh > 0) {
        opportunities.push({
          opportunity_type: 'seasonal_buying',
          source_type: 'invoice',
          title: `Stock Up Before ${pattern.category} Price Increase`,
          description: `${pattern.category} prices typically increase in ${this.getMonthName(nextHighMonth)}. Consider ordering ahead to lock in current pricing.`,
          impact_type: 'cost_savings',
          estimated_value_cents: 0, // Will be calculated based on actual spend
          confidence_score: 60,
          urgency: monthsUntilHigh <= 1 ? 'this_week' : 'this_month',
          supporting_data: JSON.stringify({
            category: pattern.category,
            high_price_months: pattern.highMonths.map(m => this.getMonthName(m)),
            months_until_increase: monthsUntilHigh
          }),
          action_items: JSON.stringify([
            `Review current ${pattern.category} inventory levels`,
            'Calculate storage capacity for additional stock',
            'Request forward pricing from vendors',
            'Consider contracted pricing to hedge against increase'
          ])
        });
      }
    });

    return opportunities;
  }

  /**
   * Detect waste reduction opportunities
   */
  async detectWasteReduction(userId) {
    const opportunities = [];

    try {
      // Find items with high waste rates
      const wasteAnalysis = this.database.prepare(`
        SELECT
          inventory_item_id,
          i.product_name,
          i.sku,
          i.vendor_name,
          SUM(quantity_wasted) as total_wasted,
          SUM(quantity_used) as total_used,
          AVG(i.avg_unit_cost_cents) as avg_cost,
          CAST(SUM(quantity_wasted) AS REAL) / NULLIF(SUM(quantity_used + quantity_wasted), 0) * 100 as waste_pct
        FROM inventory_usage u
        JOIN inventory_items i ON u.inventory_item_id = i.id
        WHERE i.user_id = ?
          AND u.period_start >= date('now', '-90 days')
        GROUP BY inventory_item_id
        HAVING waste_pct > 5
        ORDER BY (total_wasted * avg_cost) DESC
        LIMIT 10
      `).all(userId);

      wasteAnalysis.forEach(item => {
        const wasteValueCents = Math.round(item.total_wasted * item.avg_cost);
        const annualizedWaste = wasteValueCents * 4;

        if (annualizedWaste > 20000) { // Only surface if > $200 annual waste
          opportunities.push({
            opportunity_type: 'waste_reduction',
            source_type: 'inventory',
            title: `Reduce Waste: ${item.product_name || item.sku}`,
            description: `${item.waste_pct.toFixed(1)}% waste rate on ${item.product_name || item.sku}. Reducing waste could save $${(annualizedWaste / 100).toFixed(0)}/year.`,
            impact_type: 'cost_savings',
            estimated_value_cents: annualizedWaste,
            confidence_score: 75,
            urgency: 'this_month',
            vendor_name: item.vendor_name,
            sku: item.sku,
            supporting_data: JSON.stringify({
              waste_percentage: item.waste_pct,
              total_wasted_90_days: item.total_wasted,
              waste_value_90_days: wasteValueCents
            }),
            action_items: JSON.stringify([
              'Review storage and handling procedures',
              'Check expiration date management',
              'Consider ordering smaller quantities more frequently',
              'Train staff on proper storage techniques',
              'Evaluate if product quality from vendor has changed'
            ])
          });
        }
      });
    } catch (error) {
      console.error('[OpportunityEngine] Waste reduction detection error:', error);
    }

    return opportunities;
  }

  /**
   * Store detected opportunities in database
   */
  async storeOpportunities(userId, opportunities) {
    const insertStmt = this.database.prepare(`
      INSERT INTO detected_opportunities (
        user_id, opportunity_type, source_type, source_id, title, description,
        impact_type, estimated_value_cents, confidence_score, urgency,
        vendor_name, sku, current_price_cents, target_price_cents,
        quantity_affected, supporting_data, action_items
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const existingCheck = this.database.prepare(`
      SELECT id FROM detected_opportunities
      WHERE user_id = ? AND opportunity_type = ? AND title = ? AND status IN ('new', 'viewed', 'in_progress')
    `);

    let inserted = 0;
    let skipped = 0;

    opportunities.forEach(opp => {
      // Check for existing similar opportunity
      const existing = existingCheck.get(userId, opp.opportunity_type, opp.title);

      if (!existing) {
        try {
          insertStmt.run(
            userId,
            opp.opportunity_type,
            opp.source_type,
            opp.source_id || null,
            opp.title,
            opp.description,
            opp.impact_type,
            opp.estimated_value_cents || 0,
            opp.confidence_score || 50,
            opp.urgency || 'this_month',
            opp.vendor_name || null,
            opp.sku || null,
            opp.current_price_cents || null,
            opp.target_price_cents || null,
            opp.quantity_affected || null,
            opp.supporting_data || null,
            opp.action_items || null
          );
          inserted++;
        } catch (err) {
          console.error('[OpportunityEngine] Insert error:', err.message);
        }
      } else {
        skipped++;
      }
    });

    console.log(`[OpportunityEngine] Stored ${inserted} new opportunities (${skipped} duplicates skipped)`);
    return { inserted, skipped };
  }

  /**
   * Get active opportunities for a user
   */
  getOpportunities(userId, options = {}) {
    const { status, type, urgency, limit = 50, offset = 0 } = options;

    let query = `
      SELECT * FROM detected_opportunities
      WHERE user_id = ?
    `;
    const params = [userId];

    if (status) {
      query += ` AND status = ?`;
      params.push(status);
    }

    if (type) {
      query += ` AND opportunity_type = ?`;
      params.push(type);
    }

    if (urgency) {
      query += ` AND urgency = ?`;
      params.push(urgency);
    }

    query += ` ORDER BY
      CASE urgency
        WHEN 'immediate' THEN 1
        WHEN 'this_week' THEN 2
        WHEN 'this_month' THEN 3
        ELSE 4
      END,
      estimated_value_cents DESC,
      created_at DESC
      LIMIT ? OFFSET ?`;

    params.push(limit, offset);

    return this.database.prepare(query).all(...params);
  }

  /**
   * Mark opportunity as viewed/actioned
   */
  updateOpportunityStatus(opportunityId, status, userId) {
    const updateFields = ['status = ?'];
    const params = [status];

    if (status === 'viewed') {
      updateFields.push('viewed_at = CURRENT_TIMESTAMP');
    } else if (['in_progress', 'won', 'lost'].includes(status)) {
      updateFields.push('actioned_at = CURRENT_TIMESTAMP');
    }

    if (status === 'won' || status === 'lost') {
      updateFields.push('closed_at = CURRENT_TIMESTAMP');
    }

    const query = `UPDATE detected_opportunities SET ${updateFields.join(', ')} WHERE id = ? AND user_id = ?`;
    params.push(opportunityId, userId);

    return this.database.prepare(query).run(...params);
  }

  /**
   * Get opportunity summary stats
   */
  getOpportunitySummary(userId) {
    const summary = this.database.prepare(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'new' THEN 1 END) as new_count,
        COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress_count,
        COUNT(CASE WHEN status = 'won' THEN 1 END) as won_count,
        SUM(CASE WHEN status IN ('new', 'viewed', 'in_progress') THEN estimated_value_cents ELSE 0 END) as potential_value,
        SUM(CASE WHEN status = 'won' THEN estimated_value_cents ELSE 0 END) as realized_value,
        COUNT(CASE WHEN urgency = 'immediate' AND status IN ('new', 'viewed') THEN 1 END) as immediate_count
      FROM detected_opportunities
      WHERE user_id = ?
        AND created_at >= date('now', '-90 days')
    `).get(userId);

    return summary;
  }

  // Helper function
  getMonthName(monthNum) {
    const months = ['', 'January', 'February', 'March', 'April', 'May', 'June',
                   'July', 'August', 'September', 'October', 'November', 'December'];
    return months[monthNum] || '';
  }
}

module.exports = OpportunityEngine;

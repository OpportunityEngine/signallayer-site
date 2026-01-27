/**
 * SmartOrderingEngine - Comprehensive ordering intelligence from invoice history
 *
 * A powerful rule-based analytics engine that provides actionable insights for
 * procurement, kitchen management, and inventory optimization.
 *
 * INSIGHT CATEGORIES:
 * ==================
 * 1. TIMING & REORDERING
 *    - Reorder predictions based on cycle analysis
 *    - Day-of-week ordering patterns
 *    - Seasonal/holiday demand preparation
 *
 * 2. PRICING & COST OPTIMIZATION
 *    - Price anomaly detection (above historical average)
 *    - Price drop opportunities (vendor reduced price)
 *    - Vendor price comparison (same item, different vendors)
 *    - Category spend trend alerts
 *
 * 3. ORDERING OPTIMIZATION
 *    - Bulk consolidation opportunities
 *    - Vendor order consolidation
 *    - Quantity discount thresholds
 *
 * 4. INVENTORY & WASTE PREVENTION
 *    - Low stock risk alerts
 *    - Over-ordering detection (waste prevention)
 *    - Inactive item alerts (possible spoilage)
 *    - Usage change detection
 *
 * 5. BUSINESS INTELLIGENCE
 *    - Budget pacing alerts
 *    - New vendor/item tracking
 *    - Spending pattern analysis
 */

const db = require('./database');

class SmartOrderingEngine {
  constructor() {
    // Configurable thresholds for maximum accuracy
    this.config = {
      // Minimum data requirements
      minDataPointsForAnalysis: 2,        // Minimum orders to analyze patterns
      minDataPointsForHighConfidence: 5,  // Orders needed for high confidence

      // Timing thresholds
      reorderAlertDaysBefore: 7,          // Alert X days before predicted reorder
      analysisWindowDays: 90,             // Primary analysis window
      yearOverYearWindow: 365,            // For seasonal comparison

      // Price thresholds
      priceAnomalyThreshold: 0.10,        // 10% above avg = anomaly
      priceDropThreshold: 0.08,           // 8% below recent avg = opportunity
      vendorPriceDiffThreshold: 0.10,     // 10% difference across vendors

      // Usage thresholds
      usageChangeThreshold: 0.20,         // 20% change triggers alert
      overOrderingThreshold: 0.30,        // 30% more than usage = over-ordering

      // Consolidation thresholds
      minOrdersForBulkAnalysis: 3,        // Minimum orders to suggest consolidation
      smallOrderThreshold: 0.4,           // Order < 40% of max = "small"
      minSavingsForInsight: 300,          // Minimum $3 savings to show

      // Category/budget thresholds
      categorySpendSpikeThreshold: 0.25,  // 25% category spend increase
      budgetPacingAlertThreshold: 0.85,   // Alert at 85% of typical spend

      // Inactive item threshold
      inactiveItemDays: 60,               // Item not ordered in 60 days

      // Excluded vendors (not inventory - rental services, etc.)
      // These vendors are excluded from inventory/ordering insights
      excludedVendors: [
        'cintas',           // Uniform rental service
        'unifirst',         // Uniform rental service
        'aramark uniform',  // Uniform rental service
      ],

      // US Holidays for seasonal prep (month-day format)
      holidays: {
        'new_years': { month: 1, day: 1, prepDays: 7, name: "New Year's" },
        'super_bowl': { month: 2, day: 11, prepDays: 10, name: 'Super Bowl' },
        'valentines': { month: 2, day: 14, prepDays: 7, name: "Valentine's Day" },
        'st_patricks': { month: 3, day: 17, prepDays: 5, name: "St. Patrick's Day" },
        'easter': { month: 4, day: 20, prepDays: 7, name: 'Easter' }, // Approximate
        'cinco_de_mayo': { month: 5, day: 5, prepDays: 5, name: 'Cinco de Mayo' },
        'mothers_day': { month: 5, day: 11, prepDays: 7, name: "Mother's Day" },
        'memorial_day': { month: 5, day: 26, prepDays: 7, name: 'Memorial Day' },
        'fathers_day': { month: 6, day: 15, prepDays: 5, name: "Father's Day" },
        'july_4th': { month: 7, day: 4, prepDays: 10, name: 'Independence Day' },
        'labor_day': { month: 9, day: 1, prepDays: 7, name: 'Labor Day' },
        'halloween': { month: 10, day: 31, prepDays: 14, name: 'Halloween' },
        'thanksgiving': { month: 11, day: 27, prepDays: 14, name: 'Thanksgiving' },
        'christmas': { month: 12, day: 25, prepDays: 21, name: 'Christmas' },
        'new_years_eve': { month: 12, day: 31, prepDays: 7, name: "New Year's Eve" }
      }
    };
  }

  /**
   * Build SQL clause to exclude non-inventory vendors (uniform rentals, etc.)
   * @param {string} tableAlias - The alias for ingestion_runs table (e.g., 'ir')
   * @returns {string} SQL clause like "AND LOWER(ir.vendor_name) NOT LIKE '%cintas%'"
   */
  getVendorExclusionClause(tableAlias = 'ir') {
    if (!this.config.excludedVendors || this.config.excludedVendors.length === 0) {
      return '';
    }
    return this.config.excludedVendors
      .map(v => `AND LOWER(${tableAlias}.vendor_name) NOT LIKE '%${v.toLowerCase()}%'`)
      .join(' ');
  }

  /**
   * Main entry: Generate all smart ordering insights for a user
   * Returns insights sorted by urgency and confidence
   */
  async generateInsights(userId) {
    const allInsights = [];
    const startTime = Date.now();

    try {
      // ============ TIMING & REORDERING ============
      allInsights.push(...this.analyzeReorderPatterns(userId));
      allInsights.push(...this.analyzeDayOfWeekPatterns(userId));
      allInsights.push(...this.analyzeSeasonalDemand(userId));

      // ============ PRICING & COST ============
      allInsights.push(...this.detectPriceAnomalies(userId));
      allInsights.push(...this.detectPriceDrops(userId));
      allInsights.push(...this.compareVendorPrices(userId));
      allInsights.push(...this.analyzeCategorySpending(userId));

      // ============ ORDERING OPTIMIZATION ============
      allInsights.push(...this.detectBulkOpportunities(userId));
      allInsights.push(...this.detectVendorConsolidation(userId));

      // ============ INVENTORY & WASTE ============
      allInsights.push(...this.detectUsageChanges(userId));
      allInsights.push(...this.detectOverOrdering(userId));
      allInsights.push(...this.detectInactiveItems(userId));

      // ============ BUSINESS INTELLIGENCE ============
      allInsights.push(...this.analyzeBudgetPacing(userId));

      // ============ ADVANCED INTELLIGENCE ============
      allInsights.push(...this.detectPriceVolatility(userId));
      allInsights.push(...this.detectVendorDependency(userId));
      allInsights.push(...this.detectNewItems(userId));
      allInsights.push(...this.detectRushOrders(userId));
      allInsights.push(...this.detectCostCreep(userId));
      allInsights.push(...this.detectSpendConcentration(userId));
      allInsights.push(...this.detectDuplicateItems(userId));
      allInsights.push(...this.analyzeOrderTiming(userId));
      allInsights.push(...this.forecastUsage(userId));

      const elapsed = Date.now() - startTime;
      console.log(`[SmartOrdering] Generated ${allInsights.length} insights for user ${userId} in ${elapsed}ms`);

    } catch (error) {
      console.error('[SmartOrdering] Error generating insights:', error.message);
    }

    // Sort by urgency (high first) then by confidence
    return this.sortInsights(allInsights);
  }

  // ================================================================
  // TIMING & REORDERING INSIGHTS
  // ================================================================

  /**
   * Analyze reorder patterns - predict when items need reordering
   * Uses statistical analysis of order cycles with confidence scoring
   */
  analyzeReorderPatterns(userId) {
    const database = db.getDatabase();
    const insights = [];
    const vendorExclusion = this.getVendorExclusionClause('ir');

    try {
      const orderHistory = database.prepare(`
        SELECT
          ii.sku,
          ii.description,
          ir.vendor_name,
          DATE(ir.created_at) as order_date,
          SUM(ii.quantity) as total_qty,
          AVG(ii.unit_price_cents) as avg_price_cents
        FROM invoice_items ii
        JOIN ingestion_runs ir ON ii.run_id = ir.id
        WHERE ir.user_id = ?
          AND ir.status = 'completed'
          AND ii.sku IS NOT NULL AND ii.sku != ''
          AND ir.created_at >= date('now', '-' || ? || ' days')
          ${vendorExclusion}
        GROUP BY ii.sku, DATE(ir.created_at)
        ORDER BY ii.sku, ir.created_at
      `).all(userId, this.config.analysisWindowDays);

      const skuOrders = this.groupBySku(orderHistory);

      for (const [sku, orders] of Object.entries(skuOrders)) {
        if (orders.length < this.config.minDataPointsForAnalysis) continue;

        const cycleTimes = [];
        for (let i = 1; i < orders.length; i++) {
          const daysBetween = this.daysBetween(
            new Date(orders[i-1].order_date),
            new Date(orders[i].order_date)
          );
          if (daysBetween > 0 && daysBetween < 120) cycleTimes.push(daysBetween);
        }

        if (cycleTimes.length === 0) continue;

        const avgCycleTime = this.calculateMean(cycleTimes);
        const stdDev = this.calculateStdDev(cycleTimes);
        const coeffOfVariation = stdDev / avgCycleTime;

        // Skip if cycle is too irregular
        if (coeffOfVariation > 0.6) continue;

        const lastOrder = orders[orders.length - 1];
        const lastOrderDate = new Date(lastOrder.order_date);
        const predictedNextOrder = new Date(lastOrderDate);
        predictedNextOrder.setDate(predictedNextOrder.getDate() + Math.round(avgCycleTime));

        const today = new Date();
        const daysUntilReorder = this.daysBetween(today, predictedNextOrder);

        if (daysUntilReorder <= this.config.reorderAlertDaysBefore && daysUntilReorder >= -14) {
          const avgQty = this.calculateMean(orders.map(o => o.total_qty));
          const urgency = daysUntilReorder <= 0 ? 'high' :
                         daysUntilReorder <= 3 ? 'medium' : 'low';

          // Higher confidence with more data and consistent cycles
          const confidence = Math.min(95, Math.round(
            50 +
            (orders.length * 4) +
            ((1 - coeffOfVariation) * 30)
          ));

          insights.push({
            insight_type: 'reorder_prediction',
            sku,
            description: lastOrder.description,
            vendor_name: lastOrder.vendor_name,
            title: daysUntilReorder <= 0
              ? `⏰ Time to reorder: ${this.truncate(lastOrder.description || sku, 30)}`
              : `🔄 Reorder ${this.truncate(lastOrder.description || sku, 25)} in ${daysUntilReorder} days`,
            detail: `Based on ${orders.length} orders (avg every ${Math.round(avgCycleTime)} days), ` +
                    `you typically order ~${Math.round(avgQty)} units. Last ordered: ${this.formatDate(lastOrderDate)}.`,
            urgency,
            suggested_quantity: Math.round(avgQty),
            estimated_value_cents: Math.round(avgQty * (lastOrder.avg_price_cents || 0)),
            confidence_score: confidence,
            reasoning: {
              order_count: orders.length,
              avg_cycle_days: Math.round(avgCycleTime),
              cycle_consistency: Math.round((1 - coeffOfVariation) * 100),
              last_order_date: lastOrder.order_date,
              predicted_next_order: predictedNextOrder.toISOString().split('T')[0]
            }
          });
        }
      }
    } catch (error) {
      console.error('[SmartOrdering] Reorder analysis error:', error.message);
    }

    return insights;
  }

  /**
   * Analyze day-of-week ordering patterns
   * Identifies which day of the week orders typically happen
   */
  analyzeDayOfWeekPatterns(userId) {
    const database = db.getDatabase();
    const insights = [];
    // Get vendor exclusion patterns for direct query
    const excludedVendors = this.config.excludedVendors || [];
    const exclusionClauses = excludedVendors
      .map(v => `AND LOWER(vendor_name) NOT LIKE '%${v.toLowerCase()}%'`)
      .join(' ');

    try {
      // Get day-of-week distribution
      const dayPatterns = database.prepare(`
        SELECT
          strftime('%w', created_at) as day_of_week,
          COUNT(DISTINCT DATE(created_at)) as order_count,
          COUNT(*) as invoice_count
        FROM ingestion_runs
        WHERE user_id = ?
          AND status = 'completed'
          AND created_at >= date('now', '-60 days')
          ${exclusionClauses}
        GROUP BY strftime('%w', created_at)
        ORDER BY order_count DESC
      `).all(userId);

      if (dayPatterns.length < 2) return insights;

      const totalOrders = dayPatterns.reduce((sum, d) => sum + d.order_count, 0);
      const topDay = dayPatterns[0];
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

      // Only alert if there's a clear pattern (>40% on one day)
      const topDayPercent = (topDay.order_count / totalOrders) * 100;

      if (topDayPercent >= 40 && totalOrders >= 4) {
        const today = new Date();
        const currentDay = today.getDay();
        const targetDay = parseInt(topDay.day_of_week);
        let daysUntil = targetDay - currentDay;
        if (daysUntil <= 0) daysUntil += 7;

        if (daysUntil <= 3) {
          insights.push({
            insight_type: 'day_pattern',
            title: `📅 ${dayNames[targetDay]} is your typical ordering day`,
            detail: `${Math.round(topDayPercent)}% of your orders are placed on ${dayNames[targetDay]}s. ` +
                    `${daysUntil === 0 ? "That's today!" : `Next ${dayNames[targetDay]} is in ${daysUntil} day${daysUntil > 1 ? 's' : ''}.`}`,
            urgency: daysUntil === 0 ? 'high' : 'medium',
            confidence_score: Math.min(90, 50 + Math.round(topDayPercent / 2)),
            reasoning: {
              primary_order_day: dayNames[targetDay],
              percentage_on_day: Math.round(topDayPercent),
              total_orders_analyzed: totalOrders,
              days_until_next: daysUntil
            }
          });
        }
      }
    } catch (error) {
      console.error('[SmartOrdering] Day pattern analysis error:', error.message);
    }

    return insights;
  }

  /**
   * Analyze seasonal demand based on upcoming holidays
   * Compares to same period last year if data available
   */
  analyzeSeasonalDemand(userId) {
    const database = db.getDatabase();
    const insights = [];
    const vendorExclusion = this.getVendorExclusionClause('ir');

    try {
      const today = new Date();
      const currentMonth = today.getMonth() + 1;
      const currentDay = today.getDate();

      for (const [holidayKey, holiday] of Object.entries(this.config.holidays)) {
        const daysUntilHoliday = this.daysUntilDate(currentMonth, currentDay, holiday.month, holiday.day);

        // Only alert if holiday is within prep window
        if (daysUntilHoliday > 0 && daysUntilHoliday <= holiday.prepDays) {

          // Check if we have data from same period last year
          const lastYearData = database.prepare(`
            SELECT
              ir.vendor_name,
              SUM(ii.total_cents) as total_spend_cents,
              SUM(ii.quantity) as total_qty,
              COUNT(DISTINCT ii.sku) as unique_items
            FROM invoice_items ii
            JOIN ingestion_runs ir ON ii.run_id = ir.id
            WHERE ir.user_id = ?
              AND ir.status = 'completed'
              AND ir.created_at >= date('now', '-1 year', '-' || ? || ' days')
              AND ir.created_at <= date('now', '-1 year', '+' || ? || ' days')
              ${vendorExclusion}
            GROUP BY ir.vendor_name
            ORDER BY total_spend_cents DESC
            LIMIT 3
          `).all(userId, holiday.prepDays, 7);

          if (lastYearData.length > 0) {
            const totalSpend = lastYearData.reduce((sum, v) => sum + v.total_spend_cents, 0);
            const topVendors = lastYearData.map(v => v.vendor_name).slice(0, 2).join(', ');

            insights.push({
              insight_type: 'seasonal_demand',
              title: `🎉 ${holiday.name} in ${daysUntilHoliday} days - prep time!`,
              detail: `Last year around ${holiday.name}, you spent $${(totalSpend / 100).toLocaleString()} ` +
                      `across ${lastYearData.reduce((sum, v) => sum + v.unique_items, 0)} items. ` +
                      `Top vendors: ${topVendors}. Consider ordering ahead.`,
              urgency: daysUntilHoliday <= 3 ? 'high' : 'medium',
              estimated_value_cents: totalSpend,
              confidence_score: 80,
              reasoning: {
                holiday: holiday.name,
                days_until: daysUntilHoliday,
                last_year_spend: totalSpend,
                top_vendors: lastYearData.map(v => ({
                  vendor: v.vendor_name,
                  spend: v.total_spend_cents,
                  items: v.unique_items
                }))
              }
            });
          } else {
            // No last year data, but still remind about upcoming holiday
            insights.push({
              insight_type: 'seasonal_demand',
              title: `📆 ${holiday.name} is in ${daysUntilHoliday} days`,
              detail: `${holiday.name} is coming up! Review your inventory and consider ` +
                      `placing orders early to ensure availability.`,
              urgency: daysUntilHoliday <= 3 ? 'medium' : 'low',
              confidence_score: 60,
              reasoning: {
                holiday: holiday.name,
                days_until: daysUntilHoliday,
                has_historical_data: false
              }
            });
          }
        }
      }
    } catch (error) {
      console.error('[SmartOrdering] Seasonal analysis error:', error.message);
    }

    return insights;
  }

  // ================================================================
  // PRICING & COST INSIGHTS
  // ================================================================

  /**
   * Detect price anomalies - items priced above historical average
   */
  detectPriceAnomalies(userId) {
    const database = db.getDatabase();
    const insights = [];
    const vendorExclusion = this.getVendorExclusionClause('ir');

    try {
      const priceAnomalies = database.prepare(`
        WITH price_history AS (
          SELECT
            ii.sku,
            ii.description,
            ir.vendor_name,
            ii.unit_price_cents,
            ir.created_at,
            AVG(ii.unit_price_cents) OVER (
              PARTITION BY ii.sku
              ORDER BY ir.created_at
              ROWS BETWEEN 10 PRECEDING AND 1 PRECEDING
            ) as historical_avg
          FROM invoice_items ii
          JOIN ingestion_runs ir ON ii.run_id = ir.id
          WHERE ir.user_id = ?
            AND ir.status = 'completed'
            AND ii.sku IS NOT NULL AND ii.sku != ''
            AND ii.unit_price_cents > 0
            AND ir.created_at >= date('now', '-90 days')
            ${vendorExclusion}
        )
        SELECT
          sku,
          description,
          vendor_name,
          unit_price_cents as current_price,
          historical_avg,
          (unit_price_cents - historical_avg) * 1.0 / historical_avg as price_increase_pct,
          created_at
        FROM price_history
        WHERE historical_avg > 0
          AND created_at >= date('now', '-14 days')
          AND (unit_price_cents - historical_avg) * 1.0 / historical_avg > ?
        ORDER BY (unit_price_cents - historical_avg) * 1.0 / historical_avg DESC
        LIMIT 5
      `).all(userId, this.config.priceAnomalyThreshold);

      for (const item of priceAnomalies) {
        const increasePct = Math.round(item.price_increase_pct * 100);
        const overpaymentCents = Math.round(item.current_price - item.historical_avg);

        insights.push({
          insight_type: 'price_anomaly',
          sku: item.sku,
          description: item.description,
          vendor_name: item.vendor_name,
          title: `⚠️ ${this.truncate(item.description || item.sku, 25)}: ${increasePct}% above normal`,
          detail: `This item's current price ($${(item.current_price / 100).toFixed(2)}) is ${increasePct}% higher than ` +
                  `your historical average ($${(item.historical_avg / 100).toFixed(2)}). ` +
                  `Consider negotiating or finding alternatives.`,
          urgency: increasePct > 20 ? 'high' : 'medium',
          estimated_value_cents: overpaymentCents,
          confidence_score: 85,
          reasoning: {
            current_price_cents: Math.round(item.current_price),
            historical_avg_cents: Math.round(item.historical_avg),
            increase_percent: increasePct,
            overpayment_per_unit_cents: overpaymentCents
          }
        });
      }
    } catch (error) {
      console.error('[SmartOrdering] Price anomaly detection error:', error.message);
    }

    return insights;
  }

  /**
   * Detect price drops - opportunities to stock up
   */
  detectPriceDrops(userId) {
    const database = db.getDatabase();
    const insights = [];
    const vendorExclusion = this.getVendorExclusionClause('ir');

    try {
      const priceDrops = database.prepare(`
        WITH recent_prices AS (
          SELECT
            ii.sku,
            ii.description,
            ir.vendor_name,
            ii.unit_price_cents as current_price,
            ii.quantity as recent_qty,
            ir.created_at
          FROM invoice_items ii
          JOIN ingestion_runs ir ON ii.run_id = ir.id
          WHERE ir.user_id = ?
            AND ir.status = 'completed'
            AND ii.sku IS NOT NULL AND ii.sku != ''
            AND ii.unit_price_cents > 0
            AND ir.created_at >= date('now', '-14 days')
            ${vendorExclusion}
        ),
        historical_prices AS (
          SELECT
            ii.sku,
            AVG(ii.unit_price_cents) as historical_avg,
            COUNT(*) as order_count
          FROM invoice_items ii
          JOIN ingestion_runs ir ON ii.run_id = ir.id
          WHERE ir.user_id = ?
            AND ir.status = 'completed'
            AND ii.sku IS NOT NULL AND ii.sku != ''
            AND ii.unit_price_cents > 0
            AND ir.created_at >= date('now', '-90 days')
            AND ir.created_at < date('now', '-14 days')
            ${vendorExclusion}
          GROUP BY ii.sku
          HAVING order_count >= 2
        )
        SELECT
          rp.sku,
          rp.description,
          rp.vendor_name,
          rp.current_price,
          hp.historical_avg,
          (hp.historical_avg - rp.current_price) * 1.0 / hp.historical_avg as price_drop_pct,
          rp.recent_qty,
          hp.order_count
        FROM recent_prices rp
        JOIN historical_prices hp ON rp.sku = hp.sku
        WHERE (hp.historical_avg - rp.current_price) * 1.0 / hp.historical_avg > ?
        ORDER BY price_drop_pct DESC
        LIMIT 5
      `).all(userId, userId, this.config.priceDropThreshold);

      for (const item of priceDrops) {
        const dropPct = Math.round(item.price_drop_pct * 100);
        const savingsPerUnit = Math.round(item.historical_avg - item.current_price);
        const suggestedQty = Math.round((item.recent_qty || 10) * 2); // Suggest 2x typical order

        insights.push({
          insight_type: 'price_drop',
          sku: item.sku,
          description: item.description,
          vendor_name: item.vendor_name,
          title: `💰 ${this.truncate(item.description || item.sku, 25)}: ${dropPct}% price drop!`,
          detail: `Great news! This item dropped from $${(item.historical_avg / 100).toFixed(2)} to ` +
                  `$${(item.current_price / 100).toFixed(2)} (${dropPct}% savings). ` +
                  `Consider stocking up while the price is low.`,
          urgency: dropPct > 15 ? 'high' : 'medium',
          suggested_quantity: suggestedQty,
          estimated_value_cents: savingsPerUnit * suggestedQty,
          confidence_score: Math.min(90, 60 + item.order_count * 5),
          reasoning: {
            current_price_cents: Math.round(item.current_price),
            historical_avg_cents: Math.round(item.historical_avg),
            drop_percent: dropPct,
            savings_per_unit_cents: savingsPerUnit,
            historical_orders: item.order_count
          }
        });
      }
    } catch (error) {
      console.error('[SmartOrdering] Price drop detection error:', error.message);
    }

    return insights;
  }

  /**
   * Compare prices across vendors for same/similar items
   */
  compareVendorPrices(userId) {
    const database = db.getDatabase();
    const insights = [];
    const vendorExclusion = this.getVendorExclusionClause('ir');

    try {
      const vendorComparisons = database.prepare(`
        WITH vendor_prices AS (
          SELECT
            ii.sku,
            ii.description,
            ir.vendor_name,
            AVG(ii.unit_price_cents) as avg_price,
            COUNT(*) as order_count,
            MAX(ir.created_at) as last_order
          FROM invoice_items ii
          JOIN ingestion_runs ir ON ii.run_id = ir.id
          WHERE ir.user_id = ?
            AND ir.status = 'completed'
            AND ii.sku IS NOT NULL AND ii.sku != ''
            AND ii.unit_price_cents > 0
            AND ir.created_at >= date('now', '-90 days')
            ${vendorExclusion}
          GROUP BY ii.sku, ir.vendor_name
          HAVING order_count >= 2
        ),
        sku_with_multiple_vendors AS (
          SELECT sku
          FROM vendor_prices
          GROUP BY sku
          HAVING COUNT(DISTINCT vendor_name) >= 2
        )
        SELECT
          vp.sku,
          vp.description,
          vp.vendor_name,
          vp.avg_price,
          vp.order_count,
          MIN(vp2.avg_price) as lowest_price,
          (SELECT vendor_name FROM vendor_prices WHERE sku = vp.sku ORDER BY avg_price ASC LIMIT 1) as cheapest_vendor
        FROM vendor_prices vp
        JOIN sku_with_multiple_vendors smv ON vp.sku = smv.sku
        JOIN vendor_prices vp2 ON vp.sku = vp2.sku
        WHERE vp.avg_price > (SELECT MIN(avg_price) FROM vendor_prices WHERE sku = vp.sku) * (1 + ?)
        GROUP BY vp.sku, vp.vendor_name
        ORDER BY (vp.avg_price - MIN(vp2.avg_price)) DESC
        LIMIT 5
      `).all(userId, this.config.vendorPriceDiffThreshold);

      for (const item of vendorComparisons) {
        const priceDiff = Math.round(item.avg_price - item.lowest_price);
        const diffPct = Math.round((priceDiff / item.avg_price) * 100);

        if (item.vendor_name !== item.cheapest_vendor && priceDiff > 50) {
          insights.push({
            insight_type: 'vendor_comparison',
            sku: item.sku,
            description: item.description,
            vendor_name: item.vendor_name,
            title: `🔍 ${this.truncate(item.description || item.sku, 20)}: ${diffPct}% cheaper elsewhere`,
            detail: `You're paying $${(item.avg_price / 100).toFixed(2)} at ${item.vendor_name}, but ` +
                    `${item.cheapest_vendor} has it for $${(item.lowest_price / 100).toFixed(2)} ` +
                    `(${diffPct}% less). Consider switching vendors for this item.`,
            urgency: diffPct > 20 ? 'high' : 'medium',
            estimated_value_cents: priceDiff * 10, // Estimate 10 units worth
            confidence_score: Math.min(85, 50 + item.order_count * 5),
            reasoning: {
              current_vendor: item.vendor_name,
              current_price_cents: Math.round(item.avg_price),
              cheapest_vendor: item.cheapest_vendor,
              cheapest_price_cents: Math.round(item.lowest_price),
              savings_per_unit_cents: priceDiff,
              savings_percent: diffPct
            }
          });
        }
      }
    } catch (error) {
      console.error('[SmartOrdering] Vendor comparison error:', error.message);
    }

    return insights;
  }

  /**
   * Analyze category spending trends
   */
  analyzeCategorySpending(userId) {
    const database = db.getDatabase();
    const insights = [];
    const vendorExclusion = this.getVendorExclusionClause('ir');

    try {
      const categoryTrends = database.prepare(`
        WITH monthly_category AS (
          SELECT
            ii.category,
            strftime('%Y-%m', ir.created_at) as month,
            SUM(ii.total_cents) as monthly_spend,
            COUNT(DISTINCT ii.sku) as unique_items
          FROM invoice_items ii
          JOIN ingestion_runs ir ON ii.run_id = ir.id
          WHERE ir.user_id = ?
            AND ir.status = 'completed'
            AND ii.category IS NOT NULL AND ii.category != '' AND ii.category != 'general'
            AND ir.created_at >= date('now', '-90 days')
            ${vendorExclusion}
          GROUP BY ii.category, strftime('%Y-%m', ir.created_at)
        ),
        category_trends AS (
          SELECT
            category,
            AVG(monthly_spend) as avg_monthly,
            MAX(CASE WHEN month = strftime('%Y-%m', 'now') THEN monthly_spend END) as this_month,
            MAX(CASE WHEN month = strftime('%Y-%m', 'now', '-1 month') THEN monthly_spend END) as last_month
          FROM monthly_category
          GROUP BY category
          HAVING COUNT(*) >= 2
        )
        SELECT *,
          CASE
            WHEN COALESCE(last_month, avg_monthly) > 0
            THEN (this_month - COALESCE(last_month, avg_monthly)) * 1.0 / COALESCE(last_month, avg_monthly)
            ELSE 0
          END as change_rate
        FROM category_trends
        WHERE this_month IS NOT NULL
          AND ABS(CASE
            WHEN COALESCE(last_month, avg_monthly) > 0
            THEN (this_month - COALESCE(last_month, avg_monthly)) * 1.0 / COALESCE(last_month, avg_monthly)
            ELSE 0
          END) > ?
        ORDER BY ABS(change_rate) DESC
        LIMIT 3
      `).all(userId, this.config.categorySpendSpikeThreshold);

      for (const cat of categoryTrends) {
        const changeRate = cat.change_rate;
        const changePct = Math.round(Math.abs(changeRate) * 100);
        const isIncrease = changeRate > 0;
        const icon = isIncrease ? '📈' : '📉';

        insights.push({
          insight_type: 'category_trend',
          title: `${icon} ${cat.category} spending ${isIncrease ? 'up' : 'down'} ${changePct}%`,
          detail: `Your ${cat.category} spending ${isIncrease ? 'increased' : 'decreased'} from ` +
                  `$${((cat.last_month || cat.avg_monthly) / 100).toLocaleString()} to ` +
                  `$${(cat.this_month / 100).toLocaleString()} this month. ` +
                  `${isIncrease ? 'Review for unnecessary expenses.' : 'Good cost control!'}`,
          urgency: isIncrease && changePct > 40 ? 'high' : 'medium',
          estimated_value_cents: isIncrease ? Math.round(cat.this_month - (cat.last_month || cat.avg_monthly)) : 0,
          confidence_score: 75,
          reasoning: {
            category: cat.category,
            this_month_cents: Math.round(cat.this_month),
            last_month_cents: Math.round(cat.last_month || cat.avg_monthly),
            avg_monthly_cents: Math.round(cat.avg_monthly),
            change_percent: changePct * (isIncrease ? 1 : -1)
          }
        });
      }
    } catch (error) {
      console.error('[SmartOrdering] Category spending analysis error:', error.message);
    }

    return insights;
  }

  // ================================================================
  // ORDERING OPTIMIZATION INSIGHTS
  // ================================================================

  /**
   * Detect bulk consolidation opportunities - frequent small orders
   */
  detectBulkOpportunities(userId) {
    const database = db.getDatabase();
    const insights = [];
    const vendorExclusion = this.getVendorExclusionClause('ir');

    try {
      const frequentOrders = database.prepare(`
        SELECT
          ii.sku,
          ii.description,
          ir.vendor_name,
          COUNT(DISTINCT DATE(ir.created_at)) as order_count,
          SUM(ii.quantity) as total_qty,
          AVG(ii.quantity) as avg_qty_per_order,
          MAX(ii.quantity) as max_qty_per_order,
          AVG(ii.unit_price_cents) as avg_price_cents,
          SUM(ii.total_cents) as total_spend_cents
        FROM invoice_items ii
        JOIN ingestion_runs ir ON ii.run_id = ir.id
        WHERE ir.user_id = ?
          AND ir.status = 'completed'
          AND ii.sku IS NOT NULL AND ii.sku != ''
          AND ir.created_at >= date('now', '-' || ? || ' days')
          ${vendorExclusion}
        GROUP BY ii.sku
        HAVING order_count >= ?
      `).all(userId, this.config.analysisWindowDays, this.config.minOrdersForBulkAnalysis);

      for (const item of frequentOrders) {
        const isSmallOrderPattern = item.avg_qty_per_order < (item.max_qty_per_order * this.config.smallOrderThreshold);

        if (isSmallOrderPattern || item.order_count >= 5) {
          // Conservative bulk discount estimate (5-10%)
          const estimatedDiscount = 0.07;
          const potentialSavings = Math.round(item.total_spend_cents * estimatedDiscount);

          if (potentialSavings >= this.config.minSavingsForInsight) {
            const consolidatedQty = Math.round(item.avg_qty_per_order * 3);

            insights.push({
              insight_type: 'bulk_consolidation',
              sku: item.sku,
              description: item.description,
              vendor_name: item.vendor_name,
              title: `📦 Consolidate ${this.truncate(item.description || item.sku, 20)} orders`,
              detail: `You ordered this ${item.order_count} times (avg ${Math.round(item.avg_qty_per_order)} units). ` +
                      `Order ${consolidatedQty} at once to save ~$${(potentialSavings / 100).toFixed(0)} ` +
                      `through bulk pricing and fewer orders.`,
              urgency: potentialSavings > 1500 ? 'high' : 'medium',
              suggested_quantity: consolidatedQty,
              estimated_value_cents: potentialSavings,
              confidence_score: Math.min(85, 50 + item.order_count * 4),
              reasoning: {
                order_count: item.order_count,
                avg_qty_per_order: Math.round(item.avg_qty_per_order),
                max_qty_per_order: Math.round(item.max_qty_per_order),
                total_spend_cents: item.total_spend_cents,
                estimated_discount: Math.round(estimatedDiscount * 100) + '%'
              }
            });
          }
        }
      }
    } catch (error) {
      console.error('[SmartOrdering] Bulk opportunity detection error:', error.message);
    }

    return insights;
  }

  /**
   * Detect vendor consolidation opportunities
   * Multiple small orders to same vendor that could be combined
   */
  detectVendorConsolidation(userId) {
    const database = db.getDatabase();
    const insights = [];
    // Get vendor exclusion patterns for direct query
    const excludedVendors = this.config.excludedVendors || [];

    try {
      // Build exclusion clause for direct ingestion_runs query
      const exclusionClauses = excludedVendors
        .map(v => `AND LOWER(vendor_name) NOT LIKE '%${v.toLowerCase()}%'`)
        .join(' ');

      const vendorOrders = database.prepare(`
        SELECT
          vendor_name,
          COUNT(DISTINCT DATE(created_at)) as order_days,
          COUNT(*) as total_invoices,
          SUM(invoice_total_cents) as total_spend_cents,
          AVG(invoice_total_cents) as avg_invoice_cents
        FROM ingestion_runs
        WHERE user_id = ?
          AND status = 'completed'
          AND vendor_name IS NOT NULL AND vendor_name != 'Unknown Vendor'
          AND created_at >= date('now', '-30 days')
          ${exclusionClauses}
        GROUP BY vendor_name
        HAVING order_days >= 3
        ORDER BY order_days DESC
        LIMIT 3
      `).all(userId);

      for (const vendor of vendorOrders) {
        // Calculate potential savings from consolidating orders (delivery/processing savings)
        const ordersPerWeek = vendor.order_days / 4.3;
        const potentialConsolidatedOrders = Math.ceil(vendor.order_days / 3);
        const ordersSaved = vendor.order_days - potentialConsolidatedOrders;
        const savingsPerOrder = 1500; // Estimate $15 per order in admin/delivery costs
        const potentialSavings = ordersSaved * savingsPerOrder;

        if (potentialSavings >= this.config.minSavingsForInsight && vendor.order_days >= 4) {
          insights.push({
            insight_type: 'vendor_consolidation',
            vendor_name: vendor.vendor_name,
            title: `🤝 Consolidate ${vendor.vendor_name} orders`,
            detail: `You placed ${vendor.order_days} orders to ${vendor.vendor_name} this month ` +
                    `(~${ordersPerWeek.toFixed(1)}/week). Consolidating to ${potentialConsolidatedOrders} larger orders ` +
                    `could save ~$${(potentialSavings / 100).toFixed(0)} in processing and delivery.`,
            urgency: vendor.order_days >= 6 ? 'high' : 'medium',
            estimated_value_cents: potentialSavings,
            confidence_score: 70,
            reasoning: {
              current_orders: vendor.order_days,
              orders_per_week: ordersPerWeek.toFixed(1),
              recommended_orders: potentialConsolidatedOrders,
              orders_eliminated: ordersSaved,
              avg_order_value_cents: Math.round(vendor.avg_invoice_cents)
            }
          });
        }
      }
    } catch (error) {
      console.error('[SmartOrdering] Vendor consolidation error:', error.message);
    }

    return insights;
  }

  // ================================================================
  // INVENTORY & WASTE PREVENTION INSIGHTS
  // ================================================================

  /**
   * Detect usage changes that may require ordering adjustments
   */
  detectUsageChanges(userId) {
    const database = db.getDatabase();
    const insights = [];
    const vendorExclusion = this.getVendorExclusionClause('ir');

    try {
      const usageChanges = database.prepare(`
        WITH recent AS (
          SELECT
            ii.sku,
            ii.description,
            ir.vendor_name,
            SUM(ii.quantity) as qty,
            COUNT(DISTINCT DATE(ir.created_at)) as order_days,
            AVG(ii.unit_price_cents) as avg_price
          FROM invoice_items ii
          JOIN ingestion_runs ir ON ii.run_id = ir.id
          WHERE ir.user_id = ?
            AND ir.status = 'completed'
            AND ii.sku IS NOT NULL AND ii.sku != ''
            AND ir.created_at >= date('now', '-30 days')
            ${vendorExclusion}
          GROUP BY ii.sku
        ),
        prior AS (
          SELECT
            ii.sku,
            SUM(ii.quantity) as qty,
            COUNT(DISTINCT DATE(ir.created_at)) as order_days
          FROM invoice_items ii
          JOIN ingestion_runs ir ON ii.run_id = ir.id
          WHERE ir.user_id = ?
            AND ir.status = 'completed'
            AND ii.sku IS NOT NULL AND ii.sku != ''
            AND ir.created_at >= date('now', '-60 days')
            AND ir.created_at < date('now', '-30 days')
            ${vendorExclusion}
          GROUP BY ii.sku
        )
        SELECT
          r.sku,
          r.description,
          r.vendor_name,
          r.qty as recent_qty,
          r.order_days as recent_order_days,
          COALESCE(p.qty, 0) as prior_qty,
          COALESCE(p.order_days, 0) as prior_order_days,
          r.avg_price as avg_price_cents,
          CASE
            WHEN COALESCE(p.qty, 0) > 0 THEN (r.qty - p.qty) * 1.0 / p.qty
            ELSE 1.0
          END as qty_change_rate
        FROM recent r
        LEFT JOIN prior p ON r.sku = p.sku
        WHERE p.qty > 0
          AND ABS((r.qty - p.qty) * 1.0 / p.qty) > ?
      `).all(userId, userId, this.config.usageChangeThreshold);

      for (const item of usageChanges) {
        const changeRate = item.qty_change_rate;
        const changePct = Math.round(Math.abs(changeRate) * 100);
        const isIncrease = changeRate > 0;

        // Only alert on increases that might cause stock issues
        if (isIncrease && changeRate > 0.25) {
          const orderFreqChange = item.prior_order_days > 0
            ? (item.recent_order_days - item.prior_order_days) / item.prior_order_days
            : 0;

          // Alert if ordering hasn't kept pace with usage
          if (orderFreqChange < changeRate * 0.5) {
            insights.push({
              insight_type: 'low_stock_risk',
              sku: item.sku,
              description: item.description,
              vendor_name: item.vendor_name,
              title: `⚡ ${this.truncate(item.description || item.sku, 25)}: Usage up ${changePct}%`,
              detail: `Increased from ${Math.round(item.prior_qty)} to ${Math.round(item.recent_qty)} units/month. ` +
                      `Your ordering hasn't caught up - increase next order to avoid stockouts.`,
              urgency: changePct > 50 ? 'high' : 'medium',
              suggested_quantity: Math.round(item.recent_qty * 1.25),
              estimated_value_cents: Math.round(item.recent_qty * 1.25 * (item.avg_price_cents || 0)),
              confidence_score: 80,
              reasoning: {
                prior_qty: Math.round(item.prior_qty),
                recent_qty: Math.round(item.recent_qty),
                change_percent: changePct,
                order_frequency_change: Math.round(orderFreqChange * 100)
              }
            });
          }
        }
      }
    } catch (error) {
      console.error('[SmartOrdering] Usage change detection error:', error.message);
    }

    return insights;
  }

  /**
   * Detect over-ordering - potential waste
   */
  detectOverOrdering(userId) {
    const database = db.getDatabase();
    const insights = [];
    const vendorExclusion = this.getVendorExclusionClause('ir');

    try {
      // Look for items where ordering quantity is growing faster than a sustainable rate
      const overOrdering = database.prepare(`
        WITH monthly_orders AS (
          SELECT
            ii.sku,
            ii.description,
            ir.vendor_name,
            strftime('%Y-%m', ir.created_at) as month,
            SUM(ii.quantity) as monthly_qty,
            SUM(ii.total_cents) as monthly_spend
          FROM invoice_items ii
          JOIN ingestion_runs ir ON ii.run_id = ir.id
          WHERE ir.user_id = ?
            AND ir.status = 'completed'
            AND ii.sku IS NOT NULL AND ii.sku != ''
            AND ir.created_at >= date('now', '-90 days')
            ${vendorExclusion}
          GROUP BY ii.sku, strftime('%Y-%m', ir.created_at)
        ),
        sku_trends AS (
          SELECT
            sku,
            description,
            vendor_name,
            AVG(monthly_qty) as avg_monthly_qty,
            MAX(CASE WHEN month = strftime('%Y-%m', 'now') THEN monthly_qty END) as this_month,
            MAX(monthly_spend) as max_monthly_spend
          FROM monthly_orders
          GROUP BY sku
          HAVING COUNT(*) >= 2
        )
        SELECT *,
          (this_month - avg_monthly_qty) * 1.0 / avg_monthly_qty as variance
        FROM sku_trends
        WHERE this_month > avg_monthly_qty * (1 + ?)
          AND this_month > 5
        ORDER BY variance DESC
        LIMIT 3
      `).all(userId, this.config.overOrderingThreshold);

      for (const item of overOrdering) {
        const excessQty = Math.round(item.this_month - item.avg_monthly_qty);
        const excessPct = Math.round((excessQty / item.avg_monthly_qty) * 100);

        insights.push({
          insight_type: 'over_ordering',
          sku: item.sku,
          description: item.description,
          vendor_name: item.vendor_name,
          title: `🗑️ ${this.truncate(item.description || item.sku, 25)}: ${excessPct}% above normal`,
          detail: `This month: ${Math.round(item.this_month)} units vs avg ${Math.round(item.avg_monthly_qty)}. ` +
                  `That's ${excessQty} extra units. Check for waste or adjust future orders.`,
          urgency: excessPct > 50 ? 'high' : 'medium',
          estimated_value_cents: Math.round(excessQty * (item.max_monthly_spend / item.this_month)),
          confidence_score: 70,
          reasoning: {
            this_month_qty: Math.round(item.this_month),
            avg_monthly_qty: Math.round(item.avg_monthly_qty),
            excess_qty: excessQty,
            excess_percent: excessPct
          }
        });
      }
    } catch (error) {
      console.error('[SmartOrdering] Over-ordering detection error:', error.message);
    }

    return insights;
  }

  /**
   * Detect inactive items - not ordered in a while (potential spoilage)
   */
  detectInactiveItems(userId) {
    const database = db.getDatabase();
    const insights = [];
    const vendorExclusion = this.getVendorExclusionClause('ir');

    try {
      const inactiveItems = database.prepare(`
        WITH item_history AS (
          SELECT
            ii.sku,
            ii.description,
            ir.vendor_name,
            MAX(ir.created_at) as last_order_date,
            COUNT(DISTINCT DATE(ir.created_at)) as total_orders,
            AVG(ii.quantity) as avg_qty,
            AVG(ii.unit_price_cents) as avg_price
          FROM invoice_items ii
          JOIN ingestion_runs ir ON ii.run_id = ir.id
          WHERE ir.user_id = ?
            AND ir.status = 'completed'
            AND ii.sku IS NOT NULL AND ii.sku != ''
            AND ir.created_at >= date('now', '-180 days')
            ${vendorExclusion}
          GROUP BY ii.sku
          HAVING total_orders >= 3
        )
        SELECT *,
          CAST(julianday('now') - julianday(last_order_date) AS INTEGER) as days_since_order
        FROM item_history
        WHERE julianday('now') - julianday(last_order_date) > ?
        ORDER BY days_since_order DESC
        LIMIT 3
      `).all(userId, this.config.inactiveItemDays);

      for (const item of inactiveItems) {
        insights.push({
          insight_type: 'inactive_item',
          sku: item.sku,
          description: item.description,
          vendor_name: item.vendor_name,
          title: `❓ ${this.truncate(item.description || item.sku, 25)}: ${item.days_since_order} days since last order`,
          detail: `You used to order this regularly (${item.total_orders} times), but haven't in ${item.days_since_order} days. ` +
                  `Check if you still have stock or if it's been replaced.`,
          urgency: item.days_since_order > 90 ? 'low' : 'medium',
          confidence_score: 65,
          reasoning: {
            last_order_date: item.last_order_date,
            days_inactive: item.days_since_order,
            historical_orders: item.total_orders,
            avg_qty: Math.round(item.avg_qty)
          }
        });
      }
    } catch (error) {
      console.error('[SmartOrdering] Inactive item detection error:', error.message);
    }

    return insights;
  }

  // ================================================================
  // BUSINESS INTELLIGENCE INSIGHTS
  // ================================================================

  /**
   * Analyze budget pacing - month-to-date vs typical
   */
  analyzeBudgetPacing(userId) {
    const database = db.getDatabase();
    const insights = [];
    // Get vendor exclusion patterns for direct query
    const excludedVendors = this.config.excludedVendors || [];
    const exclusionClauses = excludedVendors
      .map(v => `AND LOWER(vendor_name) NOT LIKE '%${v.toLowerCase()}%'`)
      .join(' ');

    try {
      const budgetPacing = database.prepare(`
        WITH monthly_totals AS (
          SELECT
            strftime('%Y-%m', created_at) as month,
            SUM(invoice_total_cents) as monthly_total
          FROM ingestion_runs
          WHERE user_id = ?
            AND status = 'completed'
            AND created_at >= date('now', '-90 days')
            ${exclusionClauses}
          GROUP BY strftime('%Y-%m', created_at)
        ),
        current_month AS (
          SELECT
            SUM(invoice_total_cents) as mtd_total,
            CAST(strftime('%d', 'now') AS INTEGER) as day_of_month
          FROM ingestion_runs
          WHERE user_id = ?
            AND status = 'completed'
            AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
            ${exclusionClauses}
        )
        SELECT
          cm.mtd_total,
          cm.day_of_month,
          AVG(mt.monthly_total) as avg_monthly,
          (cm.mtd_total * 1.0 / (cm.day_of_month * 1.0 / 30)) as projected_monthly
        FROM current_month cm, monthly_totals mt
        WHERE mt.month < strftime('%Y-%m', 'now')
      `).get(userId, userId);

      if (budgetPacing && budgetPacing.avg_monthly > 0) {
        const projectedPct = Math.round((budgetPacing.projected_monthly / budgetPacing.avg_monthly) * 100);
        const mtdPct = Math.round((budgetPacing.mtd_total / budgetPacing.avg_monthly) * 100);

        if (projectedPct > 115) {
          insights.push({
            insight_type: 'budget_pacing',
            title: `💸 On pace to exceed typical spend by ${projectedPct - 100}%`,
            detail: `${budgetPacing.day_of_month} days in, you've spent $${(budgetPacing.mtd_total / 100).toLocaleString()} ` +
                    `(${mtdPct}% of typical month). Projected: $${(budgetPacing.projected_monthly / 100).toLocaleString()} ` +
                    `vs typical $${(budgetPacing.avg_monthly / 100).toLocaleString()}.`,
            urgency: projectedPct > 130 ? 'high' : 'medium',
            estimated_value_cents: Math.round(budgetPacing.projected_monthly - budgetPacing.avg_monthly),
            confidence_score: 75,
            reasoning: {
              mtd_spend_cents: Math.round(budgetPacing.mtd_total),
              day_of_month: budgetPacing.day_of_month,
              avg_monthly_cents: Math.round(budgetPacing.avg_monthly),
              projected_monthly_cents: Math.round(budgetPacing.projected_monthly),
              projected_vs_avg_percent: projectedPct
            }
          });
        }
      }
    } catch (error) {
      console.error('[SmartOrdering] Budget pacing analysis error:', error.message);
    }

    return insights;
  }

  /**
   * Forecast usage and suggest order quantities
   */
  forecastUsage(userId) {
    const database = db.getDatabase();
    const insights = [];
    const vendorExclusion = this.getVendorExclusionClause('ir');

    try {
      const trendingItems = database.prepare(`
        WITH monthly_orders AS (
          SELECT
            ii.sku,
            ii.description,
            ir.vendor_name,
            strftime('%Y-%m', ir.created_at) as month,
            SUM(ii.quantity) as monthly_qty,
            AVG(ii.unit_price_cents) as avg_price
          FROM invoice_items ii
          JOIN ingestion_runs ir ON ii.run_id = ir.id
          WHERE ir.user_id = ?
            AND ir.status = 'completed'
            AND ii.sku IS NOT NULL AND ii.sku != ''
            AND ir.created_at >= date('now', '-90 days')
            ${vendorExclusion}
          GROUP BY ii.sku, strftime('%Y-%m', ir.created_at)
        ),
        sku_trends AS (
          SELECT
            sku,
            description,
            vendor_name,
            COUNT(*) as months_with_orders,
            AVG(monthly_qty) as avg_monthly_qty,
            MAX(CASE WHEN month = strftime('%Y-%m', 'now') THEN monthly_qty END) as this_month,
            MAX(CASE WHEN month = strftime('%Y-%m', 'now', '-1 month') THEN monthly_qty END) as last_month,
            AVG(avg_price) as avg_price_cents
          FROM monthly_orders
          GROUP BY sku
          HAVING months_with_orders >= 2
        )
        SELECT *,
          CASE
            WHEN last_month > 0 THEN (COALESCE(this_month, 0) - last_month) * 1.0 / last_month
            ELSE 0
          END as growth_rate
        FROM sku_trends
        WHERE (this_month IS NOT NULL OR last_month IS NOT NULL)
          AND ABS(CASE
            WHEN last_month > 0 THEN (COALESCE(this_month, 0) - last_month) * 1.0 / last_month
            ELSE 0
          END) > 0.20
        ORDER BY ABS(growth_rate) DESC
        LIMIT 3
      `).all(userId);

      for (const item of trendingItems) {
        const growthRate = item.growth_rate || 0;
        const growthPct = Math.round(Math.abs(growthRate) * 100);
        const isIncrease = growthRate > 0;

        if (growthPct >= 20) {
          const currentQty = item.this_month || item.last_month || item.avg_monthly_qty;
          const forecastedQty = Math.round(currentQty * (1 + growthRate * 0.6)); // Dampened forecast
          const icon = isIncrease ? '📈' : '📉';

          insights.push({
            insight_type: 'usage_forecast',
            sku: item.sku,
            description: item.description,
            vendor_name: item.vendor_name,
            title: `${icon} ${this.truncate(item.description || item.sku, 22)}: ${isIncrease ? '+' : '-'}${growthPct}% trend`,
            detail: `${isIncrease ? 'Growing' : 'Declining'} usage: ${Math.round(item.last_month || 0)} → ${Math.round(item.this_month || 0)} units. ` +
                    `Next month forecast: ${forecastedQty} units.`,
            urgency: growthPct > 35 ? 'medium' : 'low',
            suggested_quantity: forecastedQty,
            estimated_value_cents: Math.round(forecastedQty * (item.avg_price_cents || 0)),
            confidence_score: Math.min(80, 50 + item.months_with_orders * 8),
            reasoning: {
              last_month_qty: Math.round(item.last_month || 0),
              this_month_qty: Math.round(item.this_month || 0),
              growth_percent: growthPct * (isIncrease ? 1 : -1),
              forecast_qty: forecastedQty,
              months_of_data: item.months_with_orders
            }
          });
        }
      }
    } catch (error) {
      console.error('[SmartOrdering] Usage forecast error:', error.message);
    }

    return insights;
  }

  // ================================================================
  // ADVANCED INTELLIGENCE INSIGHTS (8 New Types)
  // ================================================================

  /**
   * Detect price volatility - items with unstable/unpredictable pricing
   * High variance = supply chain issues or inconsistent vendor pricing
   */
  detectPriceVolatility(userId) {
    const database = db.getDatabase();
    const insights = [];
    const vendorExclusion = this.getVendorExclusionClause('ir');

    try {
      const volatileItems = database.prepare(`
        WITH price_stats AS (
          SELECT
            ii.sku,
            ii.description,
            ir.vendor_name,
            COUNT(*) as order_count,
            AVG(ii.unit_price_cents) as avg_price,
            MIN(ii.unit_price_cents) as min_price,
            MAX(ii.unit_price_cents) as max_price,
            SUM(ii.total_cents) as total_spend
          FROM invoice_items ii
          JOIN ingestion_runs ir ON ii.run_id = ir.id
          WHERE ir.user_id = ?
            AND ir.status = 'completed'
            AND ii.sku IS NOT NULL AND ii.sku != ''
            AND ii.unit_price_cents > 0
            AND ir.created_at >= date('now', '-90 days')
            ${vendorExclusion}
          GROUP BY ii.sku
          HAVING order_count >= 4
        )
        SELECT *,
          (max_price - min_price) * 1.0 / avg_price as price_range_pct,
          (max_price - min_price) as price_swing_cents
        FROM price_stats
        WHERE (max_price - min_price) * 1.0 / avg_price > 0.15
        ORDER BY price_range_pct DESC
        LIMIT 3
      `).all(userId);

      for (const item of volatileItems) {
        const rangePct = Math.round(item.price_range_pct * 100);
        const avgPrice = item.avg_price / 100;

        insights.push({
          insight_type: 'price_volatility',
          sku: item.sku,
          description: item.description,
          vendor_name: item.vendor_name,
          title: `🎢 ${this.truncate(item.description || item.sku, 22)}: ${rangePct}% price swings`,
          detail: `Price varies from $${(item.min_price / 100).toFixed(2)} to $${(item.max_price / 100).toFixed(2)} ` +
                  `(avg $${avgPrice.toFixed(2)}). Consider locking in a contract price or finding a more stable supplier.`,
          urgency: rangePct > 30 ? 'high' : 'medium',
          estimated_value_cents: Math.round(item.price_swing_cents * 0.5), // Potential savings from stability
          confidence_score: Math.min(85, 50 + item.order_count * 5),
          reasoning: {
            min_price_cents: item.min_price,
            max_price_cents: item.max_price,
            avg_price_cents: Math.round(item.avg_price),
            price_range_percent: rangePct,
            order_count: item.order_count
          }
        });
      }
    } catch (error) {
      console.error('[SmartOrdering] Price volatility detection error:', error.message);
    }

    return insights;
  }

  /**
   * Detect vendor dependency - too much spend concentrated with one vendor
   * Supply chain risk if >60% of spend is with single vendor
   */
  detectVendorDependency(userId) {
    const database = db.getDatabase();
    const insights = [];
    const excludedVendors = this.config.excludedVendors || [];
    const exclusionClauses = excludedVendors
      .map(v => `AND LOWER(vendor_name) NOT LIKE '%${v.toLowerCase()}%'`)
      .join(' ');

    try {
      const vendorSpend = database.prepare(`
        SELECT
          vendor_name,
          SUM(invoice_total_cents) as vendor_spend,
          COUNT(*) as invoice_count
        FROM ingestion_runs
        WHERE user_id = ?
          AND status = 'completed'
          AND vendor_name IS NOT NULL AND vendor_name != 'Unknown Vendor'
          AND created_at >= date('now', '-90 days')
          ${exclusionClauses}
        GROUP BY vendor_name
        ORDER BY vendor_spend DESC
      `).all(userId);

      if (vendorSpend.length < 2) return insights;

      const totalSpend = vendorSpend.reduce((sum, v) => sum + v.vendor_spend, 0);
      const topVendor = vendorSpend[0];
      const topVendorPct = (topVendor.vendor_spend / totalSpend) * 100;

      if (topVendorPct >= 60 && totalSpend > 100000) { // >60% and >$1000 total
        const secondVendor = vendorSpend[1];
        const secondPct = secondVendor ? Math.round((secondVendor.vendor_spend / totalSpend) * 100) : 0;

        insights.push({
          insight_type: 'vendor_dependency',
          vendor_name: topVendor.vendor_name,
          title: `⚠️ ${Math.round(topVendorPct)}% of spend with ${this.truncate(topVendor.vendor_name, 20)}`,
          detail: `Heavy reliance on one vendor creates supply chain risk. ` +
                  `If ${topVendor.vendor_name} has issues, it could disrupt ${Math.round(topVendorPct)}% of your operations. ` +
                  `Consider diversifying to reduce risk.`,
          urgency: topVendorPct >= 75 ? 'high' : 'medium',
          estimated_value_cents: 0, // Risk mitigation, not direct savings
          confidence_score: 90,
          reasoning: {
            top_vendor: topVendor.vendor_name,
            top_vendor_spend_cents: topVendor.vendor_spend,
            top_vendor_percent: Math.round(topVendorPct),
            second_vendor: secondVendor?.vendor_name,
            second_vendor_percent: secondPct,
            total_spend_cents: totalSpend,
            vendor_count: vendorSpend.length
          }
        });
      }
    } catch (error) {
      console.error('[SmartOrdering] Vendor dependency detection error:', error.message);
    }

    return insights;
  }

  /**
   * Detect new items - flag SKUs that appeared for the first time recently
   * Helps catch unauthorized purchases or track new product additions
   */
  detectNewItems(userId) {
    const database = db.getDatabase();
    const insights = [];
    const vendorExclusion = this.getVendorExclusionClause('ir');

    try {
      const newItems = database.prepare(`
        WITH first_appearance AS (
          SELECT
            ii.sku,
            ii.description,
            ir.vendor_name,
            MIN(ir.created_at) as first_ordered,
            SUM(ii.total_cents) as total_spend,
            SUM(ii.quantity) as total_qty,
            COUNT(*) as order_count
          FROM invoice_items ii
          JOIN ingestion_runs ir ON ii.run_id = ir.id
          WHERE ir.user_id = ?
            AND ir.status = 'completed'
            AND ii.sku IS NOT NULL AND ii.sku != ''
            ${vendorExclusion}
          GROUP BY ii.sku
        )
        SELECT *,
          CAST(julianday('now') - julianday(first_ordered) AS INTEGER) as days_since_first
        FROM first_appearance
        WHERE julianday('now') - julianday(first_ordered) <= 14
          AND total_spend > 500
        ORDER BY total_spend DESC
        LIMIT 5
      `).all(userId);

      for (const item of newItems) {
        insights.push({
          insight_type: 'new_item',
          sku: item.sku,
          description: item.description,
          vendor_name: item.vendor_name,
          title: `🆕 New item: ${this.truncate(item.description || item.sku, 28)}`,
          detail: `First ordered ${item.days_since_first} days ago from ${item.vendor_name}. ` +
                  `Total spend: $${(item.total_spend / 100).toFixed(2)} (${item.order_count} order${item.order_count > 1 ? 's' : ''}). ` +
                  `Verify this is an approved purchase.`,
          urgency: item.total_spend > 5000 ? 'high' : 'low',
          estimated_value_cents: item.total_spend,
          confidence_score: 95,
          reasoning: {
            first_ordered: item.first_ordered,
            days_since_first: item.days_since_first,
            total_spend_cents: item.total_spend,
            order_count: item.order_count,
            total_qty: Math.round(item.total_qty)
          }
        });
      }
    } catch (error) {
      console.error('[SmartOrdering] New item detection error:', error.message);
    }

    return insights;
  }

  /**
   * Detect rush orders - pattern of frequent small orders (expensive behavior)
   * Multiple small orders in short time = rush fees, extra delivery costs
   */
  detectRushOrders(userId) {
    const database = db.getDatabase();
    const insights = [];
    const excludedVendors = this.config.excludedVendors || [];
    const exclusionClauses = excludedVendors
      .map(v => `AND LOWER(vendor_name) NOT LIKE '%${v.toLowerCase()}%'`)
      .join(' ');

    try {
      const rushPatterns = database.prepare(`
        WITH daily_orders AS (
          SELECT
            DATE(created_at) as order_date,
            vendor_name,
            COUNT(*) as orders_that_day,
            SUM(invoice_total_cents) as daily_spend
          FROM ingestion_runs
          WHERE user_id = ?
            AND status = 'completed'
            AND vendor_name IS NOT NULL AND vendor_name != 'Unknown Vendor'
            AND created_at >= date('now', '-30 days')
            ${exclusionClauses}
          GROUP BY DATE(created_at), vendor_name
        )
        SELECT
          vendor_name,
          COUNT(*) as multi_order_days,
          SUM(orders_that_day) as total_orders,
          AVG(daily_spend) as avg_daily_spend
        FROM daily_orders
        WHERE orders_that_day >= 2
        GROUP BY vendor_name
        HAVING multi_order_days >= 2
        ORDER BY multi_order_days DESC
        LIMIT 3
      `).all(userId);

      for (const pattern of rushPatterns) {
        const estimatedExtraCost = pattern.multi_order_days * 1500; // ~$15 per extra order

        insights.push({
          insight_type: 'rush_orders',
          vendor_name: pattern.vendor_name,
          title: `🚨 Multiple same-day orders to ${this.truncate(pattern.vendor_name, 18)}`,
          detail: `You placed ${pattern.total_orders} orders across ${pattern.multi_order_days} days with multiple orders each. ` +
                  `This costs ~$${(estimatedExtraCost / 100).toFixed(0)} extra in processing/delivery. ` +
                  `Plan ahead to consolidate.`,
          urgency: pattern.multi_order_days >= 4 ? 'high' : 'medium',
          estimated_value_cents: estimatedExtraCost,
          confidence_score: 85,
          reasoning: {
            vendor: pattern.vendor_name,
            multi_order_days: pattern.multi_order_days,
            total_orders: pattern.total_orders,
            avg_daily_spend_cents: Math.round(pattern.avg_daily_spend)
          }
        });
      }
    } catch (error) {
      console.error('[SmartOrdering] Rush order detection error:', error.message);
    }

    return insights;
  }

  /**
   * Detect cost creep - per-unit costs slowly increasing over time
   * Subtle increases that go unnoticed but add up significantly
   */
  detectCostCreep(userId) {
    const database = db.getDatabase();
    const insights = [];
    const vendorExclusion = this.getVendorExclusionClause('ir');

    try {
      const costTrends = database.prepare(`
        WITH monthly_prices AS (
          SELECT
            ii.sku,
            ii.description,
            ir.vendor_name,
            strftime('%Y-%m', ir.created_at) as month,
            AVG(ii.unit_price_cents) as avg_price,
            SUM(ii.quantity) as monthly_qty
          FROM invoice_items ii
          JOIN ingestion_runs ir ON ii.run_id = ir.id
          WHERE ir.user_id = ?
            AND ir.status = 'completed'
            AND ii.sku IS NOT NULL AND ii.sku != ''
            AND ii.unit_price_cents > 0
            AND ir.created_at >= date('now', '-90 days')
            ${vendorExclusion}
          GROUP BY ii.sku, strftime('%Y-%m', ir.created_at)
        ),
        sku_trends AS (
          SELECT
            sku,
            description,
            vendor_name,
            COUNT(*) as months_tracked,
            MIN(CASE WHEN month = (SELECT MIN(month) FROM monthly_prices mp2 WHERE mp2.sku = monthly_prices.sku) THEN avg_price END) as first_price,
            MAX(CASE WHEN month = (SELECT MAX(month) FROM monthly_prices mp3 WHERE mp3.sku = monthly_prices.sku) THEN avg_price END) as last_price,
            AVG(monthly_qty) as avg_monthly_qty
          FROM monthly_prices
          GROUP BY sku
          HAVING months_tracked >= 2
        )
        SELECT *,
          (last_price - first_price) * 1.0 / first_price as price_increase_pct,
          (last_price - first_price) as price_increase_cents
        FROM sku_trends
        WHERE last_price > first_price
          AND (last_price - first_price) * 1.0 / first_price > 0.05
          AND avg_monthly_qty > 1
        ORDER BY (last_price - first_price) * avg_monthly_qty DESC
        LIMIT 3
      `).all(userId);

      for (const item of costTrends) {
        const increasePct = Math.round(item.price_increase_pct * 100);
        const monthlyImpact = Math.round(item.price_increase_cents * item.avg_monthly_qty);

        insights.push({
          insight_type: 'cost_creep',
          sku: item.sku,
          description: item.description,
          vendor_name: item.vendor_name,
          title: `📈 ${this.truncate(item.description || item.sku, 22)}: +${increasePct}% cost creep`,
          detail: `Unit price rose from $${(item.first_price / 100).toFixed(2)} to $${(item.last_price / 100).toFixed(2)} ` +
                  `over ${item.months_tracked} months. That's ~$${(monthlyImpact / 100).toFixed(0)}/month extra. ` +
                  `Negotiate or find alternatives.`,
          urgency: increasePct > 15 ? 'high' : 'medium',
          estimated_value_cents: monthlyImpact * 3, // 3-month impact
          confidence_score: Math.min(85, 55 + item.months_tracked * 10),
          reasoning: {
            first_price_cents: Math.round(item.first_price),
            last_price_cents: Math.round(item.last_price),
            increase_percent: increasePct,
            months_tracked: item.months_tracked,
            monthly_qty: Math.round(item.avg_monthly_qty),
            monthly_impact_cents: monthlyImpact
          }
        });
      }
    } catch (error) {
      console.error('[SmartOrdering] Cost creep detection error:', error.message);
    }

    return insights;
  }

  /**
   * Detect spend concentration - too much spend in one category
   * Helps identify areas to focus cost reduction efforts
   */
  detectSpendConcentration(userId) {
    const database = db.getDatabase();
    const insights = [];
    const vendorExclusion = this.getVendorExclusionClause('ir');

    try {
      const categorySpend = database.prepare(`
        SELECT
          ii.category,
          SUM(ii.total_cents) as category_spend,
          COUNT(DISTINCT ii.sku) as unique_items,
          COUNT(*) as line_count
        FROM invoice_items ii
        JOIN ingestion_runs ir ON ii.run_id = ir.id
        WHERE ir.user_id = ?
          AND ir.status = 'completed'
          AND ii.category IS NOT NULL AND ii.category != '' AND ii.category != 'general'
          AND ir.created_at >= date('now', '-30 days')
          ${vendorExclusion}
        GROUP BY ii.category
        ORDER BY category_spend DESC
      `).all(userId);

      if (categorySpend.length < 2) return insights;

      const totalSpend = categorySpend.reduce((sum, c) => sum + c.category_spend, 0);
      const topCategory = categorySpend[0];
      const topCategoryPct = (topCategory.category_spend / totalSpend) * 100;

      if (topCategoryPct >= 50 && totalSpend > 50000) { // >50% in one category and >$500 total
        const potentialSavings = Math.round(topCategory.category_spend * 0.05); // 5% potential negotiation

        insights.push({
          insight_type: 'spend_concentration',
          title: `🎯 ${Math.round(topCategoryPct)}% of spend in ${topCategory.category}`,
          detail: `$${(topCategory.category_spend / 100).toLocaleString()} spent on ${topCategory.category} ` +
                  `(${topCategory.unique_items} items). This category is your biggest cost driver. ` +
                  `Even 5% savings here = $${(potentialSavings / 100).toFixed(0)}.`,
          urgency: topCategoryPct >= 65 ? 'high' : 'medium',
          estimated_value_cents: potentialSavings,
          confidence_score: 80,
          reasoning: {
            top_category: topCategory.category,
            category_spend_cents: topCategory.category_spend,
            category_percent: Math.round(topCategoryPct),
            unique_items: topCategory.unique_items,
            total_spend_cents: totalSpend,
            category_count: categorySpend.length
          }
        });
      }
    } catch (error) {
      console.error('[SmartOrdering] Spend concentration detection error:', error.message);
    }

    return insights;
  }

  /**
   * Detect duplicate items - potentially same item under different SKUs
   * Uses description similarity and price proximity
   */
  detectDuplicateItems(userId) {
    const database = db.getDatabase();
    const insights = [];
    const vendorExclusion = this.getVendorExclusionClause('ir');

    try {
      // Get items with similar descriptions from different vendors
      const potentialDupes = database.prepare(`
        WITH item_summary AS (
          SELECT
            ii.sku,
            ii.description,
            ir.vendor_name,
            AVG(ii.unit_price_cents) as avg_price,
            SUM(ii.quantity) as total_qty,
            COUNT(*) as order_count
          FROM invoice_items ii
          JOIN ingestion_runs ir ON ii.run_id = ir.id
          WHERE ir.user_id = ?
            AND ir.status = 'completed'
            AND ii.sku IS NOT NULL AND ii.sku != ''
            AND ii.description IS NOT NULL AND LENGTH(ii.description) > 10
            AND ii.unit_price_cents > 0
            AND ir.created_at >= date('now', '-90 days')
            ${vendorExclusion}
          GROUP BY ii.sku
          HAVING order_count >= 2
        )
        SELECT
          a.sku as sku_a,
          a.description as desc_a,
          a.vendor_name as vendor_a,
          a.avg_price as price_a,
          b.sku as sku_b,
          b.description as desc_b,
          b.vendor_name as vendor_b,
          b.avg_price as price_b,
          ABS(a.avg_price - b.avg_price) as price_diff
        FROM item_summary a
        JOIN item_summary b ON a.sku < b.sku
        WHERE a.vendor_name != b.vendor_name
          AND (
            LOWER(SUBSTR(a.description, 1, 15)) = LOWER(SUBSTR(b.description, 1, 15))
            OR ABS(a.avg_price - b.avg_price) < a.avg_price * 0.1
          )
          AND ABS(a.avg_price - b.avg_price) / MAX(a.avg_price, b.avg_price) < 0.25
        ORDER BY price_diff ASC
        LIMIT 3
      `).all(userId);

      for (const dupe of potentialDupes) {
        const priceDiff = Math.round(dupe.price_diff);
        const cheaperVendor = dupe.price_a < dupe.price_b ? dupe.vendor_a : dupe.vendor_b;
        const cheaperPrice = Math.min(dupe.price_a, dupe.price_b);
        const moreExpensivePrice = Math.max(dupe.price_a, dupe.price_b);

        insights.push({
          insight_type: 'duplicate_item',
          title: `🔀 Possible duplicate: "${this.truncate(dupe.desc_a, 18)}"`,
          detail: `Similar items from different vendors: ${dupe.vendor_a} ($${(dupe.price_a / 100).toFixed(2)}) vs ` +
                  `${dupe.vendor_b} ($${(dupe.price_b / 100).toFixed(2)}). ` +
                  `${cheaperVendor} is ${Math.round((priceDiff / moreExpensivePrice) * 100)}% cheaper.`,
          urgency: priceDiff > 200 ? 'medium' : 'low',
          estimated_value_cents: priceDiff * 10, // Assume 10 units
          confidence_score: 65,
          reasoning: {
            item_a: { sku: dupe.sku_a, description: dupe.desc_a, vendor: dupe.vendor_a, price_cents: Math.round(dupe.price_a) },
            item_b: { sku: dupe.sku_b, description: dupe.desc_b, vendor: dupe.vendor_b, price_cents: Math.round(dupe.price_b) },
            price_diff_cents: priceDiff,
            cheaper_vendor: cheaperVendor
          }
        });
      }
    } catch (error) {
      console.error('[SmartOrdering] Duplicate item detection error:', error.message);
    }

    return insights;
  }

  /**
   * Analyze order timing - identify best days to order based on pricing
   * Some vendors may have better prices on certain days
   */
  analyzeOrderTiming(userId) {
    const database = db.getDatabase();
    const insights = [];
    const excludedVendors = this.config.excludedVendors || [];
    const exclusionClauses = excludedVendors
      .map(v => `AND LOWER(vendor_name) NOT LIKE '%${v.toLowerCase()}%'`)
      .join(' ');

    try {
      const timingData = database.prepare(`
        WITH daily_pricing AS (
          SELECT
            strftime('%w', created_at) as day_of_week,
            COUNT(*) as order_count,
            SUM(invoice_total_cents) as total_spend,
            AVG(invoice_total_cents) as avg_order_value
          FROM ingestion_runs
          WHERE user_id = ?
            AND status = 'completed'
            AND created_at >= date('now', '-90 days')
            ${exclusionClauses}
          GROUP BY strftime('%w', created_at)
          HAVING order_count >= 3
        )
        SELECT *,
          avg_order_value - (SELECT AVG(avg_order_value) FROM daily_pricing) as vs_average
        FROM daily_pricing
        ORDER BY avg_order_value ASC
      `).all(userId);

      if (timingData.length < 3) return insights;

      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const avgOfAverages = timingData.reduce((sum, d) => sum + d.avg_order_value, 0) / timingData.length;
      const cheapestDay = timingData[0];
      const mostExpensiveDay = timingData[timingData.length - 1];

      const savingsPercent = ((mostExpensiveDay.avg_order_value - cheapestDay.avg_order_value) / avgOfAverages) * 100;

      if (savingsPercent > 10) {
        insights.push({
          insight_type: 'order_timing',
          title: `⏰ ${dayNames[cheapestDay.day_of_week]}s have ${Math.round(savingsPercent)}% lower order values`,
          detail: `Orders on ${dayNames[cheapestDay.day_of_week]} average $${(cheapestDay.avg_order_value / 100).toFixed(0)} vs ` +
                  `$${(mostExpensiveDay.avg_order_value / 100).toFixed(0)} on ${dayNames[mostExpensiveDay.day_of_week]}. ` +
                  `Schedule regular orders for ${dayNames[cheapestDay.day_of_week]}s when possible.`,
          urgency: savingsPercent > 20 ? 'medium' : 'low',
          estimated_value_cents: Math.round((mostExpensiveDay.avg_order_value - cheapestDay.avg_order_value) * 4), // 4 orders/month
          confidence_score: Math.min(75, 40 + timingData.reduce((sum, d) => sum + d.order_count, 0)),
          reasoning: {
            best_day: dayNames[cheapestDay.day_of_week],
            best_day_avg_cents: Math.round(cheapestDay.avg_order_value),
            worst_day: dayNames[mostExpensiveDay.day_of_week],
            worst_day_avg_cents: Math.round(mostExpensiveDay.avg_order_value),
            savings_percent: Math.round(savingsPercent),
            data_points: timingData.reduce((sum, d) => sum + d.order_count, 0)
          }
        });
      }
    } catch (error) {
      console.error('[SmartOrdering] Order timing analysis error:', error.message);
    }

    return insights;
  }

  // ================================================================
  // HELPER METHODS
  // ================================================================

  groupBySku(records) {
    return records.reduce((acc, record) => {
      if (!acc[record.sku]) acc[record.sku] = [];
      acc[record.sku].push(record);
      return acc;
    }, {});
  }

  daysBetween(date1, date2) {
    const oneDay = 24 * 60 * 60 * 1000;
    return Math.round((date2 - date1) / oneDay);
  }

  daysUntilDate(currentMonth, currentDay, targetMonth, targetDay) {
    const today = new Date();
    const thisYear = today.getFullYear();
    let targetDate = new Date(thisYear, targetMonth - 1, targetDay);

    // If target date has passed this year, use next year
    if (targetDate < today) {
      targetDate = new Date(thisYear + 1, targetMonth - 1, targetDay);
    }

    return this.daysBetween(today, targetDate);
  }

  calculateMean(values) {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  calculateStdDev(values) {
    if (values.length === 0) return 0;
    const avg = this.calculateMean(values);
    const squareDiffs = values.map(v => Math.pow(v - avg, 2));
    return Math.sqrt(squareDiffs.reduce((a, b) => a + b, 0) / values.length);
  }

  formatDate(date) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  truncate(str, maxLength) {
    if (!str) return '';
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength - 3) + '...';
  }

  sortInsights(insights) {
    const urgencyOrder = { high: 0, medium: 1, low: 2 };
    return insights.sort((a, b) => {
      const urgencyDiff = (urgencyOrder[a.urgency] || 3) - (urgencyOrder[b.urgency] || 3);
      if (urgencyDiff !== 0) return urgencyDiff;
      return (b.confidence_score || 0) - (a.confidence_score || 0);
    });
  }
}

module.exports = SmartOrderingEngine;

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

      // ============ MARKET TRENDS & SPENDING ANALYSIS ============
      allInsights.push(...this.analyzeInflationImpact(userId));
      allInsights.push(...this.detectSpendVelocity(userId));
      allInsights.push(...this.identifyTopSpendItems(userId));
      allInsights.push(...this.detectSavingsOpportunities(userId));
      allInsights.push(...this.analyzeWeeklyTrends(userId));
      allInsights.push(...this.detectContractOpportunities(userId));

      // ============ HOSPITALITY BUSINESS INTELLIGENCE ============
      allInsights.push(...this.analyzePrimeCostTrend(userId));
      allInsights.push(...this.detectMarginErosion(userId));
      allInsights.push(...this.detectInvoiceDiscrepancies(userId));
      allInsights.push(...this.analyzePaymentOptimization(userId));
      allInsights.push(...this.calculateSupplierReliability(userId));
      allInsights.push(...this.detectWasteRisk(userId));
      allInsights.push(...this.calculateParLevels(userId));
      allInsights.push(...this.forecastCashFlow(userId));
      allInsights.push(...this.findSubstitutionOpportunities(userId));
      allInsights.push(...this.analyzeCategoryMix(userId));

      // ============ CROSS-INDUSTRY INTELLIGENCE ============
      allInsights.push(...this.analyzeYearOverYear(userId));
      allInsights.push(...this.trackBudgetPacing(userId));
      allInsights.push(...this.analyzeVendorDiversity(userId));
      allInsights.push(...this.trackVolumeRebates(userId));
      allInsights.push(...this.analyzeProcurementTiming(userId));
      allInsights.push(...this.analyzePurchaseCategories(userId));
      allInsights.push(...this.analyzeQuarterEndOpportunities(userId));
      allInsights.push(...this.trackComplianceSpend(userId));
      allInsights.push(...this.detectEmergencyPatterns(userId));
      allInsights.push(...this.analyzeTotalCostOfOwnership(userId));

      // ============ MARKET INTELLIGENCE (New) ============
      allInsights.push(...this.detectCOGSSpikeAlerts(userId));
      allInsights.push(...this.forecastWeeklyDemand(userId));
      allInsights.push(...this.findVendorAlternatives(userId));
      allInsights.push(...this.generatePricingRecommendations(userId));

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
  // MARKET TRENDS & SPENDING ANALYSIS (6 New Types)
  // ================================================================

  /**
   * Analyze inflation impact - track overall price increases across your purchasing
   * Shows how much more you're paying compared to baseline
   */
  analyzeInflationImpact(userId) {
    const database = db.getDatabase();
    const insights = [];
    const vendorExclusion = this.getVendorExclusionClause('ir');

    try {
      const inflationData = database.prepare(`
        WITH monthly_avg AS (
          SELECT
            strftime('%Y-%m', ir.created_at) as month,
            AVG(ii.unit_price_cents) as avg_unit_price,
            SUM(ii.total_cents) as total_spend,
            COUNT(DISTINCT ii.sku) as unique_items
          FROM invoice_items ii
          JOIN ingestion_runs ir ON ii.run_id = ir.id
          WHERE ir.user_id = ?
            AND ir.status = 'completed'
            AND ii.unit_price_cents > 0
            AND ir.created_at >= date('now', '-180 days')
            ${vendorExclusion}
          GROUP BY strftime('%Y-%m', ir.created_at)
          ORDER BY month
        )
        SELECT
          MIN(month) as first_month,
          MAX(month) as last_month,
          MIN(avg_unit_price) as earliest_avg_price,
          MAX(CASE WHEN month = (SELECT MAX(month) FROM monthly_avg) THEN avg_unit_price END) as latest_avg_price,
          AVG(total_spend) as avg_monthly_spend,
          COUNT(*) as months_tracked
        FROM monthly_avg
        WHERE (SELECT COUNT(*) FROM monthly_avg) >= 3
      `).get(userId);

      if (inflationData && inflationData.months_tracked >= 3 && inflationData.earliest_avg_price > 0) {
        const inflationRate = ((inflationData.latest_avg_price - inflationData.earliest_avg_price) / inflationData.earliest_avg_price) * 100;
        const monthlyImpact = Math.round(inflationData.avg_monthly_spend * (inflationRate / 100));

        if (Math.abs(inflationRate) > 3) {
          const isIncrease = inflationRate > 0;
          insights.push({
            insight_type: 'inflation_impact',
            title: `${isIncrease ? '📈' : '📉'} ${isIncrease ? '+' : ''}${inflationRate.toFixed(1)}% price ${isIncrease ? 'inflation' : 'deflation'} detected`,
            detail: `Average unit prices ${isIncrease ? 'rose' : 'dropped'} from $${(inflationData.earliest_avg_price / 100).toFixed(2)} to ` +
                    `$${(inflationData.latest_avg_price / 100).toFixed(2)} over ${inflationData.months_tracked} months. ` +
                    `${isIncrease ? `Costing you ~$${(monthlyImpact / 100).toFixed(0)}/month extra.` : 'Good news - costs are down!'}`,
            urgency: Math.abs(inflationRate) > 8 ? 'high' : 'medium',
            estimated_value_cents: isIncrease ? monthlyImpact * 3 : 0,
            confidence_score: Math.min(85, 50 + inflationData.months_tracked * 5),
            reasoning: {
              earliest_avg_cents: Math.round(inflationData.earliest_avg_price),
              latest_avg_cents: Math.round(inflationData.latest_avg_price),
              inflation_percent: Math.round(inflationRate * 10) / 10,
              months_tracked: inflationData.months_tracked,
              monthly_impact_cents: monthlyImpact
            }
          });
        }
      }
    } catch (error) {
      console.error('[SmartOrdering] Inflation analysis error:', error.message);
    }

    return insights;
  }

  /**
   * Detect spend velocity - analyze how fast you're spending
   * Helps identify if spending is accelerating or decelerating
   */
  detectSpendVelocity(userId) {
    const database = db.getDatabase();
    const insights = [];
    const excludedVendors = this.config.excludedVendors || [];
    const exclusionClauses = excludedVendors
      .map(v => `AND LOWER(vendor_name) NOT LIKE '%${v.toLowerCase()}%'`)
      .join(' ');

    try {
      const velocityData = database.prepare(`
        WITH weekly_spend AS (
          SELECT
            strftime('%Y-%W', created_at) as week,
            SUM(invoice_total_cents) as weekly_total,
            COUNT(*) as order_count
          FROM ingestion_runs
          WHERE user_id = ?
            AND status = 'completed'
            AND created_at >= date('now', '-42 days')
            ${exclusionClauses}
          GROUP BY strftime('%Y-%W', created_at)
          ORDER BY week
        )
        SELECT
          COUNT(*) as weeks_tracked,
          AVG(weekly_total) as avg_weekly_spend,
          MIN(weekly_total) as min_weekly,
          MAX(weekly_total) as max_weekly,
          (SELECT weekly_total FROM weekly_spend ORDER BY week DESC LIMIT 1) as last_week_spend,
          (SELECT weekly_total FROM weekly_spend ORDER BY week DESC LIMIT 1 OFFSET 1) as prev_week_spend,
          (SELECT AVG(weekly_total) FROM weekly_spend ORDER BY week DESC LIMIT 3) as recent_3wk_avg,
          (SELECT AVG(weekly_total) FROM weekly_spend ORDER BY week ASC LIMIT 3) as early_3wk_avg
        FROM weekly_spend
      `).get(userId);

      if (velocityData && velocityData.weeks_tracked >= 4) {
        const weekOverWeekChange = velocityData.prev_week_spend > 0
          ? ((velocityData.last_week_spend - velocityData.prev_week_spend) / velocityData.prev_week_spend) * 100
          : 0;

        const trendChange = velocityData.early_3wk_avg > 0
          ? ((velocityData.recent_3wk_avg - velocityData.early_3wk_avg) / velocityData.early_3wk_avg) * 100
          : 0;

        if (Math.abs(trendChange) > 15 || Math.abs(weekOverWeekChange) > 25) {
          const isAccelerating = trendChange > 0;
          const weekChange = Math.round(velocityData.last_week_spend - velocityData.prev_week_spend);

          insights.push({
            insight_type: 'spend_velocity',
            title: `🚀 Spending ${isAccelerating ? 'accelerating' : 'decelerating'}: ${isAccelerating ? '+' : ''}${Math.round(trendChange)}% trend`,
            detail: `Last week: $${(velocityData.last_week_spend / 100).toLocaleString()} ` +
                    `(${weekOverWeekChange > 0 ? '+' : ''}${Math.round(weekOverWeekChange)}% vs prior week). ` +
                    `${isAccelerating ? 'Costs are ramping up - review for unnecessary purchases.' : 'Good cost control!'}`,
            urgency: Math.abs(trendChange) > 30 ? 'high' : 'medium',
            estimated_value_cents: isAccelerating ? Math.abs(weekChange) * 4 : 0,
            confidence_score: Math.min(80, 45 + velocityData.weeks_tracked * 5),
            reasoning: {
              last_week_cents: velocityData.last_week_spend,
              prev_week_cents: velocityData.prev_week_spend,
              week_over_week_percent: Math.round(weekOverWeekChange),
              trend_percent: Math.round(trendChange),
              avg_weekly_cents: Math.round(velocityData.avg_weekly_spend),
              weeks_analyzed: velocityData.weeks_tracked
            }
          });
        }
      }
    } catch (error) {
      console.error('[SmartOrdering] Spend velocity error:', error.message);
    }

    return insights;
  }

  /**
   * Identify top spend items - your biggest cost drivers
   * Focus cost reduction efforts where they matter most
   */
  identifyTopSpendItems(userId) {
    const database = db.getDatabase();
    const insights = [];
    const vendorExclusion = this.getVendorExclusionClause('ir');

    try {
      const topItems = database.prepare(`
        SELECT
          ii.sku,
          ii.description,
          ir.vendor_name,
          SUM(ii.total_cents) as total_spend,
          SUM(ii.quantity) as total_qty,
          COUNT(DISTINCT DATE(ir.created_at)) as order_days,
          AVG(ii.unit_price_cents) as avg_unit_price
        FROM invoice_items ii
        JOIN ingestion_runs ir ON ii.run_id = ir.id
        WHERE ir.user_id = ?
          AND ir.status = 'completed'
          AND ii.sku IS NOT NULL AND ii.sku != ''
          AND ir.created_at >= date('now', '-30 days')
          ${vendorExclusion}
        GROUP BY ii.sku
        ORDER BY total_spend DESC
        LIMIT 5
      `).all(userId);

      const totalAllItems = database.prepare(`
        SELECT SUM(ii.total_cents) as total
        FROM invoice_items ii
        JOIN ingestion_runs ir ON ii.run_id = ir.id
        WHERE ir.user_id = ?
          AND ir.status = 'completed'
          AND ir.created_at >= date('now', '-30 days')
          ${vendorExclusion}
      `).get(userId);

      if (topItems.length >= 3 && totalAllItems?.total > 0) {
        const top3Spend = topItems.slice(0, 3).reduce((sum, i) => sum + i.total_spend, 0);
        const top3Percent = (top3Spend / totalAllItems.total) * 100;

        if (top3Percent > 30) {
          const topItemsList = topItems.slice(0, 3).map(i =>
            `${this.truncate(i.description || i.sku, 20)} ($${(i.total_spend / 100).toLocaleString()})`
          ).join(', ');

          const potential5pctSavings = Math.round(top3Spend * 0.05);

          insights.push({
            insight_type: 'top_spend_items',
            title: `💵 Top 3 items = ${Math.round(top3Percent)}% of your spend`,
            detail: `Focus here for maximum impact: ${topItemsList}. ` +
                    `A 5% negotiation on these alone saves $${(potential5pctSavings / 100).toFixed(0)}/month.`,
            urgency: top3Percent > 50 ? 'high' : 'medium',
            estimated_value_cents: potential5pctSavings,
            confidence_score: 90,
            reasoning: {
              top_items: topItems.slice(0, 3).map(i => ({
                sku: i.sku,
                description: i.description,
                spend_cents: i.total_spend,
                percent_of_total: Math.round((i.total_spend / totalAllItems.total) * 100)
              })),
              top_3_total_cents: top3Spend,
              top_3_percent: Math.round(top3Percent),
              total_spend_cents: totalAllItems.total
            }
          });
        }
      }
    } catch (error) {
      console.error('[SmartOrdering] Top spend items error:', error.message);
    }

    return insights;
  }

  /**
   * Detect savings opportunities - consolidated view of all potential savings
   * Summarizes where money can be saved across the board
   */
  detectSavingsOpportunities(userId) {
    const database = db.getDatabase();
    const insights = [];
    const vendorExclusion = this.getVendorExclusionClause('ir');

    try {
      // Calculate potential savings from various sources
      const savingsData = database.prepare(`
        WITH spend_summary AS (
          SELECT
            SUM(ii.total_cents) as total_spend,
            COUNT(DISTINCT ii.sku) as unique_items,
            COUNT(DISTINCT ir.vendor_name) as vendor_count,
            AVG(ii.unit_price_cents) as avg_unit_price
          FROM invoice_items ii
          JOIN ingestion_runs ir ON ii.run_id = ir.id
          WHERE ir.user_id = ?
            AND ir.status = 'completed'
            AND ir.created_at >= date('now', '-30 days')
            ${vendorExclusion}
        ),
        high_frequency AS (
          SELECT COUNT(*) as frequent_items
          FROM (
            SELECT ii.sku
            FROM invoice_items ii
            JOIN ingestion_runs ir ON ii.run_id = ir.id
            WHERE ir.user_id = ?
              AND ir.status = 'completed'
              AND ir.created_at >= date('now', '-30 days')
              ${vendorExclusion}
            GROUP BY ii.sku
            HAVING COUNT(DISTINCT DATE(ir.created_at)) >= 3
          )
        )
        SELECT
          ss.total_spend,
          ss.unique_items,
          ss.vendor_count,
          hf.frequent_items
        FROM spend_summary ss, high_frequency hf
      `).get(userId, userId);

      if (savingsData && savingsData.total_spend > 100000) { // More than $1000
        // Estimate savings: 5% from consolidation, 3% from negotiation, 2% from timing
        const consolidationSavings = Math.round(savingsData.total_spend * 0.05);
        const negotiationSavings = Math.round(savingsData.total_spend * 0.03);
        const timingSavings = Math.round(savingsData.total_spend * 0.02);
        const totalPotential = consolidationSavings + negotiationSavings + timingSavings;

        insights.push({
          insight_type: 'savings_summary',
          title: `💰 Up to $${(totalPotential / 100).toLocaleString()} potential monthly savings identified`,
          detail: `Based on your $${(savingsData.total_spend / 100).toLocaleString()}/month spend across ` +
                  `${savingsData.unique_items} items from ${savingsData.vendor_count} vendors: ` +
                  `~$${(consolidationSavings / 100).toFixed(0)} from consolidation, ` +
                  `~$${(negotiationSavings / 100).toFixed(0)} from negotiation, ` +
                  `~$${(timingSavings / 100).toFixed(0)} from better timing.`,
          urgency: totalPotential > 50000 ? 'high' : 'medium',
          estimated_value_cents: totalPotential,
          confidence_score: 70,
          reasoning: {
            total_monthly_spend_cents: savingsData.total_spend,
            unique_items: savingsData.unique_items,
            vendor_count: savingsData.vendor_count,
            frequent_items: savingsData.frequent_items,
            breakdown: {
              consolidation_cents: consolidationSavings,
              negotiation_cents: negotiationSavings,
              timing_cents: timingSavings
            }
          }
        });
      }
    } catch (error) {
      console.error('[SmartOrdering] Savings opportunities error:', error.message);
    }

    return insights;
  }

  /**
   * Analyze weekly trends - week-over-week spending patterns
   * Identifies unusual spending weeks
   */
  analyzeWeeklyTrends(userId) {
    const database = db.getDatabase();
    const insights = [];
    const excludedVendors = this.config.excludedVendors || [];
    const exclusionClauses = excludedVendors
      .map(v => `AND LOWER(vendor_name) NOT LIKE '%${v.toLowerCase()}%'`)
      .join(' ');

    try {
      const weeklyTrends = database.prepare(`
        WITH weekly_data AS (
          SELECT
            strftime('%Y-%W', created_at) as week,
            strftime('%Y-%m-%d', MIN(DATE(created_at, 'weekday 0', '-6 days'))) as week_start,
            SUM(invoice_total_cents) as weekly_spend,
            COUNT(*) as order_count,
            COUNT(DISTINCT vendor_name) as vendors_used
          FROM ingestion_runs
          WHERE user_id = ?
            AND status = 'completed'
            AND created_at >= date('now', '-35 days')
            ${exclusionClauses}
          GROUP BY strftime('%Y-%W', created_at)
        )
        SELECT *,
          (SELECT AVG(weekly_spend) FROM weekly_data) as avg_weekly,
          (weekly_spend - (SELECT AVG(weekly_spend) FROM weekly_data)) * 1.0 /
            NULLIF((SELECT AVG(weekly_spend) FROM weekly_data), 0) as vs_avg_pct
        FROM weekly_data
        ORDER BY week DESC
        LIMIT 1
      `).get(userId);

      if (weeklyTrends && weeklyTrends.avg_weekly > 0) {
        const vsAvgPct = Math.round((weeklyTrends.vs_avg_pct || 0) * 100);

        if (Math.abs(vsAvgPct) > 20) {
          const isHigh = vsAvgPct > 0;
          const diff = Math.abs(weeklyTrends.weekly_spend - weeklyTrends.avg_weekly);

          insights.push({
            insight_type: 'weekly_trend',
            title: `📊 This week: ${isHigh ? '+' : ''}${vsAvgPct}% vs average`,
            detail: `Spent $${(weeklyTrends.weekly_spend / 100).toLocaleString()} this week ` +
                    `(avg: $${(weeklyTrends.avg_weekly / 100).toLocaleString()}). ` +
                    `${isHigh ? `That's $${(diff / 100).toFixed(0)} above normal - check for unusual orders.` :
                              `Saving $${(diff / 100).toFixed(0)} vs typical week.`}`,
            urgency: Math.abs(vsAvgPct) > 40 ? 'high' : 'low',
            estimated_value_cents: isHigh ? diff : 0,
            confidence_score: 75,
            reasoning: {
              this_week_cents: weeklyTrends.weekly_spend,
              avg_weekly_cents: Math.round(weeklyTrends.avg_weekly),
              variance_percent: vsAvgPct,
              orders_this_week: weeklyTrends.order_count,
              vendors_this_week: weeklyTrends.vendors_used
            }
          });
        }
      }
    } catch (error) {
      console.error('[SmartOrdering] Weekly trends error:', error.message);
    }

    return insights;
  }

  /**
   * Detect contract opportunities - items with enough volume to negotiate contracts
   * High-volume items are candidates for fixed-price agreements
   */
  detectContractOpportunities(userId) {
    const database = db.getDatabase();
    const insights = [];
    const vendorExclusion = this.getVendorExclusionClause('ir');

    try {
      const contractCandidates = database.prepare(`
        SELECT
          ii.sku,
          ii.description,
          ir.vendor_name,
          SUM(ii.total_cents) as total_spend,
          SUM(ii.quantity) as total_qty,
          COUNT(DISTINCT strftime('%Y-%m', ir.created_at)) as months_ordered,
          COUNT(DISTINCT DATE(ir.created_at)) as order_days,
          AVG(ii.unit_price_cents) as avg_price,
          MIN(ii.unit_price_cents) as min_price,
          MAX(ii.unit_price_cents) as max_price
        FROM invoice_items ii
        JOIN ingestion_runs ir ON ii.run_id = ir.id
        WHERE ir.user_id = ?
          AND ir.status = 'completed'
          AND ii.sku IS NOT NULL AND ii.sku != ''
          AND ir.created_at >= date('now', '-90 days')
          ${vendorExclusion}
        GROUP BY ii.sku, ir.vendor_name
        HAVING months_ordered >= 2 AND total_spend > 50000
        ORDER BY total_spend DESC
        LIMIT 3
      `).all(userId);

      for (const item of contractCandidates) {
        const priceVariance = item.max_price > 0 ?
          ((item.max_price - item.min_price) / item.avg_price) * 100 : 0;
        const contractSavings = Math.round(item.total_spend * 0.08); // Estimate 8% contract savings

        insights.push({
          insight_type: 'contract_opportunity',
          sku: item.sku,
          description: item.description,
          vendor_name: item.vendor_name,
          title: `📋 Contract opportunity: ${this.truncate(item.description || item.sku, 22)}`,
          detail: `$${(item.total_spend / 100).toLocaleString()} spent over ${item.months_ordered} months with ${item.vendor_name}. ` +
                  `Consistent ordering = leverage for a contract. ` +
                  `Est. 8% savings = $${(contractSavings / 100).toFixed(0)}.`,
          urgency: item.total_spend > 200000 ? 'high' : 'medium',
          estimated_value_cents: contractSavings,
          confidence_score: Math.min(85, 60 + item.months_ordered * 8),
          reasoning: {
            total_spend_cents: item.total_spend,
            total_quantity: Math.round(item.total_qty),
            months_ordered: item.months_ordered,
            order_frequency: item.order_days,
            price_variance_percent: Math.round(priceVariance),
            potential_savings_cents: contractSavings
          }
        });
      }
    } catch (error) {
      console.error('[SmartOrdering] Contract opportunity detection error:', error.message);
    }

    return insights;
  }

  // ================================================================
  // HOSPITALITY BUSINESS INTELLIGENCE (Restaurant/Hotel Focused)
  // ================================================================

  /**
   * Prime Cost Alert - Track food cost percentage trending
   * Food cost should typically be 28-32% for restaurants
   * This is the #1 metric restaurant operators watch
   */
  analyzePrimeCostTrend(userId) {
    const database = db.getDatabase();
    const insights = [];
    const vendorExclusion = this.getVendorExclusionClause('ir');

    try {
      // Get monthly food/supply spend vs previous period
      const monthlyTrend = database.prepare(`
        WITH monthly_spend AS (
          SELECT
            strftime('%Y-%m', ir.created_at) as month,
            SUM(ir.invoice_total_cents) as total_spend,
            COUNT(DISTINCT ir.id) as invoice_count
          FROM ingestion_runs ir
          WHERE ir.user_id = ?
            AND ir.status = 'completed'
            AND ir.created_at >= date('now', '-90 days')
            ${vendorExclusion}
          GROUP BY strftime('%Y-%m', ir.created_at)
          ORDER BY month DESC
          LIMIT 3
        )
        SELECT * FROM monthly_spend
      `).all(userId);

      if (monthlyTrend.length >= 2) {
        const currentMonth = monthlyTrend[0];
        const previousMonth = monthlyTrend[1];

        if (previousMonth.total_spend > 0) {
          const changePercent = ((currentMonth.total_spend - previousMonth.total_spend) / previousMonth.total_spend) * 100;

          if (changePercent > 10) {
            insights.push({
              insight_type: 'prime_cost_alert',
              title: `🔴 Supply costs up ${Math.round(changePercent)}% this month`,
              detail: `Spending increased from $${(previousMonth.total_spend / 100).toLocaleString()} to $${(currentMonth.total_spend / 100).toLocaleString()}. ` +
                      `Review line items to identify cost drivers before it impacts margins. ` +
                      `Quick wins: negotiate high-volume items, check for price increases, consolidate orders.`,
              urgency: changePercent > 20 ? 'high' : 'medium',
              estimated_value_cents: Math.round(currentMonth.total_spend - previousMonth.total_spend),
              confidence_score: 90,
              reasoning: {
                current_month_spend: currentMonth.total_spend,
                previous_month_spend: previousMonth.total_spend,
                change_percent: Math.round(changePercent),
                invoice_count_current: currentMonth.invoice_count,
                invoice_count_previous: previousMonth.invoice_count
              }
            });
          } else if (changePercent < -15) {
            insights.push({
              insight_type: 'prime_cost_alert',
              title: `✅ Supply costs down ${Math.abs(Math.round(changePercent))}% - great work!`,
              detail: `Spending decreased from $${(previousMonth.total_spend / 100).toLocaleString()} to $${(currentMonth.total_spend / 100).toLocaleString()}. ` +
                      `Your cost control efforts are paying off. Document what changed so you can replicate success.`,
              urgency: 'low',
              estimated_value_cents: Math.round(previousMonth.total_spend - currentMonth.total_spend),
              confidence_score: 90,
              reasoning: {
                current_month_spend: currentMonth.total_spend,
                previous_month_spend: previousMonth.total_spend,
                savings_realized: Math.round(previousMonth.total_spend - currentMonth.total_spend)
              }
            });
          }
        }
      }
    } catch (error) {
      console.error('[SmartOrdering] Prime cost trend error:', error.message);
    }

    return insights;
  }

  /**
   * Margin Erosion Detection - Identify items eating into profits
   * Tracks price increases that may require menu price adjustments
   */
  detectMarginErosion(userId) {
    const database = db.getDatabase();
    const insights = [];
    const vendorExclusion = this.getVendorExclusionClause('ir');

    try {
      // Find items with significant price increases over time
      const priceIncreases = database.prepare(`
        WITH item_prices AS (
          SELECT
            ii.sku,
            ii.description,
            ir.vendor_name,
            ii.unit_price_cents,
            ir.created_at,
            ROW_NUMBER() OVER (PARTITION BY ii.sku ORDER BY ir.created_at ASC) as order_num,
            COUNT(*) OVER (PARTITION BY ii.sku) as total_orders
          FROM invoice_items ii
          JOIN ingestion_runs ir ON ii.run_id = ir.id
          WHERE ir.user_id = ?
            AND ir.status = 'completed'
            AND ii.sku IS NOT NULL AND ii.sku != ''
            AND ii.unit_price_cents > 0
            AND ir.created_at >= date('now', '-180 days')
            ${vendorExclusion}
        ),
        first_last AS (
          SELECT
            sku,
            description,
            vendor_name,
            MAX(CASE WHEN order_num = 1 THEN unit_price_cents END) as first_price,
            MAX(CASE WHEN order_num = total_orders THEN unit_price_cents END) as last_price,
            total_orders
          FROM item_prices
          WHERE total_orders >= 3
          GROUP BY sku, description, vendor_name
        )
        SELECT *,
          ROUND((last_price - first_price) * 100.0 / first_price, 1) as price_change_pct
        FROM first_last
        WHERE last_price > first_price * 1.10
        ORDER BY (last_price - first_price) DESC
        LIMIT 5
      `).all(userId);

      for (const item of priceIncreases) {
        const priceIncrease = item.last_price - item.first_price;

        insights.push({
          insight_type: 'margin_erosion',
          sku: item.sku,
          description: item.description,
          vendor_name: item.vendor_name,
          title: `⚠️ ${this.truncate(item.description || item.sku, 20)} up ${item.price_change_pct}%`,
          detail: `Price increased from $${(item.first_price / 100).toFixed(2)} to $${(item.last_price / 100).toFixed(2)} over ${item.total_orders} orders. ` +
                  `This may be eroding your margins. Consider: menu price adjustment, alternative supplier, or substitute product.`,
          urgency: item.price_change_pct > 20 ? 'high' : 'medium',
          estimated_value_cents: priceIncrease,
          confidence_score: Math.min(90, 60 + item.total_orders * 6),
          reasoning: {
            first_price_cents: item.first_price,
            current_price_cents: item.last_price,
            price_change_percent: item.price_change_pct,
            orders_analyzed: item.total_orders
          }
        });
      }
    } catch (error) {
      console.error('[SmartOrdering] Margin erosion detection error:', error.message);
    }

    return insights;
  }

  /**
   * Invoice Discrepancy Detection - Catch billing errors
   * Compares unit prices to historical averages to flag potential overcharges
   */
  detectInvoiceDiscrepancies(userId) {
    const database = db.getDatabase();
    const insights = [];
    const vendorExclusion = this.getVendorExclusionClause('ir');

    try {
      // Find recent items priced significantly above their historical average
      const discrepancies = database.prepare(`
        WITH item_history AS (
          SELECT
            ii.sku,
            ii.description,
            ir.vendor_name,
            AVG(ii.unit_price_cents) as avg_price,
            STDEV(ii.unit_price_cents) as price_stddev,
            COUNT(*) as order_count
          FROM invoice_items ii
          JOIN ingestion_runs ir ON ii.run_id = ir.id
          WHERE ir.user_id = ?
            AND ir.status = 'completed'
            AND ii.sku IS NOT NULL AND ii.sku != ''
            AND ii.unit_price_cents > 0
            AND ir.created_at >= date('now', '-180 days')
            AND ir.created_at < date('now', '-7 days')
            ${vendorExclusion}
          GROUP BY ii.sku
          HAVING COUNT(*) >= 3
        ),
        recent_orders AS (
          SELECT
            ii.sku,
            ii.description,
            ir.vendor_name,
            ii.unit_price_cents as recent_price,
            ii.quantity,
            ir.created_at
          FROM invoice_items ii
          JOIN ingestion_runs ir ON ii.run_id = ir.id
          WHERE ir.user_id = ?
            AND ir.status = 'completed'
            AND ir.created_at >= date('now', '-7 days')
            ${vendorExclusion}
        )
        SELECT
          r.sku,
          r.description,
          r.vendor_name,
          r.recent_price,
          r.quantity,
          h.avg_price,
          h.price_stddev,
          h.order_count,
          ROUND((r.recent_price - h.avg_price) * 100.0 / h.avg_price, 1) as variance_pct
        FROM recent_orders r
        JOIN item_history h ON r.sku = h.sku
        WHERE r.recent_price > h.avg_price * 1.15
        ORDER BY (r.recent_price - h.avg_price) * r.quantity DESC
        LIMIT 3
      `).all(userId, userId);

      for (const item of discrepancies) {
        const overcharge = (item.recent_price - item.avg_price) * item.quantity;

        insights.push({
          insight_type: 'invoice_discrepancy',
          sku: item.sku,
          description: item.description,
          vendor_name: item.vendor_name,
          title: `🔍 Verify pricing: ${this.truncate(item.description || item.sku, 22)}`,
          detail: `Charged $${(item.recent_price / 100).toFixed(2)}/unit vs historical avg $${(item.avg_price / 100).toFixed(2)} (+${item.variance_pct}%). ` +
                  `For ${item.quantity} units, that's $${(overcharge / 100).toFixed(2)} over expected. ` +
                  `Contact ${item.vendor_name} if this wasn't a known price increase.`,
          urgency: item.variance_pct > 25 ? 'high' : 'medium',
          estimated_value_cents: Math.round(overcharge),
          confidence_score: Math.min(85, 55 + item.order_count * 5),
          reasoning: {
            recent_price_cents: item.recent_price,
            average_price_cents: Math.round(item.avg_price),
            variance_percent: item.variance_pct,
            quantity: item.quantity,
            potential_overcharge_cents: Math.round(overcharge),
            historical_orders: item.order_count
          }
        });
      }
    } catch (error) {
      console.error('[SmartOrdering] Invoice discrepancy detection error:', error.message);
    }

    return insights;
  }

  /**
   * Payment Optimization - Identify early pay discount opportunities
   * Many vendors offer 2% 10 Net 30 terms
   */
  analyzePaymentOptimization(userId) {
    const database = db.getDatabase();
    const insights = [];
    const vendorExclusion = this.getVendorExclusionClause('ir');

    try {
      // Find high-spend vendors where early pay discounts could save money
      const vendorSpend = database.prepare(`
        SELECT
          ir.vendor_name,
          SUM(ir.invoice_total_cents) as total_spend,
          COUNT(DISTINCT ir.id) as invoice_count,
          AVG(ir.invoice_total_cents) as avg_invoice
        FROM ingestion_runs ir
        WHERE ir.user_id = ?
          AND ir.status = 'completed'
          AND ir.created_at >= date('now', '-90 days')
          ${vendorExclusion}
        GROUP BY ir.vendor_name
        HAVING total_spend > 100000
        ORDER BY total_spend DESC
        LIMIT 3
      `).all(userId);

      for (const vendor of vendorSpend) {
        // Estimate 2% early pay discount (common in hospitality)
        const potentialSavings = Math.round(vendor.total_spend * 0.02);

        if (potentialSavings > 500) { // At least $5 in savings
          insights.push({
            insight_type: 'payment_optimization',
            vendor_name: vendor.vendor_name,
            title: `💰 Early pay discount: ${vendor.vendor_name}`,
            detail: `$${(vendor.total_spend / 100).toLocaleString()} spent over 90 days. ` +
                    `If ${vendor.vendor_name} offers 2/10 Net 30 terms, paying within 10 days could save ~$${(potentialSavings / 100).toFixed(0)}/quarter. ` +
                    `Contact your rep to confirm available payment terms.`,
            urgency: potentialSavings > 2000 ? 'medium' : 'low',
            estimated_value_cents: potentialSavings,
            confidence_score: 70,
            reasoning: {
              vendor: vendor.vendor_name,
              quarterly_spend: vendor.total_spend,
              invoice_count: vendor.invoice_count,
              avg_invoice_size: Math.round(vendor.avg_invoice),
              estimated_early_pay_discount_pct: 2,
              potential_quarterly_savings: potentialSavings
            }
          });
        }
      }
    } catch (error) {
      console.error('[SmartOrdering] Payment optimization error:', error.message);
    }

    return insights;
  }

  /**
   * Supplier Reliability Score - Rate vendors on consistency
   * Tracks price stability and order frequency patterns
   */
  calculateSupplierReliability(userId) {
    const database = db.getDatabase();
    const insights = [];
    const vendorExclusion = this.getVendorExclusionClause('ir');

    try {
      const vendorStats = database.prepare(`
        WITH vendor_metrics AS (
          SELECT
            ir.vendor_name,
            COUNT(DISTINCT ir.id) as order_count,
            SUM(ir.invoice_total_cents) as total_spend,
            COUNT(DISTINCT strftime('%W', ir.created_at)) as weeks_active
          FROM ingestion_runs ir
          WHERE ir.user_id = ?
            AND ir.status = 'completed'
            AND ir.created_at >= date('now', '-90 days')
            ${vendorExclusion}
          GROUP BY ir.vendor_name
          HAVING order_count >= 3
        ),
        price_stability AS (
          SELECT
            ir.vendor_name,
            AVG(ABS(ii.unit_price_cents - (
              SELECT AVG(ii2.unit_price_cents)
              FROM invoice_items ii2
              JOIN ingestion_runs ir2 ON ii2.run_id = ir2.id
              WHERE ii2.sku = ii.sku AND ir2.vendor_name = ir.vendor_name
            )) * 100.0 / NULLIF(ii.unit_price_cents, 0)) as price_variance_pct
          FROM invoice_items ii
          JOIN ingestion_runs ir ON ii.run_id = ir.id
          WHERE ir.user_id = ?
            AND ir.status = 'completed'
            AND ii.unit_price_cents > 0
            ${vendorExclusion}
          GROUP BY ir.vendor_name
        )
        SELECT
          vm.vendor_name,
          vm.order_count,
          vm.total_spend,
          vm.weeks_active,
          COALESCE(ps.price_variance_pct, 0) as price_variance
        FROM vendor_metrics vm
        LEFT JOIN price_stability ps ON vm.vendor_name = ps.vendor_name
        ORDER BY vm.total_spend DESC
        LIMIT 5
      `).all(userId, userId);

      for (const vendor of vendorStats) {
        // Calculate reliability score: higher is better
        const orderConsistency = Math.min(100, (vendor.weeks_active / 13) * 100); // 13 weeks in quarter
        const priceStability = Math.max(0, 100 - vendor.price_variance);
        const reliabilityScore = Math.round((orderConsistency * 0.4 + priceStability * 0.6));

        if (reliabilityScore < 70) {
          insights.push({
            insight_type: 'supplier_reliability',
            vendor_name: vendor.vendor_name,
            title: `📊 ${vendor.vendor_name} reliability score: ${reliabilityScore}/100`,
            detail: `Based on ${vendor.order_count} orders over 90 days. ` +
                    `${vendor.price_variance > 10 ? 'Price variance is high - consider requesting price locks. ' : ''}` +
                    `${orderConsistency < 60 ? 'Ordering is inconsistent - may indicate supply issues. ' : ''}` +
                    `Compare with alternative suppliers for critical items.`,
            urgency: reliabilityScore < 50 ? 'high' : 'medium',
            estimated_value_cents: 0,
            confidence_score: Math.min(85, 50 + vendor.order_count * 5),
            reasoning: {
              vendor: vendor.vendor_name,
              order_count: vendor.order_count,
              total_spend: vendor.total_spend,
              order_consistency_score: Math.round(orderConsistency),
              price_stability_score: Math.round(priceStability),
              overall_reliability_score: reliabilityScore
            }
          });
        } else if (reliabilityScore >= 90 && vendor.total_spend > 100000) {
          insights.push({
            insight_type: 'supplier_reliability',
            vendor_name: vendor.vendor_name,
            title: `⭐ Top supplier: ${vendor.vendor_name} (${reliabilityScore}/100)`,
            detail: `Excellent reliability with consistent pricing and ordering patterns. ` +
                    `Consider negotiating better terms or expanding product categories with this trusted partner.`,
            urgency: 'low',
            estimated_value_cents: 0,
            confidence_score: 85,
            reasoning: {
              vendor: vendor.vendor_name,
              reliability_score: reliabilityScore,
              total_spend: vendor.total_spend
            }
          });
        }
      }
    } catch (error) {
      console.error('[SmartOrdering] Supplier reliability error:', error.message);
    }

    return insights;
  }

  /**
   * Waste Risk Detection - Identify over-ordering patterns
   * Flags items ordered in quantities that suggest potential spoilage
   */
  detectWasteRisk(userId) {
    const database = db.getDatabase();
    const insights = [];
    const vendorExclusion = this.getVendorExclusionClause('ir');

    try {
      // Find items with highly variable order quantities (suggests waste/urgency cycles)
      const variableOrders = database.prepare(`
        SELECT
          ii.sku,
          ii.description,
          ir.vendor_name,
          AVG(ii.quantity) as avg_qty,
          MAX(ii.quantity) as max_qty,
          MIN(ii.quantity) as min_qty,
          COUNT(*) as order_count,
          SUM(ii.total_cents) as total_spend,
          STDEV(ii.quantity) as qty_stddev
        FROM invoice_items ii
        JOIN ingestion_runs ir ON ii.run_id = ir.id
        WHERE ir.user_id = ?
          AND ir.status = 'completed'
          AND ii.sku IS NOT NULL AND ii.sku != ''
          AND ii.quantity > 0
          AND ir.created_at >= date('now', '-90 days')
          ${vendorExclusion}
        GROUP BY ii.sku
        HAVING order_count >= 4 AND max_qty > avg_qty * 2
        ORDER BY total_spend DESC
        LIMIT 3
      `).all(userId);

      for (const item of variableOrders) {
        const varianceRatio = item.max_qty / item.avg_qty;
        const wasteEstimate = Math.round((item.max_qty - item.avg_qty) * (item.total_spend / item.order_count / item.avg_qty) * 0.2);

        insights.push({
          insight_type: 'waste_risk',
          sku: item.sku,
          description: item.description,
          vendor_name: item.vendor_name,
          title: `🗑️ Waste risk: ${this.truncate(item.description || item.sku, 25)}`,
          detail: `Order quantities vary wildly (${Math.round(item.min_qty)} to ${Math.round(item.max_qty)}, avg ${Math.round(item.avg_qty)}). ` +
                  `This pattern often indicates over-ordering followed by waste. ` +
                  `Standardize at ${Math.round(item.avg_qty * 1.1)} units to balance availability vs. spoilage.`,
          urgency: varianceRatio > 3 ? 'high' : 'medium',
          estimated_value_cents: wasteEstimate,
          confidence_score: Math.min(80, 50 + item.order_count * 5),
          reasoning: {
            sku: item.sku,
            avg_quantity: Math.round(item.avg_qty),
            max_quantity: Math.round(item.max_qty),
            min_quantity: Math.round(item.min_qty),
            variance_ratio: Math.round(varianceRatio * 10) / 10,
            suggested_order_qty: Math.round(item.avg_qty * 1.1),
            estimated_waste_cost: wasteEstimate
          }
        });
      }
    } catch (error) {
      console.error('[SmartOrdering] Waste risk detection error:', error.message);
    }

    return insights;
  }

  /**
   * Par Level Insight - Suggest optimal inventory levels
   * Based on usage patterns and order frequency
   */
  calculateParLevels(userId) {
    const database = db.getDatabase();
    const insights = [];
    const vendorExclusion = this.getVendorExclusionClause('ir');

    try {
      const usagePatterns = database.prepare(`
        SELECT
          ii.sku,
          ii.description,
          ir.vendor_name,
          AVG(ii.quantity) as avg_order_qty,
          AVG(julianday(LEAD(ir.created_at) OVER (PARTITION BY ii.sku ORDER BY ir.created_at)) - julianday(ir.created_at)) as avg_days_between,
          COUNT(*) as order_count,
          SUM(ii.total_cents) as total_spend,
          MAX(ir.created_at) as last_order
        FROM invoice_items ii
        JOIN ingestion_runs ir ON ii.run_id = ir.id
        WHERE ir.user_id = ?
          AND ir.status = 'completed'
          AND ii.sku IS NOT NULL AND ii.sku != ''
          AND ir.created_at >= date('now', '-90 days')
          ${vendorExclusion}
        GROUP BY ii.sku
        HAVING order_count >= 3 AND total_spend > 10000
        ORDER BY total_spend DESC
        LIMIT 5
      `).all(userId);

      for (const item of usagePatterns) {
        if (item.avg_days_between && item.avg_days_between > 0) {
          const dailyUsage = item.avg_order_qty / item.avg_days_between;
          const safetyStock = Math.ceil(dailyUsage * 3); // 3 days safety
          const reorderPoint = Math.ceil(dailyUsage * item.avg_days_between * 0.7); // Reorder at 70% depletion
          const parLevel = Math.ceil(dailyUsage * item.avg_days_between + safetyStock);

          insights.push({
            insight_type: 'par_level',
            sku: item.sku,
            description: item.description,
            vendor_name: item.vendor_name,
            title: `📦 Optimal par: ${this.truncate(item.description || item.sku, 25)}`,
            detail: `Based on ${item.order_count} orders, your optimal par level is ${parLevel} units. ` +
                    `Reorder when stock hits ${reorderPoint} units. ` +
                    `Daily usage: ~${dailyUsage.toFixed(1)} units. Safety buffer: ${safetyStock} units.`,
            urgency: 'low',
            estimated_value_cents: 0,
            confidence_score: Math.min(85, 55 + item.order_count * 5),
            suggested_quantity: parLevel,
            reasoning: {
              sku: item.sku,
              daily_usage_estimate: Math.round(dailyUsage * 10) / 10,
              avg_days_between_orders: Math.round(item.avg_days_between),
              recommended_par_level: parLevel,
              reorder_point: reorderPoint,
              safety_stock: safetyStock,
              orders_analyzed: item.order_count
            }
          });
        }
      }
    } catch (error) {
      console.error('[SmartOrdering] Par level calculation error:', error.message);
    }

    return insights;
  }

  /**
   * Cash Flow Forecast - Predict upcoming expenses
   * Helps with cash management planning
   */
  forecastCashFlow(userId) {
    const database = db.getDatabase();
    const insights = [];
    const vendorExclusion = this.getVendorExclusionClause('ir');

    try {
      // Calculate weekly spending pattern
      const weeklySpend = database.prepare(`
        SELECT
          strftime('%W', ir.created_at) as week_num,
          SUM(ir.invoice_total_cents) as total_spend,
          COUNT(DISTINCT ir.id) as invoice_count
        FROM ingestion_runs ir
        WHERE ir.user_id = ?
          AND ir.status = 'completed'
          AND ir.created_at >= date('now', '-42 days')
          ${vendorExclusion}
        GROUP BY strftime('%W', ir.created_at)
        ORDER BY week_num DESC
      `).all(userId);

      if (weeklySpend.length >= 4) {
        const avgWeeklySpend = weeklySpend.reduce((sum, w) => sum + w.total_spend, 0) / weeklySpend.length;
        const maxWeeklySpend = Math.max(...weeklySpend.map(w => w.total_spend));
        const nextWeekForecast = Math.round(avgWeeklySpend);
        const nextMonthForecast = Math.round(avgWeeklySpend * 4.3);

        insights.push({
          insight_type: 'cash_flow_forecast',
          title: `💵 Next week forecast: $${(nextWeekForecast / 100).toLocaleString()}`,
          detail: `Based on 6-week average, expect ~$${(nextWeekForecast / 100).toLocaleString()} in invoices next week. ` +
                  `Monthly projection: $${(nextMonthForecast / 100).toLocaleString()}. ` +
                  `Peak week was $${(maxWeeklySpend / 100).toLocaleString()} - budget buffer accordingly.`,
          urgency: 'low',
          estimated_value_cents: nextWeekForecast,
          confidence_score: Math.min(80, 50 + weeklySpend.length * 5),
          reasoning: {
            avg_weekly_spend: nextWeekForecast,
            max_weekly_spend: maxWeeklySpend,
            monthly_forecast: nextMonthForecast,
            weeks_analyzed: weeklySpend.length
          }
        });
      }
    } catch (error) {
      console.error('[SmartOrdering] Cash flow forecast error:', error.message);
    }

    return insights;
  }

  /**
   * Substitution Alert - Find cheaper equivalent items
   * Identifies when you're buying premium when value option exists
   */
  findSubstitutionOpportunities(userId) {
    const database = db.getDatabase();
    const insights = [];
    const vendorExclusion = this.getVendorExclusionClause('ir');

    try {
      // Find items in same category with significantly different prices
      const categoryPricing = database.prepare(`
        SELECT
          ii.category,
          ii.sku,
          ii.description,
          ir.vendor_name,
          AVG(ii.unit_price_cents) as avg_price,
          SUM(ii.quantity) as total_qty,
          SUM(ii.total_cents) as total_spend
        FROM invoice_items ii
        JOIN ingestion_runs ir ON ii.run_id = ir.id
        WHERE ir.user_id = ?
          AND ir.status = 'completed'
          AND ii.category IS NOT NULL AND ii.category != ''
          AND ii.sku IS NOT NULL AND ii.sku != ''
          AND ir.created_at >= date('now', '-90 days')
          ${vendorExclusion}
        GROUP BY ii.category, ii.sku
        HAVING total_spend > 5000
        ORDER BY ii.category, avg_price DESC
      `).all(userId);

      // Group by category and find price differences
      const byCategory = {};
      for (const item of categoryPricing) {
        if (!byCategory[item.category]) byCategory[item.category] = [];
        byCategory[item.category].push(item);
      }

      for (const [category, items] of Object.entries(byCategory)) {
        if (items.length >= 2) {
          const prices = items.map(i => i.avg_price);
          const maxPrice = Math.max(...prices);
          const minPrice = Math.min(...prices);

          if (maxPrice > minPrice * 1.5 && minPrice > 0) { // 50%+ price difference
            const highItem = items.find(i => i.avg_price === maxPrice);
            const lowItem = items.find(i => i.avg_price === minPrice);
            const potentialSavings = Math.round((highItem.avg_price - lowItem.avg_price) * highItem.total_qty);

            if (potentialSavings > 1000) { // At least $10 savings
              insights.push({
                insight_type: 'substitution_alert',
                category: category,
                sku: highItem.sku,
                description: highItem.description,
                title: `🔄 Save with substitute: ${category}`,
                detail: `"${this.truncate(highItem.description, 25)}" costs $${(highItem.avg_price / 100).toFixed(2)}/unit. ` +
                        `Consider "${this.truncate(lowItem.description, 25)}" at $${(lowItem.avg_price / 100).toFixed(2)}/unit. ` +
                        `Potential savings: $${(potentialSavings / 100).toFixed(0)} over 90 days.`,
                urgency: potentialSavings > 5000 ? 'high' : 'medium',
                estimated_value_cents: potentialSavings,
                confidence_score: 65, // Lower confidence - quality may differ
                reasoning: {
                  category: category,
                  premium_item: highItem.description,
                  premium_price: Math.round(highItem.avg_price),
                  value_item: lowItem.description,
                  value_price: Math.round(lowItem.avg_price),
                  price_difference_pct: Math.round((maxPrice - minPrice) / maxPrice * 100),
                  potential_savings: potentialSavings
                }
              });
            }
          }
        }
      }
    } catch (error) {
      console.error('[SmartOrdering] Substitution alert error:', error.message);
    }

    return insights;
  }

  /**
   * Menu/Product Mix Analysis - Track spend by category
   * Helps identify where costs are concentrated
   */
  analyzeCategoryMix(userId) {
    const database = db.getDatabase();
    const insights = [];
    const vendorExclusion = this.getVendorExclusionClause('ir');

    try {
      const categorySpend = database.prepare(`
        SELECT
          COALESCE(ii.category, 'Uncategorized') as category,
          SUM(ii.total_cents) as total_spend,
          COUNT(DISTINCT ii.sku) as unique_items,
          COUNT(*) as line_items,
          SUM(ii.total_cents) * 100.0 / (
            SELECT SUM(total_cents) FROM invoice_items ii2
            JOIN ingestion_runs ir2 ON ii2.run_id = ir2.id
            WHERE ir2.user_id = ? AND ir2.status = 'completed'
            AND ir2.created_at >= date('now', '-90 days')
          ) as spend_pct
        FROM invoice_items ii
        JOIN ingestion_runs ir ON ii.run_id = ir.id
        WHERE ir.user_id = ?
          AND ir.status = 'completed'
          AND ir.created_at >= date('now', '-90 days')
          ${vendorExclusion}
        GROUP BY COALESCE(ii.category, 'Uncategorized')
        HAVING total_spend > 10000
        ORDER BY total_spend DESC
        LIMIT 3
      `).all(userId, userId);

      if (categorySpend.length > 0) {
        const topCategory = categorySpend[0];
        if (topCategory.spend_pct > 50) {
          insights.push({
            insight_type: 'category_concentration',
            category: topCategory.category,
            title: `📊 ${topCategory.category}: ${Math.round(topCategory.spend_pct)}% of spend`,
            detail: `"${topCategory.category}" dominates at $${(topCategory.total_spend / 100).toLocaleString()} (${Math.round(topCategory.spend_pct)}% of total). ` +
                    `This is your biggest lever for cost savings. Focus negotiations and substitutions here first.`,
            urgency: topCategory.spend_pct > 60 ? 'medium' : 'low',
            estimated_value_cents: Math.round(topCategory.total_spend * 0.05), // 5% potential savings
            confidence_score: 90,
            reasoning: {
              category: topCategory.category,
              total_spend: topCategory.total_spend,
              spend_percentage: Math.round(topCategory.spend_pct),
              unique_items: topCategory.unique_items,
              line_items: topCategory.line_items
            }
          });
        }
      }
    } catch (error) {
      console.error('[SmartOrdering] Category mix analysis error:', error.message);
    }

    return insights;
  }

  // ================================================================
  // CROSS-INDUSTRY INTELLIGENCE
  // Healthcare, Construction, Retail, Manufacturing, Professional Services
  // ================================================================

  /**
   * Year-over-Year Comparison - Compare spending to same period last year
   * Critical for budgeting and identifying long-term trends
   */
  analyzeYearOverYear(userId) {
    const database = db.getDatabase();
    const insights = [];
    const vendorExclusion = this.getVendorExclusionClause('ir');

    try {
      const comparison = database.prepare(`
        WITH current_period AS (
          SELECT
            SUM(ir.invoice_total_cents) as total_spend,
            COUNT(DISTINCT ir.id) as invoice_count,
            COUNT(DISTINCT ir.vendor_name) as vendor_count
          FROM ingestion_runs ir
          WHERE ir.user_id = ?
            AND ir.status = 'completed'
            AND ir.created_at >= date('now', '-30 days')
            ${vendorExclusion}
        ),
        prior_year AS (
          SELECT
            SUM(ir.invoice_total_cents) as total_spend,
            COUNT(DISTINCT ir.id) as invoice_count,
            COUNT(DISTINCT ir.vendor_name) as vendor_count
          FROM ingestion_runs ir
          WHERE ir.user_id = ?
            AND ir.status = 'completed'
            AND ir.created_at >= date('now', '-395 days')
            AND ir.created_at <= date('now', '-365 days')
            ${vendorExclusion}
        )
        SELECT
          c.total_spend as current_spend,
          c.invoice_count as current_invoices,
          p.total_spend as prior_spend,
          p.invoice_count as prior_invoices,
          CASE WHEN p.total_spend > 0 THEN
            ROUND((c.total_spend - p.total_spend) * 100.0 / p.total_spend, 1)
          ELSE NULL END as change_pct
        FROM current_period c, prior_year p
      `).get(userId, userId);

      if (comparison && comparison.prior_spend > 0 && comparison.change_pct !== null) {
        const changeAmount = comparison.current_spend - comparison.prior_spend;

        if (Math.abs(comparison.change_pct) > 15) {
          const direction = comparison.change_pct > 0 ? 'up' : 'down';
          const icon = comparison.change_pct > 0 ? '📈' : '📉';

          insights.push({
            insight_type: 'year_over_year',
            title: `${icon} YoY spend ${direction} ${Math.abs(comparison.change_pct)}%`,
            detail: `This month: $${(comparison.current_spend / 100).toLocaleString()} vs $${(comparison.prior_spend / 100).toLocaleString()} same time last year. ` +
                    `${comparison.change_pct > 20 ? 'Significant increase - review for cost control opportunities.' :
                      comparison.change_pct < -15 ? 'Great cost reduction! Document what changed.' :
                      'Monitor this trend over the coming months.'}`,
            urgency: Math.abs(comparison.change_pct) > 25 ? 'medium' : 'low',
            estimated_value_cents: Math.abs(changeAmount),
            confidence_score: 85,
            reasoning: {
              current_period_spend: comparison.current_spend,
              prior_year_spend: comparison.prior_spend,
              change_percent: comparison.change_pct,
              change_amount_cents: changeAmount,
              current_invoice_count: comparison.current_invoices,
              prior_invoice_count: comparison.prior_invoices
            }
          });
        }
      }
    } catch (error) {
      console.error('[SmartOrdering] YoY analysis error:', error.message);
    }

    return insights;
  }

  /**
   * Budget Pacing Alert - Track spending against fiscal periods
   * Works for any business with monthly/quarterly budgets
   */
  trackBudgetPacing(userId) {
    const database = db.getDatabase();
    const insights = [];
    const vendorExclusion = this.getVendorExclusionClause('ir');

    try {
      // Calculate month-to-date vs expected run rate
      const pacing = database.prepare(`
        WITH daily_avg AS (
          SELECT
            AVG(daily_spend) as avg_daily,
            SUM(daily_spend) as total_30day
          FROM (
            SELECT
              DATE(ir.created_at) as order_date,
              SUM(ir.invoice_total_cents) as daily_spend
            FROM ingestion_runs ir
            WHERE ir.user_id = ?
              AND ir.status = 'completed'
              AND ir.created_at >= date('now', '-30 days')
              ${vendorExclusion}
            GROUP BY DATE(ir.created_at)
          )
        ),
        mtd AS (
          SELECT
            SUM(ir.invoice_total_cents) as mtd_spend,
            CAST(strftime('%d', 'now') as INTEGER) as day_of_month
          FROM ingestion_runs ir
          WHERE ir.user_id = ?
            AND ir.status = 'completed'
            AND strftime('%Y-%m', ir.created_at) = strftime('%Y-%m', 'now')
            ${vendorExclusion}
        )
        SELECT
          d.avg_daily,
          d.total_30day,
          m.mtd_spend,
          m.day_of_month,
          ROUND(d.avg_daily * 30, 0) as projected_monthly,
          ROUND(m.mtd_spend * 1.0 / NULLIF(m.day_of_month, 0) * 30, 0) as mtd_projected
        FROM daily_avg d, mtd m
      `).get(userId, userId);

      if (pacing && pacing.avg_daily > 0 && pacing.day_of_month >= 7) {
        const mtdPace = pacing.mtd_projected || 0;
        const expectedPace = pacing.projected_monthly || 0;
        const variance = expectedPace > 0 ? ((mtdPace - expectedPace) / expectedPace) * 100 : 0;

        if (Math.abs(variance) > 15) {
          const overBudget = variance > 0;
          insights.push({
            insight_type: 'budget_pacing',
            title: `${overBudget ? '⚠️' : '✅'} Month pacing ${overBudget ? 'over' : 'under'} by ${Math.abs(Math.round(variance))}%`,
            detail: `Day ${pacing.day_of_month}: Tracking to $${(mtdPace / 100).toLocaleString()} this month vs $${(expectedPace / 100).toLocaleString()} normal. ` +
                    `${overBudget ?
                      'Review recent purchases for non-essential items or premature ordering.' :
                      'Great pacing! You may have room for strategic purchases.'}`,
            urgency: overBudget && variance > 25 ? 'high' : 'medium',
            estimated_value_cents: Math.abs(Math.round(mtdPace - expectedPace)),
            confidence_score: Math.min(85, 50 + pacing.day_of_month * 2),
            reasoning: {
              day_of_month: pacing.day_of_month,
              mtd_spend: pacing.mtd_spend,
              mtd_projected_full_month: Math.round(mtdPace),
              typical_monthly_spend: Math.round(expectedPace),
              variance_percent: Math.round(variance)
            }
          });
        }
      }
    } catch (error) {
      console.error('[SmartOrdering] Budget pacing error:', error.message);
    }

    return insights;
  }

  /**
   * Vendor Diversity Analysis - Supply chain risk management
   * Critical for healthcare, manufacturing, and retail
   */
  analyzeVendorDiversity(userId) {
    const database = db.getDatabase();
    const insights = [];
    const vendorExclusion = this.getVendorExclusionClause('ir');

    try {
      const diversityMetrics = database.prepare(`
        SELECT
          ir.vendor_name,
          SUM(ir.invoice_total_cents) as vendor_spend,
          SUM(ir.invoice_total_cents) * 100.0 / (
            SELECT SUM(invoice_total_cents)
            FROM ingestion_runs
            WHERE user_id = ? AND status = 'completed'
            AND created_at >= date('now', '-90 days')
          ) as spend_pct,
          COUNT(DISTINCT ir.id) as invoice_count
        FROM ingestion_runs ir
        WHERE ir.user_id = ?
          AND ir.status = 'completed'
          AND ir.created_at >= date('now', '-90 days')
          ${vendorExclusion}
        GROUP BY ir.vendor_name
        ORDER BY vendor_spend DESC
      `).all(userId, userId);

      if (diversityMetrics.length >= 1) {
        const topVendor = diversityMetrics[0];
        const totalVendors = diversityMetrics.length;

        // Flag if single vendor > 60% of spend (supply chain risk)
        if (topVendor.spend_pct > 60) {
          insights.push({
            insight_type: 'vendor_concentration_risk',
            vendor_name: topVendor.vendor_name,
            title: `⚠️ Supply chain risk: ${Math.round(topVendor.spend_pct)}% with ${topVendor.vendor_name}`,
            detail: `$${(topVendor.vendor_spend / 100).toLocaleString()} of spend concentrated with one vendor. ` +
                    `If they have supply issues, price increases, or quality problems, your operations are at risk. ` +
                    `Consider qualifying backup suppliers for critical items.`,
            urgency: topVendor.spend_pct > 75 ? 'high' : 'medium',
            estimated_value_cents: 0,
            confidence_score: 90,
            reasoning: {
              top_vendor: topVendor.vendor_name,
              top_vendor_spend: topVendor.vendor_spend,
              spend_concentration: Math.round(topVendor.spend_pct),
              total_vendors: totalVendors,
              recommendation: 'Diversify to reduce risk'
            }
          });
        }

        // Positive insight for good diversity
        if (totalVendors >= 5 && topVendor.spend_pct < 40) {
          insights.push({
            insight_type: 'vendor_diversity_good',
            title: `✅ Healthy vendor diversity: ${totalVendors} suppliers`,
            detail: `Your largest supplier (${topVendor.vendor_name}) is only ${Math.round(topVendor.spend_pct)}% of spend. ` +
                    `Good supply chain resilience! Use this leverage in negotiations.`,
            urgency: 'low',
            estimated_value_cents: 0,
            confidence_score: 85,
            reasoning: {
              total_vendors: totalVendors,
              top_vendor_pct: Math.round(topVendor.spend_pct),
              diversification_rating: 'Good'
            }
          });
        }
      }
    } catch (error) {
      console.error('[SmartOrdering] Vendor diversity error:', error.message);
    }

    return insights;
  }

  /**
   * Volume Rebate Tracking - Alert when approaching rebate thresholds
   * Common in healthcare, construction, and manufacturing
   */
  trackVolumeRebates(userId) {
    const database = db.getDatabase();
    const insights = [];
    const vendorExclusion = this.getVendorExclusionClause('ir');

    try {
      // Find vendors where spend is close to round-number thresholds
      const vendorSpend = database.prepare(`
        SELECT
          ir.vendor_name,
          SUM(ir.invoice_total_cents) as total_spend,
          COUNT(DISTINCT ir.id) as invoice_count
        FROM ingestion_runs ir
        WHERE ir.user_id = ?
          AND ir.status = 'completed'
          AND ir.created_at >= date('now', '-90 days')
          ${vendorExclusion}
        GROUP BY ir.vendor_name
        HAVING total_spend > 50000
        ORDER BY total_spend DESC
        LIMIT 5
      `).all(userId);

      for (const vendor of vendorSpend) {
        // Check proximity to common rebate thresholds ($100k, $250k, $500k, $1M)
        const thresholds = [10000000, 50000000, 25000000, 100000000]; // in cents
        const annualProjected = vendor.total_spend * 4; // quarterly -> annual

        for (const threshold of thresholds) {
          const pctOfThreshold = (annualProjected / threshold) * 100;

          if (pctOfThreshold >= 80 && pctOfThreshold < 100) {
            const gapAmount = threshold - annualProjected;
            const rebateEstimate = Math.round(threshold * 0.02); // 2% rebate estimate

            insights.push({
              insight_type: 'rebate_opportunity',
              vendor_name: vendor.vendor_name,
              title: `🎯 ${Math.round(pctOfThreshold)}% to $${(threshold / 100000).toFixed(0)}K rebate with ${vendor.vendor_name}`,
              detail: `Annual pace: $${(annualProjected / 100).toLocaleString()}. Need $${(gapAmount / 100).toLocaleString()} more to hit rebate threshold. ` +
                      `Ask your rep about volume rebate programs - many vendors offer 1-3% back at volume tiers. ` +
                      `Potential rebate: ~$${(rebateEstimate / 100).toLocaleString()}/year.`,
              urgency: pctOfThreshold >= 90 ? 'high' : 'medium',
              estimated_value_cents: rebateEstimate,
              confidence_score: 70,
              reasoning: {
                vendor: vendor.vendor_name,
                quarterly_spend: vendor.total_spend,
                annual_projected: annualProjected,
                threshold: threshold,
                gap_to_threshold: gapAmount,
                potential_rebate: rebateEstimate
              }
            });
            break; // Only show one threshold per vendor
          }
        }
      }
    } catch (error) {
      console.error('[SmartOrdering] Rebate tracking error:', error.message);
    }

    return insights;
  }

  /**
   * Lead Time Intelligence - Flag items that need advance ordering
   * Critical for construction, manufacturing, healthcare
   */
  analyzeProcurementTiming(userId) {
    const database = db.getDatabase();
    const insights = [];
    const vendorExclusion = this.getVendorExclusionClause('ir');

    try {
      // Find items with irregular ordering that might indicate supply constraints
      const orderingPatterns = database.prepare(`
        SELECT
          ii.sku,
          ii.description,
          ir.vendor_name,
          COUNT(*) as order_count,
          AVG(julianday(LEAD(ir.created_at) OVER (PARTITION BY ii.sku ORDER BY ir.created_at)) - julianday(ir.created_at)) as avg_gap,
          MAX(julianday(LEAD(ir.created_at) OVER (PARTITION BY ii.sku ORDER BY ir.created_at)) - julianday(ir.created_at)) as max_gap,
          SUM(ii.total_cents) as total_spend,
          MAX(ir.created_at) as last_order
        FROM invoice_items ii
        JOIN ingestion_runs ir ON ii.run_id = ir.id
        WHERE ir.user_id = ?
          AND ir.status = 'completed'
          AND ii.sku IS NOT NULL AND ii.sku != ''
          AND ir.created_at >= date('now', '-180 days')
          ${vendorExclusion}
        GROUP BY ii.sku
        HAVING order_count >= 3 AND total_spend > 20000 AND avg_gap IS NOT NULL
        ORDER BY max_gap DESC
        LIMIT 3
      `).all(userId);

      for (const item of orderingPatterns) {
        // Flag items with high variability in order timing (may indicate supply issues)
        if (item.max_gap && item.avg_gap && item.max_gap > item.avg_gap * 2) {
          const daysSinceOrder = Math.round((Date.now() - new Date(item.last_order).getTime()) / (1000 * 60 * 60 * 24));
          const nextExpected = Math.round(item.avg_gap);

          insights.push({
            insight_type: 'procurement_timing',
            sku: item.sku,
            description: item.description,
            vendor_name: item.vendor_name,
            title: `⏰ Plan ahead: ${this.truncate(item.description || item.sku, 25)}`,
            detail: `Order timing varies significantly (avg ${Math.round(item.avg_gap)} days, max ${Math.round(item.max_gap)} days between orders). ` +
                    `Last ordered ${daysSinceOrder} days ago. ` +
                    `This item may have supply constraints - order early to avoid shortages.`,
            urgency: daysSinceOrder > nextExpected * 0.8 ? 'high' : 'medium',
            estimated_value_cents: 0,
            confidence_score: 75,
            reasoning: {
              sku: item.sku,
              avg_order_gap_days: Math.round(item.avg_gap),
              max_order_gap_days: Math.round(item.max_gap),
              days_since_last_order: daysSinceOrder,
              order_count: item.order_count,
              recommendation: 'Order 7-10 days before typical reorder point'
            }
          });
        }
      }
    } catch (error) {
      console.error('[SmartOrdering] Procurement timing error:', error.message);
    }

    return insights;
  }

  /**
   * Capital vs Operating Analysis - Help with expense categorization
   * Important for tax planning and budgeting
   */
  analyzePurchaseCategories(userId) {
    const database = db.getDatabase();
    const insights = [];
    const vendorExclusion = this.getVendorExclusionClause('ir');

    try {
      // Find high-value single purchases that might be capital expenses
      const largePurchases = database.prepare(`
        SELECT
          ii.sku,
          ii.description,
          ir.vendor_name,
          ii.total_cents,
          ii.quantity,
          ir.created_at
        FROM invoice_items ii
        JOIN ingestion_runs ir ON ii.run_id = ir.id
        WHERE ir.user_id = ?
          AND ir.status = 'completed'
          AND ii.total_cents >= 50000
          AND ir.created_at >= date('now', '-90 days')
          ${vendorExclusion}
        ORDER BY ii.total_cents DESC
        LIMIT 5
      `).all(userId);

      const capitalKeywords = ['equipment', 'machine', 'system', 'computer', 'furniture', 'fixture', 'appliance', 'unit'];
      const capitalItems = largePurchases.filter(item => {
        const desc = (item.description || '').toLowerCase();
        return capitalKeywords.some(kw => desc.includes(kw)) || item.total_cents >= 250000;
      });

      if (capitalItems.length > 0) {
        const totalCapital = capitalItems.reduce((sum, i) => sum + i.total_cents, 0);

        insights.push({
          insight_type: 'capital_purchase',
          title: `📋 ${capitalItems.length} potential capital expense${capitalItems.length > 1 ? 's' : ''}`,
          detail: `$${(totalCapital / 100).toLocaleString()} in purchases may qualify as capital expenses for depreciation. ` +
                  `Items: ${capitalItems.slice(0, 3).map(i => this.truncate(i.description || i.sku, 20)).join(', ')}. ` +
                  `Consult your accountant for proper classification and tax benefits.`,
          urgency: 'low',
          estimated_value_cents: Math.round(totalCapital * 0.25), // Rough tax benefit estimate
          confidence_score: 60,
          reasoning: {
            items_flagged: capitalItems.length,
            total_amount: totalCapital,
            items: capitalItems.map(i => ({
              description: i.description,
              amount: i.total_cents
            }))
          }
        });
      }
    } catch (error) {
      console.error('[SmartOrdering] Capital analysis error:', error.message);
    }

    return insights;
  }

  /**
   * Quarter-End Optimization - Strategic year-end purchasing
   * Tax planning and budget utilization
   */
  analyzeQuarterEndOpportunities(userId) {
    const database = db.getDatabase();
    const insights = [];
    const vendorExclusion = this.getVendorExclusionClause('ir');

    try {
      const now = new Date();
      const month = now.getMonth() + 1; // 1-12
      const day = now.getDate();

      // Check if we're near quarter end (last 2 weeks of March, June, Sept, Dec)
      const quarterEndMonths = [3, 6, 9, 12];
      const nearQuarterEnd = quarterEndMonths.includes(month) && day >= 15;
      const nearYearEnd = month === 12 && day >= 1;

      if (nearQuarterEnd || nearYearEnd) {
        // Get recent spending to understand patterns
        const recentSpend = database.prepare(`
          SELECT
            SUM(ir.invoice_total_cents) as total_spend,
            COUNT(DISTINCT ir.vendor_name) as vendor_count
          FROM ingestion_runs ir
          WHERE ir.user_id = ?
            AND ir.status = 'completed'
            AND ir.created_at >= date('now', '-30 days')
            ${vendorExclusion}
        `).get(userId);

        if (recentSpend && recentSpend.total_spend > 0) {
          const isYearEnd = nearYearEnd;

          insights.push({
            insight_type: 'quarter_end_planning',
            title: `📅 ${isYearEnd ? 'Year' : 'Quarter'}-end purchasing window`,
            detail: `${isYearEnd ? 'Year' : 'Quarter'} ending soon. Consider: ` +
                    `(1) Accelerate planned purchases for tax benefits, ` +
                    `(2) Use remaining budget before it resets, ` +
                    `(3) Negotiate with vendors who need to hit quotas, ` +
                    `(4) Stock up on items before potential January price increases.`,
            urgency: isYearEnd ? 'high' : 'medium',
            estimated_value_cents: 0,
            confidence_score: 90,
            reasoning: {
              period: isYearEnd ? 'year_end' : 'quarter_end',
              current_month: month,
              current_day: day,
              recent_monthly_spend: recentSpend.total_spend,
              active_vendors: recentSpend.vendor_count
            }
          });
        }
      }
    } catch (error) {
      console.error('[SmartOrdering] Quarter-end analysis error:', error.message);
    }

    return insights;
  }

  /**
   * Compliance Spend Tracking - Track regulatory/safety purchases
   * Critical for healthcare, construction, food service
   */
  trackComplianceSpend(userId) {
    const database = db.getDatabase();
    const insights = [];
    const vendorExclusion = this.getVendorExclusionClause('ir');

    try {
      // Look for compliance-related keywords
      const complianceKeywords = ['safety', 'ppe', 'glove', 'mask', 'sanitiz', 'fire', 'extinguish',
        'first aid', 'inspection', 'compliance', 'certification', 'training', 'license'];

      const complianceSpend = database.prepare(`
        SELECT
          ii.description,
          ii.category,
          SUM(ii.total_cents) as total_spend,
          COUNT(*) as order_count
        FROM invoice_items ii
        JOIN ingestion_runs ir ON ii.run_id = ir.id
        WHERE ir.user_id = ?
          AND ir.status = 'completed'
          AND ir.created_at >= date('now', '-90 days')
          ${vendorExclusion}
        GROUP BY ii.description
        ORDER BY total_spend DESC
      `).all(userId);

      let totalComplianceSpend = 0;
      const complianceItems = [];

      for (const item of complianceSpend) {
        const desc = (item.description || '').toLowerCase();
        if (complianceKeywords.some(kw => desc.includes(kw))) {
          totalComplianceSpend += item.total_spend;
          complianceItems.push(item);
        }
      }

      if (totalComplianceSpend > 10000) { // At least $100 in compliance spend
        insights.push({
          insight_type: 'compliance_spend',
          title: `🛡️ Compliance spend: $${(totalComplianceSpend / 100).toLocaleString()} this quarter`,
          detail: `Tracking ${complianceItems.length} compliance-related items including: ` +
                  `${complianceItems.slice(0, 3).map(i => this.truncate(i.description, 20)).join(', ')}. ` +
                  `Keep these records for audits and consider consolidating compliance purchases with a single vendor for better pricing.`,
          urgency: 'low',
          estimated_value_cents: Math.round(totalComplianceSpend * 0.1), // 10% potential savings from consolidation
          confidence_score: 70,
          reasoning: {
            total_compliance_spend: totalComplianceSpend,
            compliance_items_count: complianceItems.length,
            top_items: complianceItems.slice(0, 5).map(i => ({
              description: i.description,
              spend: i.total_spend
            }))
          }
        });
      }
    } catch (error) {
      console.error('[SmartOrdering] Compliance spend error:', error.message);
    }

    return insights;
  }

  /**
   * Emergency Order Detection - Flag rush ordering patterns
   * Indicates inventory management issues
   */
  detectEmergencyPatterns(userId) {
    const database = db.getDatabase();
    const insights = [];
    const vendorExclusion = this.getVendorExclusionClause('ir');

    try {
      // Find vendors with multiple orders in short timeframes
      const rushPatterns = database.prepare(`
        WITH order_gaps AS (
          SELECT
            ir.vendor_name,
            DATE(ir.created_at) as order_date,
            ir.invoice_total_cents,
            julianday(ir.created_at) - julianday(LAG(ir.created_at) OVER (PARTITION BY ir.vendor_name ORDER BY ir.created_at)) as days_since_last
          FROM ingestion_runs ir
          WHERE ir.user_id = ?
            AND ir.status = 'completed'
            AND ir.created_at >= date('now', '-90 days')
            ${vendorExclusion}
        )
        SELECT
          vendor_name,
          COUNT(CASE WHEN days_since_last <= 3 THEN 1 END) as rush_orders,
          COUNT(*) as total_orders,
          AVG(invoice_total_cents) as avg_order_value
        FROM order_gaps
        GROUP BY vendor_name
        HAVING total_orders >= 4 AND rush_orders >= 2
        ORDER BY rush_orders DESC
        LIMIT 3
      `).all(userId);

      for (const vendor of rushPatterns) {
        const rushRate = (vendor.rush_orders / vendor.total_orders) * 100;
        const extraCost = Math.round(vendor.rush_orders * vendor.avg_order_value * 0.15); // Est 15% premium for rush

        if (rushRate > 30) {
          insights.push({
            insight_type: 'emergency_ordering',
            vendor_name: vendor.vendor_name,
            title: `🚨 ${vendor.rush_orders} rush orders from ${vendor.vendor_name}`,
            detail: `${Math.round(rushRate)}% of orders placed within 3 days of previous order. ` +
                    `Rush orders typically cost 10-20% more (expedited shipping, price premiums). ` +
                    `Estimated extra cost: $${(extraCost / 100).toFixed(0)}. ` +
                    `Review par levels and reorder points for items from this vendor.`,
            urgency: rushRate > 50 ? 'high' : 'medium',
            estimated_value_cents: extraCost,
            confidence_score: 80,
            reasoning: {
              vendor: vendor.vendor_name,
              rush_orders: vendor.rush_orders,
              total_orders: vendor.total_orders,
              rush_rate_percent: Math.round(rushRate),
              avg_order_value: Math.round(vendor.avg_order_value),
              estimated_premium_paid: extraCost
            }
          });
        }
      }
    } catch (error) {
      console.error('[SmartOrdering] Emergency pattern detection error:', error.message);
    }

    return insights;
  }

  /**
   * Total Cost of Ownership - Beyond unit price
   * Hidden costs like delivery, minimums, terms
   */
  analyzeTotalCostOfOwnership(userId) {
    const database = db.getDatabase();
    const insights = [];
    const vendorExclusion = this.getVendorExclusionClause('ir');

    try {
      // Compare vendors for same/similar items to find hidden costs
      const vendorComparison = database.prepare(`
        SELECT
          ii.sku,
          ii.description,
          ir.vendor_name,
          AVG(ii.unit_price_cents) as avg_unit_price,
          AVG(ii.total_cents / NULLIF(ii.quantity, 0)) as effective_price,
          SUM(ii.total_cents) as total_spend,
          COUNT(*) as order_count,
          AVG(ii.quantity) as avg_qty
        FROM invoice_items ii
        JOIN ingestion_runs ir ON ii.run_id = ir.id
        WHERE ir.user_id = ?
          AND ir.status = 'completed'
          AND ii.sku IS NOT NULL AND ii.sku != ''
          AND ii.quantity > 0
          AND ir.created_at >= date('now', '-90 days')
          ${vendorExclusion}
        GROUP BY ii.sku, ir.vendor_name
        HAVING order_count >= 2
        ORDER BY total_spend DESC
      `).all(userId);

      // Group by SKU to find multi-vendor items
      const bySku = {};
      for (const item of vendorComparison) {
        if (!bySku[item.sku]) bySku[item.sku] = [];
        bySku[item.sku].push(item);
      }

      // Find SKUs bought from multiple vendors
      for (const [sku, vendors] of Object.entries(bySku)) {
        if (vendors.length >= 2) {
          const prices = vendors.map(v => v.avg_unit_price);
          const minPrice = Math.min(...prices);
          const maxPrice = Math.max(...prices);
          const priceDiff = ((maxPrice - minPrice) / minPrice) * 100;

          if (priceDiff > 15 && maxPrice > 100) { // >15% difference, meaningful amounts
            const expensiveVendor = vendors.find(v => v.avg_unit_price === maxPrice);
            const cheaperVendor = vendors.find(v => v.avg_unit_price === minPrice);
            const potentialSavings = Math.round((maxPrice - minPrice) * expensiveVendor.avg_qty * expensiveVendor.order_count);

            insights.push({
              insight_type: 'tco_analysis',
              sku: sku,
              description: expensiveVendor.description,
              title: `💡 Price gap: ${this.truncate(expensiveVendor.description || sku, 22)}`,
              detail: `${expensiveVendor.vendor_name}: $${(maxPrice / 100).toFixed(2)}/unit vs ${cheaperVendor.vendor_name}: $${(minPrice / 100).toFixed(2)}/unit (${Math.round(priceDiff)}% difference). ` +
                      `Verify quality is comparable. If so, consolidate with lower-cost vendor to save ~$${(potentialSavings / 100).toFixed(0)}.`,
              urgency: priceDiff > 25 ? 'high' : 'medium',
              estimated_value_cents: potentialSavings,
              confidence_score: 75,
              reasoning: {
                sku: sku,
                expensive_vendor: expensiveVendor.vendor_name,
                expensive_price: Math.round(maxPrice),
                cheaper_vendor: cheaperVendor.vendor_name,
                cheaper_price: Math.round(minPrice),
                price_difference_pct: Math.round(priceDiff),
                potential_savings: potentialSavings
              }
            });
          }
        }
      }
    } catch (error) {
      console.error('[SmartOrdering] TCO analysis error:', error.message);
    }

    return insights.slice(0, 3); // Limit to top 3
  }

  // ================================================================
  // MARKET INTELLIGENCE - Enhanced Event & Demand Insights
  // ================================================================

  /**
   * Detect significant COGS increases requiring immediate attention
   * More urgent than margin_erosion - focuses on recent spikes
   */
  detectCOGSSpikeAlerts(userId) {
    const database = db.getDatabase();
    const insights = [];
    const vendorExclusion = this.getVendorExclusionClause('ir');

    try {
      // Find SKUs with significant price increases in last 14 days vs prior 60-day baseline
      const cogsSpikes = database.prepare(`
        WITH recent_prices AS (
          SELECT
            ii.sku,
            ii.description,
            ir.vendor_name,
            AVG(ii.unit_price_cents) as recent_avg,
            SUM(ii.quantity) as recent_qty,
            COUNT(*) as recent_orders
          FROM invoice_items ii
          JOIN ingestion_runs ir ON ii.run_id = ir.id
          WHERE ir.user_id = ?
            AND ir.status = 'completed'
            AND ir.created_at >= date('now', '-14 days')
            AND ii.sku IS NOT NULL AND ii.sku != ''
            AND ii.unit_price_cents > 0
            ${vendorExclusion}
          GROUP BY ii.sku
        ),
        baseline_prices AS (
          SELECT
            ii.sku,
            AVG(ii.unit_price_cents) as baseline_avg,
            COUNT(*) as baseline_orders
          FROM invoice_items ii
          JOIN ingestion_runs ir ON ii.run_id = ir.id
          WHERE ir.user_id = ?
            AND ir.status = 'completed'
            AND ir.created_at BETWEEN date('now', '-90 days') AND date('now', '-14 days')
            AND ii.sku IS NOT NULL AND ii.sku != ''
            AND ii.unit_price_cents > 0
            ${vendorExclusion}
          GROUP BY ii.sku
          HAVING baseline_orders >= 2
        )
        SELECT
          r.sku, r.description, r.vendor_name,
          r.recent_avg, r.recent_qty, r.recent_orders,
          b.baseline_avg, b.baseline_orders,
          ROUND((r.recent_avg - b.baseline_avg) * 100.0 / b.baseline_avg, 1) as pct_increase
        FROM recent_prices r
        JOIN baseline_prices b ON r.sku = b.sku
        WHERE r.recent_avg > b.baseline_avg * 1.12  -- 12%+ increase
        ORDER BY (r.recent_avg - b.baseline_avg) * r.recent_qty DESC
        LIMIT 5
      `).all(userId, userId);

      for (const item of cogsSpikes) {
        const costIncrease = Math.round((item.recent_avg - item.baseline_avg) * item.recent_qty);
        const urgency = item.pct_increase > 25 ? 'high' : item.pct_increase > 15 ? 'medium' : 'low';

        insights.push({
          insight_type: 'cogs_spike_alert',
          sku: item.sku,
          description: item.description,
          vendor_name: item.vendor_name,
          title: `📈 COGS Alert: ${this.truncate(item.description || item.sku, 22)} +${Math.round(item.pct_increase)}%`,
          detail: `Cost jumped from $${(item.baseline_avg / 100).toFixed(2)} to $${(item.recent_avg / 100).toFixed(2)} per unit ` +
                  `(+${Math.round(item.pct_increase)}%). Recent orders: ${item.recent_orders}. ` +
                  `Impact: ~$${(costIncrease / 100).toFixed(0)} extra this period. ` +
                  `Action: Review menu pricing, find alternatives, or contact ${item.vendor_name}.`,
          urgency,
          estimated_value_cents: costIncrease,
          confidence_score: Math.min(90, 55 + item.baseline_orders * 3 + item.recent_orders * 5),
          reasoning: {
            sku: item.sku,
            baseline_price_cents: Math.round(item.baseline_avg),
            recent_price_cents: Math.round(item.recent_avg),
            price_increase_pct: item.pct_increase,
            recent_quantity: item.recent_qty,
            cost_impact_cents: costIncrease,
            baseline_data_points: item.baseline_orders
          }
        });
      }
    } catch (error) {
      console.error('[SmartOrdering] COGS spike detection error:', error.message);
    }

    return insights;
  }

  /**
   * Weekly Demand Forecast - Predict next 7 days based on patterns
   * Combines day-of-week patterns with upcoming holidays
   */
  forecastWeeklyDemand(userId) {
    const database = db.getDatabase();
    const insights = [];
    const vendorExclusion = this.getVendorExclusionClause('ir');

    try {
      // Get day-of-week spending patterns
      const weeklyPattern = database.prepare(`
        SELECT
          strftime('%w', created_at) as day_of_week,
          AVG(invoice_total_cents) as avg_daily_spend,
          COUNT(*) as order_count
        FROM ingestion_runs
        WHERE user_id = ?
          AND status = 'completed'
          AND created_at >= date('now', '-60 days')
          ${vendorExclusion}
        GROUP BY strftime('%w', created_at)
        HAVING order_count >= 3
      `).all(userId);

      if (weeklyPattern.length < 4) return insights; // Need enough data

      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const today = new Date();
      const currentDayOfWeek = today.getDay();

      // Calculate overall average
      const overallAvg = weeklyPattern.reduce((sum, d) => sum + d.avg_daily_spend, 0) / weeklyPattern.length;

      // Build 7-day forecast
      const forecast = [];
      for (let i = 0; i < 7; i++) {
        const targetDay = (currentDayOfWeek + i) % 7;
        const dayData = weeklyPattern.find(d => parseInt(d.day_of_week) === targetDay);
        const predictedSpend = dayData ? dayData.avg_daily_spend : overallAvg;
        const vsAverage = ((predictedSpend - overallAvg) / overallAvg) * 100;

        forecast.push({
          day: dayNames[targetDay],
          daysFromNow: i,
          predictedSpend: Math.round(predictedSpend),
          vsAveragePct: Math.round(vsAverage)
        });
      }

      // Find peak and low days in forecast
      const peakDay = forecast.reduce((max, d) => d.predictedSpend > max.predictedSpend ? d : max, forecast[0]);
      const lowDay = forecast.reduce((min, d) => d.predictedSpend < min.predictedSpend ? d : min, forecast[0]);

      // Check for upcoming holidays
      const upcomingHolidays = [];
      for (const [key, holiday] of Object.entries(this.config.holidays)) {
        const daysUntil = this.daysUntilDate(today.getMonth() + 1, today.getDate(), holiday.month, holiday.day);
        if (daysUntil >= 0 && daysUntil <= 14) {
          upcomingHolidays.push({ name: holiday.name, daysUntil });
        }
      }

      // Generate forecast insight
      const weekTotal = forecast.reduce((sum, d) => sum + d.predictedSpend, 0);
      let holidayNote = '';
      if (upcomingHolidays.length > 0) {
        holidayNote = ` ${upcomingHolidays[0].name} in ${upcomingHolidays[0].daysUntil} days may increase demand.`;
      }

      insights.push({
        insight_type: 'demand_forecast_7day',
        title: `📊 Next 7 Days: ~$${(weekTotal / 100).toLocaleString()} projected spend`,
        detail: `Peak: ${peakDay.day} (+${peakDay.vsAveragePct}% vs avg). ` +
                `Low: ${lowDay.day} (${lowDay.vsAveragePct}% vs avg). ` +
                `Plan staffing and prep accordingly.${holidayNote}`,
        urgency: upcomingHolidays.length > 0 ? 'medium' : 'low',
        estimated_value_cents: weekTotal,
        confidence_score: Math.min(80, 45 + weeklyPattern.reduce((sum, d) => sum + d.order_count, 0) / 2),
        reasoning: {
          forecast_days: forecast,
          week_total_cents: weekTotal,
          peak_day: peakDay.day,
          peak_day_spend_cents: peakDay.predictedSpend,
          low_day: lowDay.day,
          low_day_spend_cents: lowDay.predictedSpend,
          upcoming_holidays: upcomingHolidays,
          data_points: weeklyPattern.reduce((sum, d) => sum + d.order_count, 0)
        }
      });

    } catch (error) {
      console.error('[SmartOrdering] Weekly demand forecast error:', error.message);
    }

    return insights;
  }

  /**
   * Find vendor alternatives - explicit recommendations to switch vendors
   * Builds on TCO analysis but more actionable
   */
  findVendorAlternatives(userId) {
    const database = db.getDatabase();
    const insights = [];
    const vendorExclusion = this.getVendorExclusionClause('ir');

    try {
      // Find SKUs purchased from multiple vendors with significant price differences
      const alternatives = database.prepare(`
        WITH vendor_prices AS (
          SELECT
            ii.sku,
            ii.description,
            ir.vendor_name,
            AVG(ii.unit_price_cents) as avg_price,
            SUM(ii.quantity) as total_qty,
            SUM(ii.total_cents) as total_spend,
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
        )
        SELECT
          vp1.sku, vp1.description,
          vp1.vendor_name as current_vendor,
          vp1.avg_price as current_price,
          vp1.total_qty as current_qty,
          vp1.total_spend,
          vp2.vendor_name as alt_vendor,
          vp2.avg_price as alt_price,
          ROUND((vp1.avg_price - vp2.avg_price) * 100.0 / vp1.avg_price, 1) as savings_pct
        FROM vendor_prices vp1
        JOIN vendor_prices vp2 ON vp1.sku = vp2.sku
        WHERE vp1.vendor_name != vp2.vendor_name
          AND vp2.avg_price < vp1.avg_price * 0.88  -- At least 12% cheaper
          AND vp1.total_spend > 5000  -- Meaningful spend
          AND vp1.last_order >= date('now', '-30 days')  -- Recently purchased
        ORDER BY (vp1.avg_price - vp2.avg_price) * vp1.total_qty DESC
        LIMIT 3
      `).all(userId);

      for (const item of alternatives) {
        const monthlySavings = Math.round((item.current_price - item.alt_price) * item.current_qty / 3);

        insights.push({
          insight_type: 'vendor_alternative_found',
          sku: item.sku,
          description: item.description,
          vendor_name: item.current_vendor,
          title: `🔄 Switch vendors: Save ${Math.round(item.savings_pct)}% on ${this.truncate(item.description || item.sku, 18)}`,
          detail: `${item.alt_vendor} offers this at $${(item.alt_price / 100).toFixed(2)}/unit vs ` +
                  `${item.current_vendor} at $${(item.current_price / 100).toFixed(2)}/unit. ` +
                  `Potential savings: ~$${(monthlySavings / 100).toFixed(0)}/month. ` +
                  `Verify quality is comparable before switching.`,
          urgency: item.savings_pct > 20 ? 'high' : 'medium',
          estimated_value_cents: monthlySavings * 3, // Quarterly projection
          confidence_score: 80,
          reasoning: {
            sku: item.sku,
            current_vendor: item.current_vendor,
            current_price_cents: Math.round(item.current_price),
            alternative_vendor: item.alt_vendor,
            alternative_price_cents: Math.round(item.alt_price),
            savings_percent: item.savings_pct,
            monthly_savings_cents: monthlySavings,
            recent_quantity: item.current_qty
          }
        });
      }
    } catch (error) {
      console.error('[SmartOrdering] Vendor alternatives error:', error.message);
    }

    return insights;
  }

  /**
   * Pricing Recommendation - Suggest menu/selling price adjustments
   * Based on COGS changes to maintain margins
   */
  generatePricingRecommendations(userId) {
    const database = db.getDatabase();
    const insights = [];
    const vendorExclusion = this.getVendorExclusionClause('ir');

    try {
      // Find high-volume items with significant cost increases
      const pricingCandidates = database.prepare(`
        WITH cost_changes AS (
          SELECT
            ii.sku,
            ii.description,
            ir.vendor_name,
            AVG(CASE WHEN ir.created_at >= date('now', '-30 days') THEN ii.unit_price_cents END) as recent_cost,
            AVG(CASE WHEN ir.created_at < date('now', '-30 days') THEN ii.unit_price_cents END) as old_cost,
            SUM(ii.quantity) as total_qty,
            SUM(ii.total_cents) as total_spend,
            COUNT(*) as order_count
          FROM invoice_items ii
          JOIN ingestion_runs ir ON ii.run_id = ir.id
          WHERE ir.user_id = ?
            AND ir.status = 'completed'
            AND ii.sku IS NOT NULL AND ii.sku != ''
            AND ii.unit_price_cents > 0
            AND ir.created_at >= date('now', '-90 days')
            ${vendorExclusion}
          GROUP BY ii.sku
          HAVING order_count >= 4 AND total_spend > 10000
        )
        SELECT *,
          ROUND((recent_cost - old_cost) * 100.0 / old_cost, 1) as cost_change_pct
        FROM cost_changes
        WHERE recent_cost IS NOT NULL AND old_cost IS NOT NULL
          AND recent_cost > old_cost * 1.08  -- 8%+ increase
        ORDER BY total_spend DESC
        LIMIT 3
      `).all(userId);

      for (const item of pricingCandidates) {
        // Assume 30% food cost target for restaurants
        const targetFoodCostPct = 30;
        const suggestedSellingPrice = Math.round(item.recent_cost / (targetFoodCostPct / 100));
        const priceIncrease = Math.round(item.recent_cost - item.old_cost);

        insights.push({
          insight_type: 'pricing_recommendation',
          sku: item.sku,
          description: item.description,
          vendor_name: item.vendor_name,
          title: `💰 Review pricing: ${this.truncate(item.description || item.sku, 22)}`,
          detail: `Cost increased ${Math.round(item.cost_change_pct)}% (to $${(item.recent_cost / 100).toFixed(2)}/unit). ` +
                  `To maintain 30% food cost, menu price should be ~$${(suggestedSellingPrice / 100).toFixed(2)}. ` +
                  `Consider a ${Math.min(5, Math.round(item.cost_change_pct / 2))}% price increase or portion adjustment.`,
          urgency: item.cost_change_pct > 15 ? 'high' : 'medium',
          estimated_value_cents: priceIncrease * Math.round(item.total_qty / 3),
          confidence_score: 75,
          reasoning: {
            sku: item.sku,
            old_cost_cents: Math.round(item.old_cost),
            new_cost_cents: Math.round(item.recent_cost),
            cost_increase_pct: item.cost_change_pct,
            suggested_selling_price_cents: suggestedSellingPrice,
            target_food_cost_pct: targetFoodCostPct,
            monthly_volume: Math.round(item.total_qty / 3)
          }
        });
      }
    } catch (error) {
      console.error('[SmartOrdering] Pricing recommendations error:', error.message);
    }

    return insights;
  }

  // ================================================================
  // TONIGHT / THIS WEEK AGGREGATION VIEWS
  // ================================================================

  /**
   * Get insights most relevant for TODAY/TONIGHT
   * Filters and prioritizes time-sensitive insights
   */
  getTonightInsights(userId) {
    // Get all insights first
    const allInsights = this.generateInsights(userId);

    // Filter for today-relevant insight types
    const todayRelevantTypes = [
      'reorder_prediction',      // Need to reorder today
      'seasonal_demand',         // Holiday prep
      'day_pattern',             // Today is ordering day
      'low_stock',               // Stock alerts
      'waste_risk',              // Potential spoilage today
      'cogs_spike_alert',        // Recent cost spikes
      'event_demand_spike',      // Event-driven demand
      'demand_forecast_7day'     // Weekly outlook
    ];

    const tonightInsights = allInsights.filter(insight => {
      // Include if it's a today-relevant type
      if (todayRelevantTypes.includes(insight.insight_type)) return true;

      // Include high urgency items regardless of type
      if (insight.urgency === 'high') return true;

      // Include if reasoning mentions "today" or time-sensitive language
      if (insight.reasoning?.days_until <= 1) return true;
      if (insight.reasoning?.days_until_next <= 1) return true;

      return false;
    });

    // Sort by urgency
    return this.sortInsights(tonightInsights);
  }

  /**
   * Get insights relevant for THIS WEEK planning
   * Focuses on pricing, vendor optimization, and weekly prep
   */
  getThisWeekInsights(userId) {
    const allInsights = this.generateInsights(userId);

    // Filter for week-planning insight types
    const weekRelevantTypes = [
      'seasonal_demand',         // Upcoming holidays
      'margin_erosion',          // Review pricing
      'pricing_recommendation',  // Price adjustments
      'vendor_alternative_found',// Vendor switches
      'supplier_reliability',    // Vendor issues
      'bulk_consolidation',      // Ordering efficiency
      'vendor_consolidation',    // Vendor efficiency
      'budget_pacing',           // Budget tracking
      'demand_forecast_7day',    // Weekly forecast
      'cogs_spike_alert',        // Cost alerts
      'contract_opportunity',    // Contract reviews
      'payment_optimization'     // Payment terms
    ];

    const weekInsights = allInsights.filter(insight => {
      // Include if it's a week-planning type
      if (weekRelevantTypes.includes(insight.insight_type)) return true;

      // Include medium+ urgency items
      if (insight.urgency === 'high' || insight.urgency === 'medium') return true;

      // Include if has significant savings potential
      if (insight.estimated_value_cents > 5000) return true;

      return false;
    });

    return this.sortInsights(weekInsights);
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

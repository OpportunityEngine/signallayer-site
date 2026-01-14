/**
 * Revenue Radar - Smart Reorder Recommendations Engine
 *
 * Sophisticated inventory intelligence that:
 * - Predicts when you'll run out based on usage trends
 * - Detects vendor discounts and price drops
 * - Accounts for seasonality and holidays
 * - Calculates optimal order quantities for maximum savings
 * - Provides actionable "buy now" vs "wait" recommendations
 */

const db = require('./database');

class ReorderEngine {
  constructor() {
    // Holiday/seasonal multipliers for hospitality industry
    this.seasonalFactors = {
      // Month-based multipliers (1 = normal, >1 = higher demand)
      1: 0.85,  // January - post-holiday slump
      2: 0.90,  // February - Valentine's spike mid-month
      3: 1.05,  // March - St. Patrick's, spring break
      4: 1.00,  // April - Easter varies
      5: 1.10,  // May - Cinco de Mayo, Memorial Day
      6: 1.15,  // June - wedding season, summer starts
      7: 1.20,  // July - Peak summer, July 4th
      8: 1.15,  // August - Late summer
      9: 1.05,  // September - Labor Day, back to school
      10: 1.10, // October - Halloween, football season
      11: 1.25, // November - Thanksgiving week huge
      12: 1.30  // December - Holiday parties, NYE
    };

    // Key holidays with demand spikes (days before = increased usage)
    this.majorHolidays = [
      { name: 'New Years Eve', month: 12, day: 31, daysBeforeSpike: 7, multiplier: 2.0 },
      { name: 'Super Bowl Sunday', month: 2, day: 9, daysBeforeSpike: 5, multiplier: 1.8 },
      { name: 'Valentines Day', month: 2, day: 14, daysBeforeSpike: 3, multiplier: 1.5 },
      { name: 'St Patricks Day', month: 3, day: 17, daysBeforeSpike: 7, multiplier: 2.0 },
      { name: 'Cinco de Mayo', month: 5, day: 5, daysBeforeSpike: 5, multiplier: 1.8 },
      { name: 'Memorial Day', month: 5, day: 27, daysBeforeSpike: 7, multiplier: 1.4 },
      { name: 'July 4th', month: 7, day: 4, daysBeforeSpike: 7, multiplier: 1.8 },
      { name: 'Labor Day', month: 9, day: 2, daysBeforeSpike: 5, multiplier: 1.4 },
      { name: 'Halloween', month: 10, day: 31, daysBeforeSpike: 7, multiplier: 1.5 },
      { name: 'Thanksgiving', month: 11, day: 28, daysBeforeSpike: 10, multiplier: 1.6 },
      { name: 'Christmas Eve', month: 12, day: 24, daysBeforeSpike: 14, multiplier: 1.8 }
    ];

    // Category-specific insights
    this.categoryInsights = {
      'spirits': { shelfLife: 365 * 5, bulkDiscountThreshold: 12, seasonalPeak: [11, 12] },
      'wine': { shelfLife: 365 * 2, bulkDiscountThreshold: 6, seasonalPeak: [2, 11, 12] },
      'beer': { shelfLife: 180, bulkDiscountThreshold: 24, seasonalPeak: [5, 6, 7, 9, 10] },
      'mixers': { shelfLife: 365, bulkDiscountThreshold: 24, seasonalPeak: [5, 6, 7, 8] },
      'garnishes': { shelfLife: 14, bulkDiscountThreshold: 10, seasonalPeak: [5, 6, 7, 8] },
      'food': { shelfLife: 7, bulkDiscountThreshold: 0, seasonalPeak: [] },
      'disposables': { shelfLife: 365 * 10, bulkDiscountThreshold: 100, seasonalPeak: [5, 6, 7, 8] }
    };
  }

  /**
   * Generate smart recommendations for a user's inventory
   */
  async generateRecommendations(userId) {
    if (!userId) {
      console.error('[ReorderEngine] generateRecommendations called without userId');
      return [];
    }

    const database = db.getDatabase();
    const recommendations = [];

    // Get all active inventory items with usage history
    let items;
    try {
      items = database.prepare(`
        SELECT
          i.*,
          (SELECT AVG(daily_usage)
           FROM inventory_usage
           WHERE inventory_item_id = i.id
             AND date >= date('now', '-30 days')) as avg_daily_usage_30d,
          (SELECT AVG(daily_usage)
           FROM inventory_usage
           WHERE inventory_item_id = i.id
             AND date >= date('now', '-7 days')) as avg_daily_usage_7d,
          (SELECT SUM(daily_usage)
           FROM inventory_usage
           WHERE inventory_item_id = i.id
             AND date >= date('now', '-90 days')) as total_usage_90d
        FROM inventory_items i
        WHERE i.user_id = ? AND i.is_active = 1
      `).all(userId);
    } catch (error) {
      console.error('[ReorderEngine] Failed to fetch inventory items:', error.message);
      return [];
    }

    if (!items || items.length === 0) {
      console.log(`[ReorderEngine] No active inventory items for user ${userId}`);
      return [];
    }

    // Get price history for discount detection
    let priceHistory = [];
    try {
      priceHistory = database.prepare(`
        SELECT * FROM vendor_price_history
        WHERE user_id = ?
        ORDER BY created_at DESC
      `).all(userId);
    } catch (error) {
      console.warn('[ReorderEngine] Failed to fetch price history, continuing without discount detection:', error.message);
    }

    const priceMap = {};
    priceHistory.forEach(ph => {
      const key = `${ph.vendor_name}:${ph.sku}`;
      if (!priceMap[key]) priceMap[key] = [];
      priceMap[key].push(ph);
    });

    for (const item of items) {
      try {
        const itemRecs = await this.analyzeItem(item, priceMap, database);
        recommendations.push(...itemRecs);
      } catch (itemError) {
        console.error(`[ReorderEngine] Failed to analyze item ${item.id} (${item.sku}):`, itemError.message);
        // Continue with other items
      }
    }

    // Store recommendations
    try {
      this.storeRecommendations(userId, recommendations, database);
    } catch (storeError) {
      console.error('[ReorderEngine] Failed to store recommendations:', storeError.message);
      // Return recommendations anyway since they were computed
    }

    return recommendations;
  }

  /**
   * Analyze a single inventory item for recommendations
   */
  async analyzeItem(item, priceMap, database) {
    const recommendations = [];
    const today = new Date();
    const currentMonth = today.getMonth() + 1;

    // Calculate adjusted daily usage with seasonal factors
    const baseUsage = item.avg_daily_usage_30d || item.avg_daily_usage_7d || 0;
    const seasonalMultiplier = this.getSeasonalMultiplier(currentMonth, item.category);
    const adjustedDailyUsage = baseUsage * seasonalMultiplier;

    // Calculate days until stockout
    const daysUntilOut = adjustedDailyUsage > 0
      ? Math.floor(item.current_quantity / adjustedDailyUsage)
      : 999;

    // Get upcoming holidays in next 60 days
    const upcomingHolidays = this.getUpcomingHolidays(60);
    const holidayImpact = this.calculateHolidayImpact(upcomingHolidays, item.category);

    // 1. Critical stock warning
    if (daysUntilOut <= 7) {
      const runOutDate = this.addDays(today, daysUntilOut);
      recommendations.push({
        inventory_item_id: item.id,
        recommendation_type: 'urgent_reorder',
        priority: 'critical',
        title: `URGENT: ${item.product_name} will run out in ${daysUntilOut} days`,
        description: `Based on your current usage of ${baseUsage.toFixed(1)} units/day, you'll run out by ${this.formatDate(runOutDate)}. Order now to avoid stockout.`,
        suggested_quantity: Math.ceil(item.par_level || item.min_quantity * 2),
        potential_savings_cents: 0,
        reasoning: JSON.stringify({
          current_quantity: item.current_quantity,
          daily_usage: baseUsage,
          days_until_out: daysUntilOut,
          seasonal_adjustment: seasonalMultiplier
        })
      });
    }

    // 2. Supply duration projection (your specific example)
    if (daysUntilOut > 7 && daysUntilOut < 365) {
      const projectedOutDate = this.addDays(today, daysUntilOut);
      const projectedMonth = projectedOutDate.toLocaleString('default', { month: 'long', year: 'numeric' });

      recommendations.push({
        inventory_item_id: item.id,
        recommendation_type: 'supply_forecast',
        priority: 'low',
        title: `${item.product_name}: Supply lasts until ${projectedMonth}`,
        description: `Based on your usage trends (${baseUsage.toFixed(1)} units/day), you currently have enough ${item.sku} to make it to ${projectedMonth}. No reorder needed this week.`,
        suggested_quantity: 0,
        potential_savings_cents: 0,
        reasoning: JSON.stringify({
          current_quantity: item.current_quantity,
          daily_usage: baseUsage,
          projected_out_date: projectedOutDate.toISOString(),
          days_remaining: daysUntilOut
        })
      });
    }

    // 3. Discount detection (your specific example)
    const priceKey = `${item.vendor_name}:${item.sku}`;
    const prices = priceMap[priceKey] || [];

    if (prices.length >= 2) {
      const currentPrice = prices[0]?.unit_price_cents || item.last_unit_cost_cents;
      const avgHistoricalPrice = prices.slice(1).reduce((sum, p) => sum + p.unit_price_cents, 0) / (prices.length - 1);

      if (currentPrice < avgHistoricalPrice * 0.8) { // 20%+ discount
        const discountPct = Math.round((1 - currentPrice / avgHistoricalPrice) * 100);
        const savingsPerUnit = avgHistoricalPrice - currentPrice;

        // Calculate optimal buy quantity based on discount and usage
        const categoryInfo = this.categoryInsights[item.category?.toLowerCase()] || { shelfLife: 365 };
        const maxQuantityByShelfLife = Math.floor(categoryInfo.shelfLife * adjustedDailyUsage);
        const optimalQuantity = Math.min(maxQuantityByShelfLife, Math.ceil(adjustedDailyUsage * 180)); // 6 months max

        const totalSavings = savingsPerUnit * optimalQuantity;
        const newSupplyDays = Math.floor((item.current_quantity + optimalQuantity) / adjustedDailyUsage);
        const newSupplyDate = this.addDays(today, newSupplyDays);

        recommendations.push({
          inventory_item_id: item.id,
          recommendation_type: 'discount_opportunity',
          priority: 'high',
          title: `🔥 ${discountPct}% OFF: ${item.product_name} from ${item.vendor_name}`,
          description: `Your vendor is running ${item.sku} at a ${discountPct}% discount based on previous pricing trends. You have enough to make it until ${this.formatDate(this.addDays(today, daysUntilOut))}, but if you buy ${optimalQuantity} units now, you'll save $${(totalSavings / 100).toFixed(2)} and have enough supply to last until ${this.formatDate(newSupplyDate)} (based on usage trends).`,
          suggested_quantity: optimalQuantity,
          potential_savings_cents: totalSavings,
          expires_at: this.addDays(today, 14).toISOString(), // Assume discount valid 2 weeks
          reasoning: JSON.stringify({
            current_price_cents: currentPrice,
            avg_historical_price_cents: Math.round(avgHistoricalPrice),
            discount_percentage: discountPct,
            savings_per_unit_cents: savingsPerUnit,
            optimal_quantity: optimalQuantity,
            new_supply_duration_days: newSupplyDays,
            based_on_shelf_life: categoryInfo.shelfLife
          })
        });
      }
    }

    // 4. Holiday preparation recommendation
    if (upcomingHolidays.length > 0 && holidayImpact > 1.3) {
      const nextHoliday = upcomingHolidays[0];
      const daysToHoliday = this.daysBetween(today, new Date(today.getFullYear(), nextHoliday.month - 1, nextHoliday.day));
      const holidayDemand = adjustedDailyUsage * nextHoliday.multiplier;
      const additionalNeeded = Math.ceil((holidayDemand - adjustedDailyUsage) * nextHoliday.daysBeforeSpike);

      if (additionalNeeded > 0 && daysToHoliday <= 30) {
        recommendations.push({
          inventory_item_id: item.id,
          recommendation_type: 'holiday_prep',
          priority: 'medium',
          title: `${nextHoliday.name} Prep: Stock up on ${item.product_name}`,
          description: `${nextHoliday.name} is in ${daysToHoliday} days. Based on historical patterns, demand increases ${Math.round((nextHoliday.multiplier - 1) * 100)}%. Consider ordering ${additionalNeeded} extra units to avoid running low during the rush.`,
          suggested_quantity: additionalNeeded,
          potential_savings_cents: 0,
          expires_at: new Date(today.getFullYear(), nextHoliday.month - 1, nextHoliday.day).toISOString(),
          reasoning: JSON.stringify({
            holiday: nextHoliday.name,
            days_until: daysToHoliday,
            demand_multiplier: nextHoliday.multiplier,
            normal_daily_usage: adjustedDailyUsage,
            holiday_daily_usage: holidayDemand,
            additional_needed: additionalNeeded
          })
        });
      }
    }

    // 5. Bulk purchase opportunity (non-discount based)
    const categoryInfo = this.categoryInsights[item.category?.toLowerCase()];
    if (categoryInfo && categoryInfo.bulkDiscountThreshold > 0) {
      const currentOrderSize = item.par_level || item.min_quantity * 2;

      if (currentOrderSize < categoryInfo.bulkDiscountThreshold && daysUntilOut < 60) {
        const bulkQuantity = categoryInfo.bulkDiscountThreshold;
        const estimatedBulkDiscount = 0.10; // Assume 10% bulk discount
        const estimatedSavings = Math.round(item.last_unit_cost_cents * bulkQuantity * estimatedBulkDiscount);

        recommendations.push({
          inventory_item_id: item.id,
          recommendation_type: 'bulk_opportunity',
          priority: 'medium',
          title: `Bulk Savings: Order ${bulkQuantity}+ ${item.product_name}`,
          description: `Ordering ${bulkQuantity} or more units typically qualifies for bulk pricing. At your usage rate, this quantity would last ${Math.floor(bulkQuantity / adjustedDailyUsage)} days and could save approximately $${(estimatedSavings / 100).toFixed(2)}.`,
          suggested_quantity: bulkQuantity,
          potential_savings_cents: estimatedSavings,
          reasoning: JSON.stringify({
            current_order_size: currentOrderSize,
            bulk_threshold: categoryInfo.bulkDiscountThreshold,
            estimated_discount: estimatedBulkDiscount,
            days_supply: Math.floor(bulkQuantity / adjustedDailyUsage)
          })
        });
      }
    }

    // 6. Overstock warning
    const daysOfStock = adjustedDailyUsage > 0 ? item.current_quantity / adjustedDailyUsage : 999;
    const maxDaysOfStock = categoryInfo?.shelfLife || 365;

    if (daysOfStock > maxDaysOfStock * 0.8) {
      recommendations.push({
        inventory_item_id: item.id,
        recommendation_type: 'overstock_warning',
        priority: 'medium',
        title: `⚠️ Overstock Alert: ${item.product_name}`,
        description: `You have ${Math.round(daysOfStock)} days of supply, which exceeds recommended levels for ${item.category}. Consider reducing next order or running a promotion to move product before quality degrades.`,
        suggested_quantity: 0,
        potential_savings_cents: 0,
        reasoning: JSON.stringify({
          days_of_stock: Math.round(daysOfStock),
          max_recommended: maxDaysOfStock,
          shelf_life: categoryInfo?.shelfLife,
          waste_risk: daysOfStock > maxDaysOfStock ? 'high' : 'moderate'
        })
      });
    }

    // 7. Usage trend alert (increasing/decreasing)
    if (item.avg_daily_usage_7d && item.avg_daily_usage_30d) {
      const trendRatio = item.avg_daily_usage_7d / item.avg_daily_usage_30d;

      if (trendRatio > 1.3) { // Usage up 30%+
        const newDaysUntilOut = item.current_quantity / item.avg_daily_usage_7d;
        recommendations.push({
          inventory_item_id: item.id,
          recommendation_type: 'usage_spike',
          priority: 'high',
          title: `📈 Usage Spike: ${item.product_name} usage up ${Math.round((trendRatio - 1) * 100)}%`,
          description: `Your 7-day usage (${item.avg_daily_usage_7d.toFixed(1)}/day) is ${Math.round((trendRatio - 1) * 100)}% higher than your 30-day average. At this rate, you'll run out in ${Math.round(newDaysUntilOut)} days instead of ${daysUntilOut}. Consider ordering sooner.`,
          suggested_quantity: Math.ceil(item.par_level * 1.3 || item.min_quantity * 2.5),
          potential_savings_cents: 0,
          reasoning: JSON.stringify({
            usage_7d: item.avg_daily_usage_7d,
            usage_30d: item.avg_daily_usage_30d,
            trend_ratio: trendRatio,
            original_days_out: daysUntilOut,
            new_days_out: Math.round(newDaysUntilOut)
          })
        });
      } else if (trendRatio < 0.7) { // Usage down 30%+
        recommendations.push({
          inventory_item_id: item.id,
          recommendation_type: 'usage_drop',
          priority: 'low',
          title: `📉 Usage Drop: ${item.product_name} usage down ${Math.round((1 - trendRatio) * 100)}%`,
          description: `Your 7-day usage (${item.avg_daily_usage_7d.toFixed(1)}/day) is ${Math.round((1 - trendRatio) * 100)}% lower than your 30-day average. You can likely delay your next order. Current supply will last ${daysUntilOut} days at the lower rate.`,
          suggested_quantity: 0,
          potential_savings_cents: 0,
          reasoning: JSON.stringify({
            usage_7d: item.avg_daily_usage_7d,
            usage_30d: item.avg_daily_usage_30d,
            trend_ratio: trendRatio,
            extended_supply_days: daysUntilOut
          })
        });
      }
    }

    return recommendations;
  }

  /**
   * Store recommendations in database (transactional)
   */
  storeRecommendations(userId, recommendations, database) {
    // Use a transaction to ensure atomicity
    const transaction = database.transaction(() => {
      // Clear old recommendations for this user
      database.prepare(`
        DELETE FROM reorder_recommendations
        WHERE user_id = ? AND is_actioned = 0 AND is_dismissed = 0
      `).run(userId);

      if (recommendations.length === 0) {
        return;
      }

      const insertStmt = database.prepare(`
        INSERT INTO reorder_recommendations (
          user_id, inventory_item_id, recommendation_type, priority,
          title, description, suggested_quantity, potential_savings_cents,
          expires_at, reasoning
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const rec of recommendations) {
        try {
          insertStmt.run(
            userId,
            rec.inventory_item_id,
            rec.recommendation_type,
            rec.priority,
            rec.title,
            rec.description,
            rec.suggested_quantity,
            rec.potential_savings_cents || 0,
            rec.expires_at || null,
            rec.reasoning
          );
        } catch (insertError) {
          console.error(`[ReorderEngine] Failed to insert recommendation for item ${rec.inventory_item_id}:`, insertError.message);
          // Continue with other recommendations
        }
      }
    });

    try {
      transaction();
      console.log(`[ReorderEngine] Stored ${recommendations.length} recommendations for user ${userId}`);
    } catch (error) {
      console.error(`[ReorderEngine] Transaction failed for user ${userId}:`, error.message);
      throw error;
    }
  }

  /**
   * Get seasonal multiplier for a given month and category
   */
  getSeasonalMultiplier(month, category) {
    const baseMultiplier = this.seasonalFactors[month] || 1.0;
    const categoryInfo = this.categoryInsights[category?.toLowerCase()];

    if (categoryInfo?.seasonalPeak?.includes(month)) {
      return baseMultiplier * 1.15; // Extra boost for category peak season
    }

    return baseMultiplier;
  }

  /**
   * Get upcoming holidays within N days
   */
  getUpcomingHolidays(days) {
    const today = new Date();
    const endDate = this.addDays(today, days);
    const currentYear = today.getFullYear();

    return this.majorHolidays.filter(holiday => {
      const holidayDate = new Date(currentYear, holiday.month - 1, holiday.day);
      // Handle year-end wrap (e.g., checking in December for January holidays)
      if (holidayDate < today) {
        holidayDate.setFullYear(currentYear + 1);
      }
      return holidayDate >= today && holidayDate <= endDate;
    }).sort((a, b) => {
      const dateA = new Date(currentYear, a.month - 1, a.day);
      const dateB = new Date(currentYear, b.month - 1, b.day);
      return dateA - dateB;
    });
  }

  /**
   * Calculate combined holiday impact factor
   */
  calculateHolidayImpact(holidays, category) {
    if (holidays.length === 0) return 1.0;

    // Get max multiplier from upcoming holidays
    const maxMultiplier = Math.max(...holidays.map(h => h.multiplier));

    // Boost for alcohol-related categories during drinking holidays
    const boozeyHolidays = ['St Patricks Day', 'New Years Eve', 'Cinco de Mayo', 'July 4th', 'Super Bowl Sunday'];
    const isBoozeyHoliday = holidays.some(h => boozeyHolidays.includes(h.name));
    const isAlcoholCategory = ['spirits', 'wine', 'beer', 'mixers'].includes(category?.toLowerCase());

    if (isBoozeyHoliday && isAlcoholCategory) {
      return maxMultiplier * 1.2;
    }

    return maxMultiplier;
  }

  // Helper functions
  addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }

  daysBetween(date1, date2) {
    const oneDay = 24 * 60 * 60 * 1000;
    return Math.round((date2 - date1) / oneDay);
  }

  formatDate(date) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  /**
   * Quick summary of recommendations for a user
   */
  getSummary(userId) {
    const database = db.getDatabase();

    const summary = database.prepare(`
      SELECT
        priority,
        recommendation_type,
        COUNT(*) as count,
        SUM(potential_savings_cents) as total_savings_cents
      FROM reorder_recommendations
      WHERE user_id = ?
        AND is_dismissed = 0
        AND is_actioned = 0
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
      GROUP BY priority, recommendation_type
    `).all(userId);

    const totals = database.prepare(`
      SELECT
        COUNT(*) as total_recommendations,
        SUM(potential_savings_cents) as total_potential_savings,
        COUNT(CASE WHEN priority = 'critical' THEN 1 END) as critical_count,
        COUNT(CASE WHEN priority = 'high' THEN 1 END) as high_count
      FROM reorder_recommendations
      WHERE user_id = ?
        AND is_dismissed = 0
        AND is_actioned = 0
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
    `).get(userId);

    return { byType: summary, totals };
  }

  /**
   * Record usage for an inventory item (call this when processing invoices or manual entry)
   */
  recordUsage(inventoryItemId, quantity, date = null) {
    const database = db.getDatabase();

    const usageDate = date || new Date().toISOString().split('T')[0];

    // Upsert usage record
    database.prepare(`
      INSERT INTO inventory_usage (inventory_item_id, date, daily_usage)
      VALUES (?, ?, ?)
      ON CONFLICT(inventory_item_id, date) DO UPDATE SET
        daily_usage = daily_usage + excluded.daily_usage
    `).run(inventoryItemId, usageDate, quantity);

    // Update current quantity on inventory item
    database.prepare(`
      UPDATE inventory_items
      SET current_quantity = MAX(0, current_quantity - ?),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(quantity, inventoryItemId);
  }

  /**
   * Record a price observation (call when processing invoices)
   */
  recordPrice(userId, vendorName, sku, priceCents, quantity = 1, invoiceDate = null) {
    const database = db.getDatabase();
    const date = invoiceDate || new Date().toISOString().split('T')[0];

    database.prepare(`
      INSERT INTO vendor_price_history (
        user_id, vendor_name, sku, unit_price_cents, quantity, invoice_date, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(userId, vendorName, sku, priceCents, quantity, date);
  }
}

module.exports = ReorderEngine;

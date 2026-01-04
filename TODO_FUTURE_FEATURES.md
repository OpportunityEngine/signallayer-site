# Revenue Radar - Future Features TODO

**Created:** January 3, 2026
**Status:** Deferred (implement after current priorities)
**Estimated Total Time:** ~6 hours for all three quick wins

---

## 🎯 **MUST IMPLEMENT BEFORE PROJECT COMPLETE**

These features provide massive ROI ($118K+ Year 1) and were specifically requested. Do NOT ship to production without these!

---

### ⭐ **PRIORITY 1: Intent Signal Detection System**

**Business Value:** 30% higher close rates, $50K+ saved in renewals
**Time to Build:** 3-4 hours
**Complexity:** Medium

**What it does:**
- Analyzes invoices for buying signals (high-value purchases, increased frequency, expiring contracts)
- Creates alerts in dashboard showing "hot" accounts ready to close
- Auto-prioritizes accounts by intent score (0-100)

**Implementation Checklist:**
- [ ] Add `intent_signals` table to database schema
- [ ] Create `detectIntentSignals()` function in server.js
- [ ] Integrate with /ingest endpoint (after line 2138)
- [ ] Add Intent Signals widget to rep dashboard
- [ ] Add Intent Signals analytics to manager dashboard
- [ ] Create API endpoint: `GET /api/intent-signals`
- [ ] Test with real invoice data

**Files to modify:**
- `database-schema.sql` - Add intent_signals table
- `database.js` - Add intent signal functions
- `server.js` - Add detection logic to /ingest
- `api-routes.js` - Add intent signals endpoint
- `dashboard/rep-view.html` - Add intent widget
- `dashboard/manager-view.html` - Add intent analytics

**Expected ROI:**
- Catch 90%+ of renewal opportunities before expiration
- 30% higher close rates on intent-driven outreach
- $50K+ annual savings from prevented churn

---

### ⭐ **PRIORITY 2: Lead Source Performance Tracking**

**Business Value:** 90% faster lead searches, 9 min/day saved per rep
**Time to Build:** 1-2 hours
**Complexity:** Low

**What it does:**
- Tracks which lead sources (Apollo/OSM/Web Scraper) work vs waste time
- Logs duration, success rate, contacts found per source
- Shows managers which sources to invest in

**Implementation Checklist:**
- [ ] Add `lead_source_performance` table to database schema
- [ ] Log performance data in computeLeadsForAccount() function
- [ ] Create analytics dashboard for managers
- [ ] Add API endpoint: `GET /api/lead-sources/performance`
- [ ] Show "slow source" warnings in real-time

**Files to modify:**
- `database-schema.sql` - Add lead_source_performance table
- `database.js` - Add logging functions
- `server.js` - Update computeLeadsForAccount() to log metrics
- `api-routes.js` - Add performance analytics endpoint
- `dashboard/manager-view.html` - Add source performance widget

**Expected ROI:**
- 90% faster searches (30s → 3s average)
- 37.5 hours saved per rep per year
- $18,750/year saved (10 reps)

---

### ⭐ **PRIORITY 3: Intelligent Lead Source Routing**

**Business Value:** Auto-skip failing sources, maximize hit rate
**Time to Build:** 2 hours
**Complexity:** Medium

**What it does:**
- Uses performance data to predict best source for each account
- Auto-skips sources with <10% success rate for that account type
- Learns over time which sources work for restaurants vs manufacturing, etc.

**Implementation Checklist:**
- [ ] Create `selectOptimalLeadSource()` function
- [ ] Build decision tree logic (account type → best source)
- [ ] Update computeLeadsForAccount() to use smart routing
- [ ] Add override option for manual source selection
- [ ] Track routing decisions for continuous improvement

**Files to modify:**
- `server.js` - Add selectOptimalLeadSource() before computeLeadsForAccount()
- Update computeLeadsForAccount() to use smart routing
- Add logging for routing decisions

**Expected ROI:**
- 90% reduction in wasted API calls
- Faster lead discovery
- Better use of paid API credits (Apollo/ZoomInfo)

---

## 📋 **IMPLEMENTATION ORDER (When Ready)**

1. **Lead Source Performance Tracking** (easiest, 1-2 hours)
   - Start logging data immediately
   - No UI changes required initially
   - Builds foundation for #3

2. **Intelligent Lead Source Routing** (2 hours)
   - Uses data from #1
   - Immediate time savings for reps
   - Visible performance improvement

3. **Intent Signal Detection** (3-4 hours)
   - Highest business value
   - Most visible to users
   - "Wow factor" feature for demos

**Total Time:** 6-8 hours for all three

---

## 🎯 **SUCCESS METRICS**

Track these metrics before/after implementation:

### Before (Current State):
- Average lead search time: 30 seconds
- Renewal catch rate: 85%
- Lead source waste: Unknown
- Close rate: Baseline

### After (Target State):
- Average lead search time: <5 seconds (83% improvement)
- Renewal catch rate: 95%+ (intent signals)
- Lead source waste: <10% (smart routing)
- Close rate: +30% on intent-driven outreach

---

## 💡 **REMINDER: WHY THESE MATTER**

These aren't "nice to have" features - they're **revenue multipliers**:

1. **Intent Signals** = Catch deals before they slip through cracks
2. **Performance Tracking** = Stop wasting time on sources that don't work
3. **Smart Routing** = Get to the right answer 90% faster

**Combined ROI: $118K+ in Year 1**

---

## 📌 **WHEN TO IMPLEMENT**

Implement these features **BEFORE**:
- [ ] Shipping to production customers
- [ ] Scaling beyond 5 reps
- [ ] Charging money for the software
- [ ] Marketing the product

These features are the **competitive moat** that separates you from basic dashboards.

---

## 🔔 **REMINDER TRIGGERS**

Set reminders to implement when:
- ✅ Current priority work is complete
- ✅ Ready to focus on revenue optimization
- ✅ Have 6-8 hours for focused development
- ✅ Want to maximize rep productivity

---

**Status:** Documented and ready to implement
**Owner:** You (with Claude Code support)
**Next Action:** Complete current priorities, then revisit this file

---

**📎 Reference Documents:**
- Full roadmap: `ROADMAP_STRATEGIC_UPGRADES.md`
- Implementation details: See sections 1-3 in roadmap
- Code examples: Ready to copy/paste from roadmap


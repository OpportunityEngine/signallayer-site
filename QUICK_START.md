# Revenue Radar - Quick Start Guide

## 🚀 Start the Server

```bash
npm start
```

Server will run on: **http://localhost:5050**

---

## 📱 Access Dashboards

- **Rep Dashboard:** http://localhost:5050/rep-view.html
- **Manager Dashboard:** http://localhost:5050/manager-view.html

---

## 🧪 Test API Endpoints

### 1. Check Server Health
```bash
curl http://localhost:5050/health
```

### 2. Get Active SPIFs
```bash
curl http://localhost:5050/api/spifs/active
```

### 3. Get SPIF Leaderboard
```bash
curl http://localhost:5050/api/spifs/1/leaderboard
```

### 4. Record MLA Review (Increments SPIF)
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "x-user-email: you@demo.com" \
  -d '{"action": "analyzed", "notes": "Reviewed contract"}' \
  http://localhost:5050/api/mlas/1/review
```

### 5. Get Your Opportunities
```bash
curl -H "x-user-email: you@demo.com" \
  http://localhost:5050/api/opportunities
```

### 6. Get Dashboard Summary
```bash
curl -H "x-user-email: you@demo.com" \
  http://localhost:5050/api/dashboard/rep-summary
```

### 7. Check Demo Mode Status
```bash
curl -H "x-user-email: you@demo.com" \
  http://localhost:5050/api/demo/status
```

---

## 📊 Current Demo Data

**Users:**
- john@demo.com (34 MLAs reviewed - Rank 1)
- sarah@demo.com (31 MLAs reviewed - Rank 2)
- you@demo.com (28 MLAs reviewed - Rank 3)
- manager@demo.com (Manager)

**Active SPIF:**
- "Most MLAs Reviewed This Week"
- Prize: $100 (10000 cents)
- Top 3 winners

**Opportunities:**
1. Bella's Italian Kitchen - MLA Renewal - Critical Urgency
2. Sunset Bistro - MLA Renewal - High Urgency
3. Downtown Diner - Equipment Upgrade - Medium Urgency

---

## 🔄 Reset Database

```bash
./setup-revenue-radar.sh
```

This will:
1. Reinstall dependencies (if needed)
2. Reset database with demo data
3. Verify setup
4. Show next steps

---

## 📚 Documentation

- **INTEGRATION_COMPLETE.md** - Full integration summary
- **REVENUE_RADAR_ARCHITECTURE.md** - System architecture
- **SERVER_INTEGRATION.md** - Integration details
- **database-schema.sql** - Database structure

---

## 💡 Quick Tips

1. **Toggle Demo Mode:**
   ```javascript
   // In browser console on dashboard
   window.RevenueRadarAPI.toggleDemoMode(false); // Production mode
   window.RevenueRadarAPI.toggleDemoMode(true);  // Demo mode
   ```

2. **Watch Server Logs:**
   ```bash
   npm start
   # Look for lines with [REVENUE RADAR] prefix
   ```

3. **Check Database:**
   ```bash
   sqlite3 revenue-radar.db "SELECT * FROM spif_standings;"
   ```

---

## ✅ What Works

- ✅ Real-time SPIF leaderboards
- ✅ Automatic opportunity detection
- ✅ MLA review tracking
- ✅ Commission forecasting
- ✅ Demo/production mode toggle
- ✅ Live dashboard updates
- ✅ Invoice ingestion tracking
- ✅ Telemetry event logging

---

**Server Running?** Check: http://localhost:5050/health

**Need Help?** See INTEGRATION_COMPLETE.md for detailed docs.

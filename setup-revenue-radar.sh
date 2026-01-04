#!/bin/bash

# Revenue Radar Setup Script
# Automates the complete setup process

set -e  # Exit on error

echo "🚀 Revenue Radar - Automated Setup"
echo "=================================="
echo ""

# Check if we're in the right directory
if [ ! -f "server.js" ]; then
    echo "❌ Error: Please run this script from the ai-sales-backend directory"
    exit 1
fi

# Step 1: Install dependencies
echo "📦 Step 1/5: Installing dependencies..."
if [ ! -d "node_modules" ]; then
    npm install
    echo "✅ Dependencies installed"
else
    echo "✅ Dependencies already installed"
fi
echo ""

# Step 2: Initialize database
echo "💾 Step 2/5: Initializing database..."
if [ -f "revenue-radar.db" ]; then
    read -p "Database already exists. Reset it? (y/N): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm revenue-radar.db revenue-radar.db-shm revenue-radar.db-wal 2>/dev/null || true
        node -e "require('./database').initDatabase()"
        echo "✅ Database reset and initialized with demo data"
    else
        echo "✅ Using existing database"
    fi
else
    node -e "require('./database').initDatabase()"
    echo "✅ Database created with demo data"
fi
echo ""

# Step 3: Check database contents
echo "🔍 Step 3/5: Verifying database setup..."
USER_COUNT=$(sqlite3 revenue-radar.db "SELECT COUNT(*) FROM users;")
SPIF_COUNT=$(sqlite3 revenue-radar.db "SELECT COUNT(*) FROM spifs WHERE status='active';")
OPP_COUNT=$(sqlite3 revenue-radar.db "SELECT COUNT(*) FROM opportunities;")

echo "   Users: $USER_COUNT"
echo "   Active SPIFs: $SPIF_COUNT"
echo "   Opportunities: $OPP_COUNT"
echo "✅ Database verified"
echo ""

# Step 4: Create .env if it doesn't exist
echo "⚙️  Step 4/5: Configuring environment..."
if [ ! -f ".env" ]; then
    cat > .env << 'EOF'
# Revenue Radar Configuration
PORT=5050
DB_PATH=./revenue-radar.db

# API Keys (optional - uncomment and add your keys)
# APOLLO_API_KEY=your_apollo_key_here

# Cache TTL
LEADS_CACHE_TTL_MS=86400000
OSM_CACHE_TTL_MS=86400000

# Analytics
ANALYTICS_CACHE_MINUTES=15
EOF
    echo "✅ .env file created"
else
    echo "✅ .env file exists"
fi
echo ""

# Step 5: Display next steps
echo "✅ Setup Complete!"
echo ""
echo "📋 Next Steps:"
echo "=============="
echo ""
echo "1. INTEGRATE API ROUTES INTO server.js"
echo "   Follow instructions in SERVER_INTEGRATION.md"
echo "   Key changes:"
echo "     - Add database initialization"
echo "     - Mount API routes"
echo "     - Update /ingest endpoint"
echo "     - Update /telemetry endpoint"
echo ""
echo "2. START THE SERVER"
echo "   npm start"
echo ""
echo "3. TEST API ENDPOINTS"
echo "   curl http://localhost:5050/api/spifs/active"
echo "   curl -H 'x-user-email: you@demo.com' http://localhost:5050/api/dashboard/rep-summary"
echo ""
echo "4. OPEN DASHBOARDS"
echo "   Rep Dashboard:     http://localhost:5050/rep-view.html"
echo "   Manager Dashboard: http://localhost:5050/manager-view.html"
echo ""
echo "5. TEST END-TO-END FLOW"
echo "   - Upload an invoice via browser extension"
echo "   - Review the MLA in the extension"
echo "   - Check SPIF standings update in dashboard"
echo ""
echo "📚 Documentation:"
echo "   - Architecture: REVENUE_RADAR_ARCHITECTURE.md"
echo "   - Integration:  SERVER_INTEGRATION.md"
echo "   - Database:     database-schema.sql"
echo ""
echo "🎯 Demo Mode:"
echo "   Dashboards start in DEMO mode by default"
echo "   Toggle: window.RevenueRadarAPI.toggleDemoMode()"
echo "   Query:  ?demo=1 or ?demo=0 in URL"
echo ""
echo "Happy selling! 💰"

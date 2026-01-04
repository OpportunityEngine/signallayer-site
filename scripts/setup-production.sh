#!/bin/bash

# =====================================================
# PRODUCTION SETUP SCRIPT
# =====================================================
# Automated production environment setup
# Usage: ./scripts/setup-production.sh
# =====================================================

set -e  # Exit on error

echo ""
echo "========================================"
echo "  REVENUE RADAR - PRODUCTION SETUP"
echo "========================================"
echo ""

# Check if running as root
if [ "$EUID" -eq 0 ]; then
   echo "❌ Please do not run this script as root"
   exit 1
fi

# 1. Check Node.js installation
echo "📋 Checking prerequisites..."
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed"
    echo "   Install Node.js 18+ and try again"
    exit 1
fi

NODE_VERSION=$(node -v)
echo "   ✅ Node.js $NODE_VERSION installed"

# 2. Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install --production

# 3. Create directories
echo ""
echo "📁 Creating directories..."
mkdir -p backups
mkdir -p logs
mkdir -p uploads

chmod 700 backups
chmod 755 logs
chmod 755 uploads

echo "   ✅ Directories created"

# 4. Environment configuration
echo ""
echo "⚙️  Setting up environment..."

if [ ! -f .env ]; then
    cp .env.example .env
    echo "   ✅ Created .env file from template"
    echo ""
    echo "   ⚠️  IMPORTANT: Edit .env file with your configuration:"
    echo "      - Set JWT_SECRET (run: node scripts/generate-jwt-secret.js)"
    echo "      - Set ANTHROPIC_API_KEY"
    echo "      - Set NODE_ENV=production"
    echo "      - Configure SSL certificate paths"
    echo "      - Set ALLOWED_ORIGINS to your domain"
    echo ""
    read -p "   Press Enter after you've configured .env..."
else
    echo "   ℹ️  .env file already exists"
fi

# 5. Generate JWT secret if not set
echo ""
echo "🔐 Checking JWT secret..."

if grep -q "CHANGE_THIS_IN_PRODUCTION" .env; then
    echo "   Generating new JWT secret..."
    JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")

    # Update .env file (macOS compatible)
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s/JWT_SECRET=.*/JWT_SECRET=$JWT_SECRET/" .env
    else
        sed -i "s/JWT_SECRET=.*/JWT_SECRET=$JWT_SECRET/" .env
    fi

    echo "   ✅ JWT secret generated and saved to .env"
else
    echo "   ✅ JWT secret already configured"
fi

# 6. Initialize database
echo ""
echo "💾 Initializing database..."

if [ ! -f revenue-radar.db ]; then
    node database.js
    echo "   ✅ Database initialized"
else
    echo "   ℹ️  Database already exists"
fi

# 7. Create admin user
echo ""
echo "👤 Creating admin user..."
echo "   (Skip if admin already exists)"
echo ""

node scripts/create-admin.js

# 8. Create initial backup
echo ""
echo "💿 Creating initial backup..."
node scripts/backup-now.js

# 9. Run health check
echo ""
echo "🏥 Running health check..."
node scripts/check-health.js

# 10. PM2 setup (optional)
echo ""
read -p "Do you want to set up PM2 for process management? (y/n) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    if ! command -v pm2 &> /dev/null; then
        echo "   Installing PM2..."
        sudo npm install -g pm2
    fi

    echo "   Starting application with PM2..."
    pm2 start server.js --name revenue-radar

    echo "   Setting up auto-start..."
    pm2 startup

    echo ""
    echo "   ⚠️  Run the command shown above to enable auto-start"
    echo "   Then run: pm2 save"
    echo ""
fi

# 11. Final instructions
echo ""
echo "========================================"
echo "  ✅ SETUP COMPLETE"
echo "========================================"
echo ""
echo "Next steps:"
echo ""
echo "1. Review and update .env configuration"
echo "2. Set up SSL certificates (see HTTPS_SSL_SETUP.md)"
echo "3. Configure Nginx reverse proxy (recommended)"
echo "4. Set up firewall rules"
echo "5. Configure monitoring and alerts"
echo "6. Review DEPLOYMENT_CHECKLIST.md"
echo ""
echo "To start the server:"
echo "  Development: npm start"
echo "  Production:  pm2 start revenue-radar"
echo ""
echo "Check health: node scripts/check-health.js"
echo "View backups: node scripts/list-backups.js"
echo ""
echo "========================================"
echo ""

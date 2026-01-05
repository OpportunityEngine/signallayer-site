#!/bin/bash
# =====================================================
# PRODUCTION DEPLOYMENT SCRIPT
# Deploy Revenue Radar to DigitalOcean
# =====================================================

set -e  # Exit on any error

echo "🚀 Starting Production Deployment..."
echo ""

# Color codes for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuration (UPDATE THESE WITH YOUR SERVER DETAILS)
SERVER_USER="${DEPLOY_USER:-root}"  # Change to your SSH username
SERVER_HOST="${DEPLOY_HOST}"        # Your DigitalOcean droplet IP or domain
APP_DIR="${DEPLOY_DIR:-/var/www/revenue-radar}"  # Path on server
APP_NAME="revenue-radar"

# Validate configuration
if [ -z "$SERVER_HOST" ]; then
  echo -e "${RED}❌ Error: DEPLOY_HOST not set${NC}"
  echo ""
  echo "Please set your DigitalOcean server details:"
  echo "  export DEPLOY_HOST='your-server-ip-or-domain'"
  echo "  export DEPLOY_USER='root'  # or your SSH username"
  echo "  export DEPLOY_DIR='/var/www/revenue-radar'  # optional"
  echo ""
  echo "Then run: ./deploy-to-production.sh"
  exit 1
fi

echo -e "${BLUE}📋 Deployment Configuration:${NC}"
echo "  Server: $SERVER_USER@$SERVER_HOST"
echo "  App Directory: $APP_DIR"
echo "  App Name: $APP_NAME"
echo ""

# Step 1: Test SSH connection
echo -e "${BLUE}1/6 Testing SSH connection...${NC}"
if ssh -o ConnectTimeout=10 "$SERVER_USER@$SERVER_HOST" "echo 'SSH connection successful'" 2>/dev/null; then
  echo -e "${GREEN}✓ SSH connection verified${NC}"
else
  echo -e "${RED}❌ SSH connection failed${NC}"
  echo "Please ensure:"
  echo "  1. Your SSH key is added to the server"
  echo "  2. The server IP/domain is correct"
  echo "  3. The username is correct"
  exit 1
fi
echo ""

# Step 2: Pull latest code from GitHub on server
echo -e "${BLUE}2/6 Pulling latest code from GitHub...${NC}"
ssh "$SERVER_USER@$SERVER_HOST" << 'ENDSSH'
  cd $APP_DIR
  echo "Current directory: $(pwd)"
  git fetch origin
  git pull origin main
  echo "✓ Code updated from GitHub"
ENDSSH
echo -e "${GREEN}✓ Latest code pulled${NC}"
echo ""

# Step 3: Install dependencies
echo -e "${BLUE}3/6 Installing dependencies...${NC}"
ssh "$SERVER_USER@$SERVER_HOST" << 'ENDSSH'
  cd $APP_DIR
  npm install --production
  echo "✓ Dependencies installed"
ENDSSH
echo -e "${GREEN}✓ Dependencies installed${NC}"
echo ""

# Step 4: Run database migrations (if any)
echo -e "${BLUE}4/6 Checking database...${NC}"
ssh "$SERVER_USER@$SERVER_HOST" << 'ENDSSH'
  cd $APP_DIR
  # Database is SQLite, no migrations needed
  if [ -f revenue-radar.db ]; then
    echo "✓ Database exists"
  else
    echo "⚠ Database will be created on first run"
  fi
ENDSSH
echo -e "${GREEN}✓ Database check complete${NC}"
echo ""

# Step 5: Restart the application
echo -e "${BLUE}5/6 Restarting application...${NC}"
ssh "$SERVER_USER@$SERVER_HOST" << 'ENDSSH'
  cd $APP_DIR

  # Try PM2 first (most common)
  if command -v pm2 &> /dev/null; then
    echo "Using PM2 to restart..."
    pm2 restart revenue-radar || pm2 start server.js --name revenue-radar
    pm2 save
    echo "✓ Application restarted with PM2"

  # Try systemd
  elif systemctl is-active --quiet revenue-radar; then
    echo "Using systemd to restart..."
    sudo systemctl restart revenue-radar
    echo "✓ Application restarted with systemd"

  # Manual restart
  else
    echo "⚠ No process manager found. Please restart manually:"
    echo "  cd $APP_DIR"
    echo "  pm2 restart revenue-radar"
    echo "  # OR"
    echo "  systemctl restart revenue-radar"
  fi
ENDSSH
echo -e "${GREEN}✓ Application restarted${NC}"
echo ""

# Step 6: Verify deployment
echo -e "${BLUE}6/6 Verifying deployment...${NC}"
sleep 3  # Wait for app to start

# Test health endpoint
if curl -f -s -o /dev/null "http://$SERVER_HOST:5050/dashboard/login.html"; then
  echo -e "${GREEN}✓ Application is responding${NC}"
else
  echo -e "${RED}⚠ Could not verify application - please check manually${NC}"
fi
echo ""

echo -e "${GREEN}🎉 Deployment Complete!${NC}"
echo ""
echo "Next steps:"
echo "  1. Visit your app: http://$SERVER_HOST/dashboard/login.html"
echo "  2. Login with: admin@revenueradar.com / ChangeMe123!"
echo "  3. Test the Admin tab - it should work without redirects now!"
echo ""
echo "If you encounter issues:"
echo "  - Check logs: ssh $SERVER_USER@$SERVER_HOST 'pm2 logs revenue-radar'"
echo "  - Check status: ssh $SERVER_USER@$SERVER_HOST 'pm2 status'"
echo ""

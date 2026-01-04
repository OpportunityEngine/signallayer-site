#!/bin/bash

# =====================================================
# PUSH TO EXISTING GITHUB REPOSITORY
# =====================================================
# Use this script when you already have a GitHub repo

set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  📦 Push to Existing GitHub Repository"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Get repository URL from user
if [ -z "$1" ]; then
    echo "Please enter your GitHub repository URL:"
    echo "Example: https://github.com/YourUsername/signallayer-site.git"
    echo ""
    read -p "Repository URL: " REPO_URL
else
    REPO_URL="$1"
fi

if [ -z "$REPO_URL" ]; then
    echo "❌ Repository URL cannot be empty"
    exit 1
fi

echo ""
echo "📝 Repository: $REPO_URL"
echo ""

# Remove existing remote if it exists
git remote remove origin 2>/dev/null || true

# Add new remote
echo "📝 Adding remote repository..."
git remote add origin "$REPO_URL"
echo "✅ Remote added"
echo ""

# Configure Git user if not already set
if ! git config user.email &> /dev/null; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  👤 Git Configuration"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    read -p "Enter your name for Git commits: " GIT_NAME
    read -p "Enter your email for Git commits: " GIT_EMAIL

    git config user.name "$GIT_NAME"
    git config user.email "$GIT_EMAIL"

    echo "✅ Git user configured"
    echo ""
fi

# Add all files
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  📤 Preparing Commit"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

git add .

# Create commit
echo "Creating commit..."
git commit -m "Complete Revenue Radar deployment setup

✨ Production-Ready Features:
- Email Invoice Autopilot with AI processing
- Revenue Dashboard for reps
- Manager Dashboard with team analytics
- SKU Opportunity Rules engine
- Admin Operations panel
- User Management system
- Complete Authentication (JWT, sessions, rate limiting)
- Health Monitoring endpoints
- Automated Database Backups (12hr intervals)
- Web Scraper for business intelligence
- Lead Discovery with location enrichment

🚀 Deployment Ready:
- DigitalOcean App Platform configuration
- Production environment setup
- GitHub auto-deployment ready
- HTTPS/SSL configured
- Complete documentation

📚 Guides Included:
- Quick Start (30-min deployment)
- Full Deployment Guide
- Domain Setup Guide
- Authentication docs
- API documentation

💰 Cost: \$12/month on DigitalOcean

🎯 Ready to deploy and share with customers!
" || echo "⚠️  Files already committed or no changes"

echo ""
echo "✅ Changes committed"
echo ""

# Set main branch
git branch -M main

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🚀 Pushing to GitHub"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Fetch first to check if repo has existing commits
echo "Checking remote repository..."
git fetch origin main 2>/dev/null || echo "Note: Remote main branch doesn't exist yet, will create it"

# Try to pull with rebase if remote exists
if git rev-parse origin/main >/dev/null 2>&1; then
    echo ""
    echo "⚠️  Remote repository has existing commits."
    echo ""
    read -p "Do you want to merge remote changes? (y/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Pulling remote changes..."
        git pull origin main --rebase --allow-unrelated-histories || {
            echo ""
            echo "⚠️  Merge conflict detected!"
            echo "Please resolve conflicts manually, then run:"
            echo "  git add ."
            echo "  git rebase --continue"
            echo "  git push -u origin main"
            exit 1
        }
    fi
fi

echo ""
echo "Pushing to GitHub..."
git push -u origin main || {
    echo ""
    echo "⚠️  Push failed. This might be because:"
    echo "  1. Remote has changes you don't have (run: git pull origin main --rebase)"
    echo "  2. You don't have permission (check repository access)"
    echo "  3. Branch protection is enabled"
    echo ""
    read -p "Do you want to force push? (only if you're sure!) (y/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        git push -u origin main --force
    else
        exit 1
    fi
}

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ SUCCESS!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Your code is now on GitHub! 🎉"
echo ""
echo "Repository: $REPO_URL"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  📋 Next Steps"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "1. Go to DigitalOcean: https://cloud.digitalocean.com/"
echo "2. Create → Apps → GitHub"
echo "3. Select your repository: signallayer-site"
echo "4. Follow: QUICK_START_DEPLOYMENT.md (Step 2 onwards)"
echo ""
echo "Your app will be live in ~10 minutes!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

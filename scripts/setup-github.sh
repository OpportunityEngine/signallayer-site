#!/bin/bash

# =====================================================
# GITHUB REPOSITORY SETUP SCRIPT
# =====================================================
# This script initializes Git and helps you push to GitHub

set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  📦 Revenue Radar - GitHub Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if git is installed
if ! command -v git &> /dev/null; then
    echo "❌ Git is not installed. Please install Git first:"
    echo "   https://git-scm.com/downloads"
    exit 1
fi

echo "✅ Git is installed"
echo ""

# Check if already a git repository
if [ -d ".git" ]; then
    echo "⚠️  This directory is already a Git repository"
    echo ""
    read -p "Do you want to continue anyway? (y/n) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 0
    fi
else
    echo "📝 Initializing Git repository..."
    git init
    echo "✅ Git repository initialized"
    echo ""
fi

# Create .gitignore if it doesn't exist
if [ ! -f ".gitignore" ]; then
    echo "⚠️  .gitignore file not found (it should have been created)"
    exit 1
fi

echo "✅ .gitignore file exists"
echo ""

# Ask for GitHub repository URL
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  📋 GitHub Repository Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Please follow these steps:"
echo ""
echo "1. Go to https://github.com/new"
echo "2. Repository name: revenue-radar (or your choice)"
echo "3. Make it PRIVATE (important for security)"
echo "4. Do NOT initialize with README"
echo "5. Click 'Create repository'"
echo ""
echo "After creating, copy the repository URL"
echo "It looks like: https://github.com/YOUR_USERNAME/revenue-radar.git"
echo ""

read -p "Enter your GitHub repository URL: " REPO_URL

if [ -z "$REPO_URL" ]; then
    echo "❌ Repository URL cannot be empty"
    exit 1
fi

echo ""
echo "📝 Setting up remote repository..."

# Remove existing remote if it exists
git remote remove origin 2>/dev/null || true

# Add new remote
git remote add origin "$REPO_URL"

echo "✅ Remote repository added"
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

# Create initial commit
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  📤 Creating Initial Commit"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Add all files
git add .

# Create commit
git commit -m "Initial commit - Revenue Radar AI Sales Backend

✨ Features:
- Email Invoice Autopilot
- Revenue Dashboard
- Manager Dashboard
- SKU Opportunity Rules
- Admin Operations
- User Management
- Authentication System
- Health Monitoring
- Automated Backups
- Web Scraper
- Lead Intelligence

🎯 Ready for production deployment
" || echo "⚠️  Files already committed"

echo ""
echo "✅ Files committed to Git"
echo ""

# Set main branch
git branch -M main

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🚀 Pushing to GitHub"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Push to GitHub
echo "Pushing to GitHub..."
git push -u origin main

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
echo "1. Open the DEPLOYMENT_GUIDE.md file"
echo "2. Follow the DigitalOcean deployment steps"
echo "3. Your app will be live in ~10 minutes!"
echo ""
echo "To make updates later:"
echo "  git add ."
echo "  git commit -m \"Your update message\""
echo "  git push"
echo ""
echo "DigitalOcean will automatically redeploy! 🚀"
echo ""

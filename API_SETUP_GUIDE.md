# Premium API Setup Guide for Lead Discovery

This guide shows you how to set up premium APIs to get **incredibly accurate contact information** with names, emails, and phone numbers.

## Why Use Premium APIs?

Without these APIs, the system can only scrape basic directories (BBB, Yellow Pages) which typically only have:
- ❌ Generic "Main Line" labels
- ❌ Company phone numbers (no direct contacts)
- ❌ No employee names
- ❌ No email addresses

**With premium APIs enabled**, you get:
- ✅ **Real employee names** (e.g., "John Smith - Plant Manager")
- ✅ **Direct phone numbers** and mobile numbers
- ✅ **Verified email addresses** (e.g., john.smith@perduefarms.com)
- ✅ **Job titles** for targeting decision-makers
- ✅ **90%+ confidence scores** on contact accuracy

---

## Quick Start (Recommended Setup)

For the **best results and most impressive demos**, set up all three APIs:

### 1. RocketReach API (🌟 HIGHEST PRIORITY)
**Best for:** Finding verified employees with phone numbers + emails

**Cost:** Starts at $39/month for 170 lookups
- **Free trial:** 5 free lookups to test
- **ROI:** Each lookup can return 5-10 contacts per company

**Setup:**
1. Go to https://rocketreach.co/
2. Sign up for an account
3. Go to https://rocketreach.co/api
4. Click "Get API Key"
5. Copy your API key
6. Add to `.env` file:
   ```
   ROCKETREACH_API_KEY=your_actual_key_here
   ```

**What you get:**
- First name, last name, full job title
- Direct phone numbers (not just main lines!)
- Verified email addresses
- LinkedIn profile URLs
- Current employer verification

---

### 2. Hunter.io API (🌟 HIGH PRIORITY)
**Best for:** Finding email addresses by company domain

**Cost:** FREE tier includes 25 searches/month
- **Paid:** $49/month for 500 searches
- **Perfect for:** Email verification and pattern discovery

**Setup:**
1. Go to https://hunter.io/users/sign_up
2. Create a free account
3. Go to https://hunter.io/api_keys
4. Copy your API key
5. Add to `.env` file:
   ```
   HUNTER_IO_API_KEY=your_actual_key_here
   ```

**What you get:**
- All employee emails at a company domain
- Email confidence scores (0-100%)
- Common email patterns (first.last@, flast@, etc.)
- Phone numbers when available
- Job titles and departments

---

### 3. Google Custom Search API (💡 RECOMMENDED)
**Best for:** Finding LinkedIn profiles and company contact pages (better than Bing scraping)

**Cost:** FREE for 100 searches/day
- **Paid:** $5 per 1,000 additional queries

**Setup:**

**Step 1: Create a Custom Search Engine**
1. Go to https://programmablesearchengine.google.com/
2. Click "Add"
3. Under "Sites to search", enter: `www.linkedin.com/*`
4. Name it "LinkedIn Profile Finder"
5. Click "Create"
6. Copy the **Search Engine ID** (looks like: `a1b2c3d4e5f6g7h8i`)

**Step 2: Get API Key**
1. Go to https://console.cloud.google.com/
2. Create a new project (or select existing)
3. Go to "APIs & Services" → "Credentials"
4. Click "Create Credentials" → "API Key"
5. Copy your API key

**Step 3: Enable Custom Search API**
1. Go to https://console.cloud.google.com/apis/library
2. Search for "Custom Search API"
3. Click "Enable"

**Step 4: Add to .env**
```
GOOGLE_CUSTOM_SEARCH_API_KEY=your_api_key_here
GOOGLE_CUSTOM_SEARCH_ENGINE_ID=your_search_engine_id_here
```

**What you get:**
- More reliable LinkedIn profile discovery
- Company website contact pages
- Facility-specific search results
- Better than Bing web scraping (which often gets blocked)

---

## Budget-Friendly Recommendations

### If you can only afford ONE API:
**Choose: Hunter.io ($0 - FREE TIER)**
- 25 free searches per month
- Perfect for small volume demos
- Great email discovery

### If you can afford TWO APIs:
**Choose: Hunter.io + RocketReach ($39/month)**
- Hunter.io finds emails by domain
- RocketReach finds the actual people with phones
- Best bang for buck

### For maximum accuracy (customer demos):
**All three: RocketReach + Hunter.io + Google Custom Search (~$90/month)**
- This gives you the most impressive results
- Customers will be blown away by the accuracy
- You'll have names, emails, phones, and job titles for almost every facility

---

## How The System Works With APIs

The system now uses a **waterfall strategy**:

```
┌─────────────────────────────────────────────┐
│ TIER 1: ZoomInfo CSV                        │ ← Your existing data
└─────────────────────────────────────────────┘
                  ↓ (if no match)
┌─────────────────────────────────────────────┐
│ TIER 2: Google Places API                   │ ← Address-based
└─────────────────────────────────────────────┘
                  ↓ (if no match)
┌─────────────────────────────────────────────┐
│ TIER 3: OpenStreetMap                       │ ← Address-based
└─────────────────────────────────────────────┘
                  ↓ (if no match)
┌─────────────────────────────────────────────┐
│ TIER 4: Web Scraper - ENHANCED              │
│                                             │
│  Step 0: Premium APIs (NEW! 🌟)             │
│    ├─ RocketReach API (employees)          │
│    └─ Hunter.io API (emails)                │
│                                             │
│  Step 1: Company Website Scraping          │
│    └─ Uses Google Custom Search (NEW!)     │
│                                             │
│  Step 2: LinkedIn Profile Discovery         │
│    ├─ Google Custom Search (NEW!)          │
│    └─ Bing scraping (fallback)             │
│                                             │
│  Step 3: Directory Scraping                │
│    ├─ Yellow Pages                         │
│    ├─ BBB                                  │
│    └─ Yelp                                 │
└─────────────────────────────────────────────┘
```

---

## Testing Your Setup

After adding API keys to your `.env` file:

1. **Restart the backend:**
   ```bash
   # Kill existing process
   pkill -f "node.*server.js"

   # Start fresh
   cd /Users/taylorray/Desktop/ai-sales-backend
   npm start
   ```

2. **Watch the logs for API activity:**
   ```bash
   tail -f /tmp/backend-output.log
   ```

3. **Look for these success messages:**
   - `[WEB_SCRAPER] RocketReach API found X quality contacts!`
   - `[WEB_SCRAPER] Hunter.io API found X email contacts!`
   - `[WEB_SCRAPER] Google Custom Search found X results`

4. **Test with a PDF invoice** and you should now see:
   - Real employee names (not "Main Line")
   - Email addresses
   - Job titles
   - Higher confidence scores (70-95% instead of 40%)

---

## Without APIs vs With APIs

### WITHOUT Premium APIs (Current State):
```
Contact 1: PERDUE Main Line
           General Contact
           Phone: (478) 988-6000
           Confidence: 40%
           Source: BBB
```

### WITH Premium APIs (Enhanced State):
```
Contact 1: Sarah Johnson
           Plant Manager
           Phone: (478) 218-7505
           Email: sarah.johnson@perduefarms.com
           Confidence: 92%
           Source: RocketReach API

Contact 2: Michael Chen
           EHS Director
           Phone: (478) 218-7312
           Email: m.chen@perduefarms.com
           Confidence: 88%
           Source: Hunter.io API

Contact 3: Jennifer Martinez
           Facility Safety Coordinator
           Phone: (478) 218-7423
           Email: jennifer.martinez@perduefarms.com
           Confidence: 85%
           Source: RocketReach API
```

**THIS is what will get customers hooked! 🎣**

---

## Cost Analysis

For a typical demo with 20 invoices:

| API | Lookups Used | Monthly Cost | Result Quality |
|-----|-------------|--------------|----------------|
| None | 0 | $0 | ⭐⭐ (40% confidence, no names) |
| Hunter.io only | 20 | $0 (free tier) | ⭐⭐⭐ (emails, no phones) |
| Hunter.io + RocketReach | 20 + 20 | $39/mo | ⭐⭐⭐⭐ (emails + phones + names) |
| All three APIs | 20 + 20 + 100 | ~$90/mo | ⭐⭐⭐⭐⭐ (complete profiles, 90%+ confidence) |

**ROI:** If even ONE customer signs up after seeing the demo, it pays for itself!

---

## Troubleshooting

### API keys not working?
1. Check that you removed the `#` comment character in `.env`
2. Verify no extra spaces around the `=` sign
3. Restart the backend server after changing `.env`

### Still seeing "Main Line" contacts?
1. Check backend logs: `tail -f /tmp/backend-output.log`
2. Look for errors like "API key not configured"
3. Verify your API keys are valid at the provider's dashboard

### Rate limits exceeded?
- RocketReach: Upgrade plan or wait until next month
- Hunter.io: Upgrade to paid tier
- Google Custom Search: Resets daily at midnight Pacific time

---

## Next Steps

1. ✅ Set up at least Hunter.io (it's FREE!)
2. ✅ Test with a sample invoice
3. ✅ If results are good, add RocketReach
4. ✅ For best demos, add Google Custom Search
5. 🚀 Show customers and watch them get hooked!

---

## Support

If you need help setting up:
- RocketReach support: https://rocketreach.co/help
- Hunter.io support: https://hunter.io/help
- Google Cloud support: https://support.google.com/cloud

**Remember:** The free tiers are enough to test and demo. You can upgrade later based on usage!

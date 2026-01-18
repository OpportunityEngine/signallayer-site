// =====================================================
// INTENT SIGNAL DEMO ADAPTER
// Generates realistic simulated intent signals
// =====================================================

// Company name components for realistic generation
const COMPANY_PREFIXES = ['The', 'Golden', 'Blue', 'Silver', 'Grand', 'Premier', 'Elite', 'Classic', 'Urban', 'Rustic'];
const COMPANY_NAMES = ['Oak', 'Harbor', 'Valley', 'Summit', 'River', 'Mountain', 'Coastal', 'Metro', 'Central', 'Park'];
const COMPANY_SUFFIXES = {
  restaurant: ['Grill', 'Kitchen', 'Bistro', 'Cafe', 'Eatery', 'Restaurant', 'Tavern', 'Bar & Grill', 'Diner', 'Steakhouse'],
  hotel: ['Hotel', 'Inn', 'Suites', 'Resort', 'Lodge', 'Plaza Hotel', 'Grand Hotel'],
  catering: ['Catering', 'Catering Co.', 'Events & Catering', 'Food Services'],
  healthcare: ['Medical Center', 'Hospital', 'Health Systems', 'Healthcare', 'Clinic'],
  school: ['School District', 'Academy', 'University', 'College', 'Schools']
};

// Street name components
const STREET_NUMBERS = () => Math.floor(Math.random() * 9000) + 100;
const STREET_NAMES = ['Main', 'Oak', 'Maple', 'Cedar', 'Pine', 'Washington', 'Lincoln', 'Park', 'Commerce', 'Industrial', 'Market', 'Broadway'];
const STREET_TYPES = ['St', 'Ave', 'Blvd', 'Dr', 'Way', 'Rd', 'Ln', 'Pkwy'];

// Cities by state (for realistic geographic data)
const CITIES_BY_STATE = {
  'TX': ['Dallas', 'Houston', 'Austin', 'San Antonio', 'Fort Worth', 'Plano', 'Arlington', 'Irving'],
  'CA': ['Los Angeles', 'San Francisco', 'San Diego', 'Sacramento', 'San Jose', 'Oakland', 'Fresno', 'Long Beach'],
  'NY': ['New York', 'Buffalo', 'Rochester', 'Albany', 'Syracuse', 'Yonkers'],
  'FL': ['Miami', 'Orlando', 'Tampa', 'Jacksonville', 'Fort Lauderdale', 'Naples'],
  'IL': ['Chicago', 'Aurora', 'Naperville', 'Rockford', 'Joliet'],
  'PA': ['Philadelphia', 'Pittsburgh', 'Allentown', 'Erie'],
  'AZ': ['Phoenix', 'Tucson', 'Mesa', 'Scottsdale', 'Chandler'],
  'GA': ['Atlanta', 'Augusta', 'Savannah', 'Columbus'],
  'NC': ['Charlotte', 'Raleigh', 'Durham', 'Greensboro'],
  'CO': ['Denver', 'Colorado Springs', 'Aurora', 'Boulder']
};

// State codes
const STATES = Object.keys(CITIES_BY_STATE);

// Search context templates by keyword type
const SEARCH_CONTEXTS = {
  'restaurant equipment': [
    'commercial range prices 2026',
    'best commercial refrigerator for restaurant',
    'walk-in cooler installation cost',
    'restaurant equipment financing options',
    'used commercial kitchen equipment',
    'commercial oven repair near me',
    'restaurant equipment supplier reviews',
    'how to choose commercial dishwasher'
  ],
  'commercial kitchen': [
    'commercial kitchen design layout',
    'commercial kitchen ventilation requirements',
    'commercial kitchen equipment list startup',
    'commercial kitchen fire suppression system cost',
    'how to set up commercial kitchen',
    'commercial kitchen hood cleaning service'
  ],
  'food service supplies': [
    'bulk disposable containers wholesale',
    'restaurant supply company near me',
    'food service supplies comparison',
    'commercial food storage containers',
    'restaurant napkins and linens wholesale',
    'food service packaging suppliers'
  ],
  'pos system': [
    'best restaurant pos system 2026',
    'toast pos vs square restaurant',
    'pos system for small restaurant',
    'restaurant pos with inventory management',
    'mobile pos system for food truck'
  ],
  'inventory management': [
    'restaurant inventory software comparison',
    'food cost control software',
    'automated inventory tracking restaurant',
    'best inventory app for restaurant',
    'food waste tracking software'
  ],
  'payroll software': [
    'restaurant payroll software',
    'tip management software',
    'employee scheduling app restaurant',
    'payroll service for small restaurant'
  ],
  'catering services': [
    'corporate catering near me',
    'catering for business meetings',
    'office lunch catering options',
    'how to start catering business'
  ],
  'default': [
    'best {keyword} 2026',
    '{keyword} pricing comparison',
    '{keyword} reviews',
    'how to choose {keyword}',
    '{keyword} for small business',
    '{keyword} suppliers near me'
  ]
};

// Contact titles by industry
const CONTACT_TITLES = {
  restaurant: ['Owner', 'General Manager', 'Executive Chef', 'Operations Manager', 'Kitchen Manager', 'F&B Director'],
  hotel: ['General Manager', 'F&B Director', 'Executive Chef', 'Purchasing Manager', 'Operations Director'],
  catering: ['Owner', 'Catering Director', 'Executive Chef', 'Sales Manager', 'Operations Manager'],
  healthcare: ['Facilities Director', 'Food Service Director', 'Purchasing Manager', 'Administrator'],
  school: ['Food Service Director', 'Superintendent', 'Business Manager', 'Facilities Director']
};

// First and last names for contacts
const FIRST_NAMES = ['James', 'Michael', 'Robert', 'David', 'William', 'Jennifer', 'Maria', 'Sarah', 'Lisa', 'Michelle', 'Carlos', 'Jose', 'Kevin', 'Brian', 'Patricia'];
const LAST_NAMES = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Anderson', 'Taylor', 'Thomas', 'Moore', 'Jackson'];

class DemoIntentAdapter {
  constructor() {
    this.sourceName = 'demo';
  }

  /**
   * Generate realistic demo signals
   * @param {string[]} keywords - Keywords to match
   * @param {string[]} zipCodes - Zip codes to use
   * @param {number} count - Number of signals to generate
   * @param {Object} filters - Optional filters (company_size_min, company_size_max)
   * @returns {Promise<Object[]>} Array of signal objects
   */
  async generateSignals(keywords, zipCodes, count = 5, filters = {}) {
    const signals = [];

    for (let i = 0; i < count; i++) {
      const keyword = keywords[Math.floor(Math.random() * keywords.length)];
      const zipCode = zipCodes[Math.floor(Math.random() * zipCodes.length)];
      const industry = this.pickIndustry();
      const company = this.generateCompany(industry, zipCode);
      const searchContext = this.generateSearchContext(keyword);
      const hoursAgo = this.generateFreshness();
      const hasContact = Math.random() > 0.35; // 65% have contact info

      // Calculate scores
      const recencyScore = Math.max(0, Math.round(100 - (hoursAgo / 48) * 100));
      const keywordMatchStrength = Math.floor(Math.random() * 25) + 75; // 75-100
      const fitScore = this.calculateFitScore(company, filters);
      const engagementScore = this.calculateEngagementScore(searchContext);
      const contactBonus = hasContact ? 20 : 0;

      const overallScore = Math.round(
        (recencyScore * 0.30) +
        (keywordMatchStrength * 0.25) +
        (fitScore * 0.20) +
        (engagementScore * 0.15) +
        (contactBonus * 0.10)
      );

      const priority = this.determinePriority(overallScore, hoursAgo);
      const intentCategory = this.determineIntentCategory(searchContext);

      const signalDetectedAt = new Date(Date.now() - hoursAgo * 3600000);
      const expiresAt = new Date(signalDetectedAt.getTime() + 48 * 3600000);

      const signal = {
        company_name: company.name,
        company_address: company.address,
        company_city: company.city,
        company_state: company.state,
        company_zip: zipCode,
        company_phone: company.phone,
        company_website: company.website,
        company_industry: industry,
        company_employee_count: company.employeeCount,
        company_revenue_cents: company.revenueCents,

        matched_keyword: keyword,
        keyword_match_strength: keywordMatchStrength,
        search_context: searchContext,
        intent_source: 'demo',
        intent_category: intentCategory,

        overall_score: overallScore,
        recency_score: recencyScore,
        fit_score: fitScore,
        engagement_score: engagementScore,
        priority: priority,

        signal_detected_at: signalDetectedAt.toISOString(),
        freshness_hours: Math.round(hoursAgo * 10) / 10,
        expires_at: expiresAt.toISOString(),

        contact_name: hasContact ? this.generateContactName() : null,
        contact_title: hasContact ? this.generateContactTitle(industry) : null,
        contact_email: hasContact ? this.generateContactEmail(company.name) : null,
        contact_phone: hasContact ? this.generatePhoneNumber() : null,
        decision_maker_likelihood: hasContact ? Math.floor(Math.random() * 30) + 70 : null // 70-100
      };

      signals.push(signal);
    }

    // Sort by priority and recency
    signals.sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }
      return a.freshness_hours - b.freshness_hours;
    });

    return signals;
  }

  pickIndustry() {
    const industries = ['restaurant', 'hotel', 'catering', 'healthcare', 'school'];
    const weights = [0.45, 0.20, 0.15, 0.10, 0.10]; // Restaurant most common
    const random = Math.random();
    let cumulative = 0;
    for (let i = 0; i < industries.length; i++) {
      cumulative += weights[i];
      if (random < cumulative) return industries[i];
    }
    return 'restaurant';
  }

  generateCompany(industry, zipCode) {
    // Generate company name
    const usePrefix = Math.random() > 0.5;
    const prefix = usePrefix ? COMPANY_PREFIXES[Math.floor(Math.random() * COMPANY_PREFIXES.length)] + ' ' : '';
    const name = COMPANY_NAMES[Math.floor(Math.random() * COMPANY_NAMES.length)];
    const suffixes = COMPANY_SUFFIXES[industry] || COMPANY_SUFFIXES.restaurant;
    const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
    const companyName = `${prefix}${name} ${suffix}`;

    // Pick state and city
    const state = STATES[Math.floor(Math.random() * STATES.length)];
    const cities = CITIES_BY_STATE[state];
    const city = cities[Math.floor(Math.random() * cities.length)];

    // Generate address
    const streetNum = STREET_NUMBERS();
    const streetName = STREET_NAMES[Math.floor(Math.random() * STREET_NAMES.length)];
    const streetType = STREET_TYPES[Math.floor(Math.random() * STREET_TYPES.length)];
    const address = `${streetNum} ${streetName} ${streetType}`;

    // Generate employee count based on industry
    const employeeRanges = {
      restaurant: { min: 5, max: 150 },
      hotel: { min: 20, max: 500 },
      catering: { min: 3, max: 50 },
      healthcare: { min: 50, max: 2000 },
      school: { min: 20, max: 300 }
    };
    const range = employeeRanges[industry] || { min: 10, max: 100 };
    const employeeCount = Math.floor(Math.random() * (range.max - range.min)) + range.min;

    // Generate revenue (rough estimate: $50K-$150K per employee)
    const revenuePerEmployee = Math.floor(Math.random() * 100000) + 50000;
    const revenueCents = employeeCount * revenuePerEmployee * 100;

    // Generate phone
    const phone = this.generatePhoneNumber();

    // Generate website
    const websiteName = companyName.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '')
      .substring(0, 20);
    const website = `www.${websiteName}.com`;

    return {
      name: companyName,
      address,
      city,
      state,
      phone,
      website,
      employeeCount,
      revenueCents
    };
  }

  generateSearchContext(keyword) {
    // Find matching contexts or use default
    const lowerKeyword = keyword.toLowerCase();
    let contexts = SEARCH_CONTEXTS.default;

    for (const [key, value] of Object.entries(SEARCH_CONTEXTS)) {
      if (lowerKeyword.includes(key) || key.includes(lowerKeyword)) {
        contexts = value;
        break;
      }
    }

    let context = contexts[Math.floor(Math.random() * contexts.length)];

    // Replace {keyword} placeholder
    context = context.replace(/{keyword}/g, keyword);

    return context;
  }

  generateFreshness() {
    // Weighted distribution favoring fresher signals
    const random = Math.random();
    if (random < 0.25) return Math.random() * 2; // 25% within 2 hours (hot)
    if (random < 0.50) return Math.random() * 6 + 2; // 25% 2-8 hours (warm)
    if (random < 0.75) return Math.random() * 16 + 8; // 25% 8-24 hours (cooling)
    return Math.random() * 24 + 24; // 25% 24-48 hours (cold)
  }

  calculateFitScore(company, filters) {
    let score = 60; // Base score

    // Check company size fit
    if (filters.company_size_min && company.employeeCount >= filters.company_size_min) {
      score += 15;
    }
    if (filters.company_size_max && company.employeeCount <= filters.company_size_max) {
      score += 15;
    }

    // Add some randomness
    score += Math.floor(Math.random() * 20) - 10;

    return Math.min(100, Math.max(0, score));
  }

  calculateEngagementScore(searchContext) {
    // Higher score for purchase-intent signals
    const purchaseKeywords = ['price', 'cost', 'buy', 'purchase', 'order', 'supplier', 'vendor', 'quote'];
    const comparisonKeywords = ['compare', 'vs', 'best', 'top', 'review'];

    const lowerContext = searchContext.toLowerCase();

    if (purchaseKeywords.some(k => lowerContext.includes(k))) {
      return Math.floor(Math.random() * 20) + 80; // 80-100
    }
    if (comparisonKeywords.some(k => lowerContext.includes(k))) {
      return Math.floor(Math.random() * 20) + 60; // 60-80
    }
    return Math.floor(Math.random() * 30) + 40; // 40-70
  }

  determineIntentCategory(searchContext) {
    const lowerContext = searchContext.toLowerCase();

    if (['price', 'cost', 'buy', 'order', 'quote', 'supplier'].some(k => lowerContext.includes(k))) {
      return 'purchase_ready';
    }
    if (['compare', 'vs', 'best', 'top', 'review'].some(k => lowerContext.includes(k))) {
      return 'comparison';
    }
    return 'research';
  }

  determinePriority(overallScore, hoursAgo) {
    // Critical: High score AND very fresh
    if (overallScore >= 80 && hoursAgo < 4) return 'critical';
    // High: Good score OR fresh with decent score
    if (overallScore >= 70 || (overallScore >= 60 && hoursAgo < 12)) return 'high';
    // Medium: Decent score
    if (overallScore >= 50) return 'medium';
    // Low: Everything else
    return 'low';
  }

  generateContactName() {
    const firstName = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
    const lastName = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
    return `${firstName} ${lastName}`;
  }

  generateContactTitle(industry) {
    const titles = CONTACT_TITLES[industry] || CONTACT_TITLES.restaurant;
    return titles[Math.floor(Math.random() * titles.length)];
  }

  generateContactEmail(companyName) {
    const firstName = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)].toLowerCase();
    const lastName = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)].toLowerCase();
    const domain = companyName.toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .substring(0, 15);

    const formats = [
      `${firstName}.${lastName}@${domain}.com`,
      `${firstName[0]}${lastName}@${domain}.com`,
      `${firstName}@${domain}.com`
    ];

    return formats[Math.floor(Math.random() * formats.length)];
  }

  generatePhoneNumber() {
    const areaCode = Math.floor(Math.random() * 800) + 200;
    const prefix = Math.floor(Math.random() * 900) + 100;
    const line = Math.floor(Math.random() * 9000) + 1000;
    return `(${areaCode}) ${prefix}-${line}`;
  }
}

module.exports = DemoIntentAdapter;

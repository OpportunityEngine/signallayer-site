// =====================================================
// STRIPE PAYMENT INTEGRATION
// Handles subscriptions, checkouts, and webhooks
// =====================================================

const express = require('express');
const router = express.Router();
const db = require('./database');
const { requireAuth } = require('./auth-middleware');

// Initialize Stripe with API key
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Pricing Plans Configuration
const PRICING_PLANS = {
  starter: {
    id: 'starter',
    name: 'Starter',
    description: 'Perfect for small teams getting started',
    monthlyPrice: 4900, // $49/month
    yearlyPrice: 47000, // $470/year (save $118)
    features: [
      '1 user included',
      '100 invoices/month',
      'Email autopilot (1 inbox)',
      'Basic opportunity detection',
      'Rep dashboard access',
      'Email support'
    ],
    invoiceLimit: 100,
    userLimit: 1,
    emailMonitorLimit: 1
  },
  professional: {
    id: 'professional',
    name: 'Professional',
    description: 'For growing sales teams',
    monthlyPrice: 14900, // $149/month
    yearlyPrice: 143000, // $1,430/year (save $358)
    features: [
      '5 users included',
      'Unlimited invoices',
      'Email autopilot (5 inboxes)',
      'Advanced rules engine',
      'Commission tracking',
      'SPIF contests',
      'Manager dashboard',
      'Priority support'
    ],
    invoiceLimit: -1, // Unlimited
    userLimit: 5,
    emailMonitorLimit: 5,
    popular: true
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    description: 'For large organizations',
    monthlyPrice: 39900, // $399/month
    yearlyPrice: 383000, // $3,830/year (save $958)
    features: [
      'Unlimited users',
      'Unlimited invoices',
      'Unlimited email inboxes',
      'MLA contract management',
      'Custom integrations',
      'API access',
      'White-labeling',
      'Dedicated success manager',
      'SLA guarantee'
    ],
    invoiceLimit: -1,
    userLimit: -1,
    emailMonitorLimit: -1
  }
};

// =====================================================
// PUBLIC ENDPOINTS
// =====================================================

/**
 * GET /stripe/plans
 * Returns available pricing plans (no auth required)
 */
router.get('/plans', (req, res) => {
  res.json({
    success: true,
    plans: Object.values(PRICING_PLANS)
  });
});

/**
 * GET /stripe/config
 * Returns Stripe publishable key for frontend (no auth required)
 */
router.get('/config', (req, res) => {
  res.json({
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY
  });
});

// =====================================================
// AUTHENTICATED ENDPOINTS
// =====================================================

/**
 * POST /stripe/create-checkout-session
 * Creates a Stripe Checkout session for subscription purchase
 */
router.post('/create-checkout-session', requireAuth, async (req, res) => {
  try {
    const { planId, interval = 'month' } = req.body;
    const user = req.user;

    // Validate plan
    const plan = PRICING_PLANS[planId];
    if (!plan) {
      return res.status(400).json({
        success: false,
        error: 'Invalid plan selected'
      });
    }

    // Check if user already has active subscription
    const existingSub = db.getSubscriptionByUserId(user.id);
    if (existingSub && existingSub.status === 'active') {
      return res.status(400).json({
        success: false,
        error: 'You already have an active subscription. Please manage your subscription in billing settings.'
      });
    }

    // Get or create Stripe customer
    let stripeCustomerId = existingSub?.stripe_customer_id;

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: {
          userId: user.id.toString(),
          accountName: user.account_name
        }
      });
      stripeCustomerId = customer.id;
    }

    // Calculate price based on interval
    const priceInCents = interval === 'year' ? plan.yearlyPrice : plan.monthlyPrice;

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Revenue Radar ${plan.name}`,
              description: plan.description,
              metadata: {
                planId: plan.id
              }
            },
            unit_amount: priceInCents,
            recurring: {
              interval: interval
            }
          },
          quantity: 1
        }
      ],
      mode: 'subscription',
      success_url: `${process.env.APP_URL || 'https://revenueradar.io'}/dashboard/billing.html?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.APP_URL || 'https://revenueradar.io'}/dashboard/pricing.html?canceled=true`,
      subscription_data: {
        metadata: {
          userId: user.id.toString(),
          planId: plan.id,
          planName: plan.name
        },
        trial_period_days: user.is_trial ? 0 : 14 // 14-day trial for new users only
      },
      allow_promotion_codes: true,
      billing_address_collection: 'required',
      customer_update: {
        address: 'auto',
        name: 'auto'
      }
    });

    console.log(`[STRIPE] Created checkout session for user ${user.id}: ${session.id}`);

    res.json({
      success: true,
      sessionId: session.id,
      url: session.url
    });
  } catch (error) {
    console.error('[STRIPE] Checkout session error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /stripe/create-portal-session
 * Creates a Stripe Customer Portal session for managing subscription
 */
router.post('/create-portal-session', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    const subscription = db.getSubscriptionByUserId(user.id);

    if (!subscription || !subscription.stripe_customer_id) {
      return res.status(400).json({
        success: false,
        error: 'No subscription found. Please subscribe to a plan first.'
      });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: subscription.stripe_customer_id,
      return_url: `${process.env.APP_URL || 'https://revenueradar.io'}/dashboard/billing.html`
    });

    res.json({
      success: true,
      url: session.url
    });
  } catch (error) {
    console.error('[STRIPE] Portal session error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /stripe/subscription
 * Get current user's subscription status
 */
router.get('/subscription', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    const subscription = db.getSubscriptionByUserId(user.id);

    if (!subscription) {
      return res.json({
        success: true,
        subscription: null,
        status: user.subscription_status || 'trial',
        isTrial: user.is_trial === 1,
        trialDaysLeft: user.trial_expires_at
          ? Math.max(0, Math.ceil((new Date(user.trial_expires_at) - new Date()) / (1000 * 60 * 60 * 24)))
          : 0,
        trialInvoicesLeft: user.trial_invoices_limit - (user.trial_invoices_used || 0)
      });
    }

    // Get plan details
    const plan = PRICING_PLANS[subscription.plan_id] || {};

    res.json({
      success: true,
      subscription: {
        id: subscription.id,
        planId: subscription.plan_id,
        planName: subscription.plan_name,
        status: subscription.status,
        currentPeriodEnd: subscription.current_period_end,
        cancelAtPeriodEnd: subscription.cancel_at_period_end === 1,
        amount: subscription.amount_cents,
        interval: subscription.interval,
        features: plan.features || []
      },
      status: subscription.status,
      isTrial: false
    });
  } catch (error) {
    console.error('[STRIPE] Get subscription error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /stripe/invoices
 * Get user's payment history
 */
router.get('/invoices', requireAuth, async (req, res) => {
  try {
    const payments = db.getPaymentHistory(req.user.id, 20);

    res.json({
      success: true,
      invoices: payments.map(p => ({
        id: p.id,
        date: p.created_at,
        amount: p.amount_cents,
        status: p.status,
        description: p.description,
        receiptUrl: p.receipt_url
      }))
    });
  } catch (error) {
    console.error('[STRIPE] Get invoices error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /stripe/cancel-subscription
 * Cancel subscription (at period end by default)
 */
router.post('/cancel-subscription', requireAuth, async (req, res) => {
  try {
    const { immediate = false } = req.body;
    const subscription = db.getSubscriptionByUserId(req.user.id);

    if (!subscription || !subscription.stripe_subscription_id) {
      return res.status(400).json({
        success: false,
        error: 'No active subscription found'
      });
    }

    if (immediate) {
      // Cancel immediately
      await stripe.subscriptions.cancel(subscription.stripe_subscription_id);
    } else {
      // Cancel at period end
      await stripe.subscriptions.update(subscription.stripe_subscription_id, {
        cancel_at_period_end: true
      });
    }

    // Update local database
    db.cancelSubscription(subscription.stripe_subscription_id, immediate);

    res.json({
      success: true,
      message: immediate
        ? 'Subscription canceled immediately'
        : 'Subscription will be canceled at the end of the billing period'
    });
  } catch (error) {
    console.error('[STRIPE] Cancel subscription error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =====================================================
// WEBHOOK ENDPOINT
// =====================================================

/**
 * POST /stripe/webhook
 * Handles Stripe webhook events
 * IMPORTANT: Use raw body parser for signature verification
 */
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('[STRIPE WEBHOOK] Signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`[STRIPE WEBHOOK] Received event: ${event.type}`);

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        await handleCheckoutComplete(session);
        break;
      }

      case 'customer.subscription.created': {
        const subscription = event.data.object;
        await handleSubscriptionCreated(subscription);
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        await handleSubscriptionUpdated(subscription);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        await handleSubscriptionDeleted(subscription);
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object;
        await handleInvoicePaid(invoice);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        await handleInvoicePaymentFailed(invoice);
        break;
      }

      default:
        console.log(`[STRIPE WEBHOOK] Unhandled event type: ${event.type}`);
    }
  } catch (error) {
    console.error(`[STRIPE WEBHOOK] Error handling ${event.type}:`, error);
    // Return 200 to prevent retries for processing errors
  }

  res.json({ received: true });
});

// =====================================================
// WEBHOOK HANDLERS
// =====================================================

async function handleCheckoutComplete(session) {
  console.log(`[STRIPE] Checkout completed: ${session.id}`);

  const userId = session.subscription
    ? (await stripe.subscriptions.retrieve(session.subscription)).metadata.userId
    : session.metadata?.userId;

  if (!userId) {
    console.error('[STRIPE] No userId found in checkout session');
    return;
  }

  // Update user status
  db.updateUserSubscriptionStatus(parseInt(userId), 'active');
  console.log(`[STRIPE] User ${userId} upgraded to active subscription`);
}

async function handleSubscriptionCreated(subscription) {
  console.log(`[STRIPE] Subscription created: ${subscription.id}`);

  const userId = subscription.metadata?.userId;
  if (!userId) {
    console.error('[STRIPE] No userId in subscription metadata');
    return;
  }

  // Create local subscription record
  db.createSubscription({
    userId: parseInt(userId),
    stripeCustomerId: subscription.customer,
    stripeSubscriptionId: subscription.id,
    planId: subscription.metadata.planId || 'unknown',
    planName: subscription.metadata.planName || 'Unknown Plan',
    status: subscription.status,
    currentPeriodStart: new Date(subscription.current_period_start * 1000).toISOString(),
    currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
    trialEnd: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
    amountCents: subscription.items.data[0]?.price?.unit_amount || 0,
    interval: subscription.items.data[0]?.price?.recurring?.interval || 'month'
  });
}

async function handleSubscriptionUpdated(subscription) {
  console.log(`[STRIPE] Subscription updated: ${subscription.id}`);

  db.updateSubscription(subscription.id, {
    status: subscription.status,
    currentPeriodStart: new Date(subscription.current_period_start * 1000).toISOString(),
    currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : null
  });
}

async function handleSubscriptionDeleted(subscription) {
  console.log(`[STRIPE] Subscription deleted: ${subscription.id}`);

  db.updateSubscription(subscription.id, {
    status: 'canceled',
    canceledAt: new Date().toISOString()
  });

  // Update user status to expired
  const localSub = db.getSubscriptionByStripeId(subscription.id);
  if (localSub) {
    db.updateUserSubscriptionStatus(localSub.user_id, 'expired');
  }
}

async function handleInvoicePaid(invoice) {
  console.log(`[STRIPE] Invoice paid: ${invoice.id}`);

  const subscription = db.getSubscriptionByStripeId(invoice.subscription);
  if (!subscription) {
    console.error('[STRIPE] No local subscription found for invoice');
    return;
  }

  // Record payment
  db.recordPayment({
    userId: subscription.user_id,
    subscriptionId: subscription.id,
    stripePaymentIntentId: invoice.payment_intent,
    stripeInvoiceId: invoice.id,
    amountCents: invoice.amount_paid,
    status: 'succeeded',
    description: `${subscription.plan_name} subscription`,
    receiptUrl: invoice.hosted_invoice_url
  });
}

async function handleInvoicePaymentFailed(invoice) {
  console.log(`[STRIPE] Invoice payment failed: ${invoice.id}`);

  const subscription = db.getSubscriptionByStripeId(invoice.subscription);
  if (!subscription) return;

  // Record failed payment
  db.recordPayment({
    userId: subscription.user_id,
    subscriptionId: subscription.id,
    stripePaymentIntentId: invoice.payment_intent,
    stripeInvoiceId: invoice.id,
    amountCents: invoice.amount_due,
    status: 'failed',
    description: `${subscription.plan_name} subscription (failed)`,
    failureReason: invoice.last_payment_error?.message || 'Payment failed'
  });

  // Update subscription status
  db.updateSubscription(invoice.subscription, {
    status: 'past_due'
  });

  // TODO: Send payment failed email to user
}

// =====================================================
// EXPORTS
// =====================================================

module.exports = router;
module.exports.PRICING_PLANS = PRICING_PLANS;

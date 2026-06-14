/**
 * PULSE CRM — Synthetic Data Generator
 * 
 * Generates realistic customer, order, and segment data for demo purposes.
 * This is NOT placeholder data — it models real-world e-commerce patterns
 * with proper RFM distributions, seasonal spending patterns, and
 * realistic demographic properties stored in JSONB columns.
 */

import { v4 as uuidv4 } from 'uuid';

// ─── Customer Generation ─────────────────────────────────────────────────────

const FIRST_NAMES = [
  'Aarav', 'Priya', 'Rohan', 'Ananya', 'Vikram', 'Sneha', 'Arjun', 'Kavya',
  'Rahul', 'Meera', 'Aditya', 'Nisha', 'Karan', 'Pooja', 'Sahil', 'Divya',
  'Manish', 'Riya', 'Deepak', 'Tanya', 'Nikhil', 'Sanya', 'Amit', 'Neha',
  'Varun', 'Isha', 'Saurabh', 'Pallavi', 'Gaurav', 'Tanvi',
  'Anisha', 'Harsha', 'Bhavna', 'Kartik', 'Megha', 'Pranav', 'Swati',
  'Yash', 'Jaya', 'Kunal', 'Lakshmi', 'Omar', 'Fatima', 'Chen', 'Wei',
];

const LAST_NAMES = [
  'Sharma', 'Patel', 'Singh', 'Kumar', 'Gupta', 'Joshi', 'Mehta', 'Agarwal',
  'Reddy', 'Verma', 'Iyer', 'Nair', 'Shah', 'Desai', 'Rao', 'Mishra',
  'Chopra', 'Malhotra', 'Kapoor', 'Saxena', 'Bose', 'Das', 'Banerjee',
  'Mukherjee', 'Chatterjee', 'Pillai', 'Menon', 'Hegde', 'Kulkarni',
];

const CITIES = [
  'Mumbai', 'Delhi', 'Bangalore', 'Hyderabad', 'Chennai', 'Kolkata',
  'Pune', 'Ahmedabad', 'Jaipur', 'Lucknow', 'Chandigarh', 'Kochi',
  'Indore', 'Nagpur', 'Gurgaon', 'Noida',
];

const CATEGORIES = ['fashion', 'electronics', 'beauty', 'home', 'sports', 'books', 'food'];
const SEGMENTS_BEHAVIORAL = ['high_value', 'regular', 'at_risk', 'new', 'dormant', 'champion'];
const PLATFORMS = ['ios', 'android', 'web'];

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDate(daysAgo: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - randomBetween(0, daysAgo));
  date.setHours(randomBetween(6, 23), randomBetween(0, 59), randomBetween(0, 59));
  return date;
}

function seasonalOrderDate(): Date {
  const now = new Date();
  const year = now.getFullYear();
  const seasonalRoll = Math.random();
  const date = new Date();

  if (seasonalRoll < 0.28) {
    date.setFullYear(year, randomFrom([9, 10]), randomBetween(1, 28)); // Oct/Nov festive spike
  } else if (seasonalRoll < 0.42) {
    date.setFullYear(year, 11, randomBetween(1, 28)); // December gifting
  } else if (seasonalRoll < 0.54) {
    date.setFullYear(year, 2, randomBetween(1, 28)); // Spring refresh
  } else {
    return randomDate(180);
  }

  date.setHours(randomBetween(9, 23), randomBetween(0, 59), randomBetween(0, 59));
  if (date.getTime() > now.getTime()) {
    date.setFullYear(year - 1);
  }
  return date;
}

export interface SyntheticCustomer {
  id: string;
  email: string;
  phone: string;
  name: string;
  totalSpend: number;
  orderCount: number;
  lastOrderDate: Date;
  avgOrderValue: number;
  properties: Record<string, unknown>;
  createdAt: Date;
}

export interface SyntheticOrder {
  id: string;
  orderId: string;
  customerEmail: string;
  amount: number;
  orderDate: Date;
  items: Array<{ name: string; quantity: number; price: number }>;
}

const PRODUCT_NAMES: Record<string, string[]> = {
  fashion: ['Silk Saree', 'Denim Jacket', 'Cotton Kurta', 'Leather Boots', 'Chiffon Dupatta'],
  electronics: ['Wireless Earbuds', 'Smart Watch', 'Phone Case', 'USB-C Cable', 'Power Bank'],
  beauty: ['Face Serum', 'Lip Balm', 'Sunscreen SPF50', 'Hair Oil', 'Sheet Mask Set'],
  home: ['Scented Candle', 'Throw Pillow', 'Wall Art Print', 'Kitchen Scale', 'Bamboo Tray'],
  sports: ['Yoga Mat', 'Resistance Bands', 'Water Bottle', 'Running Socks', 'Jump Rope'],
  books: ['Fiction Novel', 'Self-Help Book', 'Cookbook', 'Art Journal', 'Poetry Collection'],
  food: ['Premium Tea Box', 'Artisan Coffee', 'Dark Chocolate Set', 'Granola Mix', 'Honey Jar'],
};

export function generateCustomers(count: number = 300): SyntheticCustomer[] {
  const customers: SyntheticCustomer[] = [];

  for (let i = 0; i < count; i++) {
    const firstName = randomFrom(FIRST_NAMES);
    const lastName = randomFrom(LAST_NAMES);
    const name = `${firstName} ${lastName}`;
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${randomBetween(1, 999)}@example.com`;
    const phone = `+91${randomBetween(7000000000, 9999999999)}`;

    // Create realistic RFM distributions
    const segment = randomFrom(SEGMENTS_BEHAVIORAL);
    let orderCount: number, totalSpend: number, daysSinceLastOrder: number;

    switch (segment) {
      case 'champion':
        orderCount = randomBetween(15, 50);
        totalSpend = randomBetween(25000, 150000);
        daysSinceLastOrder = randomBetween(1, 14);
        break;
      case 'high_value':
        orderCount = randomBetween(8, 20);
        totalSpend = randomBetween(10000, 50000);
        daysSinceLastOrder = randomBetween(5, 90); // Changed to 90 so demo queries for 'inactive 30 days' return results
        break;
      case 'regular':
        orderCount = randomBetween(3, 10);
        totalSpend = randomBetween(3000, 15000);
        daysSinceLastOrder = randomBetween(10, 60);
        break;
      case 'new':
        orderCount = randomBetween(1, 3);
        totalSpend = randomBetween(500, 5000);
        daysSinceLastOrder = randomBetween(1, 20);
        break;
      case 'at_risk':
        orderCount = randomBetween(3, 12);
        totalSpend = randomBetween(5000, 30000);
        daysSinceLastOrder = randomBetween(45, 120);
        break;
      case 'dormant':
        orderCount = randomBetween(1, 5);
        totalSpend = randomBetween(1000, 10000);
        daysSinceLastOrder = randomBetween(90, 365);
        break;
      default:
        orderCount = randomBetween(1, 5);
        totalSpend = randomBetween(1000, 10000);
        daysSinceLastOrder = randomBetween(10, 60);
    }

    const avgOrderValue = totalSpend / orderCount;
    const lastOrderDate = new Date();
    lastOrderDate.setDate(lastOrderDate.getDate() - daysSinceLastOrder);

    // Dynamic JSONB properties — these change rapidly and are queried via GIN index
    const properties: Record<string, unknown> = {
      city: randomFrom(CITIES),
      preferredCategories: [randomFrom(CATEGORIES), randomFrom(CATEGORIES)].filter((v, i, a) => a.indexOf(v) === i),
      platform: randomFrom(PLATFORMS),
      segment,
      loyaltyTier: totalSpend > 25000 ? 'platinum' : totalSpend > 10000 ? 'gold' : totalSpend > 3000 ? 'silver' : 'bronze',
      hasApp: Math.random() > 0.4,
      acceptsMarketing: Math.random() > 0.15,
      preferredChannel: randomFrom(['email', 'sms', 'whatsapp', 'rcs']),
      lastBrowseDate: randomDate(14).toISOString(),
      cartAbandoned: Math.random() > 0.7,
      referralSource: randomFrom(['organic', 'paid_search', 'social', 'referral', 'direct']),
      ageGroup: randomFrom(['18-24', '25-34', '35-44', '45-54', '55+']),
      gender: randomFrom(['M', 'F', 'Other', 'Prefer not to say']),
    };

    customers.push({
      id: uuidv4(),
      email,
      phone,
      name,
      totalSpend,
      orderCount,
      lastOrderDate,
      avgOrderValue: Math.round(avgOrderValue * 100) / 100,
      properties,
      createdAt: randomDate(365),
    });
  }

  // --- Guarantee Base Cohort Distributions ---
  // 1. Inactive regional VIPs
  for (let i = 0; i < 8; i++) {
    customers[i].properties.city = 'Mumbai';
    customers[i].properties.segment = 'high_value';
    customers[i].properties.loyaltyTier = 'platinum';
    const lastOrderDate = new Date();
    lastOrderDate.setDate(lastOrderDate.getDate() - randomBetween(35, 80));
    customers[i].lastOrderDate = lastOrderDate;
    customers[i].totalSpend = randomBetween(20000, 80000);
  }

  // 2. High-LTV metropolitan shoppers
  for (let i = 8; i < 20; i++) {
    customers[i].properties.city = 'Delhi';
    customers[i].totalSpend = randomBetween(40000, 120000);
  }

  // 3. At-risk moderate spenders

  for (let i = 20; i < 35; i++) {
    customers[i].properties.segment = 'at_risk';
    customers[i].totalSpend = randomBetween(4000, 25000);
    const lastOrderDate = new Date();
    lastOrderDate.setDate(lastOrderDate.getDate() - randomBetween(45, 120));
    customers[i].lastOrderDate = lastOrderDate;
  }

  return customers;
}

export function generateOrders(customers: SyntheticCustomer[]): SyntheticOrder[] {
  const orders: SyntheticOrder[] = [];

  function buildOrder(customer: SyntheticCustomer): SyntheticOrder {
      const category = randomFrom(CATEGORIES);
      const products = PRODUCT_NAMES[category] || PRODUCT_NAMES.fashion;
      const numItems = randomBetween(1, 4);
      const items: Array<{ name: string; quantity: number; price: number }> = [];

      let orderTotal = 0;
      for (let j = 0; j < numItems; j++) {
        const price = randomBetween(200, 5000);
        const quantity = randomBetween(1, 3);
        items.push({
          name: randomFrom(products),
          quantity,
          price,
        });
        orderTotal += price * quantity;
      }

      return {
        id: uuidv4(),
        orderId: `ORD-${uuidv4().slice(0, 8).toUpperCase()}`,
        customerEmail: customer.email,
        amount: orderTotal,
        orderDate: seasonalOrderDate(),
        items,
      };
  }

  for (const customer of customers) {
    const numOrders = customer.orderCount;

    for (let i = 0; i < numOrders; i++) {
      orders.push(buildOrder(customer));
    }
  }

  while (orders.length < 1000 && customers.length > 0) {
    orders.push(buildOrder(randomFrom(customers)));
  }

  return orders;
}

// ─── Segment Suggestions (AI-generated insights) ────────────────────────────

export interface SyntheticInsight {
  id: string;
  type: 'segment' | 'campaign' | 'insight';
  title: string;
  description: string;
  metrics: Record<string, number | string>;
  suggestedAction: string;
  aiReasoning: string;
}

export function generateInsights(customers: SyntheticCustomer[]): SyntheticInsight[] {
  const atRiskCount = customers.filter(c => (c.properties as Record<string, string>).segment === 'at_risk').length;
  const dormantCount = customers.filter(c => (c.properties as Record<string, string>).segment === 'dormant').length;
  const highValueCount = customers.filter(c => c.totalSpend > 10000).length;
  const cartAbandonedCount = customers.filter(c => (c.properties as Record<string, boolean>).cartAbandoned).length;
  const totalRevenue = customers.reduce((sum, c) => sum + c.totalSpend, 0);

  return [
    {
      id: uuidv4(),
      type: 'insight',
      title: 'Win-Back Opportunity',
      description: `${atRiskCount} at-risk customers haven't purchased in 45+ days. Historical data shows a 23% win-back rate with personalized offers.`,
      metrics: {
        atRiskCustomers: atRiskCount,
        estimatedRevenueLoss: `₹${Math.round(atRiskCount * 2500).toLocaleString()}`,
        winBackProbability: '23%',
      },
      suggestedAction: 'Create a "We miss you" campaign with 15% off their preferred category',
      aiReasoning: 'Based on RFM analysis, these customers have high historical spend but declining frequency. Similar cohorts respond well to category-specific discounts.',
    },
    {
      id: uuidv4(),
      type: 'insight',
      title: 'Cart Abandonment Recovery',
      description: `${cartAbandonedCount} customers have items in their cart. Average cart value is ₹1,850.`,
      metrics: {
        abandonedCarts: cartAbandonedCount,
        avgCartValue: '₹1,850',
        estimatedRecovery: `₹${Math.round(cartAbandonedCount * 1850 * 0.12).toLocaleString()}`,
      },
      suggestedAction: 'Send a reminder with free shipping offer within 2 hours',
      aiReasoning: 'Cart abandonment emails sent within 2 hours have a 12% conversion rate vs 3% for 24-hour delay. Free shipping is the #1 driver for completing checkout.',
    },
    {
      id: uuidv4(),
      type: 'insight',
      title: 'Loyalty Program Upgrade',
      description: `${highValueCount} customers qualify for loyalty tier upgrades. Upgrading drives 40% higher repeat purchase rates.`,
      metrics: {
        eligibleCustomers: highValueCount,
        avgLTV: `₹${Math.round(totalRevenue / highValueCount).toLocaleString()}`,
        projectedRetentionLift: '40%',
      },
      suggestedAction: 'Send tier upgrade notification with early access to new collection',
      aiReasoning: 'Loyalty tier recognition triggers the endowment effect — customers who feel "invested" in a tier are significantly more likely to maintain spending levels.',
    },
    {
      id: uuidv4(),
      type: 'insight',
      title: 'Dormant Reactivation',
      description: `${dormantCount} dormant customers haven't engaged in 90+ days.`,
      metrics: {
        dormantCustomers: dormantCount,
        reactivationRate: '8%',
        avgReactivationValue: '₹3,200',
      },
      suggestedAction: 'Launch a "New arrivals you missed" campaign with social proof',
      aiReasoning: 'Dormant customers respond 3x better to "what\'s new" messaging than discount-first approaches. Social proof ("1,200 customers loved this") lifts CTR by 18%.',
    },
  ];
}

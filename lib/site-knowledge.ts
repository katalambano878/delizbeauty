/**
 * Site Knowledge Base — comprehensive content extracted from all public-facing pages.
 * Used by the AI chat assistant to answer customer questions about the business,
 * policies, pages, products, and more.
 */

export interface SiteKnowledgeEntry {
  id: string;
  title: string;
  path: string;
  category: string;
  content: string;
  keywords: string[];
}

export const SITE_KNOWLEDGE: SiteKnowledgeEntry[] = [
  // ─── BUSINESS IDENTITY ──────────────────────────────────────────────────────
  {
    id: 'business-overview',
    title: 'About Deliz Beauty Tools',
    path: '/about',
    category: 'company',
    content: `Deliz Beauty Tools is Ghana's trusted destination for premium beauty essentials. We specialize in lash products, hair and wig tools, pedicure and manicure supplies, nail accessories, spa equipment, and skincare products curated for professionals and beauty lovers alike.

Our mission is simple: to empower salons, spas, beauty creators and individuals to look and feel their best by providing high-quality tools that inspire confidence, creativity and consistency.

Located in Madina, Ritz Junction, Accra, we supply both retail and wholesale clients and deliver to every corner of Ghana. Step into a world where beauty meets convenience — because you deserve to be gorgeous everywhere you go.

Tagline: "Beauty meets convenience."
Location: Madina, Ritz Junction, Accra. Nationwide delivery.`,
    keywords: ['about', 'deliz', 'beauty', 'story', 'mission', 'company', 'salon', 'spa', 'lash', 'hair', 'nail', 'skincare', 'Madina', 'Accra', 'Ghana'],
  },
  {
    id: 'contact-info',
    title: 'Contact Information',
    path: '/contact',
    category: 'contact',
    content: `Contact Deliz Beauty Tools:

Phone: 027 854 9831
Email: contact@delizbeautytools.com (we respond within 24 hours)
WhatsApp: Available for instant chat
Visit Us: Madina, Ritz Junction, Accra. Nationwide delivery.

Support Hours: Monday to Saturday, 8 AM - 8 PM GMT
You can also use the contact form on the website, or use this chat to create a support ticket.`,
    keywords: ['contact', 'phone', 'email', 'whatsapp', 'address', 'location', 'hours', 'call', 'reach', 'Madina', 'Ritz Junction', '0278549831'],
  },

  // ─── SHIPPING & DELIVERY ────────────────────────────────────────────────────
  {
    id: 'shipping-policy',
    title: 'Shipping & Delivery Policy',
    path: '/shipping',
    category: 'shipping',
    content: `Delivery Options:
- Standard Delivery: Same day delivery, GH₵20
- Express Delivery: Same day delivery, GH₵40 (Available in Accra & Kumasi only)
- Store Pickup: Same day, FREE — Order online and pick up at our Accra location

Free Shipping: On all orders over GH₵300!

Delivery Zones:
- Zone 1 (Accra Metro): Same day delivery
- Zone 2 (Greater Accra): Same day delivery
- Zone 3 (Major Cities like Kumasi, Takoradi, Tamale, Cape Coast): Same day delivery
- Zone 4 (Other Areas): Same day delivery

How Delivery Works:
1. Order Processing — We prepare your order for same day delivery
2. Dispatch — Your package is handed to our delivery partner
3. Track — You get a tracking number via SMS/email
4. Delivery — Package arrives at your doorstep the same day

Important Details:
- Delivery time: Same day delivery
- Business days: Monday to Friday
- We will contact you before delivery
- Failed deliveries: We attempt delivery twice. After 2 failed attempts, package returns to our warehouse
- Package security: All items carefully packaged for safe delivery`,
    keywords: ['shipping', 'delivery', 'how long', 'deliver', 'express', 'standard', 'pickup', 'store pickup', 'free shipping', 'zones', 'accra', 'kumasi', 'tracking', 'days'],
  },

  // ─── RETURNS & REFUNDS ──────────────────────────────────────────────────────
  {
    id: 'returns-policy',
    title: 'Returns & Refunds Policy',
    path: '/returns',
    category: 'returns',
    content: `Returns Policy:
- Returns accepted within 30 days of delivery
- Items must be unused, in original packaging, with tags attached
- Free return shipping for defective/damaged items
- Refunds processed within 5-7 business days

How to Return:
1. Find your order (use order number and email)
2. Select items to return and choose a reason
3. Submit return request — you'll get a prepaid return label via email

Return Reasons We Accept:
- Wrong size or fit
- Wrong item received
- Defective or damaged
- Not as described
- Changed my mind
- Better price elsewhere
- No longer needed

Options: You can choose either a full Refund or an Exchange

After Submitting:
- You'll receive an email with: prepaid return label, packing instructions, drop-off locations, and a tracking number
- Ship the item back within 7 days
- Keep items unused and with tags
- Save your tracking number

Refund Timeline: Once we receive and inspect the returned item, refunds are processed within 5-7 business days to your original payment method.`,
    keywords: ['return', 'refund', 'exchange', 'send back', 'money back', 'damaged', 'defective', 'wrong item', 'wrong size', 'policy'],
  },

  // ─── PAYMENT ────────────────────────────────────────────────────────────────
  {
    id: 'payment-methods',
    title: 'Payment Methods',
    path: '/checkout',
    category: 'payment',
    content: `Accepted Payment Methods:
- Mobile Money (MoMo): MTN Mobile Money, Vodafone Cash, AirtelTigo Money — powered by Moolre payment gateway
- Cash on Delivery: Available in Accra only

How Payment Works:
1. Add items to cart
2. Enter shipping details (name, email, phone, address, city, region)
3. Choose delivery method (Store Pickup FREE, or Doorstep Delivery)
4. Click "Pay with Mobile Money" — you'll be redirected to the Moolre secure payment page
5. Approve the payment on your phone
6. Order confirmed!

Payment Security: All payments are processed securely through Moolre. We never store your payment details.

Coupon Codes: You can apply discount/coupon codes at checkout. Enter the code in the cart page to see your discount applied.

Currency: All prices are in GH₵ (Ghana Cedis).`,
    keywords: ['payment', 'pay', 'mobile money', 'momo', 'mtn', 'vodafone', 'airteltigo', 'cash on delivery', 'cod', 'moolre', 'coupon', 'discount', 'price', 'currency', 'cedis'],
  },

  // ─── ACCOUNT & AUTH ─────────────────────────────────────────────────────────
  {
    id: 'account-management',
    title: 'Account & Profile',
    path: '/account',
    category: 'account',
    content: `Your Account:
You can create a free account to enjoy a more personalized experience.

Account Features:
- Profile Settings: Update your first name, last name, phone number
- Order History: View all past orders with status tracking
- Address Book: Save delivery addresses for faster checkout
- Security: Change password, email verification, phone verification
- Wishlist: Save products you love for later

Creating an Account:
1. Go to Sign Up page
2. Enter: First Name, Last Name, Email, Phone, Password
3. Agree to Terms & Conditions
4. Optional: Subscribe to newsletter
5. Check your email for a confirmation link

Password Reset:
If you forgot your password, go to the Forgot Password page, enter your email, and we'll send a reset link. Note: The AI assistant cannot directly reset passwords — we'll create a support ticket for our team to help you.

Guest Checkout:
You don't need an account to shop! Guest checkout is available — just enter your shipping details at checkout.

Email is read-only after signup (cannot be changed through the website). Contact support if you need to change your email.`,
    keywords: ['account', 'login', 'sign up', 'register', 'password', 'forgot password', 'reset password', 'profile', 'address', 'security', 'email', 'phone', 'guest'],
  },

  // ─── PRODUCTS & SHOPPING ────────────────────────────────────────────────────
  {
    id: 'shopping-guide',
    title: 'How to Shop',
    path: '/shop',
    category: 'shopping',
    content: `Shopping at Deliz Beauty Tools:

Browse Products:
- Shop All: View all products on the /shop page
- By Category: Browse specific categories at /categories
- Search: Use the search bar to find specific products
- Filter by: Category, Price Range (GH₵0 to GH₵5000+), Rating
- Sort by: Popular, Newest, Price (Low-High or High-Low), Highest Rated

Product Pages:
Each product page shows: images/gallery, price, stock availability, description, specifications, size/color variants, customer reviews, and related products.

Cart & Checkout:
1. Click "Add to Cart" on any product
2. View your cart — update quantities, remove items, apply coupon codes
3. Proceed to checkout — enter shipping info and pay

Wishlist:
Save items you love to your wishlist (requires account). You can add all wishlist items to cart at once.

Product Categories: Mannequins, Kitchen Essentials, Electronics, Dresses, Home Essentials, Fashion items, and more.

Trust Features: Free Store Pickup, Easy 30-Day Returns, 24/7 Chat Support, Secure Payment`,
    keywords: ['shop', 'buy', 'products', 'browse', 'categories', 'filter', 'sort', 'cart', 'wishlist', 'search', 'how to order', 'add to cart'],
  },

  // ─── FAQs ───────────────────────────────────────────────────────────────────
  {
    id: 'faq-orders',
    title: 'FAQ — Orders',
    path: '/faqs',
    category: 'faq',
    content: `Frequently Asked Questions — Orders:

Q: How do I place an order?
A: Browse products, add items to cart, proceed to checkout, enter shipping details, and complete payment via Mobile Money.

Q: Can I modify or cancel my order?
A: You can request modifications within 1 hour of placing your order by contacting support. After processing begins, modifications may not be possible.

Q: How do I track my order?
A: Go to the Order Tracking page (/order-tracking), enter your order number (e.g. ORD-xxx) and email address. You'll see real-time status: Order Placed → Payment → Processing → Packaged → Dispatched To Rider → Delivered.

Q: What if I received the wrong item?
A: Contact us immediately! You can initiate a return through the Returns page or create a support ticket. We'll arrange a free return and send the correct item.

Q: How long does delivery take?
A: Same day delivery across Ghana. Express same day delivery is available in Accra and Kumasi for GH₵40.`,
    keywords: ['faq', 'order', 'place order', 'cancel', 'modify', 'track', 'wrong item', 'how long'],
  },
  {
    id: 'faq-shipping',
    title: 'FAQ — Shipping',
    path: '/faqs',
    category: 'faq',
    content: `Frequently Asked Questions — Shipping:

Q: What are the delivery costs?
A: Standard: GH₵20 (same day delivery), Express: GH₵40 (same day delivery, Accra & Kumasi only), Store Pickup: FREE. Orders over GH₵300 get free shipping!

Q: Do you deliver nationwide?
A: Yes! We deliver across all of Ghana with same day delivery.

Q: Do you ship internationally?
A: Currently we only deliver within Ghana. International shipping is not yet available.

Q: What happens if delivery fails?
A: We attempt delivery twice. If both attempts fail, the package returns to our warehouse. We'll contact you to arrange redelivery or pickup.

Q: Can I pick up my order?
A: Yes! Store Pickup is FREE. Order online and pick up the same day at our Accra location.`,
    keywords: ['faq', 'shipping', 'delivery cost', 'nationwide', 'international', 'failed delivery', 'pickup'],
  },
  {
    id: 'faq-returns',
    title: 'FAQ — Returns & Refunds',
    path: '/faqs',
    category: 'faq',
    content: `Frequently Asked Questions — Returns:

Q: What is your return policy?
A: 30 days from delivery. Items must be unused, in original packaging with tags attached.

Q: What items cannot be returned?
A: Perishable goods, intimate apparel, personalized items, digital products, and items marked as final sale.

Q: Who pays for return shipping?
A: Free return shipping for defective/damaged items. For other returns, a small return shipping fee may apply.

Q: Can I exchange instead of returning?
A: Yes! When submitting a return request, you can choose "Exchange" instead of "Refund."

Q: How long do refunds take?
A: 5-7 business days after we receive and inspect the returned item. Refunds go back to your original payment method.`,
    keywords: ['faq', 'return', 'refund', 'exchange', 'non-returnable', 'how long refund'],
  },
  {
    id: 'faq-payment',
    title: 'FAQ — Payment',
    path: '/faqs',
    category: 'faq',
    content: `Frequently Asked Questions — Payment:

Q: What payment methods do you accept?
A: Mobile Money (MTN, Vodafone, AirtelTigo) via Moolre, and Cash on Delivery (Accra only).

Q: Is my payment secure?
A: Yes, all payments are processed through Moolre's secure payment gateway. We never store your payment details.

Q: Do you offer installment payments?
A: Currently we don't offer installment/buy-now-pay-later options. Full payment is required at checkout.

Q: How do refunds work?
A: Refunds are processed within 5-7 business days to your original payment method (Mobile Money account).

Q: Can I use a coupon or discount code?
A: Yes! Enter your coupon code in the cart page. The discount will be applied to your order total.`,
    keywords: ['faq', 'payment', 'secure', 'installment', 'refund', 'coupon', 'discount code', 'promo'],
  },
  {
    id: 'faq-account',
    title: 'FAQ — Account',
    path: '/faqs',
    category: 'faq',
    content: `Frequently Asked Questions — Account:

Q: Do I need an account to shop?
A: No! Guest checkout is available. But having an account lets you track orders, save addresses, earn loyalty points, and view order history.

Q: How do I create an account?
A: Click Sign Up, enter your name, email, phone, and password. You'll receive a confirmation email.

Q: I forgot my password. How do I reset it?
A: Go to the Forgot Password page (/auth/forgot-password), enter your email, and we'll send a reset link. If you need further help, contact support.

Q: Can I change my email address?
A: Email addresses cannot be changed directly through the website. Please contact support for email changes.

Q: How do loyalty points work?
A: You earn points with every purchase. Points can be redeemed for discounts on future orders. Check the Help Center for more details.

Q: How do I update my delivery address?
A: Go to Account → Addresses to add, edit, or remove saved delivery addresses.`,
    keywords: ['faq', 'account', 'create account', 'forgot password', 'reset password', 'email change', 'loyalty points', 'address'],
  },

  // ─── LEGAL / POLICIES ──────────────────────────────────────────────────────
  {
    id: 'privacy-policy',
    title: 'Privacy Policy',
    path: '/privacy',
    category: 'legal',
    content: `Privacy Policy Summary (Last updated: December 2024):

What We Collect: Personal details (name, email, phone), delivery addresses, payment information (processed by Moolre, not stored by us), device/browser info, usage data, and cookies.

How We Use It: Order processing and delivery, service improvement, marketing communications (with your consent), security and fraud prevention, and legal compliance.

Who We Share With: Service providers (delivery, payment processing), and only when required by law. We never sell your data.

Your Rights: You can access, correct, or delete your data, opt out of marketing, request data portability, and object to processing. Contact support (email configured in CMS).

Cookies: We use essential cookies (for site functionality), analytics cookies (to improve the site), marketing cookies (optional), and preference cookies.

Data Retention: Account info kept until you delete your account, order history kept for 7 years, marketing data kept until you unsubscribe.

Children: Our service is not intended for anyone under 16.`,
    keywords: ['privacy', 'data', 'cookies', 'personal information', 'gdpr', 'rights', 'delete account', 'marketing', 'opt out'],
  },
  {
    id: 'terms-conditions',
    title: 'Terms & Conditions',
    path: '/terms',
    category: 'legal',
    content: `Terms & Conditions Summary (Last updated: December 2024):

By using the website, you agree to these terms. You must use the site lawfully and are responsible for your account security.

Products & Pricing: We strive for accuracy but reserve the right to correct errors. Prices may change without notice. Product availability is not guaranteed.

Orders: An order confirmation does not guarantee acceptance. We may cancel orders due to stock issues, pricing errors, or suspicious activity.

Returns: 14-day return policy for unused items in original packaging. Refunds processed within 5-7 business days.

Liability: We are not liable for indirect damages. Our total liability is limited to the amount you paid for the product.

Governing Law: These terms are governed by the laws of Ghana. Any disputes will be resolved in Ghana courts.

Intellectual Property: All content on the website (text, images, logos, designs) is owned by the store and protected by copyright.`,
    keywords: ['terms', 'conditions', 'legal', 'agreement', 'liability', 'copyright', 'law', 'disputes'],
  },

  // ─── HELP CENTER ────────────────────────────────────────────────────────────
  {
    id: 'help-center',
    title: 'Help Center',
    path: '/help',
    category: 'support',
    content: `Help Center Categories:

1. Orders & Delivery (12 articles): How to place orders, track shipments, delivery times, failed deliveries, order modifications
2. Returns & Refunds (10 articles): Return policy, how to return, refund timelines, exchanges, non-returnable items
3. Payment & Pricing (8 articles): Payment methods, security, coupon codes, pricing questions, refund processing
4. Account & Profile (9 articles): Creating account, password reset, profile updates, address management, email changes
5. Products & Stock (7 articles): Product availability, stock alerts, product quality, specifications, sizing guides
6. Loyalty & Rewards (6 articles): How to earn points, redeem points, point expiry, tier benefits

Popular Articles:
- How to track your order
- How to return an item
- How to earn loyalty points
- Checking stock availability
- Understanding our return policy

Quick Actions Available:
- Contact Support (create a ticket)
- Start a Return
- Track an Order`,
    keywords: ['help', 'help center', 'articles', 'how to', 'guide', 'support'],
  },

  // ─── SUPPORT TICKETS ────────────────────────────────────────────────────────
  {
    id: 'support-tickets',
    title: 'Support Tickets',
    path: '/support/ticket',
    category: 'support',
    content: `Creating a Support Ticket:
You can create a support ticket for any issue that needs human attention.

Ticket Categories: Order Issue, Delivery Problem, Return Request, Payment Issue, Product Question, Account Help, Other.

Priority Levels:
- Low: Response within 3-5 business days
- Normal: Response within 1-2 business days
- High: Response within 24 hours

What to include: Your name, email, order number (if applicable), category, priority, subject line, and a detailed description of the issue. You can also attach files.

View Your Tickets: Go to /support/tickets to see all your tickets and their status (Open, In Progress, Resolved).

Response Time: Average response time is within 24 hours. Resolution rate: 95%.

Support Hours: 24/7 online, Mon-Sat 8AM-8PM GMT for calls.`,
    keywords: ['support', 'ticket', 'help', 'issue', 'problem', 'complaint', 'response time', 'priority'],
  },

  // ─── BLOG ───────────────────────────────────────────────────────────────────
  {
    id: 'blog',
    title: 'Blog',
    path: '/blog',
    category: 'content',
    content: `Store Blog — Beauty tips, product guides, and the latest trends.

Categories: Shopping Tips, Product Reviews, Home & Living, Buying Guide, News

Featured Articles:
- "The Ultimate Guide to Online Shopping in Ghana" (8 min read) — A comprehensive guide to shopping online safely and smartly in Ghana
- "10 Must-Have Products for Your Home" (6 min read) — Our curated list of essential home products
- "How to Choose Quality Products" (7 min read) — Tips for spotting quality when shopping online

The blog is updated regularly with new content. You can subscribe to our newsletter to get updates.`,
    keywords: ['blog', 'articles', 'guide', 'tips', 'news', 'trends', 'newsletter'],
  },

  // ─── HOMEPAGE FEATURES ──────────────────────────────────────────────────────
  {
    id: 'store-features',
    title: 'Store Features & Trust',
    path: '/',
    category: 'company',
    content: `Why Shop With Us:

- Madina, Ritz Junction: Visit us in Accra or order online
- Nationwide Delivery: We deliver to every corner of Ghana
- Retail & Wholesale: For salons, spas, and individuals
- Premium Essentials: Lash, hair, nail, spa equipment, skincare
- Quality Curated: For professionals and beauty lovers
- Secure Payment: Mobile Money and card via Moolre

Product Range: Lash products, hair and wig tools, pedicure and manicure supplies, nail accessories, spa equipment, skincare. Retail and wholesale.`,
    keywords: ['features', 'why', 'trust', 'safe', 'secure', 'quality', 'best price', 'pickup', 'returns', 'support'],
  },

  // ─── ORDER TRACKING ─────────────────────────────────────────────────────────
  {
    id: 'order-tracking-guide',
    title: 'How to Track Your Order',
    path: '/order-tracking',
    category: 'orders',
    content: `Tracking Your Order:

1. Go to the Order Tracking page (/order-tracking) or ask me to track it for you
2. Enter your Order Number (e.g. ORD-1770921044414-498) and the email you used when ordering
3. View real-time status

Order Status Stages:
- Order Placed: Your order has been received
- Payment: Payment confirmed
- Processing: We're preparing your items
- Packaged: Your order is packed and ready
- Dispatched To Rider: On its way to you!
- Delivered: Successfully delivered

You can also see: order items with images, shipping address, and order total.

If your order is delayed or you have issues, you can create a support ticket or ask me for help.`,
    keywords: ['track', 'order', 'status', 'where is my order', 'delivery status', 'dispatched', 'processing'],
  },

  // ─── CHECKOUT PROCESS ───────────────────────────────────────────────────────
  {
    id: 'checkout-guide',
    title: 'Checkout Process',
    path: '/checkout',
    category: 'shopping',
    content: `How Checkout Works:

Step 1 — Shipping Information:
Enter your First Name, Last Name, Email, Phone Number, Street Address, City, and Region. We deliver to all 16 regions of Ghana: Greater Accra, Ashanti, Western, Central, Eastern, Volta, Northern, Upper East, Upper West, Bono, Bono East, Ahafo, Savannah, North East, Oti, and Western North.

Step 2 — Delivery Method:
- Store Pickup: FREE — pick up at our Accra store
- Doorstep Delivery: Charged at checkout based on your location

Step 3 — Payment:
Click "Pay with Mobile Money" to complete payment through Moolre. You'll receive a prompt on your phone to approve the transaction.

After Payment:
- You'll see an order confirmation page with your order number
- Email confirmation is sent automatically
- Your order enters processing
- You'll receive shipping updates via SMS/email

Guest checkout is available — no account needed!`,
    keywords: ['checkout', 'how to buy', 'order', 'pay', 'shipping details', 'regions', 'ghana'],
  },
];

/**
 * Search the site knowledge base for relevant entries
 */
export function searchSiteKnowledge(query: string, maxResults = 3): SiteKnowledgeEntry[] {
  const lower = query.toLowerCase();
  const words = lower.split(/\s+/).filter(w => w.length > 2);

  const scored = SITE_KNOWLEDGE.map(entry => {
    let score = 0;

    // Exact keyword matches (highest priority)
    for (const kw of entry.keywords) {
      if (lower.includes(kw)) score += 10;
      for (const word of words) {
        if (kw.includes(word) || word.includes(kw)) score += 3;
      }
    }

    // Title match
    if (entry.title.toLowerCase().includes(lower)) score += 15;
    for (const word of words) {
      if (entry.title.toLowerCase().includes(word)) score += 5;
    }

    // Content match
    const contentLower = entry.content.toLowerCase();
    for (const word of words) {
      if (contentLower.includes(word)) score += 2;
    }

    // Boost FAQ entries slightly (they cover common questions)
    if (entry.category === 'faq') score += 1;

    return { entry, score };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(s => s.entry);
}

/**
 * Get all knowledge entries for a specific category
 */
export function getKnowledgeByCategory(category: string): SiteKnowledgeEntry[] {
  return SITE_KNOWLEDGE.filter(e => e.category === category);
}

/**
 * Build a condensed site map for the system prompt
 */
export function getSiteMapSummary(): string {
  return `WEBSITE PAGES (you can reference these to help customers navigate):
- / — Homepage with featured products, categories, and store info
- /shop — Browse all products with filters (category, price, rating, sort)
- /categories — Shop by category
- /product/[slug] — Individual product pages with details, reviews, variants
- /cart — Shopping cart with coupon support
- /checkout — Checkout flow (shipping → delivery → payment)
- /order-tracking — Track orders by order number + email
- /returns — Start a return request (30-day policy)
- /account — Profile, order history, addresses, security settings
- /wishlist — Saved products
- /about — Deliz Beauty Tools story and mission
- /contact — Phone numbers, email, WhatsApp, visit info
- /faqs — 25+ frequently asked questions
- /help — Help center with 50+ articles across 6 categories
- /blog — Shopping tips, product guides, and trends
- /shipping — Detailed shipping & delivery policy
- /privacy — Privacy policy
- /terms — Terms & conditions
- /support/ticket — Create a support ticket
- /support/tickets — View your tickets
- /auth/login — Sign in
- /auth/signup — Create account
- /auth/forgot-password — Reset password`;
}

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  searchProducts,
  getProductForCart,
  trackOrder,
  getCustomerOrders,
  checkCoupon,
  createSupportTicket,
  initiateReturn,
  getRecommendations,
  getStoreInfo,
  getCustomerProfile,
  createChatOrder,
  type ChatProduct,
  type ChatOrder,
  type ChatCoupon,
  type ChatTicket,
  type ChatReturn,
  type ChatCustomerProfile,
  type ChatOrderResult,
} from '@/lib/chat-tools';
import { searchSiteKnowledge, getSiteMapSummary } from '@/lib/site-knowledge';

// ─── Env ────────────────────────────────────────────────────────────────────

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const groqKey = process.env.GROQ_API_KEY;

// ─── Types ──────────────────────────────────────────────────────────────────

type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  actions?: ChatAction[];
  quickReplies?: string[];
  orderCard?: ChatOrder;
  ticketCard?: ChatTicket;
  returnCard?: ChatReturn;
  couponCard?: ChatCoupon;
  products?: ChatProduct[];
}

interface ChatAction {
  type: 'add_to_cart' | 'view_product' | 'view_order' | 'track_order' | 'apply_coupon' | 'payment_link';
  product?: ChatProduct;
  orderId?: string;
  orderNumber?: string;
  couponCode?: string;
  label?: string;
  paymentUrl?: string;
}

interface RequestBody {
  messages?: ChatMessage[];
  newMessage?: string;
  sessionId?: string;
  pagePath?: string;
  cartItems?: { id: string; name: string; price: number; quantity: number; slug: string }[];
}

// ─── Rate Limiting (in-memory) ──────────────────────────────────────────────

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 12;
const RATE_WINDOW_MS = 60_000;

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

// ─── LLM Configuration ──────────────────────────────────────────────────────

const LLM_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const LLM_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';

async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 2): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, options);
    if (res.status === 429 && attempt < maxRetries) {
      const retryAfter = parseFloat(res.headers.get('retry-after') || '3');
      const waitMs = Math.min((retryAfter || 3) * 1000, 15000);
      console.warn(`[Chat API] Rate limited, waiting ${waitMs}ms before retry ${attempt + 1}/${maxRetries}`);
      await new Promise(r => setTimeout(r, waitMs));
      continue;
    }
    return res;
  }
  return fetch(url, options);
}

// ─── Tool Definitions ───────────────────────────────────────────────────────

const LLM_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'search_products',
      description: 'Search for products by name, description, or category. Use when the customer asks about availability, what products exist, to find a product, or wants to browse.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Search term from the user' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_product_for_cart',
      description: 'Get one specific product by slug or id for adding to cart. Use when the user wants to add a specific known product.',
      parameters: {
        type: 'object',
        properties: { slug_or_id: { type: 'string', description: 'Product slug or UUID' } },
        required: ['slug_or_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'track_order',
      description: 'Track an order by order number and email. Use when the customer wants to know the status of a specific order. If the customer provided their email earlier in the conversation, use that — do NOT ask again.',
      parameters: {
        type: 'object',
        properties: {
          order_number: { type: 'string', description: 'Order number (e.g. ORD-xxx) or tracking number' },
          email: { type: 'string', description: 'Email address associated with the order. Use email from conversation context if already provided.' },
        },
        required: ['order_number', 'email'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_customer_orders',
      description: 'Get recent orders for the logged-in customer. Use when they ask "show me my orders" or "my recent orders" or "reorder". Only works for authenticated users.',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'number', description: 'Number of orders to return (default 5)' } },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'check_coupon',
      description: 'Validate a coupon or discount code. Use when the customer asks about a promo code, discount, or coupon.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Coupon code to validate' },
          cart_total: { type: 'number', description: 'Optional current cart total for minimum purchase check' },
        },
        required: ['code'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_support_ticket',
      description: 'Create a support ticket to escalate an issue to the human support team. Use when the customer has a problem you cannot solve, wants to report an issue, or requests to speak with a human. If the user provided their email in the conversation, pass it in the email parameter.',
      parameters: {
        type: 'object',
        properties: {
          subject: { type: 'string', description: 'Short summary of the issue' },
          description: { type: 'string', description: 'Detailed description of the problem' },
          category: { type: 'string', enum: ['order_issue', 'product_inquiry', 'payment', 'shipping', 'return', 'other'], description: 'Issue category' },
          email: { type: 'string', description: 'Customer email address (from conversation or profile). Always include if the customer mentioned their email.' },
        },
        required: ['subject', 'description'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'initiate_return',
      description: 'Start a return request for a delivered order. Only for logged-in users with a delivered order within 30 days. Ask for the order ID and reason before calling.',
      parameters: {
        type: 'object',
        properties: {
          order_id: { type: 'string', description: 'UUID of the order to return' },
          reason: { type: 'string', description: 'Reason for the return' },
          description: { type: 'string', description: 'Additional details about the return' },
        },
        required: ['order_id', 'reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_recommendations',
      description: 'Get product recommendations. Use when the customer asks "what do you recommend?", "bestsellers", "popular items", or you want to suggest alternatives.',
      parameters: {
        type: 'object',
        properties: { context: { type: 'string', description: 'Optional category or interest for recommendations' } },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_store_info',
      description: 'Get store information and policies. Use for questions about shipping, returns policy, payment methods, delivery times, contact info, or business hours.',
      parameters: {
        type: 'object',
        properties: {
          topic: { type: 'string', enum: ['shipping', 'returns', 'payment', 'contact', 'about', 'delivery_times', 'hours'], description: 'Topic to get info about' },
        },
        required: ['topic'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_customer_profile',
      description: 'Get the logged-in customer\'s profile information. Use to personalize the conversation or when the customer asks about their account details.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_website_info',
      description: 'Search the website\'s pages and content for information. Use this to answer ANY question about the business, policies, how things work, FAQs, contact info, shipping, returns, payment methods, account management, checkout process, blog content, or anything else about Deliz Beauty Tools. This searches all public pages of the website. ALWAYS use this tool when a customer asks about the business, policies, processes, or anything non-product related.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to search for (e.g. "return policy", "how to track order", "contact phone number", "payment methods", "password reset")' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_order',
      description: 'Create an order and initiate payment. Use this when the customer has items in their cart AND has provided all required shipping information (firstName, lastName, email, phone, address, city, region) AND has confirmed they want to proceed with checkout. The cart items are provided automatically from the customer\'s current cart - pass them in the items parameter.',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            description: 'Cart items to order. Use the product IDs and quantities from the cart context provided in the conversation.',
            items: {
              type: 'object',
              properties: {
                productId: { type: 'string', description: 'Product UUID' },
                quantity: { type: 'number', description: 'Quantity to order' },
              },
              required: ['productId', 'quantity'],
            },
          },
          shipping: {
            type: 'object',
            description: 'Shipping details collected from the customer',
            properties: {
              firstName: { type: 'string' },
              lastName: { type: 'string' },
              email: { type: 'string' },
              phone: { type: 'string' },
              address: { type: 'string' },
              city: { type: 'string' },
              region: { type: 'string' },
            },
            required: ['firstName', 'lastName', 'email', 'phone', 'address', 'city', 'region'],
          },
          delivery_method: {
            type: 'string',
            enum: ['standard', 'express', 'pickup'],
            description: 'Delivery method. Standard: GH₵20, Express: GH₵40, Pickup: Free',
          },
          payment_method: {
            type: 'string',
            enum: ['moolre', 'cod'],
            description: 'Payment method. moolre = Mobile Money, cod = Cash on Delivery (Accra only)',
          },
        },
        required: ['items', 'shipping', 'delivery_method', 'payment_method'],
      },
    },
  },
];

// ─── System Prompt Builder ──────────────────────────────────────────────────

function buildSystemPrompt(profile: ChatCustomerProfile | null, pagePath?: string): string {
  const now = new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  let prompt = `You are the AI shopping assistant for Deliz Beauty Tools — Ghana's trusted destination for premium beauty essentials (lash products, hair and wig tools, manicure & pedicure supplies, nail accessories, spa equipment, skincare). We're in Madina, Ritz Junction, Accra and deliver nationwide. Today is ${now}.

ABSOLUTE RULES — NEVER BREAK THESE:
- NEVER show your internal reasoning, thinking steps, chain-of-thought, or planning process. NEVER output anything like "Step 1:", "## Step", "Let me think", or similar. Only output the final customer-facing response.
- NEVER list your available tools or describe how you will use them. Just use them silently and respond with the result.
- NEVER output markdown headers (##) in your responses. Use plain text with bold (**) for emphasis if needed.

CORE BEHAVIORS:
- Be warm, helpful, and concise. Use a friendly but professional tone.
- Always quote prices in GH₵ (Ghana Cedis).
- When mentioning products, include the exact name and price.
- If a product is out of stock, say so and proactively suggest alternatives using get_recommendations.
- For order tracking, always ask for both order number AND email if not provided.
- Never make up information — if unsure, use the appropriate tool to look it up.
- Keep responses concise (2-4 sentences max for simple questions).
- When a customer says "find a product", "show me products", "what do you have", or any generic product request, IMMEDIATELY call get_recommendations to show actual products. Do NOT ask what they want or list generic categories — show real products with prices right away. Never make up prices or product ranges.

CRITICAL CONVERSATION RULES — YOU MUST FOLLOW THESE:
1. NEVER ask for information the customer already provided. Read the full conversation history carefully. If they already gave their email, name, order number, or any detail — USE IT, don't ask again.
2. NEVER repeat the same question twice. If you already asked something and the customer responded, move forward with their answer.
3. NEVER give a generic response like "How can I help?" or "Could you tell me more?" after the customer has clearly stated what they need. Always address their specific request.
4. If a tool call fails or you can't complete an action, explain SPECIFICALLY what went wrong and what the customer can do instead. Never just reset to a generic greeting.
5. When the customer provides information (like an email address), ACKNOWLEDGE it specifically (e.g. "Got it, using wepedam@gmail.com...") and proceed with the action immediately.
6. Maintain context throughout the entire conversation. If the customer said they want a password reset 3 messages ago, you still know that's what they want.

HONESTY ABOUT LIMITATIONS:
- You CANNOT directly reset passwords, change account settings, or modify orders. Be upfront about this.
- For password resets: Tell the customer you'll create a support ticket so the team can send them a reset link. Then use the create_support_ticket tool.
- For account changes: Explain that a human agent needs to handle it and offer to create a ticket.
- For order modifications: Explain this requires human intervention and offer to escalate.
- NEVER pretend you can do something you can't. It's better to say "I can't do that directly, but here's what I can do..." than to loop the customer.

WHEN CREATING SUPPORT TICKETS:
- If the customer has provided their email in the conversation, extract it and pass it to the create_support_ticket tool in the "email" parameter.
- Do NOT ask for the email again if they already provided it.
- Always include a clear subject and description based on the full conversation context.

STORE POLICIES (quick reference):
- Delivery: Same day delivery across Ghana
- Returns: Within 30 days of delivery, unused items in original packaging
- Payment: Mobile Money (MTN, Vodafone, AirtelTigo), Cash on Delivery (Accra only)
- Support hours: Mon-Sat, 8 AM - 8 PM GMT

CAPABILITIES (what you CAN do):
- Search and recommend products
- Check product availability and pricing
- Track orders by order number + email
- Show recent orders (logged-in users)
- Validate coupon/discount codes
- Create support tickets (for issues that need human help)
- Initiate returns (logged-in users, delivered orders within 30 days)
- Answer questions about shipping, returns, payment, and store info
- Look up ANY information about the website, business, policies, FAQs, and more using the get_website_info tool
- **Place orders and initiate payments** using the create_order tool

IMPORTANT — USING WEBSITE KNOWLEDGE:
When a customer asks about ANYTHING related to the business (policies, how to do something, contact info, account help, delivery zones, payment methods, returns process, FAQs, etc.), ALWAYS use the get_website_info tool first to get accurate, up-to-date information from the actual website. Do NOT rely solely on the quick reference above — use the tool for detailed answers.

CHECKOUT & ORDER PLACEMENT:
You can help customers place orders directly in this chat. Here is how:
1. The customer's current cart contents are provided in the conversation context (if they have items).
2. When the customer says they want to checkout, buy, or place an order, collect their shipping info step by step:
   - Full name (first and last)
   - Email address
   - Phone number
   - Delivery address, city, and region
3. Ask them to choose a delivery method:
   - **Standard** — GH₵20 (same day delivery)
   - **Express** — GH₵40 (same day delivery in Accra)
   - **Pickup** — Free (collect from our location)
4. Ask them to choose a payment method:
   - **Mobile Money** (MTN, Vodafone, AirtelTigo via Moolre) — default
   - **Cash on Delivery** — Accra only
5. Summarize the order (items, subtotal, delivery fee, total) and ask the customer to confirm.
6. Once confirmed, call the create_order tool with the cart items (product IDs and quantities from the cart context), shipping info, delivery method, and payment method.
7. The tool will return a payment link (for Mobile Money) — present it to the customer. For COD, just confirm the order is placed.
IMPORTANT: Do NOT ask the customer to list their cart items — you already have them. Just reference what is in their cart and proceed. If the cart is empty, tell them to add products first.

LIMITATIONS (what you CANNOT do directly):
- Reset passwords or change login credentials
- Modify or cancel existing orders
- Process refunds
- Change customer account details
- Access or change delivery addresses on active orders

WHEN YOU CANNOT HELP OR ANSWER A QUESTION:
If you genuinely cannot answer a question or resolve an issue (whether it's beyond your capabilities, the customer is frustrated, or anything else), you MUST do TWO things:
1. AUTOMATICALLY create a support ticket using the create_support_ticket tool — don't just offer to, actually do it. Use whatever info the customer already provided (email, name, issue details).
2. ALWAYS provide the customer with direct contact information for faster help. Share: Phone/WhatsApp 027 854 9831, email contact@delizbeautytools.com, or visit Madina, Ritz Junction, Accra. Say something like: "I've created a support ticket for you. For a faster response, you can also reach us at 027 854 9831 (call or WhatsApp) or contact@delizbeautytools.com."
Never leave a customer stuck without a path forward.

${getSiteMapSummary()}`;

  if (profile) {
    prompt += `\n\nCUSTOMER CONTEXT (logged in):
- Name: ${profile.name}
- Email: ${profile.email}
- Total orders: ${profile.total_orders}
- Total spent: GH₵${profile.total_spent.toFixed(2)}
- Last order: ${profile.last_order_at ? new Date(profile.last_order_at).toLocaleDateString('en-GB') : 'N/A'}
Address the customer by their first name. You can access their orders and profile directly.`;
  } else {
    prompt += `\n\nCUSTOMER CONTEXT: Guest (not logged in). For order tracking, you'll need their order number and email. Suggest signing in for a more personalized experience when relevant.`;
  }

  if (pagePath) {
    prompt += `\n\nThe customer is currently viewing: ${pagePath}`;
    if (pagePath.includes('/products/')) {
      prompt += ` — They may be interested in this specific product.`;
    } else if (pagePath.includes('/order-tracking')) {
      prompt += ` — They likely need help tracking an order.`;
    } else if (pagePath.includes('/cart') || pagePath.includes('/checkout')) {
      prompt += ` — They are in the purchasing flow; help them complete their purchase.`;
    }
  }

  return prompt;
}

// ─── Auth Detection ─────────────────────────────────────────────────────────

async function detectAuth(request: Request): Promise<{ userId: string | null; email: string | null }> {
  try {
    const cookieHeader = request.headers.get('cookie') || '';
    const authToken = cookieHeader
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith('sb-') && c.includes('-auth-token'))
      ?.split('=')
      .slice(1)
      .join('=');

    if (!authToken) return { userId: null, email: null };

    const decoded = decodeURIComponent(authToken);
    let tokenData: any;
    try {
      tokenData = JSON.parse(decoded);
    } catch {
      tokenData = decoded;
    }

    const accessToken = typeof tokenData === 'string' ? tokenData : tokenData?.[0] || tokenData?.access_token;
    if (!accessToken) return { userId: null, email: null };

    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });

    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      return { userId: user.id, email: user.email || null };
    }
  } catch (e) {
    console.error('[Chat API] Auth detection error:', e);
  }
  return { userId: null, email: null };
}

// ─── Main POST Handler ──────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const body: RequestBody = await request.json();
    const { messages = [], newMessage, sessionId, pagePath, cartItems } = body;

    const userText = (newMessage || '').trim();
    if (!userText) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    const rateLimitKey = sessionId || request.headers.get('x-forwarded-for') || 'default';
    if (!checkRateLimit(rateLimitKey)) {
      return NextResponse.json(
        { message: "You're sending messages too quickly. Please wait a moment and try again.", quickReplies: [] },
        { status: 429 }
      );
    }

    const { userId, email: userEmail } = await detectAuth(request);

    const supabase = supabaseServiceKey
      ? createClient(supabaseUrl, supabaseServiceKey)
      : createClient(supabaseUrl, supabaseKey);

    let profile: ChatCustomerProfile | null = null;
    if (userId) {
      profile = await getCustomerProfile(supabase, userId);
    }

    // Fetch AI memories for context
    let aiMemories: any[] = [];
    if (userId || userEmail) {
      try {
        const { data: memData } = await supabase.rpc('get_ai_memories', {
          p_customer_id: userId || null,
          p_customer_email: userEmail || null,
        });
        aiMemories = Array.isArray(memData) ? memData : [];
      } catch {}
    }

    // Fetch relevant KB articles from Supabase for AI context
    let kbContext = '';
    if (groqKey) {
      try {
        const searchTerms = userText.toLowerCase().split(/\s+/).filter(w => w.length > 3).slice(0, 3);
        if (searchTerms.length > 0) {
          const { data: kbArticles } = await supabase
            .from('support_knowledge_base')
            .select('title, content')
            .eq('is_published', true)
            .or(searchTerms.map(t => `title.ilike.%${t}%,content.ilike.%${t}%`).join(','))
            .limit(3);
          if (kbArticles && kbArticles.length > 0) {
            kbContext = '\n\nKNOWLEDGE BASE (use these to answer if relevant):\n' +
              kbArticles.map((a: any) => `- ${a.title}: ${a.content.slice(0, 200)}`).join('\n');
          }
        }
      } catch {}
    }

    // Also inject instant site knowledge context (fast, in-memory, no DB call)
    const siteHits = searchSiteKnowledge(userText, 2);
    if (siteHits.length > 0) {
      kbContext += '\n\nWEBSITE CONTENT (pre-fetched, use to answer immediately if relevant):\n' +
        siteHits.map(h => `[${h.title}] (${h.path}): ${h.content.slice(0, 300)}...`).join('\n');
    }

    let result: any;
    if (groqKey) {
      result = await handleWithAI(supabase, messages, userText, groqKey, userId, userEmail, profile, pagePath, aiMemories, kbContext, cartItems);
    } else {
      result = await handleWithoutAI(supabase, userText, profile);
    }

    if (sessionId) {
      persistConversation(supabase, sessionId, userId, userEmail, profile, messages, userText, result, pagePath).catch((e) =>
        console.error('[Chat API] Persistence error:', e)
      );
    }

    // Update customer insights asynchronously
    if (userId) {
      try {
        await supabase.rpc('upsert_customer_insight', {
          p_customer_id: userId,
          p_customer_email: userEmail,
          p_customer_name: profile?.name || null,
        });
      } catch {}
    }

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[Chat API] Error:', err);
    return NextResponse.json(
      { message: 'Something went wrong. Please try again.', quickReplies: ['Try again'] },
      { status: 500 }
    );
  }
}

// ─── Conversation Persistence ───────────────────────────────────────────────

async function persistConversation(
  supabase: any,
  sessionId: string,
  userId: string | null,
  userEmail: string | null,
  profile: ChatCustomerProfile | null,
  previousMessages: ChatMessage[],
  userText: string,
  result: any,
  pagePath?: string
) {
  const allMessages = [
    ...previousMessages.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userText },
    { role: 'assistant', content: result.message || '' },
  ];
  const last20 = allMessages.slice(-20);
  const messageCount = allMessages.length;

  // Basic sentiment detection from user text
  const lower = userText.toLowerCase();
  const negativeWords = ['angry', 'frustrated', 'terrible', 'horrible', 'worst', 'hate', 'bad', 'awful', 'unacceptable', 'disappointed', 'furious', 'pathetic', 'useless', 'scam', 'refund'];
  const positiveWords = ['great', 'love', 'amazing', 'excellent', 'wonderful', 'fantastic', 'awesome', 'perfect', 'thank', 'happy', 'good', 'best'];
  const negCount = negativeWords.filter(w => lower.includes(w)).length;
  const posCount = positiveWords.filter(w => lower.includes(w)).length;
  const sentiment = negCount > posCount ? 'negative' : posCount > negCount ? 'positive' : 'neutral';

  // Category detection
  let category = null;
  if (/order|track|delivery|ship/i.test(lower)) category = 'order';
  else if (/product|buy|price|stock|available/i.test(lower)) category = 'product';
  else if (/return|refund|exchange/i.test(lower)) category = 'return';
  else if (/payment|pay|money|momo/i.test(lower)) category = 'payment';
  else if (/coupon|promo|discount/i.test(lower)) category = 'coupon';
  else if (/support|help|ticket|issue|problem|complaint/i.test(lower)) category = 'support';
  else if (/shipping|deliver/i.test(lower)) category = 'shipping';

  // Intent detection
  let intent = null;
  if (result.products?.length > 0) intent = 'product_search';
  else if (result.orderCard) intent = 'order_tracking';
  else if (result.ticketCard) intent = 'support_ticket';
  else if (result.returnCard) intent = 'return_request';
  else if (result.couponCard) intent = 'coupon_check';
  else if (/\b(hi|hello|hey)\b/i.test(lower)) intent = 'greeting';
  else if (/\b(thank|bye)\b/i.test(lower)) intent = 'closing';

  // Auto-resolution: if AI provided a helpful answer (product, order, coupon info)
  const isResolved = !!(result.products?.length > 0 || result.orderCard || result.couponCard);
  const isEscalated = !!(result.ticketCard);

  // Build conversation summary from last exchange
  const summary = `Customer asked about: ${userText.slice(0, 100)}${userText.length > 100 ? '...' : ''}`;

  // Upsert with enhanced metadata (pass raw objects, not JSON.stringify - Supabase handles serialization)
  await supabase.rpc('upsert_chat_conversation', {
    p_session_id: sessionId,
    p_user_id: userId,
    p_messages: last20,
    p_metadata: {
      lastActivity: new Date().toISOString(),
      lastUserMessage: userText.slice(0, 200),
      hadProducts: (result.products?.length || 0) > 0,
      hadOrderCard: !!result.orderCard,
      hadTicket: !!result.ticketCard,
    },
  });

  // Update the enhanced columns directly
  const { data: existingConv } = await supabase
    .from('chat_conversations')
    .select('id, created_at')
    .eq('session_id', sessionId)
    .single();

  if (existingConv) {
    const durationSeconds = Math.floor((Date.now() - new Date(existingConv.created_at).getTime()) / 1000);
    await supabase.from('chat_conversations').update({
      sentiment,
      category,
      intent,
      summary,
      message_count: messageCount,
      customer_email: userEmail || profile?.email || null,
      customer_name: profile?.name || null,
      is_resolved: isResolved,
      is_escalated: isEscalated,
      escalated_at: isEscalated ? new Date().toISOString() : null,
      page_context: pagePath || null,
      duration_seconds: durationSeconds,
    }).eq('id', existingConv.id);

    // Auto-save AI memory for negative sentiment
    if (sentiment === 'negative' && (userId || userEmail)) {
      await supabase.from('ai_memory').insert({
        customer_id: userId || null,
        customer_email: userEmail || null,
        memory_type: 'issue',
        content: `Had a negative experience: "${userText.slice(0, 150)}"`,
        importance: 'high',
        source_conversation_id: existingConv.id,
      }).then(() => {}).catch(() => {});
    }

    // Auto-save preference memories from product searches
    if (category === 'product' && result.products?.length > 0 && (userId || userEmail)) {
      const productNames = result.products.slice(0, 3).map((p: any) => p.name).join(', ');
      await supabase.from('ai_memory').insert({
        customer_id: userId || null,
        customer_email: userEmail || null,
        memory_type: 'preference',
        content: `Interested in: ${productNames}`,
        importance: 'normal',
        source_conversation_id: existingConv.id,
      }).then(() => {}).catch(() => {});
    }
  }
}

// ─── Rule-Based Fallback ────────────────────────────────────────────────────

async function handleWithoutAI(supabase: any, userText: string, profile: ChatCustomerProfile | null) {
  const lower = userText.toLowerCase();

  if (/\b(hi|hello|hey|good morning|good afternoon|good evening)\b/i.test(userText)) {
    const greeting = profile ? `Hi ${profile.name.split(' ')[0]}! ` : 'Hi there! ';
    return {
      message: `${greeting}I'm your shopping assistant. I can help you find products, track orders, check stock, and more. What can I help you with?`,
      quickReplies: ['Find a product', 'Track my order', 'What do you recommend?', 'Store info'],
    };
  }

  if (/\b(track|where.*(my|is).*(order|package)|order status)\b/i.test(lower)) {
    return {
      message: 'I can help you track your order! Please provide your order number (e.g. ORD-xxx) and the email address you used when ordering.',
      quickReplies: ['I have my order number', 'I forgot my order number'],
    };
  }

  if (/\b(shipping|delivery|how long|deliver)\b/i.test(lower)) {
    return {
      message: getStoreInfo('shipping'),
      quickReplies: ['Delivery times', 'Payment methods', 'Returns policy'],
    };
  }

  if (/\b(return|refund|exchange)\b/i.test(lower)) {
    return {
      message: getStoreInfo('returns'),
      quickReplies: ['Start a return', 'Track my order', 'Contact support'],
    };
  }

  if (/\b(pay|payment|mobile money|momo|cash on delivery)\b/i.test(lower)) {
    return {
      message: getStoreInfo('payment'),
      quickReplies: ['Shipping info', 'Find a product'],
    };
  }

  if (/\b(contact|support|human|agent|speak|talk|help me)\b/i.test(lower)) {
    return {
      message: getStoreInfo('contact'),
      quickReplies: ['Create a support ticket', 'Track my order', 'Find a product'],
    };
  }

  if (/\b(recommend|popular|bestseller|suggest|trending)\b/i.test(lower)) {
    const products = await getRecommendations(supabase);
    if (products.length > 0) {
      const actions: ChatAction[] = products.filter((p) => p.inStock).map((p) => ({ type: 'add_to_cart' as const, product: p }));
      return {
        message: 'Here are some of our top picks:',
        products,
        actions,
        quickReplies: ['Show me more', 'Search for something specific'],
      };
    }
  }

  if (/\b(coupon|promo|discount|code)\b/i.test(lower)) {
    return {
      message: 'I can check a coupon code for you! Just tell me the code and I\'ll verify if it\'s valid.',
      quickReplies: ['I have a code', 'Find a product', 'What deals are available?'],
    };
  }

  if (/\b(thanks|thank you|bye|goodbye)\b/i.test(lower)) {
    return {
      message: 'You\'re welcome! If you need anything else, I\'m always here to help. Happy shopping!',
      quickReplies: ['Find a product', 'Track my order'],
    };
  }

  const isSearch = /\b(available|stock|have|find|search|look|buy|price|how much|get|show|want)\b/i.test(userText) ||
    (userText.length > 2 && !userText.endsWith('?'));

  if (isSearch || lower.includes('product') || lower.includes('item')) {
    const query = userText
      .replace(/\b(do you have|is there|are there|show me|find|search|available|in stock|price|how much|get|buy|i want|i need)\b/gi, '')
      .replace(/\?/g, '')
      .trim() || ' ';

    const products = await searchProducts(supabase, query, 4);
    if (products.length > 0) {
      const actions: ChatAction[] = products.filter((p) => p.inStock).map((p) => ({ type: 'add_to_cart' as const, product: p }));
      return {
        message: `Here's what I found:`,
        products,
        actions,
        quickReplies: ['Show me more', 'Add to cart', 'Something else'],
      };
    }
  }

  const fallback = await searchProducts(supabase, userText.slice(0, 50), 3);
  if (fallback.length > 0) {
    const actions: ChatAction[] = fallback.filter((p) => p.inStock).map((p) => ({ type: 'add_to_cart' as const, product: p }));
    return {
      message: 'I found these products that might interest you:',
      products: fallback,
      actions,
      quickReplies: ['Search for something else', 'Track my order', 'Store info'],
    };
  }

  return {
    message: "I'm not quite sure what you're looking for. I can help with:\n- Finding and buying products\n- Tracking orders\n- Checking coupons\n- Store policies and info\n- Creating support tickets\n\nFor immediate assistance, call or WhatsApp 027 854 9831 or email contact@delizbeautytools.com.",
    quickReplies: ['Find a product', 'Track my order', 'What do you recommend?', 'Call us'],
  };
}

// ─── AI Handler with Function Calling (Groq) ───────────────────────────────

async function handleWithAI(
  supabase: any,
  messages: ChatMessage[],
  userText: string,
  apiKey: string,
  userId: string | null,
  userEmail: string | null,
  profile: ChatCustomerProfile | null,
  pagePath?: string,
  aiMemories?: any[],
  kbContext?: string,
  cartItems?: { id: string; name: string; price: number; quantity: number; slug: string }[],
) {
  let systemPrompt = buildSystemPrompt(profile, pagePath);

  // Inject AI memories into system prompt
  if (aiMemories && aiMemories.length > 0) {
    systemPrompt += '\n\nCUSTOMER MEMORY (things you remember about this customer from past conversations):';
    for (const mem of aiMemories.slice(0, 10)) {
      systemPrompt += `\n- [${mem.type}] ${mem.content}`;
    }
    systemPrompt += '\nUse these memories to provide personalized service. Reference past interactions naturally.';
  }

  // Inject KB context
  if (kbContext) {
    systemPrompt += kbContext;
  }

  // Inject cart context so AI knows what the customer wants to buy
  if (cartItems && cartItems.length > 0) {
    const cartTotal = cartItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
    systemPrompt += `\n\nCUSTOMER'S CURRENT CART (${cartItems.length} item${cartItems.length > 1 ? 's' : ''}, subtotal GH₵${cartTotal.toFixed(2)}):`;
    for (const item of cartItems) {
      systemPrompt += `\n- ${item.name} × ${item.quantity} = GH₵${(item.price * item.quantity).toFixed(2)} (ID: ${item.id})`;
    }
    systemPrompt += `\nWhen the customer wants to checkout, use these product IDs and quantities for the create_order tool.`;
  }

  const truncatedHistory = messages.slice(-18);

  const llmMessages: { role: MessageRole; content: string; tool_call_id?: string; name?: string }[] = [
    { role: 'system', content: systemPrompt },
    ...truncatedHistory.map((m) => ({ role: m.role as MessageRole, content: m.content })),
    { role: 'user', content: userText },
  ];

  let allProducts: ChatProduct[] = [];
  let allActions: ChatAction[] = [];
  let orderCard: ChatOrder | undefined;
  let ticketCard: ChatTicket | undefined;
  let returnCard: ChatReturn | undefined;
  let couponCard: ChatCoupon | undefined;
  let quickReplies: string[] = [];
  let paymentAction: ChatAction | undefined;

  try {
    const res = await fetchWithRetry(LLM_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: llmMessages,
        tools: LLM_TOOLS,
        tool_choice: 'auto',
        max_completion_tokens: 1024,
        temperature: 0.6,
        top_p: 1,
      }),
    });

    if (!res.ok) {
      console.error('[Chat API] Groq error:', await res.text());
      return await handleWithoutAI(supabase, userText, profile);
    }

    let data = await res.json();
    let choice = data.choices?.[0];
    let toolCalls = choice?.message?.tool_calls;

    // Handle tool calls (support up to 3 rounds of tool calling for multi-step tasks)
    let rounds = 0;
    while (Array.isArray(toolCalls) && toolCalls.length > 0 && rounds < 3) {
      rounds++;

      llmMessages.push(choice.message);

      for (const tc of toolCalls) {
        const fnName = tc.function?.name;
        let args: any = {};
        try { args = JSON.parse(tc.function?.arguments || '{}'); } catch {}

        const toolResult = await executeToolCall(supabase, fnName, args, userId, userEmail, profile, cartItems);

        if (toolResult.products) allProducts.push(...toolResult.products);
        if (toolResult.orderCard) orderCard = toolResult.orderCard;
        if (toolResult.ticketCard) ticketCard = toolResult.ticketCard;
        if (toolResult.returnCard) returnCard = toolResult.returnCard;
        if (toolResult.couponCard) couponCard = toolResult.couponCard;
        if (toolResult.quickReplies) quickReplies = toolResult.quickReplies;
        if (toolResult.paymentAction) paymentAction = toolResult.paymentAction;

        llmMessages.push({
          role: 'tool',
          content: JSON.stringify(toolResult.data),
          tool_call_id: tc.id,
        });
      }

      const followUpRes = await fetchWithRetry(LLM_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: LLM_MODEL,
          messages: llmMessages,
          tools: LLM_TOOLS,
          tool_choice: 'auto',
          max_completion_tokens: 1024,
          temperature: 0.6,
          top_p: 1,
        }),
      });

      if (!followUpRes.ok) break;
      data = await followUpRes.json();
      choice = data.choices?.[0];
      toolCalls = choice?.message?.tool_calls;
    }

    let assistantContent = choice?.message?.content?.trim() || '';

    // Strip any leaked reasoning/thinking blocks from the response
    assistantContent = assistantContent
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/## Step \d+:.*$/gm, '')
      .replace(/^Step \d+:.*$/gm, '')
      .replace(/^Let's get started!?\s*/gm, '')
      .replace(/^#{1,6}\s+/gm, '')
      .trim();

    // If the AI returned empty content, generate a contextual fallback instead of a generic message
    if (!assistantContent) {
      if (ticketCard) {
        assistantContent = `I've created a support ticket for you. Our team will follow up shortly.`;
      } else if (orderCard) {
        assistantContent = `Here are the details for your order.`;
      } else if (allProducts.length > 0) {
        assistantContent = `Here's what I found for you:`;
      } else if (couponCard) {
        assistantContent = `Here's the coupon information:`;
      } else {
        assistantContent = `I'm sorry, I wasn't able to process that properly. You can try rephrasing your request, or for immediate help reach us at 027 854 9831 (call or WhatsApp) or contact@delizbeautytools.com. Our team is available Mon-Sat, 8am-8pm GMT.`;
      }
    }

    allActions = allProducts.filter((p) => p.inStock).map((p) => ({ type: 'add_to_cart' as const, product: p }));
    if (paymentAction) allActions.push(paymentAction);

    if (!quickReplies.length) {
      quickReplies = generateQuickReplies(userText, allProducts, orderCard, ticketCard);
    }

    return {
      message: assistantContent,
      products: allProducts.length > 0 ? allProducts : undefined,
      actions: allActions.length > 0 ? allActions : undefined,
      orderCard,
      ticketCard,
      returnCard,
      couponCard,
      quickReplies,
    };
  } catch (err: any) {
    console.error('[Chat API] AI handler error:', err);
    return await handleWithoutAI(supabase, userText, profile);
  }
}

// ─── Tool Call Executor ─────────────────────────────────────────────────────

async function executeToolCall(
  supabase: any,
  fnName: string,
  args: any,
  userId: string | null,
  userEmail: string | null,
  profile: ChatCustomerProfile | null,
  cartItems?: { id: string; name: string; price: number; quantity: number; slug: string }[],
): Promise<{
  data: any;
  products?: ChatProduct[];
  orderCard?: ChatOrder;
  ticketCard?: ChatTicket;
  returnCard?: ChatReturn;
  couponCard?: ChatCoupon;
  paymentAction?: ChatAction;
  quickReplies?: string[];
}> {
  switch (fnName) {
    case 'search_products': {
      const products = await searchProducts(supabase, args.query, 4);
      return {
        data: products.map((p) => ({ name: p.name, price: p.price, inStock: p.inStock, slug: p.slug })),
        products,
        quickReplies: products.length > 0 ? ['Show me more', 'Add to cart'] : ['Try different search', 'What do you recommend?'],
      };
    }

    case 'get_product_for_cart': {
      const product = await getProductForCart(supabase, args.slug_or_id);
      return {
        data: product ? { name: product.name, price: product.price, inStock: product.inStock } : { error: 'Product not found' },
        products: product ? [product] : undefined,
      };
    }

    case 'track_order': {
      const order = await trackOrder(supabase, args.order_number, args.email);
      if (!order) {
        return { data: { error: 'Order not found. Please check the order number and email address.' }, quickReplies: ['Try again', 'Contact support'] };
      }
      return {
        data: {
          order_number: order.order_number,
          status: order.status,
          total: order.total,
          tracking_number: order.tracking_number,
          items: order.items.slice(0, 5),
          created_at: order.created_at,
        },
        orderCard: order,
        quickReplies: ['I have an issue with this order', 'Track another order'],
      };
    }

    case 'get_customer_orders': {
      if (!userId) {
        return { data: { error: 'You need to be logged in to view your orders. Please sign in first.' }, quickReplies: ['Sign in', 'Track order by number'] };
      }
      const orders = await getCustomerOrders(supabase, userId, args.limit || 5);
      return {
        data: orders.map((o) => ({ order_number: o.order_number, status: o.status, total: o.total, date: o.created_at, items_count: o.items.length })),
        orderCard: orders[0],
        quickReplies: orders.length > 0 ? ['Track an order', 'Reorder'] : ['Browse products'],
      };
    }

    case 'check_coupon': {
      const coupon = await checkCoupon(supabase, args.code, args.cart_total);
      return {
        data: coupon,
        couponCard: coupon,
        quickReplies: coupon.valid ? ['Apply at checkout', 'Continue shopping'] : ['Try another code', 'Find a product'],
      };
    }

    case 'create_support_ticket': {
      // Use email from: 1) tool call args (user provided in chat), 2) auth session, 3) profile
      const email = args.email || userEmail || profile?.email || '';
      if (!email) {
        return {
          data: { error: 'I need an email address to create a support ticket. Please ask the customer for their email and include it when calling this tool.' },
          quickReplies: ['I\'ll provide my email'],
        };
      }
      const ticket = await createSupportTicket(supabase, {
        userId: userId || undefined,
        email,
        subject: args.subject,
        description: args.description,
        category: args.category,
      });
      if (!ticket) {
        return { data: { error: 'Failed to create ticket. Please try again.' }, quickReplies: ['Try again', 'Contact us directly'] };
      }
      return {
        data: { ticket_number: ticket.ticket_number, subject: ticket.subject, status: ticket.status, email_used: email },
        ticketCard: ticket,
        quickReplies: ['Continue shopping', 'Track my order'],
      };
    }

    case 'initiate_return': {
      if (!userId) {
        return { data: { error: 'You need to be logged in to initiate a return. Please sign in first.' }, quickReplies: ['Sign in', 'Contact support'] };
      }
      const ret = await initiateReturn(supabase, {
        userId,
        orderId: args.order_id,
        reason: args.reason,
        description: args.description || args.reason,
      });
      if (!ret) {
        return { data: { error: 'Could not create return request. The order may not be eligible (must be delivered within 30 days).' }, quickReplies: ['Check eligibility', 'Contact support'] };
      }
      return {
        data: { id: ret.id, status: ret.status, order_number: ret.order_number },
        returnCard: ret,
        quickReplies: ['Continue shopping', 'View my orders'],
      };
    }

    case 'get_recommendations': {
      const products = await getRecommendations(supabase, args.context);
      return {
        data: products.map((p) => ({ name: p.name, price: p.price, inStock: p.inStock, slug: p.slug })),
        products,
        quickReplies: ['Show me more', 'Search for something specific'],
      };
    }

    case 'get_store_info': {
      const info = getStoreInfo(args.topic);
      // Also include relevant site knowledge for richer answers
      const siteResults = searchSiteKnowledge(args.topic || '', 2);
      const extraInfo = siteResults.map(r => r.content).join('\n\n');
      return {
        data: { topic: args.topic, info, additional_details: extraInfo || undefined },
        quickReplies: ['Shipping', 'Returns', 'Payment', 'Contact'].filter((r) => r.toLowerCase() !== args.topic?.toLowerCase()),
      };
    }

    case 'get_customer_profile': {
      if (!userId || !profile) {
        return { data: { error: 'Not logged in' } };
      }
      return { data: { name: profile.name, email: profile.email, total_orders: profile.total_orders } };
    }

    case 'get_website_info': {
      const results = searchSiteKnowledge(args.query, 3);
      if (results.length === 0) {
        return {
          data: { message: 'No specific information found for that query. Try rephrasing or ask the customer to visit the Help Center at /help for more details.' },
          quickReplies: ['Visit Help Center', 'Contact support'],
        };
      }
      return {
        data: {
          results: results.map(r => ({
            title: r.title,
            page: r.path,
            content: r.content,
          })),
        },
      };
    }

    case 'create_order': {
      const orderResult = await createChatOrder(supabase, {
        items: args.items || [],
        shipping: args.shipping || {},
        deliveryMethod: args.delivery_method || 'standard',
        paymentMethod: args.payment_method || 'moolre',
        userId,
      });

      const result: {
        data: any;
        paymentAction?: ChatAction;
        quickReplies?: string[];
      } = {
        data: {
          success: orderResult.success,
          orderNumber: orderResult.orderNumber,
          total: orderResult.total,
          message: orderResult.message,
          hasPaymentUrl: !!orderResult.paymentUrl,
        },
        quickReplies: orderResult.success ? ['Continue shopping'] : ['Try again', 'Use checkout page'],
      };

      if (orderResult.paymentUrl) {
        result.paymentAction = {
          type: 'payment_link',
          paymentUrl: orderResult.paymentUrl,
          orderNumber: orderResult.orderNumber,
          label: `Pay GH₵${orderResult.total?.toFixed(2)} Now`,
        };
      }

      return result;
    }

    default:
      return { data: { error: `Unknown tool: ${fnName}` } };
  }
}

// ─── Quick Reply Generator ──────────────────────────────────────────────────

function generateQuickReplies(
  userText: string,
  products: ChatProduct[],
  orderCard?: ChatOrder,
  ticketCard?: ChatTicket
): string[] {
  if (ticketCard) return ['Continue shopping', 'Track my order'];
  if (orderCard) return ['I have an issue', 'Track another order', 'Continue shopping'];
  if (products.length > 0) return ['Add to cart', 'Show me more', 'Something else'];

  const lower = userText.toLowerCase();
  if (/\b(hi|hello|hey)\b/.test(lower)) return ['Find a product', 'Track my order', 'What do you recommend?'];
  if (/\b(thank|bye)\b/.test(lower)) return ['Find a product', 'Track my order'];

  return ['Find a product', 'Track my order', 'Store info', 'What do you recommend?'];
}

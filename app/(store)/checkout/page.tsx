'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import CheckoutSteps from '@/components/CheckoutSteps';
import OrderSummary from '@/components/OrderSummary';
import { useCart } from '@/context/CartContext';
import { supabase } from '@/lib/supabase';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useRecaptcha } from '@/hooks/useRecaptcha';

export default function CheckoutPage() {
  usePageTitle('Checkout');
  const router = useRouter();
  const { cart, subtotal: cartSubtotal, clearCart } = useCart();

  const [currentStep, setCurrentStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [checkoutType, setCheckoutType] = useState<'guest' | 'account'>('guest');
  const [saveAddress, setSaveAddress] = useState(false);
  const [savePayment, setSavePayment] = useState(false);
  const [user, setUser] = useState<any>(null);
  const { getToken, verifying } = useRecaptcha();

  const [shippingData, setShippingData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    region: ''
  });

  // Ghana Regions for dropdown
  const ghanaRegions = [
    'Greater Accra',
    'Ashanti',
    'Western',
    'Central',
    'Eastern',
    'Northern',
    'Volta',
    'Upper East',
    'Upper West',
    'Brong-Ahafo',
    'Ahafo',
    'Bono',
    'Bono East',
    'North East',
    'Savannah',
    'Oti',
    'Western North'
  ];

  const ghanaCitiesByRegion: Record<string, string[]> = {
    'Greater Accra': [
      'Accra Central', 'Adabraka', 'Adenta', 'Agbogbloshie', 'Airport Residential', 'Achimota',
      'Ashaiman', 'Ayawaso', 'Baatsonaa', 'Cantonments', 'Darkuman', 'Dansoman', 'Dome',
      'Dzorwulu', 'East Legon', 'Gbawe', 'Haatso', 'James Town', 'Kasoa', 'Kpone',
      'La', 'Labone', 'Labadi', 'Lashibi', 'Madina', 'Mamprobi', 'Nima', 'North Kaneshie',
      'Nungua', 'Odorkor', 'Osu', 'Oyarifa', 'Prampram', 'Roman Ridge', 'Sakumono',
      'Shiashie', 'Spintex', 'Teshie', 'Tema', 'Tema Community 1–25', 'Tesano', 'Tudu',
      'Weija', 'West Hills', 'Sowutuom', 'Awoshie', 'Pokuase', 'Amasaman', 'Dodowa',
      'Aburi', 'Nsawam (GA East)', 'Shai Hills', 'Kwabenya', 'Taifa', 'Tantra Hill',
    ],
    'Ashanti': [
      'Kumasi Central', 'Adum', 'Asokwa', 'Bantama', 'Bohyen', 'Dichemso', 'Danyame',
      'Ejisu', 'Ejura', 'Fanteakwa', 'Juaben', 'Kaase', 'Kenyasi', 'Konongo', 'Kotei',
      'Kwadaso', 'Mampong', 'Manhyia', 'Nhyiaeso', 'Obuasi', 'Odumase', 'Offinso',
      'Old Tafo', 'Patasi', 'Suame', 'Atwima Kwanwoma', 'Atwima Mponua', 'Bekwai',
      'Agogo', 'Asante Mampong', 'Ashanti Bekwai', 'Bosome Freho', 'Bosomtwe',
      'Kwabre East', 'Afigya Kwabre', 'Ahafo Ano', 'Amansie', 'Sekyere',
    ],
    'Western': [
      'Sekondi', 'Takoradi', 'Effia', 'Essikado', 'Kwesimintsim', 'Sekondi-Takoradi',
      'Tarkwa', 'Prestea', 'Bogoso', 'Axim', 'Nkroful', 'Half Assini', 'Elubo',
      'Enchi (Aowin)', 'Jomoro', 'Mpohor', 'Shama', 'Agona Nkwanta', 'Ankobra',
      'Dixcove', 'Princes Town', 'Beyin', 'Tikobo', 'Wassa Amenfi', 'Wassa East',
    ],
    'Western North': [
      'Sefwi Wiawso', 'Bibiani', 'Anhwiaso', 'Bekwai', 'Juaboso', 'Dadieso',
      'Bodi', 'Sefwi Akontombra', 'Sefwi Bekwai', 'Bia East', 'Bia West',
      'Amenfi Central', 'Amenfi East', 'Amenfi West',
    ],
    'Central': [
      'Cape Coast', 'Kasoa', 'Winneba', 'Mankessim', 'Elmina', 'Assin Fosu',
      'Swedru', 'Saltpond', 'Agona Swedru', 'Anomabo', 'Breman Asikuma',
      'Dunkwa-on-Offin', 'Gomoa Fetteh', 'Mumford', 'Apam', 'Eguafo',
      'Ajumako', 'Asikuma', 'Hemang', 'Twifo Praso', 'Assin North', 'Assin South',
      'Effutu', 'Gomoa East', 'Gomoa West', 'Mfantsiman', 'Upper Denkyira',
    ],
    'Eastern': [
      'Koforidua', 'Nkawkaw', 'Suhum', 'Akim Oda', 'Nsawam', 'Aburi', 'Akosombo',
      'Asamankese', 'Akim Tafo', 'Atibie', 'Begoro', 'Donkorkrom', 'Kade',
      'Kpong', 'Kukurantumi', 'Mpraeso', 'Nkurakan', 'Somanya', 'Osino',
      'Bunso', 'Kibi', 'Asiakwa', 'Juapong', 'Achiase', 'Kwahu Praso',
      'Adukrom', 'Akim Kotoku', 'Fanteakwa', 'New Juaben', 'Yilo Krobo',
      'Lower Manya Krobo', 'Upper Manya Krobo',
    ],
    'Volta': [
      'Ho', 'Hohoe', 'Keta', 'Aflao', 'Denu', 'Anloga', 'Kpando', 'Sogakope',
      'Akatsi', 'Dzodze', 'Kpetoe', 'Kpeve', 'Peki', 'Adidome', 'Battor',
      'Dabala', 'Juapong', 'Kpong', 'Mepe', 'Tefle', 'Tsito', 'Vane', 'Wheta',
      'Have', 'Jasikan (Volta)', 'Kadjebi (Volta)', 'Avatime', 'Tafi Atome',
      'Klikor', 'Abor', 'Agbozume', 'Ave Dakpa',
    ],
    'Oti': [
      'Dambai', 'Jasikan', 'Kadjebi', 'Nkwanta', 'Kpassa', 'Chinderi',
      'Buem', 'Nkwanta North', 'Nkwanta South', 'Kete Krachi', 'Krachi East',
      'Krachi West', 'Krachi Nchumuru', 'Biakoye',
    ],
    'Northern': [
      'Tamale', 'Savelugu', 'Yendi', 'Bimbilla', 'Gushegu', 'Karaga',
      'Kpandai', 'Nanton', 'Sagnarigu', 'Tolon', 'Kumbungu', 'Mion',
      'Tatale Sanguli', 'Zabzugu', 'Nanumba North', 'Nanumba South',
      'East Mamprusi (North)', 'West Mamprusi (North)', 'Chereponi (North)',
    ],
    'North East': [
      'Nalerigu', 'Gambaga', 'Walewale', 'Chereponi', 'Bunkpurugu',
      'Yunyoo', 'East Mamprusi', 'West Mamprusi', 'Mamprugu Moagduri',
      'Bunkpurugu-Nakpayili',
    ],
    'Savannah': [
      'Damongo', 'Bole', 'Sawla', 'Tuna', 'Kalba', 'Busunu', 'Laribanga',
      'Yapei', 'Buipe', 'Fufulso', 'Salaga', 'East Gonja', 'West Gonja',
      'Central Gonja', 'North Gonja', 'Bole District', 'Sawla-Tuna-Kalba',
    ],
    'Upper East': [
      'Bolgatanga', 'Bawku', 'Navrongo', 'Zebilla', 'Paga', 'Bongo',
      'Binduri', 'Bolgatanga Municipal', 'Builsa North', 'Builsa South',
      'Garu', 'Kassena Nankana', 'Nabdam', 'Pusiga', 'Talensi',
      'Tempane', 'Bawku Municipal', 'Bawku West', 'Sandema', 'Fumbisi',
    ],
    'Upper West': [
      'Wa', 'Lawra', 'Jirapa', 'Tumu', 'Nandom', 'Gwolu', 'Hamile',
      'Funsi', 'Kaleo', 'Lambussie', 'Nadowli', 'Daffiama', 'Issa',
      'Bussie', 'Wa Municipal', 'Wa East', 'Wa West', 'Sisala East',
      'Sisala West', 'Sissala', 'Daffiama-Bussie-Issa',
    ],
    'Brong-Ahafo': [
      'Sunyani', 'Techiman', 'Berekum', 'Dormaa Ahenkro', 'Wenchi',
      'Kintampo', 'Nkoranza', 'Yeji', 'Atebubu', 'Drobo', 'Fiapre',
      'Jaman North', 'Jaman South', 'Tain', 'Pru', 'Sene', 'Banda',
    ],
    'Ahafo': [
      'Goaso', 'Kukuom', 'Bechem', 'Duayaw Nkwanta', 'Kenyasi',
      'Acherensua', 'Hwediem', 'Mim', 'Asunafo North', 'Asunafo South',
      'Asutifi North', 'Asutifi South', 'Tano North', 'Tano South',
    ],
    'Bono': [
      'Sunyani', 'Berekum', 'Dormaa Ahenkro', 'Dormaa East', 'Wenchi',
      'Tain', 'Banda', 'Nkoranza', 'Jaman North', 'Jaman South',
      'Drobo', 'Fiapre', 'Odumase', 'Seikwa', 'Sampa',
    ],
    'Bono East': [
      'Techiman', 'Kintampo', 'Atebubu', 'Nkoranza', 'Yeji',
      'Pru East', 'Pru West', 'Sene East', 'Sene West',
      'Techiman North', 'Kintampo North', 'Kintampo South',
      'Nkoranza North', 'Nkoranza South', 'Atebubu-Amantin',
    ],
  };

  const [deliveryMethod, setDeliveryMethod] = useState('pickup');
  const [paymentMethod, setPaymentMethod] = useState('moolre');
  const [errors, setErrors] = useState<any>({});



  // Check auth and cart
  useEffect(() => {
    async function checkUser() {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setUser(session.user);
        setCheckoutType('account'); // Auto-select account checkout if logged in
        // Pre-fill email if available
        setShippingData(prev => ({ ...prev, email: session.user.email || '' }));
      }
    }
    checkUser();

    // Small delay to ensure cart load
    const timer = setTimeout(() => {
      if (cart.length === 0 && !isLoading) {
        // router.push('/cart'); // Optional: redirect if empty
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [cart, router, isLoading]);

  // Scroll to top when step changes
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [currentStep]);

  // Calculate Totals
  const subtotal = cartSubtotal;
  const shippingCost = 0; // Delivery options temporarily disabled
  const tax = 0; // No Tax
  const total = subtotal + shippingCost + tax;

  const validateShipping = () => {
    const newErrors: any = {};
    if (!shippingData.firstName) newErrors.firstName = 'First name is required';
    if (!shippingData.lastName) newErrors.lastName = 'Last name is required';
    if (shippingData.email && !/\S+@\S+\.\S+/.test(shippingData.email)) newErrors.email = 'Invalid email format';
    if (!shippingData.phone) {
      newErrors.phone = 'Phone number is required';
    } else {
      const digits = shippingData.phone.replace(/\D/g, '');
      const valid =
        (digits.length === 10 && digits.startsWith('0')) ||
        (digits.length === 12 && digits.startsWith('233'));
      if (!valid) {
        newErrors.phone = 'Enter a valid 10-digit Ghana number (e.g. 0551234567)';
      }
    }
    if (!shippingData.address) newErrors.address = 'Address is required';
    if (!shippingData.city) newErrors.city = 'City is required';
    if (!shippingData.region) newErrors.region = 'Region is required';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleContinueToDelivery = () => {
    if (validateShipping()) {
      setCurrentStep(2);
    }
  };

  const handleContinueToPayment = async () => {
    // Skip step 3 and directly initiate payment with default method (Moolre/Mobile Money)
    await handlePlaceOrder();
  };



  const handlePlaceOrder = async () => {
    if (cart.length === 0) {
      alert('Your cart is empty');
      return;
    }

    // Block checkout if any item has no price / a price of 0.
    const unpriced = cart.filter((item) => {
      const price = Number(item.price);
      return !Number.isFinite(price) || price <= 0;
    });
    if (unpriced.length > 0) {
      alert(
        `These items are unavailable for purchase and must be removed from your cart:\n\n${unpriced
          .map((i) => `• ${i.name}`)
          .join('\n')}`
      );
      return;
    }

    setIsLoading(true);

    // reCAPTCHA verification
    const isHuman = await getToken('checkout');
    if (!isHuman) {
      alert('Security verification failed. Please try again.');
      setIsLoading(false);
      return;
    }

    try {
      const orderNumber = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      // Generate tracking number: SLI-XXXXXX (6-char alphanumeric)
      const trackingId = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
      const trackingNumber = `SLI-${trackingId}`;

      // Normalize phone to 0XXXXXXXXX format
      const phoneDigits = shippingData.phone.replace(/\D/g, '');
      const normalizedPhone = phoneDigits.length === 12 && phoneDigits.startsWith('233')
        ? '0' + phoneDigits.slice(3)
        : phoneDigits;

      // 1–3. Create Order, Items, and Customer via server-side API (bypasses RLS)
      const checkoutRes = await fetch('/api/storefront/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderNumber,
          trackingNumber,
          userId: user?.id || null,
          email: shippingData.email,
          phone: normalizedPhone,
          subtotal,
          tax,
          shippingCost,
          total,
          deliveryMethod,
          paymentMethod,
          shippingData,
          cart: cart.map(item => ({
            id: item.id,
            name: item.name,
            variant: item.variant || null,
            quantity: item.quantity,
            price: item.price,
            image: item.image,
            slug: item.slug,
          })),
        }),
      });

      const checkoutResult = await checkoutRes.json();
      if (!checkoutRes.ok) throw new Error(checkoutResult.error || 'Failed to place order');
      const order = checkoutResult.order;

      // 4. Handle Payment Redirects or Completion
      if (paymentMethod === 'moolre') {
        try {
          // Payment link reminder will be sent automatically after 15 mins if unpaid (via cron)

          const paymentRes = await fetch('/api/payment/moolre', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orderId: orderNumber,
              amount: total,
              customerEmail: shippingData.email
            })
          });

          const paymentResult = await paymentRes.json();

          if (!paymentResult.success) {
            throw new Error(paymentResult.message || 'Payment initialization failed');
          }

          // Clear cart before redirecting
          clearCart();

          // Redirect to Moolre
          window.location.href = paymentResult.url;
          return;

        } catch (paymentErr: any) {
          console.error('Payment Error:', paymentErr);
          alert('Failed to initialize payment: ' + paymentErr.message);
          setIsLoading(false);
          return; // Stop execution
        }
      }

      // 5. Send Notifications (For COD or others)
      fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'order_created',
          payload: order
        })
      }).catch(err => console.error('Notification trigger error:', err));

      // 6. Clear Cart & Redirect (For COD)
      clearCart();
      router.push(`/order-success?order=${orderNumber}`);

    } catch (err: any) {
      console.error('Checkout error:', err);
      alert('Failed to place order: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  if (cart.length === 0 && !isLoading) {
    return (
      <main className="min-h-screen bg-gray-50 py-20">
        <div className="max-w-md mx-auto text-center px-4">
          <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm">
            <i className="ri-shopping-cart-line text-4xl text-gray-300"></i>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Your cart is empty</h1>
          <p className="text-gray-600 mb-8">Add some items to start the checkout process.</p>
          <Link href="/shop" className="inline-block bg-gray-900 text-white px-8 py-3 rounded-lg font-semibold hover:bg-gray-800 transition-colors">
            Return to Shop
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-8">
          <Link href="/cart" className="text-gray-600 hover:text-gray-900 font-medium inline-flex items-center whitespace-nowrap">
            <i className="ri-arrow-left-line mr-2"></i>
            Back to Cart
          </Link>
        </div>

        <h1 className="text-3xl font-bold text-gray-900 mb-8">Checkout</h1>

        {currentStep === 1 && (
          <div className="mb-8 bg-white rounded-xl shadow-sm p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-6">Checkout As</h2>
            <div className="grid md:grid-cols-2 gap-4">
              <button
                onClick={() => !user && setCheckoutType('guest')}
                className={`p-6 rounded-xl border-2 transition-all text-left cursor-pointer ${checkoutType === 'guest'
                  ? 'border-gray-900 bg-gray-100'
                  : 'border-gray-200 hover:border-gray-300'
                  } ${user ? 'opacity-50 cursor-not-allowed' : ''}`}
                disabled={!!user}
              >
                <div className="flex items-center justify-between mb-3">
                  <i className="ri-user-line text-3xl text-gray-900"></i>
                  <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${checkoutType === 'guest' ? 'border-gray-900 bg-gray-900' : 'border-gray-300'
                    }`}>
                    {checkoutType === 'guest' && <i className="ri-check-line text-white text-sm"></i>}
                  </div>
                </div>
                <h3 className="text-lg font-bold text-gray-900 mb-2">Guest Checkout</h3>
                <p className="text-sm text-gray-600">Quick checkout without creating an account</p>
                {user && <p className="text-xs text-gray-700 mt-2">You are logged in</p>}
              </button>

              <button
                onClick={() => setCheckoutType('account')}
                className={`p-6 rounded-xl border-2 transition-all text-left cursor-pointer ${checkoutType === 'account'
                  ? 'border-gray-900 bg-gray-100'
                  : 'border-gray-200 hover:border-gray-300'
                  }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <i className="ri-account-circle-line text-3xl text-gray-900"></i>
                  <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${checkoutType === 'account' ? 'border-gray-900 bg-gray-900' : 'border-gray-300'
                    }`}>
                    {checkoutType === 'account' && <i className="ri-check-line text-white text-sm"></i>}
                  </div>
                </div>
                <h3 className="text-lg font-bold text-gray-900 mb-2">{user ? 'My Account' : 'Create Account'}</h3>
                <p className="text-sm text-gray-600">
                  {user ? `Logged in as ${user.email}` : 'Save info, track orders & earn loyalty points'}
                </p>
              </button>
            </div>
          </div>
        )}

        <CheckoutSteps currentStep={currentStep} />

        <div className="grid lg:grid-cols-3 gap-8 mt-8">
          <div className="lg:col-span-2">
            {currentStep === 1 && (
              <>
                <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
                  <h2 className="text-xl font-bold text-gray-900 mb-6">Shipping Information</h2>

                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-semibold text-gray-900 mb-2">
                          First Name *
                        </label>
                        <input
                          type="text"
                          value={shippingData.firstName}
                          onChange={(e) => setShippingData({ ...shippingData, firstName: e.target.value })}
                          className={`w-full px-4 py-3 border-2 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-gray-900 ${errors.firstName ? 'border-red-500' : 'border-gray-300'
                            }`}
                          placeholder="John"
                        />
                        {errors.firstName && <p className="text-sm text-red-600 mt-1">{errors.firstName}</p>}
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-gray-900 mb-2">
                          Last Name *
                        </label>
                        <input
                          type="text"
                          value={shippingData.lastName}
                          onChange={(e) => setShippingData({ ...shippingData, lastName: e.target.value })}
                          className={`w-full px-4 py-3 border-2 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-gray-900 ${errors.lastName ? 'border-red-500' : 'border-gray-300'
                            }`}
                          placeholder="Doe"
                        />
                        {errors.lastName && <p className="text-sm text-red-600 mt-1">{errors.lastName}</p>}
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-900 mb-2">
                        Email Address <span className="text-gray-400 font-normal text-xs">(optional)</span>
                      </label>
                      <input
                        type="email"
                        value={shippingData.email}
                        readOnly={!!user}
                        onChange={(e) => setShippingData({ ...shippingData, email: e.target.value })}
                        className={`w-full px-4 py-3 border-2 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-gray-900 ${errors.email ? 'border-red-500' : 'border-gray-300'
                          } ${user ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                        placeholder="you@example.com"
                      />
                      {errors.email && <p className="text-sm text-red-600 mt-1">{errors.email}</p>}
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-900 mb-2">
                        Phone Number *
                      </label>
                      <input
                        type="tel"
                        value={shippingData.phone}
                        onChange={(e) => {
                          const val = e.target.value.replace(/[^0-9+\- ]/g, '');
                          if (val.replace(/\D/g, '').length <= 12) {
                            setShippingData({ ...shippingData, phone: val });
                          }
                        }}
                        maxLength={15}
                        className={`w-full px-4 py-3 border-2 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-gray-900 ${errors.phone ? 'border-red-500' : 'border-gray-300'
                          }`}
                        placeholder="0551234567"
                      />
                      {errors.phone && <p className="text-sm text-red-600 mt-1">{errors.phone}</p>}
                      {!errors.phone && shippingData.phone && (() => {
                        const d = shippingData.phone.replace(/\D/g, '');
                        const valid = (d.length === 10 && d.startsWith('0')) || (d.length === 12 && d.startsWith('233'));
                        if (valid) return <p className="text-xs text-gray-700 mt-1 flex items-center gap-1"><i className="ri-checkbox-circle-fill"></i> Valid phone number</p>;
                        if (d.length > 0 && d.length < 10) return <p className="text-xs text-amber-600 mt-1">{10 - d.length} more digit{10 - d.length > 1 ? 's' : ''} needed</p>;
                        return null;
                      })()}
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-900 mb-2">
                        Location *
                      </label>
                      <input
                        type="text"
                        value={shippingData.address}
                        onChange={(e) => setShippingData({ ...shippingData, address: e.target.value })}
                        className={`w-full px-4 py-3 border-2 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-gray-900 ${errors.address ? 'border-red-500' : 'border-gray-300'
                          }`}
                        placeholder="House number and street name"
                      />
                      {errors.address && <p className="text-sm text-red-600 mt-1">{errors.address}</p>}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-semibold text-gray-900 mb-2">
                          Region *
                        </label>
                        <select
                          value={shippingData.region}
                          onChange={(e) => setShippingData({ ...shippingData, region: e.target.value, city: '' })}
                          className={`w-full px-4 py-3 border-2 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-gray-900 bg-white ${errors.region ? 'border-red-500' : 'border-gray-300'
                            }`}
                        >
                          <option value="">Select Region</option>
                          {ghanaRegions.map((region) => (
                            <option key={region} value={region}>{region}</option>
                          ))}
                        </select>
                        {errors.region && <p className="text-sm text-red-600 mt-1">{errors.region}</p>}
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-gray-900 mb-2">
                          City *
                        </label>
                        {shippingData.region && ghanaCitiesByRegion[shippingData.region] ? (
                          <select
                            value={shippingData.city}
                            onChange={(e) => setShippingData({ ...shippingData, city: e.target.value })}
                            className={`w-full px-4 py-3 border-2 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-gray-900 bg-white ${errors.city ? 'border-red-500' : 'border-gray-300'
                              }`}
                          >
                            <option value="">Select City</option>
                            {ghanaCitiesByRegion[shippingData.region].map((city) => (
                              <option key={city} value={city}>{city}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            value={shippingData.city}
                            onChange={(e) => setShippingData({ ...shippingData, city: e.target.value })}
                            className={`w-full px-4 py-3 border-2 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-gray-900 ${errors.city ? 'border-red-500' : 'border-gray-300'
                              }`}
                            placeholder={shippingData.region ? 'Enter city' : 'Select a region first'}
                            disabled={!shippingData.region}
                          />
                        )}
                        {errors.city && <p className="text-sm text-red-600 mt-1">{errors.city}</p>}
                      </div>
                    </div>

                    {checkoutType === 'account' && (
                      <label className="flex items-center space-x-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={saveAddress}
                          onChange={(e) => setSaveAddress(e.target.checked)}
                          className="w-5 h-5 text-gray-900 rounded border-gray-300 focus:ring-gray-900"
                        />
                        <span className="text-sm text-gray-700">Save this address for future orders</span>
                      </label>
                    )}
                  </div>

                  <button
                    onClick={handleContinueToDelivery}
                    className="w-full mt-6 bg-gray-900 hover:bg-gray-800 text-white py-4 rounded-lg font-semibold transition-colors whitespace-nowrap cursor-pointer"
                  >
                    Continue to Delivery
                  </button>
                </div>


              </>
            )}

            {currentStep === 2 && (
              <>
                <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
                  <h2 className="text-xl font-bold text-gray-900 mb-6">Delivery Method</h2>
                  <div className="space-y-4">
                    <label className={`flex items-center justify-between p-4 border-2 rounded-lg cursor-pointer transition-colors ${deliveryMethod === 'pickup' ? 'border-gray-900 bg-gray-100' : 'border-gray-300 hover:border-gray-400'
                      }`}>
                      <div className="flex items-center space-x-4">
                        <input
                          type="radio"
                          name="delivery"
                          value="pickup"
                          checked={deliveryMethod === 'pickup'}
                          onChange={(e) => setDeliveryMethod(e.target.value)}
                          className="w-5 h-5 text-gray-900"
                        />
                        <div>
                          <p className="font-semibold text-gray-900">Store Pickup</p>
                          <p className="text-sm text-gray-600">Pick up from our store — Ready in 24 hours</p>
                        </div>
                      </div>
                      <p className="font-bold text-gray-900">FREE</p>
                    </label>

                    <label className={`flex items-center justify-between p-4 border-2 rounded-lg cursor-pointer transition-colors ${deliveryMethod === 'doorstep' ? 'border-gray-900 bg-gray-100' : 'border-gray-300 hover:border-gray-400'
                      }`}>
                      <div className="flex items-center space-x-4">
                        <input
                          type="radio"
                          name="delivery"
                          value="doorstep"
                          checked={deliveryMethod === 'doorstep'}
                          onChange={(e) => setDeliveryMethod(e.target.value)}
                          className="w-5 h-5 text-gray-900"
                        />
                        <div>
                          <p className="font-semibold text-gray-900">Doorstep Delivery</p>
                          <p className="text-sm text-gray-600">We will contact you with the delivery cost</p>
                        </div>
                      </div>
                      <p className="font-semibold text-amber-600 text-sm">At a Cost</p>
                    </label>

                    {/* Comprehensive delivery options - to be re-enabled later
                    <label className={`flex items-center justify-between p-4 border-2 rounded-lg cursor-pointer transition-colors ${deliveryMethod === 'accra' ? 'border-gray-900 bg-gray-100' : 'border-gray-300 hover:border-gray-400'
                      }`}>
                      <div className="flex items-center space-x-4">
                        <input type="radio" name="delivery" value="accra" checked={deliveryMethod === 'accra'} onChange={(e) => setDeliveryMethod(e.target.value)} className="w-5 h-5 text-gray-900" />
                        <div>
                          <p className="font-semibold text-gray-900">Accra Delivery</p>
                          <p className="text-sm text-gray-600">Delivery within Accra</p>
                        </div>
                      </div>
                      <p className="font-bold text-gray-900">GH₵ 40.00</p>
                    </label>
                    <label className={`flex items-center justify-between p-4 border-2 rounded-lg cursor-pointer transition-colors ${deliveryMethod === 'outside-accra' ? 'border-gray-900 bg-gray-100' : 'border-gray-300 hover:border-gray-400'
                      }`}>
                      <div className="flex items-center space-x-4">
                        <input type="radio" name="delivery" value="outside-accra" checked={deliveryMethod === 'outside-accra'} onChange={(e) => setDeliveryMethod(e.target.value)} className="w-5 h-5 text-gray-900" />
                        <div>
                          <p className="font-semibold text-gray-900">Outside Accra Delivery</p>
                          <p className="text-sm text-gray-600">Delivery to bus stations (VIP, OA, STC, etc.)</p>
                        </div>
                      </div>
                      <p className="font-bold text-gray-900">GH₵ 30.00</p>
                    </label>
                    */}
                  </div>

                  <div className="flex flex-col-reverse md:flex-row gap-4 mt-6">
                    <button
                      onClick={() => setCurrentStep(1)}
                      disabled={isLoading}
                      className="flex-1 border-2 border-gray-300 hover:border-gray-400 text-gray-700 py-4 rounded-lg font-semibold transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50"
                    >
                      Back
                    </button>
                    <button
                      onClick={handleContinueToPayment}
                      disabled={isLoading}
                      className="flex-1 bg-gray-900 hover:bg-gray-800 text-white py-4 rounded-lg font-semibold transition-colors whitespace-nowrap cursor-pointer disabled:opacity-70 flex items-center justify-center"
                    >
                      {isLoading ? (
                        <>
                          <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          Processing...
                        </>
                      ) : (
                        'Pay with Mobile Money'
                      )}
                    </button>
                  </div>
                </div>


              </>
            )}

            {/* Step 3 removed - payment now initiates directly from step 2 */}
          </div>

          <div className="lg:col-span-1">
            <OrderSummary
              items={cart}
              subtotal={subtotal}
              shipping={shippingCost}
              tax={tax}
              total={total}
            />
          </div>
        </div>
      </div>
    </main>
  );
}

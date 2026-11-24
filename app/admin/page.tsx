import AdminDashboardClient from './AdminDashboardClient';
import { SmsCreditDashboardCard } from '@/components/admin/SmsCreditDashboardCard';
import { getDashboardSmsCredit } from '@/lib/sms-credit-cache';

export const dynamic = 'force-dynamic';

export default async function AdminDashboardPage() {
  const smsCredit = await getDashboardSmsCredit();
  return <AdminDashboardClient smsCreditCard={<SmsCreditDashboardCard smsCredit={smsCredit} />} />;
}
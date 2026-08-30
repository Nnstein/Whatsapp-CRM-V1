import Link from 'next/link';
import { CheckCircle2, XCircle, ArrowLeft, MessageSquare } from 'lucide-react';

interface PageProps {
  searchParams: Promise<{ status?: string }>;
}

export default async function PaymentResultPage({ searchParams }: PageProps) {
  const { status } = await searchParams;
  const isSuccess = status === 'success';

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-2xl p-8 shadow-2xl text-center flex flex-col items-center">
        {isSuccess ? (
          <>
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mb-6 text-emerald-400">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white mb-2">
              Payment Successful!
            </h1>
            <p className="text-sm text-neutral-400 mb-8 leading-relaxed">
              Your payment has been received and verified. Your order is now confirmed, and a confirmation message has been sent to your WhatsApp.
            </p>
            <div className="w-full bg-neutral-800/60 rounded-xl p-4 border border-neutral-700/50 mb-6 text-left text-xs space-y-2">
              <div className="flex justify-between text-neutral-400">
                <span>Status</span>
                <span className="text-emerald-400 font-medium">Confirmed &amp; Paid</span>
              </div>
              <div className="flex justify-between text-neutral-400">
                <span>Confirmation</span>
                <span className="text-neutral-200">Sent via WhatsApp</span>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center mb-6 text-red-400">
              <XCircle className="w-10 h-10" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white mb-2">
              Payment Incomplete
            </h1>
            <p className="text-sm text-neutral-400 mb-8 leading-relaxed">
              The payment was not completed or was cancelled. No charges were made to your account. You can return to WhatsApp to request a new payment link.
            </p>
          </>
        )}

        <div className="w-full space-y-3">
          <a
            href="whatsapp://"
            className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm transition-colors shadow-lg shadow-emerald-900/20"
          >
            <MessageSquare className="w-4 h-4" />
            Return to WhatsApp
          </a>
        </div>
      </div>
      <p className="mt-8 text-xs text-neutral-600">
        Secure in-chat payments powered by WhatsApp CRM
      </p>
    </div>
  );
}

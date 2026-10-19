import React from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function SignupSuccess() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 flex items-center justify-center px-4">
      <div className="max-w-lg w-full">
        <div className="bg-slate-900/80 border border-slate-700 rounded-xl p-8 text-center">
          <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-10 h-10 text-emerald-500" />
          </div>

          <h1 className="text-2xl font-bold text-white mb-3">Thanks for signing up!</h1>

          <p className="text-slate-300 mb-6">
            We've received your request. Our team will review your application and send you
            an invoice with banking details shortly.
          </p>

          <div className="bg-slate-800/60 border border-slate-700 rounded-lg p-4 mb-6 text-left">
            <div className="flex items-start gap-3">
              <Mail className="w-5 h-5 text-emerald-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm text-white font-medium mb-1">What happens next:</p>
                <ol className="text-sm text-slate-400 space-y-1 list-decimal list-inside">
                  <li>Our team reviews your signup</li>
                  <li>You'll receive an invoice with banking details</li>
                  <li>Pay via EFT & send proof of payment</li>
                  <li>Your account gets activated (usually within 24 hours)</li>
                </ol>
              </div>
            </div>
          </div>

          <p className="text-sm text-slate-400 mb-6">
            Questions? Email{' '}
            <a href="mailto:info@cannalife.co.za" className="text-emerald-400 hover:underline">
              info@cannalife.co.za
            </a>
          </p>

          <Button asChild variant="outline" className="border-slate-700 text-slate-300">
            <Link to="/login">Back to login</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}


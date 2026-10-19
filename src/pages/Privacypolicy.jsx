import { Shield, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function PrivacyPolicy() {
  var navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8 sm:py-12">
        <button onClick={function () { navigate(-1); }} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        <div className="flex items-center gap-3 mb-2">
          <Shield className="w-8 h-8 text-green-600" />
          <h1 className="text-3xl font-bold">Privacy Policy</h1>
        </div>
        <p className="text-muted-foreground mb-1">In compliance with the Protection of Personal Information Act 4 of 2013 (POPIA)</p>
        <p className="text-sm text-muted-foreground mb-8">Last updated: May 2026</p>

        <div className="space-y-8 text-sm leading-relaxed">
          <Section title="1. Introduction">
            <p>Canna Life Co ("we", "us", or "our") is a cannabis dispensary and club point-of-sale platform operated by Lereko Digital (Pty) Ltd, a company registered in the Republic of South Africa. This Privacy Policy explains how we collect, use, store, share, and protect personal information in accordance with the Protection of Personal Information Act 4 of 2013 ("POPIA") and the Promotion of Access to Information Act 2 of 2000 ("PAIA").</p>
            <p>This policy applies to all users of the Canna Life Co platform, including dispensary and club owners ("Clients"), their staff and cashiers, their customers and members ("Members"), suppliers, and visitors to our website.</p>
          </Section>

          <Section title="2. Information Officer">
            <p>In terms of Section 55 of POPIA, our designated Information Officer is:</p>
            <div className="bg-muted/50 rounded-lg p-4 mt-2">
              <p><strong>Name:</strong> Chevan Naidu</p>
              <p><strong>Email:</strong> privacy@cannalife.co.za</p>
              <p><strong>Website:</strong> pos.cannalife.co.za</p>
            </div>
          </Section>

          <Section title="3. Personal Information We Collect">
            <h4 className="font-semibold mt-4 mb-2">3.1 From Clients (Dispensary/Club Owners)</h4>
            <ul className="list-disc pl-6 space-y-1">
              <li>Full name and surname</li>
              <li>Email address and phone number</li>
              <li>Business name and registration details</li>
              <li>Payment information (processed via Paystack — we do not store card numbers)</li>
              <li>Login credentials (passwords are hashed and never stored in plaintext)</li>
            </ul>

            <h4 className="font-semibold mt-4 mb-2">3.2 From Members (Club/Dispensary Customers)</h4>
            <ul className="list-disc pl-6 space-y-1">
              <li>First name and last name</li>
              <li>Email address (optional) and phone number</li>
              <li>Membership ID (system-generated)</li>
              <li>ID number (where required for Section 21 patient intake)</li>
              <li>Purchase history and transaction records</li>
              <li>Loyalty points and store credit balance</li>
              <li>Medical information (Section 21 patient intake forms, where applicable)</li>
            </ul>

            <h4 className="font-semibold mt-4 mb-2">3.3 From Staff and Cashiers</h4>
            <ul className="list-disc pl-6 space-y-1">
              <li>Full name, email address or phone number</li>
              <li>Role and assigned store</li>
              <li>Cashier session data (shift times, sales totals)</li>
            </ul>

            <h4 className="font-semibold mt-4 mb-2">3.4 Automatically Collected Information</h4>
            <ul className="list-disc pl-6 space-y-1">
              <li>Browser type and device information</li>
              <li>IP address and usage data</li>
            </ul>
          </Section>

          <Section title="4. Purpose of Processing">
            <p>We process personal information for the following lawful purposes:</p>
            <ul className="list-disc pl-6 space-y-1 mt-2">
              <li>To provide and operate the Canna Life Co POS platform</li>
              <li>To create and manage user accounts and company profiles</li>
              <li>To process point-of-sale transactions and maintain sales records</li>
              <li>To manage membership registrations, loyalty programmes, and store credit</li>
              <li>To process payments through Paystack</li>
              <li>To facilitate Section 21 patient intake applications where applicable</li>
              <li>To generate reports and analytics for Clients</li>
              <li>To communicate with users about their accounts and support</li>
              <li>To comply with legal and regulatory obligations</li>
              <li>To prevent fraud and ensure platform security</li>
            </ul>
          </Section>

          <Section title="5. Legal Basis for Processing">
            <p>In terms of Section 11 of POPIA, we process personal information based on:</p>
            <ul className="list-disc pl-6 space-y-1 mt-2">
              <li><strong>Consent:</strong> Where the data subject has given voluntary, specific, and informed consent</li>
              <li><strong>Contract:</strong> Where processing is necessary to fulfil a contractual obligation</li>
              <li><strong>Legal obligation:</strong> Where processing is required by law</li>
              <li><strong>Legitimate interest:</strong> Where processing is necessary for our legitimate business interests</li>
            </ul>
          </Section>

          <Section title="6. Sharing of Personal Information">
            <h4 className="font-semibold mt-4 mb-2">6.1 Service Providers (Operators)</h4>
            <ul className="list-disc pl-6 space-y-1">
              <li>Supabase (database hosting and authentication)</li>
              <li>Vercel (application hosting)</li>
              <li>Resend (transactional email delivery)</li>
              <li>Paystack (payment processing — PCI DSS compliant)</li>
            </ul>

            <h4 className="font-semibold mt-4 mb-2">6.2 We Do Not</h4>
            <ul className="list-disc pl-6 space-y-1">
              <li>Sell personal information to third parties</li>
              <li>Share personal information for marketing purposes without consent</li>
              <li>Provide personal information to government authorities except as required by law</li>
            </ul>
          </Section>

          <Section title="7. Cross-Border Transfers">
            <p>In terms of Section 72 of POPIA, personal information may be transferred to countries outside South Africa where our service providers operate. These transfers are subject to appropriate safeguards, including binding agreements requiring the recipient to uphold standards materially similar to POPIA.</p>
          </Section>

          <Section title="8. Data Retention">
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>Active account data:</strong> Retained for the duration of the Client's subscription</li>
              <li><strong>Transaction records:</strong> Retained for 5 years (tax/financial regulations)</li>
              <li><strong>Member data:</strong> Retained for the duration of the Client's subscription unless deletion is requested</li>
              <li><strong>Inactive accounts:</strong> Deactivated after 12 months; deleted after 24 months</li>
              <li><strong>Section 21 records:</strong> Retained as required by health regulations</li>
            </ul>
          </Section>

          <Section title="9. Your Rights as a Data Subject">
            <p>Under POPIA, you have the following rights:</p>
            <ul className="list-disc pl-6 space-y-1 mt-2">
              <li><strong>Right of access:</strong> Request confirmation and a copy of your personal information (Section 23)</li>
              <li><strong>Right to correction:</strong> Request correction or deletion of inaccurate information (Section 24)</li>
              <li><strong>Right to deletion:</strong> Request destruction of unnecessary personal information (Section 24)</li>
              <li><strong>Right to object:</strong> Object to processing on reasonable grounds (Section 11(3))</li>
              <li><strong>Right to withdraw consent:</strong> Withdraw previously given consent (Section 11(2)(a))</li>
              <li><strong>Right to lodge a complaint:</strong> Lodge a complaint with the Information Regulator</li>
            </ul>
            <p className="mt-2">To exercise any of these rights, please visit your account settings or email privacy@cannalife.co.za. We will respond within 30 days.</p>
          </Section>

          <Section title="10. Security Measures">
            <ul className="list-disc pl-6 space-y-1">
              <li>Encryption of data in transit (TLS/SSL) and at rest</li>
              <li>Row-Level Security (RLS) ensuring multi-tenant data isolation</li>
              <li>Secure password hashing via Supabase Auth</li>
              <li>Role-based access controls</li>
              <li>Regular security monitoring</li>
            </ul>
          </Section>

          <Section title="11. Data Breach Notification">
            <p>In the event of a data breach, we will in accordance with Section 22 of POPIA:</p>
            <ol className="list-decimal pl-6 space-y-1 mt-2">
              <li>Notify the Information Regulator as soon as reasonably possible</li>
              <li>Notify affected data subjects in writing</li>
              <li>Provide sufficient information for data subjects to take protective measures</li>
              <li>Document the breach and remedial steps taken</li>
            </ol>
          </Section>

          <Section title="12. Special Personal Information">
            <p>Where Clients use the Section 21 patient intake feature, medical and health-related information may be processed. This constitutes special personal information under Section 26 of POPIA and is processed strictly on the basis of consent and for healthcare purposes. Enhanced security measures and restricted access apply.</p>
          </Section>

          <Section title="13. Children's Personal Information">
            <p>Canna Life Co is not intended for use by persons under the age of 18. We do not knowingly collect personal information from children. In terms of Section 35 of POPIA, processing of a child's personal information requires consent from a competent person.</p>
          </Section>

          <Section title="14. Complaints">
            <p>If you are not satisfied with our handling of your personal information, you may lodge a complaint with:</p>
            <div className="bg-muted/50 rounded-lg p-4 mt-2">
              <p><strong>The Information Regulator (South Africa)</strong></p>
              <p>Email: complaints.IR@justice.gov.za</p>
              <p>Phone: 012 406 4818</p>
              <p>Website: https://inforegulator.org.za</p>
            </div>
          </Section>

          <Section title="15. Contact Us">
            <div className="bg-muted/50 rounded-lg p-4">
              <p><strong>Canna Life Co / Lereko Digital (Pty) Ltd</strong></p>
              <p>Email: info@cannalife.co.za</p>
              <p>Privacy: privacy@cannalife.co.za</p>
              <p>Website: pos.cannalife.co.za</p>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section>
      <h2 className="text-lg font-bold mb-3 text-foreground">{title}</h2>
      <div className="space-y-3 text-muted-foreground">{children}</div>
    </section>
  );
}

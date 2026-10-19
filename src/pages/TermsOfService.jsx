import { FileText, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function TermsOfService() {
  var navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8 sm:py-12">
        <button onClick={function () { navigate(-1); }} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        <div className="flex items-center gap-3 mb-2">
          <FileText className="w-8 h-8 text-green-600" />
          <h1 className="text-3xl font-bold">Terms of Service</h1>
        </div>
        <p className="text-sm text-muted-foreground mb-8">Last updated: May 2026</p>

        <div className="space-y-8 text-sm leading-relaxed">
          <Section title="1. Acceptance of Terms">
            <p>By accessing or using the Cannalife Co platform ("Platform") at pos.cannalife.co.za, you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, you may not use the Platform. These Terms constitute a legally binding agreement between you and Lereko Digital (Pty) Ltd ("Cannalife Co", "we", "us", or "our").</p>
          </Section>

          <Section title="2. Definitions">
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>"Client"</strong> means a dispensary or cannabis club owner who subscribes to the Platform.</li>
              <li><strong>"Member"</strong> means a customer or patient registered under a Client's account.</li>
              <li><strong>"Staff"</strong> means cashiers, managers, and other personnel added by a Client.</li>
              <li><strong>"Platform"</strong> means the Cannalife Co web application, APIs, and all related services.</li>
              <li><strong>"Subscription"</strong> means a paid plan providing access to Platform features.</li>
            </ul>
          </Section>

          <Section title="3. Eligibility">
            <p>You must be at least 18 years of age to use the Platform. By using the Platform, you represent and warrant that you have the legal capacity to enter into these Terms and that your use of the Platform complies with all applicable laws and regulations in the Republic of South Africa.</p>
          </Section>

          <Section title="4. Account Registration">
            <p>To use the Platform, you must create an account by providing accurate and complete information. You are responsible for maintaining the confidentiality of your login credentials and for all activities that occur under your account. You agree to notify us immediately of any unauthorised use.</p>
          </Section>

          <Section title="5. Subscriptions and Payment">
            <p>Cannalife Co offers multiple subscription plans (Starter, Growth, and Lifetime). Features, pricing, and limitations vary by plan. We reserve the right to modify pricing with 30 days' written notice.</p>
            <p>New Clients may receive a free trial period. Payments are processed through Paystack. By subscribing, you authorise recurring charges to your payment method. All fees are quoted in South African Rand (ZAR) and are inclusive of VAT where applicable.</p>
            <p>Subscription fees are generally non-refundable. Refund requests will be considered on a case-by-case basis in accordance with the Consumer Protection Act 68 of 2008.</p>
          </Section>

          <Section title="6. Client Responsibilities">
            <p>As a Client, you agree to:</p>
            <ul className="list-disc pl-6 space-y-1 mt-2">
              <li>Use the Platform only for lawful purposes and in compliance with all applicable South African legislation</li>
              <li>Obtain necessary consents from Members before collecting their personal information</li>
              <li>Ensure all Staff are authorised and trained on data handling responsibilities</li>
              <li>Maintain accurate product, inventory, and pricing information</li>
              <li>Comply with POPIA as a responsible party for Member data</li>
              <li>Not use the Platform to facilitate any illegal activities</li>
            </ul>
          </Section>

          <Section title="7. Data Processing Agreement">
            <p>In terms of POPIA, the Client is the "responsible party" and Cannalife Co acts as the "operator" (data processor) for Member data. Cannalife Co will process Member data solely on the Client's instructions and in accordance with our Privacy Policy. Both parties agree to implement appropriate measures to protect personal information.</p>
          </Section>

          <Section title="8. Intellectual Property">
            <p>All intellectual property rights in the Platform remain the property of Lereko Digital (Pty) Ltd. You are granted a limited, non-exclusive, non-transferable licence to use the Platform for the duration of your Subscription. You may not copy, modify, distribute, reverse-engineer, or create derivative works based on the Platform.</p>
          </Section>

          <Section title="9. Data Ownership and Portability">
            <p>You retain ownership of all content you upload to the Platform. Upon termination, you may request a data export in CSV format. Data will be available for 30 days following termination, after which it may be permanently deleted.</p>
          </Section>

          <Section title="10. Prohibited Uses">
            <p>You agree not to:</p>
            <ul className="list-disc pl-6 space-y-1 mt-2">
              <li>Attempt to gain unauthorised access to other users' accounts or data</li>
              <li>Interfere with or disrupt the Platform's infrastructure</li>
              <li>Use automated scripts, bots, or scrapers</li>
              <li>Resell or commercially exploit the Platform without written consent</li>
              <li>Circumvent security or access control features</li>
            </ul>
          </Section>

          <Section title="11. Service Availability">
            <p>We strive to maintain high availability but do not guarantee uninterrupted access. The Platform may be temporarily unavailable due to maintenance, updates, or circumstances beyond our control. We will make reasonable efforts to notify Clients of planned downtime.</p>
          </Section>

          <Section title="12. Limitation of Liability">
            <p>To the maximum extent permitted by South African law, Cannalife Co shall not be liable for any indirect, incidental, special, consequential, or punitive damages. Our total aggregate liability shall not exceed the total fees paid by you in the 12 months preceding the claim.</p>
          </Section>

          <Section title="13. Termination">
            <p>Either party may terminate this agreement at any time. You may cancel your Subscription through settings or by contacting us. We may suspend or terminate your account for breach of these Terms or non-payment. Upon termination, you may request a data export within 30 days.</p>
          </Section>

          <Section title="14. Dispute Resolution">
            <p>Any disputes shall be governed by the laws of the Republic of South Africa. The parties agree to attempt resolution through negotiation and mediation before litigation. Legal proceedings shall be instituted in the courts of the Republic of South Africa.</p>
          </Section>

          <Section title="15. Governing Law">
            <p>These Terms are governed by and construed in accordance with the laws of the Republic of South Africa, including the Electronic Communications and Transactions Act 25 of 2002, the Consumer Protection Act 68 of 2008, and the Protection of Personal Information Act 4 of 2013.</p>
          </Section>

          <Section title="16. Contact Us">
            <div className="bg-muted/50 rounded-lg p-4">
              <p><strong>Cannalife Co / Lereko Digital (Pty) Ltd</strong></p>
              <p>Email: info@cannalife.co.za</p>
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

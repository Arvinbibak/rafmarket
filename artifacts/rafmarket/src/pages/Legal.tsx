import { Link } from 'wouter';
import type { ReactNode } from 'react';

function LegalShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <Link href="/" className="text-sm text-primary hover:underline">← Back to RAFMARKET</Link>
        <p className="mt-8 text-sm font-semibold tracking-widest text-primary">RAFMARKET</p>
        <h1 className="mt-2 text-3xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Effective date: November 27, 2026</p>
        <article className="prose prose-neutral dark:prose-invert mt-8 max-w-none">{children}</article>
      </div>
    </main>
  );
}

export function PrivacyPolicy() {
  return (
    <LegalShell title="Privacy Policy">
      <h2>1. Information we handle</h2>
      <p>RAFMARKET is a marketplace application designed to use Pi Network authentication and payments. Depending on the features you use, we may process your Pi username and account identifier, authentication/session information, product listings, cart contents, orders, seller and delivery details you submit, support or dispute messages, and Pi payment identifiers and transaction status.</p>
      <h2>2. How information is used</h2>
      <p>We use this information to sign you in, operate buyer and seller accounts, display listings, manage orders, verify payment status with Pi Network, prevent abuse, maintain security, and handle support and disputes.</p>
      <h2>3. Pi Network and service providers</h2>
      <p>Pi authentication and payment processing depend on Pi Network services. The application is hosted using Vercel and its database is hosted by Neon. Information necessary to operate the service may be processed by these providers under their respective terms and privacy policies.</p>
      <h2>4. Wallet credentials</h2>
      <p>RAFMARKET does not ask users to provide their wallet passphrase or private keys. Never share a wallet passphrase or private key with anyone, including RAFMARKET support.</p>
      <h2>5. Sharing and disclosure</h2>
      <p>Buyer and seller information may be shared with the other party when needed to fulfil an order, arrange delivery, or resolve a dispute. We do not sell personal information. We may disclose information where required by law or where reasonably necessary to protect the service and its users.</p>
      <h2>6. Retention and security</h2>
      <p>We retain account, order, and transaction records for as long as reasonably needed to operate the marketplace, resolve disputes, meet legal obligations, and protect the service. We use technical and organizational safeguards, but no online service can guarantee absolute security.</p>
      <h2>7. Your choices</h2>
      <p>Do not submit sensitive information that is not needed for a transaction. You may stop using the application at any time. Requests about personal information can be made through the official RAFMARKET support contact published with the app.</p>
      <h2>8. Changes</h2>
      <p>We may update this policy as RAFMARKET develops. The current version will be published at this URL with its effective date.</p>
      <h2>9. Contact</h2>
      <p>For privacy questions, use the official RAFMARKET support contact shown in the Pi app listing. A public support contact must be provided before the app is submitted for public listing.</p>
    </LegalShell>
  );
}

export function TermsOfService() {
  return (
    <LegalShell title="Terms of Service">
      <h2>1. About RAFMARKET</h2>
      <p>RAFMARKET provides marketplace software that helps users discover listings, communicate transaction information, and manage buyer and seller orders. Users are responsible for the accuracy and legality of their listings and for complying with applicable laws.</p>
      <h2>2. Pi Network test environment</h2>
      <p>The current RAFMARKET application is configured for Pi Network Testnet. Test Pi is for testing and has no monetary value. Do not treat Testnet activity as a real-money purchase or transfer. Mainnet availability will be announced only after the application is approved and configured for it.</p>
      <h2>3. Accounts and acceptable use</h2>
      <p>You must use an account you control, provide accurate information, protect your sign-in session, and not misuse the application, interfere with its operation, post unlawful or misleading listings, or attempt to defraud other users.</p>
      <h2>4. Listings and transactions</h2>
      <p>Sellers are responsible for product descriptions, availability, pricing, lawful sale, packaging, and fulfilment. Buyers are responsible for reviewing listing details before placing an order. RAFMARKET may remove listings or restrict accounts to protect users and the service.</p>
      <h2>5. Payments, commissions, and settlement</h2>
      <p>Payment status is recorded only after the server verifies the relevant payment with Pi Network. Any displayed platform commission and seller share are accounting calculations unless and until a supported payout process is explicitly implemented. RAFMARKET does not currently promise automatic seller payouts or automatic Pi refunds.</p>
      <h2>6. Delivery and disputes</h2>
      <p>Order statuses and dispute decisions help record the progress and outcome of a transaction. A dispute decision in the current application is a record of an administrative decision; it does not itself move Pi, issue a refund, or pay a seller. Users should not assume funds are held in escrow by RAFMARKET.</p>
      <h2>7. Third-party services</h2>
      <p>Pi Network authentication and payment services, hosting, and database services are provided by third parties and may be subject to their own terms, availability, and limitations.</p>
      <h2>8. Availability and changes</h2>
      <p>RAFMARKET is under active development. Features may change, be unavailable, or be withdrawn. We will not represent a feature as operational until it has been implemented and tested.</p>
      <h2>9. Limitation and responsibility</h2>
      <p>To the extent permitted by applicable law, RAFMARKET is provided on an as-available basis. Nothing in these terms excludes rights or remedies that cannot legally be excluded. Users remain responsible for their dealings with other users and for complying with applicable laws.</p>
      <h2>10. Changes and contact</h2>
      <p>These terms may be updated as the service develops. The current version will be published at this URL. For questions, use the official RAFMARKET support contact shown in the Pi app listing; a public support contact must be provided before public listing.</p>
    </LegalShell>
  );
}

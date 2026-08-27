import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FireOps — Commandement feux de forêt',
  description: 'Simulateur agent-native d’aide à la décision pour les feux de forêt.',
  applicationName: 'FireOps',
  openGraph: {
    title: 'FireOps',
    description: 'Agent-native wildfire command',
    type: 'website',
    locale: 'fr_FR',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'FireOps — Agent-native wildfire command' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'FireOps',
    description: 'Agent-native wildfire command',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}

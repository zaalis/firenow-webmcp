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
      <body>
        {/* Le pont WebMCP doit exister avant l'hydratation : les outils de la
            page s'enregistrent dessus des le premier rendu client, et un agent
            injecte au chargement du document doit le trouver deja pose. Le
            differer rouvrirait la course que ce fichier existe pour fermer. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/webmcp.js" />
        {children}
      </body>
    </html>
  );
}

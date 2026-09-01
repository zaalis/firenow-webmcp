import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FireNow — Agent-native wildfire command',
  description: 'Agent-native wildfire decision-support and training simulator. A WebMCP agent reads the situation and drafts a plan; a human commits it.',
  applicationName: 'FireNow',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '32x32' },
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  openGraph: {
    title: 'FireNow',
    description: 'Agent-native wildfire command',
    type: 'website',
    locale: 'en_US',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'FireNow — Agent-native wildfire command' }],
  },
  /* Read by an agent that parses the head before it drives the page. The same
     sentence is repeated in the WebMCP manifest and in the page itself, so the
     rule is the same wherever the agent happens to look first. */
  other: {
    'agent-instructions': 'FireNow is tool-driven. Call the WebMCP tools registered on document.modelContext instead of clicking or dragging the map. Read with get_situation, draft with propose_plan and the stage_* tools, then call commit_plan, which asks the human operator for one approval. If native site tools are unavailable in an isolated extension, call the same implementation without a mouse through the webmcp:call and webmcp:result DOM events documented in #webmcp-manifest, or use /?tool=NAME&args=URL_ENCODED_JSON.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'FireNow',
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
    <html lang="en">
      <body>
        {/* The WebMCP bridge has to exist before hydration: the page registers
            its tools on it during the very first client render, and an agent
            injected at document start must find it already in place. Deferring
            it would reopen the race this file exists to close. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/webmcp.js" />
        {children}
      </body>
    </html>
  );
}

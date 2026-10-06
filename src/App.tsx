import React from 'react';
import { AuthProvider } from '@/contexts/AuthContext';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { OfflineIndicator } from '@/components/OfflineIndicator';
import { HomePage } from '@/pages/HomePage';

export default function App() {
  return (
    <AuthProvider>
      <div className="min-h-screen flex flex-col bg-[#090d16] text-slate-100 selection:bg-blue-600 selection:text-white">
        {/* Platform Header */}
        <Header />

        {/* Main Content Area */}
        <main className="grow">
          <HomePage />
        </main>

        {/* Platform Footer */}
        <Footer />

        {/* PWA Offline Connectivity Indicator */}
        <OfflineIndicator />
      </div>
    </AuthProvider>
  );
}

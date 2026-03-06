// Supabase Configuration - Example Template
// Copy this file to config.js and replace with your actual credentials.
// IMPORTANT: Never commit config.js to version control!

// =============================================================================
// LOCAL DEVELOPMENT
// =============================================================================
// 1. cp static/config.example.js static/config.js
// 2. Replace placeholder values below with your Supabase credentials.
//    Dashboard → Settings → API
//
// GITHUB PAGES DEPLOYMENT
// =============================================================================
// Set repository secrets (Settings → Secrets and variables → Actions):
//   SUPABASE_URL        Your Supabase project URL
//   SUPABASE_ANON_KEY   Your Supabase anon/public key
// =============================================================================

const SUPABASE_URL      = 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';

function validateConfig() {
    return (
        SUPABASE_URL &&
        SUPABASE_ANON_KEY &&
        SUPABASE_URL      !== 'YOUR_SUPABASE_URL' &&
        SUPABASE_ANON_KEY !== 'YOUR_SUPABASE_ANON_KEY'
    );
}

(function initializeSupabase() {
    if (typeof supabase === 'undefined') {
        console.error('❌ Supabase library not loaded.');
        return;
    }

    if (!validateConfig()) {
        console.error('⚠️ Supabase credentials not configured. Edit static/config.js.');

        const banner = document.getElementById('error-banner');
        const msg    = document.getElementById('error-banner-message');
        if (banner && msg) {
            msg.textContent = 'Database not configured. Please set up config.js with your Supabase credentials.';
            banner.classList.remove('hidden');
        }
        return;
    }

    try {
        const { createClient } = supabase;
        window.supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        console.log('✅ Supabase client initialized');
    } catch (error) {
        console.error('❌ Failed to initialize Supabase client:', error);
    }
})();

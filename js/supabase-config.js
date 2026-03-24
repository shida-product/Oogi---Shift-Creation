/**
 * Supabase接続設定
 */
const SUPABASE_URL = 'https://eypkizmvbmnqbnzeceqs.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5cGtpem12Ym1ucWJuemVjZXFzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyOTMwMDEsImV4cCI6MjA4ODg2OTAwMX0.v6hfl3PPgwo46vwn1YJmfe772T_LDHYL1riOx9HOcq0';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export { supabase, SUPABASE_URL, SUPABASE_ANON_KEY };

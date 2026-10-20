// js/app/supabase-config.example.js — TEMPLATE.
// → Copier en `js/app/supabase-config.js` (gitignoré) et remplir avec TES valeurs.
//
// ⚠️ Clés PUBLIQUES uniquement. L'« anon key » est conçue pour le front : elle ne donne accès
//    qu'à ce que la RLS (Row Level Security) autorise pour l'utilisateur connecté. Elle n'est PAS
//    un secret au sens de la service_role. NE JAMAIS mettre la clé `service_role` ici (accès total
//    bypass RLS) — elle reste dans `.env`, pour les tests uniquement.
//
// Chargé par index.html via <script src="js/app/supabase-config.js"></script> AVANT le module de boot,
// qui lit `window.IMMO_SUPABASE`.
window.IMMO_SUPABASE = {
  url: 'https://VOTRE-REF-PROJET.supabase.co',
  anonKey: 'VOTRE_CLE_ANON_PUBLIQUE',
}

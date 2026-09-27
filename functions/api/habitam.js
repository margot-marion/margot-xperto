// ============================================================
// SMS Habitam -> LeadConnector : SMS automatique au nouveau lead
// ------------------------------------------------------------
// Habitam annonce chaque nouveau lead par un SMS de ce genre :
//
//   Un nouveau client potentiel vous a été attribué.
//   Nom : Sophie Tremblay
//   Téléphone : (514) 555-0123
//   Accéder aux détails du projet :
//   https://expert.habitam.ca/new/leads/12402
//   Contactez-le rapidement pour optimiser vos chances.
//
// Une automatisation de l'app Raccourcis de l'iPhone envoie le texte
// de ce SMS ici. On en tire le nom, le telephone et le lien, puis on
// transmet le tout au webhook entrant d'un workflow LeadConnector,
// qui cree le contact et envoie le SMS.
//
// Variables a configurer dans Cloudflare
// (Parametres > Variables et secrets, type Secret) :
//   HABITAM_CLE                 un mot de passe choisi, repris dans
//                               l'en-tete X-Cle du Raccourci
//   LEADCONNECTOR_WEBHOOK_URL   l'adresse donnee par le declencheur
//                               « Inbound Webhook » du workflow
//
// Adresse a inscrire dans le Raccourci (Obtenir le contenu de l'URL) :
//   https://margotmarion.ca/api/habitam
//
// Test sans SMS (envoie un faux lead, pour associer les champs dans
// LeadConnector pendant que le workflow est encore en brouillon) :
//   https://margotmarion.ca/api/habitam?test=1&cle=LA_CLE
// ============================================================

// Seuls les SMS qui contiennent cette phrase sont des leads
const SIGNATURE_LEAD = /client\s+potentiel/i;

const MESSAGE_TEST =
  "Un nouveau client potentiel vous a été attribué.\n" +
  "Nom : Test Habitam\n" +
  "Téléphone : (514) 555-0100\n" +
  "Accéder aux détails du projet : https://expert.habitam.ca/new/leads/0\n" +
  "Contactez-le rapidement pour optimiser vos chances.";

export async function onRequest(context) {
  const { request, env } = context;
  const adresse = new URL(request.url);
  const test = request.method === "GET" && adresse.searchParams.get("test") === "1";

  if (request.method !== "POST" && !test) {
    return texte("Ce point d'entree n'accepte que POST.", 405);
  }
  if (!env.HABITAM_CLE || !env.LEADCONNECTOR_WEBHOOK_URL) {
    return json({ erreur: "configuration_absente" }, 503);
  }
  if (!/^https:\/\//.test(env.LEADCONNECTOR_WEBHOOK_URL)) {
    return json({ erreur: "adresse_leadconnector_invalide" }, 503);
  }

  // --- Verification de la cle ---
  const recue = test
    ? adresse.searchParams.get("cle")
    : request.headers.get("X-Cle");
  if (!recue || !egalite(recue.trim(), env.HABITAM_CLE)) {
    return json({ erreur: "cle_invalide" }, 401);
  }

  const message = test ? MESSAGE_TEST : await lireMessage(request);

  // Un autre SMS du meme expediteur : on l'ignore sans erreur, pour
  // que le Raccourci n'affiche pas d'alerte sur l'iPhone.
  if (!SIGNATURE_LEAD.test(message)) {
    return json({ ok: true, ignore: "pas_un_lead" }, 200);
  }

  const lead = lireLead(message);
  if (!lead) {
    return json({ erreur: "telephone_introuvable", recu: message.slice(0, 500) }, 422);
  }
  if (test) lead.test = true;

  // --- Envoi a LeadConnector, avec une seconde tentative ---
  for (let essai = 1; essai <= 2; essai++) {
    try {
      const reponse = await fetch(env.LEADCONNECTOR_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(lead)
      });

      if (reponse.ok) {
        return json({ ok: true, nom: lead.nom_complet, telephone: lead.telephone }, 200);
      }

      // 4xx : LeadConnector refuse l'envoi, reessayer ne changerait rien
      if (reponse.status < 500 || essai === 2) {
        const detail = await reponse.text();
        return json({ erreur: "leadconnector_refuse", statut: reponse.status,
                      detail: detail.slice(0, 800) }, 502);
      }
    } catch (e) {
      if (essai === 2) return json({ erreur: "echec_reseau" }, 502);
    }
    await new Promise((r) => setTimeout(r, 600));
  }

  return json({ erreur: "inconnue" }, 502);
}

// Le Raccourci envoie du JSON { "message": "..." }, mais on accepte
// aussi le texte brut au cas ou le corps serait configure autrement.
async function lireMessage(request) {
  const corps = await request.text();
  try {
    const charge = JSON.parse(corps);
    if (charge && typeof charge === "object") {
      return (charge.message || charge.texte || charge.text || "").toString();
    }
  } catch (e) {}
  return corps;
}

// ============================================================
// Lecture du SMS
// ============================================================
function lireLead(message) {
  // Espaces insecables (typographie francaise) ramenees a des espaces
  const s = message.replace(/[  ]/g, " ");

  const tel = nettoyerTelephone(ligne(s, /t[eé]l[eé]phone\s*:\s*(.+)/i));
  if (!tel) return null;

  const complet = (ligne(s, /(?:^|\n)\s*nom\s*:\s*(.+)/i) || "")
    .replace(/\s+/g, " ").trim().slice(0, 80);
  const { prenom, nom } = separerNom(complet);

  const lien = (s.match(/https?:\/\/[^\s]*habitam\.ca[^\s]*/i) || [""])[0]
    .replace(/[.,;)]+$/, "");
  const id = (lien.match(/leads?\/(\d+)/i) || [])[1] || "";

  return {
    prenom,
    nom,
    nom_complet: complet,
    telephone: "+1" + tel,
    telephone_affiche: "(" + tel.slice(0, 3) + ") " + tel.slice(3, 6) + "-" + tel.slice(6),
    source: "Habitam",
    habitam_id: id,
    habitam_lien: lien,
    recu_le: new Date().toISOString()
  };
}

function ligne(s, motif) {
  const m = s.match(motif);
  return m ? m[1].split("\n")[0].trim() : "";
}

// "Sophie Tremblay" -> prenom Sophie, nom Tremblay
function separerNom(complet) {
  const bouts = complet ? complet.split(" ") : [];
  if (bouts.length === 0) return { prenom: "", nom: "" };
  if (bouts.length === 1) return { prenom: bouts[0], nom: "" };
  return { prenom: bouts[0], nom: bouts.slice(1).join(" ") };
}

// Retourne les 10 chiffres d'un numero nord-americain, ou null
function nettoyerTelephone(v) {
  if (!v) return null;
  let chiffres = v.toString().replace(/\D/g, "");
  if (chiffres.length === 11 && chiffres.startsWith("1")) chiffres = chiffres.slice(1);
  if (chiffres.length !== 10) return null;
  return chiffres;
}

// Comparaison a duree constante, pour ne pas laisser deviner la cle
function egalite(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(obj, statut) {
  return new Response(JSON.stringify(obj), {
    status: statut,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

function texte(t, statut) {
  return new Response(t, { status: statut, headers: { "Cache-Control": "no-store" } });
}

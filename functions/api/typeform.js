// ============================================================
// Typeform -> Velocity (Newton) : creation automatique du dossier
// ------------------------------------------------------------
// Ce code tourne sur les serveurs de Cloudflare. La cle API de
// Velocity n'apparait jamais dans le navigateur du visiteur, ce
// que la documentation de Newton exige explicitement.
//
// Deux variables a configurer dans Cloudflare
// (Parametres > Variables et secrets, type Secret) :
//   VELOCITY_API_KEY   la cle obtenue dans Velocity
//   TYPEFORM_SECRET    le secret choisi dans Typeform
//
// Adresse a inscrire dans Typeform (Connect > Webhooks) :
//   https://margotmarion.ca/api/typeform
// ============================================================

const VELOCITY_URL = "https://api-velocity.newton.ca/api/forms/v1/deals/deal";

// Correspondance entre les references Typeform et les champs Velocity.
// Dans Typeform, chaque question a une "reference" modifiable :
// il suffit de nommer les references comme ci-dessous.
const REFS = {
  prenom: "prenom",
  nom: "nom",
  courriel: "courriel",
  telephone: "telephone",
  projet: "projet",            // achat / refinancement / renouvellement
  prix: "prix",                // prix d'achat envisage
  montant: "montant",          // montant du pret souhaite
  ville: "ville",
  premier_achat: "premier_achat",
  langue: "langue",
  message: "message",
  consentement: "consentement" // consentement LCAP
};

// Enumerations de Velocity utilisees ici
const PURPOSE = { achat: 10, refinancement: 20, renouvellement: 30 };
const QUEBEC = 11;      // ProvincesOrStates
const CANADA = 1;       // AddressCountries
const LANGUE = { francais: 2, anglais: 1 };
const PREFERENCE_COURRIEL = 3;

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "POST") {
    return texte("Ce point d'entree n'accepte que POST.", 405);
  }
  if (!env.VELOCITY_API_KEY) {
    return json({ erreur: "cle_velocity_absente" }, 503);
  }

  const corps = await request.text();

  // --- Verification de la signature Typeform ---
  // Sans elle, n'importe qui pourrait creer des dossiers dans Velocity.
  if (env.TYPEFORM_SECRET) {
    const recue = request.headers.get("Typeform-Signature");
    if (!recue || !(await signatureValide(corps, recue, env.TYPEFORM_SECRET))) {
      return json({ erreur: "signature_invalide" }, 401);
    }
  }

  let charge;
  try {
    charge = JSON.parse(corps);
  } catch (e) {
    return json({ erreur: "json_illisible" }, 400);
  }

  const reponses = lireReponses(charge);
  const dossier = construireDossier(reponses);

  if (!dossier) {
    return json({ erreur: "champs_obligatoires_manquants",
                  requis: ["prenom", "nom", "courriel"] }, 400);
  }

  // --- Envoi a Velocity, avec une seconde tentative ---
  const url = VELOCITY_URL + "?apiKey=" + encodeURIComponent(env.VELOCITY_API_KEY);

  for (let essai = 1; essai <= 2; essai++) {
    try {
      const reponse = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(dossier)
      });

      const detail = await reponse.text();

      if (reponse.ok) {
        let code = null;
        try { code = JSON.parse(detail).loanCode; } catch (e) {}
        return json({ ok: true, loanCode: code }, 200);
      }

      // 400 = donnees refusees par Velocity : reessayer ne changerait rien
      if (reponse.status === 400 || essai === 2) {
        return json({ erreur: "velocity_refuse", statut: reponse.status,
                      detail: detail.slice(0, 600) }, 502);
      }
    } catch (e) {
      if (essai === 2) return json({ erreur: "echec_reseau" }, 502);
    }
    await new Promise((r) => setTimeout(r, 600));
  }

  return json({ erreur: "inconnue" }, 502);
}

// ============================================================
// Lecture de la charge Typeform
// ============================================================
function lireReponses(charge) {
  const out = {};
  const rep = charge && charge.form_response;
  if (!rep || !Array.isArray(rep.answers)) return out;

  for (const a of rep.answers) {
    const ref = a.field && a.field.ref;
    if (!ref) continue;
    out[ref] = valeurReponse(a);
  }

  // Certains formulaires transmettent aussi des variables cachees
  if (rep.hidden) {
    for (const [k, v] of Object.entries(rep.hidden)) {
      if (out[k] === undefined) out[k] = v;
    }
  }
  return out;
}

function valeurReponse(a) {
  switch (a.type) {
    case "text":
    case "short_text":
    case "long_text":
      return a.text;
    case "email":       return a.email;
    case "phone_number": return a.phone_number;
    case "number":      return a.number;
    case "boolean":     return a.boolean;
    case "date":        return a.date;
    case "url":         return a.url;
    case "choice":      return a.choice && (a.choice.label || a.choice.other);
    case "choices":
      return a.choices && (a.choices.labels || []).join(", ");
    default:
      // Repli : on prend la premiere valeur exploitable
      for (const k of ["text", "email", "phone_number", "number", "boolean", "date"]) {
        if (a[k] !== undefined) return a[k];
      }
      return null;
  }
}

// ============================================================
// Construction du dossier au format Velocity
// ============================================================
function construireDossier(r) {
  const prenom = texteCourt(r[REFS.prenom], 20);
  const nom = texteCourt(r[REFS.nom], 40);
  const courriel = (r[REFS.courriel] || "").toString().trim();

  // Velocity exige prenom, nom et courriel
  if (!prenom || !nom || !courriel) return null;

  const emprunteur = {
    firstName: prenom,
    lastName: nom,
    email: courriel,
    caslOptIn: vraiFaux(r[REFS.consentement]),
    correspondenceLanguage: r[REFS.langue] && /angl|engl/i.test(r[REFS.langue])
      ? LANGUE.anglais : LANGUE.francais,
    contactPreference: PREFERENCE_COURRIEL
  };

  const tel = nettoyerTelephone(r[REFS.telephone]);
  if (tel) {
    emprunteur.cellPhone = tel;
    emprunteur.contactPreference = 2; // Cell Phone
  }

  if (r[REFS.premier_achat] !== undefined) {
    emprunteur.firstTimeBuyer = vraiFaux(r[REFS.premier_achat]);
  }

  const dossier = {
    customSource: "site-web",  // permet de tracer l'origine dans Velocity
    mortgageRequest: { purpose: devinerObjet(r[REFS.projet]) },
    borrowers: [emprunteur]
  };

  const prix = nombre(r[REFS.prix]);
  if (prix) dossier.purchasePrice = prix;

  const montant = nombre(r[REFS.montant]);
  if (montant) dossier.mortgageRequest.mortgages = [{ amount: montant }];

  const ville = texteCourt(r[REFS.ville], 20);
  if (ville) {
    dossier.subjectProperty = { city: ville, province: QUEBEC };
  }

  // Toutes les reponses sont conservees en note : rien n'est perdu,
  // meme les questions non associees a un champ Velocity.
  const lignes = [];
  for (const [cle, val] of Object.entries(r)) {
    if (val === null || val === undefined || val === "") continue;
    lignes.push(cle + " : " + val);
  }
  if (lignes.length) {
    dossier.notes = [{
      text: "Demande recue par le formulaire de margotmarion.ca\n\n" +
            lignes.join("\n")
    }];
  }

  return dossier;
}

// ============================================================
// Outils
// ============================================================
function devinerObjet(v) {
  const s = (v || "").toString().toLowerCase();
  if (/refinanc/.test(s)) return PURPOSE.refinancement;
  if (/renouvel|renew/.test(s)) return PURPOSE.renouvellement;
  return PURPOSE.achat; // valeur par defaut
}

function texteCourt(v, max) {
  if (v === null || v === undefined) return "";
  return v.toString().trim().slice(0, max);
}

function nombre(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = parseFloat(v.toString().replace(/[^\d.,-]/g, "").replace(",", "."));
  if (isNaN(n) || n <= 0 || n > 1000000000) return null;
  return n;
}

function vraiFaux(v) {
  if (typeof v === "boolean") return v;
  return /^(oui|yes|true|1|j'accepte|accepte)/i.test((v || "").toString().trim());
}

function nettoyerTelephone(v) {
  if (!v) return null;
  const chiffres = v.toString().replace(/\D/g, "");
  if (chiffres.length < 10) return null;
  return chiffres.slice(-10);
}

// Signature Typeform : HMAC SHA-256 encode en base64, prefixe "sha256="
async function signatureValide(corps, entete, secret) {
  try {
    const attendu = entete.replace(/^sha256=/, "");
    const cle = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", cle, new TextEncoder().encode(corps));
    const calcule = btoa(String.fromCharCode(...new Uint8Array(sig)));
    // Comparaison a duree constante
    if (calcule.length !== attendu.length) return false;
    let diff = 0;
    for (let i = 0; i < calcule.length; i++) {
      diff |= calcule.charCodeAt(i) ^ attendu.charCodeAt(i);
    }
    return diff === 0;
  } catch (e) {
    return false;
  }
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

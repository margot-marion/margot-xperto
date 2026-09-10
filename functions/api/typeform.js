// ============================================================
// Typeform -> Velocity (Newton) : creation automatique du dossier
// ------------------------------------------------------------
// Ce code tourne sur les serveurs de Cloudflare. La cle API de
// Velocity n'apparait jamais dans le navigateur du visiteur, ce
// que la documentation de Newton exige explicitement.
//
// Variables a configurer dans Cloudflare
// (Parametres > Variables et secrets, type Secret) :
//   VELOCITY_API_KEY   la cle obtenue dans Velocity
//   TYPEFORM_SECRET    le secret choisi dans Typeform
//
// Adresse a inscrire dans Typeform (Connect > Webhooks) :
//   https://margotmarion.ca/api/typeform
//
// Les champs sont reconnus par le LIBELLE de la question, pas par
// sa reference : le formulaire peut donc rester tel quel. Si une
// question est reformulee, il suffit d'ajouter le nouveau mot-cle
// dans MOTS_CLES ci-dessous.
// ============================================================

const VELOCITY_URL = "https://api-velocity.newton.ca/api/forms/v1/deals/deal";

// Reconnaissance des questions par mots-cles du libelle.
// L'ordre compte : le premier motif qui correspond gagne.
const MOTS_CLES = [
  ["nom",            /nom\s+complet|votre\s+nom|prenom/i],
  ["courriel",       /courriel|adresse\s+courriel|e-?mail/i],
  ["telephone",      /telephone|numero\s+de\s+tel/i],
  ["projet",         /votre\s+besoin|type\s+de\s+projet|besoin/i],
  ["prix",           /prix\s+d.achat|prix\s+de\s+la\s+propriete/i],
  ["mise_de_fonds",  /mise\s+de\s+fonds/i],
  ["premier_achat",  /premiere\s+propriete|premier\s+achat/i],
  ["propriete_trouvee", /trouve\s+une\s+propriete/i],
  ["revenu",         /revenu\s+annuel|revenu\s+du\s+menage/i],
  ["type_revenu",    /type\s+de\s+revenu/i],
  ["assurance_vie",  /assurance\s+vie/i],
  ["ville",          /ville|municipalite/i],
  ["langue",         /langue/i],
  ["consentement",   /consentement|accepte.*communicat|autorise.*joindre/i],
  ["message",        /autre\s+chose|partager|objectifs|situation\s+actuelle|precision/i]
];

// Enumerations de Velocity
const PURPOSE = { achat: 10, refinancement: 20, renouvellement: 30 };
const QUEBEC = 11;
const LANGUE = { anglais: 1, francais: 2 };
const PREF = { telephone_maison: 1, cellulaire: 2, courriel: 3 };

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

  const lu = lireFormulaire(charge);
  const dossier = construireDossier(lu);

  if (!dossier) {
    return json({
      erreur: "champs_obligatoires_manquants",
      requis: ["nom complet", "courriel"],
      recu: Object.keys(lu.champs),
      questions_vues: lu.titres
    }, 400);
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

      // 400 : Velocity refuse les donnees, reessayer ne changerait rien
      if (reponse.status === 400 || essai === 2) {
        return json({ erreur: "velocity_refuse", statut: reponse.status,
                      detail: detail.slice(0, 800) }, 502);
      }
    } catch (e) {
      if (essai === 2) return json({ erreur: "echec_reseau" }, 502);
    }
    await new Promise((r) => setTimeout(r, 600));
  }

  return json({ erreur: "inconnue" }, 502);
}

// ============================================================
// Lecture du formulaire : on associe chaque reponse au libelle
// de sa question, puis on devine le role du champ.
// ============================================================
function lireFormulaire(charge) {
  const rep = charge && charge.form_response;
  const champs = {};   // role -> valeur
  const parTitre = {}; // libelle -> valeur (pour la note)
  const titres = [];

  if (!rep || !Array.isArray(rep.answers)) return { champs, parTitre, titres };

  // Table des libelles, fournie par Typeform dans chaque envoi
  const libelles = {};
  const def = rep.definition;
  if (def && Array.isArray(def.fields)) {
    for (const f of def.fields) {
      if (f.id) libelles[f.id] = nettoyerTitre(f.title);
      if (f.ref) libelles[f.ref] = nettoyerTitre(f.title);
    }
  }

  for (const a of rep.answers) {
    const f = a.field || {};
    const titre = libelles[f.id] || libelles[f.ref] || "";
    const valeur = valeurReponse(a);
    if (valeur === null || valeur === undefined || valeur === "") continue;

    if (titre) {
      parTitre[titre] = valeur;
      titres.push(titre);
    }

    const role = devinerRole(titre, f.ref);
    if (role && champs[role] === undefined) champs[role] = valeur;
  }

  // Variables cachees, si le formulaire en utilise
  if (rep.hidden) {
    for (const [k, v] of Object.entries(rep.hidden)) {
      if (!v) continue;
      parTitre[k] = v;
      const role = devinerRole(k, k);
      if (role && champs[role] === undefined) champs[role] = v;
    }
  }

  return { champs, parTitre, titres };
}

function nettoyerTitre(t) {
  if (!t) return "";
  // Typeform entoure parfois les titres d'asterisques (mise en gras)
  return t.toString().replace(/\*/g, "").replace(/\s+/g, " ").trim();
}

function devinerRole(titre, ref) {
  const cible = sansAccents((titre || "") + " " + (ref || ""));
  for (const [role, motif] of MOTS_CLES) {
    if (motif.test(cible)) return role;
  }
  return null;
}

function sansAccents(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function valeurReponse(a) {
  switch (a.type) {
    case "text":
    case "short_text":
    case "long_text":   return a.text;
    case "email":       return a.email;
    case "phone_number": return a.phone_number;
    case "number":      return a.number;
    case "boolean":     return a.boolean;
    case "date":        return a.date;
    case "url":         return a.url;
    case "choice":      return a.choice && (a.choice.label || a.choice.other);
    case "choices":     return a.choices && (a.choices.labels || []).join(", ");
    default:
      for (const k of ["text", "email", "phone_number", "number", "boolean", "date"]) {
        if (a[k] !== undefined) return a[k];
      }
      return null;
  }
}

// ============================================================
// Construction du dossier au format Velocity
// ============================================================
function construireDossier(lu) {
  const c = lu.champs;
  const courriel = (c.courriel || "").toString().trim();

  // Velocity exige un prenom, un nom et un courriel
  const { prenom, nom } = separerNom(c.nom);
  if (!prenom || !nom || !courriel) return null;

  const emprunteur = {
    firstName: prenom,
    lastName: nom,
    email: courriel,
    correspondenceLanguage: /angl|engl/i.test(c.langue || "")
      ? LANGUE.anglais : LANGUE.francais,
    contactPreference: PREF.courriel
  };

  // Le consentement n'est declare que si la question existe vraiment
  if (c.consentement !== undefined) {
    emprunteur.caslOptIn = vraiFaux(c.consentement);
  }

  const tel = nettoyerTelephone(c.telephone);
  if (tel) {
    emprunteur.cellPhone = tel;
    emprunteur.contactPreference = PREF.cellulaire;
  }

  if (c.premier_achat !== undefined) {
    emprunteur.firstTimeBuyer = vraiFaux(c.premier_achat);
  }

  const dossier = {
    customSource: "site-web",
    mortgageRequest: { purpose: devinerObjet(c.projet) },
    borrowers: [emprunteur]
  };

  const prix = nombre(c.prix);
  const mdf = nombre(c.mise_de_fonds);
  if (prix) {
    dossier.purchasePrice = prix;
    // Montant du pret deduit du prix et de la mise de fonds
    if (mdf && mdf < prix) {
      dossier.mortgageRequest.mortgages = [{ amount: prix - mdf }];
    }
  }

  const ville = texteCourt(c.ville, 20);
  if (ville) dossier.subjectProperty = { city: ville, province: QUEBEC };

  // Toutes les reponses en note, avec le libelle exact de la question :
  // rien n'est perdu, meme ce qui n'a pas de champ dans Velocity.
  const lignes = [];
  for (const [titre, val] of Object.entries(lu.parTitre)) {
    lignes.push(titre + "\n   " + lisible(val));
  }
  if (lignes.length) {
    dossier.notes = [{
      text: "Demande recue par le formulaire de margotmarion.ca\n\n" +
            lignes.join("\n\n")
    }];
  }

  return dossier;
}

// ============================================================
// Outils
// ============================================================

// "Sophie Tremblay" -> prenom Sophie, nom Tremblay
// "Marie-Claude St-Pierre Gagnon" -> prenom Marie-Claude, nom St-Pierre Gagnon
function separerNom(complet) {
  const s = (complet || "").toString().trim().replace(/\s+/g, " ");
  if (!s) return { prenom: "", nom: "" };
  const bouts = s.split(" ");
  if (bouts.length === 1) {
    // Un seul mot : Velocity exige les deux champs
    return { prenom: bouts[0].slice(0, 20), nom: bouts[0].slice(0, 40) };
  }
  return {
    prenom: bouts[0].slice(0, 20),
    nom: bouts.slice(1).join(" ").slice(0, 40)
  };
}

function devinerObjet(v) {
  const s = sansAccents((v || "").toString().toLowerCase());
  if (/refinanc/.test(s)) return PURPOSE.refinancement;
  if (/renouvel|renew/.test(s)) return PURPOSE.renouvellement;
  return PURPOSE.achat;
}

function texteCourt(v, max) {
  if (v === null || v === undefined) return "";
  return v.toString().trim().slice(0, max);
}

function nombre(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = parseFloat(v.toString().replace(/[^\d.,-]/g, "").replace(/\s/g, "").replace(",", "."));
  if (isNaN(n) || n <= 0 || n > 1000000000) return null;
  return n;
}

function vraiFaux(v) {
  if (typeof v === "boolean") return v;
  return /^(oui|yes|true|1|j.accepte|accepte)/i.test((v || "").toString().trim());
}

function lisible(v) {
  if (typeof v === "boolean") return v ? "Oui" : "Non";
  return v.toString();
}

function nettoyerTelephone(v) {
  if (!v) return null;
  let chiffres = v.toString().replace(/\D/g, "");
  // Numero nord-americain precede de l'indicatif pays
  if (chiffres.length === 11 && chiffres.startsWith("1")) chiffres = chiffres.slice(1);
  if (chiffres.length < 10) return null;
  return chiffres.slice(-10);
}

// Signature Typeform : HMAC SHA-256 en base64, prefixe "sha256="
async function signatureValide(corps, entete, secret) {
  try {
    const attendu = entete.replace(/^sha256=/, "");
    const cle = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", cle, new TextEncoder().encode(corps));
    const calcule = btoa(String.fromCharCode(...new Uint8Array(sig)));
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

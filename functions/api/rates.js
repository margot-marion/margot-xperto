// Récupère les taux de Dominion côté serveur.
//
// Ce code tourne sur les serveurs de Cloudflare, jamais dans le navigateur
// du visiteur. La clé API n'apparaît donc pas dans le code source de la page.
//
// La clé se configure dans Cloudflare :
//   ton projet > Paramètres > Variables et secrets
//   Nom : DLC_API_KEY     Type : Secret

export async function onRequest(context) {
  const cle = context.env.DLC_API_KEY;

  if (!cle) {
    return json({ erreur: "cle_absente" }, 503);
  }

  const url = "https://secure.dominionintranet.ca/rest/rates?apikey=" +
              encodeURIComponent(cle);

  try {
    const reponse = await fetch(url, {
      headers: { Accept: "application/json" },
      // Les taux changent rarement : on garde la réponse 30 minutes en cache
      // pour ne pas interroger l'API à chaque visite.
      cf: { cacheTtl: 1800, cacheEverything: true },
    });

    if (!reponse.ok) {
      return json({ erreur: "api_indisponible", statut: reponse.status }, 502);
    }

    return new Response(await reponse.text(), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=1800",
      },
    });
  } catch (e) {
    return json({ erreur: "echec_reseau" }, 502);
  }
}

function json(objet, statut) {
  return new Response(JSON.stringify(objet), {
    status: statut,
    headers: { "Content-Type": "application/json" },
  });
}

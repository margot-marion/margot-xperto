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

  // Deux tentatives : l'API de Dominion repond parfois par une erreur
  // passagere, et une seule tentative suffisait a afficher le tableau de
  // secours pour rien.
  for (let essai = 1; essai <= 2; essai++) {
    try {
      const reponse = await fetch(url, {
        headers: { Accept: "application/json" },
        cf: {
          // On ne met en cache que les reponses reussies. Auparavant les
          // erreurs etaient mises en cache 30 minutes, ce qui bloquait
          // l'affichage des taux pour toute une region.
          cacheTtlByStatus: { "200-299": 1800, "300-399": 0, "400-599": 0 },
          cacheEverything: true,
        },
      });

      if (reponse.ok) {
        return new Response(await reponse.text(), {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "public, max-age=900",
          },
        });
      }

      if (essai === 2) {
        return json({ erreur: "api_indisponible", statut: reponse.status }, 502);
      }
    } catch (e) {
      if (essai === 2) {
        return json({ erreur: "echec_reseau" }, 502);
      }
    }

    // Courte pause avant la seconde tentative
    await new Promise((r) => setTimeout(r, 400));
  }

  return json({ erreur: "inconnue" }, 502);
}

function json(objet, statut) {
  return new Response(JSON.stringify(objet), {
    status: statut,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

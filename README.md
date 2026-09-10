[LISEZ-MOI.md](https://github.com/user-attachments/files/32060291/LISEZ-MOI.md)
# Site de Margot Marion — mise en ligne par GitHub

Cette méthode remplace le glisser-déposer. Deux avantages :

- Le tableau des taux s'affiche dans le design de la page, et la clé API
  reste protégée sur le serveur
- Modifier un texte se fait directement dans GitHub, et le site se
  redéploie tout seul en une minute

Aucun logiciel à installer. Tout se fait dans le navigateur.

---

## Contenu du dossier

```
index.html                  ← la page
img/
├── margot-marion.png       (petite photo ronde)
└── margot-marion-hero.png  (grande photo du haut)
functions/
└── api/
    └── rates.js            ← va chercher les taux, côté serveur
```

Le dossier `functions` doit rester au même niveau que `index.html`.

---

## Étape 1 — Créer le dépôt sur GitHub

1. Sur github.com, clique le **+** en haut à droite → **New repository**
2. Repository name : `margot-marion`
3. Laisse **Public** (ou choisis Private, les deux fonctionnent)
4. Ne cocher aucune case d'initialisation
5. **Create repository**

---

## Étape 2 — Téléverser les fichiers

Sur la page du dépôt vide, clique **uploading an existing file**.

Décompresse le zip, puis glisse dans la fenêtre :

- le fichier `index.html`
- le dossier `img`
- le dossier `functions`

GitHub conserve la structure des dossiers automatiquement.

Écris un court message (« Première version ») puis **Commit changes**.

Vérifie ensuite que tu vois bien `functions/api/rates.js` dans
l'arborescence. Si le dossier `functions` est absent, les taux ne
fonctionneront pas.

---

## Étape 3 — Connecter Cloudflare à GitHub

Deux choix : reconfigurer ton projet actuel, ou en créer un nouveau. Le
plus simple est d'en créer un nouveau, puis de supprimer l'ancien.

1. Cloudflare → **Workers et Pages** → **Créer** → onglet **Pages**
2. Choisis **Connecter à Git** (au lieu du téléversement direct)
3. Autorise Cloudflare à accéder à ton compte GitHub
4. Sélectionne le dépôt `margot-marion`
5. Paramètres de construction : **laisse tout vide**
   - Framework preset : None
   - Build command : vide
   - Build output directory : vide (ou `/`)
6. **Enregistrer et déployer**

---

## Étape 4 — Enregistrer la clé API

1. Ton projet → **Paramètres** → **Variables et secrets**
2. **Ajouter** :
   - Nom : `DLC_API_KEY`
   - Valeur : ta clé de l'intranet Dominion
   - Type : **Secret** (chiffré)
3. Enregistre
4. **Déploiements** → **Redéployer** le dernier déploiement

Les variables ne s'appliquent qu'au redémarrage, donc le redéploiement est
obligatoire.

---

## Étape 5 — Vérifier

Ouvre ton site. Dans la section des taux, tu devrais voir le tableau dans
les couleurs de la page, avec le meilleur taux mis en évidence et
l'économie mensuelle en vert.

Si tu vois plutôt le tableau gris de Dominion, c'est le filet de sécurité
qui s'est activé : la clé n'est pas encore reconnue. Reprends l'étape 4 et
assure-toi d'avoir redéployé.

Pour tester directement : ouvre `ton-site.pages.dev/api/rates` dans le
navigateur. Tu devrais voir des données JSON. Si tu vois la page d'accueil
à la place, le dossier `functions` n'a pas été détecté.

---

## Étape 6 — Statistiques

Projet → **Analyse Web** → activer. Gratuit, aucun code à ajouter.

---

## Modifier un texte plus tard

1. Va sur ton dépôt GitHub
2. Clique sur `index.html`
3. Clique l'icône de crayon (Edit this file)
4. Modifie le texte
5. **Commit changes**

Cloudflare redéploie automatiquement en une minute environ. Plus de zip à
préparer.

---

## Ton formulaire Typeform

Dans `index.html`, cherche cette ligne près de la fin :

```js
var LIEN_FORMULAIRE = "";
```

Colle ton lien entre les guillemets :

```js
var LIEN_FORMULAIRE = "https://form.typeform.com/to/TONCODE";
```

Les trois boutons « Comparer mes options » ouvriront le formulaire. Tant
que la ligne reste vide, ils lancent un appel au 514-248-4361.

---

## Points à vérifier avant de faire connaître le site

**Ton titre professionnel.** La page indique « Courtière hypothécaire ».
Ta page Leadpages disait « stagiaire ». Utilise le titre exact que ton
permis autorise.

**Les mentions légales des taux.** Elles viennent automatiquement avec les
données de Dominion. Fais valider l'affichage par ton équipe.

**La clé API.** Réinitialise celle qui apparaissait dans ta capture
d'écran, puis utilise la nouvelle dans Cloudflare.

**Aucun témoignage.** C'est volontaire, on n'en a pas inventé. Quand tu en
auras deux ou trois, il y a de la place entre « Approche » et « Une
méthode en quatre étapes ».

---

## Domaine personnalisé

Un domaine comme `margotmarion.ca` coûte environ 15 à 20 $ par année.
Achète-le dans Cloudflare (**Domaines** → **Enregistrer un domaine**),
puis relie-le au projet dans **Domaines personnalisés**. Le certificat
HTTPS est automatique et gratuit.

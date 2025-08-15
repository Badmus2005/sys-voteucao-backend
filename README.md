# Système de Vote UCAO-UUC - Backend

Backend Node.js/Express pour le système de vote de l'Université Catholique de l'Afrique de l'Ouest.

## 🚀 Technologies

- **Node.js** - Runtime JavaScript
- **Express.js** - Framework web
- **Prisma** - ORM pour MySQL
- **JWT** - Authentification
- **bcrypt** - Hachage des mots de passe
- **Multer** - Gestion des uploads
- **Sharp** - Traitement d'images

## 📦 Installation

```bash
# Installer les dépendances
npm install

# Configurer les variables d'environnement
cp env.example .env
# Éditer .env avec vos valeurs

# Générer le client Prisma
npx prisma generate

# Pousser le schéma vers la base de données
npx prisma db push
```

## 🔧 Configuration

Créez un fichier `.env` basé sur `env.example` :

```env
DATABASE_URL="mysql://user:password@localhost:3306/vote_ucao"
JWT_SECRET="votre_secret_jwt"
PORT=5000
NODE_ENV=development
FRONTEND_URL="https://sys-voteucao-frontend.vercel.app"
IMGBB_API_KEY="votre_clé_imgbb"
```

## 🏃‍♂️ Démarrage

```bash
# Mode développement
npm run dev

# Mode production
npm start
```

## 📡 API Endpoints

### Authentification
- `POST /api/userLogin` - Connexion étudiant
- `POST /api/userRegister` - Inscription étudiant
- `POST /api/adminLogin` - Connexion admin
- `POST /api/adminRegister` - Inscription admin

### Élections
- `GET /api/election` - Liste des élections
- `POST /api/election` - Créer une élection
- `GET /api/election/:id` - Détails d'une élection
- `PUT /api/election/:id/close` - Clôturer une élection
- `DELETE /api/election/:id` - Supprimer une élection

### Votes
- `GET /api/vote/token/:electionId` - Obtenir un jeton de vote
- `POST /api/vote` - Soumettre un vote
- `GET /api/vote/results/:electionId` - Résultats d'une élection
- `GET /api/vote/status/:electionId` - Statut de vote d'un utilisateur

### Candidats
- `GET /api/candidats` - Liste des candidats
- `POST /api/candidats` - Créer une candidature

### Upload
- `POST /api/upload/image` - Upload d'image de profil

### Statistiques
- `GET /api/stats/dashboard` - Statistiques du dashboard admin
- `GET /api/stats/election/:id` - Statistiques d'une élection spécifique

### Utilisateurs
- `GET /api/users/profile` - Profil utilisateur
- `PUT /api/users/profile` - Mettre à jour le profil

### Routes Supplémentaires
- `GET /api/admin` - Routes admin
- `GET /api/matricules` - Gestion des matricules
- `GET /api/codes` - Gestion des codes d'inscription
- `GET /api/activity` - Logs d'activité

## 🚀 Déploiement sur Railway

1. Connectez votre repository GitHub à Railway
2. Configurez les variables d'environnement dans Railway
3. Définissez la commande de build : `npm install && npx prisma generate && npx prisma db push`
4. Définissez la commande de démarrage : `npm start`

## 📊 Base de Données

Le projet utilise MySQL avec Prisma ORM. Le schéma est défini dans `prisma/schema.prisma`.

### Commandes Prisma utiles :

```bash
# Générer le client Prisma
npx prisma generate

# Pousser les changements vers la DB
npx prisma db push

# Ouvrir Prisma Studio
npx prisma studio
```

## 🔒 Sécurité

- Authentification JWT
- Hachage des mots de passe avec bcrypt
- Validation des données
- CORS configuré
- Rate limiting (si activé)

## 📝 Changelog

### Version 2.0.0 (2025-12-08)
- ✅ Correction des routes pour correspondre à config.js
- ✅ Ajout de `/api/upload/image` (au lieu de `/api/upload/:type`)
- ✅ Ajout de `/api/stats/dashboard` et `/api/stats/election/:id`
- ✅ Amélioration de la gestion des uploads d'images
- ✅ Documentation complète des endpoints

## 🆘 Support

Pour toute question ou problème, consultez les logs Railway ou contactez l'équipe de développement.

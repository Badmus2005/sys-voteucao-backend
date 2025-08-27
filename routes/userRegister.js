import express from 'express';
import bcrypt from 'bcrypt';
import prisma from '../prisma.js';

const router = express.Router();

// Génère un identifiant temporaire stable (créé à l'inscription, utilisé uniquement si reset)
const generateTemporaryIdentifiant = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let identifiant = '';
  for (let i = 0; i < 8; i++) identifiant += chars.charAt(Math.floor(Math.random() * chars.length));
  return `TEMP${identifiant}`;
};

// Validations simples
const validateEmail = (email) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && !/[<>"'`]/.test(email);

const validatePassword = (password) =>
  password.length >= 8 && /[A-Z]/.test(password) && /[0-9]/.test(password) && /[!@#$%^&*(),.?":{}|<>]/.test(password);

// Logger minimal
const logger = {
  info: (m, d) => console.log(`[INFO] ${m}`, JSON.stringify(d)),
  error: (m, e) => console.error(`[ERROR] ${m}`, { error: e.message, stack: e.stack, at: new Date().toISOString() })
};

// Rate limit très simple
const rateLimit = (options) => {
  const requests = new Map();
  return (req, res, next) => {
    const ip = req.ip;
    const now = Date.now();
    const windowMs = options.windowMs || 15 * 60 * 1000;
    const max = options.max || 5;
    const entry = requests.get(ip) || { count: 0, startTime: now };
    if (now - entry.startTime > windowMs) {
      requests.set(ip, { count: 1, startTime: now });
      return next();
    }
    if (entry.count >= max) {
      logger.error('Rate limit exceeded', { ip });
      return res.status(429).json({ success: false, message: 'Trop de tentatives. Réessayez plus tard.' });
    }
    entry.count++;
    requests.set(ip, entry);
    next();
  };
};

router.post('/', rateLimit({ windowMs: 15 * 60 * 1000, max: 5 }), async (req, res) => {
  try {
    const { email, password, nom, prenom, filiere, annee, code, matricule, ecole } = req.body;

    // Champs obligatoires
    if (!email || !password || !nom || !prenom || !filiere || !annee || !ecole) {
      return res.status(400).json({ success: false, message: 'Tous les champs obligatoires sont requis.' });
    }

    const anneeInt = Number.parseInt(annee, 10);
    if (!Number.isInteger(anneeInt) || anneeInt < 1 || anneeInt > 3) {
      return res.status(400).json({ success: false, message: "L'année doit être entre 1 et 3." });
    }
    if (!validateEmail(email)) {
      return res.status(400).json({ success: false, message: 'Format email invalide.' });
    }
    if (!validatePassword(password)) {
      return res.status(400).json({
        success: false,
        message: 'Le mot de passe doit contenir 8+ caractères, 1 majuscule, 1 chiffre et 1 caractère spécial.'
      });
    }

    // Email unique
    const emailExists = await prisma.user.findUnique({ where: { email } });
    if (emailExists) {
      return res.status(409).json({ success: false, message: "Cet email est déjà utilisé." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // ————————————————————————————————————————————————————————————————
    // 1) 1ère année : code d'inscription —> crée user avec password normal,
    //    génère identifiantTemporaire, PAS de temporaryPassword.
    // ————————————————————————————————————————————————————————————————
    if (anneeInt === 1) {
      if (!code) {
        return res.status(400).json({ success: false, message: "Code d'inscription requis pour la 1ère année." });
      }
      const regCode = await prisma.registrationCode.findUnique({ where: { code } });
      if (!regCode || regCode.isUsed) {
        return res.status(400).json({ success: false, message: "Code d'inscription invalide ou déjà utilisé." });
      }

      try {
        const temporaryIdentifiant = generateTemporaryIdentifiant();

        const createdUser = await prisma.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: {
              email,
              password: hashedPassword,
              role: 'ETUDIANT',
              temporaryPassword: null,           // <— important
              requirePasswordChange: false,      // <— important
              etudiant: {
                create: {
                  nom,
                  prenom,
                  identifiantTemporaire: temporaryIdentifiant,
                  filiere,
                  annee: anneeInt,
                  codeInscription: code,
                  matricule: null,
                  ecole
                }
              }
            },
            include: { etudiant: true }
          });

          await tx.registrationCode.update({
            where: { code },
            data: { isUsed: true, usedById: user.id }
          });

          return user;
        });

        logger.info('Inscription 1ère année OK', { userId: createdUser.id, email });

        return res.status(201).json({
          success: true,
          message: "Inscription réussie.",
          data: {
            student: {
              id: createdUser.id,
              nom: createdUser.etudiant.nom,
              prenom: createdUser.etudiant.prenom,
              identifiantTemporaire: createdUser.etudiant.identifiantTemporaire,
              filiere: createdUser.etudiant.filiere,
              annee: createdUser.etudiant.annee,
              ecole: createdUser.etudiant.ecole
            }
            // ⛔️ Pas de credentials temporaires renvoyés à la création
          }
        });
      } catch (txError) {
        logger.error('Erreur transaction 1A', txError);
        return res.status(500).json({ success: false, message: "Erreur lors de l'inscription." });
      }
    }

    // ————————————————————————————————————————————————————————————————
    // 2) 2e/3e année : via matricule —> compte lié existant, password normal,
    //    identifiantTemporaire généré si absent, PAS de temporaryPassword.
    // ————————————————————————————————————————————————————————————————
    if (anneeInt >= 2 && anneeInt <= 3) {
      if (!matricule) {
        return res.status(400).json({ success: false, message: 'Matricule requis pour les années supérieures.' });
      }

      try {
        const etuRow = await prisma.etudiant.findUnique({ where: { matricule } });
        if (!etuRow) {
          return res.status(404).json({ success: false, message: "Matricule non trouvé. Contactez l'administration." });
        }
        if (etuRow.userId) {
          return res.status(409).json({ success: false, message: 'Ce matricule est déjà associé à un compte.' });
        }

        const temporaryIdentifiant = etuRow.identifiantTemporaire || generateTemporaryIdentifiant();

        const createdUser = await prisma.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: {
              email,
              password: hashedPassword,          // <— password normal choisi à l’inscription
              role: 'ETUDIANT',
              temporaryPassword: null,
              requirePasswordChange: false
            }
          });

          await tx.etudiant.update({
            where: { id: etuRow.id },
            data: {
              userId: user.id,
              nom,
              prenom,
              identifiantTemporaire: temporaryIdentifiant,
              filiere,
              annee: anneeInt,
              codeInscription: null,
              ecole
            }
          });

          return user;
        });

        logger.info('Inscription 2/3A OK', { email, matricule });

        return res.status(201).json({
          success: true,
          message: 'Inscription réussie.',
          data: {
            student: {
              id: createdUser.id,
              nom,
              prenom,
              matricule,
              identifiantTemporaire: temporaryIdentifiant,
              filiere,
              annee: anneeInt,
              ecole
            }
            // ⛔️ Pas de credentials temporaires renvoyés à la création
          }
        });
      } catch (txError) {
        logger.error('Erreur transaction 2/3A', txError);
        return res.status(500).json({ success: false, message: "Erreur lors de l'association du matricule." });
      }
    }

  } catch (err) {
    logger.error('Erreur inscription', err);
    return res.status(500).json({ success: false, message: 'Une erreur serveur est survenue.' });
  }
});

export default router;

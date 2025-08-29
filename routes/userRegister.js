import express from 'express';
import bcrypt from 'bcrypt';
import prisma from '../prisma.js';

const router = express.Router();

// Génère un identifiant temporaire stable
const generateTemporaryIdentifiant = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let identifiant = '';
  for (let i = 0; i < 8; i++) identifiant += chars.charAt(Math.floor(Math.random() * chars.length));
  return `TEMP${identifiant}`;
};

// Validations
const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const forbiddenChars = /[<>"'`]/;
  return emailRegex.test(email) && !forbiddenChars.test(email);
};

const validatePassword = (password) =>
  password.length >= 8 && /[A-Z]/.test(password) && /[0-9]/.test(password) && /[!@#$%^&*(),.?":{}|<>]/.test(password);

const validateText = (text) => !/[<>"'`]/.test(text);

// Logger minimal
const logger = {
  info: (m, d) => console.log(`[INFO] ${m}`, JSON.stringify(d)),
  error: (m, e) => console.error(`[ERROR] ${m}`, { error: e.message, stack: e.stack, at: new Date().toISOString() })
};

// Rate limit
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
  console.log("Requête reçue:", req.body);
  try {
    const { email, password, confirmPassword, nom, prenom, filiere, annee, code, matricule, ecole } = req.body;

    // Champs obligatoires
    if (!email || !password || !confirmPassword || !nom || !prenom || !filiere || !annee || !ecole) {
      return res.status(400).json({ success: false, message: 'Tous les champs obligatoires sont requis.' });
    }

    // Validation des mots de passe identiques
    if (password !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'Les mots de passe ne correspondent pas.' });
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

    // Validation des champs texte
    if (!validateText(nom) || !validateText(prenom) || !validateText(filiere) || !validateText(ecole)) {
      return res.status(400).json({
        success: false,
        message: 'Le nom, prénom, filière et école ne doivent pas contenir de caractères spéciaux.'
      });
    }

    // Email unique
    const emailExists = await prisma.user.findUnique({ where: { email } });
    if (emailExists) {
      return res.status(409).json({ success: false, message: "Cet email est déjà utilisé." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // 1ère année : code d'inscription
    if (anneeInt === 1) {
      if (!code) {
        return res.status(400).json({
          success: false,
          message: "Code d'inscription requis pour la 1ère année."
        });
      }

      try {
        const regCode = await prisma.registrationCode.findUnique({ where: { code } });

        if (!regCode) {
          return res.status(404).json({
            success: false,
            message: "Ce code d'inscription n'existe pas."
          });
        }

        if (regCode.isUsed) {
          return res.status(409).json({
            success: false,
            message: "Ce code d'inscription a déjà été utilisé."
          });
        }

        const temporaryIdentifiant = generateTemporaryIdentifiant();

        const createdUser = await prisma.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: {
              email,
              password: hashedPassword,
              role: 'ETUDIANT',
              tempPassword: null,
              requirePasswordChange: false,
              etudiant: {
                create: {
                  nom,
                  prenom,
                  identifiantTemporaire: temporaryIdentifiant,
                  filiere,
                  annee: anneeInt,
                  codeInscription: code,
                  matricule: undefined, // évite les conflits @unique
                  ecole
                }
              }
            },
            include: { etudiant: true }
          });

          await tx.registrationCode.update({
            where: { code },
            data: {
              used: true,
              usedByUser: {
                connect: { id: user.id }
              }
            }
          });


          return user;
        });

        logger.info('Inscription 1ère année OK', {
          userId: createdUser.id,
          email,
          code
        });

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
          }
        });

      } catch (txError) {
        logger.error('Erreur transaction 1A', {
          message: txError.message,
          code: txError.code,
          stack: txError.stack
        });

        return res.status(500).json({
          success: false,
          message: "Erreur interne lors de l'inscription.",
          error: txError.message
        });
      }
    }


    // 2e/3e année : via matricule
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
              password: hashedPassword,
              role: 'ETUDIANT',
              tempPassword: null,
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
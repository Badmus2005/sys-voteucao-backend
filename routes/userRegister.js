import express from 'express';
import bcrypt from 'bcrypt';
import prisma from '../prisma.js';

const router = express.Router();

// Fonctions de validation intégrées
const validateEmail = (email) => {
  // Regex email standard + protection contre les injections
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) 
    && !/[<>"'`]/.test(email); // Bloque les caractères dangereux
};

const validatePassword = (password) => {
  // Au moins 8 caractères, 1 majuscule, 1 chiffre, 1 caractère spécial
  return password.length >= 8 
    && /[A-Z]/.test(password)
    && /[0-9]/.test(password)
    && /[!@#$%^&*(),.?":{}|<>]/.test(password);
};

// Logger simplifié intégré
const logger = {
  info: (message, data) => console.log(`[INFO] ${message}`, JSON.stringify(data)),
  error: (message, error) => {
    console.error(`[ERROR] ${message}`, {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
  }
};

// Middleware de limite de taux intégré
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
      return res.status(429).json({ 
        success: false, 
        message: 'Trop de tentatives. Réessayez plus tard.' 
      });
    }
    
    entry.count++;
    requests.set(ip, entry);
    next();
  };
};

router.post('/', rateLimit({ windowMs: 15 * 60 * 1000, max: 5 }), async (req, res) => {
  try {
    const { email, password, nom, prenom, filiere, annee, code, matricule } = req.body;
    const anneeInt = parseInt(annee, 10);

    // Validation de base
    if (!email || !password || !nom || !prenom || !filiere || !annee) {
      return res.status(400).json({ 
        success: false,
        message: 'Tous les champs obligatoires sont requis.' 
      });
    }

    if (!validateEmail(email)) {
      return res.status(400).json({ 
        success: false,
        message: 'Format email invalide. Utilisez exemple@ucao.bj' 
      });
    }

    if (!validatePassword(password)) {
      return res.status(400).json({
        success: false,
        message: 'Le mot de passe doit contenir 8+ caractères, 1 majuscule, 1 chiffre et 1 caractère spécial.'
      });
    }

    if (anneeInt < 1 || anneeInt > 5) {
      return res.status(400).json({ 
        success: false,
        message: "L'année doit être entre 1 et 5." 
      });
    }

    // Vérifier l'unicité de l'email
    const emailExists = await prisma.user.findUnique({ where: { email } });
    if (emailExists) {
      logger.error('Email déjà utilisé', { email });
      return res.status(409).json({ 
        success: false,
        message: 'Cet email est déjà utilisé.' 
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // 1ère année - validation par code
    if (anneeInt === 1) {
      if (!code) {
        return res.status(400).json({ 
          success: false,
          message: 'Code d\'inscription requis pour la 1ère année.' 
        });
      }

      const regCode = await prisma.registrationCode.findUnique({ where: { code } });
      if (!regCode || regCode.isUsed) {
        logger.error('Code d\'inscription invalide', { code });
        return res.status(400).json({ 
          success: false,
          message: 'Code d\'inscription invalide ou déjà utilisé.' 
        });
      }

      try {
        const createdUser = await prisma.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: {
              email,
              password: hashedPassword,
              role: 'ETUDIANT',
              etudiant: {
                create: {
                  nom,
                  prenom,
                  filiere,
                  annee: anneeInt,
                  codeInscription: code
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

        logger.info('Nouvel étudiant inscrit (1ère année)', { 
          userId: createdUser.id,
          email: createdUser.email
        });
        
        return res.status(201).json({
          success: true,
          message: 'Inscription réussie pour la 1ère année.',
          data: {
            userId: createdUser.id,
            email: createdUser.email
          }
        });

      } catch (txError) {
        logger.error('Erreur transaction 1ère année', txError);
        return res.status(500).json({
          success: false,
          message: 'Erreur lors de l\'inscription.'
        });
      }
    }

    // Années supérieures - validation par matricule
    if (anneeInt >= 2) {
      if (!matricule) {
        return res.status(400).json({ 
          success: false,
          message: 'Matricule requis pour les années supérieures.' 
        });
      }

      try {
        const etuRow = await prisma.etudiant.findUnique({ where: { matricule } });
        if (!etuRow) {
          logger.error('Matricule introuvable', { matricule });
          return res.status(404).json({ 
            success: false,
            message: 'Matricule non trouvé. Contactez l\'administration.' 
          });
        }

        if (etuRow.userId) {
          logger.error('Matricule déjà associé', { matricule });
          return res.status(409).json({ 
            success: false,
            message: 'Ce matricule est déjà associé à un compte.' 
          });
        }

        const createdUser = await prisma.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: { 
              email, 
              password: hashedPassword, 
              role: 'ETUDIANT' 
            }
          });

          await tx.etudiant.update({
            where: { id: etuRow.id },
            data: { 
              userId: user.id, 
              nom, 
              prenom, 
              filiere, 
              annee: anneeInt 
            }
          });

          return user;
        });

        logger.info('Étudiant existant associé', { 
          userId: createdUser.id,
          matricule,
          annee: anneeInt
        });
        
        return res.status(201).json({
          success: true,
          message: 'Inscription réussie pour les années supérieures.',
          data: {
            userId: createdUser.id,
            matricule,
            annee: anneeInt
          }
        });

      } catch (txError) {
        logger.error('Erreur transaction années supérieures', txError);
        return res.status(500).json({
          success: false,
          message: 'Erreur lors de l\'association du matricule.'
        });
      }
    }

  } catch (err) {
    logger.error('Erreur inscription', err);
    return res.status(500).json({
      success: false,
      message: 'Une erreur serveur est survenue.'
    });
  }
});

export default router;
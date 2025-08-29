import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import prisma from '../prisma.js';
import { authenticateToken } from '../middlewares/auth.js';
import { PasswordResetService } from '../services/passwordResetService.js';

const router = express.Router();

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
    }
});

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';
const JWT_EXPIRES_NORMAL = '8h';
const JWT_EXPIRES_TEMP = '1h';

// --- LOGIN ---
// accepte body: { identifier/email, password, identifiantTemporaire (optionnel) }
// on supporte recherche par email OR identifiantTemporaire
router.post('/', async (req, res) => {
    try {
        console.log('=== DÉBUT LOGIN ===');
        console.log('Body reçu:', JSON.stringify(req.body, null, 2));

        // Accept both shapes: either { email, password } or { identifier, password } or { identifiantTemporaire, password }
        const identifier = req.body.identifier || req.body.email || null;
        const { password, identifiantTemporaire } = req.body;

        // If identifiantTemporaire explicitly provided -> handle temporary flow
        if (identifiantTemporaire) {
            console.log('Tentative avec identifiant temporaire fournie');
            return handleTemporaryLogin(req, res);
        }

        if (!identifier || !password) {
            console.log('Champs manquants');
            return res.status(400).json({ success: false, message: 'Identifiant et mot de passe requis' });
        }

        let user = null;

        // Détecter si l'identifiant contient '@' → email, sinon identifiant normal
        if (identifier.includes('@')) {
            // Recherche par email
            user = await prisma.user.findUnique({
                where: { email: identifier },
                include: { etudiant: true, admin: true }
            });
        } else {
            // Recherche par identifiant temporaire (ou autre identifiant normal)
            const studentRow = await prisma.etudiant.findFirst({
                where: { identifiantTemporaire: identifier },
                include: { user: true }
            });
            if (studentRow && studentRow.user) user = studentRow.user;
        }


        if (!user) {
            console.log('Utilisateur non trouvé');
            return res.status(401).json({ success: false, message: 'Identifiants invalides' });
        }

        console.log('Utilisateur trouvé:', user.email || user.id);

        // Check if temporary password exists
        if (user.tempPassword) {
            if (identifiantTemporaire) {
                // L'utilisateur tente de se connecter avec le mot de passe temporaire
                return handleTemporaryLogin(req, res);
            } else {
                // Connexion normale non autorisée tant que compte temp existe
                return res.status(401).json({
                    success: false,
                    message: 'Votre compte a été réinitialisé. Utilisez vos identifiants temporaires.',
                    requirePasswordChange: true
                });
            }
        }

        // Normal password flow
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            console.log('Mot de passe invalide');
            return res.status(401).json({ success: false, message: 'Identifiants invalides' });
        }
        // Génération du token JWT

        const token = jwt.sign(
            {
                id: user.id,
                role: user.role,
                requirePasswordChange: user.requirePasswordChange || false
            },
            process.env.JWT_SECRET,
            { expiresIn: '8h' }
        );


        res.json({
            success: true,
            message: 'Connexion réussie',
            data: {
                token,
                requirePasswordChange: user.requirePasswordChange || false,
                user: {
                    id: user.id,
                    email: user.email,
                    role: user.role,
                    nom: user.etudiant?.nom || '',
                    prenom: user.etudiant?.prenom || ''
                }
            }
        });

        console.log('=== FIN LOGIN SUCCÈS ===');
    } catch (error) {
        console.error('ERREUR LOGIN:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur lors de la connexion' });
    }
});

// --- Temporary login handler (identifiantTemporaire + temp password) ---
const handleTemporaryLogin = async (req, res) => {
    try {
        const { identifiantTemporaire, password } = req.body;
        if (!identifiantTemporaire || !password) {
            return res.status(400).json({ success: false, message: 'Identifiant temporaire et mot de passe requis' });
        }

        // Validate via service (checks expiry + hash)
        const student = await PasswordResetService.validateTemporaryCredentials(identifiantTemporaire, password);

        // Generate short-lived token (temp login)
        const token = jwt.sign(
            {
                id: student.user.id,
                email: student.user.email,
                role: student.user.role,
                requirePasswordChange: true
            },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_TEMP } // 1h expiration for temp login
        );

        return res.json({
            success: true,
            message: 'Connexion temporaire réussie - Changement de mot de passe requis',
            data: {
                token,                  // nom uniforme
                requirePasswordChange: true,
                user: {
                    id: student.user.id,
                    email: student.user.email,
                    role: student.user.role,
                    etudiant: {
                        id: student.id,
                        nom: student.nom,
                        prenom: student.prenom,
                        matricule: student.matricule,
                        filiere: student.filiere,
                        annee: student.annee,
                        identifiantTemporaire: student.identifiantTemporaire
                    }
                }
            }
        });
    } catch (error) {
        console.error('Temporary login error:', error);
        return res.status(401).json({ success: false, message: error.message });
    }
};

// --- Change password after temporary login ---
// Now if user.requirePasswordChange === true, we allow sending only { newPassword, confirmPassword }
// without requiring currentPassword. If requirePasswordChange is false, currentPassword is required.
router.post('/change-password-temporary', authenticateToken, async (req, res) => {
    try {
        const { newPassword, confirmPassword, currentPassword } = req.body;
        if (!newPassword || !confirmPassword) {
            return res.status(400).json({ success: false, message: 'Tous les champs requis' });
        }
        if (newPassword !== confirmPassword) {
            return res.status(400).json({ success: false, message: 'Les mots de passe ne correspondent pas' });
        }
        if (newPassword.length < 8) {
            return res.status(400).json({ success: false, message: 'Le mot de passe doit contenir au moins 8 caractères' });
        }

        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            select: { id: true, tempPassword: true, password: true, requirePasswordChange: true }
        });

        if (!user) return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });

        // If requirePasswordChange is true -> we do not require currentPassword,
        // but we still ensure that tempPassword existed and was valid at login time.
        if (user.requirePasswordChange) {
            // simply complete reset
            await PasswordResetService.completePasswordReset(user.id, newPassword);

            // issue new token without flag
            const newToken = jwt.sign({ id: user.id, role: req.user.role, requirePasswordChange: false }, JWT_SECRET, { expiresIn: JWT_EXPIRES_NORMAL });

            return res.json({
                success: true,
                message: 'Mot de passe changé avec succès',
                data: { token: newToken, requirePasswordChange: false }
            });
        }

        // Otherwise: standard flow requires currentPassword
        if (!currentPassword) {
            return res.status(400).json({ success: false, message: 'Mot de passe actuel requis' });
        }

        const isCurrentValid = await bcrypt.compare(currentPassword, user.password);
        if (!isCurrentValid) {
            return res.status(401).json({ success: false, message: 'Mot de passe actuel incorrect' });
        }

        // Prevent using same password
        const isSame = await bcrypt.compare(newPassword, user.password);
        if (isSame) {
            return res.status(400).json({ success: false, message: 'Le nouveau mot de passe doit être différent de l\'ancien' });
        }

        // Use PasswordResetService.completePasswordReset to standardize
        await PasswordResetService.completePasswordReset(user.id, newPassword);

        return res.json({ success: true, message: 'Mot de passe changé avec succès' });
    } catch (error) {
        console.error('Erreur changement mot de passe temporaire:', error);
        return res.status(500).json({ success: false, message: 'Erreur lors du changement de mot de passe' });
    }
});

// --- Change password normal (user authenticated) ---
router.post('/change-password', authenticateToken, async (req, res) => {
    try {
        const { currentPassword, newPassword, confirmPassword } = req.body;

        if (!currentPassword || !newPassword || !confirmPassword) {
            return res.status(400).json({ success: false, message: 'Tous les champs sont requis' });
        }
        if (newPassword !== confirmPassword) {
            return res.status(400).json({ success: false, message: 'Les mots de passe ne correspondent pas' });
        }
        if (newPassword.length < 8) {
            return res.status(400).json({ success: false, message: 'Le mot de passe doit contenir au moins 8 caractères' });
        }

        const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { id: true, password: true, role: true } });
        if (!user) return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });

        // Vérifier l'ancien mot de passe
        const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
        if (!isCurrentPasswordValid) {
            return res.status(401).json({ success: false, message: 'Mot de passe actuel incorrect' });
        }

        // Vérifier que le nouveau mot de passe est différent de l'ancien
        const isSamePassword = await bcrypt.compare(newPassword, user.password);
        if (isSamePassword) {
            return res.status(400).json({ success: false, message: 'Le nouveau mot de passe doit être différent de l\'ancien' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await prisma.user.update({ where: { id: req.user.id }, data: { password: hashedPassword } });

        return res.json({ success: true, message: 'Mot de passe changé avec succès' });
    } catch (error) {
        console.error('Erreur changement mot de passe:', error);
        return res.status(500).json({ success: false, message: 'Erreur lors du changement de mot de passe' });
    }
});

// --- Forgot password (send reset email) ---
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ success: false, message: 'Email requis' });

        const user = await prisma.user.findUnique({ where: { email }, include: { etudiant: true } });

        // pour sécurité on donne toujours le même message
        if (!user || user.role !== 'ETUDIANT') {
            return res.json({ success: true, message: 'Si cet email existe dans notre système, un lien de réinitialisation a été envoyé' });
        }

        const resetToken = jwt.sign({ userId: user.id, type: 'password_reset', email: user.email }, JWT_SECRET, { expiresIn: '1h' });
        const resetLink = `${process.env.FRONTEND_URL}/reset-password.html?token=${resetToken}`;

        const mailOptions = {
            from: process.env.EMAIL_FROM || 'no-reply@ucao-uuc.com',
            to: email,
            subject: 'Réinitialisation de votre mot de passe - UCAO-UUC',
            html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color:#800020;">Réinitialisation de mot de passe</h2>
          <p>Bonjour ${user.etudiant?.prenom || 'Étudiant'},</p>
          <p>Pour créer un nouveau mot de passe, cliquez sur le bouton ci-dessous :</p>
          <div style="text-align:center; margin:30px 0;">
            <a href="${resetLink}" style="background-color:#800020;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Réinitialiser mon mot de passe</a>
          </div>
          <p>Ce lien est valable pendant <strong>1 heure</strong>.</p>
          <p>Si vous n'avez pas demandé cette réinitialisation, ignorez cet email.</p>
        </div>`
        };

        await transporter.sendMail(mailOptions);

        return res.json({ success: true, message: 'Si cet email existe dans notre système, un lien de réinitialisation a été envoyé' });
    } catch (error) {
        console.error('Erreur envoi email réinitialisation:', error);
        return res.status(500).json({ success: false, message: 'Erreur lors de l\'envoi des instructions de réinitialisation' });
    }
});

// --- Reset password via token (from forgot-password email) ---
router.post('/reset-password', async (req, res) => {
    try {
        const { token, newPassword, confirmPassword } = req.body;
        if (!token || !newPassword || !confirmPassword) return res.status(400).json({ success: false, message: 'Tous les champs sont requis' });
        if (newPassword !== confirmPassword) return res.status(400).json({ success: false, message: 'Les mots de passe ne correspondent pas' });
        if (newPassword.length < 8) return res.status(400).json({ success: false, message: 'Le mot de passe doit contenir au moins 8 caractères' });

        let decoded;
        try {
            decoded = jwt.verify(token, JWT_SECRET);
        } catch (err) {
            return res.status(401).json({ success: false, message: 'Lien de réinitialisation invalide ou expiré' });
        }

        if (decoded.type !== 'password_reset') return res.status(401).json({ success: false, message: 'Token invalide' });

        const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
        if (!user) return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });

        // Hash and update password; clear any temporary fields and flag
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await prisma.user.update({
            where: { id: user.id },
            data: {
                password: hashedPassword,
                tempPassword: null,
                requirePasswordChange: false,
                passwordResetExpires: null
            }
        });

        return res.json({ success: true, message: 'Mot de passe réinitialisé avec succès' });
    } catch (error) {
        console.error('Erreur réinitialisation mot de passe:', error);
        return res.status(500).json({ success: false, message: 'Erreur lors de la réinitialisation du mot de passe' });
    }
});

export default router;

import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import prisma from '../prisma.js';
import { authenticateToken } from '../middlewares/auth.js';
import { PasswordResetService } from '../services/passwordResetService.js';

const router = express.Router();

// Configuration du transporteur email
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
    }
});
router.post('/', async (req, res) => {
    console.log('Requête POST reçue sur /api/userLogin');
    res.send('Login route OK');
});

// Route de connexion
router.post('/login', async (req, res) => {
    try {
        console.log('=== DÉBUT LOGIN ===');
        console.log('Body reçu:', JSON.stringify(req.body, null, 2));
        console.log('Headers:', req.headers);

        const { email, password, identifiantTemporaire } = req.body;

        if (identifiantTemporaire) {
            console.log('Tentative avec identifiant temporaire');
            return handleTemporaryLogin(req, res);
        }

        if (!email || !password) {
            console.log('Champs manquants');
            return res.status(400).json({ message: 'Email et mot de passe requis' });
        }

        console.log('Recherche utilisateur avec email:', email);

        const user = await prisma.user.findUnique({
            where: { email },
            include: {
                etudiant: true,
                admin: true
            }
        });

        if (!user) {
            console.log('Utilisateur non trouvé');
            return res.status(401).json({ message: 'Email ou mot de passe incorrect' });
        }

        console.log('Utilisateur trouvé:', user.email);
        console.log('Mot de passe hashé en DB:', user.password);
        console.log('Mot de passe fourni:', password);

        // DEBUG: Vérification manuelle du hash
        const testHash = await bcrypt.hash(password, 10);
        console.log('Nouveau hash du mot de passe fourni:', testHash);
        console.log('Les hashs correspondent:', await bcrypt.compare(password, user.password));

        const validPassword = await bcrypt.compare(password, user.password);
        console.log('Résultat bcrypt.compare:', validPassword);

        if (!validPassword) {
            console.log('Mot de passe invalide');
            return res.status(401).json({ message: 'Email ou mot de passe incorrect' });
        }

        console.log('Connexion réussie pour:', user.email);

        // Reste du code...
        const token = jwt.sign(
            {
                id: user.id,
                role: user.role,
                requirePasswordChange: user.requirePasswordChange
            },
            process.env.JWT_SECRET,
            { expiresIn: '8h' }
        );

        const response = {
            message: 'Connexion réussie',
            token,
            requirePasswordChange: user.requirePasswordChange,
            user: {
                id: user.id,
                email: user.email,
                role: user.role
            }
        };

        res.json(response);
        console.log('=== FIN LOGIN SUCCÈS ===');

    } catch (error) {
        console.error('ERREUR LOGIN:', error);
        console.error('Stack:', error.stack);
        res.status(500).json({ message: 'Erreur serveur lors de la connexion' });
    }
});

router.get('/test', (req, res) => res.send('OK'));

router.get('/', (req, res) => {
    res.send('Route GET userLogin OK');
});


// Gestion de la connexion avec identifiants temporaires
const handleTemporaryLogin = async (req, res) => {
    try {
        const { identifiantTemporaire, password } = req.body;

        if (!identifiantTemporaire || !password) {
            return res.status(400).json({ message: 'Identifiant temporaire et mot de passe requis' });
        }

        const student = await PasswordResetService.validateTemporaryCredentials(
            identifiantTemporaire,
            password
        );

        // Générer un token avec flag de changement requis
        const token = jwt.sign(
            {
                id: student.user.id,
                email: student.user.email,
                role: student.user.role,
                requirePasswordChange: true
            },
            process.env.JWT_SECRET,
            { expiresIn: '1h' } // Token court pour changement de mot de passe
        );

        res.json({
            message: 'Connexion temporaire réussie - Changement de mot de passe requis',
            token,
            requirePasswordChange: true,
            user: {
                id: student.user.id,
                email: student.user.email,
                role: student.user.role,
                requirePasswordChange: true,
                etudiant: {
                    id: student.id,
                    nom: student.nom,
                    prenom: student.prenom,
                    matricule: student.matricule,
                    filiere: student.filiere,
                    annee: student.annee
                }
            }
        });
    } catch (error) {
        res.status(401).json({
            message: error.message
        });
    }
};

// Nouvelle route pour changement de mot de passe après réinitialisation
router.post('/change-password-temporary', authenticateToken, async (req, res) => {
    try {
        const { newPassword, confirmPassword, currentPassword } = req.body;

        // Validation des données
        if (!newPassword || !confirmPassword || !currentPassword) {
            return res.status(400).json({ message: 'Tous les champs sont requis' });
        }

        if (newPassword !== confirmPassword) {
            return res.status(400).json({ message: 'Les mots de passe ne correspondent pas' });
        }

        if (newPassword.length < 8) {
            return res.status(400).json({
                message: 'Le mot de passe doit contenir au moins 8 caractères'
            });
        }

        // Vérifier que l'utilisateur a besoin de changer son mot de passe
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            select: { id: true, tempPassword: true, role: true, requirePasswordChange: true }
        });

        if (!user || !user.requirePasswordChange) {
            return res.status(400).json({ message: 'Changement de mot de passe non requis' });
        }

        // Vérifier le mot de passe temporaire actuel
        const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.tempPassword || '');
        if (!isCurrentPasswordValid) {
            return res.status(401).json({ message: 'Mot de passe temporaire incorrect' });
        }

        // Changer le mot de passe
        await PasswordResetService.completePasswordReset(user.id, newPassword);

        // Régénérer le token sans le flag de changement
        const newToken = jwt.sign(
            {
                id: user.id,
                role: user.role,
                requirePasswordChange: false
            },
            process.env.JWT_SECRET,
            { expiresIn: '8h' }
        );

        res.json({
            success: true,
            message: 'Mot de passe changé avec succès',
            token: newToken,
            requirePasswordChange: false
        });

    } catch (error) {
        console.error('Erreur changement mot de passe temporaire:', error);
        res.status(500).json({
            message: 'Erreur lors du changement de mot de passe'
        });
    }
});

// Route pour changer le mot de passe
router.post('/change-password', authenticateToken, async (req, res) => {
    try {
        const { currentPassword, newPassword, confirmPassword } = req.body;

        // Validation des données
        if (!currentPassword || !newPassword || !confirmPassword) {
            return res.status(400).json({ message: 'Tous les champs sont requis' });
        }

        if (newPassword !== confirmPassword) {
            return res.status(400).json({ message: 'Les mots de passe ne correspondent pas' });
        }

        if (newPassword.length < 8) {
            return res.status(400).json({
                message: 'Le mot de passe doit contenir au moins 8 caractères'
            });
        }

        // Vérifier que l'utilisateur est un étudiant
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            select: { id: true, password: true, role: true }
        });

        if (!user || user.role !== 'ETUDIANT') {
            return res.status(403).json({ message: 'Accès réservé aux étudiants' });
        }

        // Vérifier l'ancien mot de passe
        const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
        if (!isCurrentPasswordValid) {
            return res.status(401).json({ message: 'Mot de passe actuel incorrect' });
        }

        // Vérifier que le nouveau mot de passe est différent de l'ancien
        const isSamePassword = await bcrypt.compare(newPassword, user.password);
        if (isSamePassword) {
            return res.status(400).json({
                message: 'Le nouveau mot de passe doit être différent de l\'ancien'
            });
        }

        // Hacher le nouveau mot de passe
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

        // Mettre à jour le mot de passe
        await prisma.user.update({
            where: { id: req.user.id },
            data: { password: hashedPassword }
        });

        res.json({
            success: true,
            message: 'Mot de passe changé avec succès'
        });

    } catch (error) {
        console.error('Erreur changement mot de passe:', error);
        res.status(500).json({
            message: 'Erreur lors du changement de mot de passe'
        });
    }
});

// Route pour mot de passe oublié - Envoi d'email
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ message: 'Email requis' });
        }

        // Vérifier si l'email existe et est un étudiant
        const user = await prisma.user.findUnique({
            where: { email },
            include: { etudiant: true }
        });

        // Pour des raisons de sécurité, on ne révèle pas si l'email existe
        if (!user || user.role !== 'ETUDIANT') {
            return res.json({
                message: 'Si cet email existe dans notre système, un lien de réinitialisation a été envoyé'
            });
        }

        // Générer un token de réinitialisation (valide 1 heure)
        const resetToken = jwt.sign(
            {
                userId: user.id,
                type: 'password_reset',
                email: user.email
            },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        // Créer le lien de réinitialisation
        const resetLink = `${process.env.FRONTEND_URL}/reset-password.html?token=${resetToken}`;

        // Préparer l'email
        const mailOptions = {
            from: process.env.EMAIL_FROM || 'no-reply@ucao-uuc.com',
            to: email,
            subject: 'Réinitialisation de votre mot de passe - UCAO-UUC',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #800020;">Réinitialisation de mot de passe</h2>
                    <p>Bonjour ${user.etudiant?.prenom || 'Étudiant'},</p>
                    <p>Vous avez demandé à réinitialiser votre mot de passe pour la plateforme de vote UCAO-UUC.</p>
                    
                    <p>Pour créer un nouveau mot de passe, cliquez sur le bouton ci-dessous :</p>
                    
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${resetLink}" 
                           style="background-color: #800020; color: white; padding: 15px 30px; 
                                  text-decoration: none; border-radius: 5px; font-weight: bold;">
                            Réinitialiser mon mot de passe
                        </a>
                    </div>

                    <p>Ce lien est valable pendant <strong>1 heure</strong> pour des raisons de sécurité.</p>
                    
                    <p>Si vous n'avez pas demandé cette réinitialisation, ignorez simplement cet email.</p>
                    
                    <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
                    
                    <p style="color: #666; font-size: 12px;">
                        Équipe UCAO-UUC<br>
                        Plateforme de vote électronique
                    </p>
                </div>
            `
        };

        // Envoyer l'email
        await transporter.sendMail(mailOptions);

        res.json({
            success: true,
            message: 'Si cet email existe dans notre système, un lien de réinitialisation a été envoyé'
        });

    } catch (error) {
        console.error('Erreur envoi email réinitialisation:', error);
        res.status(500).json({
            message: 'Erreur lors de l\'envoi des instructions de réinitialisation'
        });
    }
});

// Route pour réinitialiser le mot de passe avec token
router.post('/reset-password', async (req, res) => {
    try {
        const { token, newPassword, confirmPassword } = req.body;

        if (!token || !newPassword || !confirmPassword) {
            return res.status(400).json({ message: 'Tous les champs sont requis' });
        }

        if (newPassword !== confirmPassword) {
            return res.status(400).json({ message: 'Les mots de passe ne correspondent pas' });
        }

        if (newPassword.length < 8) {
            return res.status(400).json({
                message: 'Le mot de passe doit contenir au moins 8 caractères'
            });
        }

        // Vérifier et décoder le token
        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET);
        } catch (error) {
            return res.status(401).json({ message: 'Lien de réinitialisation invalide ou expiré' });
        }

        // Vérifier que c'est bien un token de réinitialisation
        if (decoded.type !== 'password_reset') {
            return res.status(401).json({ message: 'Token invalide' });
        }

        // Vérifier que l'utilisateur existe toujours
        const user = await prisma.user.findUnique({
            where: { id: decoded.userId }
        });

        if (!user) {
            return res.status(404).json({ message: 'Utilisateur non trouvé' });
        }

        // Hacher le nouveau mot de passe
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

        // Mettre à jour le mot de passe
        await prisma.user.update({
            where: { id: user.id },
            data: { password: hashedPassword }
        });

        res.json({
            success: true,
            message: 'Mot de passe réinitialisé avec succès'
        });

    } catch (error) {
        console.error('Erreur réinitialisation mot de passe:', error);
        res.status(500).json({
            message: 'Erreur lors de la réinitialisation du mot de passe'
        });
    }
});

export default router;
import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import prisma from '../prisma.js';
import { authenticateToken } from '../middlewares/auth.js';

const router = express.Router();

// Configuration du transporteur email
const transporter = nodemailer.createTransporter({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
    }
});

// Route de connexion (existante)
router.post('/', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password)
            return res.status(400).json({ message: 'Email et mot de passe requis' });

        // Trouver user ETUDIANT par email
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || user.role !== 'ETUDIANT') {
            return res.status(400).json({ message: 'Utilisateur non trouvé ou rôle invalide' });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword)
            return res.status(400).json({ message: 'Mot de passe incorrect' });

        // Générer JWT
        const token = jwt.sign(
            { id: user.id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '8h' }
        );

        res.json({ message: 'Connexion réussie', token });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erreur serveur' });
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
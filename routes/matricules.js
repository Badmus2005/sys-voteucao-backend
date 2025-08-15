import express from 'express';
import prisma from '../prisma.js';
import { authenticateToken } from '../middlewares/auth.js';

const router = express.Router();

/**
 * Body attendu (JSON)
 * {
 *   "matricules": ["UUC2023-0001", "UUC2023-0002", ...]
 * }
 */
router.post('/import', authenticateToken, async (req, res) => {
    try {
        const { matricules } = req.body;

        if (!matricules || !Array.isArray(matricules) || matricules.length === 0) {
            return res.status(400).json({ message: 'Liste de matricules invalide.' });
        }

        // Vérifier que l'utilisateur est un admin
        const admin = await prisma.admin.findUnique({ where: { userId: req.user.id } });
        if (!admin) {
            return res.status(403).json({ message: 'Accès refusé. Admin requis.' });
        }

        const createdMatricules = [];
        const skippedMatricules = [];

        for (const mat of matricules) {
            // Vérifier que le matricule n’existe pas déjà
            const exists = await prisma.etudiant.findUnique({ where: { matricule: mat } });
            if (exists) {
                skippedMatricules.push(mat);
                continue;
            }

            // Créer l’étudiant avec seulement le matricule, autres champs vides
            await prisma.etudiant.create({
                data: { matricule: mat }
            });
            createdMatricules.push(mat);
        }

        return res.status(201).json({
            message: 'Importation terminée.',
            created: createdMatricules,
            skipped: skippedMatricules
        });
    } catch (err) {
        console.error('Erreur import matricules:', err);
        return res.status(500).json({ message: 'Erreur serveur.' });
    }
});

export default router;

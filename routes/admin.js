import express from 'express';
import prisma from '../prisma.js';
import { authenticateToken, requireAdmin } from '../middlewares/auth.js';
import { resetStudentAccess, getStudentByMatricule, getStudentByCodeInscription, getAllStudents } from '../controllers/adminController.js';


const router = express.Router();

/**
 * GET /admin/me
 * Récupère les informations de l'admin connecté
 */
router.get('/me', authenticateToken, async (req, res) => {
    try {
        const admin = await prisma.admin.findUnique({
            where: { userId: req.user.id },
            include: { user: true }
        });

        if (!admin) {
            return res.status(404).json({ message: "Admin introuvable" });
        }

        res.json({
            nom: admin.nom,
            prenom: admin.prenom,
            poste: admin.poste,
            email: admin.user.email,
            role: admin.user.role,
            photoUrl: admin.user.photoUrl || null
        });
    } catch (err) {
        console.error("Erreur admin/me:", err);
        res.status(500).json({ message: "Erreur serveur" });
    }
});

/**
 * PUT /admin/update
 * Met à jour le profil admin
 */
router.put('/update', authenticateToken, async (req, res) => {
    try {
        const { nom, prenom, email } = req.body;

        const updatedAdmin = await prisma.admin.update({
            where: { userId: req.user.id },
            data: { nom, prenom, email },
            include: { user: true }
        });

        res.json({
            message: "Profil mis à jour avec succès",
            admin: {
                nom: updatedAdmin.nom,
                prenom: updatedAdmin.prenom,
                email: updatedAdmin.user.email,
                photoUrl: updatedAdmin.user.photoUrl
            }
        });
    } catch (err) {
        console.error("Erreur admin/update:", err);
        res.status(500).json({ message: "Erreur lors de la mise à jour" });
    }
});



// Route pour réinitialiser les accès d'un étudiant
router.post('/students/:studentId/reset-access',
    authenticateToken,
    requireAdmin,
    resetStudentAccess
);

// Route pour rechercher un étudiant par matricule (années supérieures)
router.get('/students/matricule/:matricule',
    authenticateToken,
    requireAdmin,
    getStudentByMatricule
);

// Route pour rechercher un étudiant par code d'inscription (1ère année)
router.get('/students/code/:code',
    authenticateToken,
    requireAdmin,
    getStudentByCodeInscription
);

// Route pour lister tous les étudiants
router.get('/students',
    authenticateToken,
    requireAdmin,
    getAllStudents
);

export default router;